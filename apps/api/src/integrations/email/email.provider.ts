import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

export interface EmailResult {
  /** 'skipped' in demo mode: nothing left the building. */
  status: 'sent' | 'skipped';
  providerId?: string;
}

/** Thrown when the provider refuses or can't be reached. The message never holds the email body. */
export class EmailDeliveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmailDeliveryError';
  }
}

/** Sends transactional email. Inject this; the module picks Resend or the demo by config. */
export abstract class EmailProvider {
  /** True when emails are only logged. Lets callers show dev codes outside production. */
  abstract readonly isDemo: boolean;
  abstract send(message: EmailMessage): Promise<EmailResult>;
}

/** "a***@example.com": enough to tell messages apart in logs without recording the address. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

const RESEND_URL = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 10_000;

/** Resend over its REST API (no SDK needed for one endpoint). */
export class ResendEmailProvider extends EmailProvider {
  readonly isDemo = false;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {
    super();
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    let response: Response;
    try {
      response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, html: message.html }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new EmailDeliveryError('Resend could not be reached', { cause: error });
    }
    if (!response.ok) {
      // Resend's error body describes the request problem; it never echoes the key.
      const detail = await response.text().catch(() => '');
      throw new EmailDeliveryError(`Resend refused the email (${response.status}): ${detail.slice(0, 300)}`);
    }
    const body = (await response.json().catch(() => ({}))) as { id?: unknown };
    return { status: 'sent', providerId: typeof body.id === 'string' ? body.id : undefined };
  }
}

/** No RESEND_API_KEY: logs that an email would have gone out. Never logs the body (it can hold a code). */
export class DemoEmailProvider extends EmailProvider {
  readonly isDemo = true;
  private readonly logger = new Logger('Email');

  send(message: EmailMessage): Promise<EmailResult> {
    this.logger.log(`[demo] would send "${message.subject}" to ${maskEmail(message.to)}`);
    return Promise.resolve({ status: 'skipped' });
  }
}

export function createEmailProvider(config: AppConfig): EmailProvider {
  if (config.email.resendApiKey) {
    return new ResendEmailProvider(config.email.resendApiKey, config.email.from);
  }
  new Logger('Email').warn('RESEND_API_KEY is not set: emails are logged, not sent (demo mode)');
  return new DemoEmailProvider();
}
