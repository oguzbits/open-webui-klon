import { describe, expect, it } from 'vitest';

import { chunkPages } from './chunker.js';

const OPTIONS = { chars: 100, overlap: 20 };

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `w${String(index).padStart(4, '0')}`).join(
    ' '
  );
}

describe('chunkPages', () => {
  it('keeps every chunk within the size and numbers them without gaps across pages', () => {
    const chunks = chunkPages(
      [
        { page: 1, text: words(60) },
        { page: 2, text: words(40) },
      ],
      OPTIONS
    );

    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.every((chunk) => chunk.content.length <= OPTIONS.chars)).toBe(true);
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index));
    expect(chunks.some((chunk) => chunk.page === 1)).toBe(true);
    expect(chunks.some((chunk) => chunk.page === 2)).toBe(true);
    expect(chunks.map((chunk) => chunk.page)).toEqual(
      [...chunks.map((chunk) => chunk.page)].sort()
    );
  });

  it('repeats the end of a chunk at the start of the next one, on a word boundary', () => {
    const chunks = chunkPages([{ page: null, text: words(60) }], OPTIONS);

    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]?.content ?? '';
      const first = (chunks[index]?.content ?? '').split(' ')[0] ?? '';
      expect(first).toMatch(/^w\d{4}$/);
      expect(previous).toContain(first);
    }
  });

  it('prefers a paragraph break and loses no word', () => {
    const text = `${words(10)}\n\n${words(10)}`;

    const chunks = chunkPages([{ page: null, text }], { chars: 90, overlap: 0 });

    expect(chunks.map((chunk) => chunk.content)).toEqual([words(10), words(10)]);
  });

  it('returns nothing for pages that hold only white space', () => {
    expect(chunkPages([{ page: 1, text: '  \n\n \t ' }], OPTIONS)).toEqual([]);
    expect(chunkPages([], OPTIONS)).toEqual([]);
  });

  it('cuts a word that is longer than a chunk instead of looping forever', () => {
    const chunks = chunkPages([{ page: null, text: 'x'.repeat(10_000) }], OPTIONS);

    expect(chunks.every((chunk) => chunk.content.length <= OPTIONS.chars)).toBe(true);
    expect(chunks.length).toBeGreaterThanOrEqual(10_000 / OPTIONS.chars);
  }, 2000);

  it('rejects an overlap that is not smaller than the chunk size', () => {
    expect(() => chunkPages([{ page: null, text: 'abc' }], { chars: 100, overlap: 100 })).toThrow(
      /overlap/
    );
  });
});
