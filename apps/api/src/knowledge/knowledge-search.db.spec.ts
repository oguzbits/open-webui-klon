import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { type Login, signupUser } from '../testing/http-session.js';
import {
  insertChunk,
  insertCollection,
  insertDocument,
  linkDocument,
} from '../testing/knowledge-fixtures.js';
import { EmbeddingService } from './embedding.service.js';
import { KnowledgeSearchService } from './knowledge-search.service.js';
import { DOCUMENT_STATUS, type DocumentStatus } from './rag-dictionaries.js';

const MODEL = 'connection:embed';
const QUERY_VECTOR = [1, 0, 0, 0];

interface Seed {
  userId: string;
  content: string;
  embedding?: number[];
  status?: DocumentStatus;
  model?: string;
  /** The user the chunk row names; defaults to the owner of the document. */
  chunkUserId?: string;
  collections?: string[];
  filename?: string;
  page?: number | null;
}

describe('knowledge search (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let search: KnowledgeSearchService;
  let ann: Login;
  let ben: Login;
  const embedQuery = vi.fn();

  afterEach(async () => {
    await app?.close();
    embedQuery.mockReset();
  });

  async function start(env: Record<string, string> = {}): Promise<void> {
    embedQuery.mockResolvedValue({ modelId: MODEL, vector: QUERY_VECTOR });
    app = await createDbTestApp(
      testDatabaseUrl(),
      { EMBEDDING_MODEL_ID: MODEL, ...env },
      {
        configure: (builder) => builder.overrideProvider(EmbeddingService).useValue({ embedQuery }),
      }
    );
    dataSource = app.get(DataSource);
    search = app.get(KnowledgeSearchService);
    const http = request(app.getHttpServer());
    ann = await signupUser(http, { email: 'ann@example.com' });
    ben = await signupUser(http, { email: 'ben@example.com' });
  }

  /** One document with one chunk, ready by default, linked into the given collections. */
  async function seed(input: Seed): Promise<{ chunkId: string; documentId: string }> {
    const document = await insertDocument(dataSource, input.userId, {
      status: input.status ?? DOCUMENT_STATUS.READY,
      filename: input.filename ?? 'notiz.md',
    });
    const chunkId = await insertChunk(dataSource, {
      documentId: document.id,
      userId: input.chunkUserId ?? input.userId,
      content: input.content,
      embedding: input.embedding ?? [0, 1, 0, 0],
      embeddingModelId: input.model ?? MODEL,
      page: input.page ?? null,
    });
    for (const collectionId of input.collections ?? []) {
      await linkDocument(dataSource, collectionId, document.id);
    }
    return { chunkId, documentId: document.id };
  }

  const ids = (hits: { chunkId: string }[]): string[] => hits.map((hit) => hit.chunkId);

  describe('what a user can reach', () => {
    it('finds only the chunks of the user, even when somebody else has the same text', async () => {
      await start();
      const mine = await insertCollection(dataSource, ann.user.id);
      const theirs = await insertCollection(dataSource, ben.user.id);
      const own = await seed({
        userId: ann.user.id,
        content: 'gleicher Text',
        collections: [mine.id],
      });
      await seed({ userId: ben.user.id, content: 'gleicher Text', collections: [theirs.id] });

      const hits = await search.search(ann.user.id, [mine.id, theirs.id], 'gleicher Text');

      expect(ids(hits)).toEqual([own.chunkId]);
    });

    it('does not trust the document alone: a chunk row of another user stays out', async () => {
      await start();
      const mine = await insertCollection(dataSource, ann.user.id);
      await seed({
        userId: ann.user.id,
        chunkUserId: ben.user.id,
        content: 'Text mit falscher Chunk-Besitzerin',
        collections: [mine.id],
      });

      expect(await search.search(ann.user.id, [mine.id], 'Text')).toEqual([]);
    });

    it('does not trust the chunk alone: a document of another user stays out', async () => {
      await start();
      const mine = await insertCollection(dataSource, ann.user.id);
      await seed({
        userId: ben.user.id,
        chunkUserId: ann.user.id,
        content: 'Text mit fremdem Dokument',
        collections: [mine.id],
      });

      expect(await search.search(ann.user.id, [mine.id], 'Text')).toEqual([]);
    });

    it('searches only the collections it is given', async () => {
      await start();
      const asked = await insertCollection(dataSource, ann.user.id);
      const other = await insertCollection(dataSource, ann.user.id);
      const inAsked = await seed({
        userId: ann.user.id,
        content: 'Katze',
        collections: [asked.id],
      });
      await seed({ userId: ann.user.id, content: 'Katze', collections: [other.id] });
      await seed({ userId: ann.user.id, content: 'Katze', collections: [] });

      expect(ids(await search.search(ann.user.id, [asked.id], 'Katze'))).toEqual([inAsked.chunkId]);
    });

    it('finds nothing in the collection of somebody else, even if one of its own documents sits in it', async () => {
      await start();
      const theirs = await insertCollection(dataSource, ben.user.id);
      await seed({ userId: ann.user.id, content: 'Katze', collections: [theirs.id] });
      await seed({ userId: ben.user.id, content: 'Katze', collections: [theirs.id] });

      expect(await search.search(ann.user.id, [theirs.id], 'Katze')).toEqual([]);
      expect(await search.search(ann.user.id, [randomUUID()], 'Katze')).toEqual([]);
    });

    it.each([DOCUMENT_STATUS.PENDING, DOCUMENT_STATUS.PROCESSING, DOCUMENT_STATUS.FAILED])(
      'leaves out a document that is %s',
      async (status) => {
        await start();
        const mine = await insertCollection(dataSource, ann.user.id);
        const ready = await seed({ userId: ann.user.id, content: 'Pferd', collections: [mine.id] });
        await seed({ userId: ann.user.id, content: 'Pferd', status, collections: [mine.id] });

        expect(ids(await search.search(ann.user.id, [mine.id], 'Pferd'))).toEqual([ready.chunkId]);
      }
    );

    it('leaves out chunks of another embedding model, whatever their vector length', async () => {
      await start();
      const mine = await insertCollection(dataSource, ann.user.id);
      const current = await seed({
        userId: ann.user.id,
        content: 'Vogel',
        collections: [mine.id],
      });
      await seed({
        userId: ann.user.id,
        content: 'Vogel',
        model: 'connection:old-model',
        embedding: [1, 0, 0, 0, 0, 0, 0],
        collections: [mine.id],
      });

      expect(ids(await search.search(ann.user.id, [mine.id], 'Vogel'))).toEqual([current.chunkId]);
    });
  });

  describe('ranking', () => {
    it('finds what only the words find and what only the meaning finds, and puts a chunk both find first', async () => {
      await start({ RAG_CANDIDATES: '2', RAG_TOP_K: '10' });
      const mine = await insertCollection(dataSource, ann.user.id);
      const vectorOnly = await seed({
        userId: ann.user.id,
        content: 'Ein Haustier das bellt',
        embedding: [1, 0, 0, 0],
        collections: [mine.id],
      });
      const both = await seed({
        userId: ann.user.id,
        content: 'xylophon xylophon klingt hell',
        embedding: [0.8, 0.6, 0, 0],
        collections: [mine.id],
      });
      const wordsOnly = await seed({
        userId: ann.user.id,
        content: 'Das Xylophon steht im Keller',
        embedding: [0, 0, 1, 0],
        collections: [mine.id],
      });
      const unrelated = await seed({
        userId: ann.user.id,
        content: 'Etwas ganz anderes',
        embedding: [0, 1, 0, 0],
        collections: [mine.id],
      });

      const hits = await search.search(ann.user.id, [mine.id], 'xylophon');

      expect(hits[0]?.chunkId).toBe(both.chunkId);
      expect(new Set(ids(hits))).toEqual(
        new Set([both.chunkId, vectorOnly.chunkId, wordsOnly.chunkId])
      );
      expect(ids(hits)).not.toContain(unrelated.chunkId);
    });

    it('returns at most the configured number of hits, and a chunk in two chosen collections once', async () => {
      await start({ RAG_TOP_K: '2' });
      const first = await insertCollection(dataSource, ann.user.id);
      const second = await insertCollection(dataSource, ann.user.id);
      const shared = await seed({
        userId: ann.user.id,
        content: 'Fisch im Teich',
        embedding: [1, 0, 0, 0],
        collections: [first.id, second.id],
      });
      for (const index of [1, 2, 3]) {
        await seed({
          userId: ann.user.id,
          content: `Fisch Nummer ${index}`,
          embedding: [0.5, 0.5, 0, 0],
          collections: [first.id],
        });
      }

      const hits = await search.search(ann.user.id, [first.id, second.id], 'Fisch');

      expect(hits).toHaveLength(2);
      expect(ids(hits).filter((id) => id === shared.chunkId)).toHaveLength(1);
    });

    it('hands back what the context needs: ids, file name, page and text', async () => {
      await start();
      const mine = await insertCollection(dataSource, ann.user.id);
      const { chunkId, documentId } = await seed({
        userId: ann.user.id,
        content: 'Seite drei',
        filename: 'bericht.pdf',
        page: 3,
        collections: [mine.id],
      });

      expect(await search.search(ann.user.id, [mine.id], 'Seite')).toEqual([
        { chunkId, documentId, filename: 'bericht.pdf', page: 3, content: 'Seite drei' },
      ]);
    });
  });

  describe('input', () => {
    it('answers an empty list of collections or an empty question without asking the embedding model', async () => {
      await start();
      const mine = await insertCollection(dataSource, ann.user.id);
      await seed({ userId: ann.user.id, content: 'Text', collections: [mine.id] });

      expect(await search.search(ann.user.id, [], 'Text')).toEqual([]);
      expect(await search.search(ann.user.id, [mine.id], '')).toEqual([]);
      expect(await search.search(ann.user.id, [mine.id], '   \n')).toEqual([]);

      expect(embedQuery).not.toHaveBeenCalled();
    });

    it.each(["'; DROP TABLE chunk;--", '"a OR', '(((', 'a & | !', '\\', '%_'])(
      'treats %j as plain text: no error, nothing changed',
      async (question) => {
        await start();
        const mine = await insertCollection(dataSource, ann.user.id);
        await seed({ userId: ann.user.id, content: 'Text', collections: [mine.id] });

        await expect(search.search(ann.user.id, [mine.id], question)).resolves.toBeInstanceOf(
          Array
        );

        expect(await dataSource.query('SELECT 1 FROM chunk')).toHaveLength(1);
      }
    );

    it('cuts a very long question to two chunks before it is embedded, without splitting a character', async () => {
      await start({ RAG_CHUNK_CHARS: '100' });
      const mine = await insertCollection(dataSource, ann.user.id);
      const long = `${'a'.repeat(199)}😀${'b'.repeat(500)}`;

      await search.search(ann.user.id, [mine.id], long);

      expect(embedQuery).toHaveBeenCalledWith(`${'a'.repeat(199)}😀`, undefined);
    });

    it('asks the embedding model for the question and passes the signal on', async () => {
      await start();
      const mine = await insertCollection(dataSource, ann.user.id);
      const signal = new AbortController().signal;

      await search.search(ann.user.id, [mine.id], 'Frage', signal);

      expect(embedQuery).toHaveBeenCalledWith('Frage', signal);
    });
  });
});
