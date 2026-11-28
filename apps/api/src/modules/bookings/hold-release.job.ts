import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';
import { BookingChangesService } from './booking-changes.service';
import { BookingCoreService } from './booking-core.service';
import { HOLD_RELEASE_LOCK_KEY } from './bookings.constants';

/**
 * Every minute: cancels checkout holds older than HOLD_MINUTES and reopens their slots (never done
 * inside a request). A transaction-level advisory lock makes it run once across instances; a failed
 * run is logged and never crashes the process.
 */
@Injectable()
export class HoldReleaseJob {
  private readonly logger = new Logger(HoldReleaseJob.name);

  constructor(
    private readonly changes: BookingChangesService,
    private readonly core: BookingCoreService,
    private readonly db: DatabaseService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'hold-release', waitForCompletion: true })
  async scheduled(): Promise<void> {
    try {
      const released = await this.run();
      if (released > 0) {
        this.logger.log(`Released ${released} expired checkout hold(s)`);
      }
    } catch (error) {
      this.logger.error(`Hold release failed: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
    }
  }

  /** One run; returns how many holds were released. */
  async run(): Promise<number> {
    const freed = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [HOLD_RELEASE_LOCK_KEY]);
      return rows[0]?.locked ? this.changes.releaseExpiredHolds(tx) : [];
    });
    await this.core.afterCommit(...freed);
    return freed.length;
  }
}
