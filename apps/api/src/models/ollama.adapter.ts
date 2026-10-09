import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Injectable } from '@nestjs/common';
import type { LanguageModel } from 'ai';
import { z } from 'zod';

import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { ProviderFetchService } from '../http/safe-fetch/provider-fetch.service.js';
import type { ProviderAdapter, ProviderTarget, RawModel } from './provider-adapter.js';
import { PROVIDER_TYPE } from './provider-type.js';

const TagsAnswer = z.object({ models: z.array(z.object({ name: z.string().min(1) })) });

/** Ollama: the list comes from /api/tags (more metadata), generation goes through its OpenAI-compatible /v1. */
@Injectable()
export class OllamaAdapter implements ProviderAdapter {
  readonly type = PROVIDER_TYPE.OLLAMA;

  constructor(private readonly providerFetch: ProviderFetchService) {}

  async listModels(target: ProviderTarget): Promise<RawModel[]> {
    const json = await this.providerFetch.getJson(target.baseUrl, '/api/tags', target.apiKey);
    const parsed = TagsAnswer.safeParse(json);
    if (!parsed.success) {
      // The issues would echo parts of the answer; the message stays fixed.
      throw new ProviderError(
        PROVIDER_ERROR.BAD_RESPONSE,
        'The model list has an unexpected format'
      );
    }
    return parsed.data.models.map(({ name }) => ({ id: name, name }));
  }

  languageModel(target: ProviderTarget, rawModelId: string): LanguageModel {
    return createOpenAICompatible({
      name: target.connectionId,
      baseURL: `${target.baseUrl}/v1`,
      apiKey: target.apiKey,
      fetch: this.providerFetch.createFetch(target.baseUrl),
    }).languageModel(rawModelId);
  }
}
