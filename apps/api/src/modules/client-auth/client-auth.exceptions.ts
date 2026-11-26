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

/**
 * A verified phone has no portal account. Safe to say (product owner approved): the person has
 * just proved they own the number.
 */
export class PhoneAccountNotFoundException extends DomainException {
  constructor() {
    super(HttpStatus.NOT_FOUND, ErrorCode.PHONE_ACCOUNT_NOT_FOUND, 'We couldn’t find an account for that number.');
  }
}

/** contacts.phone isn't unique (family members can share one): the client signs in by email instead. */
export class PhoneAccountAmbiguousException extends DomainException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.PHONE_ACCOUNT_AMBIGUOUS,
      'More than one account uses this number. Please sign in with your email.',
    );
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
