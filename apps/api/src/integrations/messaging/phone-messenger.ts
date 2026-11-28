import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from './mask-phone';
import type { PhoneMessage } from './phone-templates';
import { SmsSender } from './sms.sender';
import { WhatsAppSender, type SendOutcome } from './whatsapp.sender';

export { maskPhone } from './mask-phone';
export type { PhoneMessage, PhoneTemplate } from './phone-templates';

export type PhoneChannel = 'whatsapp' | 'sms';

export interface PhoneMessageResult {
  channel: PhoneChannel;
  provider: 'twilio' | 'dialog_esms';
  /** 'skipped' in demo mode: nothing was sent. */
  status: 'sent' | 'skipped';
  providerRef?: string;
}

/** Neither WhatsApp nor SMS took the message (or neither can reach the number). Never carries the text. */
export class PhoneDeliveryError extends Error {
  constructor(
    message: string,
    /** The last channel tried, or undefined when none could reach the number. */
    readonly lastTried?: Pick<PhoneMessageResult, 'channel' | 'provider'>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PhoneDeliveryError';
  }
}

interface Route {
  channel: PhoneChannel;
  provider: PhoneMessageResult['provider'];
  send: () => Promise<SendOutcome>;
}

/**
 * Sends one message to a phone: WhatsApp (Twilio, approved template) first, then SMS (Dialog
 * e-SMS) if WhatsApp has no template for it or fails. e-SMS only reaches Sri Lankan mobiles, so a
 * foreign number has WhatsApp only.
 *
 * A configured provider always goes before a demo one, so a real e-SMS key is used even while
 * Twilio is in demo mode. Only when no configured provider can take the message does a demo one
 * "send" it ('skipped').
 */
@Injectable()
export class PhoneMessenger {
  private readonly logger = new Logger('Messaging');

  constructor(
    private readonly whatsapp: WhatsAppSender,
    private readonly sms: SmsSender,
  ) {}

  async send(toE164: string, message: PhoneMessage): Promise<PhoneMessageResult> {
    const whatsappRoute: Route = { channel: 'whatsapp', provider: 'twilio', send: () => this.whatsapp.send(toE164, message) };
    const smsRoute: Route = { channel: 'sms', provider: 'dialog_esms', send: () => this.sms.send(toE164, message.text) };
    const whatsappFits = this.whatsapp.supports(message.template);
    const smsFits = this.sms.canDeliverTo(toE164);

    const live = [
      ...(whatsappFits && !this.whatsapp.isDemo ? [whatsappRoute] : []),
      ...(smsFits && !this.sms.isDemo ? [smsRoute] : []),
    ];
    if (live.length === 0) {
      const demo = whatsappFits ? whatsappRoute : smsFits ? smsRoute : undefined;
      if (!demo) {
        throw new PhoneDeliveryError(
          `No WhatsApp template for ${message.template}, and ${maskPhone(toE164)} isn't a Sri Lankan mobile for SMS`,
        );
      }
      return { channel: demo.channel, provider: demo.provider, ...(await demo.send()) };
    }

    let lastError: unknown;
    for (const [index, route] of live.entries()) {
      try {
        return { channel: route.channel, provider: route.provider, ...(await route.send()) };
      } catch (error) {
        lastError = error;
        const next = live[index + 1];
        this.logger.warn(
          `${route.channel} "${message.template}" to ${maskPhone(toE164)} failed${next ? `, trying ${next.channel}` : ''}: ${describe(error)}`,
        );
      }
    }
    const last = live[live.length - 1];
    throw new PhoneDeliveryError(
      `No channel delivered "${message.template}" to ${maskPhone(toE164)}`,
      last && { channel: last.channel, provider: last.provider },
      { cause: lastError },
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
