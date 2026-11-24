// The response envelope every API endpoint returns, so the web app can type its fetch calls.

export interface ApiSuccess<T> {
  success: true;
  statusCode: number;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  success: false;
  statusCode: number;
  message: string;
  errorCode: string;
  errors?: unknown;
  path: string;
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;
