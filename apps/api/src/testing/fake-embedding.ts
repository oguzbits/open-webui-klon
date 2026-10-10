export const FAKE_EMBEDDING_DIMENSIONS = 16;

function hashOf(word: string): number {
  let hash = 2166136261;
  for (const char of word) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0;
  }
  return hash;
}

/**
 * A deterministic stand-in for an embedding model: words are hashed into buckets and the vector is normalized, so
 * texts that share words are close in cosine distance. No network, same result every run.
 */
export function fakeEmbedding(text: string, dimensions = FAKE_EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const bucket = hashOf(word) % dimensions;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }
  const length = Math.hypot(...vector);
  if (length === 0) return vector.map((_, index) => (index === 0 ? 1 : 0));
  return vector.map((value) => value / length);
}
