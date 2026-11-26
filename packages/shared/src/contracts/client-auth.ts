// Client (patient portal) sign-up and login. Works like staff auth: the access token goes in
// `Authorization: Bearer`, and the refresh token is an httpOnly cookie the browser sends to the
// portal auth routes by itself, so those calls need `credentials: 'include'`.

export const CLIENT_AUTH_ROUTES = {
  /**
   * POST ClientRegisterRequest → ClientRegisterResponse. The same answer whether or not the email
   * already has an account; an existing owner gets an email instead of a code.
   */
  register: '/portal/auth/register',
  /** POST ClientVerifyEmailRequest → ClientSession (sets the refresh cookie). */
  verifyEmail: '/portal/auth/verify-email',
  /** POST ClientLoginRequest → ClientSession (sets the refresh cookie). */
  login: '/portal/auth/login',
  /** POST ClientGoogleSignInRequest → ClientSession (sets the refresh cookie). */
  google: '/portal/auth/google',
  /** POST ForgotPasswordRequest → ForgotPasswordResponse. The same answer for unknown emails. */
  forgotPassword: '/portal/auth/forgot-password',
  /** POST ResetPasswordRequest → ClientSession. Signs out every other device. */
  resetPassword: '/portal/auth/reset-password',
  /** POST, no body → ClientSession. Rotates the refresh cookie. On REFRESH_CONFLICT, retry once. */
  refresh: '/portal/auth/refresh',
  /** POST, no body → null. Ends this session and clears the cookie. */
  logout: '/portal/auth/logout',
  /** POST, no body (Bearer) → null. Ends every session for this account. */
  logoutAll: '/portal/auth/logout-all',
  /** GET (Bearer) → ClientProfile. */
  me: '/portal/auth/me',
} as const;

export const PASSWORD_RESET_CHANNELS = ['email', 'phone'] as const;
/** 'phone' is accepted but refused with CHANNEL_UNAVAILABLE until WhatsApp/SMS sending is built. */
export type PasswordResetChannel = (typeof PASSWORD_RESET_CHANNELS)[number];

export type ClientAuthProvider = 'email' | 'google';

export interface ClientRegisterRequest {
  name: string;
  email: string;
  /** At least CLIENT_PASSWORD_MIN_LENGTH characters. */
  password: string;
}

export interface ClientRegisterResponse {
  /** The normalised (trimmed, lower-case) email the code was sent to. */
  email: string;
  /** Only outside production when email sending is in demo mode, so the flow can be tested. */
  devCode?: string;
}

export interface ClientVerifyEmailRequest {
  email: string;
  /** The 6-digit code from the email. */
  code: string;
}

export interface ClientLoginRequest {
  email: string;
  password: string;
}

export interface ClientGoogleSignInRequest {
  /** The `credential` Google Identity Services hands the page. */
  idToken: string;
}

export interface ForgotPasswordRequest {
  email: string;
  channel: PasswordResetChannel;
  /** Needed from the second request in 15 minutes; the API answers CHALLENGE_REQUIRED without it. */
  turnstileToken?: string;
}

export interface ForgotPasswordResponse {
  channel: PasswordResetChannel;
  /** Seconds before another code can be requested, so the page can show a countdown. */
  nextResendWaitSeconds: number;
  /** Only outside production when email sending is in demo mode. */
  devCode?: string;
}

export interface ResetPasswordRequest {
  email: string;
  channel: PasswordResetChannel;
  code: string;
  /** At least CLIENT_PASSWORD_MIN_LENGTH characters. */
  newPassword: string;
}

export interface ClientProfile {
  /** The portal account id. */
  id: string;
  /** The clinic's contact record for this person. */
  contactId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  authProvider: ClientAuthProvider;
  /** False for Google-only accounts, which can't use "forgot password". */
  hasPassword: boolean;
}

export interface ClientSession {
  accessToken: string;
  /** ISO 8601. Refresh shortly before this. */
  accessTokenExpiresAt: string;
  client: ClientProfile;
}
