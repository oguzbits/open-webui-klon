import { describe, expect, it } from 'vitest';

import { fallbackTitle, sanitizeTitle } from './chat-title.js';

describe('fallbackTitle', () => {
  it('collapses whitespace and cuts at 60 characters', () => {
    expect(fallbackTitle('  Hallo \n\n  Welt  ')).toBe('Hallo Welt');
    expect(Array.from(fallbackTitle('a'.repeat(200)))).toHaveLength(60);
  });

  it('does not cut a character in half', () => {
    const title = fallbackTitle('😀'.repeat(100));

    expect(Array.from(title)).toHaveLength(60);
    expect(title).not.toContain('�');
  });
});

describe('sanitizeTitle', () => {
  it.each([
    ['"Ein Titel"', 'Ein Titel'],
    ['„Ein Titel“', 'Ein Titel'],
    ['# Ein **Titel**', 'Ein Titel'],
    ['\n\nErste Zeile\nZweite Zeile', 'Erste Zeile'],
    ['Titel\u0000mit\u0007Steuerzeichen', 'TitelmitSteuerzeichen'],
    ['   ', ''],
    ['', ''],
    ['"""', ''],
  ])('turns %j into %j', (raw, expected) => {
    expect(sanitizeTitle(raw)).toBe(expected);
  });

  it('cuts at 80 characters', () => {
    expect(Array.from(sanitizeTitle('b'.repeat(300)))).toHaveLength(80);
  });

  it('keeps markup-like text as plain characters (it is only ever shown as text)', () => {
    expect(sanitizeTitle('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});
