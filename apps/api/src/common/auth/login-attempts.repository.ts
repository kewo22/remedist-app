import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

/** Matches the CHECK on auth.login_attempts.purpose. */
export type LoginAttemptPurpose = 'login' | 'admin_login' | 'email_verify';

/** All SQL for auth.login_attempts: the ledger of failed password and email-code guesses. */
@Injectable()
export class LoginAttemptsRepository {
  constructor(private readonly db: DatabaseService) {}

  async recordFailure(purpose: LoginAttemptPurpose, email: string | null, ipAddress: string | null): Promise<void> {
    await this.db.query('INSERT INTO auth.login_attempts (purpose, email, ip_address) VALUES ($1, $2, $3::inet)', [
      purpose,
      email,
      ipAddress,
    ]);
  }

  /**
   * Failures in a rolling window, and when the oldest of them falls out of it.
   * `field` is a fixed column name, never input.
   */
  async failuresInWindow(
    purpose: LoginAttemptPurpose,
    field: 'email' | 'ip_address',
    value: string,
    windowSeconds: number,
  ): Promise<{ count: number; oldest: Date | null }> {
    const column = field === 'email' ? 'lower(email)' : 'ip_address';
    const valueExpr = field === 'email' ? 'lower($2)' : '$2::inet';
    const { rows } = await this.db.query<{ count: number; oldest: Date | null }>(
      `SELECT count(*)::int AS count, min(created_at) AS oldest
       FROM auth.login_attempts
       WHERE purpose = $1 AND ${column} = ${valueExpr} AND created_at >= now() - make_interval(secs => $3)`,
      [purpose, value, windowSeconds],
    );
    return rows[0] ?? { count: 0, oldest: null };
  }
}
