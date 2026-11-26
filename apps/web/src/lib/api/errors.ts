import type { ApiError } from '@remedist/shared';

/** The API's error code type. Tightens automatically when the shared ErrorCode union lands. */
export type ApiErrorCode = ApiError['errorCode'];

export interface FieldErrors {
  [field: string]: string[];
}

/**
 * The API answered with an error envelope. `message` is safe to show the user;
 * branch on `errorCode`, never on the message text.
 */
export class ApiClientError extends Error {
  override readonly name = 'ApiClientError';
  readonly statusCode: number;
  readonly errorCode: ApiErrorCode;
  /** Per-field validation messages (VALIDATION_FAILED), keyed by dotted field path. */
  readonly fieldErrors: FieldErrors;
  readonly path: string | undefined;
  /** From the Retry-After header on a 429: seconds before the action can be tried again. */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    envelope: Pick<ApiError, 'statusCode' | 'message' | 'errorCode'> & Partial<Pick<ApiError, 'errors' | 'path'>>,
    options: { retryAfterSeconds?: number } = {},
  ) {
    super(envelope.message);
    this.statusCode = envelope.statusCode;
    this.errorCode = envelope.errorCode;
    this.fieldErrors = toFieldErrors(envelope.errors);
    this.path = envelope.path;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  get isUnauthorized(): boolean {
    return this.statusCode === 401;
  }
}

/** The request never got an answer: offline, DNS, CORS, or it timed out. */
export class NetworkError extends Error {
  override readonly name = 'NetworkError';
  readonly timedOut: boolean;

  constructor(timedOut: boolean, options?: { cause?: unknown }) {
    super(timedOut ? 'The request timed out.' : 'The request could not reach the server.', options);
    this.timedOut = timedOut;
  }
}

export const NETWORK_ERROR_MESSAGE = "We couldn't reach The Remedist. Check your connection and try again.";
export const TIMEOUT_ERROR_MESSAGE = 'This is taking longer than it should. Please try again.';
export const UNKNOWN_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/** The text to show the user for any thrown value. Never exposes raw errors or stack traces. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message || UNKNOWN_ERROR_MESSAGE;
  if (error instanceof NetworkError) return error.timedOut ? TIMEOUT_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE;
  return UNKNOWN_ERROR_MESSAGE;
}

/** Field-level messages from a VALIDATION_FAILED response, or an empty object. */
export function getFieldErrors(error: unknown): FieldErrors {
  return error instanceof ApiClientError ? error.fieldErrors : {};
}

export function isApiError(error: unknown, errorCode?: ApiErrorCode): error is ApiClientError {
  return error instanceof ApiClientError && (errorCode === undefined || error.errorCode === errorCode);
}

/** Seconds to wait before retrying, when the API said so (429 with Retry-After). */
export function getRetryAfterSeconds(error: unknown): number | undefined {
  return error instanceof ApiClientError ? error.retryAfterSeconds : undefined;
}

/** Retry-After is either delay-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds > 0 ? Math.ceil(seconds) : undefined;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  const wait = Math.ceil((date - Date.now()) / 1000);
  return wait > 0 ? wait : undefined;
}

// The envelope's `errors` is a list of { field, messages }. Read it defensively so an
// unexpected shape degrades to "no field errors" instead of crashing the form.
function toFieldErrors(errors: unknown): FieldErrors {
  const result: FieldErrors = {};
  if (!Array.isArray(errors)) return result;
  for (const item of errors) {
    if (typeof item !== 'object' || item === null) continue;
    const { field, messages } = item as { field?: unknown; messages?: unknown };
    if (typeof field !== 'string' || !Array.isArray(messages)) continue;
    const texts = messages.filter((m): m is string => typeof m === 'string');
    if (texts.length > 0) result[field] = [...(result[field] ?? []), ...texts];
  }
  return result;
}
