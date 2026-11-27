import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { ResourceNotFoundException } from '../../common/exceptions/common.exceptions';
import { DomainException } from '../../common/exceptions/domain.exception';

export class Part1AlreadyCompletedException extends DomainException {
  constructor() {
    super(HttpStatus.CONFLICT, ErrorCode.PART1_ALREADY_COMPLETED, 'Registration is already complete for this profile.');
  }
}

/** The old Part 1 wording: the person most likely registered before. */
export class Part1DuplicateIdNumberException extends DomainException {
  constructor(cause?: unknown) {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.DUPLICATE_ID_NUMBER,
      'That NIC/Passport number is already registered. Please log in instead, or contact the clinic.',
      undefined,
      { cause },
    );
  }
}

/** Also used for a form that belongs to someone else, so ids can't be probed. */
export class IntakeFormNotFoundException extends ResourceNotFoundException {
  constructor() {
    super('We couldn’t find that intake form.');
  }
}

export class IntakePhotoNotFoundException extends ResourceNotFoundException {
  constructor() {
    super('There’s no photo for that side.');
  }
}

export class InvalidPhotoException extends DomainException {
  constructor() {
    super(HttpStatus.BAD_REQUEST, ErrorCode.INVALID_PHOTO, 'Please upload a JPEG, PNG or WebP photo.');
  }
}
