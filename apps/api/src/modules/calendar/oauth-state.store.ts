import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * The pending OAuth `state` values: which staff member started a Google connect. Google's redirect
 * can't carry the CRM's token, so the callback trusts only a state minted here, once.
 *
 * In memory, so it assumes a single instance (see CLAUDE.md "In-memory state"); behind this small
 * service so it can move to Postgres or Redis without touching callers.
 */
@Injectable()
export class OAuthStateStore {
  private readonly pending = new Map<string, { staffUserId: string; expiresAt: number }>();

  issue(staffUserId: string): string {
    this.sweep();
    const state = randomBytes(24).toString('base64url');
    this.pending.set(state, { staffUserId, expiresAt: Date.now() + STATE_TTL_MS });
    return state;
  }

  /** The staff member who started it, once; undefined if unknown, used or expired. */
  consume(state: string): string | undefined {
    const entry = this.pending.get(state);
    this.pending.delete(state);
    return entry && entry.expiresAt > Date.now() ? entry.staffUserId : undefined;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [state, entry] of this.pending) {
      if (entry.expiresAt <= now) {
        this.pending.delete(state);
      }
    }
  }
}
