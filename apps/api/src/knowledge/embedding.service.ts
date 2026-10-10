import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { embed, embedMany } from 'ai';

import type { Env } from '../config/env.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { KNOWLEDGE_UNAVAILABLE } from './rag-dictionaries.js';

const MAX_RETRIES = 2;

/**
 * Embeddings from the model named in `EMBEDDING_MODEL_ID`. Without that model (not configured, or its connection
 * is hidden or disabled) every call answers 503 `knowledge_unavailable`: there is no stand-in vector. Provider
 * failures are thrown unchanged so the caller can tell them from a missing setup.
 */
@Injectable()
export class EmbeddingService {
  private readonly modelId: string | undefined;

  constructor(
    // A Pick has no runtime type, so the token is named for Nest.
    @Inject(ModelRegistryService)
    private readonly registry: Pick<ModelRegistryService, 'resolveEmbedding'>,
    config: ConfigService<Env, true>
  ) {
    this.modelId = config.get('EMBEDDING_MODEL_ID', { infer: true });
  }

  isConfigured(): boolean {
    return this.modelId !== undefined;
  }

  async embedTexts(
    texts: string[],
    signal?: AbortSignal
  ): Promise<{ modelId: string; vectors: number[][]; tokens: number }> {
    const modelId = this.requireModelId();
    if (texts.length === 0) return { modelId, vectors: [], tokens: 0 };
    const model = await this.resolve(modelId);
    const result = await embedMany({
      model,
      values: texts,
      maxRetries: MAX_RETRIES,
      abortSignal: signal,
    });
    return { modelId, vectors: result.embeddings, tokens: result.usage.tokens };
  }

  async embedQuery(
    text: string,
    signal?: AbortSignal
  ): Promise<{ modelId: string; vector: number[] }> {
    const modelId = this.requireModelId();
    const model = await this.resolve(modelId);
    const result = await embed({
      model,
      value: text,
      maxRetries: MAX_RETRIES,
      abortSignal: signal,
    });
    return { modelId, vector: result.embedding };
  }

  private requireModelId(): string {
    if (this.modelId === undefined) throw new ServiceUnavailableException(KNOWLEDGE_UNAVAILABLE);
    return this.modelId;
  }

  private async resolve(modelId: string) {
    try {
      return (await this.registry.resolveEmbedding(modelId)).model;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new ServiceUnavailableException(KNOWLEDGE_UNAVAILABLE);
      }
      throw error;
    }
  }
}
