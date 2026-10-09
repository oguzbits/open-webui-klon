import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/fetcher';
import { UnavailableConnectionDtoReason } from '@/api/generated/model';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';

import { reasonKey, testFailureKey } from './provider-reason';

function textAt(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null || !(part in node)) return undefined;
    return (node as Record<string, unknown>)[part];
  }, tree);
}

describe('reasonKey', () => {
  it.each(Object.values(UnavailableConnectionDtoReason))(
    'gives %s a text in German and English',
    (reason) => {
      const key = reasonKey(reason);
      expect(key).not.toBe('connections.reason.unknown');
      expect(typeof textAt(de, key)).toBe('string');
      expect(typeof textAt(en, key)).toBe('string');
    }
  );

  it('falls back to a neutral sentence for a reason it does not know', () => {
    expect(reasonKey('something_new')).toBe('connections.reason.unknown');
    expect(reasonKey(undefined)).toBe('connections.reason.unknown');
    expect(typeof textAt(de, 'connections.reason.unknown')).toBe('string');
  });
});

describe('testFailureKey', () => {
  it('names the reason of a 502 from the provider', () => {
    const error = new ApiError(502, 'Bad Gateway', undefined, undefined, 'unauthorized');
    expect(testFailureKey(error)).toBe(reasonKey('unauthorized'));
  });

  it('uses the neutral sentence for a 502 without reason', () => {
    expect(testFailureKey(new ApiError(502, 'Bad Gateway'))).toBe('connections.reason.unknown');
  });

  it('leaves every other failure to the shared messages', () => {
    expect(testFailureKey(new ApiError(404, 'Not Found'))).toBe('error.notFound');
    expect(testFailureKey(new ApiError(500, 'Boom'))).toBe('error.generic');
    expect(testFailureKey(new TypeError('Failed to fetch'))).toBe('error.network');
  });
});
