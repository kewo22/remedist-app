import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config';

export type PhoneChannel = 'whatsapp' | 'sms';

export interface PhoneMessageResult {
  channel: PhoneChannel;
  /** 'skipped' in demo mode: nothing was sent. */
  status: 'sent' | 'skipped';
  providerRef?: string;
}

/** Neither WhatsApp nor SMS accepted the message. Never carries the message body. */
export class PhoneDeliveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PhoneDeliveryError';
  }
}

/** Sends a text to a phone (E.164). Inject this; the module picks Twilio or the demo by config. */
export abstract class PhoneMessenger {
  abstract readonly isDemo: boolean;
  /** WhatsApp first, SMS if WhatsApp isn't configured or fails. Throws PhoneDeliveryError if both fail. */
  abstract send(toE164: string, body: string): Promise<PhoneMessageResult>;
}

/** "+9477***67": enough to tell messages apart in logs without recording the number. */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

const REQUEST_TIMEOUT_MS = 10_000;

/** Twilio over its REST API (no SDK needed for one endpoint). */
export class TwilioPhoneMessenger extends PhoneMessenger {
  readonly isDemo = false;
  private readonly logger = new Logger('Messaging');

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly whatsappFrom: string | undefined,
    private readonly smsFrom: string | undefined,
  ) {
    super();
  }

  async send(toE164: string, body: string): Promise<PhoneMessageResult> {
    let whatsappError: unknown;
    if (this.whatsappFrom) {
      try {
        return { channel: 'whatsapp', status: 'sent', providerRef: await this.create(this.whatsappFrom, `whatsapp:${toE164}`, body) };
      } catch (error) {
        whatsappError = error;
        this.logger.warn(`WhatsApp to ${maskPhone(toE164)} failed${this.smsFrom ? ', trying SMS' : ''}`);
      }
    }
    if (this.smsFrom) {
      try {
        return { channel: 'sms', status: 'sent', providerRef: await this.create(this.smsFrom, toE164, body) };
      } catch (error) {
        throw new PhoneDeliveryError('Twilio refused the SMS', { cause: error });
      }
    }
    throw new PhoneDeliveryError('Twilio refused the WhatsApp message and no SMS sender is set', {
      cause: whatsappError,
    });
  }

  private async create(from: string, to: string, body: string): Promise<string | undefined> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ From: from, To: to, Body: body }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PhoneDeliveryError('Twilio could not be reached', { cause: error });
    }
    const data = (await response.json().catch(() => ({}))) as { sid?: unknown; code?: unknown; message?: unknown };
    if (!response.ok) {
      // Twilio's error describes the request (code and message); it never echoes the body we sent.
      throw new PhoneDeliveryError(`Twilio error ${response.status} (code ${String(data.code)}): ${String(data.message)}`);
    }
    return typeof data.sid === 'string' ? data.sid : undefined;
  }
}

/** No Twilio credentials: logs that a message would have gone out. Never logs the body (it can hold a code). */
export class DemoPhoneMessenger extends PhoneMessenger {
  readonly isDemo = true;
  private readonly logger = new Logger('Messaging');

  send(toE164: string): Promise<PhoneMessageResult> {
    this.logger.log(`[demo] would send a WhatsApp/SMS to ${maskPhone(toE164)}`);
    return Promise.resolve({ channel: 'sms', status: 'skipped' });
  }
}

export function createPhoneMessenger(config: AppConfig): PhoneMessenger {
  const { accountSid, authToken, whatsappFrom, smsFrom } = config.twilio;
  if (accountSid && authToken && (whatsappFrom || smsFrom)) {
    return new TwilioPhoneMessenger(accountSid, authToken, whatsappFrom, smsFrom);
  }
  new Logger('Messaging').warn(
    'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a sender (TWILIO_WHATSAPP_FROM or TWILIO_SMS_FROM) are not all set: WhatsApp/SMS are logged, not sent (demo mode)',
  );
  return new DemoPhoneMessenger();
}
