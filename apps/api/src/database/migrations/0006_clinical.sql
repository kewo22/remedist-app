-- Clinical data, in its own schema: the API may not DELETE here (see 0001), and Ask Remedist
-- never sees it directly. Clinical text must never be logged.
--
-- Built now: intake forms, attachments, care plans and their check-ins, and the access log.
-- Deferred to the clinical records change request: encounters, SOAP notes, conditions,
-- treatments, allergies and medications (design in docs/database-review-2026-11-25.md §3.3).
-- When encounters arrive, care_plans and attachments gain an encounter_id.

-- Part 2 intake, one per visit. answers follow a versioned question set in packages/shared
-- (form_version), validated by the API before saving: a new question is a code change, answers
-- are three-state ("yes" | "no" | "unknown"), and old forms keep their meaning.
-- A pro-bono applicant fills it in before any booking exists (probono_entry_id).
CREATE TABLE clinical.intake_forms (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID NOT NULL REFERENCES contacts (id),
  booking_id          UUID UNIQUE REFERENCES bookings (id),
  probono_entry_id    UUID REFERENCES probono_entries (id),
  form_version        INTEGER NOT NULL CHECK (form_version >= 1),
  answers             JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  pain_points         JSONB,
  problem_description TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'missed_deadline_onsite')),
  completed_at        TIMESTAMPTZ,
  completed_via       TEXT CHECK (completed_via IN ('online', 'walk_in_tablet', 'onsite_manual')),
  reminder_sent_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (booking_id IS NOT NULL OR probono_entry_id IS NOT NULL),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL AND completed_via IS NOT NULL))
);
CREATE INDEX intake_forms_contact_id_idx ON clinical.intake_forms (contact_id, created_at);
CREATE INDEX intake_forms_probono_entry_id_idx ON clinical.intake_forms (probono_entry_id);
CREATE TRIGGER intake_forms_updated_at BEFORE UPDATE ON clinical.intake_forms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Files: intake posture photos, scans, reports. Stores the storage key, never a public URL;
-- the API hands out short-lived signed URLs.
CREATE TABLE clinical.attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   UUID NOT NULL REFERENCES contacts (id),
  intake_id    UUID REFERENCES clinical.intake_forms (id),
  kind         TEXT NOT NULL CHECK (kind IN (
                 'posture_front', 'posture_back', 'posture_left', 'posture_right', 'scan', 'report', 'other')),
  storage_key  TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0),
  uploaded_by  UUID REFERENCES auth.staff_users (id), -- NULL when the patient uploaded it
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachments_contact_id_idx ON clinical.attachments (contact_id, created_at);
CREATE INDEX attachments_intake_id_idx ON clinical.attachments (intake_id);
CREATE INDEX attachments_uploaded_by_idx ON clinical.attachments (uploaded_by);
-- One photo per posture per intake.
CREATE UNIQUE INDEX attachments_intake_posture_key ON clinical.attachments (intake_id, kind)
  WHERE intake_id IS NOT NULL AND kind LIKE 'posture_%';

-- The patient-facing care plan sent after a session (was post_treatment_records).
-- diagnosis_summary_* is the plain-language summary for the patient, separate from the doctor's
-- notes. suggestions is a frozen snapshot of the chosen lifestyle suggestions, because it's a
-- document that was sent. status goes draft -> sent exactly once.
CREATE TABLE clinical.care_plans (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id                UUID NOT NULL UNIQUE REFERENCES bookings (id),
  contact_id                UUID NOT NULL REFERENCES contacts (id),
  practitioner_id           UUID NOT NULL REFERENCES practitioners (id),
  diagnosis_summary_raw     TEXT,
  diagnosis_summary_final   TEXT,
  diagnosis_summary_ai_used BOOLEAN NOT NULL DEFAULT false,
  pain_score                INTEGER CHECK (pain_score BETWEEN 0 AND 10),
  suggestions               JSONB,
  status                    TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  -- Dedupes the end-of-day "form still incomplete" notification.
  incomplete_notified_at    TIMESTAMPTZ,
  sent_at                   TIMESTAMPTZ,
  message_channel           TEXT CHECK (message_channel IN ('whatsapp', 'sms', 'email', 'none')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX care_plans_contact_id_idx ON clinical.care_plans (contact_id, created_at);
CREATE INDEX care_plans_practitioner_id_idx ON clinical.care_plans (practitioner_id);
CREATE TRIGGER care_plans_updated_at BEFORE UPDATE ON clinical.care_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The 24-hours-after check-in for a sent care plan. phone is snapshotted at send time because an
-- inbound Twilio reply carries only the sender's number.
CREATE TABLE clinical.care_plan_checkins (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  care_plan_id      UUID NOT NULL UNIQUE REFERENCES clinical.care_plans (id),
  contact_id        UUID NOT NULL REFERENCES contacts (id),
  phone             phone_e164,
  sent_at           TIMESTAMPTZ,
  message_channel   message_channel,
  reply_received_at TIMESTAMPTZ,
  reply_raw         TEXT,
  reply_parsed      TEXT CHECK (reply_parsed IN ('great', 'same', 'worse', 'unmatched')),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'replied')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'replied') = (reply_received_at IS NOT NULL))
);
CREATE INDEX care_plan_checkins_phone_idx ON clinical.care_plan_checkins (phone) WHERE status = 'pending';
CREATE INDEX care_plan_checkins_contact_id_idx ON clinical.care_plan_checkins (contact_id);
CREATE TRIGGER care_plan_checkins_updated_at BEFORE UPDATE ON clinical.care_plan_checkins
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Who looked at or changed which patient's clinical record. Written for every clinical read and
-- write; required for super_admin access.
CREATE TABLE clinical.access_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL REFERENCES auth.staff_users (id),
  contact_id    UUID NOT NULL REFERENCES contacts (id),
  action        TEXT NOT NULL CHECK (action IN ('view', 'edit', 'sign', 'export')),
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  request_id    TEXT,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX access_log_contact_id_idx ON clinical.access_log (contact_id, created_at);
CREATE INDEX access_log_staff_user_id_idx ON clinical.access_log (staff_user_id, created_at);

-- Not even the app may change or remove an access log row once written.
REVOKE UPDATE ON clinical.access_log FROM remedist_app;
