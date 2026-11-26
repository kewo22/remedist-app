import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config';

/** Checks a Cloudflare Turnstile token. Inject this; the module picks the real one or the demo. */
export abstract class TurnstileVerifier {
  abstract readonly isDemo: boolean;
  /** True only when Cloudflare confirms the token. Never throws: a failure is just `false`. */
  abstract verify(token: string | undefined, remoteIp: string | null): Promise<boolean>;
}

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const REQUEST_TIMEOUT_MS = 10_000;

export class CloudflareTurnstileVerifier extends TurnstileVerifier {
  readonly isDemo = false;
  private readonly logger = new Logger('Turnstile');

  constructor(private readonly secretKey: string) {
    super();
  }

  async verify(token: string | undefined, remoteIp: string | null): Promise<boolean> {
    if (!token) {
      return false;
    }
    const body = new URLSearchParams({ secret: this.secretKey, response: token });
    if (remoteIp) {
      body.set('remoteip', remoteIp);
    }
    try {
      const response = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      const data = (await response.json()) as { success?: unknown };
      return data.success === true;
    } catch (error) {
      this.logger.error('Turnstile verification request failed', error instanceof Error ? error.stack : undefined);
      return false;
    }
  }
}

/** No TURNSTILE_SECRET_KEY: every challenge passes, as in the old app's demo mode. */
export class DemoTurnstileVerifier extends TurnstileVerifier {
  readonly isDemo = true;

  verify(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

export function createTurnstileVerifier(config: AppConfig): TurnstileVerifier {
  if (config.turnstile.secretKey) {
    return new CloudflareTurnstileVerifier(config.turnstile.secretKey);
  }
  new Logger('Turnstile').warn('TURNSTILE_SECRET_KEY is not set: every challenge passes (demo mode)');
  return new DemoTurnstileVerifier();
}
