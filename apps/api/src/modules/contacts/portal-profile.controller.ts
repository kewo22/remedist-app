import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query, Req } from '@nestjs/common';
import type { ClientContactProfile, DependentSummary } from '@remedist/shared';
import type { Request } from 'express';
import { ClientSignedIn, CurrentClient } from '../../common/auth/auth.decorators';
import { clientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CreateDependentDto, ProfileQueryDto, UpdateClientProfileDto } from './dto/portal-profile.dto';
import { PortalProfileService } from './portal-profile.service';

/** The signed-in client's profile and dependents. Routes match PORTAL_PROFILE_ROUTES. */
@Controller('portal')
@ClientSignedIn()
export class PortalProfileController {
  constructor(private readonly profiles: PortalProfileService) {}

  @Get('profile')
  @ResponseMessage('Profile')
  profile(@CurrentClient() client: CurrentClientAccount, @Query() query: ProfileQueryDto): Promise<ClientContactProfile> {
    return this.profiles.profile(client, query.contactId);
  }

  @Patch('profile')
  @ResponseMessage('Profile updated')
  updateProfile(
    @CurrentClient() client: CurrentClientAccount,
    @Body() body: UpdateClientProfileDto,
    @Req() request: Request,
  ): Promise<ClientContactProfile> {
    return this.profiles.updateProfile(client, body, clientInfo(request));
  }

  @Get('dependents')
  @ResponseMessage('Dependents')
  dependents(@CurrentClient() client: CurrentClientAccount): Promise<DependentSummary[]> {
    return this.profiles.dependents(client);
  }

  @Post('dependents')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Dependent added. Complete their registration next.')
  addDependent(
    @CurrentClient() client: CurrentClientAccount,
    @Body() body: CreateDependentDto,
    @Req() request: Request,
  ): Promise<DependentSummary> {
    return this.profiles.addDependent(client, body, clientInfo(request));
  }
}
