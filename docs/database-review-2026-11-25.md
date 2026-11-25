> **Status (applied 25 Nov 2026).** This review was applied in place to the migrations in
> `apps/api/src/database/migrations` (now `0001`–`0008`). Deliberately deferred:
> - §3.3: encounters, SOAP notes, conditions, treatments, allergies and medications. They wait
>   for the clinical records change request. `intake_forms`, `care_plans`, attachments and
>   `access_log` are built.
> - §3.6: the `ai` views (with Ask Remedist) and the login roles with passwords (made in Neon;
>   the password-less group roles and grants are in `0001`). Encrypting `contacts.id_number`
>   isn't done.
> - §4: the retention job, which comes with the background jobs.
> - §5: multi-clinic. Single clinic.
>
> Table and column names in the text below are the reviewer's. A few differ in the migrations:
> `users` became `auth.patient_accounts`, `auth_sessions` became `auth.sessions`, `auth_tokens`
> became `auth.one_time_tokens`, and `auth_attempts` became `auth.login_attempts`.

# Remedist database review and recommended design

**Reviewed:** the new schema in `remedist-api/apps/api/src/database/migrations` (`0001`–`0007`, not yet committed on `feat/api-database`), with the old repo's migrations for history.
**Date:** 25 November 2026

## 1. Verdict

The schema is **good, and better than most at this stage**. Don't rewrite it. Keep the current structure and fix six things, ideally before `0001`–`0007` are committed or run anywhere except a throwaway Neon branch:

1. **Roles.** A single `role` column can't express "Rauzan is the owner *and* the doctor", and there is no `super_admin` or `doctor` role.
2. **No practitioner.** No table says *which doctor* a slot, booking or treatment belongs to. Cheap to add now, painful later.
3. **No real clinical record.** Diagnosis and treatment are free text inside `post_treatment_records`. There are no visits, structured diagnoses, treatments, allergies, medications or signed and immutable notes.
4. **The payment model fights itself.** `payments.booking_id` is `UNIQUE`, there are running totals on `bookings`, and allocations sit in JSON. That breaks retries, refunds and partial payments.
5. **Auth tables are missing.** There is no sessions or refresh-token table, which the planned cookie login needs, and no password-reset tokens. Staff logins can't be disabled or logged out everywhere.
6. **Security is enforced in code, not in the database.** Clinical data and secrets sit in the same schema as everything else, and Ask Remedist relies on an SQL allowlist. Postgres schemas and grants should do this job.

Everything else in section 4 is polish.

**Scale is not the problem.** One clinic with about 500 patients a month means thousands of rows a year, and Postgres handles millions without effort. "Scalable" here means **easy to change safely**: adding a second doctor, a new role or a new intake question without a rewrite. The recommendations aim at that, not at sharding or replicas.

## 2. What's already right (keep it)

- UUID primary keys, `timestamptz` everywhere, and a shared `set_updated_at()` trigger.
- `CHECK` constraints on status columns, kept in step with `packages/shared` enums. They're easier to change than Postgres `ENUM` types.
- Partial unique indexes: emails are case-insensitive, and there is one active booking per slot.
- The exclusion constraint that stops availability slots overlapping. This is exactly the right tool.
- Prices are snapshots (slot copies session type, booking copies slot), and frozen JSON snapshots are used where a document was *sent* (drip steps, care-plan suggestions).
- "Derive, don't store" for the strike count.
- Audit trails exist for slots, locked patient fields and Ask Remedist.
- Clear comments on every non-obvious column.

## 3. The six main changes

### 3.1 Roles and staff identity

**Problem:** `admin_users.role` holds one value from `owner`, `staff` or `ask_remedist`. You need `super_admin`, `owner`, `doctor` and `staff`, and one person can hold several of these. Staff logins also have no `is_active`, no `token_version`, no MFA and no `updated_at`.

**Recommendation:** keep staff and patient logins in **separate tables**, which is right for health data because the two have different secrets and a different attack surface. Then:

- Make roles many-to-many.
- Have the API check **permissions**, not role names.
- Keep "can log in" (a role) separate from "patients can book with them" (a practitioner profile).

