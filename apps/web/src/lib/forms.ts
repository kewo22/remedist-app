// Glue between react-hook-form and the API's error envelope.
//
// Zod schemas in the web app are for quick feedback while typing. The API is what actually
// validates: always pass its errors back onto the form with applyApiErrors.

import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { getErrorMessage, getFieldErrors } from '@/lib/api/errors';

/** Where the form-level (not field-level) error message is stored. Read it with `formState.errors.root?.server`. */
export const SERVER_ERROR_KEY = 'root.server' as const;

/**
 * Puts an API error onto a form: each VALIDATION_FAILED field message on its field, and the
 * envelope's message (or a network message) as the form-level error.
 * `fields` lists the form's field names; API errors for other fields are folded into the form-level message.
 */
export function applyApiErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): void {
  const known = new Set<string>(fields);
  const unmatched: string[] = [];
  let focused = false;

  for (const [field, messages] of Object.entries(getFieldErrors(error))) {
    if (known.has(field)) {
      setError(field as Path<T>, { type: 'server', message: messages.join(' ') }, { shouldFocus: !focused });
      focused = true;
    } else {
      unmatched.push(...messages);
    }
  }

  const message = [getErrorMessage(error), ...unmatched].join(' ');
  setError(SERVER_ERROR_KEY, { type: 'server', message });
}
