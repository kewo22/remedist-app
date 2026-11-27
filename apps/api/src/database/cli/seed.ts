// Syncs roles and permissions from packages/shared, then loads the starting data: staff logins
// (with roles and Rauzan's practitioner profile), the default session type, FAQs and ailments.
//   pnpm --filter api seed
// Safe to re-run: existing logins are never changed, and content is only loaded into empty tables.
// Everything runs in one transaction, so a failure leaves the database as it was.

import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigValidationError } from '../../config/app-config';
import { ConfigModule } from '../../config/config.module';
import { loadSeedConfig } from '../../config/seed-config';
import { DatabaseModule } from '../database.module';
import { DatabaseService } from '../database.service';
import { seedAilments, seedDefaultSessionType, seedFaqs, seedTermsDraft } from '../seeds/content.seed';
import { syncRolesAndPermissions } from '../seeds/roles.seed';
import { SeedReport } from '../seeds/seed-report';
import { seedStaffLogins } from '../seeds/staff.seed';

@Module({ imports: [ConfigModule, DatabaseModule] })
class SeedModule {}

const logger = new Logger('Seed');

async function main(): Promise<void> {
  const seedConfig = loadSeedConfig();
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn', 'log'] });

  try {
    const db = app.get(DatabaseService);

    const { rows } = await db.query<{ ready: boolean }>(
      "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ready",
    );
    if (!rows[0]?.ready) {
      throw new Error('The schema isn’t there yet. Run `pnpm --filter api migrate` first.');
    }

    const report = new SeedReport();
    await db.transaction(async (tx) => {
      await syncRolesAndPermissions(tx, report);
      await seedStaffLogins(tx, seedConfig, report);
      await seedDefaultSessionType(tx, report);
      await seedFaqs(tx, report);
      await seedAilments(tx, report);
      await seedTermsDraft(tx, report);
    });

    logger.log(
      report.warningCount > 0 ? `Seed finished with ${report.warningCount} warning(s).` : 'Seed finished.',
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigValidationError) {
    logger.error(error.message); // lists variable names only, never values
  } else if (error instanceof Error) {
    logger.error(error.stack ?? error.message);
  } else {
    logger.error(String(error));
  }
  process.exit(1);
});
