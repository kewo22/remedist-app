import type { ApiFieldError } from '@remedist/shared';
import type { ValidationError } from 'class-validator';
import { ValidationFailedException } from '../exceptions/common.exceptions';

/**
 * Turns class-validator's nested errors into one entry per invalid field, keyed by a
 * dotted path: `email`, `address.city`, `items.0.quantity`.
 */
export function flattenValidationErrors(errors: ValidationError[], parentPath = ''): ApiFieldError[] {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own: ApiFieldError[] = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

/** `exceptionFactory` for the global ValidationPipe. */
export function validationExceptionFactory(errors: ValidationError[]): ValidationFailedException {
  return new ValidationFailedException(flattenValidationErrors(errors));
}
