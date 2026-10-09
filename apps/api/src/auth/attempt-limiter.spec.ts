import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { Env } from '../config/env.js';
import { AttemptLimiter } from './attempt-limiter.js';

function limiter(): AttemptLimiter {
  return new AttemptLimiter(new ConfigService<Env, true>({ LOGIN_WINDOW_SECONDS: 60 }));
}

describe('AttemptLimiter', () => {
  it('allows attempts up to the limit, then answers 429', () => {
    const attempts = limiter();
    for (let index = 0; index < 3; index += 1) attempts.record('email:a', 1000);

    expect(() => attempts.assertAllowed('email:a', 3, 1000)).toThrow(
      expect.objectContaining({ status: 429 })
    );
    expect(() => attempts.assertAllowed('email:a', 4, 1000)).not.toThrow();
  });

  it('forgets attempts once the window has passed', () => {
    const attempts = limiter();
    for (let index = 0; index < 3; index += 1) attempts.record('email:a', 1000);

    expect(() => attempts.assertAllowed('email:a', 3, 1000 + 59_000)).toThrow();
    expect(() => attempts.assertAllowed('email:a', 3, 1000 + 61_000)).not.toThrow();
  });

  it('counts every key on its own and can reset one', () => {
    const attempts = limiter();
    attempts.record('email:a', 1000);
    attempts.record('email:b', 1000);

    attempts.reset('email:a');

    expect(() => attempts.assertAllowed('email:a', 1, 1000)).not.toThrow();
    expect(() => attempts.assertAllowed('email:b', 1, 1000)).toThrow();
  });

  it('keeps its memory bounded when flooded with distinct keys', () => {
    const attempts = limiter();

    for (let index = 0; index < 10_050; index += 1) attempts.record(`email:${index}`, 1000);

    expect(attempts.trackedKeys).toBeLessThanOrEqual(10_000);
  });
});
