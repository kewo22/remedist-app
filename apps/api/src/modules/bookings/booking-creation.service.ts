import { Injectable } from '@nestjs/common';
import {
  HOLD_MINUTES,
  PUBLIC_BOOKING_CUTOFF_HOURS,
  addDays,
  clinicDateOf,
  clinicDateTime,
} from '@remedist/shared';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import type { CurrentStaff } from '../../common/auth/current-staff';
import type { Queryable } from '../../database/database.service';
import { isExclusionViolation } from '../../database/pg-errors';
import { minor } from '../availability/availability.mapper';
import { AvailabilityRepository, SLOT_OVERLAP_CONSTRAINT, type SlotRow } from '../availability/availability.repository';
import { SessionTypesService } from '../availability/session-types.service';
import { ContactAccessService } from '../contacts/contact-access.service';
import { ClientNotFoundException } from '../contacts/contacts.exceptions';
import { ContactsRepository } from '../contacts/contacts.repository';
import { bookingConfirmedMessage } from '../messaging/templates/booking-messages';
import { BookingCoreService, clientActor, staffActor, type BookingActor } from './booking-core.service';
import { WALK_IN_START_STEP_MINUTES } from './bookings.constants';
import { NoSlotsTodayException, OverdueLockoutWarningException } from './bookings.exceptions';
import { BookingsRepository } from './bookings.repository';
import { CreateBookingDto, StaffCreateBookingDto } from './dto/bookings.dto';

const MINUTE_MS = 60_000;

/**
 * Making bookings (the old POST /api/bookings, POST /api/admin/bookings and the walk-in kiosk). Each
 * claims the slot with one conditional update and books it in the same transaction.
 */
@Injectable()
export class BookingCreationService {
  constructor(
    private readonly core: BookingCoreService,
    private readonly bookings: BookingsRepository,
    private readonly availability: AvailabilityRepository,
    private readonly sessionTypes: SessionTypesService,
    private readonly contacts: ContactsRepository,
    private readonly access: ContactAccessService,
  ) {}

  /**
   * The client books online: held for HOLD_MINUTES while they pay, or confirmed straight away when
   * the clinic lets them pay after the session and they chose to. Slots inside the 24-hour cutoff
   * can't be booked online.
   */
  async bookForClient(client: CurrentClientAccount, input: CreateBookingDto, info: ClientInfo): Promise<string> {
    const { contact } = await this.access.requireOwned(client, input.contactId);
    await this.core.requireClientCanBook(contact);
    const payAfter = contact.pay_after_session && input.paymentChoice === 'pay_after';
    const actor = clientActor(client, info);
    const notBefore = new Date(Date.now() + PUBLIC_BOOKING_CUTOFF_HOURS * 60 * MINUTE_MS);

    const booked = await this.core.write(async (tx) => {
      const slot = await this.core.claim(input.slotId, notBefore, actor, tx);
      const id = await this.core.createOnSlot(
        contact,
        slot,
        {
          status: payAfter ? 'confirmed' : 'held',
          holdExpiresAt: payAfter ? null : new Date(Date.now() + HOLD_MINUTES * MINUTE_MS),
          bookingType: 'paid',
          bookedVia: 'online',
          paymentMode: payAfter ? 'pay_after' : 'upfront',
          notes: input.notes ?? null,
          staffNotes: null,
        },
        actor,
        tx,
      );
      return { id, slotId: slot.id };
    });
    await this.core.afterCommit(booked.slotId);
    return booked.id;
  }

