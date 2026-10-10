import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { RAG_JOB } from '../jobs/job-names.js';
import { JOB_QUEUE } from '../jobs/job-queue.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { fakeEmbedding, FAKE_EMBEDDING_DIMENSIONS } from '../testing/fake-embedding.js';
import { FakeJobQueue, FIRST_ATTEMPT, LAST_ATTEMPT } from '../testing/fake-job-queue.js';
import { type Login, signupUser } from '../testing/http-session.js';
import { insertChunk, insertDocument, sha256Of } from '../testing/knowledge-fixtures.js';
import { EmbeddingService } from './embedding.service.js';
import { FILE_STORAGE, type FileStorage } from './file-storage.js';
import { IngestionService } from './ingestion.service.js';
import { ParseError } from './parse-error.js';
import type { ParsedDocument } from './parser.service.js';
import { ParserService } from './parser.service.js';
import {
  DOCUMENT_FAILURE,
  DOCUMENT_STATUS,
  DOCUMENT_TYPE,
  type DocumentFailure,
} from './rag-dictionaries.js';

const MODEL_ID = 'connection:embed';
const SECRET_NAME = 'geheimer-dateiname.pdf';
const SECRET_TEXT = 'Vertraulicher Absatz über die Gehaltsverhandlung.';

class FakeEmbedder {
  readonly batches: string[][] = [];
  failWith: Error | undefined;
  beforeAnswer: (() => Promise<void>) | undefined;

  isConfigured(): boolean {
    return true;
  }

  async embedTexts(
    texts: string[]
  ): Promise<{ modelId: string; vectors: number[][]; tokens: number }> {
    this.batches.push(texts);
    await this.beforeAnswer?.();
    if (this.failWith !== undefined) throw this.failWith;
    return {
      modelId: MODEL_ID,
      vectors: texts.map((text) => fakeEmbedding(text)),
      tokens: texts.length,
    };
  }

  get texts(): string[] {
    return this.batches.flat();
  }
}

const DEFAULT_PARSED = (): Promise<ParsedDocument> =>
  Promise.resolve({ pages: [{ page: null, text: 'Standardtext' }], pageCount: null });

class FakeParser {
  parsed: () => Promise<ParsedDocument> = DEFAULT_PARSED;

  parse(): Promise<ParsedDocument> {
    return this.parsed();
  }
}

