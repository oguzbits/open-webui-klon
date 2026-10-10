import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/fetcher';

import { chatErrorKey, isStreamFailure, STREAM_ERROR_TEXT } from './chat-errors';

describe('isStreamFailure', () => {
  it('recognises the fixed error text the server sends inside a stream', () => {
    expect(isStreamFailure(new Error(STREAM_ERROR_TEXT))).toBe(true);
  });

  it('does not take other errors or a failed request for a stream failure', () => {
    expect(isStreamFailure(new Error('boom'))).toBe(false);
    expect(isStreamFailure(new ApiError(500, STREAM_ERROR_TEXT))).toBe(false);
    expect(isStreamFailure(STREAM_ERROR_TEXT)).toBe(false);
  });
});

describe('chatErrorKey', () => {
  it.each([
    [new Error(STREAM_ERROR_TEXT), 'chats.error.streamFailed'],
    [new ApiError(404, 'Not Found'), 'chats.error.gone'],
    [new ApiError(422, 'Unprocessable'), 'chats.error.tooLong'],
    [new ApiError(429, 'Too Many Requests'), 'chats.error.tooManyStreams'],
    [new ApiError(403, 'Forbidden'), 'error.forbidden'],
    [new ApiError(500, 'Internal'), 'error.generic'],
    [new TypeError('Failed to fetch'), 'error.network'],
  ])('maps %s to %s', (error, key) => {
    expect(chatErrorKey(error)).toBe(key);
  });
});
