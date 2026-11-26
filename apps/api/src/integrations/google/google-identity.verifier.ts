import { Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import type { AppConfig } from '../../config/app-config';

/** The parts of a verified Google ID token the app uses. */
export interface GoogleIdentity {
  /** Google's stable account id (`sub`). */
  googleId: string;
  email: string;
  name: string;
  /** Whether Google has verified the person owns the email. */
  emailVerified: boolean;
}

/** The token is invalid, expired, for another app, or unusable. */
export class GoogleTokenRejectedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GoogleTokenRejectedError';
  }
}

/** Google sign-in can't be used here (no client id in production). */
export class GoogleSignInUnavailableError extends Error {
  constructor() {
    super('Google sign-in is not configured');
    this.name = 'GoogleSignInUnavailableError';
  }
}

/** Verifies Google ID tokens server-side. Never trust a token's claims just because a browser sent it. */
export abstract class GoogleIdentityVerifier {
  abstract readonly isDemo: boolean;
  abstract verify(idToken: string): Promise<GoogleIdentity>;
}

export class OAuthGoogleIdentityVerifier extends GoogleIdentityVerifier {
  readonly isDemo = false;
  private readonly client: OAuth2Client;

  constructor(private readonly clientId: string) {
    super();
    this.client = new OAuth2Client({ clientId });
  }

  async verify(idToken: string): Promise<GoogleIdentity> {
    let payload;
    try {
      // Checks the signature against Google's (cached) keys, the issuer, expiry and our audience.
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.clientId });
      payload = ticket.getPayload();
    } catch (error) {
      throw new GoogleTokenRejectedError('Google ID token failed verification', { cause: error });
    }
    if (!payload?.sub || !payload.email) {
      throw new GoogleTokenRejectedError('Google ID token has no subject or email');
    }
    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name?.trim() || payload.email,
      emailVerified: payload.email_verified === true,
    };
  }
}

const DEMO_PREFIX = 'demo:';

/**
 * No GOOGLE_OAUTH_CLIENT_ID. Outside production it accepts test tokens shaped
 * `demo:<email>[:<name>]` (a verified email), so the flow works locally. In production it refuses
 * everything: a missing client id must never mean "trust any token".
 */
export class DemoGoogleIdentityVerifier extends GoogleIdentityVerifier {
  readonly isDemo = true;

  constructor(private readonly allowTestTokens: boolean) {
    super();
  }

  verify(idToken: string): Promise<GoogleIdentity> {
    if (!this.allowTestTokens) {
      return Promise.reject(new GoogleSignInUnavailableError());
    }
    if (!idToken.startsWith(DEMO_PREFIX)) {
      return Promise.reject(new GoogleTokenRejectedError('Demo mode only accepts demo:<email>[:<name>] tokens'));
    }
    const [email = '', ...nameParts] = idToken.slice(DEMO_PREFIX.length).split(':');
    if (!email.includes('@')) {
      return Promise.reject(new GoogleTokenRejectedError('Demo token has no email'));
    }
    const name = nameParts.join(':').trim() || email;
    return Promise.resolve({ googleId: `demo-${email.toLowerCase()}`, email, name, emailVerified: true });
  }
}

export function createGoogleIdentityVerifier(config: AppConfig): GoogleIdentityVerifier {
  if (config.google.oauthClientId) {
    return new OAuthGoogleIdentityVerifier(config.google.oauthClientId);
  }
  const logger = new Logger('GoogleSignIn');
  if (config.isProduction) {
    logger.warn('GOOGLE_OAUTH_CLIENT_ID is not set: Google sign-in is unavailable');
  } else {
    logger.warn('GOOGLE_OAUTH_CLIENT_ID is not set: Google sign-in accepts demo:<email> test tokens (demo mode)');
  }
  return new DemoGoogleIdentityVerifier(!config.isProduction);
}
