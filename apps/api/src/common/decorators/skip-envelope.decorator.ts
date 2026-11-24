import { SetMetadata } from '@nestjs/common';

export const SKIP_ENVELOPE_KEY = 'response:skip-envelope';

/**
 * Sends the handler's return value as-is, without the success envelope.
 * Only for callers that need a raw response: the PayHere notify webhook, Twilio
 * inbound, the Google OAuth callback page and file downloads.
 */
export const SkipEnvelope = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_ENVELOPE_KEY, true);
