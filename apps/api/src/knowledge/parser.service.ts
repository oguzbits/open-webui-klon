import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';

import type { Env } from '../config/env.js';
import type { PageText } from './chunker.js';
import { ParseError } from './parse-error.js';
import { DOCUMENT_FAILURE, DOCUMENT_TYPE, type DocumentType } from './rag-dictionaries.js';
import { runWorker } from './worker-runner.js';

export interface ParsedDocument {
  pages: PageText[];
  pageCount: number | null;
}

const WorkerAnswer = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    pages: z.array(z.object({ page: z.number().int().min(1).nullable(), text: z.string() })),
    pageCount: z.number().int().min(0).nullable(),
  }),
  z.object({ ok: z.literal(false), reason: z.literal(DOCUMENT_FAILURE.TOO_MANY_PAGES) }),
]);

/** The worker is a `.ts` file when the sources run (tests) and a `.js` file after the build. */
const WORKER_URL = new URL(
  import.meta.url.endsWith('.ts') ? './parse-worker.ts' : './parse-worker.js',
  import.meta.url
);

/**
 * Turns an uploaded file into page texts. PDF and DOCX are parsed in a worker thread with memory and time limits;
 * Markdown and plain text are only decoded. Every failure is a `ParseError` with a coarse reason.
 */
@Injectable()
export class ParserService {
  private readonly maxPages: number;
  private readonly timeoutMs: number;
  private readonly memoryMb: number;

  constructor(config: ConfigService<Env, true>) {
    this.maxPages = config.get('RAG_MAX_PAGES', { infer: true });
    this.timeoutMs = config.get('RAG_PARSE_TIMEOUT_MS', { infer: true });
    this.memoryMb = config.get('RAG_PARSE_MEMORY_MB', { infer: true });
  }

  async parse(bytes: Uint8Array, type: DocumentType): Promise<ParsedDocument> {
    const parsed =
      type === DOCUMENT_TYPE.MARKDOWN || type === DOCUMENT_TYPE.TEXT
        ? decodeText(bytes)
        : await this.parseInWorker(bytes, type);
    if (parsed.pages.every((page) => page.text.trim() === '')) {
      throw new ParseError(DOCUMENT_FAILURE.NO_TEXT);
    }
    return parsed;
  }

  private async parseInWorker(
    bytes: Uint8Array,
    type: typeof DOCUMENT_TYPE.PDF | typeof DOCUMENT_TYPE.DOCX
  ): Promise<ParsedDocument> {
    const answer = await runWorker(
      WORKER_URL,
      { type, bytes, maxPages: this.maxPages },
      { timeoutMs: this.timeoutMs, memoryMb: this.memoryMb }
    );
    const parsed = WorkerAnswer.safeParse(answer);
    if (!parsed.success) throw new ParseError(DOCUMENT_FAILURE.UNREADABLE);
    if (!parsed.data.ok) throw new ParseError(parsed.data.reason);
    return { pages: parsed.data.pages, pageCount: parsed.data.pageCount };
  }
}

function decodeText(bytes: Uint8Array): ParsedDocument {
  try {
    // The decoder drops a leading byte order mark.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { pages: [{ page: null, text }], pageCount: null };
  } catch {
    throw new ParseError(DOCUMENT_FAILURE.UNREADABLE);
  }
}
