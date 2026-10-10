import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { RAG_JOB } from '../jobs/job-names.js';
import { JOB_QUEUE } from '../jobs/job-queue.js';
import { buildPdf } from '../testing/pdf-builder.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { FakeJobQueue } from '../testing/fake-job-queue.js';
import {
  authed,
  type Http,
  type Login,
  loginUser,
  signupUser,
  TEST_PASSWORD,
} from '../testing/http-session.js';
import {
  insertChunk,
  insertCollection,
  insertDocument,
  linkDocument,
} from '../testing/knowledge-fixtures.js';
import { USER_ROLE } from '../users/user-role.js';
import { quotaLockKey } from './documents.service.js';
import type { DocumentDto, DocumentListDto } from './knowledge.dto.js';
import {
  DOCUMENT_FAILURE,
  DOCUMENT_STATUS,
  DOCUMENT_TYPE,
  KNOWLEDGE_UNAVAILABLE,
  type DocumentType,
} from './rag-dictionaries.js';

const DOCX = readFileSync(new URL('./fixtures/hello.docx', import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('documents (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let queue: FakeJobQueue;
  let ann: Login;
  let ben: Login;
  let storageDir: string;

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'owui-docs-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    await rm(storageDir, { recursive: true, force: true });
  });

  async function start(env: Record<string, string> = {}): Promise<void> {
    app = await createDbTestApp(testDatabaseUrl(), {
      FILE_STORAGE_PATH: storageDir,
      EMBEDDING_MODEL_ID: 'connection:embed',
      ...env,
    });
    dataSource = app.get(DataSource);
    queue = app.get<FakeJobQueue>(JOB_QUEUE);
    http = request(app.getHttpServer());
    ann = await signupUser(http, { email: 'ann@example.com' });
    const pending = await signupUser(http, { email: 'ben@example.com' });
    await authed(http, ann)
      .patch(`/api/users/${pending.user.id}`)
      .send({ role: USER_ROLE.USER })
      .expect(200);
    ben = await loginUser(http, 'ben@example.com', TEST_PASSWORD);
  }

  function upload(
    login: Login,
    content: Uint8Array | string,
    filename: string,
    collectionId?: string
  ) {
    const call = authed(http, login)
      .post('/api/documents')
      .attach('file', Buffer.from(content), { filename });
    return collectionId === undefined ? call : call.field('collectionId', collectionId);
  }

  const files = (): Promise<string[]> => readdir(storageDir);
  const rows = (): Promise<
    { id: string; filename: string; status: string; storage_key: string }[]
  > =>
    dataSource.query('SELECT id, filename, status, storage_key FROM document ORDER BY created_at');

  describe('without a session', () => {
    it('answers 401 on every endpoint', async () => {
      await start();
      const id = randomUUID();
      const calls = [
        http.get('/api/documents'),
        http.post('/api/documents').attach('file', Buffer.from('x'), { filename: 'a.txt' }),
        http.post(`/api/documents/${id}/retry`),
        http.delete(`/api/documents/${id}`),
      ];

      const statuses = await Promise.all(calls.map(async (call) => (await call).status));

      expect(statuses).toEqual(calls.map(() => 401));
    });
  });

  describe('upload', () => {
    const accepted: [string, DocumentType, () => Uint8Array | string, string][] = [
      ['PDF', DOCUMENT_TYPE.PDF, () => buildPdf(['Hallo Welt']), 'bericht.pdf'],
      ['DOCX', DOCUMENT_TYPE.DOCX, () => DOCX, 'brief.docx'],
      ['Markdown', DOCUMENT_TYPE.MARKDOWN, () => '# Titel\n\nText', 'notiz.md'],
      ['text', DOCUMENT_TYPE.TEXT, () => 'nur Text', 'liste.txt'],
    ];
    it.each(accepted)(
      'takes a %s: 201, pending, one job with the id only, the file under a UUID',
      async (_label, type, content, filename) => {
        await start();

        const response = await upload(ann, content(), filename).expect(201);

        const document = response.body as DocumentDto;
        expect(document).toMatchObject({
          filename,
          type,
          status: DOCUMENT_STATUS.PENDING,
          failureReason: null,
          pageCount: null,
        });
        expect(queue.sent).toEqual([
          { name: RAG_JOB.INGEST_DOCUMENT, data: { documentId: document.id } },
        ]);
        const [row] = await rows();
        expect(row?.id).toBe(document.id);
        expect(await files()).toEqual([row?.storage_key]);
        expect(row?.storage_key).toMatch(UUID);
        expect(Object.keys(document)).not.toContain('storageKey');
      }
    );

    it('answers a second upload of the same content with 200 and the same document, no second job', async () => {
      await start();
      const first = (await upload(ann, 'gleich', 'a.txt').expect(201)).body as DocumentDto;
      const collection = await insertCollection(dataSource, ann.user.id);

      const second = await upload(ann, 'gleich', 'b.txt', collection.id).expect(200);

      expect(second.body).toMatchObject({ id: first.id, filename: 'a.txt' });
      expect(queue.sent).toHaveLength(1);
      expect(await rows()).toHaveLength(1);
      expect(await files()).toHaveLength(1);
      expect(
        await dataSource.query('SELECT collection_id, document_id FROM collection_document')
      ).toEqual([{ collection_id: collection.id, document_id: first.id }]);
    });

    it('puts a new document into the collection it was uploaded for', async () => {
      await start();
      const collection = await insertCollection(dataSource, ann.user.id);

      const response = await upload(ann, 'neu', 'a.txt', collection.id).expect(201);

      expect(await dataSource.query('SELECT document_id FROM collection_document')).toEqual([
        { document_id: (response.body as DocumentDto).id },
      ]);
    });

    it('refuses a collection of somebody else before writing anything', async () => {
      await start();
      const foreign = await insertCollection(dataSource, ben.user.id);

      await upload(ann, 'neu', 'a.txt', foreign.id).expect(404);

      expect(await rows()).toHaveLength(0);
      expect(await files()).toEqual([]);
      expect(queue.sent).toEqual([]);
    });

    it('makes one document of two simultaneous uploads of the same content', async () => {
      await start();

      const [one, two] = await Promise.all([
        upload(ann, 'zugleich', 'a.txt'),
        upload(ann, 'zugleich', 'a.txt'),
      ]);

      expect([one.status, two.status].sort()).toEqual([200, 201]);
      expect(one.body).toMatchObject({ id: (two.body as DocumentDto).id });
      expect(await rows()).toHaveLength(1);
      expect(queue.sent).toHaveLength(1);
      expect(await files()).toHaveLength(1);
    });

    it('gives the same content of another user a document and a job of its own', async () => {
      await start();
      const first = (await upload(ann, 'gleich', 'a.txt').expect(201)).body as DocumentDto;

      const second = (await upload(ben, 'gleich', 'a.txt').expect(201)).body as DocumentDto;

      expect(second.id).not.toBe(first.id);
      expect(queue.sent).toHaveLength(2);
      expect(await files()).toHaveLength(2);
    });

    it('refuses a file over the limit with 413 and keeps nothing', async () => {
      await start({ RAG_UPLOAD_MAX_BYTES: '100' });

      await upload(ann, 'x'.repeat(101), 'gross.txt').expect(413);
      await upload(ann, 'x'.repeat(100), 'passt.txt').expect(201);

      expect(await rows()).toHaveLength(1);
      expect(queue.sent).toHaveLength(1);
    });

    it.each([
      ['an EXE named .pdf', Buffer.from('MZ\u0090\u0000\u0003'), 'virus.pdf'],
      ['a file without content', Buffer.alloc(0), 'leer.txt'],
      ['an unknown extension', Buffer.from('text'), 'daten.csv'],
      ['binary bytes named .txt', Buffer.from([0xff, 0xfe, 0x00, 0x01]), 'bild.txt'],
    ])('refuses %s with 415 and keeps nothing', async (_label, content, filename) => {
      await start();

      await upload(ann, content, filename).expect(415);

      expect(await rows()).toHaveLength(0);
      expect(await files()).toEqual([]);
      expect(queue.sent).toEqual([]);
    });

    it('answers 422 when the form has no file and 400 for a field it does not know', async () => {
      await start();

      await authed(http, ann)
        .post('/api/documents')
        .field('collectionId', randomUUID())
        .expect(422);
      await upload(ann, 'x', 'a.txt').field('admin', 'true').expect(400);
      await upload(ann, 'x', 'a.txt', 'not-a-uuid').expect(400);

      expect(await rows()).toHaveLength(0);
    });

    it('keeps only the base name, stores it cleaned, and names the file by UUID', async () => {
      await start();

      const response = await upload(ann, 'inhalt', '../../etc/passwd.txt').expect(201);

      expect(response.body).toMatchObject({ filename: 'passwd.txt' });
      const [row] = await rows();
      expect(await files()).toEqual([row?.storage_key]);
      expect(row?.storage_key).toMatch(UUID);
    });

    it('cleans the name it stores', async () => {
      await start();

      const response = await upload(ann, 'inhalt', '  spaced name.txt  ').expect(201);

      expect(response.body).toMatchObject({ filename: 'spaced name.txt' });
    });

    it('refuses a name with a control character before anything is stored', async () => {
      await start();

      await upload(ann, 'inhalt', 'bad\u0007name.txt').expect(400);

      expect(await rows()).toHaveLength(0);
    });

    it('stores a name with umlauts as it was sent', async () => {
      await start();

      const response = await upload(ann, 'inhalt', 'Übersicht für Müller.txt').expect(201);

      expect(response.body).toMatchObject({ filename: 'Übersicht für Müller.txt' });
    });

    it('answers 409 when the limit is reached, but still finds a document that is already there', async () => {
      await start({ RAG_MAX_DOCUMENTS_PER_USER: '2' });
      await upload(ann, 'eins', 'a.txt').expect(201);
      await upload(ann, 'zwei', 'b.txt').expect(201);

      await upload(ann, 'drei', 'c.txt').expect(409);
      await upload(ann, 'eins', 'a2.txt').expect(200);
      await upload(ben, 'drei', 'c.txt').expect(201);

      expect(await rows()).toHaveLength(3);
      expect(queue.sent).toHaveLength(3);
    });

    it('keeps to the limit when many different files arrive at once', async () => {
      await start({ RAG_MAX_DOCUMENTS_PER_USER: '2' });

      const answers = await Promise.all(
        Array.from({ length: 15 }, (_, index) => upload(ann, `inhalt ${index}`, `d${index}.txt`))
      );

      expect(answers.filter((answer) => answer.status === 201)).toHaveLength(2);
      expect(answers.filter((answer) => answer.status === 409)).toHaveLength(13);
      expect(await rows()).toHaveLength(2);
      expect(queue.sent).toHaveLength(2);
    });

    it('waits for the quota lock of the user, so counting and inserting cannot interleave', async () => {
      await start({ RAG_MAX_DOCUMENTS_PER_USER: '1' });
      const holder = dataSource.createQueryRunner();
      await holder.connect();
      await holder.startTransaction();
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [quotaLockKey(ann.user.id)]);
      let answered = false;
      const waiting = upload(ann, 'inhalt', 'a.txt').then((answer) => {
        answered = true;
        return answer;
      });

      await new Promise((resolve) => setTimeout(resolve, 400));
      const answeredWhileLocked = answered;
      await holder.commitTransaction();
      await holder.release();
      const answer = await waiting;

      expect(answeredWhileLocked).toBe(false);
      expect(answer.status).toBe(201);
    });

    it('does not hand out the document of another user when its own limit is reached', async () => {
      await start({ RAG_MAX_DOCUMENTS_PER_USER: '1' });
      await upload(ann, 'meins', 'a.txt').expect(201);
      const theirs = (await upload(ben, 'seins', 'b.txt').expect(201)).body as DocumentDto;

      const refused = await upload(ann, 'seins', 'b.txt').expect(409);

      expect(JSON.stringify(refused.body)).not.toContain(theirs.id);
    });

    it('leaves no row and no file behind when the job cannot be sent, and answers 500', async () => {
      await start();
      vi.spyOn(queue, 'send').mockRejectedValue(new Error('queue down'));

      await upload(ann, 'inhalt', 'a.txt').expect(500);

      expect(await rows()).toHaveLength(0);
      expect(await files()).toEqual([]);
    });
  });

  describe('without an embedding model', () => {
    it('refuses upload and retry with 503, and still lists and deletes', async () => {
      await start({ EMBEDDING_MODEL_ID: '' });
      const failed = await insertDocument(dataSource, ann.user.id, {
        status: DOCUMENT_STATUS.FAILED,
        failureReason: DOCUMENT_FAILURE.UNREADABLE,
      });
      const other = await insertDocument(dataSource, ann.user.id);

      const refused = await upload(ann, 'inhalt', 'a.txt').expect(503);
      await authed(http, ann).post(`/api/documents/${failed.id}/retry`).expect(503);
      const list = (await authed(http, ann).get('/api/documents').expect(200))
        .body as DocumentListDto;
      await authed(http, ann).delete(`/api/documents/${other.id}`).expect(204);

      expect(JSON.stringify(refused.body)).toContain(KNOWLEDGE_UNAVAILABLE);
      expect(list.items).toHaveLength(2);
      expect(queue.sent).toEqual([]);
      expect(await files()).toEqual([]);
      expect(await rows()).toHaveLength(1);
      expect((await rows())[0]?.status).toBe(DOCUMENT_STATUS.FAILED);
    });
  });

  describe('list', () => {
    it('shows the documents of the user only, newest first', async () => {
      await start();
      await insertDocument(dataSource, ann.user.id, { filename: 'alt.md' });
      await insertDocument(dataSource, ben.user.id, { filename: 'fremd.md' });
      await insertDocument(dataSource, ann.user.id, { filename: 'neu.md' });

      const list = (await authed(http, ann).get('/api/documents').expect(200))
        .body as DocumentListDto;

      expect(list.items.map((item) => item.filename)).toEqual(['neu.md', 'alt.md']);
    });
  });

  describe('retry', () => {
    it('sends a new job for a failed document and makes it pending again', async () => {
      await start();
      const failed = await insertDocument(dataSource, ann.user.id, {
        status: DOCUMENT_STATUS.FAILED,
        failureReason: DOCUMENT_FAILURE.TIMEOUT,
      });

      const response = await authed(http, ann)
        .post(`/api/documents/${failed.id}/retry`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: failed.id,
        status: DOCUMENT_STATUS.PENDING,
        failureReason: null,
      });
      expect(queue.sent).toEqual([
        { name: RAG_JOB.INGEST_DOCUMENT, data: { documentId: failed.id } },
      ]);
    });

    it.each([DOCUMENT_STATUS.READY, DOCUMENT_STATUS.PENDING, DOCUMENT_STATUS.PROCESSING])(
      'answers 409 for a document that is %s and sends nothing',
      async (status) => {
        await start();
        const document = await insertDocument(dataSource, ann.user.id, { status });

        await authed(http, ann).post(`/api/documents/${document.id}/retry`).expect(409);

        expect(queue.sent).toEqual([]);
        expect((await rows())[0]?.status).toBe(status);
      }
    );

    it('puts the failure back when the job cannot be sent', async () => {
      await start();
      const failed = await insertDocument(dataSource, ann.user.id, {
        status: DOCUMENT_STATUS.FAILED,
        failureReason: DOCUMENT_FAILURE.NO_TEXT,
      });
      vi.spyOn(queue, 'send').mockRejectedValue(new Error('queue down'));

      await authed(http, ann).post(`/api/documents/${failed.id}/retry`).expect(500);

      const [row] = await dataSource.query<{ status: string; failure_reason: string }[]>(
        'SELECT status, failure_reason FROM document WHERE id = $1',
        [failed.id]
      );
      expect(row).toEqual({
        status: DOCUMENT_STATUS.FAILED,
        failure_reason: DOCUMENT_FAILURE.NO_TEXT,
      });
    });
  });

  describe('delete', () => {
    it('removes the document with its chunks and its file, and keeps the other documents', async () => {
      await start();
      const kept = (await upload(ann, 'bleibt', 'b.txt').expect(201)).body as DocumentDto;
      const gone = (await upload(ann, 'geht', 'a.txt').expect(201)).body as DocumentDto;
      await insertChunk(dataSource, {
        documentId: gone.id,
        userId: ann.user.id,
        content: 'Teil',
        embedding: [1, 0],
      });

      await authed(http, ann).delete(`/api/documents/${gone.id}`).expect(204);

      expect(await dataSource.query('SELECT 1 FROM chunk')).toHaveLength(0);
      expect((await rows()).map((row) => row.id)).toEqual([kept.id]);
      expect(await files()).toEqual([(await rows())[0]?.storage_key]);
    });

    it('still deletes when the file is already gone', async () => {
      await start();
      const document = await insertDocument(dataSource, ann.user.id);

      await authed(http, ann).delete(`/api/documents/${document.id}`).expect(204);

      expect(await rows()).toHaveLength(0);
    });
  });

  describe("somebody else's document", () => {
    it('is a 404 on delete and retry and stays as it was', async () => {
      await start();
      const mine = await insertDocument(dataSource, ann.user.id, {
        status: DOCUMENT_STATUS.FAILED,
        failureReason: DOCUMENT_FAILURE.UNREADABLE,
      });
      const collection = await insertCollection(dataSource, ann.user.id);
      await linkDocument(dataSource, collection.id, mine.id);

      await authed(http, ben).post(`/api/documents/${mine.id}/retry`).expect(404);
      await authed(http, ben).delete(`/api/documents/${mine.id}`).expect(404);
      await authed(http, ben).delete(`/api/documents/${randomUUID()}`).expect(404);

      expect(await rows()).toEqual([
        expect.objectContaining({ id: mine.id, status: DOCUMENT_STATUS.FAILED }),
      ]);
      expect(queue.sent).toEqual([]);
      expect(await dataSource.query('SELECT 1 FROM collection_document')).toHaveLength(1);
    });
  });
});
