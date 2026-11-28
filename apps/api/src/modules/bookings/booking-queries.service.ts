import { Injectable } from '@nestjs/common';
import {
  addDays,
  clinicDateTime,
  daysBetween,
  type AdminBooking,
  type AdminBookingDetail,
  type AdminBookingListMeta,
  type PortalBooking,
} from '@remedist/shared';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import { ValidationFailedException } from '../../common/exceptions/common.exceptions';
import { WithMeta } from '../../common/responses/with-meta';
import { ContactAccessService } from '../contacts/contact-access.service';
import { ContactsRepository } from '../contacts/contacts.repository';
import { BookingCoreService } from './booking-core.service';
import { BOOKING_LIST_DEFAULT_PAGE_SIZE } from './bookings.constants';
import { BookingNotFoundException } from './bookings.exceptions';
import { toAdminBooking, toPortalBooking } from './bookings.mapper';
import { BookingsRepository } from './bookings.repository';
import { AdminBookingQueryDto } from './dto/bookings.dto';

/** Reading bookings: the client's own (and dependents'), and the CRM list and detail. */
@Injectable()
export class BookingQueriesService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly core: BookingCoreService,
    private readonly contacts: ContactsRepository,
    private readonly access: ContactAccessService,
  ) {}

  async listForClient(client: CurrentClientAccount, contactId?: string): Promise<PortalBooking[]> {
    const { contact } = await this.access.requireOwned(client, contactId);
    const now = new Date();
    return (await this.bookings.listForContact(contact.id)).map((row) => toPortalBooking(row, now));
  }

  /** Past sessions of the whole family, newest first (the old /api/portal/history). */
  async historyForClient(client: CurrentClientAccount): Promise<PortalBooking[]> {
    const dependents = await this.contacts.listDependents(client.id);
    const now = new Date();
    return (await this.bookings.history([client.contactId, ...dependents.map((d) => d.id)])).map((row) => toPortalBooking(row, now));
  }

  /** The client's booking or a dependent's; anyone else's is not found. */
  async getForClient(client: CurrentClientAccount, bookingId: string): Promise<PortalBooking> {
    const row = await this.core.view(bookingId);
    if (!(await this.contacts.findOwned(client.id, client.contactId, row.contact_id))) {
      throw new BookingNotFoundException();
    }
    return toPortalBooking(row);
  }

  async list(query: AdminBookingQueryDto): Promise<WithMeta<AdminBooking[], AdminBookingListMeta & Record<string, unknown>>> {
    if ((query.from === undefined) !== (query.to === undefined)) {
      throw new ValidationFailedException([{ field: 'to', messages: ['Give both from and to, or neither'] }]);
    }
    if (query.from && query.to && daysBetween(query.from, query.to) < 0) {
      throw new ValidationFailedException([{ field: 'to', messages: ['to must be on or after from'] }]);
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? BOOKING_LIST_DEFAULT_PAGE_SIZE;
    const { rows, total } = await this.bookings.list({
      from: query.from ? clinicDateTime(query.from, '00:00') : undefined,
      to: query.to ? clinicDateTime(addDays(query.to, 1), '00:00') : undefined,
      status: query.status,
      contactId: query.contactId,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return new WithMeta(rows.map(toAdminBooking), { page, pageSize, total });
  }

  async detail(bookingId: string): Promise<AdminBookingDetail> {
    const row = await this.core.view(bookingId);
    const [codes, strikes, contact] = await Promise.all([
      this.bookings.appointmentCodes(bookingId),
      this.bookings.strikeCount(row.contact_id),
      this.contacts.findById(row.contact_id),
    ]);
    return {
      ...toAdminBooking(row),
      appointmentCodes: codes.map((c) => ({
        code: c.code,
        createdAt: c.created_at.toISOString(),
        supersededAt: c.superseded_at?.toISOString() ?? null,
      })),
      contactStrikeCount: strikes,
      contactPayAfterSession: contact?.pay_after_session ?? false,
    };
  }
}
