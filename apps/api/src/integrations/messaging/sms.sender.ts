import { Logger } from '@nestjs/common';
import type { AppConfig } from '../../config/app-config';
import { maskPhone } from './mask-phone';
import { MessageDeliveryError, type SendOutcome } from './whatsapp.sender';

/** Dialog e-SMS delivers only to Sri Lankan mobiles: +94 7X XXX XXXX. */
export function isSriLankanMobile(phoneE164: string): boolean {
  return /^\+947\d{8}$/.test(phoneE164);
}

/** SMS by plain text. Inject this; the module picks Dialog e-SMS or the demo by config. */
export abstract class SmsSender {
  abstract readonly isDemo: boolean;
  /** True when this number can get an SMS (Sri Lankan mobiles only). */
  canDeliverTo(toE164: string): boolean {
    return isSriLankanMobile(toE164);
  }
  abstract send(toE164: string, text: string): Promise<SendOutcome>;
}

const ESMS_SEND_URL = 'https://e-sms.dialog.lk/api/v1/message-via-url/create/url-campaign';
const REQUEST_TIMEOUT_MS = 15_000;
/** The body e-SMS answers with when it accepts a message; anything else is an error code. */
const ESMS_ACCEPTED = '1';

/**
 * Dialog e-SMS's URL API: one GET with the key, recipient, sender mask and text in the query
 * string. It answers 200 either way, with `1` on success or an error code (2007 bad key, 2008 no
 * balance, 2012 mask not approved...). The URL holds the key and the text, so it's never logged.
 */
export class DialogEsmsSender extends SmsSender {
  readonly isDemo = false;

  constructor(
    private readonly apiKey: string,
    private readonly sourceAddress: string,
  ) {
    super();
  }

  async send(toE164: string, text: string): Promise<SendOutcome> {
    if (!this.canDeliverTo(toE164)) {
      throw new MessageDeliveryError('e-SMS only delivers to Sri Lankan mobiles');
    }
    const url = new URL(ESMS_SEND_URL);
    url.search = new URLSearchParams({
      esmsqk: this.apiKey,
      list: toE164.slice(1), // 94XXXXXXXXX
      source_address: this.sourceAddress,
      message: text,
    }).toString();

    let response: Response;
    try {
      response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      // Not chained: a fetch error can carry the URL, which holds the key and the text.
      throw new MessageDeliveryError('e-SMS could not be reached');
    }
    const body = (await response.text().catch(() => '')).trim();
    if (!response.ok || body !== ESMS_ACCEPTED) {
      throw new MessageDeliveryError(`e-SMS refused the SMS (HTTP ${response.status}, code ${body.slice(0, 20) || 'none'})`);
    }
    // e-SMS's URL API returns no message id.
    return { status: 'sent' };
  }
}

/** No e-SMS settings: logs that an SMS would have gone out. Never logs the text (it can hold a code). */
export class DemoSmsSender extends SmsSender {
  readonly isDemo = true;
  private readonly logger = new Logger('Sms');

  send(toE164: string): Promise<SendOutcome> {
    this.logger.log(`[demo] would send an SMS to ${maskPhone(toE164)}`);
    return Promise.resolve({ status: 'skipped' });
  }
}

export function createSmsSender(config: AppConfig): SmsSender {
  if (config.esms) {
    return new DialogEsmsSender(config.esms.apiKey, config.esms.sourceAddress);
  }
  new Logger('Sms').warn('ESMS_API_KEY and ESMS_SOURCE_ADDRESS are not set: SMS are logged, not sent (demo mode)');
  return new DemoSmsSender();
}
