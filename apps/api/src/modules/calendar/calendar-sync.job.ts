import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { CalendarSyncResult } from '@remedist/shared';
import { getAppConfig } from '../../config/app-config';
import { DatabaseService } from '../../database/database.service';
import { CalendarConnectionService, describe } from './calendar-connection.service';
import { CalendarEventsService } from './calendar-events.service';
import { CalendarSyncService } from './calendar-sync.service';
import { CALENDAR_JOB_LOCK_KEY } from './calendar.constants';
import { CalendarSyncBusyException } from './calendar.exceptions';

/**
 * The calendar job, every AVAILABILITY_SYNC_CRON (5 minutes): retry pending slot events, read the
 * changes made in Google, then push what that changed (blocked or unblocked slots). A session-level
 * advisory lock on the direct connection makes it run once even with several API instances. A
 * failed run is logged and recorded for the status panel; it never crashes the process.
 */
@Injectable()
export class CalendarSyncJob {
  private readonly logger = new Logger(CalendarSyncJob.name);

  constructor(
    private readonly connection: CalendarConnectionService,
    private readonly events: CalendarEventsService,
    private readonly sync: CalendarSyncService,
    private readonly db: DatabaseService,
  ) {}

  // The expression comes from the typed config (loaded once, before the app starts).
  @Cron(getAppConfig().calendar.syncCron, { name: 'google-calendar-sync', waitForCompletion: true })
  async scheduled(): Promise<void> {
    try {
      await this.runLocked();
    } catch (error) {
      if (!(error instanceof CalendarSyncBusyException)) {
        this.logger.error(`Calendar job failed: ${describe(error)}`, error instanceof Error ? error.stack : undefined);
      }
    }
  }

  /** One run now (also "Sync now" in the CRM). CALENDAR_SYNC_BUSY when another run holds the lock. */
  async runLocked(): Promise<CalendarSyncResult> {
    return this.db.withDirectConnection(async (lock) => {
      const { rows } = await lock.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [CALENDAR_JOB_LOCK_KEY]);
      if (!rows[0]?.locked) {
        throw new CalendarSyncBusyException();
      }
      try {
        return await this.run();
      } finally {
        await lock.query('SELECT pg_advisory_unlock($1)', [CALENDAR_JOB_LOCK_KEY]);
      }
    });
  }

  private async run(): Promise<CalendarSyncResult> {
    const access = await this.connection.access();
    if (!access) {
      return { pushed: 0, stillPending: (await this.connection.status()).pendingSlots, eventsRead: 0 };
    }
    const first = await this.events.pushPending(access);
    let eventsRead = 0;
    try {
      eventsRead = await this.sync.run(access);
      this.sync.logRun(eventsRead);
    } catch (error) {
      this.logger.error(`Reading Google Calendar changes failed: ${describe(error)}`);
      await this.connection.recordError('Couldn’t read changes from Google Calendar. Will retry on the next run.');
    }
    const second = await this.events.pushPending(access);
    const stillPending = (await this.connection.status()).pendingSlots;
    if (first.failed + second.failed > 0) {
      await this.connection.recordError('Some slot events couldn’t be updated in Google Calendar. Retrying every 5 minutes.');
    }
    return { pushed: first.pushed + second.pushed, stillPending, eventsRead };
  }
}
