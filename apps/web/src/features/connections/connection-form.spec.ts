import { describe, expect, it } from 'vitest';

import { providerConnectionDto } from '@/test/fixtures';

import { buildPatch, type ConnectionForm, KEY_MODE } from './connection-form';

const STORED = providerConnectionDto({
  name: 'Cloud',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
});
const UNCHANGED: ConnectionForm = {
  name: 'Cloud',
  baseUrl: 'https://api.example.com/v1',
  keyMode: KEY_MODE.KEEP,
  newKey: '',
};

describe('buildPatch', () => {
  it('is empty when nothing changed', () => {
    expect(buildPatch(STORED, UNCHANGED)).toEqual({});
  });

  it('ignores spaces around unchanged values', () => {
    expect(
      buildPatch(STORED, {
        ...UNCHANGED,
        name: '  Cloud ',
        baseUrl: ' https://api.example.com/v1 ',
      })
    ).toEqual({});
  });

  it('sends only the fields that changed', () => {
    expect(buildPatch(STORED, { ...UNCHANGED, name: 'Cloud 2' })).toEqual({ name: 'Cloud 2' });
    expect(buildPatch(STORED, { ...UNCHANGED, baseUrl: 'https://other.example.com' })).toEqual({
      baseUrl: 'https://other.example.com',
    });
  });

  it('replaces the key with the trimmed new one', () => {
    expect(
      buildPatch(STORED, { ...UNCHANGED, keyMode: KEY_MODE.REPLACE, newKey: ' sk-new ' })
    ).toEqual({ apiKey: 'sk-new' });
  });

  it('leaves the key alone when replacing without typing anything', () => {
    expect(buildPatch(STORED, { ...UNCHANGED, keyMode: KEY_MODE.REPLACE, newKey: '  ' })).toEqual(
      {}
    );
  });

  it('removes the key with null', () => {
    expect(buildPatch(STORED, { ...UNCHANGED, keyMode: KEY_MODE.REMOVE })).toEqual({
      apiKey: null,
    });
  });

  it('ignores text typed earlier while the key is kept', () => {
    expect(buildPatch(STORED, { ...UNCHANGED, newKey: 'sk-stale' })).toEqual({});
  });
});
