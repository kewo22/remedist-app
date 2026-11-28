import {
  CLINIC_TIME_ZONE,
  clinicDateOf,
  clinicTimeOf,
  selfRescheduleBlock,
  type AdminBooking,
  type PortalBooking,
} from '@remedist/shared';
import type { BookingViewRow } from './bookings.repository';

// Database rows → contract shapes. Timestamps become ISO strings, money text becomes numbers.

function base(row: BookingViewRow): Omit<PortalBooking, 'selfRescheduleUsed' | 'canSelfReschedule'> {
  return {
    id: row.id,
    contactId: row.contact_id,
    contactName: row.contact_name,
    status: row.status,
    bookingType: row.booking_type,
    bookedVia: row.booked_via,
    slotId: row.slot_id,
    practitionerId: row.practitioner_id,
    practitionerName: row.practitioner_name,
    start: row.slot_start.toISOString(),
    end: row.slot_end.toISOString(),
    date: clinicDateOf(row.slot_start),
    startTime: clinicTimeOf(row.slot_start),
    durationMinutes: Math.round((row.slot_end.getTime() - row.slot_start.getTime()) / 60_000),
    originalStart: row.original_slot_start.toISOString(),
    rescheduled: row.original_slot_start.getTime() !== row.slot_start.getTime(),
    appointmentCode: row.appointment_code,
    price: { amountMinor: Number(row.rate_charged_minor), currency: row.currency },
    paymentMode: row.payment_mode,
    dueMinor: Number(row.due_minor ?? row.rate_charged_minor),
    holdExpiresAt: row.hold_expires_at?.toISOString() ?? null,
    notes: row.notes,
    intakeFormId: row.intake_form_id,
    intakeStatus: row.intake_status,
    createdAt: row.created_at.toISOString(),
  };
}

export function toPortalBooking(row: BookingViewRow, now: Date = new Date()): PortalBooking {
  const selfRescheduleUsed = row.self_reschedule_used_at !== null;
  return {
    ...base(row),
    // A held booking isn't confirmed yet, so it can't be rescheduled; its hold is shown instead.
    holdExpiresAt: row.status === 'held' ? (row.hold_expires_at?.toISOString() ?? null) : null,
    selfRescheduleUsed,
    canSelfReschedule:
      selfRescheduleBlock({ status: row.status, start: row.slot_start, selfRescheduleUsed }, now) === undefined,
  };
}

export function toAdminBooking(row: BookingViewRow): AdminBooking {
  return {
    ...base(row),
    holdExpiresAt: row.status === 'held' ? (row.hold_expires_at?.toISOString() ?? null) : null,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    registrationNumber: row.registration_number,
    staffNotes: row.staff_notes,
    selfRescheduleUsed: row.self_reschedule_used_at !== null,
  };
}

/** "2 Dec, 10:00", clinic time, for notification messages. */
export function describeSession(start: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: CLINIC_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(start);
}
