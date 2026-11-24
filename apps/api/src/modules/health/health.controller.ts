import { Controller, Get } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ServiceUnavailableDomainException } from '../../common/exceptions/common.exceptions';
import { DatabaseService } from '../../database/database.service';

export interface HealthStatus {
  status: 'ok';
  uptimeSeconds: number;
  database: { status: 'up'; latencyMs: number };
}

// Railway probes this. A 503 when the database is unreachable lets the platform see the outage.
@Controller('health')
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ResponseMessage('API is healthy')
  async check(): Promise<HealthStatus> {
    try {
      const { latencyMs } = await this.db.ping();
      return {
        status: 'ok',
        uptimeSeconds: Math.round(process.uptime()),
        database: { status: 'up', latencyMs },
      };
    } catch (error) {
      // The filter logs the cause; the response only says the database is unreachable.
      throw new ServiceUnavailableDomainException('The database is unreachable.', error);
    }
  }
}
