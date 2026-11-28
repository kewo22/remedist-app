-- How a booking was made. booking_type says paid or pro-bono; this says who made it: the client
-- online, staff in the CRM, or the walk-in kiosk (the old app's 'walkin' booking type). A walk-in's
-- Part 2 is completed on the clinic tablet.
ALTER TABLE bookings ADD COLUMN booked_via TEXT NOT NULL DEFAULT 'online'
  CHECK (booked_via IN ('online', 'staff', 'walk_in'));

-- The CRM bookings list filters by status and session time.
CREATE INDEX bookings_status_slot_start_idx ON bookings (status, slot_start);
