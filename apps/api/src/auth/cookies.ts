import { parseCookie } from 'cookie';
import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'session';

/**
 * Value of the first cookie with that name; an empty value counts as missing. Parsing follows RFC 6265 (package
 * `cookie`): no unquoting, percent escapes are decoded, a broken escape stays as it is, and the result has no
 * prototype, so names like `constructor` find nothing.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  const value = parseCookie(header)[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Same options for setting and clearing; the caller adds `expires` when setting. */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}
