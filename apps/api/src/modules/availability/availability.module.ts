import { Module } from '@nestjs/common';
import {
  AdminAvailabilityController,
  PublicAvailabilityController,
  SessionTypesController,
} from './availability.controller';
import { AvailabilityRepository } from './availability.repository';
import { SessionTypesService } from './session-types.service';
import { SlotsService } from './slots.service';

/**
 * Session types and slots: what's bookable. Exports the services for booking, walk-in, pro-bono
 * and the Google Calendar integration.
 */
@Module({
  controllers: [PublicAvailabilityController, AdminAvailabilityController, SessionTypesController],
  providers: [AvailabilityRepository, SessionTypesService, SlotsService],
  exports: [AvailabilityRepository, SessionTypesService, SlotsService],
})
export class AvailabilityModule {}