  /**
   * Staff book for a client: confirmed at once, as the client's payment setting says. A client
   * locked out online for an overdue balance gets a warning first, never a silent bypass.
   */
  async bookForStaff(staff: CurrentStaff, input: StaffCreateBookingDto, info: ClientInfo): Promise<string> {
    const contact = await this.contacts.findById(input.contactId);
    if (!contact || contact.archived_at) {
      throw new ClientNotFoundException();
    }
    if (!input.overrideLockoutWarning && (await this.bookings.hasOverduePayAfter(contact.id))) {
      throw new OverdueLockoutWarningException(contact.name);
    }
    const actor = staffActor(staff, info);
    const booked = await this.core.write(async (tx) => {
      const slot = await this.core.claim(input.slotId, null, actor, tx);
      const id = await this.core.createOnSlot(
        contact,
        slot,
        {
          status: 'confirmed',
          holdExpiresAt: null,
          bookingType: 'paid',
          bookedVia: 'staff',
          paymentMode: contact.pay_after_session ? 'pay_after' : 'upfront',
          notes: null,
          staffNotes: input.staffNotes ?? null,
        },
        actor,
        tx,
      );
      return { id, slotId: slot.id };
    });
    await this.core.afterCommit(booked.slotId);
    // Online bookings are confirmed by payment, which sends the confirmation; the walk-in client is at the desk.
    this.core.messageClient(booked.id, bookingConfirmedMessage);
    return booked.id;
  }

  /**
   * The walk-in kiosk (PRD C.4.7), for the signed-in client themself: today's next open slot, or,
   * when none is left, a slot opened now (next quarter hour, the default session type) if that
   * time is free. Confirmed straight away; Part 2 is filled in on the tablet.
   */
  async walkIn(client: CurrentClientAccount, info: ClientInfo): Promise<string> {
    const { contact } = await this.access.requireOwned(client);
    await this.core.requireClientCanBook(contact);
    const actor = clientActor(client, info);

    const booked = await this.core.write(async (tx) => {
      const slot = (await this.claimTodaysNextSlot(actor, tx)) ?? (await this.openWalkInSlot(actor, tx));
      const id = await this.core.createOnSlot(
        contact,
        slot,
        {
          status: 'confirmed',
          holdExpiresAt: null,
          bookingType: 'paid',
          bookedVia: 'walk_in',
          paymentMode: 'upfront',
          notes: null,
          staffNotes: null,
        },
        actor,
        tx,
      );
      return { id, slotId: slot.id };
    });
    await this.core.afterCommit(booked.slotId);
    return booked.id;
  }

  private async claimTodaysNextSlot(actor: BookingActor, tx: Queryable): Promise<SlotRow | undefined> {
    const today = clinicDateOf(new Date());
    const [next] = await this.availability.lockOpenSlotsBetween(clinicDateTime(today, '00:00'), clinicDateTime(addDays(today, 1), '00:00'), tx);
    return next ? this.core.claim(next.id, null, actor, tx) : undefined;
  }

  /** Only while one practitioner is active (who else would see the walk-in?) and the time is free. */
  private async openWalkInSlot(actor: BookingActor, tx: Queryable): Promise<SlotRow> {
    const [practitioner, ...others] = await this.availability.activePractitioners();
    const sessionType = await this.sessionTypes.defaultType();
    if (!practitioner || others.length > 0 || !sessionType) {
      throw new NoSlotsTodayException();
    }
    // The clinic's +05:30 is a whole number of quarter hours, so this is a quarter hour on the clinic clock too.
    const step = WALK_IN_START_STEP_MINUTES * MINUTE_MS;
    const start = new Date(Math.ceil(Date.now() / step) * step);
    const end = new Date(start.getTime() + sessionType.duration_minutes * MINUTE_MS);

    await tx.query('SAVEPOINT walk_in_slot');
    let slot: SlotRow;
    try {
      slot = await this.availability.insertWalkInSlot(
        {
          practitionerId: practitioner.id,
          start,
          end,
          rateLkrMinor: minor(sessionType.rate_lkr_minor),
          rateUsdMinor: minor(sessionType.rate_usd_minor),
          sessionTypeId: sessionType.id,
        },
        tx,
      );
    } catch (error) {
      if (!isExclusionViolation(error, SLOT_OVERLAP_CONSTRAINT)) {
        throw error;
      }
      // "Now" falls inside a booked or blocked slot: the clinic is full today.
      await tx.query('ROLLBACK TO SAVEPOINT walk_in_slot');
      throw new NoSlotsTodayException();
    }
    await this.core.recordSlotCreated(slot, 'Opened for a walk-in', actor, tx);
    return slot;
  }
}
