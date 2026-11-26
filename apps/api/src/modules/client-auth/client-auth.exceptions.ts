import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { DomainException } from '../../common/exceptions/domain.exception';

/** Google didn't accept the token, or the Google account's email isn't verified. */
export class GoogleSignInFailedException extends DomainException {
  constructor(cause?: unknown) {
    super(HttpStatus.UNAUTHORIZED, ErrorCode.GOOGLE_SIGN_IN_FAILED, 'Google sign-in failed. Please try again.', undefined, {
      cause,
    });
  }
}

export class GoogleSignInUnavailableException extends DomainException {
  constructor() {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.SERVICE_UNAVAILABLE,
      'Google sign-in isn’t available right now. Please use your email and password.',
    );
  }
}

/** Reset codes by WhatsApp/SMS wait for the messaging integration. */
export class PhoneChannelUnavailableException extends DomainException {
  constructor() {
    super(
      HttpStatus.BAD_REQUEST,
      ErrorCode.CHANNEL_UNAVAILABLE,
      'Reset codes by phone aren’t available yet. Please choose email.',
    );
  }
}
