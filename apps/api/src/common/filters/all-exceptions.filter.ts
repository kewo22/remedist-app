import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ApiError, ApiFieldError, ErrorCode } from '@remedist/shared';
import type { Request, Response } from 'express';
import { DomainException } from '../exceptions/domain.exception';
import { getRequestId, pathWithoutQuery } from '../logging/request-logging.middleware';

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ErrorCode.METHOD_NOT_ALLOWED,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.UNPROCESSABLE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.TOO_MANY_REQUESTS,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCode.INTERNAL_ERROR,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
};

// Only a DomainException's own message reaches the client. Everything else (Nest built-ins,
// body-parser, libraries, the database) gets one of these fixed messages, because their text
// can echo the raw URL with its query string or describe internals.
const GENERIC_MESSAGES: Partial<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'The request could not be understood.',
  [HttpStatus.UNAUTHORIZED]: 'Please sign in to continue.',
  [HttpStatus.FORBIDDEN]: 'You don’t have access to this.',
  [HttpStatus.NOT_FOUND]: 'We couldn’t find what you were looking for.',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'This action isn’t supported here.',
  [HttpStatus.CONFLICT]: 'This conflicts with the current state. Please refresh and try again.',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'The request is too large.',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'The request format isn’t supported.',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'The request could not be processed.',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too many requests. Please wait a moment and try again.',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'The service is temporarily unavailable. Please try again shortly.',
};
const INTERNAL_MESSAGE = 'Something went wrong on our side. Please try again.';

interface ResolvedError {
  status: number;
  errorCode: ErrorCode;
  message: string;
  errors?: ApiFieldError[];
}

/**
 * Shapes every error as `{ success: false, statusCode, message, errorCode, errors?, path, timestamp }`.
 * - DomainException: its own status, code, message and field errors.
 * - Any other HttpException, or an http-errors 4xx from Express middleware: its status,
 *   with the generic code and fixed message for that status.
 * - Anything else: a generic 500.
 * 5xx are logged with their stack and cause; the client never sees internals.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      // No HTTP response to write (for example a scheduled job). Jobs report their own errors.
      this.logger.error(this.describe(exception), exception instanceof Error ? exception.stack : undefined);
      return;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const path = pathWithoutQuery(request);

    const resolved = this.resolve(exception);

    if (resolved.status >= 500) {
      this.logger.error(
        `${request.method} ${path} -> ${resolved.status} [${getRequestId(request) ?? '-'}]: ${this.describe(exception)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    if (response.headersSent) {
      // A streamed or raw response already started; all we can do is end it.
      response.end();
      return;
    }

    const body: ApiError = {
      success: false,
      statusCode: resolved.status,
      message: resolved.message,
      errorCode: resolved.errorCode,
      ...(resolved.errors ? { errors: resolved.errors } : {}),
      path,
      timestamp: new Date().toISOString(),
    };
    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof DomainException) {
      return {
        status: exception.getStatus(),
        errorCode: exception.errorCode,
        message: exception.message,
        errors: exception.fieldErrors,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, errorCode: this.codeFor(status), message: this.genericMessage(status) };
    }

    // Errors thrown by Express middleware before Nest routing (for example body-parser on
    // malformed JSON or an oversized body) carry an http-errors status and `expose: true`.
    const middlewareStatus = this.exposedClientStatus(exception);
    if (middlewareStatus !== undefined) {
      return {
        status: middlewareStatus,
        errorCode: this.codeFor(middlewareStatus),
        message: this.genericMessage(middlewareStatus),
      };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, errorCode: ErrorCode.INTERNAL_ERROR, message: INTERNAL_MESSAGE };
  }

  private exposedClientStatus(exception: unknown): number | undefined {
    if (typeof exception !== 'object' || exception === null) {
      return undefined;
    }
    const { status, expose } = exception as { status?: unknown; expose?: unknown };
    if (expose === true && typeof status === 'number' && status >= 400 && status < 500) {
      return status;
    }
    return undefined;
  }

  private codeFor(status: number): ErrorCode {
    return STATUS_TO_CODE[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.BAD_REQUEST);
  }

  private genericMessage(status: number): string {
    return GENERIC_MESSAGES[status] ?? (status >= 500 ? INTERNAL_MESSAGE : 'The request could not be completed.');
  }

  /** `Name: message`, followed by the `cause` chain so wrapped errors keep their root cause in the log. */
  private describe(exception: unknown): string {
    if (!(exception instanceof Error)) {
      return String(exception);
    }
    const text = `${exception.name}: ${exception.message}`;
    return exception.cause === undefined ? text : `${text} (cause: ${this.describe(exception.cause)})`;
  }
}
