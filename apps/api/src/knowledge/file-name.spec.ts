import { describe, expect, it } from 'vitest';

import { cleanFilename, decodeMultipartName, MAX_FILENAME_LENGTH } from './file-name.js';

describe('cleanFilename', () => {
  it.each([
    ['bericht.pdf', 'bericht.pdf'],
    ['../../etc/passwd.txt', 'passwd.txt'],
    ['C:\\Users\\ann\\notiz.md', 'notiz.md'],
    ['a/b\\c.txt', 'c.txt'],
    ['  Übersicht 2026.docx  ', 'Übersicht 2026.docx'],
    ['bad\u0000name\u001b[31m.txt', 'badname[31m.txt'],
    ['evil\u202Etxt.exe', 'eviltxt.exe'],
    ['', 'document'],
    ['///', 'document'],
    ['   ', 'document'],
  ])('turns %j into %j', (input, expected) => {
    expect(cleanFilename(input)).toBe(expected);
  });

  it('cuts a long name to the limit without splitting a character', () => {
    const cleaned = cleanFilename(`${'😀'.repeat(300)}.txt`);

    expect(Array.from(cleaned)).toHaveLength(MAX_FILENAME_LENGTH);
    expect(cleaned).not.toContain('\uFFFD');
  });
});

describe('decodeMultipartName', () => {
  it('restores UTF-8 names that multer read as Latin-1', () => {
    const asMulterSeesIt = Buffer.from('Übersicht für Müller 😀.txt', 'utf8').toString('latin1');

    expect(decodeMultipartName(asMulterSeesIt)).toBe('Übersicht für Müller 😀.txt');
  });

  it.each(['plain.txt', 'caf\u00e9.txt', 'Ã.txt'])(
    'keeps %j when it is not UTF-8 read as Latin-1',
    (name) => {
      expect(decodeMultipartName(name)).toBe(name);
    }
  );
});
