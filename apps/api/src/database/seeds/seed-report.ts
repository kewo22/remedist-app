import { Logger } from '@nestjs/common';

/** Collects what each seeder did and logs it. Never pass secrets to it. */
export class SeedReport {
  private readonly logger = new Logger('Seed');
  private warnings = 0;

  created(what: string, detail?: string): void {
    this.logger.log(`created  ${what}${detail ? `: ${detail}` : ''}`);
  }

  synced(what: string, detail: string): void {
    this.logger.log(`synced   ${what}: ${detail}`);
  }

  skipped(what: string, reason: string): void {
    this.logger.log(`skipped  ${what}: ${reason}`);
  }

  warn(what: string, reason: string): void {
    this.warnings++;
    this.logger.warn(`WARNING  ${what}: ${reason}`);
  }

  get warningCount(): number {
    return this.warnings;
  }
}
