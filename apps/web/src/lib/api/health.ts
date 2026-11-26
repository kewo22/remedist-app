// Template for a domain API file: an interface from the shared contract, a live implementation
// on the API client, a mock in mocks/, and query keys for TanStack Query.

import { HEALTH_PATH, type HealthStatus } from '@remedist/shared';
import { api } from './client';
import { mockHealthApi } from './mocks/health';
import { selectApi } from './mode';

export interface HealthApi {
  check(signal?: AbortSignal): Promise<HealthStatus>;
}

const liveHealthApi: HealthApi = {
  check: (signal) => api.get<HealthStatus>(HEALTH_PATH, { base: 'origin', signal, cache: 'no-store' }),
};

export const healthApi = selectApi<HealthApi>({ live: liveHealthApi, mock: mockHealthApi });

export const healthKeys = {
  all: ['health'] as const,
};
