import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';

/** Limits the streams a user runs at the same time. In memory, so it counts per API process. */
@Injectable()
export class StreamSlots {
  private readonly limit: number;
  private readonly running = new Map<string, number>();

  constructor(config: ConfigService<Env, true>) {
    this.limit = config.get('CHAT_MAX_CONCURRENT_STREAMS', { infer: true });
  }

  /** Takes a place or throws 429. Call the returned function exactly when the stream is over (idempotent). */
  acquire(userId: string): () => void {
    const current = this.running.get(userId) ?? 0;
    if (current >= this.limit) {
      throw new HttpException('Too many running answers', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.running.set(userId, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.running.get(userId) ?? 1) - 1;
      if (left <= 0) this.running.delete(userId);
      else this.running.set(userId, left);
    };
  }
}
