import { Injectable, Logger } from '@nestjs/common';
import { CLINIC_TIME_ZONE, clinicDateTime, isDateOnly } from '@remedist/shared';
import { AuditLogRepository } from '../../common/audit/audit-log.repository';
import { DatabaseService, Queryable } from '../../database/database.service';
import { isExclusionViolation } from '../../database/pg-errors';
import {
  GoogleCalendarApi,
  SLOT_ID_PROPERTY,
  SyncTokenExpiredError,
  type GoogleCalendarEvent,
} from '../../integrations/google/google-calendar.api';
import { slotSnapshot } from '../availability/availability.mapper';
import { SLOT_OVERLAP_CONSTRAINT, type SlotRow } from '../availability/availability.repository';
import { NotificationsService } from '../notifications/notifications.service';
import type { CalendarAccess } from './calendar-connection.service';
import { SLOT_SYNC_ACTION, SYNC_ACTOR_LABEL } from './calendar.constants';
import { CalendarRepository, type CalendarSlotRow } from './calendar.repository';

interface EventRange {
  start: Date;
  end: Date;
  allDay: boolean;
}

/**
 * The time an event covers, as instants. Fixes both old bugs:
 * - times are compared as instants, not strings ("+05:30" vs "Z" made every booked slot look moved);
 * - all-day events ({ date }) cover whole clinic days, end date exclusive (they used to be ignored).
 */
export function eventRange(event: GoogleCalendarEvent): EventRange | undefined {
  const { start, end } = event;
  if (start?.dateTime && end?.dateTime) {
    return { start: new Date(start.dateTime), end: new Date(end.dateTime), allDay: false };
  }
  if (start?.date && end?.date && isDateOnly(start.date) && isDateOnly(end.date)) {
    return { start: clinicDateTime(start.date, '00:00'), end: clinicDateTime(end.date, '00:00'), allDay: true };
  }
  return undefined;
}

/**
 * Whether a private event makes the owner busy. Events marked "free" don't block slots: Google's
 * all-day working-location and birthday entries are free, and would otherwise block whole days now
 * that all-day events count.
 */
function blocksSlots(event: GoogleCalendarEvent): boolean {
  return event.status !== 'cancelled' && event.transparency !== 'transparent' && event.eventType !== 'workingLocation';
}

function sameTimes(slot: SlotRow, range: EventRange): boolean {
  return slot.slot_start.getTime() === range.start.getTime() && slot.slot_end.getTime() === range.end.getTime();
}

/**
 * The sync back from Google (the old reconcileEvent), run by the 5-minute job:
 * - a slot's own event moved or deleted in Google moves or deletes an open or blocked slot;
 * - a booked slot is never changed: the change is flagged for staff, with a critical notification;
 * - a slot whose own update is still pending is left alone (the app's version wins, then is pushed);
 * - any other event that shows as busy blocks the open slots it overlaps, and unblocks them when it
 *   moves away or is deleted.
 * Every change is in audit_log as 'Google Calendar sync'.
 */
