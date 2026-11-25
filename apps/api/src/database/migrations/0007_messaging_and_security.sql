-- Outbound messaging (log and drip campaigns), the staff notification feed, and the OTP and
-- login abuse ledgers. Ledgers here only grow: the retention job prunes them (see CLAUDE.md).

CREATE TABLE message_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID NOT NULL REFERENCES contacts (id),
  channel       message_channel NOT NULL,
  template_name TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped_no_credentials')),
  provider_ref  TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX message_log_contact_id_idx ON message_log (contact_id, sent_at);
CREATE INDEX message_log_sent_at_idx ON message_log (sent_at);

CREATE TABLE drip_campaigns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER drip_campaigns_updated_at BEFORE UPDATE ON drip_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE drip_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES drip_campaigns (id),
  step_order    INTEGER NOT NULL CHECK (step_order >= 1),
  day_offset    INTEGER NOT NULL CHECK (day_offset >= 0),
  channel       message_channel NOT NULL,
  template_name TEXT NOT NULL,
  subject       TEXT,
  body          TEXT NOT NULL,
  UNIQUE (campaign_id, step_order),
  CHECK (channel <> 'email' OR subject IS NOT NULL)
);

-- One enrolment per contact per campaign. steps_snapshot freezes the campaign's steps at
-- enrolment, so later edits never change what an enrolled contact receives.
CREATE TABLE drip_progress (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     UUID NOT NULL REFERENCES contacts (id),
  campaign_id    UUID NOT NULL REFERENCES drip_campaigns (id),
  last_step_id   UUID REFERENCES drip_steps (id),
  steps_snapshot JSONB NOT NULL,
  enrolled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_reason TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contact_id, campaign_id)
);
CREATE INDEX drip_progress_campaign_id_idx ON drip_progress (campaign_id);
CREATE INDEX drip_progress_last_step_id_idx ON drip_progress (last_step_id);
CREATE TRIGGER drip_progress_updated_at BEFORE UPDATE ON drip_progress
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Staff notification feed. target_role NULL means every staff member; otherwise only holders of
-- that role see it. Read and dismissed state is per staff member (notification_reads).
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section     TEXT NOT NULL CHECK (section IN (
                'pipeline', 'bookings', 'payments', 'reviews', 'accounts', 'availability', 'products', 'faq', 'probono')),
  type        TEXT NOT NULL CHECK (type IN (
                'new_lead', 'new_booking', 'reschedule', 'cancellation', 'no_show', 'payment_received',
                'overdue_payment', 'pay_after_review', 'new_testimonial', 'new_signup', 'calendar_conflict',
                'low_stock', 'probono_reclaim_eligible', 'scheduled', 'possible_faq_gap')),
  severity    TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'success', 'info', 'neutral')),
  message     TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  target_role TEXT REFERENCES auth.roles (code),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_section_idx ON notifications (section, created_at);
CREATE INDEX notifications_entity_idx ON notifications (entity_type, entity_id);
CREATE INDEX notifications_target_role_idx ON notifications (target_role);

CREATE TABLE notification_reads (
  notification_id UUID NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  staff_user_id   UUID NOT NULL REFERENCES auth.staff_users (id),
  read_at         TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  PRIMARY KEY (notification_id, staff_user_id),
  CHECK (read_at IS NOT NULL OR dismissed_at IS NOT NULL)
);
CREATE INDEX notification_reads_staff_user_id_idx ON notification_reads (staff_user_id);

-- One row per OTP issued: the rate-limit ledger (counted per phone/email/IP over rolling windows)
-- and the verification record. Only the code's hash is stored.
CREATE TABLE auth.otp_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number    phone_e164,
  email           TEXT,
  ip_address      INET NOT NULL,
  purpose         TEXT NOT NULL CHECK (purpose IN ('login', 'admin_login', 'email_verification', 'password_reset')),
  channel         message_channel NOT NULL,
  code_hash       TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  verified_at     TIMESTAMPTZ,
  attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired')),
  -- Twilio/Resend delivery outcome, separate from the verify lifecycle. Cost estimates count only
  -- 'sent' WhatsApp/SMS rows.
  delivery_status TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'failed', 'skipped')),
  CHECK (num_nonnulls(phone_number, email) = 1),
  CHECK (expires_at > created_at),
  CHECK ((status = 'verified') = (verified_at IS NOT NULL))
);
CREATE INDEX otp_requests_phone_idx ON auth.otp_requests (phone_number, created_at) WHERE phone_number IS NOT NULL;
CREATE INDEX otp_requests_email_idx ON auth.otp_requests (lower(email), created_at) WHERE email IS NOT NULL;
CREATE INDEX otp_requests_ip_idx ON auth.otp_requests (ip_address, created_at);
-- The daily send cap counts every row since midnight.
CREATE INDEX otp_requests_created_at_idx ON auth.otp_requests (created_at);

-- Failed password and email-code guesses. Successes aren't written.
CREATE TABLE auth.login_attempts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose    TEXT NOT NULL CHECK (purpose IN ('login', 'admin_login', 'email_verify')),
  email      TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(email, ip_address) >= 1)
);
CREATE INDEX login_attempts_email_idx ON auth.login_attempts (purpose, lower(email), created_at);
CREATE INDEX login_attempts_ip_idx ON auth.login_attempts (purpose, ip_address, created_at);
CREATE INDEX login_attempts_created_at_idx ON auth.login_attempts (created_at);

-- Manual and automatic blocks, checked before any rate-limit counting. expires_at NULL = permanent.
-- Automatic blocks have created_by NULL and a label such as 'auto: daily cap'.
CREATE TABLE auth.otp_blocklist (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number     phone_e164,
  email            TEXT,
  ip_address       INET,
  reason           TEXT NOT NULL,
  created_by       UUID REFERENCES auth.staff_users (id),
  created_by_label TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ,
  CHECK (num_nonnulls(phone_number, email, ip_address) >= 1),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE INDEX otp_blocklist_phone_idx ON auth.otp_blocklist (phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX otp_blocklist_email_idx ON auth.otp_blocklist (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX otp_blocklist_ip_idx ON auth.otp_blocklist (ip_address) WHERE ip_address IS NOT NULL;
CREATE INDEX otp_blocklist_created_by_idx ON auth.otp_blocklist (created_by);
