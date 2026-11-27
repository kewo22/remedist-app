// Mock client auth, shaped like /api/v1/portal/auth. Fictional people only.
//
// Try it with:
//   - nimali@example.com / remedist1        a verified email-and-password account
//   - google.only@example.com               a Google-only account: password login fails, use Google
//   - too-many@example.com                  login and sign-up answer 429 with a 30 s Retry-After
//   - any new email on the sign-up page     then the code 123456 (5 wrong guesses use it up); a new
//                                           code can be asked for after 60 seconds
// Phone sign-in: see mocks/phone-otp.ts for the numbers.
// Forgot password: code 123456. Asking again within 15 minutes needs the security check, and
// within 60 seconds answers 429.
//
// The "refresh cookie" is simulated with sessionStorage (the signed-in profile only, no tokens)
// so a page reload can restore the session like the live API does.

import {
  CLIENT_PASSWORD_MIN_LENGTH,
  normalizeEmail,
  type ClientProfile,
  type ClientSession,
} from '@remedist/shared';
import type { ClientAuthApi, WithMessage } from '../client-auth';
import { mockFail, mockOk } from './helpers';
import { MOCK_PHONE_PROOF_PREFIX } from './phone-otp';

const MOCK_CODE = '123456';
const MAX_WRONG_GUESSES = 5;
const ACCESS_TOKEN_TTL_MS = 15 * 60_000;
const RESEND_WAIT_SECONDS = 60;
const CHALLENGE_WINDOW_MS = 15 * 60_000;
const THROTTLED_EMAIL = 'too-many@example.com';
const THROTTLE_WAIT_SECONDS = 30;
const STORAGE_KEY = 'remedist.mock.client-session';

interface MockAccount {
  profile: ClientProfile;
  password: string | null;
}

interface PendingCode {
  code: string;
  wrongGuesses: number;
}

const accounts = new Map<string, MockAccount>([
  [
    'nimali@example.com',
    {
      password: 'remedist1',
      profile: {
        id: 'acc_mock_nimali',
        contactId: 'con_mock_nimali',
        name: 'Nimali Jayasekara',
        email: 'nimali@example.com',
        emailVerified: true,
        authProvider: 'email',
        hasPassword: true,
      },
    },
  ],
  [
    'google.only@example.com',
    {
      password: null,
      profile: {
        id: 'acc_mock_ravi',
        contactId: 'con_mock_ravi',
        name: 'Ravi Gunasekara',
        email: 'google.only@example.com',
        emailVerified: true,
        authProvider: 'google',
        hasPassword: false,
      },
    },
  ],
]);

/** The phone on each account's contact record (E.164). Two accounts sharing one number is allowed. */
const accountEmailsByPhone = new Map<string, string[]>([
  ['+94770000001', ['nimali@example.com']],
  ['+94770000003', ['nimali@example.com', 'google.only@example.com']],
]);

const pendingSignUps =new Map<string, PendingCode & { name: string; password: string; sentAt: number }>();
const pendingResets = new Map<string, PendingCode & { sentAt: number }>();

const tooManyAttempts = (seconds: number) =>
  mockFail(429, 'TOO_MANY_REQUESTS', `Too many attempts — try again in ${seconds} seconds.`, undefined, {
    retryAfterSeconds: seconds,
  });
const invalidCode = () => mockFail(400, 'INVALID_CODE', "That code doesn't match or has expired.");
const sessionExpired = () => mockFail(401, 'SESSION_EXPIRED', 'Your session has ended. Please sign in again.');

function checkCode(pending: PendingCode | undefined, code: string): boolean {
  if (!pending || pending.wrongGuesses >= MAX_WRONG_GUESSES) return false;
  if (code === pending.code) return true;
  pending.wrongGuesses += 1;
  return false;
}

function issueSession(profile: ClientProfile, message: string): Promise<WithMessage<ClientSession>> {
  writeSignedIn(profile);
  return mockOk({ data: newSession(profile), message });
}

function newSession(profile: ClientProfile): ClientSession {
  return {
    accessToken: `mock-access-${crypto.randomUUID()}`,
    accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
    client: profile,
  };
}

function readSignedIn(): ClientProfile | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ClientProfile) : undefined;
  } catch {
    return undefined;
  }
}

function writeSignedIn(profile: ClientProfile | undefined): void {
  if (profile) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  else sessionStorage.removeItem(STORAGE_KEY);
}

function newAccount(email: string, name: string, password: string | null): MockAccount {
  const id = crypto.randomUUID();
  const account: MockAccount = {
    password,
    profile: {
      id: `acc_${id}`,
      contactId: `con_${id}`,
      name,
      email,
      emailVerified: true,
      authProvider: password ? 'email' : 'google',
      hasPassword: password !== null,
    },
  };
  accounts.set(email, account);
  return account;
}

