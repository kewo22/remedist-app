import { Injectable } from '@nestjs/common';
import {
  ADMIN_SLOTS_MAX_RANGE_DAYS,
  PUBLIC_BOOKING_CUTOFF_HOURS,
  PUBLIC_DATES_MAX_RANGE_DAYS,
  SLOT_HISTORY_DEFAULT_LIMIT,
  addDays,
  clinicDateOf,
  clinicDateTime,
  daysBetween,
  type AdminSlot,
  type PractitionerSummary,
  type PublicAvailableDates,
  type PublicSlotDay,
  type SlotHistoryEntry,
} from '@remedist/shared';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ValidationFailedException } from '../../common/exceptions/common.exceptions';
import { DatabaseService, Queryable } from '../../database/database.service';
import { isExclusionViolation } from '../../database/pg-errors';
import { SLOT_AUDIT_ACTION, SLOT_ENTITY } from './availability.constants';
import {
  SessionTypeRetiredException,
  SlotNotFoundException,
  SlotOverlapException,
  SlotStatusConflictException,
} from './availability.exceptions';
import { minor, slotSnapshot, toAdminSlot, toPractitioner, toPublicSlot, toSlotHistoryEntry } from './availability.mapper';
import {
  AvailabilityRepository,
  SLOT_OVERLAP_CONSTRAINT,
  type SessionTypeRow,
  type SlotChanges,
  type SlotRow,
} from './availability.repository';
import { requireARate } from './session-types.service';
import { AdminSlotQueryDto, BlockSlotDto, CreateSlotDto, PublicDatesQueryDto, UpdateSlotDto } from './dto/availability.dto';

const MINUTE_MS = 60_000;

function fieldError(field: string, message: string): ValidationFailedException {
  return new ValidationFailedException([{ field, messages: [message] }]);
}

/**
 * Slots (the old /api/admin/availability routes and the public GET /api/availability):
 * availability_slots is the only source of what's bookable. Staff open slots as a session type,
 * edit, block, unblock and delete them; every change is in audit_log. One practitioner's active
 * slots never overlap, which the database enforces (availability_slots_no_overlap).
 *
 * Booking claims and releases slots (an atomic `WHERE status = 'open'` update) in the bookings
 * module. Google Calendar events are kept in step by the calendar integration.
 */
@Injectable()
export class SlotsService {
  constructor(
    private readonly availability: AvailabilityRepository,
    private readonly audit: AuditLogRepository,
    private readonly db: DatabaseService,
  ) {}

  // ── Public ─────────────────────────────────────────────────────────────────────────────

  /** Open slots on a clinic-local day, without those inside the 24-hour booking cutoff. */
  async publicDay(date: string, practitionerId?: string): Promise<PublicSlotDay> {
    const dayStart = clinicDateTime(date, '00:00');
    const dayEnd = clinicDateTime(addDays(date, 1), '00:00');
    const rows = await this.availability.listOpenSlots(this.laterOf(dayStart, this.cutoff()), dayEnd, practitionerId);
    return { date, slots: rows.map(toPublicSlot) };
  }

  async publicDates(query: PublicDatesQueryDto): Promise<PublicAvailableDates> {
    this.checkRange(query.from, query.to, PUBLIC_DATES_MAX_RANGE_DAYS);
    const from = clinicDateTime(query.from, '00:00');
    const to = clinicDateTime(addDays(query.to, 1), '00:00');
    return { dates: await this.availability.datesWithOpenSlots(this.laterOf(from, this.cutoff()), to, query.practitionerId) };
  }

  // ── CRM: reading ───────────────────────────────────────────────────────────────────────

  /** Default: this clinic week, Sunday to Saturday (as the old panel). */
  async list(query: AdminSlotQueryDto): Promise<AdminSlot[]> {
    if ((query.from === undefined) !== (query.to === undefined)) {
      throw fieldError('to', 'Give both from and to, or neither');
    }
    const today = clinicDateOf(new Date());
    const weekStart = addDays(today, -new Date(`${today}T00:00:00Z`).getUTCDay());
    const fromDate = query.from ?? weekStart;
    const toDate = query.to ?? addDays(weekStart, 6);
    this.checkRange(fromDate, toDate, ADMIN_SLOTS_MAX_RANGE_DAYS);
    const rows = await this.availability.listAdminSlots(
      clinicDateTime(fromDate, '00:00'),
      clinicDateTime(addDays(toDate, 1), '00:00'),
      query.practitionerId,
    );
    return rows.map(toAdminSlot);
  }

  async practitioners(): Promise<PractitionerSummary[]> {
    return (await this.availability.activePractitioners()).map(toPractitioner);
  }

  async history(slotId: string | undefined, limit: number | undefined): Promise<SlotHistoryEntry[]> {
    const rows = await this.audit.listForEntity(SLOT_ENTITY, slotId, limit ?? SLOT_HISTORY_DEFAULT_LIMIT);
    return rows.map(toSlotHistoryEntry);
  }

