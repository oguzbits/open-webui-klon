import { describe, expect, it } from 'vitest';

import { readCookie, SESSION_COOKIE, sessionCookieOptions } from './cookies.js';

describe('readCookie', () => {
  it('reads the value among other cookies', () => {
    expect(readCookie('theme=dark; session=abc123; lang=de', 'session')).toBe('abc123');
  });

  it('takes the first of two cookies with the same name', () => {
    expect(readCookie('session=first; session=second', 'session')).toBe('first');
  });

  it('does not fall back to a later cookie when the first one is empty', () => {
    expect(readCookie('session=; session=tok', 'session')).toBeUndefined();
  });

  it('keeps an equals sign inside the value', () => {
    expect(readCookie('a=b=c', 'a')).toBe('b=c');
  });

  it('finds a valid cookie next to malformed parts', () => {
    expect(readCookie('bad%=1; ;; =x; session=abc', 'session')).toBe('abc');
  });

  it('does not unquote: a quoted value is not one of our tokens', () => {
    expect(readCookie('session="abc"', 'session')).toBe('"abc"');
  });

  it('decodes percent escapes and leaves a broken escape as it is', () => {
    expect(readCookie('session=a%20b', 'session')).toBe('a b');
    expect(readCookie('session=%ZZ', 'session')).toBe('%ZZ');
  });

  it('lets names like __proto__ and constructor do nothing', () => {
    expect(readCookie('__proto__=x; constructor=y; session=1', 'session')).toBe('1');
    expect(readCookie('theme=dark', 'constructor')).toBeUndefined();
    expect(readCookie('theme=dark', '__proto__')).toBeUndefined();
  });

  it.each([undefined, '', ';', ';;', 'session', 'session=', '=x', 'other=1', 'sessionx=1'])(
    'finds nothing in %j',
    (header) => {
      expect(readCookie(header, 'session')).toBeUndefined();
    }
  );
});

describe('sessionCookieOptions', () => {
  it('is httpOnly, SameSite=Lax and site-wide', () => {
    expect(SESSION_COOKIE).toBe('session');
    expect(sessionCookieOptions(false)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    });
  });

  it('sets Secure when asked', () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
  });
});
