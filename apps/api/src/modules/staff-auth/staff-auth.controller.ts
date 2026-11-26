import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { StaffProfile, StaffSession } from '@remedist/shared';
import type { Request, Response } from 'express';
import { CurrentUser, PublicRoute, StaffSignedIn } from '../../common/auth/auth.decorators';
import { SessionExpiredException } from '../../common/auth/auth.exceptions';
import { clientInfo } from '../../common/auth/client-info';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { RefreshCookie } from '../../common/auth/refresh-cookie';
import { TrustedOriginGuard } from '../../common/auth/trusted-origin.guard';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AppConfig } from '../../config/app-config';
import { StaffLoginDto } from './dto/staff-login.dto';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './staff-auth.constants';
import { IssuedStaffSession, StaffAuthService } from './staff-auth.service';

const refreshCookie = new RefreshCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH);

/** Staff (CRM) login, refresh, logout and sign-out-everywhere. Routes match STAFF_AUTH_ROUTES. */
@Controller('admin/auth')
export class StaffAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    private readonly config: AppConfig,
  ) {}

  @Post('login')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in')
  async login(
    @Body() body: StaffLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StaffSession> {
    return this.withCookie(response, await this.auth.login(body.email, body.password, clientInfo(request)));
  }

  @Post('refresh')
  @PublicRoute()
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Session refreshed')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<StaffSession> {
    const token = refreshCookie.read(request);
    if (!token) {
      throw new SessionExpiredException();
    }
    try {
      return this.withCookie(response, await this.auth.refresh(token, clientInfo(request)));
    } catch (error) {
      if (error instanceof SessionExpiredException) {
        refreshCookie.clear(response, this.config.isProduction);
      }
      throw error;
    }
  }

  @Post('logout')
  @PublicRoute()
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed out')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<null> {
    await this.auth.logout(refreshCookie.read(request));
    refreshCookie.clear(response, this.config.isProduction);
    return null;
  }

  @Post('logout-all')
  @StaffSignedIn()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed out on every device')
  async logoutAll(
    @CurrentUser() staff: CurrentStaff,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<null> {
    await this.auth.logoutEverywhere(staff, clientInfo(request));
    refreshCookie.clear(response, this.config.isProduction);
    return null;
  }

  @Get('me')
  @StaffSignedIn()
  @ResponseMessage('Signed-in staff member')
  me(@CurrentUser() staff: CurrentStaff): StaffProfile {
    return this.auth.toProfile(staff);
  }

  private withCookie(response: Response, issued: IssuedStaffSession): StaffSession {
    refreshCookie.set(response, issued.refreshToken, issued.refreshExpiresAt, this.config.isProduction);
    return issued.session;
  }
}
