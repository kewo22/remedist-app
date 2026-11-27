import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { DomainException } from '../../common/exceptions/domain.exception';
import { ResourceNotFoundException } from '../../common/exceptions/common.exceptions';

export class ClientNotFoundException extends ResourceNotFoundException {
  constructor() {
    super('We couldn’t find that client.');
  }
}

/** A portal account asked for a contact that isn't its own or one of its dependents. */
export class ContactNotOwnedException extends DomainException {
  constructor() {
    super(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'You don’t have access to this profile.');
  }
}

/** As the old app: nothing to edit before Part 1 registration. */
export class Part1IncompleteException extends DomainException {
  constructor() {
    super(
      HttpStatus.BAD_REQUEST,
      ErrorCode.PART1_INCOMPLETE,
      'Please complete your registration first before editing your profile.',
    );
  }
}

export class DuplicateIdNumberException extends DomainException {
  constructor(cause?: unknown) {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.DUPLICATE_ID_NUMBER,
      'That NIC/Passport number is already registered to another client.',
      undefined,
      { cause },
    );
  }
}

export class EmailInUseException extends DomainException {
  constructor(cause?: unknown) {
    super(HttpStatus.CONFLICT, ErrorCode.EMAIL_IN_USE, 'Another client already uses that email.', undefined, { cause });
  }
}

/** The contact signs in to the portal with this email; changing it here would split the two. */
export class ContactEmailLockedException extends DomainException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.CONTACT_EMAIL_LOCKED,
      'This client signs in with this email, so it can’t be changed here.',
    );
  }
}
