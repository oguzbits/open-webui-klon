import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'session';

/** Minimal Cookie header lookup: the first cookie with that name wins, malformed parts are skipped. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    const quoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
    const value = quoted ? raw.slice(1, -1) : raw;
    return value === '' ? undefined : value;
  }
  return undefined;
}

/** Same options for setting and clearing; the caller adds `expires` when setting. */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}
