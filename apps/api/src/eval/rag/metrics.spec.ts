import { describe, expect, it } from 'vitest';

import { rankOf, summarize } from './metrics.js';

const hits = [
  { filename: 'a.md', page: 1 },
  { filename: 'b.pdf', page: 3 },
  { filename: 'b.pdf', page: 4 },
];

describe('rankOf', () => {
  it('counts places from 1 and finds the first match', () => {
    expect(rankOf(hits, { filename: 'a.md' })).toBe(1);
    expect(rankOf(hits, { filename: 'b.pdf' })).toBe(2);
  });

  it('needs the page too when one is expected', () => {
    expect(rankOf(hits, { filename: 'b.pdf', page: 4 })).toBe(3);
    expect(rankOf(hits, { filename: 'b.pdf', page: 9 })).toBeUndefined();
  });

  it('is undefined for a document that was not found', () => {
    expect(rankOf(hits, { filename: 'c.md' })).toBeUndefined();
  });
});

describe('summarize', () => {
  it('counts first places, places within K and the mean reciprocal rank', () => {
    const summary = summarize([1, 2, undefined, 7], 6);

    expect(summary).toEqual({
      questions: 4,
      hitAt1: 0.25,
      hitAtK: 0.5,
      mrr: (1 + 0.5 + 1 / 7) / 4,
    });
  });

  it('answers zero for an empty list instead of dividing by zero', () => {
    expect(summarize([], 6)).toEqual({ questions: 0, hitAt1: 0, hitAtK: 0, mrr: 0 });
  });
});
