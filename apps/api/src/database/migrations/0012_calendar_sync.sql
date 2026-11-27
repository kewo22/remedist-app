-- Google Calendar sync: each slot keeps its own event for its whole life (google_event_id), and a
-- private Google event that blocks a slot is recorded separately, so blocking never overwrites the
-- slot's own event (the old app lost the link that way).

-- True while the slot's own calendar event may not match the slot yet: set by every slot change,
-- cleared once the event is updated. The 5-minute job retries pending slots, and the sync back from
-- Google never overrides a pending slot with its (stale) event.
ALTER TABLE availability_slots ADD COLUMN calendar_sync_pending BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX availability_slots_calendar_pending_idx ON availability_slots (slot_start) WHERE calendar_sync_pending;

-- The private Google event that blocked this slot, if any. Cleared when the slot is unblocked.
ALTER TABLE availability_slots ADD COLUMN blocked_by_google_event_id TEXT;
ALTER TABLE availability_slots ADD CONSTRAINT availability_slots_blocked_by_event_check
  CHECK (blocked_by_google_event_id IS NULL OR status = 'blocked');
CREATE INDEX availability_slots_blocked_by_event_idx ON availability_slots (blocked_by_google_event_id)
  WHERE blocked_by_google_event_id IS NOT NULL;

-- google_event_id is now only the slot's own event, one per slot.
DROP INDEX availability_slots_google_event_id_idx;
CREATE UNIQUE INDEX availability_slots_google_event_id_key ON availability_slots (google_event_id)
  WHERE google_event_id IS NOT NULL;
