import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept a caller's request ID (e.g. from Railway's proxy) only if it's short and plain,
// so nothing odd ends up in the logs.
const SAFE_REQUEST_ID = /^[\w-]{8,64}$/;

// Successful probes of these paths are logged at debug, so Railway's health checks don't flood the log.
const QUIET_PATHS = new Set(['/health']);

const logger = new Logger('HTTP');

/** The request ID set by requestLoggingMiddleware, for log lines elsewhere (e.g. the exception filter). */
export function getRequestId(request: Request): string | undefined {
  const value = request.headers[REQUEST_ID_HEADER];
  return typeof value === 'string' ? value : undefined;
}

/** The path without its query string, which can carry tokens (password reset, OAuth state). */
export function pathWithoutQuery(request: Request): string {
  return request.originalUrl.split('?')[0] ?? request.originalUrl;
}

/**
 * Gives every request an ID (echoed in the `x-request-id` response header) and logs one line
 * when the response finishes: method, path, status, duration and ID. Never logs bodies,
 * headers or query strings.
 */
export function requestLoggingMiddleware(request: Request, response: Response, next: NextFunction): void {
  const incoming = request.headers[REQUEST_ID_HEADER];
  const requestId = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  request.headers[REQUEST_ID_HEADER] = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  const startedAt = performance.now();
  response.on('finish', () => {
    const path = pathWithoutQuery(request);
    const { statusCode } = response;
    const line = `${request.method} ${path} ${statusCode} ${Math.round(performance.now() - startedAt)}ms [${requestId}]`;

    if (statusCode >= 500) {
      logger.error(line);
    } else if (statusCode >= 400) {
      logger.warn(line);
    } else if (QUIET_PATHS.has(path)) {
      logger.debug(line);
    } else {
      logger.log(line);
    }
  });

  next();
}
