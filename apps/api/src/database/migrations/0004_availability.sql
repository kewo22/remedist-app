-- Availability: session types and bookable slots, per practitioner.
-- availability_slots is the only source of what's bookable. Changes are recorded in audit_log.

-- A kind of session: name, length and per-currency price. Clinic-wide. A slot copies these when
-- it's created and never reads them back. Retired types are deactivated, never deleted.
CREATE TABLE session_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  rate_lkr_minor   money_minor,
  rate_usd_minor   money_minor,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (rate_lkr_minor IS NOT NULL OR rate_usd_minor IS NOT NULL)
);
CREATE UNIQUE INDEX session_types_name_key ON session_types (lower(name));
CREATE TRIGGER session_types_updated_at BEFORE UPDATE ON session_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE availability_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practitioner_id UUID NOT NULL REFERENCES practitioners (id),
  slot_start      TIMESTAMPTZ NOT NULL,
  slot_end        TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'blocked', 'booked', 'deleted')),
  -- One price per currency; the booker's nationality picks which applies (rateForResidency).
  -- A slot priced in only one currency charges that price to everyone.
  rate_lkr_minor  money_minor,
  rate_usd_minor  money_minor,
  -- The session type the slot was opened as. NULL for the ad-hoc walk-in slot.
  session_type_id UUID REFERENCES session_types (id),
  block_reason    TEXT,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'google', 'walk_in')),
  -- One Google Calendar event per slot for its whole life, patched in place.
  google_event_id TEXT,
  -- Set when a booked slot's event is changed in Google directly; inbound sync never edits a
  -- booked slot. Cleared only by a person ("Acknowledge").
  flagged_for_review BOOLEAN NOT NULL DEFAULT false,
  flag_reason        TEXT,
  -- Dedupes the one-time "eligible for pro-bono reassignment" notification. Eligibility itself
  -- is always derived (open and inside the 24-hour cutoff).
  probono_reclaim_notified_at TIMESTAMPTZ,
  -- NULL when the walk-in kiosk or Google sync created it (audit_log says which).
  created_by      UUID REFERENCES auth.staff_users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (slot_end > slot_start),
  CHECK (rate_lkr_minor IS NOT NULL OR rate_usd_minor IS NOT NULL),
  CHECK (flagged_for_review OR flag_reason IS NULL)
);
-- A practitioner's active slots may not overlap; two practitioners can work at the same time.
-- Deleted slots are excluded so cleanup can retire overlaps.
ALTER TABLE availability_slots
  ADD CONSTRAINT availability_slots_no_overlap
  EXCLUDE USING gist (practitioner_id WITH =, tstzrange(slot_start, slot_end, '[)') WITH &&)
  WHERE (status IN ('open', 'blocked', 'booked'));
-- The public slot list: open slots for a practitioner from a time onwards.
CREATE INDEX availability_slots_open_idx ON availability_slots (practitioner_id, slot_start) WHERE status = 'open';
CREATE INDEX availability_slots_slot_start_idx ON availability_slots (slot_start);
-- Not unique: one foreign Google event can block more than one open slot.
CREATE INDEX availability_slots_google_event_id_idx ON availability_slots (google_event_id) WHERE google_event_id IS NOT NULL;
CREATE INDEX availability_slots_flagged_idx ON availability_slots (slot_start) WHERE flagged_for_review;
CREATE INDEX availability_slots_session_type_id_idx ON availability_slots (session_type_id);
CREATE INDEX availability_slots_created_by_idx ON availability_slots (created_by);
CREATE TRIGGER availability_slots_updated_at BEFORE UPDATE ON availability_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
