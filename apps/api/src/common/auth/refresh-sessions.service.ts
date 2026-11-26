import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../database/database.service';
import { REFRESH_REUSE_GRACE_SECONDS } from './auth.constants';
import { hashToken, newRefreshToken } from './auth-tokens';
import { RefreshConflictException, SessionExpiredException } from './auth.exceptions';
import type { ClientInfo } from './client-info';
import { SessionOwnerKind, SessionsRepository } from './sessions.repository';

/** A new or rotated session. The raw refresh token only ever goes into the cookie. */
export interface StartedSession {
  ownerId: string;
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * Refresh-token sessions for both staff and clients: start one at sign-in, rotate it on every
 * refresh, end it on logout. Who may hold a session (active login, verified account) is the
 * caller's decision, passed to rotate() as `stillAllowed`.
 */
@Injectable()
export class RefreshSessionsService {
  constructor(
    private readonly sessions: SessionsRepository,
    private readonly db: DatabaseService,
  ) {}

  async start(
    ownerKind: SessionOwnerKind,
    ownerId: string,
    ttlSeconds: number,
    client: ClientInfo,
    db: Queryable = this.db,
  ): Promise<StartedSession> {
    const refreshToken = newRefreshToken();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const sessionId = await this.sessions.create(
      {
        ownerKind,
        ownerId,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt,
        userAgent: client.userAgent,
        ipAddress: client.ipAddress,
      },
      db,
    );
    return { ownerId, sessionId, refreshToken, expiresAt };
  }

  /**
   * Swaps a refresh token for a new one. The new session keeps the original absolute expiry.
   * Presenting an already-replaced token is treated as theft and revokes the whole chain, unless
   * it was replaced moments ago (two tabs racing), which gets REFRESH_CONFLICT instead.
   */
  async rotate(
    ownerKind: SessionOwnerKind,
    refreshToken: string,
    client: ClientInfo,
    stillAllowed: (ownerId: string) => Promise<boolean>,
  ): Promise<StartedSession> {
    const current = await this.sessions.findByTokenHash(ownerKind, hashToken(refreshToken));
    if (!current) {
      throw new SessionExpiredException();
    }

    if (current.replaced_by) {
      const replacedAgo = current.revoked_at ? (Date.now() - current.revoked_at.getTime()) / 1000 : Infinity;
      if (replacedAgo <= REFRESH_REUSE_GRACE_SECONDS) {
        throw new RefreshConflictException();
      }
      await this.sessions.revokeChainFrom(current.id);
      throw new SessionExpiredException();
    }
    if (current.revoked_at || current.expires_at.getTime() <= Date.now()) {
      throw new SessionExpiredException();
    }
    if (!(await stillAllowed(current.owner_id))) {
      await this.sessions.revoke(current.id);
      throw new SessionExpiredException();
    }

    const nextToken = newRefreshToken();
    const nextSessionId = await this.db.transaction(async (tx) => {
      const id = await this.sessions.create(
        {
          ownerKind,
          ownerId: current.owner_id,
          refreshTokenHash: hashToken(nextToken),
          expiresAt: current.expires_at,
          userAgent: client.userAgent,
          ipAddress: client.ipAddress,
        },
        tx,
      );
      if (!(await this.sessions.markRotated(current.id, id, tx))) {
        // Another request rotated it between our read and this write.
        throw new RefreshConflictException();
      }
      return id;
    });

    return { ownerId: current.owner_id, sessionId: nextSessionId, refreshToken: nextToken, expiresAt: current.expires_at };
  }

  /** Ends the session behind this refresh token, if any. Always succeeds. */
  async end(ownerKind: SessionOwnerKind, refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    const current = await this.sessions.findByTokenHash(ownerKind, hashToken(refreshToken));
    if (current) {
      await this.sessions.revoke(current.id);
    }
  }

  /** Ends every session of one owner. The caller also bumps its token_version in the same transaction. */
  endAll(ownerKind: SessionOwnerKind, ownerId: string, db: Queryable): Promise<number> {
    return this.sessions.revokeAllFor(ownerKind, ownerId, db);
  }
}
