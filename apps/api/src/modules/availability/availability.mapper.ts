import {
  clinicDateOf,
  clinicTimeOf,
  type AdminSlot,
  type PractitionerSummary,
  type PublicSlot,
  type SessionType,
  type SlotHistoryEntry,
  type SlotSnapshot,
} from '@remedist/shared';
import type { AuditRow } from '../../common/audit/audit-log.repository';
import type { AdminSlotRow, PractitionerRow, PublicSlotRow, SessionTypeRow, SlotRow } from './availability.repository';

// Database rows → contract shapes. Timestamps become ISO strings, money_minor text becomes numbers.

export function minor(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function toSessionType(row: SessionTypeRow): SessionType {
  return {
    id: row.id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    rateLkrMinor: minor(row.rate_lkr_minor),
    rateUsdMinor: minor(row.rate_usd_minor),
    active: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toPractitioner(row: PractitionerRow): PractitionerSummary {
  return { id: row.id, displayName: row.display_name, title: row.title };
}

export function toPublicSlot(row: PublicSlotRow): PublicSlot {
  return {
    id: row.id,
    practitionerId: row.practitioner_id,
    practitionerName: row.practitioner_name,
    start: row.slot_start.toISOString(),
    end: row.slot_end.toISOString(),
    startTime: clinicTimeOf(row.slot_start),
    durationMinutes: minutesBetween(row.slot_start, row.slot_end),
    rateLkrMinor: minor(row.rate_lkr_minor),
    rateUsdMinor: minor(row.rate_usd_minor),
  };
}

export function toAdminSlot(row: AdminSlotRow): AdminSlot {
  const booking =
    row.booking_id && row.booking_status && row.contact_id
      ? {
          bookingId: row.booking_id,
          status: row.booking_status,
          contactId: row.contact_id,
          contactName: row.contact_name ?? '',
          contactEmail: row.contact_email,
          contactPhone: row.contact_phone,
        }
      : null;
  return {
    id: row.id,
    practitionerId: row.practitioner_id,
    practitionerName: row.practitioner_name,
    start: row.slot_start.toISOString(),
    end: row.slot_end.toISOString(),
    date: clinicDateOf(row.slot_start),
    startTime: clinicTimeOf(row.slot_start),
    durationMinutes: minutesBetween(row.slot_start, row.slot_end),
    status: row.status,
    source: row.source,
    rateLkrMinor: minor(row.rate_lkr_minor),
    rateUsdMinor: minor(row.rate_usd_minor),
    sessionTypeId: row.session_type_id,
    sessionTypeName: row.session_type_name,
    blockReason: row.block_reason,
    flaggedForReview: row.flagged_for_review,
    flagReason: row.flag_reason,
    booking,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** What audit_log keeps of a slot before and after a change. */
export function slotSnapshot(row: SlotRow): SlotSnapshot {
  return {
    practitionerId: row.practitioner_id,
    start: row.slot_start.toISOString(),
    end: row.slot_end.toISOString(),
    status: row.status,
    rateLkrMinor: minor(row.rate_lkr_minor),
    rateUsdMinor: minor(row.rate_usd_minor),
    sessionTypeId: row.session_type_id,
    blockReason: row.block_reason,
  };
}

export function toSlotHistoryEntry(row: AuditRow): SlotHistoryEntry {
  return {
    id: row.id,
    slotId: row.entity_id ?? '',
    action: row.action,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    before: (row.before as SlotSnapshot | null) ?? null,
    after: (row.after as SlotSnapshot | null) ?? null,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  };
}
