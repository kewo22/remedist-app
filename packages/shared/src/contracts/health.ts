// GET /health: liveness and database check. Lives outside the /api/v1 prefix so Railway can probe it.

export const HEALTH_PATH = '/health';

export interface HealthStatus {
  status: 'ok';
  uptimeSeconds: number;
  database: { status: 'up'; latencyMs: number };
}
