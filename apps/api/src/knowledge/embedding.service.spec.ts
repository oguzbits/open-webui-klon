import { ServiceUnavailableException } from '@nestjs/common';
import { MockEmbeddingModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { NotFoundException } from '@nestjs/common';
import { fakeEmbedding } from '../testing/fake-embedding.js';
import { configOf } from '../testing/provider-fixtures.js';
import { EmbeddingService } from './embedding.service.js';
import { KNOWLEDGE_UNAVAILABLE } from './rag-dictionaries.js';

const MODEL_ID = 'connection-1:nomic-embed-text';

function setup(options: { modelId?: string; resolve?: () => Promise<never> } = {}) {
  const model = new MockEmbeddingModelV4({
    maxEmbeddingsPerCall: 100,
    doEmbed: ({ values }) =>
      Promise.resolve({
        embeddings: values.map((value) => fakeEmbedding(value)),
        usage: { tokens: values.length * 2 },
        warnings: [],
      }),
  });
  const resolved: string[] = [];
  const registry = {
    resolveEmbedding: (modelId: string) => {
      resolved.push(modelId);
      return options.resolve?.() ?? Promise.resolve({ model, rawModelId: 'nomic-embed-text' });
    },
  };
  const modelId = 'modelId' in options ? options.modelId : MODEL_ID;
  const service = new EmbeddingService(registry, configOf({ EMBEDDING_MODEL_ID: modelId }));
  return { service, model, resolved };
}

async function unavailable(work: Promise<unknown>): Promise<ServiceUnavailableException> {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!(outcome instanceof ServiceUnavailableException)) throw new Error('expected a 503');
  return outcome;
}

describe('EmbeddingService', () => {
  it('embeds texts with the configured model and reports its id and the token count', async () => {
    const { service, model, resolved } = setup();

    const result = await service.embedTexts(['Der Hund bellt', 'Die Katze schläft']);

    expect(resolved).toEqual([MODEL_ID]);
    expect(result.modelId).toBe(MODEL_ID);
    expect(result.vectors).toEqual([
      fakeEmbedding('Der Hund bellt'),
      fakeEmbedding('Die Katze schläft'),
    ]);
    expect(result.tokens).toBe(4);
    expect(model.doEmbedCalls).toHaveLength(1);
  });

  it('embeds a query as one vector', async () => {
    const { service } = setup();

    const result = await service.embedQuery('Urlaub');

    expect(result).toEqual({ modelId: MODEL_ID, vector: fakeEmbedding('Urlaub') });
  });

  it('makes no call for an empty list', async () => {
    const { service, model, resolved } = setup();

    expect(await service.embedTexts([])).toEqual({ modelId: MODEL_ID, vectors: [], tokens: 0 });
    expect(model.doEmbedCalls).toHaveLength(0);
    expect(resolved).toEqual([]);
  });

  it('answers 503 knowledge_unavailable without a model id and never invents a vector', async () => {
    const { service, model, resolved } = setup({ modelId: undefined });

    expect(service.isConfigured()).toBe(false);
    const error = await unavailable(service.embedQuery('Urlaub'));
    await unavailable(service.embedTexts(['a']));

    expect(error.message).toBe(KNOWLEDGE_UNAVAILABLE);
    expect(resolved).toEqual([]);
    expect(model.doEmbedCalls).toHaveLength(0);
  });

  it('answers 503 when the registry no longer knows the model (hidden or disabled connection)', async () => {
    const { service } = setup({
      resolve: () => Promise.reject(new NotFoundException('Model not found')),
    });

    expect(service.isConfigured()).toBe(true);
    expect((await unavailable(service.embedQuery('Urlaub'))).message).toBe(KNOWLEDGE_UNAVAILABLE);
  });

  it('lets a provider failure through with its reason', async () => {
    const failure = new ProviderError(PROVIDER_ERROR.UNREACHABLE, 'down');
    const { service } = setup({ resolve: () => Promise.reject(failure) });

    await expect(service.embedQuery('Urlaub')).rejects.toBe(failure);
  });
});
