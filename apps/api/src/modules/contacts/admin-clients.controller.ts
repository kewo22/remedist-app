import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import { Permission, type ClientDetail, type ClientListItem, type ClientListMeta, type ClientLookupItem } from '@remedist/shared';
import type { Request } from 'express';
import { CurrentUser, StaffOnly } from '../../common/auth/auth.decorators';
import { clientInfo } from '../../common/auth/client-info';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { WithMeta } from '../../common/responses/with-meta';
import { AdminClientsService } from './admin-clients.service';
import {
  ClientListQueryDto,
  ClientLookupQueryDto,
  CorrectIdentityDto,
  StaffUpdateClientDto,
  UpdatePaymentSettingsDto,
  UpdateReferralDto,
} from './dto/admin-clients.dto';

/** CRM clients. Routes match ADMIN_CLIENT_ROUTES. */
@Controller('admin/clients')
export class AdminClientsController {
  constructor(private readonly clients: AdminClientsService) {}

  @Get()
  @StaffOnly(Permission.PATIENTS_MANAGE)
  @ResponseMessage('Clients')
  list(@Query() query: ClientListQueryDto): Promise<WithMeta<ClientListItem[], ClientListMeta & Record<string, unknown>>> {
    return this.clients.list(query);
  }

  // Declared before ':id' so "lookup" isn't read as an id.
  @Get('lookup')
  @StaffOnly(Permission.PATIENTS_MANAGE)
  @ResponseMessage('Matching clients')
  lookup(@Query() query: ClientLookupQueryDto): Promise<ClientLookupItem[]> {
    return this.clients.lookup(query.q);
  }

  @Get(':id')
  @StaffOnly(Permission.PATIENTS_MANAGE)
  @ResponseMessage('Client')
  detail(@Param('id', ParseUUIDPipe) id: string): Promise<ClientDetail> {
    return this.clients.detail(id);
  }

  @Patch(':id')
  @StaffOnly(Permission.PATIENTS_MANAGE)
  @ResponseMessage('Client updated')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: StaffUpdateClientDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<ClientDetail> {
    return this.clients.update(id, body, staff, clientInfo(request));
  }

  @Patch(':id/identity')
  @StaffOnly(Permission.PATIENTS_MANAGE, Permission.PATIENTS_CORRECT_IDENTITY)
  @ResponseMessage('Registration details corrected')
  correctIdentity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CorrectIdentityDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<ClientDetail> {
    return this.clients.correctIdentity(id, body, staff, clientInfo(request));
  }

  @Patch(':id/referral')
  @StaffOnly(Permission.PATIENTS_MANAGE)
  @ResponseMessage('Referral updated')
  setReferral(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateReferralDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<ClientDetail> {
    return this.clients.setReferral(id, body, staff, clientInfo(request));
  }

  @Patch(':id/payment-settings')
  @StaffOnly(Permission.PATIENTS_MANAGE, Permission.BILLING_MANAGE)
  @ResponseMessage('Payment settings updated')
  setPaymentSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePaymentSettingsDto,
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
  ): Promise<ClientDetail> {
    return this.clients.setPaymentSettings(id, body, staff, clientInfo(request));
  }
}
