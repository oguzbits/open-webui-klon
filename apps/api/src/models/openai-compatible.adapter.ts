import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Injectable } from '@nestjs/common';
import type { EmbeddingModel, LanguageModel } from 'ai';
import { z } from 'zod';

import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { ProviderFetchService } from '../http/safe-fetch/provider-fetch.service.js';
import type { ProviderAdapter, ProviderTarget, RawModel } from './provider-adapter.js';
import { PROVIDER_TYPE } from './provider-type.js';

const ModelsAnswer = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });

/** Any endpoint that speaks the OpenAI format; the base URL already contains the version path (`…/v1`). */
@Injectable()
export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly type = PROVIDER_TYPE.OPENAI_COMPATIBLE;

  constructor(private readonly providerFetch: ProviderFetchService) {}

  async listModels(target: ProviderTarget): Promise<RawModel[]> {
    const json = await this.providerFetch.getJson(target.baseUrl, '/models', target.apiKey);
    const parsed = ModelsAnswer.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(
        PROVIDER_ERROR.BAD_RESPONSE,
        'The model list has an unexpected format'
      );
    }
    return parsed.data.data.map(({ id }) => ({ id, name: id }));
  }

  languageModel(target: ProviderTarget, rawModelId: string): LanguageModel {
    return createOpenAICompatible({
      name: target.connectionId,
      baseURL: target.baseUrl,
      apiKey: target.apiKey,
      fetch: this.providerFetch.createFetch(target.baseUrl),
    }).languageModel(rawModelId);
  }

  embeddingModel(target: ProviderTarget, rawModelId: string): EmbeddingModel {
    return createOpenAICompatible({
      name: target.connectionId,
      baseURL: target.baseUrl,
      apiKey: target.apiKey,
      fetch: this.providerFetch.createFetch(target.baseUrl),
    }).embeddingModel(rawModelId);
  }
}
