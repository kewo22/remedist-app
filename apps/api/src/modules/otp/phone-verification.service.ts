import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PhoneOtpPurpose } from '@remedist/shared';
import { JWT_ISSUER } from '../../common/auth/auth.constants';
import { AppConfig } from '../../config/app-config';
import type { Queryable } from '../../database/database.service';
import { JWT_AUDIENCE_PHONE_VERIFICATION, PHONE_VERIFICATION_TOKEN_TTL_SECONDS } from './otp.constants';
import { PhoneNotVerifiedException } from './otp.exceptions';
import { OtpRepository } from './otp.repository';

interface PhoneVerificationClaims {
  /** The verified phone, E.164. */
  sub: string;
  /** What it was verified for. A token for one purpose never works for another. */
  pur: PhoneOtpPurpose;
  /** The auth.otp_requests row the code matched, so the proof can be spent once (useVerifiedPhone). */
  jti: string;
}

/** A checked proof: the phone it's for and the code row behind it. */
export interface VerifiedPhone {
  phoneNumber: string;
  otpRequestId: string;
}

/**
 * Proof that a phone number passed a code check, as a short-lived signed token. The check-code
 * endpoint issues it; a later step (a booking, a phone login) checks it instead of trusting a
 * "verified" flag from the browser.
 *
 * Signed with the client secret but its own audience, so it can never pass as a sign-in token.
 */
@Injectable()
export class PhoneVerificationService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly repository: OtpRepository,
  ) {}

  async issue(phoneNumber: string, purpose: PhoneOtpPurpose, otpRequestId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = await this.jwt.signAsync(
      { sub: phoneNumber, pur: purpose },
      {
        secret: this.config.auth.clientJwtSecret,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE_PHONE_VERIFICATION,
        expiresIn: PHONE_VERIFICATION_TOKEN_TTL_SECONDS,
        jwtid: otpRequestId,
        algorithm: 'HS256',
      },
    );
    return { token, expiresAt: new Date(Date.now() + PHONE_VERIFICATION_TOKEN_TTL_SECONDS * 1000) };
  }

  /**
   * Returns the verified phone (E.164) if the token is valid and for this purpose. Throws
   * PhoneNotVerifiedException otherwise. Pass `expectedPhone` when the request also names the
   * phone, so a token for one number can't be used with another. Doesn't spend the token: a step
   * that completes something with it (a sign-in) calls `useVerifiedPhone` as well.
   */
  async requireVerifiedPhone(token: string | undefined, purpose: PhoneOtpPurpose, expectedPhone?: string): Promise<string> {
    return (await this.check(token, purpose, expectedPhone)).phoneNumber;
  }

  /**
   * Spends the proof, inside the caller's transaction so it's only used up if that step commits.
   * Throws PhoneNotVerifiedException if it was already used.
   */
  async useVerifiedPhone(verified: VerifiedPhone, purpose: PhoneOtpPurpose, db: Queryable): Promise<void> {
    if (!(await this.repository.useProof(verified.otpRequestId, verified.phoneNumber, purpose, db))) {
      throw new PhoneNotVerifiedException();
    }
  }

  /** Verifies the token's signature, expiry, purpose and phone. */
  async check(token: string | undefined, purpose: PhoneOtpPurpose, expectedPhone?: string): Promise<VerifiedPhone> {
    if (!token) {
      throw new PhoneNotVerifiedException();
    }
    let claims: PhoneVerificationClaims;
    try {
      claims = await this.jwt.verifyAsync<PhoneVerificationClaims>(token, {
        secret: this.config.auth.clientJwtSecret,
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE_PHONE_VERIFICATION,
        algorithms: ['HS256'],
      });
    } catch {
      throw new PhoneNotVerifiedException();
    }
    if (
      claims.pur !== purpose ||
      typeof claims.jti !== 'string' ||
      (expectedPhone !== undefined && claims.sub !== expectedPhone)
    ) {
      throw new PhoneNotVerifiedException();
    }
    return { phoneNumber: claims.sub, otpRequestId: claims.jti };
  }
}
