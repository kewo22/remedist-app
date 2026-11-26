import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { DomainException } from '../../common/exceptions/domain.exception';

// Messages never say whether the email exists, which limit was hit, or why a session ended.

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super(HttpStatus.UNAUTHORIZED, ErrorCode.INVALID_CREDENTIALS, "That email or password doesn't match.");
  }
}

export class SessionExpiredException extends DomainException {
  constructor() {
    super(HttpStatus.UNAUTHORIZED, ErrorCode.SESSION_EXPIRED, 'Your session has ended. Please sign in again.');
  }
}

export class RefreshConflictException extends DomainException {
  constructor() {
    super(HttpStatus.CONFLICT, ErrorCode.REFRESH_CONFLICT, 'Your session was just refreshed. Please try again.');
  }
}

export class MfaRequiredException extends DomainException {
  constructor() {
    super(
      HttpStatus.FORBIDDEN,
      ErrorCode.MFA_REQUIRED,
      'This login needs two-factor authentication, which isn’t available yet.',
    );
  }
}

function formatWait(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** 429 with a Retry-After header. Same wording as the old app. */
export class TooManyLoginAttemptsException extends DomainException {
  constructor(waitSeconds: number) {
    super(
      HttpStatus.TOO_MANY_REQUESTS,
      ErrorCode.TOO_MANY_REQUESTS,
      `Too many attempts — try again in ${formatWait(waitSeconds)}.`,
      undefined,
      { headers: { 'Retry-After': String(waitSeconds) } },
    );
  }
}
