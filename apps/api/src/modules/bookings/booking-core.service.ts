import { Injectable, Logger } from '@nestjs/common';
import {
  clinicDateOf,
  formatAppointmentCode,
  rateForResidency,
  type BookedVia,
  type BookingType,
  type PaymentMode,
} from '@remedist/shared';
import { AuditLogRepository, type AuditEntry } from '../../common/audit/audit-log.repository';
import type { ClientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { DatabaseService, Queryable } from '../../database/database.service';
import { isUniqueViolation } from '../../database/pg-errors';
import { slotSnapshot } from '../availability/availability.mapper';
import { AvailabilityRepository, type SlotRow } from '../availability/availability.repository';
import { CalendarEventsService } from '../calendar/calendar-events.service';
import type { ContactRow } from '../contacts/contacts.repository';
import { IntakeFormsService } from '../intake/intake-forms.service';
import { MessagingService } from '../messaging/messaging.service';
import type { BookingMessageDetails, ClientMessage } from '../messaging/templates/booking-messages';
import { NotificationsService } from '../notifications/notifications.service';
import { TermsService } from '../terms/terms.service';
import { BOOKING_AUDIT_ACTION, SLOT_BOOKING_ACTION } from './bookings.constants';
import {
  BookingNotFoundException,
  BookingPart1RequiredException,
  PaymentOverdueLockoutException,
  SlotUnavailableException,
  TermsReacceptRequiredException,
} from './bookings.exceptions';
import { describeSession } from './bookings.mapper';
import { ACTIVE_BOOKING_SLOT_INDEX, BookingsRepository, type BookingViewRow } from './bookings.repository';

/** Who is acting, for audit_log. */
export type BookingActor = Pick<AuditEntry, 'actorType' | 'actorId' | 'actorLabel' | 'requestId' | 'ipAddress'>;

export function clientActor(client: CurrentClientAccount, info: ClientInfo): BookingActor {
  return { actorType: 'patient', actorId: client.id, actorLabel: client.email, requestId: info.requestId, ipAddress: info.ipAddress };
}

export function staffActor(staff: CurrentStaff, info: ClientInfo): BookingActor {
  return { actorType: 'staff', actorId: staff.id, actorLabel: staff.name, requestId: info.requestId, ipAddress: info.ipAddress };
}

export const SYSTEM_HOLD_ACTOR: BookingActor = { actorType: 'system', actorLabel: 'Hold expiry' };

export interface NewBookingOptions {
  status: 'held' | 'confirmed';
  holdExpiresAt: Date | null;
  bookingType: BookingType;
  bookedVia: BookedVia;
  paymentMode: PaymentMode;
  notes: string | null;
  staffNotes: string | null;
}

/**
 * The steps every way of booking shares (client, staff, walk-in, and later pro-bono), each inside
 * the caller's transaction, so a booking, its code and its Part 2 form commit or roll back
 * together. The calendar event is pushed after the commit.
 */
@Injectable()
export class BookingCoreService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly availability: AvailabilityRepository,
    private readonly intakeForms: IntakeFormsService,
    private readonly terms: TermsService,
    private readonly calendarEvents: CalendarEventsService,
    private readonly notifications: NotificationsService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditLogRepository,
    private readonly db: DatabaseService,
  ) {}

  private readonly logger = new Logger(BookingCoreService.name);

  /** What a client needs before booking online or at the kiosk (the old 428 checks), in order. */
  async requireClientCanBook(contact: ContactRow): Promise<void> {
    if (!contact.part1_completed_at) {
      throw new BookingPart1RequiredException();
    }
    if (await this.terms.acceptanceRequired(contact)) {
      throw new TermsReacceptRequiredException();
    }
    if (await this.bookings.hasOverduePayAfter(contact.id)) {
      throw new PaymentOverdueLockoutException();
    }
  }

  /** Claims the slot or throws SLOT_UNAVAILABLE. `notBefore` is the public cutoff (null for staff). */
  async claim(slotId: string, notBefore: Date | null, actor: BookingActor, tx: Queryable): Promise<SlotRow> {
    const before = await this.availability.findSlotForUpdate(slotId, tx);
    const claimed = before ? await this.availability.claimSlot(slotId, notBefore, tx) : undefined;
    if (!before || !claimed) {
      throw new SlotUnavailableException();
    }
    await this.recordSlot(SLOT_BOOKING_ACTION.booked, before, claimed, undefined, actor, tx);
    return claimed;
  }

  /** Back to open (cancelled, expired or moved), recorded in the slot's history. */
  async release(slotId: string, note: string, actor: BookingActor, tx: Queryable): Promise<void> {
    const before = await this.availability.findSlotForUpdate(slotId, tx);
    const released = await this.availability.releaseSlot(slotId, tx);
    if (before && released) {
      await this.recordSlot(SLOT_BOOKING_ACTION.released, before, released, note, actor, tx);
    }
  }

  /**
   * Books a slot the caller has already claimed: price from the profile's nationality, the booking,
   * its appointment code and its Part 2 form, the audit entries and the "new booking" notification.
   */
  async createOnSlot(contact: ContactRow, slot: SlotRow, options: NewBookingOptions, actor: BookingActor, tx: Queryable): Promise<string> {
    const price = rateForResidency(
      {
        rateLkrMinor: slot.rate_lkr_minor === null ? null : Number(slot.rate_lkr_minor),
        rateUsdMinor: slot.rate_usd_minor === null ? null : Number(slot.rate_usd_minor),
      },
      contact.residency,
    );
    const booking = await this.bookings.insert(
      {
        contactId: contact.id,
        slotId: slot.id,
        practitionerId: slot.practitioner_id,
        start: slot.slot_start,
        end: slot.slot_end,
        residency: contact.residency,
        rateMinor: price.amountMinor,
        currency: price.currency,
        ...options,
      },
      tx,
    );
    const code = await this.issueCode(booking.id, slot.slot_start, options.bookingType, contact.gender, tx);
    await this.intakeForms.createForBooking(contact.id, booking.id, tx);
    await this.record(
      BOOKING_AUDIT_ACTION.created,
      booking.id,
      undefined,
      {
        slotId: slot.id,
        start: slot.slot_start.toISOString(),
        status: options.status,
        bookedVia: options.bookedVia,
        paymentMode: options.paymentMode,
        price,
        appointmentCode: code,
      },
      undefined,
      actor,
      tx,
    );
    const via = options.bookedVia === 'staff' ? ' (staff)' : options.bookedVia === 'walk_in' ? ' (walk-in)' : '';
    await this.notifications.notify(
      {
        section: 'bookings',
        type: 'new_booking',
        severity: 'info',
        message: `New booking${via}: ${contact.name} — ${describeSession(slot.slot_start)}`,
        entityType: 'booking',
        entityId: booking.id,
      },
      tx,
    );
    return booking.id;
  }

  /** A new code for the booking's (new) session date; the old one stays in its history. */
  async issueCode(bookingId: string, start: Date, bookingType: BookingType, gender: string | null, tx: Queryable): Promise<string> {
    const sequence = await this.bookings.nextAppointmentSequence(clinicDateOf(start), tx);
    const code = formatAppointmentCode(start, bookingType, gender, sequence);
    await this.bookings.setAppointmentCode(bookingId, code, tx);
    return code;
  }

  /** A transaction that may lose a slot race at the unique index (the backstop): SLOT_UNAVAILABLE. */
  async write<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    try {
      return await this.db.transaction(work);
    } catch (error) {
      if (isUniqueViolation(error, ACTIVE_BOOKING_SLOT_INDEX)) {
        throw new SlotUnavailableException(error);
      }
      throw error;
    }
  }

  /** After the commit: each touched slot's calendar event catches up (never throws). */
  async afterCommit(...slotIds: string[]): Promise<void> {
    for (const slotId of new Set(slotIds)) {
      await this.calendarEvents.pushAfterChange(slotId);
    }
  }

  /**
   * After the commit: tells the client about the booking by WhatsApp/SMS and email, as it now
   * stands. Runs in the background and never throws, so a slow or failing provider never delays or
   * fails the change; every outcome is in message_log.
   */
  messageClient(bookingId: string, build: (details: BookingMessageDetails) => ClientMessage): void {
    void (async () => {
      const booking = await this.bookings.findView(bookingId);
      if (!booking) {
        return;
      }
      const message = build({ clientName: booking.contact_name, start: booking.slot_start, appointmentCode: booking.appointment_code });
      await this.messaging.sendToContact(
        { id: booking.contact_id, phone: booking.contact_phone, email: booking.contact_email },
        { ...message, entity: { type: 'booking', id: booking.id } },
      );
    })().catch((error: unknown) => {
      this.logger.error(`Booking message for ${bookingId} failed`, error instanceof Error ? error.stack : undefined);
    });
  }

  async view(id: string): Promise<BookingViewRow> {
    const row = await this.bookings.findView(id);
    if (!row) {
      throw new BookingNotFoundException();
    }
    return row;
  }

  record(
    action: string,
    bookingId: string,
    before: unknown,
    after: unknown,
    note: string | undefined,
    actor: BookingActor,
    tx: Queryable,
  ): Promise<void> {
    return this.audit.record({ ...actor, action, entityType: 'booking', entityId: bookingId, before, after, note }, tx);
  }

  /** A slot opened by the walk-in kiosk, in the slot's history as staff-made ones are. */
  recordSlotCreated(slot: SlotRow, note: string, actor: BookingActor, tx: Queryable): Promise<void> {
    return this.audit.record(
      { ...actor, action: 'slot.created', entityType: 'availability_slot', entityId: slot.id, after: slotSnapshot(slot), note },
      tx,
    );
  }

  private recordSlot(action: string, before: SlotRow, after: SlotRow, note: string | undefined, actor: BookingActor, tx: Queryable): Promise<void> {
    return this.audit.record(
      {
        ...actor,
        action,
        entityType: 'availability_slot',
        entityId: before.id,
        before: slotSnapshot(before),
        after: slotSnapshot(after),
        note,
      },
      tx,
    );
  }
}
