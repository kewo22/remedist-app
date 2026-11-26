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