export const mockClientAuthApi: ClientAuthApi = {
  register: ({ name, email: rawEmail, password }) => {
    const email = normalizeEmail(rawEmail);
    if (email === THROTTLED_EMAIL) return tooManyAttempts(THROTTLE_WAIT_SECONDS);
    if (password.length < CLIENT_PASSWORD_MIN_LENGTH) {
      return mockFail(400, 'VALIDATION_FAILED', 'Please check the highlighted fields.', [
        { field: 'password', messages: [`password must be at least ${CLIENT_PASSWORD_MIN_LENGTH} characters`] },
      ]);
    }
    // Like the API's send cooldown: asking again for the same email straight away answers 429.
    const previous = pendingSignUps.get(email);
    const now = Date.now();
    if (previous && now - previous.sentAt < RESEND_WAIT_SECONDS * 1000) {
      return tooManyAttempts(Math.ceil((previous.sentAt + RESEND_WAIT_SECONDS * 1000 - now) / 1000));
    }
    // Same answer when the email already has an account (the owner would get an email instead).
    if (!accounts.has(email)) pendingSignUps.set(email, { name, password, code: MOCK_CODE, wrongGuesses: 0, sentAt: now });
    return mockOk({
      data: { email, devCode: MOCK_CODE },
      message: 'Account created. Check your email for a verification code.',
    });
  },

  verifyEmail: ({ email: rawEmail, code }) => {
    const email = normalizeEmail(rawEmail);
    const pending = pendingSignUps.get(email);
    if (!pending || !checkCode(pending, code)) return invalidCode();
    pendingSignUps.delete(email);
    return issueSession(newAccount(email, pending.name, pending.password).profile, 'Email verified');
  },

  login: ({ email: rawEmail, password }) => {
    const email = normalizeEmail(rawEmail);
    if (email === THROTTLED_EMAIL) return tooManyAttempts(THROTTLE_WAIT_SECONDS);
    const account = accounts.get(email);
    if (!account || account.password === null || account.password !== password) {
      return mockFail(401, 'INVALID_CREDENTIALS', "That email or password doesn't match.");
    }
    return issueSession(account.profile, 'Signed in');
  },

  google: ({ idToken }) => {
    // Like the API without a Google client id: `demo:<email>[:<name>]`. Any other token (a real
    // Google credential, in mock mode) signs in a fictional Google user.
    const [prefix, rawEmail, name] = idToken.split(':');
    const email = prefix === 'demo' && rawEmail ? normalizeEmail(rawEmail) : 'google.user@example.com';
    const account = accounts.get(email) ?? newAccount(email, name ?? 'Google User', null);
    return issueSession(account.profile, 'Signed in with Google');
  },

  phone: ({ phoneVerificationToken }) => {
    const [prefix, purpose, phoneNumber] = phoneVerificationToken.split(':');
    if (prefix !== MOCK_PHONE_PROOF_PREFIX || purpose !== 'login' || !phoneNumber) {
      return mockFail(401, 'PHONE_NOT_VERIFIED', 'Please verify your phone number again.');
    }
    const emails = accountEmailsByPhone.get(phoneNumber) ?? [];
    if (emails.length > 1) {
      return mockFail(409, 'PHONE_ACCOUNT_AMBIGUOUS', 'More than one account uses this number. Please sign in with your email.');
    }
    const account = emails[0] ? accounts.get(emails[0]) : undefined;
    if (!account) return mockFail(404, 'PHONE_ACCOUNT_NOT_FOUND', "We couldn't find an account for that number.");
    return issueSession(account.profile, 'Signed in');
  },

  forgotPassword: ({ email: rawEmail, channel, turnstileToken }) => {
    if (channel !== 'email') {
      return mockFail(400, 'CHANNEL_UNAVAILABLE', 'Reset codes by phone aren’t available yet. Please choose email.');
    }
    const email = normalizeEmail(rawEmail);
    const previous = pendingResets.get(email);
    const now = Date.now();
    if (previous && now - previous.sentAt < CHALLENGE_WINDOW_MS && !turnstileToken) {
      return mockFail(400, 'CHALLENGE_REQUIRED', 'Please complete the security check and try again.');
    }
    if (previous && now - previous.sentAt < RESEND_WAIT_SECONDS * 1000) {
      return tooManyAttempts(Math.ceil((previous.sentAt + RESEND_WAIT_SECONDS * 1000 - now) / 1000));
    }
    // Tracked for unknown emails too, so the answer never reveals whether an account exists.
    pendingResets.set(email, { code: MOCK_CODE, wrongGuesses: 0, sentAt: now });
    return mockOk({
      data: { channel, nextResendWaitSeconds: RESEND_WAIT_SECONDS, devCode: MOCK_CODE },
      message: 'If an account exists for that email, we sent a reset code.',
    });
  },

  resetPassword: ({ email: rawEmail, code, newPassword }) => {
    const email = normalizeEmail(rawEmail);
    const account = accounts.get(email);
    if (!account || !checkCode(pendingResets.get(email), code)) return invalidCode();
    pendingResets.delete(email);
    account.password = newPassword;
    account.profile = { ...account.profile, hasPassword: true };
    return issueSession(account.profile, 'Password reset — you are now signed in.');
  },

  refresh: () => {
    const profile = readSignedIn();
    return profile ? mockOk(newSession(profile)) : sessionExpired();
  },

  logout: () => {
    writeSignedIn(undefined);
    return mockOk(undefined);
  },

  logoutAll: () => {
    if (!readSignedIn()) return sessionExpired();
    writeSignedIn(undefined);
    return mockOk(undefined);
  },

  me: () => {
    const profile = readSignedIn();
    return profile ? mockOk(profile) : sessionExpired();
  },
};
