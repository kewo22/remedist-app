import { Module } from '@nestjs/common';
import { CalendarConnectionService } from './calendar-connection.service';
import { CalendarEventsService } from './calendar-events.service';
import { CalendarSyncJob } from './calendar-sync.job';
import { CalendarSyncService } from './calendar-sync.service';
import { CalendarController } from './calendar.controller';
import { CalendarRepository } from './calendar.repository';
import { OAuthStateStore } from './oauth-state.store';

/**
 * Google Calendar: the owner's connection, one event per slot kept in step, and the 5-minute sync
 * back from Google. Exports CalendarEventsService so slot and booking changes can push right away.
 */
@Module({
  controllers: [CalendarController],
  providers: [
    CalendarRepository,
    OAuthStateStore,
    CalendarConnectionService,
    CalendarEventsService,
    CalendarSyncService,
    CalendarSyncJob,
  ],
  exports: [CalendarEventsService],
})
export class CalendarModule {}
