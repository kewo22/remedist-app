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
  protected constructor(
    status: HttpStatus,
    readonly errorCode: ErrorCode,
    message: string,
    readonly fieldErrors?: ApiFieldError[],
    options?: { cause?: unknown },
  ) {
    super(message, status, options);
  }
}
