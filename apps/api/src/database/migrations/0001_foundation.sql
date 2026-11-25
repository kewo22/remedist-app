-- Foundation: Postgres schemas, shared domains, the updated_at trigger, and the database roles
-- that decide what the app and Ask Remedist can touch.
--
-- Conventions for every table:
-- - id UUID PRIMARY KEY DEFAULT gen_random_uuid().
-- - Timestamps are TIMESTAMPTZ. Mutable tables have updated_at plus the set_updated_at() trigger.
-- - Money is money_minor: BIGINT minor units (cents), never floating point.
-- - Enum-like TEXT columns have a CHECK listing their snake_case values, in step with packages/shared.
-- - Every foreign key has an index. Clinical rows are never deleted.
-- - Changes made by people are written to public.audit_log, not to per-table *_by_label columns.
--
-- Schemas:
-- - public:   business data (contacts, schedule, bookings, payments, content, messaging)
-- - auth:     logins, roles, sessions, one-time tokens, OTP and abuse ledgers, integration secrets
-- - clinical: health data (intake, care plans, attachments, access log)
-- - ai:       views Ask Remedist may read (added with the Ask Remedist feature)

CREATE SCHEMA auth;
CREATE SCHEMA clinical;
CREATE SCHEMA ai;

-- Range exclusion on availability slots needs btree_gist (practitioner_id WITH = inside a gist index).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Domains: values that repeat across tables, defined once ─────────────────────────────

CREATE DOMAIN money_minor AS BIGINT CHECK (VALUE >= 0);
CREATE DOMAIN currency_code AS TEXT CHECK (VALUE IN ('LKR', 'USD'));
CREATE DOMAIN message_channel AS TEXT CHECK (VALUE IN ('whatsapp', 'sms', 'email'));
-- E.164: "+" then 7-15 digits. Same rule as isValidPhone in packages/shared.
CREATE DOMAIN phone_e164 AS TEXT CHECK (VALUE ~ '^\+[1-9][0-9]{6,14}$');
-- ISO 3166-1 alpha-2, e.g. 'LK'. Nationality 'LK' pays in LKR, everyone else in USD.
CREATE DOMAIN country_code AS CHAR(2) CHECK (VALUE ~ '^[A-Z]{2}$');

-- ── updated_at ───────────────────────────────────────────────────────────────────────────

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── Database roles ───────────────────────────────────────────────────────────────────────
-- Group roles without a password (NOLOGIN), so no secret lives in a migration. A login role
-- created in Neon is made a member (GRANT remedist_app TO <login>) and inherits these rights.
-- Migrations themselves run as the database owner, which owns every object.
--
-- remedist_app:         the API. Read and write everywhere, but no DELETE on clinical tables.
-- remedist_ai_readonly: Ask Remedist. SELECT on the views in the ai schema only.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'remedist_app') THEN
    CREATE ROLE remedist_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'remedist_ai_readonly') THEN
    CREATE ROLE remedist_ai_readonly NOLOGIN;
  END IF;
END
$$;

REVOKE ALL ON SCHEMA auth, clinical, ai FROM PUBLIC;
GRANT USAGE ON SCHEMA public, auth, clinical TO remedist_app;
GRANT USAGE ON SCHEMA ai TO remedist_ai_readonly;

-- Rights on tables and views created by later migrations (which run as this same owner).
ALTER DEFAULT PRIVILEGES IN SCHEMA public   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO remedist_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO remedist_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA clinical GRANT SELECT, INSERT, UPDATE ON TABLES TO remedist_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA ai       GRANT SELECT ON TABLES TO remedist_ai_readonly;
