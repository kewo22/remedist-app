import type { HealthStatus } from '@remedist/shared';
import type { HealthApi } from '../health';
import { mockOk } from './helpers';

const healthy: HealthStatus = {
  status: 'ok',
  uptimeSeconds: 3_600,
  database: { status: 'up', latencyMs: 12 },
};

export const mockHealthApi: HealthApi = {
  check: () => mockOk(healthy),
};
