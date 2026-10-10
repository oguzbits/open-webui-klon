import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildPdf } from '../testing/pdf-builder.js';
import { configOf } from '../testing/provider-fixtures.js';
import { ParseError } from './parse-error.js';
import { ParserService } from './parser.service.js';
import { DOCUMENT_FAILURE, DOCUMENT_TYPE } from './rag-dictionaries.js';

function parser(overrides: Record<string, unknown> = {}): ParserService {
  return new ParserService(
    configOf({
      RAG_MAX_PAGES: 3,
      RAG_PARSE_TIMEOUT_MS: 20_000,
      RAG_PARSE_MEMORY_MB: 256,
      ...overrides,
    })
  );
}

const encoder = new TextEncoder();

async function failureOf(work: Promise<unknown>): Promise<ParseError> {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!(outcome instanceof ParseError)) throw new Error('expected a ParseError');
  return outcome;
}

describe('ParserService', () => {
  it('reads the text of every page of a PDF with its page number', async () => {
    const result = await parser().parse(
      buildPdf(['Seite eins Hund', 'Seite zwei Katze']),
      DOCUMENT_TYPE.PDF
    );

    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]).toMatchObject({ page: 1 });
    expect(result.pages[0]?.text).toContain('Seite eins Hund');
    expect(result.pages[1]).toMatchObject({ page: 2 });
    expect(result.pages[1]?.text).toContain('Seite zwei Katze');
  });

  it('reads the text of a DOCX as one page without a number', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('./fixtures/hello.docx', import.meta.url)));

    const result = await parser().parse(bytes, DOCUMENT_TYPE.DOCX);

    expect(result.pageCount).toBeNull();
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.page).toBeNull();
    expect(result.pages[0]?.text).toContain('Der Urlaubsanspruch beträgt dreißig Tage.');
    expect(result.pages[0]?.text).toContain('Zweiter Absatz.');
  });

  it('decodes Markdown and plain text without a worker and drops a byte order mark', async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encoder.encode('# Titel\n\nÜber uns')]);

    const markdown = await parser().parse(withBom, DOCUMENT_TYPE.MARKDOWN);
    const text = await parser().parse(encoder.encode('Hallo'), DOCUMENT_TYPE.TEXT);

    expect(markdown).toEqual({
      pages: [{ page: null, text: '# Titel\n\nÜber uns' }],
      pageCount: null,
    });
    expect(text.pages).toEqual([{ page: null, text: 'Hallo' }]);
  });

  it('refuses a PDF with more pages than the limit', async () => {
    const pdf = buildPdf(['a', 'b', 'c', 'd']);

    expect((await failureOf(parser().parse(pdf, DOCUMENT_TYPE.PDF))).reason).toBe(
      DOCUMENT_FAILURE.TOO_MANY_PAGES
    );
    await expect(parser({ RAG_MAX_PAGES: 4 }).parse(pdf, DOCUMENT_TYPE.PDF)).resolves.toBeDefined();
  });

  it('reports no_text for a PDF without a text layer and for white space only', async () => {
    const scan = buildPdf([null, null]);

    expect((await failureOf(parser().parse(scan, DOCUMENT_TYPE.PDF))).reason).toBe(
      DOCUMENT_FAILURE.NO_TEXT
    );
    expect(
      (await failureOf(parser().parse(encoder.encode(' \n\t '), DOCUMENT_TYPE.TEXT))).reason
    ).toBe(DOCUMENT_FAILURE.NO_TEXT);
  });

  it('turns bytes that are not the claimed type into unreadable without quoting them', async () => {
    const garbage = encoder.encode('this is not a pdf, password=hunter2');

    const pdf = await failureOf(parser().parse(garbage, DOCUMENT_TYPE.PDF));
    const docx = await failureOf(parser().parse(garbage, DOCUMENT_TYPE.DOCX));

    expect(pdf.reason).toBe(DOCUMENT_FAILURE.UNREADABLE);
    expect(docx.reason).toBe(DOCUMENT_FAILURE.UNREADABLE);
    expect(pdf.message).not.toContain('hunter2');
  });
});
