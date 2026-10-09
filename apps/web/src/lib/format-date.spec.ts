import { describe, expect, it } from 'vitest';

import { formatDate } from './format-date';

describe('formatDate', () => {
  it('writes the day in the language of the interface, without a time', () => {
    expect(formatDate('2026-10-01T12:00:00.000Z', 'de')).toMatch(/^0?1\.\s?(10\.|Okt\.?)\s?2026$/);
    expect(formatDate('2026-10-01T12:00:00.000Z', 'en')).toMatch(/Oct/);
  });
});
