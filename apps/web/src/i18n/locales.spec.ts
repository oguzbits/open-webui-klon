import { describe, expect, it } from 'vitest';

import de from './locales/de.json';
import en from './locales/en.json';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix === '' ? key : `${prefix}.${key}`)
  );
}

function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(texts);
}

describe('locales', () => {
  it('define the same keys in German and English', () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(de).sort());
  });

  it('contain no empty texts', () => {
    for (const text of [...texts(de), ...texts(en)]) {
      expect(text.trim()).not.toBe('');
    }
  });
});
