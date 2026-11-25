-- Public content (anatomy reference list, ailments, FAQs, testimonials, lifestyle suggestions)
-- and the AI assistant tables.

-- Fixed anatomy reference list: the single source of body-region terms for the ailments CRM, the
-- pain-point diagram and (later) structured conditions and treatments. Not editable in the CRM,
-- so it's loaded here rather than seeded.
CREATE TABLE anatomy_segments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT NOT NULL CHECK (category IN ('head', 'frontside', 'backside', 'side')),
  name          TEXT NOT NULL UNIQUE,
  display_order INTEGER NOT NULL,
  UNIQUE (category, display_order)
);

INSERT INTO anatomy_segments (category, name, display_order) VALUES
  ('head', 'Top of the Head', 1), ('head', 'Forehead', 2), ('head', 'Sinus', 3),
  ('head', 'Jaws', 4), ('head', 'Ears', 5),
  ('frontside', 'Wrist', 1), ('frontside', 'Arm', 2), ('frontside', 'Upper Arm', 3),
  ('frontside', 'Shoulder', 4), ('frontside', 'Chest', 5), ('frontside', 'Diaphragm', 6),
  ('frontside', 'Stomach', 7), ('frontside', 'Pubic Area', 8), ('frontside', 'Thighs', 9),
  ('frontside', 'Knee', 10), ('frontside', 'Shin', 11), ('frontside', 'Ankle', 12),
  ('frontside', 'Foot', 13),
  -- Neck leads the backside list, as in the old app.
  ('backside', 'Neck', 1), ('backside', 'Elbow', 2), ('backside', 'Upper Back', 3),
  ('backside', 'Shoulder Blade', 4), ('backside', 'Lower Back', 5), ('backside', 'Glutes', 6),
  ('backside', 'Hams', 7), ('backside', 'Calf', 8), ('backside', 'Heel', 9),
  ('side', 'IT Band', 1), ('side', 'Hips', 2);

-- Ailments shown on the public site; live as soon as staff save them.
CREATE TABLE ailments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  description        TEXT NOT NULL,
  treatment_approach TEXT,          -- optional; hidden on the public page when blank
  average_sessions   TEXT NOT NULL, -- free text, e.g. "6-8 sessions (roughly 9-12 hours) over 4-6 weeks"
  display_order      INTEGER NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ailments_name_key ON ailments (lower(name));
CREATE INDEX ailments_display_order_idx ON ailments (display_order);
CREATE TRIGGER ailments_updated_at BEFORE UPDATE ON ailments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE ailment_segments (
  ailment_id UUID NOT NULL REFERENCES ailments (id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES anatomy_segments (id),
  PRIMARY KEY (ailment_id, segment_id)
);
CREATE INDEX ailment_segments_segment_id_idx ON ailment_segments (segment_id);

-- FAQ / assistant knowledge, authored by staff, live on save. proactively_highlight lets the
-- assistant surface an entry (for example pro-bono help) without being asked.
CREATE TABLE faq_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question              TEXT NOT NULL,
  answer                TEXT NOT NULL,
  proactively_highlight BOOLEAN NOT NULL DEFAULT false,
  display_order         INTEGER NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX faq_entries_question_key ON faq_entries (lower(question));
CREATE INDEX faq_entries_display_order_idx ON faq_entries (display_order);
CREATE TRIGGER faq_entries_updated_at BEFORE UPDATE ON faq_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Client testimonials, shown publicly once approved.
CREATE TABLE testimonials (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts (id),
  name       TEXT NOT NULL,
  role       TEXT,
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX testimonials_status_idx ON testimonials (status, created_at);
CREATE INDEX testimonials_contact_id_idx ON testimonials (contact_id);
CREATE TRIGGER testimonials_updated_at BEFORE UPDATE ON testimonials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The exercise and habit library doctors pick from for care plans. Metric columns are template
-- defaults; only the ones relevant to the category are used.
CREATE TABLE lifestyle_suggestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
                    'strengthening_exercise', 'stretching_exercise', 'food_beverage_habit', 'other_lifestyle_habit')),
  hold_seconds    INTEGER CHECK (hold_seconds >= 0), -- exercises
  reps            INTEGER CHECK (reps >= 0),         -- exercises
  sets            INTEGER CHECK (sets >= 0),         -- exercises
  quantity        TEXT,                              -- habits
  unit            TEXT,                              -- habits
  frequency       TEXT,                              -- food_beverage_habit
  note            TEXT,                              -- other_lifestyle_habit
  demo_link       TEXT,
  ai_instructions TEXT,                              -- exercises: AI-drafted, staff-reviewed
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER lifestyle_suggestions_updated_at BEFORE UPDATE ON lifestyle_suggestions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Public assistant: the only thing ever stored is a rated question-and-answer pair, never a
-- transcript. contact_id is NULL for anonymous visitors.
CREATE TABLE assistant_response_ratings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  rating     TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  contact_id UUID REFERENCES contacts (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_response_ratings_created_at_idx ON assistant_response_ratings (created_at);
CREATE INDEX assistant_response_ratings_contact_id_idx ON assistant_response_ratings (contact_id);

-- One row per Claude API call, written by the single service every call goes through. Feeds the
-- cost estimates.
CREATE TABLE claude_usage_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model         TEXT NOT NULL,
  feature       TEXT NOT NULL CHECK (feature IN ('public_assistant', 'ask_remedist', 'drafting', 'other')),
  input_tokens  INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX claude_usage_log_created_at_idx ON claude_usage_log (created_at, feature);

-- Ask Remedist: every question, who asked and when. is_clinical hides the answer from other users.
CREATE TABLE ask_remedist_audit (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asked_by       UUID NOT NULL REFERENCES auth.staff_users (id),
  question       TEXT NOT NULL,
  answer         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN (
                   'answer', 'clarify', 'declined_clinical', 'non_english', 'unavailable', 'error')),
  is_clinical    BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ask_remedist_audit_created_at_idx ON ask_remedist_audit (created_at);
CREATE INDEX ask_remedist_audit_asked_by_idx ON ask_remedist_audit (asked_by, created_at);

-- Ask Remedist: answers staff flagged as wrong, reused as reference for related questions.
CREATE TABLE ask_remedist_corrections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_answer_id UUID REFERENCES ask_remedist_audit (id),
  question         TEXT NOT NULL,
  answer           TEXT NOT NULL,
  correction_note  TEXT,
  flagged_by       UUID NOT NULL REFERENCES auth.staff_users (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ask_remedist_corrections_created_at_idx ON ask_remedist_corrections (created_at);
CREATE INDEX ask_remedist_corrections_source_answer_id_idx ON ask_remedist_corrections (source_answer_id);
CREATE INDEX ask_remedist_corrections_flagged_by_idx ON ask_remedist_corrections (flagged_by);
