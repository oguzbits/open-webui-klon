import { describe, expect, it } from 'vitest';

import { createTraceparent } from './trace';

describe('createTraceparent', () => {
  it('produces a valid W3C traceparent header value', () => {
    expect(createTraceparent()).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('produces a new value on every call', () => {
    expect(createTraceparent()).not.toBe(createTraceparent());
  });
});
