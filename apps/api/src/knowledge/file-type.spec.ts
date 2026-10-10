import { describe, expect, it } from 'vitest';

import { detectDocumentType } from './file-type.js';
import { DOCUMENT_TYPE } from './rag-dictionaries.js';

const encoder = new TextEncoder();

function bytes(...parts: (string | number[])[]): Uint8Array {
  return Uint8Array.from(
    parts.flatMap((part) => (typeof part === 'string' ? [...encoder.encode(part)] : part))
  );
}

const ZIP_HEADER = [0x50, 0x4b, 0x03, 0x04];
const docx = bytes(
  ZIP_HEADER,
  [0, 0, 0, 0],
  '[Content_Types].xml',
  [0, 0],
  'word/document.xml',
  [0, 0]
);

describe('detectDocumentType', () => {
  it('recognizes a PDF by its header whatever the file is called', () => {
    expect(detectDocumentType(bytes('%PDF-1.7\n...'), 'a.pdf')).toBe(DOCUMENT_TYPE.PDF);
    expect(detectDocumentType(bytes('%PDF-1.7\n...'), 'a.txt')).toBe(DOCUMENT_TYPE.PDF);
  });

  it('recognizes a DOCX as a ZIP with the Word entries', () => {
    expect(detectDocumentType(docx, 'report.docx')).toBe(DOCUMENT_TYPE.DOCX);
  });

  it('refuses a ZIP without the Word entries and bytes that only carry the extension', () => {
    const plainZip = bytes(ZIP_HEADER, [0, 0, 0, 0], 'notes.txt', [0, 0]);
    const wordNotZip = bytes('[Content_Types].xml word/ but no ZIP header');

    expect(detectDocumentType(plainZip, 'report.docx')).toBeUndefined();
    expect(detectDocumentType(wordNotZip, 'report.docx')).toBeUndefined();
    expect(detectDocumentType(bytes('Hello'), 'report.docx')).toBeUndefined();
    expect(detectDocumentType(bytes('Hello'), 'report.pdf')).toBeUndefined();
  });

  it('tells Markdown from plain text by the extension and accepts a byte order mark', () => {
    expect(detectDocumentType(bytes('# Titel\n\nText'), 'notes.md')).toBe(DOCUMENT_TYPE.MARKDOWN);
    expect(detectDocumentType(bytes('# Titel'), 'NOTES.MARKDOWN')).toBe(DOCUMENT_TYPE.MARKDOWN);
    expect(detectDocumentType(bytes('Text'), 'notes.txt')).toBe(DOCUMENT_TYPE.TEXT);
    expect(detectDocumentType(bytes([0xef, 0xbb, 0xbf], 'Text'), 'notes.txt')).toBe(
      DOCUMENT_TYPE.TEXT
    );
    expect(detectDocumentType(bytes('Text'), 'notes')).toBeUndefined();
    expect(detectDocumentType(bytes('Text'), 'notes.exe')).toBeUndefined();
  });

  it('refuses binary content under a text extension (NUL byte, invalid UTF-8) and empty files', () => {
    expect(detectDocumentType(bytes('MZ', [0, 3, 0], 'program'), 'notes.txt')).toBeUndefined();
    expect(detectDocumentType(bytes([0xff, 0xfe, 0xfd]), 'notes.txt')).toBeUndefined();
    expect(detectDocumentType(new Uint8Array(0), 'notes.txt')).toBeUndefined();
  });
});
