import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { DomainException } from '../../common/exceptions/domain.exception';

export class InvalidWebhookSignatureException extends DomainException {
  constructor() {
    super(HttpStatus.FORBIDDEN, ErrorCode.INVALID_WEBHOOK_SIGNATURE, 'Invalid signature.');
  }
}
