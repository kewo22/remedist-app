import type { Request } from 'express';
import { getRequestId } from '../logging/request-logging.middleware';
import { MAX_USER_AGENT_LENGTH } from './auth.constants';

/** Who is calling, for sessions, throttles and the audit log. */
export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
  requestId?: string;
}

export function clientInfo(request: Request): ClientInfo {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.headers['user-agent']?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    requestId: getRequestId(request),
  };
}
