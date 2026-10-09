import { describe, expect, it } from 'vitest';

import { API_KEY_PREFIX, generateApiKey, generateToken, safeEqual, sha256Hex } from './tokens.js';

describe('tokens', () => {
  it('generates unguessable, unique, URL-safe session tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));

    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates api keys with the sk- prefix and 256 bits of randomness', () => {
    const key = generateApiKey();

    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key).toMatch(/^sk-[0-9a-f]{64}$/);
    expect(generateApiKey()).not.toBe(key);
  });

  it('hashes to a stable 64 character hex digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('compares in constant time and rejects different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });
});
