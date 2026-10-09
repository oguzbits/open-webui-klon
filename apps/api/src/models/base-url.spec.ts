import { describe, expect, it } from 'vitest';

import { BASE_URL_PROBLEM, InvalidBaseUrlError, normalizeBaseUrl } from './base-url.js';

function problemOf(raw: string): string | undefined {
  try {
    normalizeBaseUrl(raw);
  } catch (error) {
    if (error instanceof InvalidBaseUrlError) return error.problem;
    throw error;
  }
  return undefined;
}

describe('normalizeBaseUrl', () => {
  it.each([
    ['http://localhost:11434', 'http://localhost:11434'],
    ['http://localhost:11434/', 'http://localhost:11434'],
    ['HTTP://Ollama.Local:11434//', 'http://ollama.local:11434'],
    ['  https://api.example.com/v1/  ', 'https://api.example.com/v1'],
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    ['https://api.example.com:443/v1', 'https://api.example.com/v1'],
    ['http://[::1]:11434/', 'http://[::1]:11434'],
    ['http://10.0.0.5/api?', 'http://10.0.0.5/api'],
  ])('turns %j into %j', (raw, expected) => {
    expect(normalizeBaseUrl(raw)).toBe(expected);
  });

  it.each([
    ['', BASE_URL_PROBLEM.INVALID],
    ['   ', BASE_URL_PROBLEM.INVALID],
    ['not a url', BASE_URL_PROBLEM.INVALID],
    ['//host/v1', BASE_URL_PROBLEM.INVALID],
    ['localhost:11434', BASE_URL_PROBLEM.SCHEME],
    ['ftp://host', BASE_URL_PROBLEM.SCHEME],
    ['file:///etc/passwd', BASE_URL_PROBLEM.SCHEME],
    ['javascript:alert(1)', BASE_URL_PROBLEM.SCHEME],
    ['http://user:pass@host', BASE_URL_PROBLEM.CREDENTIALS],
    ['http://user@host', BASE_URL_PROBLEM.CREDENTIALS],
    ['https://host/v1?token=abc', BASE_URL_PROBLEM.QUERY],
    ['https://host/v1#frag', BASE_URL_PROBLEM.QUERY],
  ])('rejects %j (%s)', (raw, problem) => {
    expect(problemOf(raw)).toBe(problem);
  });

  it('never repeats the rejected input in the message', () => {
    expect(() => normalizeBaseUrl('http://user:hunter2@host')).not.toThrow(/hunter2/);
  });
});
