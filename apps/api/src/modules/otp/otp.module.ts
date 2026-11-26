import { Module } from '@nestjs/common';
import { OtpCapAlertService } from './otp-cap-alert.service';
import { OtpRepository } from './otp.repository';
import { OtpService } from './otp.service';

/**
 * One-time-code limits and records, shared by email verification, password reset and (later)
 * the phone OTP endpoints. No routes of its own yet.
 */
@Module({
  providers: [OtpRepository, OtpService, OtpCapAlertService],
  exports: [OtpService],
})
export class OtpModule {}
