import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { configOf } from '../testing/provider-fixtures.js';
import { ModelListCache } from './model-list-cache.js';

const MODELS = [{ id: 'llama3:8b', name: 'llama3:8b' }];

function cache(ttlMs = 1000): ModelListCache {
  return new ModelListCache(configOf({ MODEL_LIST_CACHE_TTL_MS: ttlMs }));
}

describe('ModelListCache', () => {
  it('returns a list until its time to live is over', () => {
    const id = randomUUID();
    const lists = cache(1000);

    lists.set(id, MODELS, lists.ticket(id), 10_000);

    expect(lists.get(id, 10_999)).toEqual(MODELS);
    expect(lists.get(id, 11_000)).toBeUndefined();
  });

  it('keeps connections apart', () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const lists = cache();

    lists.set(a, MODELS, lists.ticket(a), 0);

    expect(lists.get(b, 1)).toBeUndefined();
    expect(lists.get(a, 1)).toEqual(MODELS);
  });

  it('forgets a list on invalidate', () => {
    const id = randomUUID();
    const lists = cache();
    lists.set(id, MODELS, lists.ticket(id), 0);

    lists.invalidate(id);

    expect(lists.get(id, 1)).toBeUndefined();
  });

  it('drops an answer that was requested before an invalidation', () => {
    const id = randomUUID();
    const lists = cache();
    const ticket = lists.ticket(id);

    lists.invalidate(id);
    lists.set(id, MODELS, ticket, 0);

    expect(lists.get(id, 1)).toBeUndefined();
  });

  it('does not cache at all with a time to live of 0', () => {
    const id = randomUUID();
    const lists = cache(0);

    lists.set(id, MODELS, lists.ticket(id), 0);

    expect(lists.get(id, 0)).toBeUndefined();
  });
});
