import { Injectable } from '@nestjs/common';
import type { MessageCategory, MessageChannel, MessageProvider, MessageStatus } from '@remedist/shared';
import { DatabaseService } from '../../database/database.service';

export interface MessageLogRow {
  id: string;
  channel: MessageChannel;
  category: MessageCategory;
  template_name: string;
  status: MessageStatus;
  provider: MessageProvider | null;
  recipient: string | null;
  entity_type: string | null;
  entity_id: string | null;
  error: string | null;
  sent_at: Date;
  status_updated_at: Date | null;
}

export interface NewMessageLogEntry {
  contactId: string;
  channel: MessageChannel;
  category: MessageCategory;
  template: string;
  status: MessageStatus;
  provider: MessageProvider | null;
  providerRef?: string;
  recipient: string;
  entityType?: string;
  entityId?: string;
  error?: string;
}

export interface NewInboundMessage {
  providerRef: string;
  channel: 'whatsapp' | 'sms';
  fromPhone: string;
  body: string;
}

/** Delivery states a status callback may move a message to, in order. A later one never goes back. */
const DELIVERY_RANK: Readonly<Record<string, number>> = { sent: 1, delivered: 2, read: 3 };

@Injectable()
export class MessagingRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(entry: NewMessageLogEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO message_log
         (contact_id, channel, category, template_name, status, provider, provider_ref, recipient, entity_type, entity_id, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        entry.contactId,
        entry.channel,
        entry.category,
        entry.template,
        entry.status,
        entry.provider,
        entry.providerRef ?? null,
        entry.recipient,
        entry.entityType ?? null,
        entry.entityId ?? null,
        entry.error ?? null,
      ],
    );
  }

  /**
   * Applies a provider's delivery update. sent → delivered → read only moves forward (callbacks
   * can arrive out of order); failed and undelivered are final once set. Returns whether a row changed.
   */
  async applyDeliveryStatus(
    provider: MessageProvider,
    providerRef: string,
    status: 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered',
    error: string | null,
  ): Promise<boolean> {
    const failure = status === 'failed' || status === 'undelivered';
    const result = await this.db.query(
      `UPDATE message_log
       SET status = $3, error = COALESCE($4, error), status_updated_at = now()
       WHERE provider = $1 AND provider_ref = $2
         AND status IN ('sent', 'delivered', 'read')
         AND ($5 OR (CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 END) < $6)`,
      [provider, providerRef, status, error, failure, DELIVERY_RANK[status] ?? 0],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Newest first. */
  async listForContact(contactId: string, limit: number): Promise<MessageLogRow[]> {
    const { rows } = await this.db.query<MessageLogRow>(
      `SELECT id, channel, category, template_name, status, provider, recipient, entity_type, entity_id, error,
              sent_at, status_updated_at
       FROM message_log
       WHERE contact_id = $1
       ORDER BY sent_at DESC, id
       LIMIT $2`,
      [contactId, limit],
    );
    return rows;
  }

  /**
   * Stores a reply once per provider id, linked to the contact when exactly one active contact has
   * the number. Returns false when it was already stored (a retried webhook).
   */
  async insertInbound(message: NewInboundMessage): Promise<boolean> {
    const result = await this.db.query(
      `INSERT INTO inbound_messages (provider_ref, channel, from_phone, contact_id, body)
       VALUES ($1, $2, $3::text,
               (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id::text)::uuid END
                FROM contacts WHERE phone = $3::text AND archived_at IS NULL),
               $4)
       ON CONFLICT (provider_ref) DO NOTHING`,
      [message.providerRef, message.channel, message.fromPhone, message.body],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
