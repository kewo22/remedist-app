import { Controller, Header, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PublicRoute } from '../../common/auth/auth.decorators';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { TwilioWebhooksService } from './twilio-webhooks.service';

/** Twilio expects TwiML back from a messaging webhook; an empty Response means "no reply". */
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function paramsOf(request: Request): Record<string, unknown> {
  return typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>) : {};
}

/**
 * Twilio's server-to-server webhooks (form-encoded, signature-verified). Configure in Twilio:
 * - status callback: sent with each WhatsApp message (StatusCallback), <APP_URL>/api/v1/webhooks/twilio/status;
 * - incoming messages on the WhatsApp sender: <APP_URL>/api/v1/webhooks/twilio/inbound.
 */
@Controller('webhooks/twilio')
@PublicRoute()
@SkipEnvelope()
export class TwilioWebhooksController {
  constructor(private readonly webhooks: TwilioWebhooksService) {}

  @Post('status')
  @HttpCode(HttpStatus.NO_CONTENT)
  async status(@Req() request: Request): Promise<void> {
    const params = paramsOf(request);
    this.webhooks.verify(request.originalUrl, params, request.header('x-twilio-signature'));
    await this.webhooks.handleStatus(params);
  }

  @Post('inbound')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml; charset=utf-8')
  async inbound(@Req() request: Request): Promise<string> {
    const params = paramsOf(request);
    this.webhooks.verify(request.originalUrl, params, request.header('x-twilio-signature'));
    await this.webhooks.handleInbound(params);
    return EMPTY_TWIML;
  }
}
