-- Contacts (every person the clinic deals with, leads included), patient logins, login sessions,
-- one-time tokens, and dependents managed from someone else's account.

CREATE TABLE contacts (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL,
  phone     phone_e164,
  email     TEXT CHECK (email <> ''),
  -- Fallback for the booking currency when nationality isn't known yet: 'lk' pays LKR.
  residency TEXT NOT NULL DEFAULT 'intl' CHECK (residency IN ('lk', 'intl')),
  source    TEXT NOT NULL DEFAULT 'website' CHECK (source IN ('website', 'walk_in', 'probono', 'staff', 'import')),
  stage     TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new', 'nurturing', 'booked', 'patient')),

  -- Part 1 registration. registration_number (REM-0001...) is assigned once, at Part 1 completion.
  -- gender, nationality, id_type, id_number and date_of_birth are locked once part1_completed_at
  -- is set: only staff may change them afterwards, recorded in audit_log.
  registration_number     TEXT UNIQUE,
  gender                  TEXT,
  nationality             country_code, -- 'LK' pays LKR, everyone else USD
  id_type                 TEXT CHECK (id_type IN ('nic', 'passport')),
  -- Trimmed and upper-cased, so the unique index compares like with like.
  id_number               TEXT CHECK (id_number <> '' AND id_number = upper(btrim(id_number))),
  date_of_birth           DATE,
  profession              TEXT,
  address                 TEXT,
  backup_contact_name     TEXT,
  backup_contact_relation TEXT,
  backup_contact_phone    phone_e164,
  referral_text           TEXT, -- free-text "how did you hear about us"
  referred_by_contact_id  UUID REFERENCES contacts (id),
  terms_accepted_at       TIMESTAMPTZ,
  terms_accepted_version  INTEGER REFERENCES terms_versions (version_number),
  part1_completed_at      TIMESTAMPTZ,

  -- Pay-after-session: staff-only switch and reminder cadence. Balances are derived from ledgers.
  pay_after_session         BOOLEAN NOT NULL DEFAULT false,
  reminder_frequency_days   INTEGER NOT NULL DEFAULT 7 CHECK (reminder_frequency_days > 0),
  -- Dedupes the one December credit-expiry warning per year.
  credit_expiry_warned_year INTEGER,

  -- Contacts are archived, never deleted: clinical records point at them.
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((id_type IS NULL) = (id_number IS NULL))
);
CREATE UNIQUE INDEX contacts_email_key ON contacts (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX contacts_id_number_key ON contacts (id_number) WHERE id_number IS NOT NULL;
CREATE INDEX contacts_phone_idx ON contacts (phone);
CREATE INDEX contacts_stage_idx ON contacts (stage) WHERE archived_at IS NULL;
CREATE INDEX contacts_referred_by_contact_id_idx ON contacts (referred_by_contact_id);
CREATE INDEX contacts_terms_accepted_version_idx ON contacts (terms_accepted_version);
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Patient portal logins (email + password, or Google). One per contact. The name lives on the contact.
CREATE TABLE auth.patient_accounts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id        UUID NOT NULL UNIQUE REFERENCES contacts (id),
  email             TEXT NOT NULL,
  password_hash     TEXT,
  google_id         TEXT UNIQUE,
  auth_provider     TEXT NOT NULL DEFAULT 'email' CHECK (auth_provider IN ('email', 'google')),
  email_verified_at TIMESTAMPTZ,
  -- Bumped on password reset and "log out everywhere"; older tokens are rejected.
  token_version     INTEGER NOT NULL DEFAULT 0,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (password_hash IS NOT NULL OR google_id IS NOT NULL)
);
CREATE UNIQUE INDEX patient_accounts_email_key ON auth.patient_accounts (lower(email));
CREATE TRIGGER patient_accounts_updated_at BEFORE UPDATE ON auth.patient_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh-token sessions for the httpOnly cookie login, staff or patient. Each refresh rotates the
-- token: the old row gets replaced_by, and presenting a replaced token revokes the whole chain.
CREATE TABLE auth.sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id      UUID REFERENCES auth.staff_users (id),
  patient_account_id UUID REFERENCES auth.patient_accounts (id),
  refresh_token_hash TEXT NOT NULL UNIQUE,
  replaced_by        UUID REFERENCES auth.sessions (id),
  user_agent         TEXT,
  ip_address         INET,
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  last_used_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(staff_user_id, patient_account_id) = 1),
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_staff_user_id_idx ON auth.sessions (staff_user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_patient_account_id_idx ON auth.sessions (patient_account_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_replaced_by_idx ON auth.sessions (replaced_by);
CREATE INDEX sessions_expires_at_idx ON auth.sessions (expires_at);

-- One-time tokens: email verification, password reset, staff invites. Only the hash is stored.
CREATE TABLE auth.one_time_tokens (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose            TEXT NOT NULL CHECK (purpose IN ('email_verify', 'password_reset', 'staff_invite')),
  staff_user_id      UUID REFERENCES auth.staff_users (id),
  patient_account_id UUID REFERENCES auth.patient_accounts (id),
  token_hash         TEXT NOT NULL UNIQUE,
  expires_at         TIMESTAMPTZ NOT NULL,
  used_at            TIMESTAMPTZ,
  attempt_count      INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(staff_user_id, patient_account_id) = 1),
  CHECK (expires_at > created_at)
);
CREATE INDEX one_time_tokens_staff_user_id_idx ON auth.one_time_tokens (staff_user_id, purpose);
CREATE INDEX one_time_tokens_patient_account_id_idx ON auth.one_time_tokens (patient_account_id, purpose);
CREATE INDEX one_time_tokens_expires_at_idx ON auth.one_time_tokens (expires_at);

-- People an account holder manages (a child, a parent...). A dependent can later get their own
-- login without moving any records.
CREATE TABLE account_dependents (
  patient_account_id UUID NOT NULL REFERENCES auth.patient_accounts (id),
  contact_id         UUID NOT NULL REFERENCES contacts (id),
  relationship       TEXT NOT NULL CHECK (relationship IN ('child', 'parent', 'spouse', 'sibling', 'other')),
  -- The dependent-support questions aren't defined yet; free-form until they are.
  support_notes      JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_account_id, contact_id)
);
CREATE INDEX account_dependents_contact_id_idx ON account_dependents (contact_id);