```sql
CREATE TABLE staff_users (                      -- renamed from admin_users
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  email            TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  mfa_secret_enc   TEXT,                         -- encrypted by the app; required for super_admin and owner
  is_active        BOOLEAN NOT NULL DEFAULT true,
  token_version    INTEGER NOT NULL DEFAULT 0,   -- "log out everywhere" for staff too
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_users_email_key ON staff_users (lower(email));

CREATE TABLE roles (
  code        TEXT PRIMARY KEY,                  -- super_admin | owner | doctor | staff | ask_remedist
  name        TEXT NOT NULL,
  description TEXT
);

-- Permission codes are defined in packages/shared (e.g. 'patients.read', 'clinical.write',
-- 'billing.manage', 'settings.manage', 'staff.manage', 'ai.ask'). Seeded from code.
CREATE TABLE role_permissions (
  role_code  TEXT NOT NULL REFERENCES roles (code),
  permission TEXT NOT NULL,
  PRIMARY KEY (role_code, permission)
);

CREATE TABLE staff_user_roles (
  staff_user_id UUID NOT NULL REFERENCES staff_users (id),
  role_code     TEXT NOT NULL REFERENCES roles (code),
  granted_by    UUID REFERENCES staff_users (id),
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_user_id, role_code)
);

-- Someone patients can book with. A doctor is a staff user with the 'doctor' role AND a row here.
CREATE TABLE practitioners (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id       UUID NOT NULL UNIQUE REFERENCES staff_users (id),
  display_name        TEXT NOT NULL,
  title               TEXT,                       -- e.g. "Chiropractor"
  registration_number TEXT,                       -- professional licence, if any
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Suggested default permissions:

| Permission | super_admin | owner | doctor | staff | ask_remedist |
|---|:-:|:-:|:-:|:-:|:-:|
| Patients: view and edit details | ✓ | ✓ | ✓ | ✓ | |
| Clinical records: view | ✓ (logged) | ✓ | ✓ | | |
| Clinical records: write and sign | | | ✓ | | |
| Schedule and bookings | ✓ | ✓ | ✓ | ✓ | |
| Payments and billing | ✓ | ✓ | | ✓ | |
| Content (FAQ, ailments, terms) | ✓ | ✓ | | ✓ | |
| Settings, rate card, integrations | ✓ | ✓ | | | |
| Staff accounts and roles | ✓ | ✓ (not super_admin) | | | |
| Ask Remedist | ✓ | ✓ | ✓ | | ✓ |
| System: migrations, blocklist, security overview | ✓ | | | | |

Rules worth writing into CLAUDE.md:
- `super_admin` can only be granted by seed or CLI, never from the CRM, and requires MFA.
- `super_admin` is a **system** role, for you as the developer. Its access to clinical records is logged (see 3.3). Writing and signing clinical notes stays with doctors only.
- The owner can't remove the last owner, and can't grant `super_admin`.
- Rauzan gets `owner` + `doctor`, with a practitioner row.

### 3.2 The practitioner dimension

Add `practitioner_id` now, even with one doctor:

- `availability_slots.practitioner_id NOT NULL`. The overlap rule becomes **per practitioner**: `EXCLUDE USING gist (practitioner_id WITH =, tstzrange(slot_start, slot_end, '[)') WITH &&)`. Two doctors can then work at the same time.
- `bookings.practitioner_id` (copied from the slot, like the price).
- `encounters.practitioner_id` (3.3).
- `session_types` can stay clinic-wide; add a `practitioner_session_types` link table only if doctors ever offer different services.
- `google_oauth_tokens` and `calendar_sync_state` get a `practitioner_id` when a second doctor has their own calendar. Not needed yet.

### 3.3 The clinical record

This is the core of what you described: "patient records, history, diagnosis, treatments". Today it's:
- `intake_part2`: a wide table of booleans, plus `medical_unknown_json` because a boolean can't say "unknown";
- `post_treatment_records`: diagnosis as free text, plus the plan sent to the patient.

There's no visit record, no structured diagnosis or treatment, no allergy or medication list, no signing, and no record of who viewed what.

**Scope note:** the agreement lists the doctor-facing clinical records interface (diagnosis, treatments, alignments, medications) as **out of scope**, to be added as a change request. Designing the tables now is cheap and avoids a later data migration, but agree the scope with Rauzan before building the screens.

Recommended model (in its own `clinical` Postgres schema, see 3.6):

```sql
-- One visit / session. Created when a booked session starts, or for a walk-in.
CREATE TABLE clinical.encounters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts (id),
  booking_id      UUID UNIQUE REFERENCES bookings (id),     -- NULL for an unbooked walk-in
  practitioner_id UUID NOT NULL REFERENCES practitioners (id),
  encounter_at    TIMESTAMPTZ NOT NULL,
  encounter_type  TEXT NOT NULL CHECK (encounter_type IN ('initial', 'follow_up', 'walk_in', 'probono')),
  chief_complaint TEXT,
  status          TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'signed')),
  signed_at       TIMESTAMPTZ,
  signed_by       UUID REFERENCES staff_users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'signed') = (signed_at IS NOT NULL))
);

