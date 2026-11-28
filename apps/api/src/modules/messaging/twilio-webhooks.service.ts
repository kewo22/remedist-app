import { Injectable, Logger } from '@nestjs/common';
import { isValidPhone } from '@remedist/shared';
import { AppConfig } from '../../config/app-config';
import { maskPhone } from '../../integrations/messaging/mask-phone';
import { isValidTwilioSignature } from '../../integrations/messaging/twilio-signature';
import { InvalidWebhookSignatureException } from './messaging.exceptions';
import { MessagingRepository } from './messaging.repository';

type TwilioParams = Readonly<Record<string, unknown>>;

/** Twilio's MessageStatus values, mapped onto message_log. Earlier stages (queued, sending...) are ignored. */
const STATUS_MAP: Readonly<Record<string, 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered'>> = {
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
  failed: 'failed',
  undelivered: 'undelivered',
};

function text(params: TwilioParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Twilio's webhooks: delivery updates for WhatsApp messages we sent, and replies clients send us.
 * Each request is trusted only after its X-Twilio-Signature matches. Message bodies are never logged.
 */
@Injectable()
export class TwilioWebhooksService {
  private readonly logger = new Logger(TwilioWebhooksService.name);

  constructor(
    private readonly repository: MessagingRepository,
    private readonly config: AppConfig,
  ) {}

  /**
   * Without TWILIO_AUTH_TOKEN nothing can be checked: refused in production, accepted with a
   * warning elsewhere so the webhooks can be tried locally.
   */
  verify(originalUrl: string, params: TwilioParams, signature: string | undefined): void {
    const authToken = this.config.twilio.authToken;
    if (!authToken) {
      if (this.config.isProduction) {
        this.logger.error('Twilio webhook refused: TWILIO_AUTH_TOKEN is not set');
        throw new InvalidWebhookSignatureException();
      }
      this.logger.warn('[demo] TWILIO_AUTH_TOKEN is not set: Twilio webhook accepted without a signature check');
      return;
    }
    // The URL Twilio called: APP_URL must be the public one it was configured with.
    if (!isValidTwilioSignature(authToken, `${this.config.appUrl}${originalUrl}`, params, signature)) {
      this.logger.warn(`Twilio webhook with a bad signature on ${originalUrl.split('?')[0]}; ignored`);
      throw new InvalidWebhookSignatureException();
    }
  }

  async handleStatus(params: TwilioParams): Promise<void> {
    const sid = text(params, 'MessageSid');
    const status = STATUS_MAP[text(params, 'MessageStatus') ?? ''];
    if (!sid || !status) {
      return;
    }
    const errorCode = text(params, 'ErrorCode');
    const changed = await this.repository.applyDeliveryStatus('twilio', sid, status, errorCode ? `Twilio error ${errorCode}` : null);
    if (changed && (status === 'failed' || status === 'undelivered')) {
      this.logger.warn(`WhatsApp message ${sid} ${status}${errorCode ? ` (Twilio error ${errorCode})` : ''}`);
    }
  }

  /** Stores a client's reply. Nothing acts on replies yet; the post-treatment check-in will read them. */
  async handleInbound(params: TwilioParams): Promise<void> {
    const sid = text(params, 'MessageSid');
    const from = text(params, 'From');
    if (!sid || !from) {
      return;
    }
    const channel = from.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
    const fromPhone = from.replace(/^whatsapp:/, '');
    if (!isValidPhone(fromPhone)) {
      this.logger.warn(`Inbound ${channel} message ${sid} has an unusable sender; ignored`);
      return;
    }
    const stored = await this.repository.insertInbound({ providerRef: sid, channel, fromPhone, body: text(params, 'Body') ?? '' });
    if (stored) {
      this.logger.log(`Inbound ${channel} message from ${maskPhone(fromPhone)} stored`);
    }
  }
}
