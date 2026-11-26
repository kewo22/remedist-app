import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { PhoneOtpSendResponse, PhoneOtpVerifyResponse } from '@remedist/shared';
import type { Request } from 'express';
import { PublicRoute } from '../../common/auth/auth.decorators';
import { clientInfo } from '../../common/auth/client-info';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { PhoneOtpSendDto, PhoneOtpVerifyDto } from './dto/phone-otp.dto';
import { PhoneOtpService } from './phone-otp.service';

/** Public phone verification by code. Routes match PHONE_OTP_ROUTES. */
@Controller('public/otp')
@PublicRoute()
export class PhoneOtpController {
  constructor(private readonly phoneOtp: PhoneOtpService) {}

  @Post('send')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Verification code sent.')
  send(@Body() body: PhoneOtpSendDto, @Req() request: Request): Promise<PhoneOtpSendResponse> {
    return this.phoneOtp.send(body.phoneNumber, body.purpose, body.turnstileToken, clientInfo(request));
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Phone number verified.')
  verify(@Body() body: PhoneOtpVerifyDto): Promise<PhoneOtpVerifyResponse> {
    return this.phoneOtp.verify(body.phoneNumber, body.purpose, body.code);
  }
}
