// Applies pending migrations, or with --status lists them.
//   pnpm --filter api migrate            build, then apply
//   pnpm --filter api migrate:status     build, then list
// In production (Railway), run `node dist/database/cli/migrate.js` after the build.

import { Logger } from '@nestjs/common';
import { Client } from 'pg';
import { ConfigValidationError, getAppConfig } from '../../config/app-config';
import { withFullTlsVerification } from '../database-url';
import { MigrationError, MigrationStatus, Migrator } from '../migrator';

const logger = new Logger('Migrate');

function printStatus(statuses: MigrationStatus[]): void {
  const labels: Record<MigrationStatus['state'], string> = {
    applied: 'applied',
    pending: 'PENDING',
    changed: 'CHANGED since applied',
    missing: 'MISSING file',
  };
  for (const s of statuses) {
    const when = s.appliedAt ? `  ${s.appliedAt.toISOString()}` : '';
    console.log(`${`${String(s.version).padStart(4, '0')}_${s.name}`.padEnd(37)} ${labels[s.state]}${when}`);
  }
  const pending = statuses.filter((s) => s.state === 'pending').length;
  console.log(`\n${statuses.length} migration(s), ${pending} pending.`);
}

async function main(): Promise<void> {
  const config = getAppConfig();
  const client = new Client({ connectionString: withFullTlsVerification(config.database.directUrl) });
  await client.connect();
  logger.log(`Connected to ${new URL(config.database.directUrl).hostname}`);

  try {
    const migrator = new Migrator(client);
    if (process.argv.includes('--status')) {
      printStatus(await migrator.status());
    } else {
      await migrator.migrate();
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigValidationError || error instanceof MigrationError) {
    logger.error(error.message);
  } else {
    logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  }
  process.exit(1);
});
