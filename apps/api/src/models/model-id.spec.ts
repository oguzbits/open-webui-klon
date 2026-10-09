import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { formatModelId, parseModelId } from './model-id.js';

const CONNECTION = randomUUID();

describe('model ids', () => {
  it.each([
    'gpt-4o',
    'llama3:8b',
    'hf.co/acme/model:Q4_K_M',
    'mistral:7b-instruct-v0.3-q4_0',
    'a:b:c',
  ])('round-trips %s (split at the first colon only)', (raw) => {
    const id = formatModelId(CONNECTION, raw);

    expect(id).toBe(`${CONNECTION}:${raw}`);
    expect(parseModelId(id)).toEqual({ connectionId: CONNECTION, rawModelId: raw });
  });

  it.each([
    ['empty', ''],
    ['no colon', CONNECTION],
    ['nothing after the colon', `${CONNECTION}:`],
    ['no connection', ':llama3'],
    ['connection is not a uuid', 'prod:llama3'],
    ['uuid with trailing text', `${CONNECTION}x:llama3`],
    ['control character', `${CONNECTION}:llama\n3`],
    ['too long', `${CONNECTION}:${'a'.repeat(600)}`],
  ])('rejects an id with %s', (_name, id) => {
    expect(parseModelId(id)).toBeUndefined();
  });

  it('accepts an upper-case connection id', () => {
    expect(parseModelId(`${CONNECTION.toUpperCase()}:m`)?.rawModelId).toBe('m');
  });
});
