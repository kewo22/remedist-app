// Phone verification by one-time code (WhatsApp, falling back to SMS). Public: no sign-in needed.
// A successful check returns a short-lived signed token that proves the phone was verified for
// that purpose; later steps (a booking, a phone login) send it instead of trusting the browser.

export const PHONE_OTP_ROUTES = {
  /** POST PhoneOtpSendRequest → PhoneOtpSendResponse (201). */
  send: '/public/otp/send',
  /** POST PhoneOtpVerifyRequest → PhoneOtpVerifyResponse. */
  verify: '/public/otp/verify',
} as const;

/** 'phone_change' proves the new number when a client changes it in their portal profile. */
export const PHONE_OTP_PURPOSES = ['login', 'booking_verification', 'phone_change'] as const;
export type PhoneOtpPurpose = (typeof PHONE_OTP_PURPOSES)[number];

/** How the code was delivered: WhatsApp first, SMS if WhatsApp isn't available. */
export type PhoneOtpChannel = 'whatsapp' | 'sms';

export interface PhoneOtpSendRequest {
  /** With country code; spaces and dashes are fine (normalised to +<digits>). */
  phoneNumber: string;
  purpose: PhoneOtpPurpose;
  /** Needed from the second send in 15 minutes; the API answers CHALLENGE_REQUIRED without it. */
  turnstileToken?: string;
}

export interface PhoneOtpSendResponse {
  channel: PhoneOtpChannel;
  /** ISO 8601. When this code stops working. */
  expiresAt: string;
  /** Seconds before another code can be requested, so the page can show a countdown. */
  nextResendWaitSeconds: number;
  /** Only outside production when WhatsApp/SMS sending is in demo mode. */
  devCode?: string;
}

export interface PhoneOtpVerifyRequest {
  phoneNumber: string;
  purpose: PhoneOtpPurpose;
  /** The 6-digit code. */
  code: string;
}

export interface PhoneOtpVerifyResponse {
  verified: true;
  /** The normalised phone number (+<digits>) that was verified. */
  phoneNumber: string;
  purpose: PhoneOtpPurpose;
  /** Send this to the step that needs a verified phone. Valid until `expiresAt`, for this purpose only. */
  phoneVerificationToken: string;
  /** ISO 8601. */
  expiresAt: string;
}
