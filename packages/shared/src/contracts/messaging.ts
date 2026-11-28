// Messages sent to clients (WhatsApp, SMS, email) and the CRM's view of them.

export const ADMIN_MESSAGE_ROUTES = {
  /** GET → MessageLogEntry[] (newest 100). Replace :id with the contact id. Needs patients.manage. */
  forClient: '/admin/clients/:id/messages',
} as const;

export type MessageChannel = 'whatsapp' | 'sms' | 'email';

/** Transactional: codes and booking messages. Marketing: newsletters and campaigns (opt-out applies). */
export type MessageCategory = 'transactional' | 'marketing';

/**
 * Where a message got to. `sent` means the provider accepted it; Twilio's status callbacks move
 * WhatsApp messages on to `delivered`, `read` or `undelivered`. `skipped` means demo mode: the
 * provider isn't configured, so nothing left the API.
 */
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered' | 'skipped';

export type MessageProvider = 'twilio' | 'dialog_esms' | 'resend';

export interface MessageLogEntry {
  id: string;
  channel: MessageChannel;
  category: MessageCategory;
  /** e.g. `booking_confirmed`. */
  template: string;
  status: MessageStatus;
  provider: MessageProvider | null;
  /** The phone (E.164) or email address it went to. */
  recipient: string | null;
  /** What it was about, e.g. `booking` and the booking id. */
  entityType: string | null;
  entityId: string | null;
  /** The provider's reason when it failed or wasn't delivered. Never the message text. */
  error: string | null;
  /** ISO 8601. */
  sentAt: string;
  /** ISO 8601: the last delivery update from the provider, if any. */
  statusUpdatedAt: string | null;
}
