// The response envelope every API endpoint returns, so the web app can type its fetch calls.

import type { ErrorCode } from '../enums/error-code';

export interface ApiSuccess<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  /** Extra information about `data`, for example pagination. Absent when there is none. */
  meta?: Record<string, unknown>;
}

/** One invalid input field. `field` is a dotted path for nested values, e.g. `address.city`. */
export interface ApiFieldError {
  field: string;
  messages: string[];
}

export interface ApiError {
  success: false;
  statusCode: number;
  /** Safe to show to the user. Never contains internals. */
  message: string;
  errorCode: ErrorCode;
  /** Present on VALIDATION_FAILED: what's wrong with each field. */
  errors?: ApiFieldError[];
  /** The request path, for support and logs. */
  path: string;
  /** ISO 8601. */
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
