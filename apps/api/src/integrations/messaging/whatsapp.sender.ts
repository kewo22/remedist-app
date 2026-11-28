import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config';
import { maskPhone } from './mask-phone';
import type { PhoneMessage, PhoneTemplate } from './phone-templates';

/** Where Twilio posts delivery updates, relative to APP_URL. Matches TwilioWebhooksController. */
export const TWILIO_STATUS_CALLBACK_PATH = '/api/v1/webhooks/twilio/status';

const REQUEST_TIMEOUT_MS = 10_000;

export interface SendOutcome {
  /** 'skipped' in demo mode: nothing was sent. */
  status: 'sent' | 'skipped';
  providerRef?: string;
}

/** The provider refused the message or couldn't be reached. Never carries the message text. */
export class MessageDeliveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MessageDeliveryError';
  }
}

/** WhatsApp through approved templates. Inject this; the module picks Twilio or the demo by config. */
export abstract class WhatsAppSender {
  abstract readonly isDemo: boolean;
  /** True when this message type has an approved template (always, in demo mode). */
  abstract supports(template: PhoneTemplate): boolean;
  abstract send(toE164: string, message: PhoneMessage): Promise<SendOutcome>;
}

/** Twilio's Messages API with a Content SID (no SDK needed for one endpoint). */
export class TwilioWhatsAppSender extends WhatsAppSender {
  readonly isDemo = false;

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly from: string,
    private readonly contentSids: Readonly<Partial<Record<PhoneTemplate, string>>>,
    /** Absent when APP_URL isn't public (https), so Twilio isn't asked to call a URL it can't reach. */
    private readonly statusCallbackUrl: string | undefined,
  ) {
    super();
  }

  supports(template: PhoneTemplate): boolean {
    return this.contentSids[template] !== undefined;
  }

  async send(toE164: string, message: PhoneMessage): Promise<SendOutcome> {
    const contentSid = this.contentSids[message.template];
    if (!contentSid) {
      throw new MessageDeliveryError(`No WhatsApp template is set for ${message.template}`);
    }
    const params = new URLSearchParams({
      From: this.from,
      To: `whatsapp:${toE164}`,
      ContentSid: contentSid,
      ContentVariables: JSON.stringify(Object.fromEntries(message.variables.map((value, i) => [String(i + 1), value]))),
    });
    if (this.statusCallbackUrl) {
      params.set('StatusCallback', this.statusCallbackUrl);
    }

    let response: Response;
    try {
      response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new MessageDeliveryError('Twilio could not be reached', { cause: error });
    }
    const data = (await response.json().catch(() => ({}))) as { sid?: unknown; code?: unknown; message?: unknown };
    if (!response.ok) {
      // Twilio's error describes the request (code and message); it never echoes the variables.
      throw new MessageDeliveryError(`Twilio error ${response.status} (code ${String(data.code)}): ${String(data.message)}`);
    }
    return { status: 'sent', providerRef: typeof data.sid === 'string' ? data.sid : undefined };
  }
}

/** No Twilio credentials: logs that a message would have gone out. Never logs the text (it can hold a code). */
export class DemoWhatsAppSender extends WhatsAppSender {
  readonly isDemo = true;
  private readonly logger = new Logger('WhatsApp');

  supports(): boolean {
    return true;
  }

  send(toE164: string, message: PhoneMessage): Promise<SendOutcome> {
    this.logger.log(`[demo] would send WhatsApp "${message.template}" to ${maskPhone(toE164)}`);
    return Promise.resolve({ status: 'skipped' });
  }
}

export function createWhatsAppSender(config: AppConfig): WhatsAppSender {
  const { accountSid, authToken, whatsappFrom, contentSids } = config.twilio;
  const logger = new Logger('WhatsApp');
  if (accountSid && authToken && whatsappFrom) {
    const missing = Object.entries(contentSids).filter(([, sid]) => !sid).map(([template]) => template);
    if (missing.length > 0) {
      logger.warn(`No WhatsApp template for ${missing.join(', ')}: those messages go by SMS only`);
    }
    const statusCallbackUrl = config.appUrl.startsWith('https://') ? `${config.appUrl}${TWILIO_STATUS_CALLBACK_PATH}` : undefined;
    return new TwilioWhatsAppSender(accountSid, authToken, whatsappFrom, contentSids, statusCallbackUrl);
  }
  logger.warn('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM are not all set: WhatsApp is logged, not sent (demo mode)');
  return new DemoWhatsAppSender();
}
