import type { PhoneMessage } from '../../../integrations/messaging/phone-templates';

/**
 * A phone verification or password reset code. WhatsApp uses the approved Authentication
 * template (its wording is fixed by Meta); SMS gets the full sentence, as in the old app.
 */
export function verificationCodeMessage(code: string, ttlMinutes: number, kind: 'verification' | 'password_reset'): PhoneMessage {
  const what = kind === 'password_reset' ? 'password reset code' : 'verification code';
  return {
    template: 'verification_code',
    variables: [code],
    text: `Your Remedist ${what} is ${code}. It expires in ${ttlMinutes} minutes.`,
  };
}
