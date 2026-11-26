import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PhoneOtpPurpose } from '@remedist/shared';
import { JWT_ISSUER } from '../../common/auth/auth.constants';
import { AppConfig } from '../../config/app-config';
import { JWT_AUDIENCE_PHONE_VERIFICATION, PHONE_VERIFICATION_TOKEN_TTL_SECONDS } from './otp.constants';
import { PhoneNotVerifiedException } from './otp.exceptions';

interface PhoneVerificationClaims {
  /** The verified phone, E.164. */
  sub: string;
  /** What it was verified for. A token for one purpose never works for another. */
  pur: PhoneOtpPurpose;
}

/**
 * Proof that a phone number passed a code check, as a short-lived signed token. The check-code
 * endpoint issues it; a later step (a booking, a phone login) calls `requireVerifiedPhone` instead
 * of trusting a "verified" flag from the browser.
 *
 * Signed with the client secret but its own audience, so it can never pass as a sign-in token.
 */
@Injectable()
export class PhoneVerificationService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async issue(phoneNumber: string, purpose: PhoneOtpPurpose): Promise<{ token: string; expiresAt: Date }> {
    const claims: PhoneVerificationClaims = { sub: phoneNumber, pur: purpose };
    const token = await this.jwt.signAsync(claims, {
      secret: this.config.auth.clientJwtSecret,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE_PHONE_VERIFICATION,
      expiresIn: PHONE_VERIFICATION_TOKEN_TTL_SECONDS,
      algorithm: 'HS256',
    });
    return { token, expiresAt: new Date(Date.now() + PHONE_VERIFICATION_TOKEN_TTL_SECONDS * 1000) };
  }

  /**
   * Returns the verified phone (E.164) if the token is valid and for this purpose. Throws
   * PhoneNotVerifiedException otherwise. Pass `expectedPhone` when the request also names the
   * phone, so a token for one number can't be used with another.
   */
  async requireVerifiedPhone(token: string | undefined, purpose: PhoneOtpPurpose, expectedPhone?: string): Promise<string> {
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
    if (claims.pur !== purpose || (expectedPhone !== undefined && claims.sub !== expectedPhone)) {
      throw new PhoneNotVerifiedException();
    }
    return claims.sub;
  }
}
