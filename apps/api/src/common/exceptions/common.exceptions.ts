import { HttpStatus } from '@nestjs/common';
import { ApiFieldError, ErrorCode } from '@remedist/shared';
import { DomainException } from './domain.exception';

// Exceptions not tied to one domain. Domain-specific ones live in their module.

/** Invalid input, with the problem for each field. Thrown by the global ValidationPipe. */
export class ValidationFailedException extends DomainException {
  constructor(errors: ApiFieldError[]) {
    super(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, 'Some of the details you entered are not valid.', errors);
  }
}

/** A record the caller asked for doesn't exist (or they may not know it exists). */
export class ResourceNotFoundException extends DomainException {
  constructor(message = 'We couldn’t find what you were looking for.') {
    super(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, message);
  }
}

/** A dependency the request needs (database, third-party service) is unreachable. */
export class ServiceUnavailableDomainException extends DomainException {
  constructor(message = 'The service is temporarily unavailable. Please try again shortly.', cause?: unknown) {
    super(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.SERVICE_UNAVAILABLE, message, undefined, { cause });
  }
}
