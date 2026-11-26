import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../database/database.service';
import type { OtpChannel, OtpDeliveryStatus, OtpIdentifier, OtpPurpose } from './otp.types';

/** A rolling window over auth.otp_requests. */
export interface WindowStats {
  count: number;
  oldest: Date | null;
  newest: Date | null;
}

export interface PendingCode {
  id: string;
  code_hash: string;
  expires_at: Date;
}

export interface NewOtpRequest {
  identifier: OtpIdentifier;
  ipAddress: string;
  purpose: OtpPurpose;
  channel: OtpChannel;
  codeHash: string;
  ttlMinutes: number;
  deliveryStatus: OtpDeliveryStatus;
}

export interface BlocklistRow {
  id: string;
  phone_number: string | null;
  email: string | null;
  ip_address: string | null;
  reason: string;
  created_by_label: string;
  created_at: Date;
  expires_at: Date | null;
}

export interface NewBlock {
  phoneNumber: string | null;
  email: string | null;
  ipAddress: string | null;
  reason: string;
  /** auth.staff_users.id; null for automatic blocks. */
  createdBy: string | null;
  createdByLabel: string;
  expiresAt: Date | null;
}

// host() drops the /32 or /128 suffix, so IPs read as typed.
const BLOCK_COLUMNS =
  'id, phone_number, email, host(ip_address) AS ip_address, reason, created_by_label, created_at, expires_at';

/** Display value for a ledger column (fixed names, never input). */
function valueOf(column: 'phone_number' | 'email' | 'ip_address'): string {
  return column === 'ip_address' ? 'host(ip_address)' : column;
}

/** Fixed SQL fragments per identifier kind: column and comparison, never built from input. */
function identifierMatch(kind: OtpIdentifier['kind'], param: string): string {
  return kind === 'email' ? `lower(email) = lower(${param})` : `phone_number = ${param}`;
}

/** All SQL for auth.otp_requests (the send ledger and code records) and auth.otp_blocklist. */
@Injectable()
export class OtpRepository {
  constructor(private readonly db: DatabaseService) {}

  /** An active block on the identifier or the IP. */
  async isBlocked(identifier: OtpIdentifier, ipAddress: string): Promise<boolean> {
    const { rows } = await this.db.query(
      `SELECT 1 FROM auth.otp_blocklist
       WHERE (${identifierMatch(identifier.kind, '$1')} OR ip_address = $2::inet)
         AND (expires_at IS NULL OR expires_at > now())
       LIMIT 1`,
      [identifier.value, ipAddress],
    );
    return rows.length > 0;
  }

  async identifierWindow(identifier: OtpIdentifier, windowSeconds: number): Promise<WindowStats> {
    return this.window(identifierMatch(identifier.kind, '$1'), identifier.value, windowSeconds);
  }

  async ipWindow(ipAddress: string, windowSeconds: number): Promise<WindowStats> {
    return this.window('ip_address = $1::inet', ipAddress, windowSeconds);
  }

