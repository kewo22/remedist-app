import { Injectable, Logger } from '@nestjs/common';
import type {
  PhoneOtpPurpose,
  PhoneOtpSendResponse,
  PhoneOtpVerifyResponse,
} from '@remedist/shared';
import { failDelay, sixDigitCode } from '../../common/auth/auth-tokens';
import type { ClientInfo } from '../../common/auth/client-info';
import { AppConfig } from '../../config/app-config';
import { PhoneDeliveryError, PhoneMessenger, maskPhone } from '../../integrations/messaging/phone-messenger';
import { verificationCodeMessage } from '../messaging/templates/verification-code';
import { PhoneCodeExpiredException, PhoneCodeNotSentException, WrongPhoneCodeException } from './otp.exceptions';
import { OtpService } from './otp.service';
import type { OtpIdentifier } from './otp.types';
import { PhoneVerificationService } from './phone-verification.service';

const DAILY_CAP_MESSAGE = 'Verification codes are temporarily unavailable — please try again later.';

/**
 * Phone verification by code, ported from the old /api/otp routes. Every send passes the OTP
 * limits (blocklist, daily cap, windows, cooldown) and, from the second send in 15 minutes, a
 * Turnstile check, before WhatsApp or SMS is ever called.
 */
@Injectable()
export class PhoneOtpService {
  private readonly logger = new Logger(PhoneOtpService.name);

  constructor(
    private readonly otp: OtpService,
    private readonly messenger: PhoneMessenger,
    private readonly verification: PhoneVerificationService,
    private readonly config: AppConfig,
  ) {}

  async send(
    phoneNumber: string,
    purpose: PhoneOtpPurpose,
    turnstileToken: string | undefined,
    client: ClientInfo,
  ): Promise<PhoneOtpSendResponse> {
    const identifier: OtpIdentifier = { kind: 'phone', value: phoneNumber };
    await this.otp.assertCanSend(identifier, client.ipAddress, purpose, DAILY_CAP_MESSAGE);
    await this.otp.assertChallengePassed(identifier, client.ipAddress, purpose, turnstileToken);

    const code = sixDigitCode();
    const ttlMinutes = this.config.otp.codeTtlMinutes;

    let sent;
    try {
      sent = await this.messenger.send(phoneNumber, verificationCodeMessage(code, ttlMinutes, 'verification'));
    } catch (error) {
      // Still recorded, so retries against a failing number count towards the limits.
      await this.otp.recordIssued({
        identifier,
        ipAddress: client.ipAddress,
        purpose,
        channel: error instanceof PhoneDeliveryError && error.lastTried ? error.lastTried.channel : 'whatsapp',
        code,
        ttlMinutes,
        deliveryStatus: 'failed',
      });
      this.logger.error(`Code to ${maskPhone(phoneNumber)} could not be sent`, error instanceof Error ? error.stack : undefined);
      throw new PhoneCodeNotSentException(error);
    }

    const expiresAt = await this.otp.recordIssued({
      identifier,
      ipAddress: client.ipAddress,
      purpose,
      channel: sent.channel,
      code,
      ttlMinutes,
      deliveryStatus: sent.status,
    });
    return {
      channel: sent.channel,
      expiresAt: expiresAt.toISOString(),
      nextResendWaitSeconds: await this.otp.nextCooldownSeconds(identifier),
      // 'skipped' only comes from a demo sender: nothing was sent, so show the code outside production.
      devCode: sent.status === 'skipped' && !this.config.isProduction ? code : undefined,
    };
  }

  /**
   * Checks the code. A wrong guess (the code still works) is a 400; anything else (expired, used,
   * too many wrong guesses, never sent) a 410, so the page offers a new code. Success returns a
   * signed proof for this phone and purpose.
   */
  async verify(phoneNumber: string, purpose: PhoneOtpPurpose, code: string): Promise<PhoneOtpVerifyResponse> {
    const result = await this.otp.verify({ kind: 'phone', value: phoneNumber }, purpose, code);
    if (!result.verified) {
      await failDelay();
      throw result.reason === 'mismatch' ? new WrongPhoneCodeException() : new PhoneCodeExpiredException();
    }
    const proof = await this.verification.issue(phoneNumber, purpose, result.requestId);
    return {
      verified: true,
      phoneNumber,
      purpose,
      phoneVerificationToken: proof.token,
      expiresAt: proof.expiresAt.toISOString(),
    };
  }
}
