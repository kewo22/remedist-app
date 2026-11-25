import { SetMetadata } from '@nestjs/common';

export const RESPONSE_MESSAGE_KEY = 'response:message';

/** Sets `message` in the success envelope, e.g. `@ResponseMessage('Booking confirmed')`. */
export const ResponseMessage = (message: string): MethodDecorator & ClassDecorator =>
  SetMetadata(RESPONSE_MESSAGE_KEY, message);
