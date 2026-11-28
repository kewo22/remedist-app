import { Injectable } from '@nestjs/common';
import {
  PAY_AFTER_REVIEW_STRIKES,
  PUBLIC_BOOKING_CUTOFF_HOURS,
  isLateCancellation,
  rateForResidency,
  selfRescheduleBlock,
  withinSelfRescheduleWindow,
} from '@remedist/shared';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import type { CurrentStaff } from '../../common/auth/current-staff';
import type { Queryable } from '../../database/database.service';
import { minor } from '../availability/availability.mapper';
import { AvailabilityRepository } from '../availability/availability.repository';
import { ClientNotFoundException } from '../contacts/contacts.exceptions';
import { ContactsRepository, type ContactRow } from '../contacts/contacts.repository';
import { bookingCancelledMessage, bookingRescheduledMessage } from '../messaging/templates/booking-messages';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingCoreService, clientActor, staffActor, SYSTEM_HOLD_ACTOR, type BookingActor } from './booking-core.service';
import { BOOKING_AUDIT_ACTION, HOLD_RELEASE_BATCH_SIZE } from './bookings.constants';
import {
  BookingNotFoundException,
  BookingStatusConflictException,
  OutsideRescheduleWindowException,
  RescheduleAlreadyUsedException,
  RescheduleTooLateException,
  SlotUnavailableException,
} from './bookings.exceptions';
import { describeSession } from './bookings.mapper';
import { BookingsRepository, type BookingRow } from './bookings.repository';

const MINUTE_MS = 60_000;

/**
 * Changing bookings: reschedule (the client's one self-service move, and staff's unrestricted
 * one), cancel, no-show, staff notes, and releasing expired holds. Each change locks the booking,
 * and every slot it frees or claims is recorded in the slot's history too.
 */
