import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  Permission,
  type AdminSlot,
  type PractitionerSummary,
  type PublicAvailableDates,
  type PublicSlotDay,
  type SessionType,
  type SlotHistoryEntry,
} from '@remedist/shared';
import type { Request } from 'express';
import { CurrentUser, PublicRoute, StaffOnly } from '../../common/auth/auth.decorators';
import { clientInfo } from '../../common/auth/client-info';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import {
  AdminSlotQueryDto,
  BlockSlotDto,
  CreateSessionTypeDto,
  CreateSlotDto,
  PublicDatesQueryDto,
  PublicSlotsQueryDto,
  SessionTypeListQueryDto,
  SessionTypeParamsDto,
  SlotHistoryQueryDto,
  SlotParamsDto,
  UpdateSessionTypeDto,
  UpdateSlotDto,
} from './dto/availability.dto';
import { SessionTypesService } from './session-types.service';
import { SlotsService } from './slots.service';

/** Bookable slots for the booking page. PUBLIC_AVAILABILITY_ROUTES. */
@Controller('public/availability')
@PublicRoute()
export class PublicAvailabilityController {
  constructor(private readonly slots: SlotsService) {}

  @Get('slots')
  @ResponseMessage('Available slots')
  day(@Query() query: PublicSlotsQueryDto): Promise<PublicSlotDay> {
    return this.slots.publicDay(query.date, query.practitionerId);
  }

  @Get('dates')
  @ResponseMessage('Days with available slots')
  dates(@Query() query: PublicDatesQueryDto): Promise<PublicAvailableDates> {
    return this.slots.publicDates(query);
  }
}

/** The CRM availability panel. ADMIN_AVAILABILITY_ROUTES; everything needs schedule.manage. */
@Controller('admin/availability')
@StaffOnly(Permission.SCHEDULE_MANAGE)
export class AdminAvailabilityController {
  constructor(private readonly slots: SlotsService) {}

  @Get('slots')
  @ResponseMessage('Slots')
  list(@Query() query: AdminSlotQueryDto): Promise<AdminSlot[]> {
    return this.slots.list(query);
  }

  @Post('slots')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Slot opened')
  create(@Body() body: CreateSlotDto, @CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<AdminSlot> {
    return this.slots.create(body, staff, clientInfo(request));
  }

  @Patch('slots/:slotId')
  @ResponseMessage('Slot updated')
  update(
    @Param() params: SlotParamsDto,
    @Body() body: UpdateSlotDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<AdminSlot> {
    return this.slots.update(params.slotId, body, staff, clientInfo(request));
  }

  @Delete('slots/:slotId')
  @ResponseMessage('Slot deleted')
  async remove(@Param() params: SlotParamsDto, @CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<null> {
    await this.slots.remove(params.slotId, staff, clientInfo(request));
    return null;
  }

  @Post('slots/:slotId/block')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Slot blocked')
  block(
    @Param() params: SlotParamsDto,
    @Body() body: BlockSlotDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<AdminSlot> {
    return this.slots.block(params.slotId, body, staff, clientInfo(request));
  }

  @Post('slots/:slotId/unblock')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Slot reopened')
  unblock(@Param() params: SlotParamsDto, @CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<AdminSlot> {
    return this.slots.unblock(params.slotId, staff, clientInfo(request));
  }

  @Post('slots/:slotId/acknowledge-flag')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Flag cleared')
  acknowledgeFlag(@Param() params: SlotParamsDto, @CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<AdminSlot> {
    return this.slots.acknowledgeFlag(params.slotId, staff, clientInfo(request));
  }

  @Get('history')
  @ResponseMessage('Slot history')
  history(@Query() query: SlotHistoryQueryDto): Promise<SlotHistoryEntry[]> {
    return this.slots.history(query.slotId, query.limit);
  }

  @Get('practitioners')
  @ResponseMessage('Practitioners')
  practitioners(): Promise<PractitionerSummary[]> {
    return this.slots.practitioners();
  }
}

/** Session types. ADMIN_AVAILABILITY_ROUTES.sessionTypes; schedule.manage. */
@Controller('admin/session-types')
@StaffOnly(Permission.SCHEDULE_MANAGE)
export class SessionTypesController {
  constructor(private readonly sessionTypes: SessionTypesService) {}

  @Get()
  @ResponseMessage('Session types')
  list(@Query() query: SessionTypeListQueryDto): Promise<SessionType[]> {
    return this.sessionTypes.list(query.includeRetired ?? false);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Session type added')
  create(@Body() body: CreateSessionTypeDto, @CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<SessionType> {
    return this.sessionTypes.create(body, staff, clientInfo(request));
  }

  @Patch(':sessionTypeId')
  @ResponseMessage('Session type updated. Slots already opened keep their own length and prices.')
  update(
    @Param() params: SessionTypeParamsDto,
    @Body() body: UpdateSessionTypeDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<SessionType> {
    return this.sessionTypes.update(params.sessionTypeId, body, staff, clientInfo(request));
  }

  @Post(':sessionTypeId/retire')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Session type retired')
  retire(@Param() params: SessionTypeParamsDto, @CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<SessionType> {
    return this.sessionTypes.retire(params.sessionTypeId, staff, clientInfo(request));
  }

  @Post(':sessionTypeId/restore')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Session type restored')
  restore(@Param() params: SessionTypeParamsDto, @CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<SessionType> {
    return this.sessionTypes.restore(params.sessionTypeId, staff, clientInfo(request));
  }
}
