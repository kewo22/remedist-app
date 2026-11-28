// Appointments: booking a slot (held for checkout, or confirmed straight away), rescheduling,
// cancelling, no-shows, walk-ins and staff notes. Instants are ISO 8601; money is integer minor
// units; dates in queries are clinic-local "YYYY-MM-DD".

import type { Currency } from '../rules/pricing';
import type { IntakeStatus } from './intake';

// ── Routes ─────────────────────────────────────────────────────────────────────────────────

export const PORTAL_BOOKING_ROUTES = {
  /**
   * GET ?contactId= → PortalBooking[] for one profile, newest first.
   * POST CreateBookingRequest → PortalBooking (201): held for HOLD_MINUTES for checkout, or
   * confirmed straight away when paying after the session.
   */
  bookings: '/portal/bookings',
  /** GET → PortalBooking[]: past sessions of the account holder and every dependent, newest first. */
  history: '/portal/bookings/history',
  /** GET → PortalBooking. */
  booking: '/portal/bookings/:bookingId',
  /** POST RescheduleRequest → PortalBooking. The client's one self-service reschedule. */
  reschedule: '/portal/bookings/:bookingId/reschedule',
  /** POST → PortalBooking (201). The walk-in kiosk: today's next open slot, confirmed now. Self only. */
  walkIn: '/portal/walk-in',
} as const;

/** CRM. Everything needs schedule.manage. */
export const ADMIN_BOOKING_ROUTES = {
  /** GET AdminBookingQuery → AdminBooking[] with AdminBookingListMeta. POST StaffCreateBookingRequest → AdminBooking (201). */
  bookings: '/admin/bookings',
  /** GET → AdminBookingDetail. */
  booking: '/admin/bookings/:bookingId',
  /** POST RescheduleRequest → AdminBookingDetail. No time-window rules (the manual override). */
  reschedule: '/admin/bookings/:bookingId/reschedule',
  /** POST CancelBookingRequest → AdminBookingDetail. */
  cancel: '/admin/bookings/:bookingId/cancel',
  /** POST → AdminBookingDetail. A confirmed session that has started. */
  noShow: '/admin/bookings/:bookingId/no-show',
  /** PATCH UpdateStaffNotesRequest → AdminBookingDetail. Never touches the client's own notes. */
  notes: '/admin/bookings/:bookingId/notes',
} as const;

export const BOOKING_STATUSES = ['held', 'confirmed', 'cancelled', 'no_show'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_TYPES = ['paid', 'probono'] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

/** Who made it: the client online, staff in the CRM, or the walk-in kiosk. */
export const BOOKED_VIA = ['online', 'staff', 'walk_in'] as const;
export type BookedVia = (typeof BOOKED_VIA)[number];

export const PAYMENT_MODES = ['upfront', 'pay_after'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

// ── Requests ───────────────────────────────────────────────────────────────────────────────

/**
 * Needs Part 1 (PART1_INCOMPLETE), the current terms accepted (TERMS_REACCEPT_REQUIRED) and no
 * pay-after session overdue by OVERDUE_LOCKOUT_DAYS (PAYMENT_OVERDUE_LOCKOUT); all 428. The slot
 * must be open and at least PUBLIC_BOOKING_CUTOFF_HOURS away (SLOT_UNAVAILABLE, 409). The price
 * comes from the profile's nationality, never from the request.
 */
export interface CreateBookingRequest {
  /** A dependent's contact id; omit for the account holder. */
  contactId?: string;
  slotId: string;
  /** The client's own words for the clinic. */
  notes?: string | null;
  /** 'pay_after' only counts when the clinic has enabled it for this client; otherwise upfront. */
  paymentChoice?: PaymentMode;
}

export interface RescheduleRequest {
  slotId: string;
}

/**
 * Staff booking: confirmed at once, as the client's payment setting says. 409
 * OVERDUE_LOCKOUT_WARNING when the client is locked out online, unless overrideLockoutWarning.
 */
export interface StaffCreateBookingRequest {
  contactId: string;
  slotId: string;
  /** Saved as staff notes (the client's own notes field is only for the client). */
  staffNotes?: string | null;
  overrideLockoutWarning?: boolean;
}

export interface CancelBookingRequest {
  /** Why, for the history. */
  reason?: string | null;
}

export interface UpdateStaffNotesRequest {
  /** Null or empty clears them. */
  staffNotes: string | null;
}

export interface AdminBookingQuery {
  /** Session dates, clinic-local, inclusive. Give both or neither (default: no date filter). */
  from?: string;
  to?: string;
  status?: BookingStatus;
  contactId?: string;
  /** 1-based; default 1. */
  page?: number;
  /** Default 50, at most BOOKING_LIST_MAX_PAGE_SIZE. */
  pageSize?: number;
}

export const BOOKING_LIST_MAX_PAGE_SIZE = 200;

export interface AdminBookingListMeta {
  page: number;
  pageSize: number;
  total: number;
}

// ── Responses ──────────────────────────────────────────────────────────────────────────────

export interface BookingPrice {
  amountMinor: number;
  currency: Currency;
}

interface BookingBase {
  id: string;
  contactId: string;
  contactName: string;
  status: BookingStatus;
  bookingType: BookingType;
  bookedVia: BookedVia;
  slotId: string;
  practitionerId: string;
  practitionerName: string;
  start: string;
  end: string;
  /** Clinic-local, for labels. */
  date: string;
  startTime: string;
  durationMinutes: number;
  /** The session date the booking was first made for; the 30-day reschedule window counts from it. */
  originalStart: string;
  /** True once the session has been moved. */
  rescheduled: boolean;
  appointmentCode: string | null;
  /** Fixed when booked (and on a reschedule) from the slot and the profile's nationality. */
  price: BookingPrice;
  paymentMode: PaymentMode;
  /** What's still owed for the session (after payments and adjustments). */
  dueMinor: number;
  /** Set while held for checkout. */
  holdExpiresAt: string | null;
  /** The client's own notes. */
  notes: string | null;
  intakeFormId: string | null;
  intakeStatus: IntakeStatus | null;
  createdAt: string;
}

export interface PortalBooking extends BookingBase {
  /** The one self-service reschedule has been used. */
  selfRescheduleUsed: boolean;
  /** Whether the client can reschedule online now (confirmed, unused, more than 24 hours away). */
  canSelfReschedule: boolean;
}

export interface AdminBooking extends BookingBase {
  contactEmail: string | null;
  contactPhone: string | null;
  registrationNumber: string | null;
  staffNotes: string | null;
  selfRescheduleUsed: boolean;
}

export interface AppointmentCodeEntry {
  code: string;
  createdAt: string;
  /** Null for the current code. */
  supersededAt: string | null;
}

export interface AdminBookingDetail extends AdminBooking {
  /** Every code the booking has had, newest first. */
  appointmentCodes: AppointmentCodeEntry[];
  /** The client's strike count (no-shows and late cancellations), always counted. */
  contactStrikeCount: number;
  contactPayAfterSession: boolean;
}
