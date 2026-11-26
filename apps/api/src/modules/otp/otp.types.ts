/** Who a code is for: an email address or a phone number (E.164). */
export type OtpIdentifier = { kind: 'email'; value: string } | { kind: 'phone'; value: string };

/** Matches the CHECK on auth.otp_requests.purpose. */
export type OtpPurpose = 'login' | 'admin_login' | 'email_verification' | 'password_reset';

/** Matches the message_channel domain. */
export type OtpChannel = 'email' | 'sms' | 'whatsapp';

/** Matches the CHECK on auth.otp_requests.delivery_status. Only 'sent' rows cost money. */
export type OtpDeliveryStatus = 'sent' | 'failed' | 'skipped';

export type OtpVerifyResult =
  | { verified: true }
  | { verified: false; reason: 'not_found' | 'expired' | 'mismatch' | 'too_many_attempts' };

/** For logs: never the full address or number. */
export function maskIdentifier(identifier: OtpIdentifier): string {
  if (identifier.kind === 'phone') {
    return `${identifier.value.slice(0, 4)}***${identifier.value.slice(-2)}`;
  }
  const [local = '', domain = ''] = identifier.value.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
