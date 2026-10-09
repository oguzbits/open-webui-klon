import { describe, expect, it } from 'vitest';

import { emailTransform, normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });
});

describe('emailTransform', () => {
  it('normalizes strings and passes everything else on for the validator to reject', () => {
    expect(emailTransform({ value: ' A@B.test ' })).toBe('a@b.test');
    expect(emailTransform({ value: 42 })).toBe(42);
    expect(emailTransform({ value: undefined })).toBeUndefined();
  });
});
