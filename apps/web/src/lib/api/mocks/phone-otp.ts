// Mock phone codes, shaped like /api/v1/public/otp. Fictional numbers only.
//
// Try it with (spaces and dashes are fine):
//   - +94 77 000 0001     has one portal account (Nimali): the code signs her in
//   - +94 77 000 0003     shared by two portal accounts: sign-in answers PHONE_ACCOUNT_AMBIGUOUS
//   - any other number    has no portal account: sign-in answers PHONE_ACCOUNT_NOT_FOUND
//   - +94 77 000 0009     rate-limited: 429 with a 45 s Retry-After
//   - +94 77 000 0000     the daily cap is reached: 503
// The code is always 123456; 5 wrong guesses use it up (CODE_EXPIRED). Asking for another code
// within the wait answers 429, and after it, within 15 minutes, needs the security check. The
// wait grows with each send (30 s, 60 s, 2 min, 5 min), like the API's progressive cooldown.

import {
  normalizePhone,
  type PhoneOtpPurpose,
  type PhoneOtpSendResponse,
  type PhoneOtpVerifyResponse,
} from '@remedist/shared';
import type { PhoneOtpApi } from '../phone-otp';
import { mockFail, mockOk } from './helpers';

const MOCK_CODE = '123456';
const MAX_WRONG_GUESSES = 5;
const CODE_TTL_MS = 10 * 60_000;
const PROOF_TTL_MS = 10 * 60_000;
const CHALLENGE_WINDOW_MS = 15 * 60_000;
const COOLDOWNS_SECONDS = [30, 60, 120, 300];
const THROTTLED_PHONE = '+94770000009';
const THROTTLE_WAIT_SECONDS = 45;
const DAILY_CAP_PHONE = '+94770000000';

/** The prefix of a mock phone verification token; the mock phone sign-in reads the number after it. */
export const MOCK_PHONE_PROOF_PREFIX = 'mock-phone-verified';

interface PendingPhoneCode {
  purpose: PhoneOtpPurpose;
  code: string;
  wrongGuesses: number;
  expiresAt: number;
}

interface SendHistory {
  firstSentAt: number;
  lastSentAt: number;
  sends: number;
}

const pending = new Map<string, PendingPhoneCode>();
const history = new Map<string, SendHistory>();

const cooldownAfter = (sends: number) => COOLDOWNS_SECONDS[Math.min(sends, COOLDOWNS_SECONDS.length) - 1] ?? 0;

const tooManyRequests = (seconds: number) =>
  mockFail(429, 'TOO_MANY_REQUESTS', `Too many attempts — try again in ${seconds} seconds.`, undefined, {
    retryAfterSeconds: seconds,
  });

export const mockPhoneOtpApi: PhoneOtpApi = {
  send: ({ phoneNumber: raw, purpose, turnstileToken }) => {
    const phoneNumber = normalizePhone(raw);
    const now = Date.now();
    // The API's order: limits and cooldown first, then the security check.
    if (phoneNumber === DAILY_CAP_PHONE) {
      return mockFail(503, 'SERVICE_UNAVAILABLE', 'Verification codes are temporarily unavailable — please try again later.');
    }
    if (phoneNumber === THROTTLED_PHONE) return tooManyRequests(THROTTLE_WAIT_SECONDS);

    const previous = history.get(phoneNumber);
    const recent = previous && now - previous.firstSentAt < CHALLENGE_WINDOW_MS ? previous : undefined;
    if (recent) {
      const waitUntil = recent.lastSentAt + cooldownAfter(recent.sends) * 1000;
      if (now < waitUntil) return tooManyRequests(Math.ceil((waitUntil - now) / 1000));
      if (!turnstileToken) {
        return mockFail(400, 'CHALLENGE_REQUIRED', 'Please complete the security check and try again.');
      }
    }

    const sends = (recent?.sends ?? 0) + 1;
    history.set(phoneNumber, { firstSentAt: recent?.firstSentAt ?? now, lastSentAt: now, sends });
    pending.set(phoneNumber, { purpose, code: MOCK_CODE, wrongGuesses: 0, expiresAt: now + CODE_TTL_MS });
    const data: PhoneOtpSendResponse = {
      channel: 'whatsapp',
      expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
      nextResendWaitSeconds: cooldownAfter(sends),
      devCode: MOCK_CODE,
    };
    return mockOk({ data, message: 'Verification code sent.' });
  },

  verify: ({ phoneNumber: raw, purpose, code }) => {
    const phoneNumber = normalizePhone(raw);
    const entry = pending.get(phoneNumber);
    const usable =
      entry && entry.purpose === purpose && entry.wrongGuesses < MAX_WRONG_GUESSES && entry.expiresAt > Date.now();
    if (!entry || !usable) {
      return mockFail(410, 'CODE_EXPIRED', 'That code has expired — please request a new one.');
    }
    if (code !== entry.code) {
      entry.wrongGuesses += 1;
      return mockFail(400, 'INVALID_CODE', "That code doesn't match — check and try again.");
    }
    pending.delete(phoneNumber);
    const data: PhoneOtpVerifyResponse = {
      verified: true,
      phoneNumber,
      purpose,
      phoneVerificationToken: `${MOCK_PHONE_PROOF_PREFIX}:${purpose}:${phoneNumber}`,
      expiresAt: new Date(Date.now() + PROOF_TTL_MS).toISOString(),
    };
    return mockOk({ data, message: 'Phone number verified.' });
  },
};
