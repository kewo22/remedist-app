import { safeNextPath } from '@/lib/auth/redirect';

export type AuthSearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The safe `?next=` path for an auth page. */
export async function readNextParam(searchParams: AuthSearchParams): Promise<string> {
  const { next } = await searchParams;
  return safeNextPath(typeof next === 'string' ? next : undefined);
}
