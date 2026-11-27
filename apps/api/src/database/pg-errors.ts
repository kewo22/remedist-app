// Recognising Postgres errors without importing `pg` outside DatabaseService.

const UNIQUE_VIOLATION = '23505';

/**
 * True when `error` is a unique-index violation on `constraint` (the index name). Repositories use
 * it as the backstop for a race that a pre-check can miss.
 */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code, constraint: violated } = error as { code?: unknown; constraint?: unknown };
  return code === UNIQUE_VIOLATION && violated === constraint;
}
