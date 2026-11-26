import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { DomainException } from '../../common/exceptions/domain.exception';

/** The clinic-wide daily send cap is reached. The message is the caller's (it names the feature). */
export class OtpDailyCapReachedException extends DomainException {
  constructor(message = 'Codes are temporarily unavailable — please try again later.') {
    super(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.SERVICE_UNAVAILABLE, message);
  }
}

/** The send needs a passed Turnstile check: show the widget and retry with its token. */
export class ChallengeRequiredException extends DomainException {
  constructor() {
    super(HttpStatus.BAD_REQUEST, ErrorCode.CHALLENGE_REQUIRED, 'Please complete the security check and try again.');
  }
}

/** A wrong phone code; the code is still usable (old app: 400). */
export class WrongPhoneCodeException extends DomainException {
  constructor() {
    super(HttpStatus.BAD_REQUEST, ErrorCode.INVALID_CODE, "That code doesn't match — check and try again.");
  }
}

/** No usable phone code left (expired, used, or too many wrong guesses): request a new one (old app: 410). */
export class PhoneCodeExpiredException extends DomainException {
  constructor() {
    super(HttpStatus.GONE, ErrorCode.CODE_EXPIRED, 'That code has expired — please request a new one.');
  }
}

/** Neither WhatsApp nor SMS accepted the message. */
export class PhoneCodeNotSentException extends DomainException {
  constructor(cause?: unknown) {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.SERVICE_UNAVAILABLE,
      'We couldn’t send the code. Please check the number and try again.',
      undefined,
      { cause },
    );
  }
}

/** A step that needs a verified phone got no valid phone verification token. */
export class PhoneNotVerifiedException extends DomainException {
  constructor() {
    super(HttpStatus.UNAUTHORIZED, ErrorCode.PHONE_NOT_VERIFIED, 'Please verify your phone number again.');
  }
}