  // ── CRM: changes ───────────────────────────────────────────────────────────────────────

  /** Opens a slot as a session type, copying its length and prices (never read back later). */
  async create(input: CreateSlotDto, staff: CurrentStaff, info: ClientInfo): Promise<AdminSlot> {
    const practitionerId = await this.resolvePractitioner(input.practitionerId);
    const sessionType = await this.activeSessionType(input.sessionTypeId, this.db);
    const start = this.futureStart(input.date, input.startTime);
    const end = new Date(start.getTime() + sessionType.duration_minutes * MINUTE_MS);

    const id = await this.write(async (tx) => {
      const slot = await this.availability.insertSlot(
        {
          practitionerId,
          start,
          end,
          rateLkrMinor: minor(sessionType.rate_lkr_minor),
          rateUsdMinor: minor(sessionType.rate_usd_minor),
          sessionTypeId: sessionType.id,
          createdBy: staff.id,
        },
        tx,
      );
      await this.record(staff, info, SLOT_AUDIT_ACTION.created, slot.id, undefined, slot, undefined, tx);
      return slot.id;
    });
    return this.adminSlot(id);
  }

  /**
   * Edits an open or blocked slot. A new session type copies its length and prices; a duration or
   * rate given alongside overrides them for this slot only.
   */
  async update(id: string, input: UpdateSlotDto, staff: CurrentStaff, info: ClientInfo): Promise<AdminSlot> {
    const moving = input.date !== undefined || input.startTime !== undefined;
    if (moving && (input.date === undefined || input.startTime === undefined)) {
      throw fieldError('startTime', 'Give both the date and the start time to move a slot');
    }

    await this.write(async (tx) => {
      const current = await this.lockSlot(id, tx);
      if (current.status !== 'open' && current.status !== 'blocked') {
        throw new SlotStatusConflictException('Only open or blocked slots can be edited.');
      }
      const sessionType = input.sessionTypeId ? await this.activeSessionType(input.sessionTypeId, tx) : undefined;

      const start = moving ? this.futureStart(input.date ?? '', input.startTime ?? '') : current.slot_start;
      const minutes =
        input.durationMinutes ??
        sessionType?.duration_minutes ??
        Math.round((current.slot_end.getTime() - current.slot_start.getTime()) / MINUTE_MS);
      const baseLkr = sessionType ? minor(sessionType.rate_lkr_minor) : minor(current.rate_lkr_minor);
      const baseUsd = sessionType ? minor(sessionType.rate_usd_minor) : minor(current.rate_usd_minor);
      const changes: SlotChanges = {
        start,
        end: new Date(start.getTime() + minutes * MINUTE_MS),
        rateLkrMinor: input.rateLkrMinor !== undefined ? input.rateLkrMinor : baseLkr,
        rateUsdMinor: input.rateUsdMinor !== undefined ? input.rateUsdMinor : baseUsd,
        sessionTypeId: sessionType?.id ?? current.session_type_id,
      };
      requireARate(changes.rateLkrMinor, changes.rateUsdMinor);

      const before = slotSnapshot(current);
      const unchanged =
        changes.start.getTime() === current.slot_start.getTime() &&
        changes.end.getTime() === current.slot_end.getTime() &&
        changes.rateLkrMinor === before.rateLkrMinor &&
        changes.rateUsdMinor === before.rateUsdMinor &&
        changes.sessionTypeId === current.session_type_id;
      if (unchanged) {
        return;
      }
      const updated = await this.availability.updateSlot(id, changes, tx);
      await this.record(staff, info, SLOT_AUDIT_ACTION.updated, id, current, updated, undefined, tx);
    });
    return this.adminSlot(id);
  }

  async block(id: string, input: BlockSlotDto, staff: CurrentStaff, info: ClientInfo): Promise<AdminSlot> {
    const reason = input.reason ?? null;
    await this.changeStatus(id, staff, info, (current) => {
      if (current.status !== 'open') {
        throw new SlotStatusConflictException('Only open slots can be blocked.');
      }
      return { status: 'blocked', blockReason: reason, action: SLOT_AUDIT_ACTION.blocked, note: reason ?? undefined };
    });
    return this.adminSlot(id);
  }

  async unblock(id: string, staff: CurrentStaff, info: ClientInfo): Promise<AdminSlot> {
    await this.changeStatus(id, staff, info, (current) => {
      if (current.status !== 'blocked') {
        throw new SlotStatusConflictException('Only blocked slots can be unblocked.');
      }
      return { status: 'open', blockReason: null, action: SLOT_AUDIT_ACTION.unblocked };
    });
    return this.adminSlot(id);
  }

