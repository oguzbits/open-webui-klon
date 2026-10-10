import type { EmbeddingModel, LanguageModel } from 'ai';

import type { ProviderType } from './provider-type.js';

/** Everything an adapter needs to reach one connection. The key is plain text and lives in memory only. */
export interface ProviderTarget {
  connectionId: string;
  /** Normalized: no trailing slash, no credentials. */
  baseUrl: string;
  apiKey: string | undefined;
}

export interface RawModel {
  /** The provider's own id, for example `llama3:8b`. */
  id: string;
  name: string;
}

export interface ProviderAdapter {
  readonly type: ProviderType;
  /** Throws ProviderError; an unexpected answer format is BAD_RESPONSE. */
  listModels(target: ProviderTarget): Promise<RawModel[]>;
  /** No network call: the returned model calls the provider when it is used. */
  languageModel(target: ProviderTarget, rawModelId: string): LanguageModel;
  /** No network call either; the request goes through the same guarded fetch as every other call to the provider. */
  embeddingModel(target: ProviderTarget, rawModelId: string): EmbeddingModel;
}

export const PROVIDER_ADAPTERS = Symbol('PROVIDER_ADAPTERS');
