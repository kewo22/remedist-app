// Zod pieces for the client auth forms. Quick feedback only: the API validates everything.
// Limits come from packages/shared so the form and the API agree.

import { CLIENT_PASSWORD_MIN_LENGTH, ONE_TIME_CODE_PATTERN, PASSWORD_MAX_LENGTH } from '@remedist/shared';
import { z } from 'zod';

export const emailField = z.string().trim().pipe(z.email({ error: 'Enter a valid email address.' }));

/** A password being set (sign-up, reset). */
export const newPasswordField = z
  .string()
  .min(CLIENT_PASSWORD_MIN_LENGTH, { error: `Use at least ${CLIENT_PASSWORD_MIN_LENGTH} characters.` })
  .max(PASSWORD_MAX_LENGTH, { error: `Use at most ${PASSWORD_MAX_LENGTH} characters.` });

/** A password being entered to sign in: only check it isn't empty. */
export const currentPasswordField = z.string().min(1, { error: 'Enter your password.' });

export const oneTimeCodeField = z
  .string()
  .trim()
  .regex(ONE_TIME_CODE_PATTERN, { error: 'Enter the 6-digit code from the email.' });

export const nameField = z.string().trim().min(1, { error: 'Enter your name.' });