@Injectable()
export class BookingChangesService {
  constructor(
    private readonly core: BookingCoreService,
    private readonly bookings: BookingsRepository,
    private readonly availability: AvailabilityRepository,
    private readonly contacts: ContactsRepository,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Reschedule ─────────────────────────────────────────────────────────────────────────

  /**
   * The client's one self-service reschedule (PRD B.6): a confirmed booking, more than 24 hours
   * before the session, to an open slot within 30 days of the original session date and outside
   * the public 24-hour cutoff.
   */
  async rescheduleForClient(client: CurrentClientAccount, bookingId: string, slotId: string, info: ClientInfo): Promise<void> {
    const view = await this.core.view(bookingId);
    if (!(await this.contacts.findOwned(client.id, client.contactId, view.contact_id))) {
      throw new BookingNotFoundException();
    }
    await this.reschedule(bookingId, slotId, clientActor(client, info), true, (booking, newStart) => {
      const block = selfRescheduleBlock({
        status: booking.status,
        start: booking.slot_start,
        selfRescheduleUsed: booking.self_reschedule_used_at !== null,
      });
      if (block === 'not_confirmed') {
        throw new BookingStatusConflictException('Only a confirmed booking can be rescheduled.');
      }
      if (block === 'already_used') {
        throw new RescheduleAlreadyUsedException();
      }
      if (block === 'too_late') {
        throw new RescheduleTooLateException();
      }
      if (!withinSelfRescheduleWindow(booking.original_slot_start, newStart)) {
        throw new OutsideRescheduleWindowException();
      }
    });
  }

  /** Staff move a held or confirmed booking to any open slot: the manual override, no time rules. */
  async rescheduleForStaff(staff: CurrentStaff, bookingId: string, slotId: string, info: ClientInfo): Promise<void> {
    await this.reschedule(bookingId, slotId, staffActor(staff, info), false, (booking) => {
      if (booking.status !== 'held' && booking.status !== 'confirmed') {
        throw new BookingStatusConflictException('Only a held or confirmed booking can be rescheduled. Make a new booking instead.');
      }
    });
  }

  /**
   * Claims the new slot, frees the old one, re-prices from the new slot (in the client's currency,
   * as when it was booked) and issues a new appointment code; the old code stays in the history.
   * The booking keeps its Part 2 form and its original session date.
   */
  private async reschedule(
    bookingId: string,
    slotId: string,
    actor: BookingActor,
    selfService: boolean,
    check: (booking: BookingRow, newStart: Date) => void,
  ): Promise<void> {
    const slots = await this.core.write(async (tx) => {
      const booking = await this.lockBooking(bookingId, tx);
      const target = await this.availability.findSlotForUpdate(slotId, tx);
      if (!target) {
        throw new SlotUnavailableException();
      }
      check(booking, target.slot_start);
      const contact = await this.contactOf(booking, tx);
      const notBefore = selfService ? new Date(Date.now() + PUBLIC_BOOKING_CUTOFF_HOURS * 60 * MINUTE_MS) : null;
      const slot = await this.core.claim(slotId, notBefore, actor, tx);
      const price = rateForResidency({ rateLkrMinor: minor(slot.rate_lkr_minor), rateUsdMinor: minor(slot.rate_usd_minor) }, contact.residency);

      await this.core.release(booking.slot_id, 'Its booking moved to another slot.', actor, tx);
      await this.bookings.moveToSlot(
        booking.id,
        { id: slot.id, practitionerId: slot.practitioner_id, start: slot.slot_start, end: slot.slot_end, rateMinor: price.amountMinor, currency: price.currency },
        selfService,
        tx,
      );
      const code = await this.core.issueCode(booking.id, slot.slot_start, booking.booking_type, contact.gender, tx);
      await this.core.record(
        BOOKING_AUDIT_ACTION.rescheduled,
        booking.id,
        { slotId: booking.slot_id, start: booking.slot_start.toISOString(), price: { amountMinor: Number(booking.rate_charged_minor), currency: booking.currency } },
        { slotId: slot.id, start: slot.slot_start.toISOString(), price, appointmentCode: code, selfService },
        undefined,
        actor,
        tx,
      );
      await this.notifications.notify(
        {
          section: 'bookings',
          type: 'reschedule',
          severity: 'neutral',
          message: `Booking rescheduled${selfService ? ' (self-service)' : ''}: ${contact.name} → ${describeSession(slot.slot_start)}`,
          entityType: 'booking',
          entityId: booking.id,
        },
        tx,
      );
      return [booking.slot_id, slot.id];
    });
    await this.core.afterCommit(...slots);
    this.core.messageClient(bookingId, bookingRescheduledMessage);
  }

  // ── Cancel and no-show ─────────────────────────────────────────────────────────────────

  /**
   * Staff cancel a booking (clients reschedule instead; the terms have no refunds). A confirmed
   * session that has started is a no-show, not a cancellation. Cancelling a confirmed booking less
   * than 24 hours ahead adds a late-cancellation strike; abandoning a hold never does.
   */
  async cancel(staff: CurrentStaff, bookingId: string, reason: string | null, info: ClientInfo): Promise<void> {
    const actor = staffActor(staff, info);
    const { freed, wasConfirmed } = await this.core.write(async (tx) => {
      const booking = await this.lockBooking(bookingId, tx);
      if (booking.status === 'cancelled') {
        throw new BookingStatusConflictException('This booking is already cancelled.');
      }
      if (booking.status === 'no_show') {
        throw new BookingStatusConflictException('This booking is already marked as a no-show.');
      }
      const started = booking.slot_start.getTime() <= Date.now();
      if (started && booking.status === 'confirmed') {
        throw new BookingStatusConflictException('That session has already started. Mark it as a no-show instead of cancelling.');
      }
      const contact = await this.contactOf(booking, tx);
      const late = booking.status === 'confirmed' && isLateCancellation(booking.slot_start);

      await this.bookings.setStatus(booking.id, 'cancelled', tx);
      await this.core.record(
        BOOKING_AUDIT_ACTION.cancelled,
        booking.id,
        { status: booking.status },
        { status: 'cancelled', lateCancellation: late },
        reason ?? undefined,
        actor,
        tx,
      );
      const wasConfirmed = booking.status === 'confirmed';
      if (started) {
        return { freed: undefined, wasConfirmed }; // A past, never-confirmed hold: nothing to reopen.
      }
      await this.core.release(booking.slot_id, 'Its booking was cancelled.', actor, tx);
      await this.notifications.notify(
        {
          section: 'bookings',
          type: 'cancellation',
          severity: 'warning',
          message: `Booking cancelled: ${contact.name} — ${describeSession(booking.slot_start)}`,
          entityType: 'booking',
          entityId: booking.id,
        },
        tx,
      );
      if (late) {
        await this.addStrike(contact, booking.id, 'late_cancellation', tx);
      }
      return { freed: booking.slot_id, wasConfirmed };
    });
    if (freed) {
      await this.core.afterCommit(freed);
    }
    // A hold was never confirmed to the client, so only a confirmed booking's cancellation is sent.
    if (wasConfirmed) {
      this.core.messageClient(bookingId, bookingCancelledMessage);
    }
  }

  /** A confirmed session that has started but the client didn't attend. The slot stays booked. */
  async markNoShow(staff: CurrentStaff, bookingId: string, info: ClientInfo): Promise<void> {
    const actor = staffActor(staff, info);
    const slotId = await this.core.write(async (tx) => {
      const booking = await this.lockBooking(bookingId, tx);
      if (booking.status !== 'confirmed') {
        throw new BookingStatusConflictException('Only a confirmed booking can be marked as a no-show.');
      }
      if (booking.slot_start.getTime() > Date.now()) {
        throw new BookingStatusConflictException('That session hasn’t started yet, so it can’t be a no-show.');
      }
      const contact = await this.contactOf(booking, tx);
      await this.bookings.setStatus(booking.id, 'no_show', tx);
      await this.core.record(BOOKING_AUDIT_ACTION.noShow, booking.id, { status: 'confirmed' }, { status: 'no_show' }, undefined, actor, tx);
      await this.addStrike(contact, booking.id, 'no_show', tx);
      await this.notifications.notify(
        {
          section: 'bookings',
          type: 'no_show',
          severity: 'warning',
          message: `No-show recorded: ${contact.name} — ${describeSession(booking.slot_start)}`,
          entityType: 'booking',
          entityId: booking.id,
        },
        tx,
      );
      // The slot stays booked (it mustn't reopen for pro-bono reclaim); only its event's title changes.
      await this.availability.markCalendarPending(booking.slot_id, tx);
      return booking.slot_id;
    });
    await this.core.afterCommit(slotId);
  }

  /** Staff commentary, for any booking (including cancelled ones). Never touches the client's notes. */
  async setStaffNotes(staff: CurrentStaff, bookingId: string, staffNotes: string | null, info: ClientInfo): Promise<void> {
    await this.core.write(async (tx) => {
      const booking = await this.lockBooking(bookingId, tx);
      if (booking.staff_notes === staffNotes) {
        return;
      }
      await this.bookings.setStaffNotes(booking.id, staffNotes, tx);
      // Only that they changed: the text can be personal.
      await this.core.record(
        BOOKING_AUDIT_ACTION.staffNotesUpdated,
        booking.id,
        { length: booking.staff_notes?.length ?? 0 },
        { length: staffNotes?.length ?? 0 },
        undefined,
        staffActor(staff, info),
        tx,
      );
    });
  }

  // ── Expired holds (the 1-minute job) ───────────────────────────────────────────────────

  /** Cancels expired checkout holds and reopens their slots. Returns how many. */
  async releaseExpiredHolds(tx: Queryable): Promise<string[]> {
    const freed: string[] = [];
    for (const booking of await this.bookings.lockExpiredHolds(HOLD_RELEASE_BATCH_SIZE, tx)) {
      await this.bookings.setStatus(booking.id, 'cancelled', tx);
      await this.core.record(BOOKING_AUDIT_ACTION.holdExpired, booking.id, { status: 'held' }, { status: 'cancelled' }, undefined, SYSTEM_HOLD_ACTOR, tx);
      await this.core.release(booking.slot_id, 'Its checkout hold expired.', SYSTEM_HOLD_ACTOR, tx);
      freed.push(booking.slot_id);
    }
    return freed;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────────────────

  /**
   * One strike per booking and kind; the count is always COUNT(*). From PAY_AFTER_REVIEW_STRIKES, a
   * pay-after client raises a review notification on every strike, so a pattern isn't missed.
   */
  private async addStrike(contact: ContactRow, bookingId: string, type: 'no_show' | 'late_cancellation', tx: Queryable): Promise<void> {
    if (!(await this.bookings.addStrike(contact.id, bookingId, type, tx))) {
      return;
    }
    const count = await this.bookings.strikeCount(contact.id, tx);
    if (contact.pay_after_session && count >= PAY_AFTER_REVIEW_STRIKES) {
      await this.notifications.notify(
        {
          section: 'payments',
          type: 'pay_after_review',
          severity: 'warning',
          message: `Pay-after review: ${contact.name} has reached ${count} strikes and can still pay after sessions. Consider reviewing this.`,
          entityType: 'contact',
          entityId: contact.id,
        },
        tx,
      );
    }
  }

  private async lockBooking(id: string, tx: Queryable): Promise<BookingRow> {
    const booking = await this.bookings.lock(id, tx);
    if (!booking) {
      throw new BookingNotFoundException();
    }
    return booking;
  }

  private async contactOf(booking: BookingRow, tx: Queryable): Promise<ContactRow> {
    const contact = await this.contacts.findById(booking.contact_id, tx);
    if (!contact) {
      throw new ClientNotFoundException();
    }
    return contact;
  }
}
