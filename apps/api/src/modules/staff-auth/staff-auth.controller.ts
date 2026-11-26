import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { StaffProfile, StaffSession } from '@remedist/shared';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser, PublicRoute, StaffSignedIn } from '../../common/auth/auth.decorators';
import type { CurrentStaff } from '../../common/auth/current-staff';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { getRequestId } from '../../common/logging/request-logging.middleware';
import { AppConfig } from '../../config/app-config';
import { StaffLoginDto } from './dto/staff-login.dto';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './staff-auth.constants';
import { SessionExpiredException } from './staff-auth.exceptions';
import { ClientInfo, IssuedSession, StaffAuthService } from './staff-auth.service';
import { TrustedOriginGuard } from './trusted-origin.guard';

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
    const issued = await this.auth.login(body.email, body.password, this.clientInfo(request));
    return this.withCookie(response, issued);
  }

  @Post('refresh')
  @PublicRoute()
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Session refreshed')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<StaffSession> {
    const token = this.readCookie(request);
    if (!token) {
      throw new SessionExpiredException();
    }
    try {
      return this.withCookie(response, await this.auth.refresh(token, this.clientInfo(request)));
    } catch (error) {
      if (error instanceof SessionExpiredException) {
        this.clearCookie(response);
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
    await this.auth.logout(this.readCookie(request));
    this.clearCookie(response);
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
    await this.auth.logoutEverywhere(staff, this.clientInfo(request));
    this.clearCookie(response);
    return null;
  }

  @Get('me')
  @StaffSignedIn()
  @ResponseMessage('Signed-in staff member')
  me(@CurrentUser() staff: CurrentStaff): StaffProfile {
    return this.auth.toProfile(staff);
  }

  // ── helpers ──

  private clientInfo(request: Request): ClientInfo {
    return {
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      requestId: getRequestId(request),
    };
  }

  private readCookie(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[REFRESH_COOKIE_NAME];
    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    };
  }

  private withCookie(response: Response, issued: IssuedSession): StaffSession {
    response.cookie(REFRESH_COOKIE_NAME, issued.refreshToken, {
      ...this.cookieOptions(),
      expires: issued.refreshExpiresAt,
    });
    return issued.session;
  }

  private clearCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
  }
}
