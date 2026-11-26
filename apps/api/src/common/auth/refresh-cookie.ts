import type { CookieOptions, Request, Response } from 'express';

/**
 * The httpOnly refresh-token cookie for one audience. Scoped to that audience's auth routes, so
 * the browser never sends it anywhere else in the API.
 */
export class RefreshCookie {
  constructor(
    private readonly name: string,
    private readonly path: string,
  ) {}

  read(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[this.name];
    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  set(response: Response, token: string, expires: Date, secure: boolean): void {
    response.cookie(this.name, token, { ...this.options(secure), expires });
  }

  clear(response: Response, secure: boolean): void {
    response.clearCookie(this.name, this.options(secure));
  }

  private options(secure: boolean): CookieOptions {
    return { httpOnly: true, secure, sameSite: 'strict', path: this.path };
  }
}