-- The doctor's notes (SOAP). Rows are never updated once the encounter is signed:
-- a correction is a new row of note_type 'addendum'. Medical-record integrity.
CREATE TABLE clinical.encounter_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES clinical.encounters (id),
  note_type    TEXT NOT NULL DEFAULT 'soap' CHECK (note_type IN ('soap', 'addendum')),
  subjective   TEXT,
  objective    TEXT,
  assessment   TEXT,
  plan         TEXT,
  author_id    UUID NOT NULL REFERENCES staff_users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The patient's problem list: what they have, across visits.
CREATE TABLE clinical.patient_conditions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     UUID NOT NULL REFERENCES contacts (id),
  description    TEXT NOT NULL,
  code_system    TEXT CHECK (code_system IN ('icd10')),  -- optional coding, later
  code           TEXT,
  body_region_id UUID REFERENCES anatomy_segments (id),
  ailment_id     UUID REFERENCES ailments (id),          -- link to the public ailment, if one matches
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  onset_date     DATE,
  resolved_date  DATE,
  diagnosed_in   UUID REFERENCES clinical.encounters (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What was done in a visit (e.g. a spinal adjustment on the lower back).
CREATE TABLE clinical.treatment_types (       -- staff-editable catalogue
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE clinical.treatments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id      UUID NOT NULL REFERENCES clinical.encounters (id),
  treatment_type_id UUID NOT NULL REFERENCES clinical.treatment_types (id),
  body_region_id    UUID REFERENCES anatomy_segments (id),
  condition_id      UUID REFERENCES clinical.patient_conditions (id),
  details           TEXT,
  performed_by      UUID NOT NULL REFERENCES practitioners (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clinical.patient_allergies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  UUID NOT NULL REFERENCES contacts (id),
  substance   TEXT NOT NULL,
  reaction    TEXT,
  severity    TEXT CHECK (severity IN ('mild', 'moderate', 'severe')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  recorded_by UUID REFERENCES staff_users (id),       -- NULL when patient-reported in intake
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE clinical.patient_medications (       -- what the patient takes (reported), not prescriptions
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts (id),
  name       TEXT NOT NULL,
  dose       TEXT,
  frequency  TEXT,
  started_on DATE,
  stopped_on DATE,
  source     TEXT NOT NULL DEFAULT 'patient_reported' CHECK (source IN ('patient_reported', 'staff_recorded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Files (intake photos, scans, reports). Store the storage key, never a public URL;
-- the API hands out short-lived signed URLs.
CREATE TABLE clinical.attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID NOT NULL REFERENCES contacts (id),
  encounter_id  UUID REFERENCES clinical.encounters (id),
  intake_id     UUID REFERENCES clinical.intake_forms (id),
  kind          TEXT NOT NULL CHECK (kind IN ('posture_front', 'posture_back', 'posture_left', 'posture_right', 'scan', 'report', 'other')),
  storage_key   TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_by   UUID REFERENCES staff_users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who looked at which patient's clinical record. Required for super_admin access and good practice for all.
CREATE TABLE clinical.access_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL REFERENCES staff_users (id),
  contact_id    UUID NOT NULL REFERENCES contacts (id),
  action        TEXT NOT NULL CHECK (action IN ('view', 'edit', 'sign', 'export')),
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX access_log_contact_idx ON clinical.access_log (contact_id, created_at);
```

**Intake questionnaire.** Replace the wide boolean table with versioned answers:

```sql
CREATE TABLE clinical.intake_forms (              -- replaces intake_part2
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id         UUID NOT NULL REFERENCES contacts (id),
  booking_id         UUID UNIQUE REFERENCES bookings (id),
  probono_entry_id   UUID REFERENCES probono_entries (id),
  form_version       INTEGER NOT NULL,             -- matches a question set in packages/shared
  answers            JSONB NOT NULL,               -- {"pacemaker": "yes"|"no"|"unknown", "surgery_last_5y": {...}, ...}
  pain_points        JSONB,
  problem_description TEXT,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'missed_deadline_onsite')),
  completed_at       TIMESTAMPTZ,
  completed_via      TEXT CHECK (completed_via IN ('online', 'walk_in_tablet', 'onsite_manual')),
  reminder_sent_at   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Why: the questions *will* change. With JSONB plus a versioned question set in `packages/shared`:
- a new question is a code change, not a migration;
- answers are three-state (yes, no, unknown), which removes the `medical_unknown_json` workaround;
- old forms keep their meaning because they record which version they were answered against.

The API validates `answers` against that version's schema before saving. Allergies and medications entered in intake are also written to the structured lists above, so the doctor sees one up-to-date list.

`post_treatment_records` becomes the **patient-facing care plan** for an encounter: rename it to `clinical.care_plans` and add `encounter_id`. Its frozen `suggestions_json` stays as it is, because it's a document that was sent. `diagnosis_summary_*` stays as the plain-language summary for the patient, separate from the doctor's notes.

### 3.4 Payments: a proper ledger

**Problems today:**
- `payments.booking_id UNIQUE`. A failed or cancelled PayHere attempt followed by a retry needs a second row, and a refund can't be its own record.
- `bookings.amount_paid` and `discount_amount` are running totals. That contradicts your own "derive, don't store" rule and drifts if any write is missed.
- `payment_ledger_entries.batch_bookings_json` keeps the money-to-booking allocation in JSON, so there are no foreign keys, and "how much was paid towards booking X" needs JSON parsing.
- `contacts.credit_balance` plus `credit_balance_year` is a mutable balance with a yearly reset hack.
- **Money is whole units.** That's fine for LKR, but **USD loses cents**, and PayHere reports amounts with two decimal places. `cost_rate_card` and `lkr_per_usd` use `DOUBLE PRECISION`, which should never hold money.

**Recommendation:** store money as **`BIGINT` minor units** (cents and cents) everywhere, or `NUMERIC(12,2)`. Never use floats. Then:

```sql
-- Money that came in (or was attempted). Any method, many per booking.
CREATE TABLE payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id       UUID NOT NULL REFERENCES contacts (id),
  method           TEXT NOT NULL CHECK (method IN ('payhere', 'cash', 'bank_transfer', 'card_terminal', 'waived')),
  status           TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled', 'refunded')),
  amount_minor     BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency         TEXT NOT NULL CHECK (currency IN ('LKR', 'USD')),
  provider_ref     TEXT UNIQUE,               -- PayHere order id
  provider_payment_id TEXT,
  provider_payload JSONB,                     -- verified notify fields
  received_at      TIMESTAMPTZ,
  recorded_by      UUID REFERENCES staff_users (id),  -- NULL for PayHere
  invoice_number   TEXT UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- How a succeeded payment (or credit) was split across what's owed.
CREATE TABLE payment_allocations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    UUID REFERENCES payments (id),
  credit_txn_id UUID REFERENCES credit_transactions (id),
  booking_id    UUID REFERENCES bookings (id),
  shop_order_id UUID REFERENCES shop_orders (id),
  amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(payment_id, credit_txn_id) = 1),
  CHECK (num_nonnulls(booking_id, shop_order_id) = 1)
);

-- Amounts forgiven by staff. Not money, so not a payment.
CREATE TABLE booking_adjustments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   UUID NOT NULL REFERENCES bookings (id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  reason       TEXT NOT NULL CHECK (reason IN ('discount', 'probono_waiver', 'write_off')),
  created_by   UUID NOT NULL REFERENCES staff_users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client credit as a ledger: balance = SUM(amount_minor). Year-end expiry is a negative 'expired' row.
CREATE TABLE credit_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID NOT NULL REFERENCES contacts (id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
  currency     TEXT NOT NULL CHECK (currency IN ('LKR', 'USD')),
  reason       TEXT NOT NULL CHECK (reason IN ('overpayment', 'applied', 'expired', 'manual')),
  payment_id   UUID REFERENCES payments (id),
  expires_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES staff_users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Amount due** = `rate_charged − SUM(allocations) − SUM(adjustments)`, which is always derived. Wrap it in a view (`booking_balances`) so every screen and Ask Remedist read the same number. Then you can drop:
- `bookings.amount_paid` and `bookings.discount_amount`;
- `payment_ledger_entries`;
- `contacts.credit_balance` and the two `credit_*_year` columns;
- `payments.order_type`.

Pro-bono becomes a booking with a `probono_waiver` adjustment. If you want the $0 audit row kept, use a `waived` payment.

**Shop orders:** replace `items_json` with a `shop_order_items` table (`order_id`, `product_id`, `quantity`, `unit_price_minor`, `product_name`). That keeps the price snapshot *and* the foreign key, so "best-selling product" is a simple query.

### 3.5 Auth: sessions and one-time tokens

The frontend plan uses a short-lived access token plus a **rotating refresh token in an httpOnly cookie**. That needs a table, which isn't in the schema, and password-reset tokens have no home either.

```sql
CREATE TABLE auth_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id      UUID REFERENCES staff_users (id),
  patient_account_id UUID REFERENCES patient_accounts (id),
  refresh_token_hash TEXT NOT NULL UNIQUE,
  replaced_by        UUID REFERENCES auth_sessions (id),  -- rotation chain; reuse of an old token revokes the chain
  user_agent         TEXT,
  ip_address         INET,
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  last_used_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(staff_user_id, patient_account_id) = 1)
);

CREATE TABLE auth_tokens (                       -- email verification, password reset, invites
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose            TEXT NOT NULL CHECK (purpose IN ('email_verify', 'password_reset', 'staff_invite')),
  staff_user_id      UUID REFERENCES staff_users (id),
  patient_account_id UUID REFERENCES patient_accounts (id),
  token_hash         TEXT NOT NULL UNIQUE,
  expires_at         TIMESTAMPTZ NOT NULL,
  used_at            TIMESTAMPTZ,
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(staff_user_id, patient_account_id) = 1)
);
```

Then also:
- Move `verification_code`, `verification_expires` and `verification_attempt_count` off `users` into `auth_tokens`.
- Rename `users` to `patient_accounts`, so "user" isn't ambiguous next to staff.
- Drop `users.name`; the name lives on `contacts`, and two copies drift.

**Dependents:** replace `contacts.dependent_of_user_id` with a link table:

```sql
CREATE TABLE account_dependents (
  patient_account_id UUID NOT NULL REFERENCES patient_accounts (id),
  contact_id         UUID NOT NULL REFERENCES contacts (id),
  relationship       TEXT NOT NULL,              -- child, parent, spouse...
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_account_id, contact_id)
);
```

This allows a parent with several children, and lets a dependent later get their own login without moving any records.

### 3.6 Database-level security: Postgres schemas, roles and grants

Today, everything is in `public`, and Ask Remedist is kept away from secrets by checking SQL text in code (`assertSafeSelect`). A crafted query can get past a text check. A missing `GRANT` stops it.

**Recommendation:** use three Postgres schemas; more adds `search_path` noise without benefit.

| Schema | Holds |
|---|---|
| `public` (or `app`) | contacts, bookings, slots, payments, content, notifications, messaging |
| `clinical` | everything in 3.3 |
| `auth` | staff_users, roles, sessions, tokens, OTP, blocklist, auth_attempts, google_oauth_tokens |

And three database **login roles**:

| Role | Used by | Rights |
|---|---|---|
| `remedist_migrator` | migration runner, on the direct URL | owns all objects; DDL |
| `remedist_app` | the API, on the pooled URL | `SELECT/INSERT/UPDATE` on all three schemas, **no `DELETE`** on clinical tables, no DDL |
| `remedist_ai_readonly` | Ask Remedist | `SELECT` on a small set of **views** in an `ai` schema only, with clinical columns left out or masked |

The views make the AI's data boundary explicit and reviewable. Keep `assertSafeSelect` as a second layer, not the only one.

Also:
- **Encrypt** `google_oauth_tokens` access and refresh tokens and `mfa_secret_enc` in the app, with AES-GCM and a key from env. A database dump shouldn't hand over the clinic's Google account.
- Consider encrypting `contacts.id_number` (NIC or passport), with a separate hash column for the uniqueness check.
- Hard deletes: clinical data is **never** deleted or cascaded. Patients get `archived_at`, and if a patient exercises a deletion right, use a documented anonymisation routine. Check Sri Lanka's Personal Data Protection Act and medical-record retention rules for how long clinical records must be kept.

## 4. Smaller fixes

**Data types and constraints**
- Add `CHECK`s on the columns that are still free text but are really enums: `contacts.stage`, `source`, `residency`; `bookings.residency`; `message_log.status`; `otp_requests.purpose` and `delivery_status`; `ask_remedist_audit.status`; `auth_attempts.purpose`; `notifications.section` and `type`.
- Postgres `DOMAIN`s for values that repeat across tables, defined once: `currency_code`, `message_channel`, `money_minor`.
- `ip_address` should be `INET`, not `TEXT`, in `otp_requests`, `auth_attempts` and `otp_blocklist`.
- `nationality` should be an ISO country code (`CHAR(2)`, e.g. `LK`), not free text. The LKR/USD rule then compares against `'LK'` instead of the string `'Sri Lanka'`.
- Store phone numbers normalised to E.164, with a `CHECK (phone ~ '^\+[1-9][0-9]{6,14}$')`.
- `cost_rate_card` and `clinic_public_contact.lkr_per_usd` should use `NUMERIC`, not `DOUBLE PRECISION`.
- `probono_entries.status` still carries the old values `'waiting'` and `'contacted'`. Remove them if nothing uses them.

**Relationships**
- `bookings.probono_entry_id` and `probono_entries.booking_id` both exist. Keep one direction (the booking points to the entry) so they can't disagree.
- `probono_entries` copies `name` and `phone`, and `contact_id` is optional. Create the contact at submission instead: `contacts` already represents leads. Then `contact_id` becomes `NOT NULL` and the copies go away.
- `ask_remedist_corrections.source_answer_id TEXT` should be a `UUID` foreign key to `ask_remedist_audit(id)`.
- `otp_blocklist.created_by TEXT` should be a foreign key plus a label, like every other `*_by` column.
- `drip_progress.contact_id UNIQUE` means one campaign per contact, ever. Make it `UNIQUE (contact_id, campaign_id)` if a contact could join a second campaign.
- `notifications`: read and dismissed state is shared by all staff. Once a doctor and an owner see different things, add `notification_reads (notification_id, staff_user_id, read_at, dismissed_at)` and a target role on the notification. `entity_id` should be `UUID`.

**Consistency**
- Add `updated_at` and its trigger to `users`, `admin_users`, `probono_entries`, `intake_part2` and `testimonials`.
- You have three audit-table shapes plus `*_by`/`*_by_label` column pairs on many tables. Use one generic `audit_log`:
  - columns: `actor_type`, `actor_id`, `actor_label`, `action`, `entity_type`, `entity_id`, `before`, `after`, `request_id`, `ip`, `created_at`;
  - write it from one repository helper for every staff change;
  - keep `availability_slot_audit` only if its sync-specific actions need their own queries.
- Use the same `completed_via` spelling everywhere: `walk_in_tablet`, not `walk-in-tablet`.

**Indexes**
- Postgres doesn't index foreign keys automatically. Add indexes on:
  - `bookings.slot_id` (the existing unique index covers only active bookings);
  - `bookings.probono_entry_id`;
  - `post_treatment_checkins.contact_id`;
  - `drip_progress.campaign_id`;
  - `assistant_response_ratings.contact_id`.
- Replace low-value single-column `status` indexes with indexes shaped like the queries:
  - `availability_slots (practitioner_id, slot_start) WHERE status = 'open'`;
  - `bookings (contact_id, slot_start DESC)`;
  - `bookings (slot_start) WHERE status IN ('held','confirmed')`.

**Growth**
- `otp_requests`, `auth_attempts`, `message_log`, `claude_usage_log`, `notifications` and the audit tables only grow. Add a nightly retention job (for example, OTP and auth attempts after 90 days) now.
- Consider monthly partitioning for `audit_log` only if it passes a few million rows. That's unlikely for years.

## 5. Should it be multi-clinic (multi-tenant)?

Only if Rauzan or you plan to sell this to other clinics. If so, decide **now**:
- add `clinic_id` to every business table;
- use Postgres Row Level Security keyed on the session's clinic.

Retrofitting tenancy later is the one change that really is a rewrite. If it's one clinic for the foreseeable future, skip it; the practitioner dimension (3.2) already covers more doctors.

## 6. Suggested order

Because `0001`–`0007` aren't committed yet, **edit them in place** rather than adding fix-up migrations. Reset the Neon dev branch after.

1. Roles, staff users, practitioners and auth sessions and tokens (3.1, 3.2, 3.5). The auth module needs these first.
2. Money as minor units and the payment ledger (3.4), before any payment code is written.
3. Postgres schemas and database roles (3.6), while there are few objects to move.
4. Section 4 fixes, as each domain is ported.
5. Clinical tables (3.3): `intake_forms` and `care_plans` now, since they replace existing tables. Add `encounters`, notes, conditions, treatments, allergies, medications and attachments when the clinical records change request is agreed.
