// Client (patient portal) sign-up and login: /api/v1/portal/auth. Contract: CLIENT_AUTH_ROUTES.
//
// Calls that sign the client in return a ClientSession. Don't store it yourself: go through
// lib/auth/client-auth.ts, which puts it in the session store (session.ts).
// The auth routes themselves don't send the access token (`auth` is unset), so a 401 such as
// INVALID_CREDENTIALS is shown to the user instead of triggering a refresh.

import {
  CLIENT_AUTH_ROUTES,
  type ClientGoogleSignInRequest,
  type ClientLoginRequest,
  type ClientProfile,
  type ClientRegisterRequest,
  type ClientRegisterResponse,
  type ClientSession,
  type ClientVerifyEmailRequest,
  type ForgotPasswordRequest,
  type ForgotPasswordResponse,
  type ResetPasswordRequest,
} from '@remedist/shared';
import { apiRequest, apiRequestEnvelope } from './client';
import { mockClientAuthApi } from './mocks/client-auth';
import { selectApi } from './mode';

/** The result plus the API's message, for the screens that show it ("Check your email..."). */
export interface WithMessage<T> {
  data: T;
  message: string;
}

export interface ClientAuthApi {
  register(body: ClientRegisterRequest): Promise<WithMessage<ClientRegisterResponse>>;
  verifyEmail(body: ClientVerifyEmailRequest): Promise<WithMessage<ClientSession>>;
  login(body: ClientLoginRequest): Promise<WithMessage<ClientSession>>;
  google(body: ClientGoogleSignInRequest): Promise<WithMessage<ClientSession>>;
  forgotPassword(body: ForgotPasswordRequest): Promise<WithMessage<ForgotPasswordResponse>>;
  resetPassword(body: ResetPasswordRequest): Promise<WithMessage<ClientSession>>;
  refresh(): Promise<ClientSession>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  me(signal?: AbortSignal): Promise<ClientProfile>;
}

async function post<T>(path: string, body?: unknown): Promise<WithMessage<T>> {
  const envelope = await apiRequestEnvelope<T>(path, { method: 'POST', body });
  return { data: envelope.data, message: envelope.message };
}

const liveClientAuthApi: ClientAuthApi = {
  register: (body) => post(CLIENT_AUTH_ROUTES.register, body),
  verifyEmail: (body) => post(CLIENT_AUTH_ROUTES.verifyEmail, body),
  login: (body) => post(CLIENT_AUTH_ROUTES.login, body),
  google: (body) => post(CLIENT_AUTH_ROUTES.google, body),
  forgotPassword: (body) => post(CLIENT_AUTH_ROUTES.forgotPassword, body),
  resetPassword: (body) => post(CLIENT_AUTH_ROUTES.resetPassword, body),
  refresh: () => apiRequest<ClientSession>(CLIENT_AUTH_ROUTES.refresh, { method: 'POST' }),
  logout: () => apiRequest<void>(CLIENT_AUTH_ROUTES.logout, { method: 'POST' }),
  logoutAll: () => apiRequest<void>(CLIENT_AUTH_ROUTES.logoutAll, { method: 'POST', auth: 'client' }),
  me: (signal) => apiRequest<ClientProfile>(CLIENT_AUTH_ROUTES.me, { auth: 'client', signal }),
};

export const clientAuthApi = selectApi<ClientAuthApi>({ live: liveClientAuthApi, mock: mockClientAuthApi });

export const clientAuthKeys = {
  all: ['client-auth'] as const,
  me: () => [...clientAuthKeys.all, 'me'] as const,
};
