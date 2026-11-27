import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@remedist/shared';
import { DomainException } from '../../common/exceptions/domain.exception';

export class CalendarNotConfiguredException extends DomainException {
  constructor() {
    super(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.CALENDAR_NOT_CONFIGURED,
      'Google Calendar isn’t set up on the server yet. Ask the developer to add the Google client settings.',
    );
  }
}

export class CalendarNotConnectedException extends DomainException {
  constructor() {
    super(HttpStatus.CONFLICT, ErrorCode.CALENDAR_NOT_CONNECTED, 'No Google Calendar is connected.');
  }
}

export class CalendarSyncBusyException extends DomainException {
  constructor() {
    super(HttpStatus.CONFLICT, ErrorCode.CALENDAR_SYNC_BUSY, 'A calendar sync is already running. Try again in a moment.');
  }
}
