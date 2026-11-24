import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export interface HealthStatus {
  status: 'ok';
  uptimeSeconds: number;
  database: { status: 'up'; latencyMs: number };
}

// Railway probes this. A 503 when the database is unreachable lets the platform see the outage.
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly db: DatabaseService) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      const { latencyMs } = await this.db.ping();
      return {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        database: { status: 'up', latencyMs },
      };
    } catch (error) {
      // Log the cause; the public response says only that the database is down.
      this.logger.error(`Database health check failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException({
        status: 'error',
        uptimeSeconds: Math.round(process.uptime()),
        database: { status: 'down' },
      });
    }
  }
}
