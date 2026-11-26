import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { DomainException } from '../exceptions/domain.exception';

// Shared by staff and client auth. Messages never say whether an email exists, which limit was
// hit, or why a session ended.

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

/** A verification or reset code is wrong, used up or expired: the old app's single message. */
export class InvalidCodeException extends DomainException {
  constructor() {
    super(HttpStatus.BAD_REQUEST, ErrorCode.INVALID_CODE, "That code doesn't match or has expired.");
  }
}

/** "30 seconds", "4 minutes". */
export function formatWait(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** 429 with a Retry-After header. Same wording as the old app; never says which limit was hit. */
export class TooManyAttemptsException extends DomainException {
  constructor(waitSeconds?: number) {
    super(
      HttpStatus.TOO_MANY_REQUESTS,
      ErrorCode.TOO_MANY_REQUESTS,
      waitSeconds ? `Too many attempts — try again in ${formatWait(waitSeconds)}.` : 'Too many attempts, please try again later.',
      undefined,
      waitSeconds ? { headers: { 'Retry-After': String(waitSeconds) } } : undefined,
    );
  }
}
