import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiFieldError, ErrorCode } from '@remedist/shared';

/**
 * Base class for every error the API throws on purpose. Carries a stable `errorCode`
 * (from @remedist/shared) that the web app can branch on, and a message that is safe
 * to show to the user.
 *
 * Each domain declares its own subclasses with fixed status, code and message:
 *
 *   export class SlotUnavailableException extends DomainException {
 *     constructor() {
 *       super(HttpStatus.CONFLICT, ErrorCode.SLOT_UNAVAILABLE, 'That time is no longer available.');
 *     }
 *   }
 *
 * The message must never reveal internals: which rate limit was hit, whether a phone
 * or email is registered, SQL, stack traces.
 */
export abstract class DomainException extends HttpException {
  /** Extra response headers the exception filter sets, e.g. Retry-After on a 429. */
  readonly headers: Readonly<Record<string, string>>;

  protected constructor(
    status: HttpStatus,
    readonly errorCode: ErrorCode,
    message: string,
    readonly fieldErrors?: ApiFieldError[],
    options?: { cause?: unknown; headers?: Record<string, string> },
  ) {
    super(message, status, options?.cause === undefined ? undefined : { cause: options.cause });
    this.headers = options?.headers ?? {};
  }
}
