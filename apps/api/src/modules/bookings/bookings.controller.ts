import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  Permission,
  type AdminBooking,
  type AdminBookingDetail,
  type AdminBookingListMeta,
  type PortalBooking,
} from '@remedist/shared';
import type { Request } from 'express';
import { ClientSignedIn, CurrentClient, CurrentUser, StaffOnly } from '../../common/auth/auth.decorators';
import { clientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { WithMeta } from '../../common/responses/with-meta';
import { ProfileQueryDto } from '../contacts/dto/portal-profile.dto';
import { BookingChangesService } from './booking-changes.service';
import { BookingCreationService } from './booking-creation.service';
import { BookingQueriesService } from './booking-queries.service';
import {
  AdminBookingQueryDto,
  BookingParamsDto,
  CancelBookingDto,
  CreateBookingDto,
  RescheduleDto,
  StaffCreateBookingDto,
  UpdateStaffNotesDto,
} from './dto/bookings.dto';

/** The client's bookings and the walk-in kiosk. PORTAL_BOOKING_ROUTES. */
@Controller('portal')
@ClientSignedIn()
export class PortalBookingsController {
  constructor(
    private readonly creation: BookingCreationService,
    private readonly changes: BookingChangesService,
    private readonly queries: BookingQueriesService,
  ) {}

  @Get('bookings')
  @ResponseMessage('Bookings')
  list(@CurrentClient() client: CurrentClientAccount, @Query() query: ProfileQueryDto): Promise<PortalBooking[]> {
    return this.queries.listForClient(client, query.contactId);
  }

  // Declared before 'bookings/:bookingId' so "history" isn't read as an id.
  @Get('bookings/history')
  @ResponseMessage('Past sessions')
  history(@CurrentClient() client: CurrentClientAccount): Promise<PortalBooking[]> {
    return this.queries.historyForClient(client);
  }

  @Get('bookings/:bookingId')
  @ResponseMessage('Booking')
  get(@CurrentClient() client: CurrentClientAccount, @Param() params: BookingParamsDto): Promise<PortalBooking> {
    return this.queries.getForClient(client, params.bookingId);
  }

  @Post('bookings')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Booked')
  async book(@CurrentClient() client: CurrentClientAccount, @Body() body: CreateBookingDto, @Req() request: Request): Promise<PortalBooking> {
    const id = await this.creation.bookForClient(client, body, clientInfo(request));
    return this.queries.getForClient(client, id);
  }

  @Post('bookings/:bookingId/reschedule')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Booking rescheduled')
  async reschedule(
    @CurrentClient() client: CurrentClientAccount,
    @Param() params: BookingParamsDto,
    @Body() body: RescheduleDto,
    @Req() request: Request,
  ): Promise<PortalBooking> {
    await this.changes.rescheduleForClient(client, params.bookingId, body.slotId, clientInfo(request));
    return this.queries.getForClient(client, params.bookingId);
  }

  @Post('walk-in')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Welcome! Your session is booked.')
  async walkIn(@CurrentClient() client: CurrentClientAccount, @Req() request: Request): Promise<PortalBooking> {
    const id = await this.creation.walkIn(client, clientInfo(request));
    return this.queries.getForClient(client, id);
  }
}

/** Bookings in the CRM. ADMIN_BOOKING_ROUTES; everything needs schedule.manage. */
@Controller('admin/bookings')
@StaffOnly(Permission.SCHEDULE_MANAGE)
export class AdminBookingsController {
  constructor(
    private readonly creation: BookingCreationService,
    private readonly changes: BookingChangesService,
    private readonly queries: BookingQueriesService,
  ) {}

  @Get()
  @ResponseMessage('Bookings')
  list(@Query() query: AdminBookingQueryDto): Promise<WithMeta<AdminBooking[], AdminBookingListMeta & Record<string, unknown>>> {
    return this.queries.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Booking created')
  async create(@Body() body: StaffCreateBookingDto, @CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<AdminBookingDetail> {
    const id = await this.creation.bookForStaff(staff, body, clientInfo(request));
    return this.queries.detail(id);
  }

  @Get(':bookingId')
  @ResponseMessage('Booking')
  get(@Param() params: BookingParamsDto): Promise<AdminBookingDetail> {
    return this.queries.detail(params.bookingId);
  }

  @Post(':bookingId/reschedule')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Booking rescheduled')
  async reschedule(
    @Param() params: BookingParamsDto,
    @Body() body: RescheduleDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<AdminBookingDetail> {
    await this.changes.rescheduleForStaff(staff, params.bookingId, body.slotId, clientInfo(request));
    return this.queries.detail(params.bookingId);
  }

  @Post(':bookingId/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Booking cancelled')
  async cancel(
    @Param() params: BookingParamsDto,
    @Body() body: CancelBookingDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<AdminBookingDetail> {
    await this.changes.cancel(staff, params.bookingId, body.reason ?? null, clientInfo(request));
    return this.queries.detail(params.bookingId);
  }

  @Post(':bookingId/no-show')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Marked as a no-show')
  async noShow(@Param() params: BookingParamsDto, @CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<AdminBookingDetail> {
    await this.changes.markNoShow(staff, params.bookingId, clientInfo(request));
    return this.queries.detail(params.bookingId);
  }

  @Patch(':bookingId/notes')
  @ResponseMessage('Notes saved')
  async notes(
    @Param() params: BookingParamsDto,
    @Body() body: UpdateStaffNotesDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<AdminBookingDetail> {
    await this.changes.setStaffNotes(staff, params.bookingId, body.staffNotes ?? null, clientInfo(request));
    return this.queries.detail(params.bookingId);
  }
}
