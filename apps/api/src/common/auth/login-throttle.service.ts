import { Injectable } from '@nestjs/common';
import type { AttemptLimits } from './auth.constants';
import { failDelay } from './auth-tokens';
import { TooManyAttemptsException } from './auth.exceptions';
import { LoginAttemptPurpose, LoginAttemptsRepository } from './login-attempts.repository';

const FIFTEEN_MINUTES = 15 * 60;
const ONE_DAY = 24 * 60 * 60;

interface Window {
  field: 'email' | 'ip_address';
  value: string;
  seconds: number;
  max: number;
}

/**
 * Brute-force protection for passwords and email codes, as in the old app: rolling windows per
 * email and per IP over auth.login_attempts. Only failures are recorded. Every failed or
 * throttled attempt waits a random 300–500 ms so timing can't tell an unknown email from a
 * wrong password.
 */
@Injectable()
export class LoginThrottleService {
  constructor(private readonly attempts: LoginAttemptsRepository) {}

  /** Throws TooManyAttemptsException (after the fail delay) if any window is full. */
  async assertAllowed(
    purpose: LoginAttemptPurpose,
    limits: AttemptLimits,
    email: string,
    ipAddress: string | null,
  ): Promise<void> {
    const windows: Window[] = [
      { field: 'email', value: email, seconds: FIFTEEN_MINUTES, max: limits.email15m },
      { field: 'email', value: email, seconds: ONE_DAY, max: limits.email24h },
    ];
    if (ipAddress) {
      windows.push(
        { field: 'ip_address', value: ipAddress, seconds: FIFTEEN_MINUTES, max: limits.ip15m },
        { field: 'ip_address', value: ipAddress, seconds: ONE_DAY, max: limits.ip24h },
      );
    }

    const results = await Promise.all(
      windows.map((w) => this.attempts.failuresInWindow(purpose, w.field, w.value, w.seconds)),
    );

    for (const [i, window] of windows.entries()) {
      const { count, oldest } = results[i] ?? { count: 0, oldest: null };
      if (count >= window.max) {
        const elapsed = oldest ? (Date.now() - oldest.getTime()) / 1000 : 0;
        const waitSeconds = Math.max(1, Math.ceil(window.seconds - elapsed));
        await failDelay();
        throw new TooManyAttemptsException(waitSeconds);
      }
    }
  }

  /** Records the failure, then waits the fail delay. */
  async recordFailure(purpose: LoginAttemptPurpose, email: string, ipAddress: string | null): Promise<void> {
    await this.attempts.recordFailure(purpose, email, ipAddress);
    await failDelay();
  }
}