describe('ingestion (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let storage: FileStorage;
  let queue: FakeJobQueue;
  let ingestion: IngestionService;
  let user: Login;
  const embedder = new FakeEmbedder();
  const parser = new FakeParser();

  afterEach(async () => {
    await app?.close();
    embedder.batches.length = 0;
    embedder.failWith = undefined;
    embedder.beforeAnswer = undefined;
    parser.parsed = DEFAULT_PARSED;
  });

  async function start(env: Record<string, string> = {}): Promise<void> {
    app = await createDbTestApp(
      testDatabaseUrl(),
      {
        EMBEDDING_MODEL_ID: MODEL_ID,
        RAG_CHUNK_CHARS: '100',
        RAG_CHUNK_OVERLAP_CHARS: '10',
        ...env,
      },
      {
        configure: (builder) =>
          builder
            .overrideProvider(EmbeddingService)
            .useValue(embedder)
            .overrideProvider(ParserService)
            .useValue(parser),
      }
    );
    dataSource = app.get(DataSource);
    storage = app.get<FileStorage>(FILE_STORAGE);
    queue = app.get<FakeJobQueue>(JOB_QUEUE);
    ingestion = app.get(IngestionService);
    user = await signupUser(request(app.getHttpServer()), { email: 'ann@example.com' });
  }

  async function pendingDocument(overrides: Parameters<typeof insertDocument>[2] = {}) {
    const document = await insertDocument(dataSource, user.user.id, {
      status: DOCUMENT_STATUS.PENDING,
      type: DOCUMENT_TYPE.PDF,
      filename: SECRET_NAME,
      sha256: sha256Of(randomUUID()),
      pageCount: null,
      ...overrides,
    });
    await storage.put(document.storageKey, new TextEncoder().encode('%PDF-1.4 inhalt'));
    return document;
  }

  const chunksOf = (documentId: string) =>
    dataSource.query<
      {
        ordinal: number;
        content: string;
        page: number | null;
        model: string;
        dims: number;
        user_id: string;
      }[]
    >(
      `SELECT ordinal, content, page, embedding_model_id AS model, vector_dims(embedding) AS dims, user_id
         FROM chunk WHERE document_id = $1 ORDER BY ordinal`,
      [documentId]
    );
  const documentOf = async (id: string) =>
    (
      await dataSource.query<
        { status: string; failure_reason: string | null; page_count: number | null }[]
      >('SELECT status, failure_reason, page_count FROM document WHERE id = $1', [id])
    )[0];

  it('reads a document into ordered chunks with vectors, and is ready', async () => {
    await start();
    const document = await pendingDocument();
    parser.parsed = () =>
      Promise.resolve({
        pages: [
          { page: 1, text: 'Erste Seite mit einem kurzen Text über Hunde.' },
          { page: 2, text: 'Zweite Seite. '.repeat(12) },
        ],
        pageCount: 2,
      });
    await queue.send(RAG_JOB.INGEST_DOCUMENT, { documentId: document.id });

    await queue.run(RAG_JOB.INGEST_DOCUMENT);

    expect(await documentOf(document.id)).toEqual({
      status: DOCUMENT_STATUS.READY,
      failure_reason: null,
      page_count: 2,
    });
    const chunks = await chunksOf(document.id);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index));
    expect(chunks[0]).toMatchObject({ page: 1, model: MODEL_ID, user_id: user.user.id });
    expect(chunks.at(-1)?.page).toBe(2);
    expect(chunks.map((chunk) => chunk.content)).toEqual(embedder.texts);
    expect(new Set(chunks.map((chunk) => chunk.dims))).toEqual(
      new Set([FAKE_EMBEDDING_DIMENSIONS])
    );
  });

  it('does nothing the second time the same job runs', async () => {
    await start();
    const document = await pendingDocument();
    await ingestion.ingest(document.id, FIRST_ATTEMPT);
    const embedded = embedder.batches.length;
    const before = await chunksOf(document.id);

    await ingestion.ingest(document.id, FIRST_ATTEMPT);

    expect(embedder.batches).toHaveLength(embedded);
    expect(await chunksOf(document.id)).toEqual(before);
    expect((await documentOf(document.id))?.status).toBe(DOCUMENT_STATUS.READY);
  });

  it('leaves a failed document alone', async () => {
    await start();
    const document = await pendingDocument({
      status: DOCUMENT_STATUS.FAILED,
      failureReason: DOCUMENT_FAILURE.NO_TEXT,
    });

    await ingestion.ingest(document.id, FIRST_ATTEMPT);

    expect(embedder.batches).toHaveLength(0);
    expect(await documentOf(document.id)).toMatchObject({ status: DOCUMENT_STATUS.FAILED });
  });

  it('replaces chunks of an earlier run instead of adding to them', async () => {
    await start();
    const document = await pendingDocument({ status: DOCUMENT_STATUS.PROCESSING });
    for (const ordinal of [0, 7]) {
      await insertChunk(dataSource, {
        documentId: document.id,
        userId: user.user.id,
        ordinal,
        content: 'alt',
        embedding: [1, 0],
      });
    }

    await ingestion.ingest(document.id, FIRST_ATTEMPT);

    const chunks = await chunksOf(document.id);
    expect(chunks.map((chunk) => chunk.content)).toEqual(['Standardtext']);
  });

  it('ends ready with one set of chunks after a try that broke off', async () => {
    await start();
    const document = await pendingDocument();
    embedder.failWith = new Error('provider down');
    await expect(ingestion.ingest(document.id, FIRST_ATTEMPT)).rejects.toThrow('provider down');
    expect((await documentOf(document.id))?.status).toBe(DOCUMENT_STATUS.PROCESSING);

    embedder.failWith = undefined;
    await ingestion.ingest(document.id, { retryCount: 1, retryLimit: 2 });

    expect((await documentOf(document.id))?.status).toBe(DOCUMENT_STATUS.READY);
    expect(await chunksOf(document.id)).toHaveLength(1);
  });

  it.each([
    DOCUMENT_FAILURE.TOO_MANY_PAGES,
    DOCUMENT_FAILURE.UNREADABLE,
    DOCUMENT_FAILURE.TIMEOUT,
    DOCUMENT_FAILURE.NO_TEXT,
    DOCUMENT_FAILURE.TOO_LARGE,
  ] satisfies DocumentFailure[])(
    'marks the document failed with %s when the parser says so, without throwing',
    async (reason) => {
      await start();
      const document = await pendingDocument();
      parser.parsed = () => Promise.reject(new ParseError(reason));

      await expect(ingestion.ingest(document.id, FIRST_ATTEMPT)).resolves.toBeUndefined();

      expect(await documentOf(document.id)).toMatchObject({
        status: DOCUMENT_STATUS.FAILED,
        failure_reason: reason,
      });
      expect(await chunksOf(document.id)).toEqual([]);
      expect(embedder.batches).toHaveLength(0);
    }
  );

  it('marks a document failed as unreadable when its file is gone', async () => {
    await start();
    const document = await pendingDocument();
    await storage.remove(document.storageKey);

    await expect(ingestion.ingest(document.id, FIRST_ATTEMPT)).resolves.toBeUndefined();

    expect(await documentOf(document.id)).toMatchObject({
      status: DOCUMENT_STATUS.FAILED,
      failure_reason: DOCUMENT_FAILURE.UNREADABLE,
    });
  });

  describe('when the embedding model cannot be reached', () => {
    it.each([
      new Error('connection refused'),
      new ServiceUnavailableException('knowledge_unavailable'),
    ])('throws on the early tries and gives up on the last one (%s)', async (failure) => {
      await start();
      const document = await pendingDocument();
      embedder.failWith = failure;

      await expect(ingestion.ingest(document.id, FIRST_ATTEMPT)).rejects.toThrow();
      expect((await documentOf(document.id))?.status).toBe(DOCUMENT_STATUS.PROCESSING);
      await expect(ingestion.ingest(document.id, LAST_ATTEMPT)).resolves.toBeUndefined();

      expect(await documentOf(document.id)).toMatchObject({
        status: DOCUMENT_STATUS.FAILED,
        failure_reason: DOCUMENT_FAILURE.EMBEDDING_FAILED,
      });
      expect(await chunksOf(document.id)).toEqual([]);
    });

    it('can be tried again after it failed for good', async () => {
      await start();
      const document = await pendingDocument();
      embedder.failWith = new Error('down');
      await ingestion.ingest(document.id, LAST_ATTEMPT);
      await dataSource.query(
        `UPDATE document SET status = 'pending', failure_reason = NULL WHERE id = $1`,
        [document.id]
      );
      embedder.failWith = undefined;

      await ingestion.ingest(document.id, FIRST_ATTEMPT);

      expect((await documentOf(document.id))?.status).toBe(DOCUMENT_STATUS.READY);
    });
  });

  it('embeds in batches and keeps the order', async () => {
    await start({ RAG_CHUNK_CHARS: '100', RAG_CHUNK_OVERLAP_CHARS: '0' });
    const document = await pendingDocument();
    parser.parsed = () =>
      Promise.resolve({
        pages: [{ page: null, text: Array.from({ length: 1000 }, (_, i) => `wort${i}`).join(' ') }],
        pageCount: null,
      });

    await ingestion.ingest(document.id, FIRST_ATTEMPT);

    expect(embedder.batches.length).toBeGreaterThan(1);
    expect(Math.max(...embedder.batches.map((batch) => batch.length))).toBeLessThanOrEqual(64);
    expect((await chunksOf(document.id)).map((chunk) => chunk.content)).toEqual(embedder.texts);
  });

  it('ends quietly and leaves no chunks when the document is deleted while it is being read', async () => {
    await start();
    const document = await pendingDocument();
    embedder.beforeAnswer = async () => {
      await dataSource.query('DELETE FROM document WHERE id = $1', [document.id]);
    };

    await expect(ingestion.ingest(document.id, FIRST_ATTEMPT)).resolves.toBeUndefined();

    expect(await documentOf(document.id)).toBeUndefined();
    expect(await dataSource.query('SELECT 1 FROM chunk')).toHaveLength(0);
  });

  it('logs ids, counts and times, never the name or the text of a document', async () => {
    await start();
    const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
    const watched = new IngestionService(
      dataSource,
      storage,
      parser,
      embedder,
      queue,
      logger,
      app.get(ConfigService)
    );
    const ready = await pendingDocument();
    parser.parsed = () =>
      Promise.resolve({ pages: [{ page: null, text: SECRET_TEXT }], pageCount: null });
    const failed = await pendingDocument();

    await watched.ingest(ready.id, FIRST_ATTEMPT);
    parser.parsed = () => Promise.reject(new ParseError(DOCUMENT_FAILURE.UNREADABLE));
    await watched.ingest(failed.id, FIRST_ATTEMPT);
    embedder.failWith = new Error(`provider said: ${SECRET_TEXT}`);
    const third = await pendingDocument();
    parser.parsed = () =>
      Promise.resolve({ pages: [{ page: null, text: SECRET_TEXT }], pageCount: null });
    await watched.ingest(third.id, LAST_ATTEMPT);

    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).toContain(ready.id);
    expect(logged).toContain('durationMs');
    expect(logged).not.toContain(SECRET_NAME);
    expect(logged).not.toContain('Vertraulicher');
    expect(logged).not.toContain('provider said');
  });

  it('is registered for the ingestion job at start-up', async () => {
    await start();
    const document = await pendingDocument();
    await queue.send(RAG_JOB.INGEST_DOCUMENT, { documentId: document.id });

    await queue.run(RAG_JOB.INGEST_DOCUMENT);

    expect((await documentOf(document.id))?.status).toBe(DOCUMENT_STATUS.READY);
  });
});
