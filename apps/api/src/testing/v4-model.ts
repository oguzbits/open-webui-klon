import type { EmbeddingModel, LanguageModel } from 'ai';

/** `LanguageModel` is a union (model id string, v2, v3, v4); the adapters hand out v4, and tests call it directly. */
export function asV4(model: LanguageModel) {
  if (typeof model === 'string' || model.specificationVersion !== 'v4') {
    throw new Error('expected a v4 language model');
  }
  return model;
}

export function asEmbeddingV4(model: EmbeddingModel) {
  if (typeof model === 'string' || model.specificationVersion !== 'v4') {
    throw new Error('expected a v4 embedding model');
  }
  return model;
}
