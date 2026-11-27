// Availability: session types and bookable slots. availability_slots is the only source of what
// can be booked. Each slot belongs to a practitioner; one practitioner's slots never overlap.
//
// Dates are clinic-local "YYYY-MM-DD" and times "HH:MM" (CLINIC_TIME_ZONE); instants are ISO 8601.
// Money is integer minor units (LKR 45,000.00 is 4500000). In update requests an omitted field keeps
// its value.

// ── Routes ─────────────────────────────────────────────────────────────────────────────────

export const PUBLIC_AVAILABILITY_ROUTES = {
  /**
   * GET ?date=YYYY-MM-DD[&practitionerId=] → PublicSlotDay. Open slots that day, leaving out any
   * starting within PUBLIC_BOOKING_CUTOFF_HOURS.
   */
  slots: '/public/availability/slots',
  /**
   * GET ?from=&to=[&practitionerId=] → PublicAvailableDates. The days that have a bookable slot, for
   * the date picker. At most PUBLIC_DATES_MAX_RANGE_DAYS.
   */
  dates: '/public/availability/dates',
} as const;

/** CRM. Everything needs schedule.manage. */
export const ADMIN_AVAILABILITY_ROUTES = {
  /** GET AdminSlotQuery → AdminSlot[]. POST CreateSlotRequest → AdminSlot (201). */
  slots: '/admin/availability/slots',
  /** PATCH UpdateSlotRequest → AdminSlot. DELETE → null (open or blocked slots only). */
  slot: '/admin/availability/slots/:slotId',
  /** POST BlockSlotRequest → AdminSlot. Open slots only. */
  block: '/admin/availability/slots/:slotId/block',
  /** POST → AdminSlot. Blocked slots only. */
  unblock: '/admin/availability/slots/:slotId/unblock',
  /** POST → AdminSlot. Clears a Google Calendar conflict flag after staff have reviewed it. */
  acknowledgeFlag: '/admin/availability/slots/:slotId/acknowledge-flag',
  /** GET SlotHistoryQuery → SlotHistoryEntry[], newest first. */
  history: '/admin/availability/history',
  /** GET → PractitionerSummary[]: who slots can be opened for. */
  practitioners: '/admin/availability/practitioners',
  /** GET ?includeRetired=true → SessionType[]. POST CreateSessionTypeRequest → SessionType (201). */
  sessionTypes: '/admin/session-types',
  /** PATCH UpdateSessionTypeRequest → SessionType. Slots already opened keep their own copy. */
  sessionType: '/admin/session-types/:sessionTypeId',
  /** POST → SessionType. LAST_SESSION_TYPE when it's the only active one. */
  retireSessionType: '/admin/session-types/:sessionTypeId/retire',
  /** POST → SessionType. */
  restoreSessionType: '/admin/session-types/:sessionTypeId/restore',
} as const;

/** The CRM calendar loads at most this many days at once (as the old app). */
export const ADMIN_SLOTS_MAX_RANGE_DAYS = 31;
/** The public date picker asks for at most this many days at once. */
export const PUBLIC_DATES_MAX_RANGE_DAYS = 62;
/** Slot history entries returned when no limit is given, and the most allowed. */
export const SLOT_HISTORY_DEFAULT_LIMIT = 100;
export const SLOT_HISTORY_MAX_LIMIT = 500;

export const SLOT_STATUSES = ['open', 'blocked', 'booked', 'deleted'] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

/** manual: opened in the CRM. google: blocked by a Google Calendar event. walk_in: made by the kiosk. */
export const SLOT_SOURCES = ['manual', 'google', 'walk_in'] as const;
export type SlotSource = (typeof SLOT_SOURCES)[number];

// ── Public ─────────────────────────────────────────────────────────────────────────────────

/**
 * A bookable slot. Both prices are given because the visitor's nationality isn't known before
 * sign-in: show the one rateForResidency picks once it is, or the base price with a note.
 */
export interface PublicSlot {
  id: string;
  practitionerId: string;
  practitionerName: string;
  start: string;
  end: string;
  /** Clinic-local "HH:MM" of the start, for labels. */
  startTime: string;
  durationMinutes: number;
  rateLkrMinor: number | null;
  rateUsdMinor: number | null;
}

