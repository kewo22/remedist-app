// Helpers for calling the API from server components and route handlers.
// The browser sends the auth cookies itself; on the server we forward the incoming request's
// cookies so the API sees the same session. The server never refreshes a session (it can't set
// the browser's cookies); an expired token surfaces as a 401 and the client side refreshes.
//
// For this to work in production the web app and the API must share a parent domain
// (for example theremedist.com and api.theremedist.com) and the API must set its cookies on it.

import { cookies } from 'next/headers';

/** Headers to pass as `headers` in RequestOptions for a server-side call that needs the session. */
export async function forwardedAuthHeaders(): Promise<HeadersInit> {
  const store = await cookies();
  const cookieHeader = store
    .getAll()
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  return cookieHeader ? { Cookie: cookieHeader } : {};
}
