-- message_log becomes the one record of every WhatsApp, SMS and email sent to a contact (codes
-- stay in auth.otp_requests): who it went to, through which provider, about what, and where it got
-- to. Twilio's status callbacks move WhatsApp messages on to delivered, read or undelivered.

-- 'skipped_no_credentials' becomes 'skipped' (demo mode); the old app's other skip reasons aren't logged.
ALTER TABLE message_log DROP CONSTRAINT message_log_status_check;
UPDATE message_log SET status = 'skipped' WHERE status = 'skipped_no_credentials';
ALTER TABLE message_log ADD CONSTRAINT message_log_status_check
  CHECK (status IN ('sent', 'delivered', 'read', 'failed', 'undelivered', 'skipped'));

ALTER TABLE message_log
  ADD COLUMN category          TEXT NOT NULL DEFAULT 'transactional' CHECK (category IN ('transactional', 'marketing')),
  ADD COLUMN provider          TEXT CHECK (provider IN ('twilio', 'dialog_esms', 'resend')),
  -- The phone (E.164) or email it went to: a contact's details can change later.
  ADD COLUMN recipient         TEXT,
  ADD COLUMN entity_type       TEXT,
  ADD COLUMN entity_id         UUID,
  -- The provider's reason for a failure. Never the message text.
  ADD COLUMN error             TEXT,
  ADD COLUMN status_updated_at TIMESTAMPTZ,
  ADD COLUMN updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TRIGGER message_log_updated_at BEFORE UPDATE ON message_log
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Status callbacks find their message by the provider's id.
CREATE UNIQUE INDEX message_log_provider_ref_key ON message_log (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX message_log_entity_idx ON message_log (entity_type, entity_id) WHERE entity_id IS NOT NULL;

-- WhatsApp replies from clients (Twilio's inbound webhook), kept for the features that read them
-- (the post-treatment check-in). provider_ref is Twilio's MessageSid, so a retried webhook is
-- stored once. contact_id is set when exactly one active contact has the sender's number.
CREATE TABLE inbound_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_ref TEXT NOT NULL UNIQUE,
  channel      message_channel NOT NULL CHECK (channel IN ('whatsapp', 'sms')),
  from_phone   phone_e164 NOT NULL,
  contact_id   UUID REFERENCES contacts (id),
  body         TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inbound_messages_contact_id_idx ON inbound_messages (contact_id, received_at);
CREATE INDEX inbound_messages_from_phone_idx ON inbound_messages (from_phone, received_at);
