import { Global, Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { MessagingRepository } from './messaging.repository';
import { MessagingService } from './messaging.service';
import { TwilioWebhooksController } from './twilio-webhooks.controller';
import { TwilioWebhooksService } from './twilio-webhooks.service';

/**
 * Messages to clients: MessagingService sends them (WhatsApp/SMS and email) and is the only writer
 * of message_log; Twilio's webhooks update delivery status and store replies. Global, so any domain
 * can send after its change commits.
 */
@Global()
@Module({
  controllers: [MessagingController, TwilioWebhooksController],
  providers: [MessagingRepository, MessagingService, TwilioWebhooksService],
  exports: [MessagingService],
})
export class MessagingModule {}
