import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { DomainException } from '../../common/exceptions/domain.exception';

export class TermsNotPublishedException extends DomainException {
  constructor() {
    super(HttpStatus.NOT_FOUND, ErrorCode.TERMS_NOT_PUBLISHED, 'No Terms & Conditions have been published yet.');
  }
}

/** The client accepted a version that's no longer the latest: show the new one and ask again. */
export class TermsVersionOutdatedException extends DomainException {
  constructor() {
    super(
      HttpStatus.CONFLICT,
      ErrorCode.TERMS_VERSION_OUTDATED,
      'Our Terms & Conditions were just updated. Please review the latest version and accept it.',
    );
  }
}

export class TermsIncompleteException extends DomainException {
  constructor() {
    super(HttpStatus.BAD_REQUEST, ErrorCode.TERMS_INCOMPLETE, 'Add content to both sections before publishing.');
  }
}

/** Two publishes at once: the other one won, and the draft it started is unchanged. */
export class TermsPublishConflictException extends DomainException {
  constructor() {
    super(HttpStatus.CONFLICT, ErrorCode.CONFLICT, 'The terms were just published by someone else. Reload to see the latest version.');
  }
}