  /** Booked slots can't be deleted: cancel or reschedule the booking first. */
  async remove(id: string, staff: CurrentStaff, info: ClientInfo): Promise<void> {
    await this.changeStatus(id, staff, info, (current) => {
      if (current.status !== 'open' && current.status !== 'blocked') {
        throw new SlotStatusConflictException('Only open or blocked slots can be deleted.');
      }
      return { status: 'deleted', blockReason: current.block_reason, action: SLOT_AUDIT_ACTION.deleted };
    });
  }

  /** Clears a calendar conflict flag after review. Doesn't touch the booking itself. */
  async acknowledgeFlag(id: string, staff: CurrentStaff, info: ClientInfo): Promise<AdminSlot> {
    await this.db.transaction(async (tx) => {
      const current = await this.lockSlot(id, tx);
      if (!current.flagged_for_review) {
        throw new SlotStatusConflictException('This slot has no flag to clear.');
      }
      const updated = await this.availability.clearSlotFlag(id, tx);
      await this.record(staff, info, SLOT_AUDIT_ACTION.flagCleared, id, current, updated, current.flag_reason ?? undefined, tx);
    });
    return this.adminSlot(id);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────────────

  private async changeStatus(
    id: string,
    staff: CurrentStaff,
    info: ClientInfo,
    decide: (current: SlotRow) => { status: SlotRow['status']; blockReason: string | null; action: string; note?: string },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.lockSlot(id, tx);
      const next = decide(current);
      const updated = await this.availability.setSlotStatus(id, next.status, next.blockReason, tx);
      await this.record(staff, info, next.action, id, current, updated, next.note, tx);
    });
  }

  private async lockSlot(id: string, tx: Queryable): Promise<SlotRow> {
    const slot = await this.availability.findSlotForUpdate(id, tx);
    if (!slot) {
      throw new SlotNotFoundException();
    }
    return slot;
  }

  /** A write that may hit the overlap constraint. */
  private async write<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isExclusionViolation(error, SLOT_OVERLAP_CONSTRAINT)) {
        throw new SlotOverlapException(error);
      }
      throw error;
    }
  }

  /** The given active practitioner, or the only active one when none is given. */
  private async resolvePractitioner(practitionerId: string | undefined): Promise<string> {
    const active = await this.availability.activePractitioners();
    if (practitionerId) {
      if (!active.some((practitioner) => practitioner.id === practitionerId)) {
        throw fieldError('practitionerId', 'That practitioner isn’t taking bookings');
      }
      return practitionerId;
    }
    const only = active.length === 1 ? active[0] : undefined;
    if (!only) {
      throw fieldError('practitionerId', 'Choose the practitioner for this slot');
    }
    return only.id;
  }

  private async activeSessionType(id: string, db: Queryable): Promise<SessionTypeRow> {
    const sessionType = await this.availability.findSessionType(id, db);
    if (!sessionType) {
      throw fieldError('sessionTypeId', 'That session type doesn’t exist');
    }
    if (!sessionType.is_active) {
      throw new SessionTypeRetiredException();
    }
    return sessionType;
  }

  /** A slot can't be opened or moved into the past. */
  private futureStart(date: string, startTime: string): Date {
    const start = clinicDateTime(date, startTime);
    if (start.getTime() <= Date.now()) {
      throw fieldError('startTime', 'Choose a time that hasn’t passed yet');
    }
    return start;
  }

  private checkRange(from: string, to: string, maxDays: number): void {
    const days = daysBetween(from, to);
    if (days < 0) {
      throw fieldError('to', 'to must be on or after from');
    }
    if (days > maxDays) {
      throw fieldError('to', `Ask for at most ${maxDays} days at a time`);
    }
  }

  private cutoff(): Date {
    return new Date(Date.now() + PUBLIC_BOOKING_CUTOFF_HOURS * 60 * MINUTE_MS);
  }

  private laterOf(a: Date, b: Date): Date {
    return a.getTime() >= b.getTime() ? a : b;
  }

  private async adminSlot(id: string): Promise<AdminSlot> {
    const row = await this.availability.findAdminSlot(id);
    if (!row) {
      throw new SlotNotFoundException();
    }
    return toAdminSlot(row);
  }

  private record(
    staff: CurrentStaff,
    info: ClientInfo,
    action: string,
    slotId: string,
    before: SlotRow | undefined,
    after: SlotRow | undefined,
    note: string | undefined,
    tx: Queryable,
  ): Promise<void> {
    return this.audit.record(
      {
        actorType: 'staff',
        actorId: staff.id,
        actorLabel: staff.name,
        action,
        entityType: SLOT_ENTITY,
        entityId: slotId,
        before: before ? slotSnapshot(before) : undefined,
        after: after ? slotSnapshot(after) : undefined,
        note,
        requestId: info.requestId,
        ipAddress: info.ipAddress,
      },
      tx,
    );
  }
}
