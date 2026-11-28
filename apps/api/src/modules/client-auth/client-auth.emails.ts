import type { EmailMessage } from '../../integrations/email/email.provider';
import { codeBlock, emailLayout as layout, escapeHtml } from '../messaging/templates/email-layout';

// The portal's account emails, worded as in the old app. Names are escaped: they're typed by
// whoever fills in the sign-up form.

export function verificationCodeEmail(to: string, name: string, code: string, ttlMinutes: number): EmailMessage {
  return {
    to,
    subject: 'Verify your email — The Remedist',
    html: layout(`
      <h2>Hi ${escapeHtml(name)},</h2>
      <p>Your verification code for The Remedist client portal is:</p>
      ${codeBlock(code)}
      <p>This code expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.</p>`),
  };
}

export function passwordResetCodeEmail(to: string, name: string, code: string, ttlMinutes: number): EmailMessage {
  return {
    to,
    subject: 'Reset your password — The Remedist',
    html: layout(`
      <h2>Hi ${escapeHtml(name)},</h2>
      <p>Your password reset code for The Remedist client portal is:</p>
      ${codeBlock(code)}
      <p>This code expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email — your password won't be changed.</p>`),
  };
}

/** Sent instead of a code when someone signs up with an email that already has an account. */
export function accountExistsEmail(to: string, name: string): EmailMessage {
  return {
    to,
    subject: 'Your Remedist account',
    html: layout(`
      <h2>Hi ${escapeHtml(name || 'there')},</h2>
      <p>Someone (hopefully you) tried to create a client-portal account with this email. You already have one — log in instead, or use Forgot password if you need to reset it. If you signed up with Google, continue with Google.</p>
      <p>If this wasn't you, you can ignore this email.</p>`),
  };
}