@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private readonly calendar: CalendarRepository,
    private readonly google: GoogleCalendarApi,
    private readonly audit: AuditLogRepository,
    private readonly notifications: NotificationsService,
    private readonly db: DatabaseService,
  ) {}

  /** Reads every change since the last run (or all upcoming events on a full sync). Returns the event count. */
  async run(access: CalendarAccess): Promise<number> {
    const state = await this.calendar.syncState(access.calendarId);
    const syncToken = state?.sync_token ?? undefined;
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;
    let count = 0;
    try {
      do {
        const page = await this.google.listEvents(access.accessToken, access.calendarId, {
          syncToken,
          pageToken,
          timeMin: new Date(),
        });
        for (const event of page.events) {
          await this.reconcile(event);
          count++;
        }
        pageToken = page.nextPageToken ?? undefined;
        nextSyncToken = page.nextSyncToken ?? nextSyncToken;
      } while (pageToken);
    } catch (error) {
      if (error instanceof SyncTokenExpiredError) {
        await this.calendar.saveSyncError(access.calendarId, 'Google asked for a full resync; it runs next time.', true);
        return count;
      }
      throw error;
    }
    await this.calendar.saveSyncToken(access.calendarId, nextSyncToken);
    return count;
  }

  /** Applies one Google event. Each event is its own transaction. */
  async reconcile(event: GoogleCalendarEvent): Promise<void> {
    const handled = await this.reconcileOwnEvent(event);
    if (!handled) {
      await this.reconcilePrivateEvent(event);
    }
  }

  // ── A slot's own event ─────────────────────────────────────────────────────────────────

  /** False when the event isn't a slot's own. */
  private async reconcileOwnEvent(event: GoogleCalendarEvent): Promise<boolean> {
    let moveTo: { slotId: string; range: EventRange } | undefined;
    const handled = await this.db.transaction(async (tx) => {
      const slot = await this.calendar.lockSlotByEvent(event.id, tx);
      if (!slot) {
        // One of ours whose link was lost (for example a failed save after inserting): never a private event.
        return event.extendedProperties?.private?.[SLOT_ID_PROPERTY] !== undefined;
      }
      if (slot.status === 'deleted' || slot.calendar_sync_pending) {
        return true;
      }
      const range = event.status === 'cancelled' ? undefined : eventRange(event);

      if (slot.status === 'booked') {
        if (!range || !sameTimes(slot, range)) {
          await this.flagBooked(slot, range ? 'was moved' : 'was deleted', tx);
        }
        return true;
      }

      if (!range) {
        if (event.status === 'cancelled') {
          const deleted = await this.calendar.deleteSlot(slot.id, tx);
          await this.record(SLOT_SYNC_ACTION.synced, slot, deleted, 'Event deleted in Google Calendar.', tx);
        }
        return true;
      }
      if (range.allDay) {
        await this.record(SLOT_SYNC_ACTION.conflict, slot, undefined, 'Event changed to all-day in Google Calendar; the slot was left as it was.', tx);
        return true;
      }
      if (!sameTimes(slot, range)) {
        moveTo = { slotId: slot.id, range };
      }
      return true;
    });

    if (moveTo) {
      await this.moveSlot(moveTo.slotId, moveTo.range);
    }
    return handled;
  }

  /** A move can overlap another slot; the constraint refuses it, and that's recorded instead. */
  private async moveSlot(slotId: string, range: EventRange): Promise<void> {
    try {
      await this.db.transaction(async (tx) => {
        const slot = await this.calendar.lockSlot(slotId, tx);
        if (!slot || (slot.status !== 'open' && slot.status !== 'blocked') || slot.calendar_sync_pending) {
          return;
        }
        const moved = await this.calendar.moveSlot(slot.id, range.start, range.end, tx);
        await this.record(SLOT_SYNC_ACTION.synced, slot, moved, 'Time changed in Google Calendar.', tx);
      });
    } catch (error) {
      if (!isExclusionViolation(error, SLOT_OVERLAP_CONSTRAINT)) {
        throw error;
      }
      await this.db.transaction(async (tx) => {
        const slot = await this.calendar.lockSlot(slotId, tx);
        if (slot) {
          await this.record(
            SLOT_SYNC_ACTION.conflict,
            slot,
            undefined,
            'Event was moved in Google Calendar to a time that overlaps another slot; the slot was left as it was.',
            tx,
          );
        }
      });
    }
  }

  /** Never changes a booked slot: staff review it. Notifies only when it wasn't flagged already. */
  private async flagBooked(slot: CalendarSlotRow, what: string, tx: Queryable): Promise<void> {
    const reason = `The calendar event ${what} in Google Calendar while this slot is booked. Please review.`;
    if (slot.flagged_for_review && slot.flag_reason === reason) {
      return; // Already flagged for this (for example replayed by a full resync).
    }
    const flagged = await this.calendar.flagSlot(slot.id, reason, tx);
    await this.record(SLOT_SYNC_ACTION.conflict, slot, flagged, reason, tx);
    if (!slot.flagged_for_review) {
      const when = new Intl.DateTimeFormat('en-GB', {
        timeZone: CLINIC_TIME_ZONE,
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(slot.slot_start);
      await this.notifications.notify(
        {
          section: 'availability',
          type: 'calendar_conflict',
          severity: 'critical',
          message: `Calendar conflict on a booked slot (${when}, ${slot.practitioner_name}): ${reason}`,
          entityType: 'availability_slot',
          entityId: slot.id,
        },
        tx,
      );
    }
  }

  // ── Private events ─────────────────────────────────────────────────────────────────────

  /**
   * Blocks the open slots a busy private event overlaps (any practitioner: it's the clinic's
   * calendar), and unblocks the ones it no longer covers. Slots already blocked by it are left as
   * they are, so a full resync doesn't churn.
   */
  private async reconcilePrivateEvent(event: GoogleCalendarEvent): Promise<void> {
    const range = blocksSlots(event) ? eventRange(event) : undefined;
    await this.db.transaction(async (tx) => {
      const blocked = await this.calendar.lockSlotsBlockedByEvent(event.id, tx);
      for (const slot of blocked) {
        if (!range || !(slot.slot_start < range.end && slot.slot_end > range.start)) {
          const opened = await this.calendar.unblockByEvent(slot.id, tx);
          await this.record(SLOT_SYNC_ACTION.unblocked, slot, opened, 'The Google Calendar event that blocked it moved or was removed.', tx);
        }
      }
      if (!range) {
        return;
      }
      const reason = (event.summary?.trim() || 'Busy in Google Calendar').slice(0, 200);
      for (const slot of await this.calendar.lockOpenSlotsOverlapping(range.start, range.end, tx)) {
        const updated = await this.calendar.blockByEvent(slot.id, event.id, reason, tx);
        await this.record(SLOT_SYNC_ACTION.blocked, slot, updated, reason, tx);
      }
    });
  }

  private record(action: string, before: SlotRow, after: SlotRow | undefined, note: string, tx: Queryable): Promise<void> {
    return this.audit.record(
      {
        actorType: 'integration',
        actorLabel: SYNC_ACTOR_LABEL,
        action,
        entityType: 'availability_slot',
        entityId: before.id,
        before: slotSnapshot(before),
        after: after ? slotSnapshot(after) : undefined,
        note,
      },
      tx,
    );
  }

  /** For the job's log line. */
  logRun(events: number): void {
    if (events > 0) {
      this.logger.log(`Synced ${events} Google Calendar change(s)`);
    }
  }
}
