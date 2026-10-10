import { describe, expect, it } from 'vitest';

import {
  draftFromParams,
  PARAM_LIMITS,
  PARAM_NAME,
  paramsFromDraft,
  type ParamsDraft,
} from './chat-params-form';

const EMPTY: ParamsDraft = { temperature: '', topP: '', maxOutputTokens: '' };

describe('draftFromParams', () => {
  it('shows the stored values as text and leaves the unset ones empty', () => {
    expect(draftFromParams({ temperature: 0.7, maxOutputTokens: 2048 })).toEqual({
      temperature: '0.7',
      topP: '',
      maxOutputTokens: '2048',
    });
  });

  it('keeps a stored zero: temperature 0 is a setting, not an empty field', () => {
    expect(draftFromParams({ temperature: 0 }).temperature).toBe('0');
  });
});

describe('paramsFromDraft', () => {
  it('takes only the fields that are filled', () => {
    expect(paramsFromDraft(EMPTY)).toEqual({ ok: true, params: {} });
    expect(paramsFromDraft({ ...EMPTY, topP: '0.9' })).toEqual({ ok: true, params: { topP: 0.9 } });
  });

  it('keeps a zero', () => {
    expect(paramsFromDraft({ ...EMPTY, temperature: '0' })).toEqual({
      ok: true,
      params: { temperature: 0 },
    });
  });

  it('accepts a decimal comma and surrounding spaces', () => {
    expect(paramsFromDraft({ ...EMPTY, temperature: ' 0,7 ' })).toEqual({
      ok: true,
      params: { temperature: 0.7 },
    });
  });

  it('accepts the limits themselves', () => {
    const result = paramsFromDraft({ temperature: '2', topP: '1', maxOutputTokens: '100000' });

    expect(result).toEqual({
      ok: true,
      params: { temperature: 2, topP: 1, maxOutputTokens: 100000 },
    });
  });

  it.each([
    [PARAM_NAME.TEMPERATURE, '2.1'],
    [PARAM_NAME.TEMPERATURE, '-0.5'],
    [PARAM_NAME.TEMPERATURE, 'abc'],
    [PARAM_NAME.TEMPERATURE, '1e1'],
    [PARAM_NAME.TEMPERATURE, '0.7.1'],
    [PARAM_NAME.TOP_P, '1.01'],
    [PARAM_NAME.MAX_OUTPUT_TOKENS, '0'],
    [PARAM_NAME.MAX_OUTPUT_TOKENS, '100001'],
    [PARAM_NAME.MAX_OUTPUT_TOKENS, '1.5'],
    [PARAM_NAME.MAX_OUTPUT_TOKENS, '1,5'],
  ])('rejects %s = %j and names the field', (name, text) => {
    expect(paramsFromDraft({ ...EMPTY, [name]: text })).toEqual({ ok: false, invalid: [name] });
  });

  it('names every field that is wrong, not only the first', () => {
    expect(paramsFromDraft({ temperature: '9', topP: '9', maxOutputTokens: '5' })).toEqual({
      ok: false,
      invalid: [PARAM_NAME.TEMPERATURE, PARAM_NAME.TOP_P],
    });
  });

  it('uses the same limits as the server declares', () => {
    expect(PARAM_LIMITS).toEqual({
      temperature: { min: 0, max: 2, integer: false },
      topP: { min: 0, max: 1, integer: false },
      maxOutputTokens: { min: 1, max: 100000, integer: true },
    });
  });
});
