import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  csrfHeaderFor,
  notifyUnauthorized,
  rememberCsrfToken,
  setUnauthorizedHandler,
} from './session-state';

afterEach(() => {
  rememberCsrfToken(undefined);
  setUnauthorizedHandler(undefined);
});

describe('session state', () => {
  it('offers the token for writing methods only, in any letter case', () => {
    rememberCsrfToken('token-1');

    expect(csrfHeaderFor('POST')).toBe('token-1');
    expect(csrfHeaderFor('patch')).toBe('token-1');
    expect(csrfHeaderFor('DELETE')).toBe('token-1');
    expect(csrfHeaderFor('GET')).toBeUndefined();
    expect(csrfHeaderFor('head')).toBeUndefined();
  });

  it('offers nothing before a token is known and after it was forgotten', () => {
    expect(csrfHeaderFor('POST')).toBeUndefined();
    rememberCsrfToken('token-1');
    rememberCsrfToken(undefined);

    expect(csrfHeaderFor('POST')).toBeUndefined();
  });

  it('calls the registered handler and survives having none', () => {
    expect(() => {
      notifyUnauthorized();
    }).not.toThrow();
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    notifyUnauthorized();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
