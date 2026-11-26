// Phone verification by one-time code: /api/v1/public/otp. Contract: PHONE_OTP_ROUTES.
//
// `verify` returns a short-lived phoneVerificationToken; the step that needs a verified phone
// (a phone login, a booking) sends it on. Public routes: no access token.

import {
  PHONE_OTP_ROUTES,
  type PhoneOtpSendRequest,
  type PhoneOtpSendResponse,
  type PhoneOtpVerifyRequest,
  type PhoneOtpVerifyResponse,
} from '@remedist/shared';
import { apiRequestEnvelope } from './client';
import type { WithMessage } from './client-auth';
import { mockPhoneOtpApi } from './mocks/phone-otp';
import { selectApi } from './mode';

export interface PhoneOtpApi {
  send(body: PhoneOtpSendRequest): Promise<WithMessage<PhoneOtpSendResponse>>;
  verify(body: PhoneOtpVerifyRequest): Promise<WithMessage<PhoneOtpVerifyResponse>>;
}

async function post<T>(path: string, body: unknown): Promise<WithMessage<T>> {
  const envelope = await apiRequestEnvelope<T>(path, { method: 'POST', body });
  return { data: envelope.data, message: envelope.message };
}

const livePhoneOtpApi: PhoneOtpApi = {
  send: (body) => post(PHONE_OTP_ROUTES.send, body),
  verify: (body) => post(PHONE_OTP_ROUTES.verify, body),
};

export const phoneOtpApi = selectApi<PhoneOtpApi>({ live: livePhoneOtpApi, mock: mockPhoneOtpApi });
