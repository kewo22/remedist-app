import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { ResourceNotFoundException } from '../../common/exceptions/common.exceptions';
import { DomainException } from '../../common/exceptions/domain.exception';

export class SlotNotFoundException extends ResourceNotFoundException {
  constructor() {
    super('We couldn’t find that slot.');
  }
}

export class SessionTypeNotFoundException extends ResourceNotFoundException {
  constructor() {
    super('We couldn’t find that session type.');
  }
}

export class SlotOverlapException extends DomainException {
  constructor(cause?: unknown) {
    super(HttpStatus.CONFLICT, ErrorCode.SLOT_OVERLAP, 'This time overlaps another slot for this practitioner.', undefined, {
      cause,
    });
  }
}

/** The slot's status doesn't allow the change; the message says which statuses do. */
export class SlotStatusConflictException extends DomainException {
  constructor(message: string) {
    super(HttpStatus.CONFLICT, ErrorCode.SLOT_STATUS_CONFLICT, message);
  }
}

export class SessionTypeRetiredException extends DomainException {
  constructor() {
    super(HttpStatus.CONFLICT, ErrorCode.SESSION_TYPE_RETIRED, 'That session type has been retired. Please pick another.');
  }
}

export class LastSessionTypeException extends DomainException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.LAST_SESSION_TYPE,
      'Keep at least one session type. Add another before retiring this one.',
    );
  }
}

export class SessionTypeNameTakenException extends DomainException {
  constructor(cause?: unknown) {
    super(HttpStatus.CONFLICT, ErrorCode.SESSION_TYPE_NAME_TAKEN, 'A session type with that name already exists.', undefined, {
      cause,
    });
  }
}
