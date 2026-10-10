import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { configOf } from '../testing/provider-fixtures.js';
import { StreamSlots } from './stream-slots.js';

function slots(limit = 2): StreamSlots {
  return new StreamSlots(configOf({ CHAT_MAX_CONCURRENT_STREAMS: limit }));
}

describe('StreamSlots', () => {
  it('refuses the stream over the limit with 429, per user', () => {
    const pool = slots();
    pool.acquire('ann');
    pool.acquire('ann');

    expect(() => pool.acquire('ann')).toThrowError(
      expect.objectContaining({ status: HttpStatus.TOO_MANY_REQUESTS })
    );
    expect(() => pool.acquire('ben')).not.toThrow();
  });

  it('gives the place back on release, and a second release does nothing', () => {
    const pool = slots(1);
    const release = pool.acquire('ann');
    release();
    release();

    const again = pool.acquire('ann');

    expect(() => pool.acquire('ann')).toThrow();
    again();
    expect(() => pool.acquire('ann')).not.toThrow();
  });
});
