import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import type { RawModel } from './provider-adapter.js';

interface Entry {
  models: RawModel[];
  expiresAt: number;
}

/**
 * Short-lived model lists per connection, in memory. Only successes are stored. `ticket()` is taken before a
 * request to the provider; an answer that arrives after `invalidate()` carries an old ticket and is dropped, so
 * a list fetched with the old URL or key does not outlive an edit.
 */
@Injectable()
export class ModelListCache {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, Entry>();
  private readonly generations = new Map<string, number>();

  constructor(config: ConfigService<Env, true>) {
    this.ttlMs = config.get('MODEL_LIST_CACHE_TTL_MS', { infer: true });
  }

  get(connectionId: string, now = Date.now()): RawModel[] | undefined {
    const entry = this.entries.get(connectionId);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(connectionId);
      return undefined;
    }
    return entry.models;
  }

  ticket(connectionId: string): number {
    return this.generations.get(connectionId) ?? 0;
  }

  set(connectionId: string, models: RawModel[], ticket: number, now = Date.now()): void {
    if (this.ttlMs <= 0 || ticket !== this.ticket(connectionId)) return;
    this.entries.set(connectionId, { models, expiresAt: now + this.ttlMs });
  }

  invalidate(connectionId: string): void {
    this.entries.delete(connectionId);
    this.generations.set(connectionId, this.ticket(connectionId) + 1);
  }
}
