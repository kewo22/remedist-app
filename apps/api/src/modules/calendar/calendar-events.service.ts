import { Injectable, Logger } from '@nestjs/common';
import { CLINIC_TIME_ZONE } from '@remedist/shared';
import { DatabaseService } from '../../database/database.service';
import { GoogleApiError, GoogleCalendarApi, type SlotEventWrite } from '../../integrations/google/google-calendar.api';
import { CalendarConnectionService, describe, type CalendarAccess } from './calendar-connection.service';
import { PUSH_BATCH_SIZE } from './calendar.constants';
import { CalendarRepository, type CalendarSlotRow } from './calendar.repository';

/** What a slot's event shows. Open slots show as free, so they don't block the owner's calendar. */
function renderEvent(slot: CalendarSlotRow): SlotEventWrite {
  const summary =
    slot.status === 'open'
      ? `Open — ${slot.session_type_name ?? 'Remedist availability'}`
      : slot.status === 'blocked'
        ? slot.block_reason
          ? `Blocked — ${slot.block_reason}`
          : 'Blocked'
        : 'Booked — The Remedist';
  return {
    slotId: slot.id,
    summary,
    description: `${slot.practitioner_name}\nManaged in the Remedist CRM. Moving or deleting this event here moves or deletes an open slot; booked slots are only flagged for review.`,
    start: slot.slot_start,
    end: slot.slot_end,
    free: slot.status === 'open',
    timeZone: CLINIC_TIME_ZONE,
  };
}

/**
 * Keeps each slot's one Google Calendar event in step with the slot: created when the slot first
 * reaches Google, patched in place afterwards (never re-inserted, unless Google lost it) and deleted
 * with the slot.
 *
 * Every slot change sets calendar_sync_pending in its own transaction; `push` clears it once the
 * event matches. A failed push leaves it pending for the 5-minute job, so a Google outage never
 * blocks scheduling.
 */
@Injectable()
export class CalendarEventsService {
  private readonly logger = new Logger(CalendarEventsService.name);

  constructor(
    private readonly calendar: CalendarRepository,
    private readonly connection: CalendarConnectionService,
    private readonly google: GoogleCalendarApi,
    private readonly db: DatabaseService,
  ) {}

  /**
   * For callers right after they commit a slot change. Never throws: a failure stays pending and
   * the job retries it.
   */
  async pushAfterChange(slotId: string): Promise<void> {
    try {
      const access = await this.connection.access();
      if (access) {
        await this.push(slotId, access);
      }
    } catch (error) {
      this.logger.warn(`Calendar update for slot ${slotId} failed; the job will retry (${describe(error)})`);
      await this.connection.recordError('Some slot events couldn’t be updated in Google Calendar. Retrying every 5 minutes.').catch(() => undefined);
    }
  }

  /** The job's retry pass: pushes pending slots, soonest first. Returns how many succeeded and failed. */
  async pushPending(access: CalendarAccess): Promise<{ pushed: number; failed: number }> {
    let pushed = 0;
    let failed = 0;
    for (const slotId of await this.calendar.pendingSlotIds(PUSH_BATCH_SIZE)) {
      try {
        if (await this.push(slotId, access)) {
          pushed++;
        }
      } catch (error) {
        failed++;
        this.logger.warn(`Calendar update for slot ${slotId} failed (${describe(error)})`);
      }
    }
    return { pushed, failed };
  }

  /**
   * Makes the slot's event match the slot, holding the slot's row lock meanwhile so two pushes (or a
   * push and a staff edit) can't interleave. Returns false when there was nothing to do.
   */
  private async push(slotId: string, access: CalendarAccess): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const slot = await this.calendar.lockSlot(slotId, tx);
      if (!slot?.calendar_sync_pending) {
        return false;
      }
      const { accessToken, calendarId } = access;

      if (slot.status === 'deleted') {
        if (slot.google_event_id) {
          await this.google.deleteEvent(accessToken, calendarId, slot.google_event_id);
        }
        // The id stays, so Google's echo of the deletion is recognised as this slot's.
        await this.calendar.markPushed(slot.id, slot.google_event_id, tx);
        return true;
      }

      const event = renderEvent(slot);
      let eventId = slot.google_event_id;
      if (eventId) {
        try {
          await this.google.patchEvent(accessToken, calendarId, eventId, event);
        } catch (error) {
          // Deleted in Google, or made in a calendar that's no longer connected: start a new one.
          if (!(error instanceof GoogleApiError && error.isGone)) {
            throw error;
          }
          eventId = null;
        }
      }
      eventId ??= await this.google.insertEvent(accessToken, calendarId, event);
      await this.calendar.markPushed(slot.id, eventId, tx);
      return true;
    });
  }
}
