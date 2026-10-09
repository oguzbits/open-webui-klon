import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';

const MAX_TRACKED_KEYS = 10_000;

/**
 * Sliding window per key, held in memory (one API instance; sharing it is in docs/BACKLOG.md). Callers pass the
 * limit, so the per-email and per-IP limits can differ.
 */
@Injectable()
export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly windowMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.windowMs = config.get('LOGIN_WINDOW_SECONDS', { infer: true }) * 1000;
  }

  get trackedKeys(): number {
    return this.attempts.size;
  }

  assertAllowed(key: string, limit: number, now = Date.now()): void {
    if (this.recent(key, now).length >= limit) {
      throw new HttpException('Too many attempts, try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  record(key: string, now = Date.now()): void {
    if (this.attempts.size >= MAX_TRACKED_KEYS) this.makeRoom(now);
    this.attempts.set(key, [...this.recent(key, now), now]);
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private recent(key: string, now: number): number[] {
    return (this.attempts.get(key) ?? []).filter((time) => now - time < this.windowMs);
  }

  /** Drops keys whose attempts all left the window; if that frees nothing, drops the oldest key. */
  private makeRoom(now: number): void {
    for (const [key, times] of this.attempts) {
      if (!times.some((time) => now - time < this.windowMs)) this.attempts.delete(key);
    }
    if (this.attempts.size >= MAX_TRACKED_KEYS) {
      const oldest = this.attempts.keys().next();
      if (oldest.done !== true) this.attempts.delete(oldest.value);
    }
  }
}