export interface PublicSlotDay {
  date: string;
  slots: PublicSlot[];
}

export interface PublicAvailableDates {
  /** Clinic-local dates with at least one bookable slot, ascending. */
  dates: string[];
}

// ── Session types ──────────────────────────────────────────────────────────────────────────

/** A kind of session a slot is opened as: its length and a price per currency (at least one). */
export interface SessionType {
  id: string;
  name: string;
  durationMinutes: number;
  rateLkrMinor: number | null;
  rateUsdMinor: number | null;
  /** False once retired: hidden when opening slots, kept for the slots already opened as it. */
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Duration MIN_SESSION_MINUTES–MAX_SESSION_MINUTES; names are unique (any case). */
export interface CreateSessionTypeRequest {
  name: string;
  durationMinutes: number;
  rateLkrMinor: number | null;
  rateUsdMinor: number | null;
}

export type UpdateSessionTypeRequest = Partial<CreateSessionTypeRequest>;

// ── Slots in the CRM ───────────────────────────────────────────────────────────────────────

export interface PractitionerSummary {
  id: string;
  displayName: string;
  title: string | null;
}

/** The held or confirmed booking on a booked slot. */
export interface SlotBooking {
  bookingId: string;
  status: 'held' | 'confirmed';
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface AdminSlot {
  id: string;
  practitionerId: string;
  practitionerName: string;
  start: string;
  end: string;
  /** Clinic-local date and start time, as staff entered them. */
  date: string;
  startTime: string;
  durationMinutes: number;
  status: SlotStatus;
  source: SlotSource;
  rateLkrMinor: number | null;
  rateUsdMinor: number | null;
  sessionTypeId: string | null;
  sessionTypeName: string | null;
  blockReason: string | null;
  /** A Google Calendar change on a booked slot that staff need to review. */
  flaggedForReview: boolean;
  flagReason: string | null;
  booking: SlotBooking | null;
  createdAt: string;
  updatedAt: string;
}

/** Clinic-local dates, inclusive; at most ADMIN_SLOTS_MAX_RANGE_DAYS. Default: this week, Sunday to Saturday. */
export interface AdminSlotQuery {
  from?: string;
  to?: string;
  practitionerId?: string;
}

/**
 * Opens a slot as a session type: its length and both prices are copied from the type and never
 * read back. `practitionerId` may be omitted while only one practitioner is active. A slot can't
 * start in the past; SLOT_OVERLAP if it overlaps one of that practitioner's other slots.
 */
export interface CreateSlotRequest {
  practitionerId?: string;
  date: string;
  startTime: string;
  sessionTypeId: string;
}

/**
 * Edits an open or blocked slot. `date` and `startTime` move it (give both). A new `sessionTypeId`
 * copies that type's length and prices; `durationMinutes` and the rates override them for this slot
 * only (null clears a currency, but one must remain).
 */
export interface UpdateSlotRequest {
  date?: string;
  startTime?: string;
  sessionTypeId?: string;
  durationMinutes?: number;
  rateLkrMinor?: number | null;
  rateUsdMinor?: number | null;
}

export interface BlockSlotRequest {
  reason?: string | null;
}

export interface SlotHistoryQuery {
  slotId?: string;
  /** 1–SLOT_HISTORY_MAX_LIMIT; default SLOT_HISTORY_DEFAULT_LIMIT. */
  limit?: number;
}

export const SLOT_HISTORY_ACTIONS = [
  'slot.created',
  'slot.updated',
  'slot.blocked',
  'slot.unblocked',
  'slot.deleted',
  'slot.flag_cleared',
] as const;

/** The slot's fields before and after a change. */
export interface SlotSnapshot {
  practitionerId: string;
  start: string;
  end: string;
  status: SlotStatus;
  rateLkrMinor: number | null;
  rateUsdMinor: number | null;
  sessionTypeId: string | null;
  blockReason: string | null;
}

export interface SlotHistoryEntry {
  id: string;
  slotId: string;
  /** One of SLOT_HISTORY_ACTIONS, or another 'slot.*' action written by booking or calendar sync. */
  action: string;
  actorType: 'staff' | 'patient' | 'system' | 'integration';
  actorLabel: string;
  before: SlotSnapshot | null;
  after: SlotSnapshot | null;
  note: string | null;
  createdAt: string;
}