  /** Codes issued since midnight UTC, clinic-wide (the daily cap). */
  async countToday(): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM auth.otp_requests
       WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    );
    return rows[0]?.count ?? 0;
  }

  /** The busiest phone numbers, emails or IPs today, for the daily-cap alert. */
  async topToday(column: 'phone_number' | 'email' | 'ip_address', limit: number): Promise<{ value: string; count: number }[]> {
    const { rows } = await this.db.query<{ value: string; count: number }>(
      `SELECT ${valueOf(column)} AS value, count(*)::int AS count FROM auth.otp_requests
       WHERE ${column} IS NOT NULL
         AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
       GROUP BY 1 ORDER BY count DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** Codes issued in a rolling window, clinic-wide (the security overview). */
  async countInWindow(windowSeconds: number): Promise<number> {
    const { rows } = await this.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM auth.otp_requests WHERE created_at >= now() - make_interval(secs => $1)`,
      [windowSeconds],
    );
    return rows[0]?.count ?? 0;
  }

  /** The busiest phone numbers, emails or IPs in a rolling window (the security overview). */
  async topInWindow(
    column: 'phone_number' | 'email' | 'ip_address',
    windowSeconds: number,
    limit: number,
  ): Promise<{ value: string; count: number }[]> {
    const { rows } = await this.db.query<{ value: string; count: number }>(
      `SELECT ${valueOf(column)} AS value, count(*)::int AS count FROM auth.otp_requests
       WHERE ${column} IS NOT NULL AND created_at >= now() - make_interval(secs => $1)
       GROUP BY 1 ORDER BY count DESC LIMIT $2`,
      [windowSeconds, limit],
    );
    return rows;
  }

  // ── Blocklist ──────────────────────────────────────────────────────────────────────────

  /** Newest first, expired ones included (so staff can see history). */
  async listBlocks(limit: number): Promise<BlocklistRow[]> {
    const { rows } = await this.db.query<BlocklistRow>(
      `SELECT ${BLOCK_COLUMNS} FROM auth.otp_blocklist ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async addBlock(block: NewBlock, db: Queryable = this.db): Promise<BlocklistRow> {
    const { rows } = await db.query<BlocklistRow>(
      `INSERT INTO auth.otp_blocklist (phone_number, email, ip_address, reason, created_by, created_by_label, expires_at)
       VALUES ($1, $2, $3::inet, $4, $5, $6, $7)
       RETURNING ${BLOCK_COLUMNS}`,
      [block.phoneNumber, block.email, block.ipAddress, block.reason, block.createdBy, block.createdByLabel, block.expiresAt],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('Blocklist insert returned no row');
    }
    return row;
  }

  /** Returns the removed entry, or undefined if there was none. */
  async removeBlock(id: string, db: Queryable = this.db): Promise<BlocklistRow | undefined> {
    const { rows } = await db.query<BlocklistRow>(
      `DELETE FROM auth.otp_blocklist WHERE id = $1 RETURNING ${BLOCK_COLUMNS}`,
      [id],
    );
    return rows[0];
  }

  async create(request: NewOtpRequest): Promise<{ id: string; expiresAt: Date }> {
    const column = request.identifier.kind === 'email' ? 'email' : 'phone_number';
    const { rows } = await this.db.query<{ id: string; expires_at: Date }>(
      `INSERT INTO auth.otp_requests
         (${column}, ip_address, purpose, channel, code_hash, expires_at, delivery_status)
       VALUES ($1, $2::inet, $3, $4, $5, now() + make_interval(mins => $6), $7)
       RETURNING id, expires_at`,
      [
        request.identifier.value,
        request.ipAddress,
        request.purpose,
        request.channel,
        request.codeHash,
        request.ttlMinutes,
        request.deliveryStatus,
      ],
    );
    const row = rows[0];
    if (!row) {
      throw new Error('OTP request insert returned no id');
    }
    return { id: row.id, expiresAt: row.expires_at };
  }

  /** Still-pending codes for this identifier and purpose, newest first (expired ones included). */
  async pending(identifier: OtpIdentifier, purpose: OtpPurpose, limit: number): Promise<PendingCode[]> {
    const { rows } = await this.db.query<PendingCode>(
      `SELECT id, code_hash, expires_at FROM auth.otp_requests
       WHERE ${identifierMatch(identifier.kind, '$1')} AND purpose = $2 AND status = 'pending'
       ORDER BY created_at DESC LIMIT $3`,
      [identifier.value, purpose, limit],
    );
    return rows;
  }

  async expire(ids: string[]): Promise<void> {
    if (ids.length > 0) {
      await this.db.query(`UPDATE auth.otp_requests SET status = 'expired' WHERE id = ANY($1::uuid[]) AND status = 'pending'`, [
        ids,
      ]);
    }
  }

  /**
   * Uses the code: conditional on it still being pending, so two requests can't both spend it.
   * Every other pending code for the same identifier and purpose is expired with it.
   */
  async consume(id: string, identifier: OtpIdentifier, purpose: OtpPurpose): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const { rowCount } = await tx.query(
        `UPDATE auth.otp_requests SET status = 'verified', verified_at = now() WHERE id = $1 AND status = 'pending'`,
        [id],
      );
      if (rowCount !== 1) {
        return false;
      }
      await tx.query(
        `UPDATE auth.otp_requests SET status = 'expired'
         WHERE ${identifierMatch(identifier.kind, '$1')} AND purpose = $2 AND status = 'pending'`,
        [identifier.value, purpose],
      );
      return true;
    });
  }

  /**
   * Spends the proof token issued for a verified phone code. Conditional, so two requests can't
   * both use it. False if the row isn't a verified code for this phone and purpose, or was used.
   */
  async useProof(id: string, phoneNumber: string, purpose: OtpPurpose, db: Queryable = this.db): Promise<boolean> {
    const { rowCount } = await db.query(
      `UPDATE auth.otp_requests SET proof_used_at = now()
       WHERE id = $1 AND phone_number = $2 AND purpose = $3 AND status = 'verified' AND proof_used_at IS NULL`,
      [id, phoneNumber, purpose],
    );
    return rowCount === 1;
  }

  /** Counts a wrong guess; the code is used up once it reaches the limit. Returns whether it's still pending. */
  async recordWrongGuess(id: string, maxAttempts: number): Promise<boolean> {
    const { rows } = await this.db.query<{ status: string }>(
      `UPDATE auth.otp_requests
       SET attempt_count = attempt_count + 1,
           status = CASE WHEN attempt_count + 1 >= $2 THEN 'expired' ELSE status END
       WHERE id = $1 AND status = 'pending'
       RETURNING status`,
      [id, maxAttempts],
    );
    return rows[0]?.status === 'pending';
  }

  private async window(match: string, value: string, windowSeconds: number): Promise<WindowStats> {
    const { rows } = await this.db.query<WindowStats>(
      `SELECT count(*)::int AS count, min(created_at) AS oldest, max(created_at) AS newest
       FROM auth.otp_requests
       WHERE ${match} AND created_at >= now() - make_interval(secs => $2)`,
      [value, windowSeconds],
    );
    return rows[0] ?? { count: 0, oldest: null, newest: null };
  }
}
