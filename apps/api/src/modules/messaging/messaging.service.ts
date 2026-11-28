import { Injectable, Logger } from '@nestjs/common';
import type { MessageCategory, MessageLogEntry } from '@remedist/shared';
import { EmailProvider, maskEmail } from '../../integrations/email/email.provider';
import { PhoneDeliveryError, PhoneMessenger, maskPhone, type PhoneMessage } from '../../integrations/messaging/phone-messenger';
import { MessagingRepository, type MessageLogRow, type NewMessageLogEntry } from './messaging.repository';

export interface EmailContent {
  subject: string;
  html: string;
}

/** The contact a message is for, with the details it's sent to. */
export interface MessageRecipient {
  id: string;
  phone: string | null;
  email: string | null;
}

export interface ContactMessage {
  /** Logged as template_name, e.g. `booking_confirmed`. */
  template: string;
  /** Defaults to transactional. */
  category?: MessageCategory;
  /** Sent to the contact's phone (WhatsApp, else SMS) when they have one. */
  phone?: PhoneMessage;
  /** Sent to the contact's email when they have one. */
  email?: EmailContent;
  /** What the message is about, e.g. `{ type: 'booking', id }`. */
  entity?: { type: string; id: string };
}

const LOG_ERROR_MAX_LENGTH = 300;
const CLIENT_LOG_LIMIT = 100;

/**
 * Sends messages to contacts and records each one in message_log: the only place that writes it.
 * A message goes to every channel it has content for and the contact has an address for (phone
 * and email both, not one as a fallback for the other).
 *
 * Call it after the change it's about has committed. It never throws: a provider failure is logged
 * and recorded as `failed`, and must never undo or fail the change itself.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly repository: MessagingRepository,
    private readonly phone: PhoneMessenger,
    private readonly email: EmailProvider,
  ) {}

  async sendToContact(contact: MessageRecipient, message: ContactMessage): Promise<void> {
    const base = {
      contactId: contact.id,
      category: message.category ?? 'transactional',
      template: message.template,
      entityType: message.entity?.type,
      entityId: message.entity?.id,
    };
    await Promise.all([
      message.phone && contact.phone ? this.sendPhone(contact.phone, message.phone, base) : undefined,
      message.email && contact.email ? this.sendEmail(contact.email, message.email, base) : undefined,
    ]);
  }

  async listForContact(contactId: string): Promise<MessageLogEntry[]> {
    return (await this.repository.listForContact(contactId, CLIENT_LOG_LIMIT)).map(toEntry);
  }

  private async sendPhone(to: string, content: PhoneMessage, base: LogBase): Promise<void> {
    let entry: NewMessageLogEntry;
    try {
      const sent = await this.phone.send(to, content);
      entry = { ...base, channel: sent.channel, provider: sent.provider, providerRef: sent.providerRef, status: sent.status, recipient: to };
    } catch (error) {
      const lastTried = error instanceof PhoneDeliveryError ? error.lastTried : undefined;
      this.logger.error(`"${base.template}" to ${maskPhone(to)} failed: ${describe(error)}`);
      entry = {
        ...base,
        channel: lastTried?.channel ?? 'whatsapp',
        provider: lastTried?.provider ?? null,
        status: 'failed',
        recipient: to,
        error: describe(error instanceof PhoneDeliveryError && error.cause ? error.cause : error),
      };
    }
    await this.record(entry);
  }

  private async sendEmail(to: string, content: EmailContent, base: LogBase): Promise<void> {
    let entry: NewMessageLogEntry;
    try {
      const sent = await this.email.send({ to, subject: content.subject, html: content.html });
      entry = { ...base, channel: 'email', provider: 'resend', providerRef: sent.providerId, status: sent.status, recipient: to };
    } catch (error) {
      this.logger.error(`"${base.template}" to ${maskEmail(to)} failed: ${describe(error)}`);
      entry = { ...base, channel: 'email', provider: 'resend', status: 'failed', recipient: to, error: describe(error) };
    }
    await this.record(entry);
  }

  /** A logging failure is reported but never thrown: the message has already gone. */
  private async record(entry: NewMessageLogEntry): Promise<void> {
    try {
      await this.repository.insert({ ...entry, error: entry.error?.slice(0, LOG_ERROR_MAX_LENGTH) });
    } catch (error) {
      this.logger.error(`Could not log "${entry.template}" (${entry.channel})`, error instanceof Error ? error.stack : undefined);
    }
  }
}

type LogBase = Pick<NewMessageLogEntry, 'contactId' | 'category' | 'template' | 'entityType' | 'entityId'>;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toEntry(row: MessageLogRow): MessageLogEntry {
  return {
    id: row.id,
    channel: row.channel,
    category: row.category,
    template: row.template_name,
    status: row.status,
    provider: row.provider,
    recipient: row.recipient,
    entityType: row.entity_type,
    entityId: row.entity_id,
    error: row.error,
    sentAt: row.sent_at.toISOString(),
    statusUpdatedAt: row.status_updated_at?.toISOString() ?? null,
  };
}
