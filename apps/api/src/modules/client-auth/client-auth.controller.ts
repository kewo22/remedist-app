import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { ClientProfile, ClientRegisterResponse, ClientSession, ForgotPasswordResponse } from '@remedist/shared';
import type { Request, Response } from 'express';
import { ClientSignedIn, CurrentClient, PublicRoute } from '../../common/auth/auth.decorators';
import { SessionExpiredException } from '../../common/auth/auth.exceptions';
import { clientInfo } from '../../common/auth/client-info';
import type { CurrentClientAccount } from '../../common/auth/current-client';
import { RefreshCookie } from '../../common/auth/refresh-cookie';
import { TrustedOriginGuard } from '../../common/auth/trusted-origin.guard';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AppConfig } from '../../config/app-config';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './client-auth.constants';
import { ClientAuthService, IssuedClientSession } from './client-auth.service';
import {
  ClientGoogleSignInDto,
  ClientLoginDto,
  ClientPhoneSignInDto,
  ClientRegisterDto,
  ClientVerifyEmailDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from './dto/client-auth.dto';

const refreshCookie = new RefreshCookie(REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH);

/** Client (patient portal) sign-up, sign-in, password reset and sessions. Routes match CLIENT_AUTH_ROUTES. */
@Controller('portal/auth')
export class ClientAuthController {
  constructor(
    private readonly auth: ClientAuthService,
    private readonly config: AppConfig,
  ) {}

  @Post('register')
  @PublicRoute()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Account created. Check your email for a verification code.')
  register(@Body() body: ClientRegisterDto, @Req() request: Request): Promise<ClientRegisterResponse> {
    return this.auth.register(body.name, body.email, body.password, clientInfo(request));
  }

  @Post('verify-email')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Email verified')
  async verifyEmail(
    @Body() body: ClientVerifyEmailDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientSession> {
    return this.withCookie(response, await this.auth.verifyEmail(body.email, body.code, clientInfo(request)));
  }

  @Post('login')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in')
  async login(
    @Body() body: ClientLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientSession> {
    return this.withCookie(response, await this.auth.login(body.email, body.password, clientInfo(request)));
  }

  @Post('google')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in with Google')
  async google(
    @Body() body: ClientGoogleSignInDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientSession> {
    return this.withCookie(response, await this.auth.signInWithGoogle(body.idToken, clientInfo(request)));
  }

  @Post('phone')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed in')
  async phone(
    @Body() body: ClientPhoneSignInDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientSession> {
    return this.withCookie(response, await this.auth.signInWithPhone(body.phoneVerificationToken, clientInfo(request)));
  }

  @Post('forgot-password')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('If an account exists for that email, we sent a reset code.')
  forgotPassword(@Body() body: ForgotPasswordDto, @Req() request: Request): Promise<ForgotPasswordResponse> {
    return this.auth.forgotPassword(body.email, body.channel, body.turnstileToken, clientInfo(request));
  }

  @Post('reset-password')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password reset — you are now signed in.')
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ClientSession> {
    return this.withCookie(
      response,
      await this.auth.resetPassword(body.email, body.channel, body.code, body.newPassword, clientInfo(request)),
    );
  }

  @Post('refresh')
  @PublicRoute()
  @UseGuards(TrustedOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Session refreshed')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<ClientSession> {
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
  @ClientSignedIn()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Signed out on every device')
  async logoutAll(
    @CurrentClient() client: CurrentClientAccount,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<null> {
    await this.auth.logoutEverywhere(client, clientInfo(request));
    refreshCookie.clear(response, this.config.isProduction);
    return null;
  }

  @Get('me')
  @ClientSignedIn()
  @ResponseMessage('Signed-in client')
  me(@CurrentClient() client: CurrentClientAccount): Promise<ClientProfile> {
    return this.auth.profile(client);
  }

  private withCookie(response: Response, issued: IssuedClientSession): ClientSession {
    refreshCookie.set(response, issued.refreshToken, issued.refreshExpiresAt, this.config.isProduction);
    return issued.session;
  }
}
