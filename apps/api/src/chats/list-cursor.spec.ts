import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor, escapeLike } from './list-cursor.js';

describe('cursor', () => {
  it('round-trips a microsecond timestamp and an id', () => {
    const cursor = {
      ts: '2026-10-10T09:00:00.123456Z',
      id: '0f1c9b0e-0000-4000-8000-000000000001',
    };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each([
    '',
    'not base64 json',
    Buffer.from('{"ts":1,"id":2}').toString('base64url'),
    // Well-formed JSON with text that Postgres cannot cast would end as a 500.
    Buffer.from('{"ts":"x","id":"y"}').toString('base64url'),
    Buffer.from('{"ts":"2026-10-10T09:00:00.123456Z","id":"y"}').toString('base64url'),
    Buffer.from(
      '{"ts":"2026-02-31T09:00:00.123456Z","id":"0f1c9b0e-0000-4000-8000-000000000001"}'
    ).toString('base64url'),
    Buffer.from('{"ts":"x","id":"0f1c9b0e-0000-4000-8000-000000000001"}').toString('base64url'),
  ])('rejects %j', (value) => {
    expect(decodeCursor(value)).toBeUndefined();
  });
});

describe('escapeLike', () => {
  it('masks the wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
