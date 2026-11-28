import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { ResourceNotFoundException } from '../../common/exceptions/common.exceptions';
import { DomainException } from '../../common/exceptions/domain.exception';

/** Also used for someone else's booking, so ids can't be probed. */
export class BookingNotFoundException extends ResourceNotFoundException {
  constructor() {
    super('We couldn’t find that booking.');
  }
}

export class SlotUnavailableException extends DomainException {
  constructor(cause?: unknown) {
    super(HttpStatus.CONFLICT, ErrorCode.SLOT_UNAVAILABLE, 'That time was just taken or is no longer available. Please pick another.', undefined, {
      cause,
    });
  }
}

// Steps the client has to take first: 428 Precondition Required, as in the old app.

export class BookingPart1RequiredException extends DomainException {
  constructor() {
    super(HttpStatus.PRECONDITION_REQUIRED, ErrorCode.PART1_INCOMPLETE, 'Please complete your registration before booking.');
  }
}

export class TermsReacceptRequiredException extends DomainException {
  constructor() {
    super(
      HttpStatus.PRECONDITION_REQUIRED,
      ErrorCode.TERMS_REACCEPT_REQUIRED,
      'Please review and accept our updated Terms & Conditions before booking.',
    );
  }
}

export class PaymentOverdueLockoutException extends DomainException {
  constructor() {
    super(
      HttpStatus.PRECONDITION_REQUIRED,
      ErrorCode.PAYMENT_OVERDUE_LOCKOUT,
      'Please contact the clinic to settle your outstanding balance before booking again.',
    );
  }
}

/** Staff see the warning and resend with overrideLockoutWarning to book anyway. */
export class OverdueLockoutWarningException extends DomainException {
  constructor(name: string) {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.OVERDUE_LOCKOUT_WARNING,
      `${name} has a pay-after balance overdue by 30 days or more. Book anyway?`,
    );
  }
}

export class BookingStatusConflictException extends DomainException {
  constructor(message: string) {
    super(HttpStatus.CONFLICT, ErrorCode.BOOKING_STATUS_CONFLICT, message);
  }
}

export class RescheduleTooLateException extends DomainException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.RESCHEDULE_TOO_LATE,
      'It’s too close to your session to reschedule online. Please contact the clinic.',
    );
  }
}

export class RescheduleAlreadyUsedException extends DomainException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.RESCHEDULE_ALREADY_USED,
      'You’ve already used your one online reschedule for this booking. Please contact the clinic for further changes.',
    );
  }
}

export class OutsideRescheduleWindowException extends DomainException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.OUTSIDE_RESCHEDULE_WINDOW,
      'That date is more than 30 days from your original session date. Please pick a closer one or contact the clinic.',
    );
  }
}

export class NoSlotsTodayException extends DomainException {
  constructor() {
    super(HttpStatus.CONFLICT, ErrorCode.NO_SLOTS_TODAY, 'There are no open sessions left today. Please check with the front desk.');
  }
}
