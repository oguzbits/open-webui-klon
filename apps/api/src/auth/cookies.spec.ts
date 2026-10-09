import { describe, expect, it } from 'vitest';

import { readCookie, SESSION_COOKIE, sessionCookieOptions } from './cookies.js';

describe('readCookie', () => {
  it('reads the value among other cookies', () => {
    expect(readCookie('theme=dark; session=abc123; lang=de', 'session')).toBe('abc123');
  });

  it('takes the first of two cookies with the same name', () => {
    expect(readCookie('session=first; session=second', 'session')).toBe('first');
  });

  it('strips surrounding quotes', () => {
    expect(readCookie('session="abc"', 'session')).toBe('abc');
  });

  it('keeps an equals sign inside the value', () => {
    expect(readCookie('a=b=c', 'a')).toBe('b=c');
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
