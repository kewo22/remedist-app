import { Module } from '@nestjs/common';
import { OtpCapAlertService } from './otp-cap-alert.service';
import { OtpRepository } from './otp.repository';
import { OtpService } from './otp.service';
import { PhoneOtpController } from './phone-otp.controller';
import { PhoneOtpService } from './phone-otp.service';
import { PhoneVerificationService } from './phone-verification.service';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';

/**
 * One-time codes: the abuse limits and code records (shared with email verification and password
 * reset), the public phone verification endpoints, and the CRM security panel.
 * Other modules use PhoneVerificationService to require a verified phone.
 */
@Module({
  controllers: [PhoneOtpController, SecurityController],
  providers: [OtpRepository, OtpService, OtpCapAlertService, PhoneOtpService, PhoneVerificationService, SecurityService],
  exports: [OtpService, PhoneVerificationService],
})
export class OtpModule {}
