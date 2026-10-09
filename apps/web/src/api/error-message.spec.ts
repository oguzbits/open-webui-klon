import { describe, expect, it } from 'vitest';

import { errorMessageKey } from './error-message';
import { ApiError } from './fetcher';

describe('errorMessageKey', () => {
  it.each([
    [403, 'error.forbidden'],
    [404, 'error.notFound'],
    [413, 'error.tooLarge'],
    [429, 'error.tooMany'],
    [500, 'error.generic'],
    [418, 'error.generic'],
  ])('maps status %i to %s', (status, key) => {
    expect(errorMessageKey(new ApiError(status, 'x'))).toBe(key);
  });

  it('lets the caller give a status its own meaning', () => {
    const error = new ApiError(409, 'conflict');

    expect(errorMessageKey(error, { 409: 'auth.error.taken' })).toBe('auth.error.taken');
    expect(errorMessageKey(new ApiError(429, 'x'), { 409: 'auth.error.taken' })).toBe(
      'error.tooMany'
    );
  });

  it('treats anything that is not an ApiError as a network problem', () => {
    expect(errorMessageKey(new TypeError('Failed to fetch'))).toBe('error.network');
    expect(errorMessageKey('boom')).toBe('error.network');
  });
});
