import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { DomainException } from '../../common/exceptions/domain.exception';

// Staff-only. The ones shared with client auth are in common/auth/auth.exceptions.ts.

export class MfaRequiredException extends DomainException {
  constructor() {
    super(
      HttpStatus.FORBIDDEN,
      ErrorCode.MFA_REQUIRED,
      'This login needs two-factor authentication, which isn’t available yet.',
    );
  }
}
