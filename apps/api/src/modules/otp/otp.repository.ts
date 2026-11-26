import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
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
      `SELECT ${column}::text AS value, count(*)::int AS count FROM auth.otp_requests
       WHERE ${column} IS NOT NULL
         AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
       GROUP BY ${column} ORDER BY count DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async create(request: NewOtpRequest): Promise<string> {
    const column = request.identifier.kind === 'email' ? 'email' : 'phone_number';
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO auth.otp_requests
         (${column}, ip_address, purpose, channel, code_hash, expires_at, delivery_status)
       VALUES ($1, $2::inet, $3, $4, $5, now() + make_interval(mins => $6), $7)
       RETURNING id`,
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
    const id = rows[0]?.id;
    if (!id) {
      throw new Error('OTP request insert returned no id');
    }
    return id;
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
