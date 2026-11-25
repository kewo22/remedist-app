-- Staff identity and access (roles are many-to-many, the API checks permissions), practitioners,
-- the generic audit log, and the clinic's settings and integration tables.

-- CRM logins. Separate from patient accounts: different secrets, different attack surface.
CREATE TABLE auth.staff_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  -- TOTP secret, encrypted by the app (AES-GCM). Required for super_admin and owner.
  mfa_secret_enc TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  -- Bumped by "log out everywhere"; tokens carrying an older value are rejected.
  token_version  INTEGER NOT NULL DEFAULT 0,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_users_email_key ON auth.staff_users (lower(email));
CREATE TRIGGER staff_users_updated_at BEFORE UPDATE ON auth.staff_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Roles and their permissions are copied from packages/shared (ROLE_DEFINITIONS) by the seed.
CREATE TABLE auth.roles (
  code        TEXT PRIMARY KEY CHECK (code IN ('super_admin', 'owner', 'doctor', 'staff', 'ask_remedist')),
  name        TEXT NOT NULL,
  description TEXT
);

CREATE TABLE auth.role_permissions (
  role_code  TEXT NOT NULL REFERENCES auth.roles (code),
  permission TEXT NOT NULL CHECK (permission ~ '^[a-z_]+\.[a-z_]+$'),
  PRIMARY KEY (role_code, permission)
);

-- super_admin is granted only by seed or CLI, never from the CRM. The last owner can't be removed.
CREATE TABLE auth.staff_user_roles (
  staff_user_id UUID NOT NULL REFERENCES auth.staff_users (id),
  role_code     TEXT NOT NULL REFERENCES auth.roles (code),
  granted_by    UUID REFERENCES auth.staff_users (id),
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_user_id, role_code)
);
CREATE INDEX staff_user_roles_role_code_idx ON auth.staff_user_roles (role_code);
CREATE INDEX staff_user_roles_granted_by_idx ON auth.staff_user_roles (granted_by);

-- Someone patients can book with. A doctor is a staff user with the doctor role AND a row here.
CREATE TABLE practitioners (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id       UUID NOT NULL UNIQUE REFERENCES auth.staff_users (id),
  display_name        TEXT NOT NULL,
  title               TEXT,
  registration_number TEXT, -- professional licence, if any
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER practitioners_updated_at BEFORE UPDATE ON practitioners
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every change a person (or the system) makes to business data, from one repository helper.
-- Replaces the old per-table audit tables and the *_by_label columns.
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type  TEXT NOT NULL CHECK (actor_type IN ('staff', 'patient', 'system', 'integration')),
  actor_id    UUID,          -- staff_users.id or patient_accounts.id; NULL for system/integration
  actor_label TEXT NOT NULL, -- e.g. the staff name, 'Google Calendar sync', 'Walk-in kiosk'
  action      TEXT NOT NULL, -- e.g. 'slot.blocked', 'contact.locked_field_changed'
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  before      JSONB,
  after       JSONB,
  note        TEXT,
  request_id  TEXT,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (actor_type IN ('system', 'integration') OR actor_id IS NOT NULL)
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_id, created_at);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at);

-- Terms & Conditions, versioned. Exactly one 'draft'; publishing freezes it with a version_number
-- and starts a fresh draft. Published rows are never updated.
CREATE TABLE terms_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number        INTEGER UNIQUE, -- NULL while draft
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  general_terms_content TEXT NOT NULL DEFAULT '',
  refund_policy_content TEXT NOT NULL DEFAULT '',
  published_at          TIMESTAMPTZ,
  published_by          UUID REFERENCES auth.staff_users (id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'draft') = (version_number IS NULL)),
  CHECK ((status = 'published') = (published_at IS NOT NULL))
);
CREATE UNIQUE INDEX terms_versions_one_draft ON terms_versions (status) WHERE status = 'draft';
CREATE INDEX terms_versions_published_by_idx ON terms_versions (published_by);
CREATE TRIGGER terms_versions_updated_at BEFORE UPDATE ON terms_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Staff-editable unit costs behind "Estimated costs this month" (USD). Singleton.
CREATE TABLE cost_rate_card (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claude_input_cost_per_million  NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (claude_input_cost_per_million >= 0),  -- Haiku
  claude_output_cost_per_million NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (claude_output_cost_per_million >= 0), -- Haiku
  sonnet_input_cost_per_million  NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (sonnet_input_cost_per_million >= 0),  -- Ask Remedist
  sonnet_output_cost_per_million NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (sonnet_output_cost_per_million >= 0), -- Ask Remedist
  whatsapp_cost_per_message      NUMERIC(14, 6) NOT NULL DEFAULT 0 CHECK (whatsapp_cost_per_message >= 0),
  payhere_fee_percent            NUMERIC(5, 2)  NOT NULL DEFAULT 0 CHECK (payhere_fee_percent BETWEEN 0 AND 100),
  updated_by                     UUID REFERENCES auth.staff_users (id),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cost_rate_card_singleton ON cost_rate_card ((true));
CREATE TRIGGER cost_rate_card_updated_at BEFORE UPDATE ON cost_rate_card
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Public clinic WhatsApp/phone and the shop's display-only LKR-per-USD hint. Singleton.
CREATE TABLE clinic_public_contact (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_number phone_e164,
  phone_display   TEXT, -- as shown in the footer, e.g. "+94 77 123 4567"
  lkr_per_usd     NUMERIC(10, 4) NOT NULL DEFAULT 300 CHECK (lkr_per_usd > 0),
  updated_by      UUID REFERENCES auth.staff_users (id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX clinic_public_contact_singleton ON clinic_public_contact ((true));
CREATE TRIGGER clinic_public_contact_updated_at BEFORE UPDATE ON clinic_public_contact
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The connected Google account (the clinic calendar). Tokens are encrypted by the app, so a
-- database dump doesn't hand over the account. Gains practitioner_id when a second doctor has
-- their own calendar.
CREATE TABLE auth.google_oauth_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_email     TEXT NOT NULL UNIQUE,
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  scope             TEXT NOT NULL,
  token_type        TEXT,
  expiry_date       TIMESTAMPTZ,
  connected_by      UUID NOT NULL REFERENCES auth.staff_users (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX google_oauth_tokens_connected_by_idx ON auth.google_oauth_tokens (connected_by);
CREATE TRIGGER google_oauth_tokens_updated_at BEFORE UPDATE ON auth.google_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Incremental sync token per polled calendar, for the inbound Calendar → app sync.
CREATE TABLE calendar_sync_state (
  calendar_id    TEXT PRIMARY KEY,
  sync_token     TEXT,
  last_synced_at TIMESTAMPTZ,
  last_error     TEXT
);

-- Atomic counters: 'registration_number' (REM-0001...) and 'appt_seq:YYYY-MM-DD'.
-- Incremented with INSERT ... ON CONFLICT ... RETURNING.
CREATE TABLE sequence_counters (
  name       TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER sequence_counters_updated_at BEFORE UPDATE ON sequence_counters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
