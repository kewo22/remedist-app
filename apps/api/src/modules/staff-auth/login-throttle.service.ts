import { Injectable } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  FAIL_DELAY_MAX_MS,
  FAIL_DELAY_MIN_MS,
  LOGIN_LIMITS,
  LOGIN_THROTTLE_PURPOSE,
} from './staff-auth.constants';
import { TooManyLoginAttemptsException } from './staff-auth.exceptions';
import { StaffAuthRepository } from './staff-auth.repository';

const FIFTEEN_MINUTES = 15 * 60;
const ONE_DAY = 24 * 60 * 60;

interface Window {
  field: 'email' | 'ip_address';
  value: string;
  seconds: number;
  max: number;
}

/**
 * Brute-force protection for staff login, as in the old app: rolling windows per email and per
 * IP over auth.login_attempts. Only failures are recorded. Every failed or throttled attempt
 * waits a random 300–500 ms so timing can't tell an unknown email from a wrong password.
 */
@Injectable()
export class LoginThrottleService {
  constructor(private readonly repository: StaffAuthRepository) {}

  /** Throws TooManyLoginAttemptsException (after the fail delay) if any window is full. */
  async assertAllowed(email: string, ipAddress: string | null): Promise<void> {
    const windows: Window[] = [
      { field: 'email', value: email, seconds: FIFTEEN_MINUTES, max: LOGIN_LIMITS.email15m },
      { field: 'email', value: email, seconds: ONE_DAY, max: LOGIN_LIMITS.email24h },
    ];
    if (ipAddress) {
      windows.push(
        { field: 'ip_address', value: ipAddress, seconds: FIFTEEN_MINUTES, max: LOGIN_LIMITS.ip15m },
        { field: 'ip_address', value: ipAddress, seconds: ONE_DAY, max: LOGIN_LIMITS.ip24h },
      );
    }

    const results = await Promise.all(
      windows.map((w) => this.repository.failuresInWindow(LOGIN_THROTTLE_PURPOSE, w.field, w.value, w.seconds)),
    );

    for (const [i, window] of windows.entries()) {
      const { count, oldest } = results[i] ?? { count: 0, oldest: null };
      if (count >= window.max) {
        const elapsed = oldest ? (Date.now() - oldest.getTime()) / 1000 : 0;
        const waitSeconds = Math.max(1, Math.ceil(window.seconds - elapsed));
        await this.failDelay();
        throw new TooManyLoginAttemptsException(waitSeconds);
      }
    }
  }

  async recordFailure(email: string, ipAddress: string | null): Promise<void> {
    await this.repository.recordFailedLogin(LOGIN_THROTTLE_PURPOSE, email, ipAddress);
    await this.failDelay();
  }

  private failDelay(): Promise<void> {
    return sleep(FAIL_DELAY_MIN_MS + Math.random() * (FAIL_DELAY_MAX_MS - FAIL_DELAY_MIN_MS));
  }
}
