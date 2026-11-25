import { ValidationPipe } from '@nestjs/common';
import { validationExceptionFactory } from './validation-errors';

/**
 * The pipe every body, query and param DTO goes through:
 * - whitelist + forbidNonWhitelisted: unknown fields are rejected, not silently dropped;
 * - transform: handlers receive DTO class instances with declared types;
 * - errors become VALIDATION_FAILED with one entry per field.
 *
 * Query and param values arrive as strings: convert them explicitly in the DTO
 * (`@Type(() => Number)`) rather than with implicit conversion, which turns "false" into true.
 */
export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    // Not stopAtFirstError: class-validator checks decorators bottom-up, so the "first" error would
    // depend on decorator order and could say "must not be greater than 100" for "abc".
    // Keep the rejected value and the DTO out of the error objects: values can be personal data.
    validationError: { target: false, value: false },
    exceptionFactory: validationExceptionFactory,
  });
}
