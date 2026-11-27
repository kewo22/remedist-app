import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, Req } from '@nestjs/common';
import {
  Permission,
  type PublishedTerms,
  type TermsConsentStatus,
  type TermsDraft,
  type TermsVersion,
} from '@remedist/shared';
import type { Request } from 'express';
import { ClientSignedIn, CurrentClient, CurrentUser, PublicRoute, StaffOnly } from '../../common/auth/auth.decorators';
import { clientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ProfileQueryDto } from '../contacts/dto/portal-profile.dto';
import { AcceptTermsDto, UpdateTermsDraftDto } from './dto/terms.dto';
import { TermsService } from './terms.service';

/** The published terms, for the registration, booking and re-consent forms. PUBLIC_TERMS_ROUTES. */
@Controller('public/terms')
@PublicRoute()
export class PublicTermsController {
  constructor(private readonly terms: TermsService) {}

  @Get('current')
  @ResponseMessage('Terms & Conditions')
  current(): Promise<PublishedTerms> {
    return this.terms.current();
  }
}

/** A client's consent. PORTAL_TERMS_ROUTES. */
@Controller('portal/terms')
@ClientSignedIn()
export class PortalTermsController {
  constructor(private readonly terms: TermsService) {}

  @Get('status')
  @ResponseMessage('Terms consent')
  status(@CurrentClient() client: CurrentClientAccount, @Query() query: ProfileQueryDto): Promise<TermsConsentStatus> {
    return this.terms.consentStatus(client, query.contactId);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Thank you for accepting our Terms & Conditions.')
  accept(
    @CurrentClient() client: CurrentClientAccount,
    @Body() body: AcceptTermsDto,
    @Req() request: Request,
  ): Promise<TermsConsentStatus> {
    return this.terms.accept(client, body, clientInfo(request));
  }
}

/** Editing and publishing the terms. ADMIN_TERMS_ROUTES. */
@Controller('admin/terms')
export class AdminTermsController {
  constructor(private readonly terms: TermsService) {}

  @Get('draft')
  @StaffOnly(Permission.CONTENT_MANAGE)
  @ResponseMessage('Terms draft')
  draft(): Promise<TermsDraft> {
    return this.terms.draft();
  }

  @Put('draft')
  @StaffOnly(Permission.CONTENT_MANAGE)
  @ResponseMessage('Draft saved. Clients see it once it’s published.')
  updateDraft(@Body() body: UpdateTermsDraftDto, @CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<TermsDraft> {
    return this.terms.updateDraft(body, staff, clientInfo(request));
  }

  /** Forces every client to accept again, so it's for owners (settings.manage), as in the old app. */
  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @StaffOnly(Permission.CONTENT_MANAGE, Permission.SETTINGS_MANAGE)
  @ResponseMessage('Terms published. Clients will accept them at their next booking.')
  publish(@CurrentUser() staff: CurrentStaff, @Req() request: Request): Promise<TermsVersion> {
    return this.terms.publish(staff, clientInfo(request));
  }

  @Get('history')
  @StaffOnly(Permission.CONTENT_MANAGE)
  @ResponseMessage('Published versions')
  history(): Promise<TermsVersion[]> {
    return this.terms.history();
  }
}
