import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import {
  authed,
  type Http,
  type Login,
  loginUser,
  signupUser,
  TEST_PASSWORD,
} from '../testing/http-session.js';
import { insertCollection, insertDocument, linkDocument } from '../testing/knowledge-fixtures.js';
import { USER_ROLE } from '../users/user-role.js';
import { CollectionsService } from './collections.service.js';
import type { CollectionDto, CollectionListDto, DocumentListDto } from './knowledge.dto.js';

describe('collections (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let ann: Login;
  let ben: Login;

  afterEach(async () => {
    await app.close();
  });

  async function start(): Promise<void> {
    app = await createDbTestApp(testDatabaseUrl());
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    ann = await signupUser(http, { email: 'ann@example.com' });
    const pending = await signupUser(http, { email: 'ben@example.com' });
    await authed(http, ann)
      .patch(`/api/users/${pending.user.id}`)
      .send({ role: USER_ROLE.USER })
      .expect(200);
    ben = await loginUser(http, 'ben@example.com', TEST_PASSWORD);
  }

  async function create(login: Login, name: string): Promise<CollectionDto> {
    const response = await authed(http, login).post('/api/collections').send({ name }).expect(201);
    return response.body as CollectionDto;
  }

  describe('without a session', () => {
    it('answers 401 on every endpoint', async () => {
      await start();
      const id = randomUUID();
      const calls = [
        http.get('/api/collections'),
        http.post('/api/collections').send({ name: 'x' }),
        http.get(`/api/collections/${id}`),
        http.patch(`/api/collections/${id}`).send({ name: 'x' }),
        http.delete(`/api/collections/${id}`),
        http.get(`/api/collections/${id}/documents`),
        http.put(`/api/collections/${id}/documents/${id}`),
        http.delete(`/api/collections/${id}/documents/${id}`),
      ];

      const statuses = await Promise.all(calls.map(async (call) => (await call).status));

      expect(statuses).toEqual(calls.map(() => 401));
    });
  });

  describe('create, read, rename, delete', () => {
    it('keeps the collections of a user in a list with the number of documents', async () => {
      await start();
      const books = await create(ann, '  Bücher  ');
      await create(ann, 'Arbeit');
      const document = await insertDocument(dataSource, ann.user.id);
      await linkDocument(dataSource, books.id, document.id);

      const list = (await authed(http, ann).get('/api/collections').expect(200))
        .body as CollectionListDto;

      expect(list.items.map((item) => [item.name, item.documentCount])).toEqual([
        ['Arbeit', 0],
        ['Bücher', 1],
      ]);
      expect(
        (await authed(http, ann).get(`/api/collections/${books.id}`).expect(200)).body
      ).toMatchObject({
        id: books.id,
        name: 'Bücher',
        documentCount: 1,
      });
    });

    it('renames and deletes; deleting keeps the documents', async () => {
      await start();
      const collection = await create(ann, 'Alt');
      const document = await insertDocument(dataSource, ann.user.id);
      await linkDocument(dataSource, collection.id, document.id);

      const renamed = await authed(http, ann)
        .patch(`/api/collections/${collection.id}`)
        .send({ name: 'Neu' })
        .expect(200);
      await authed(http, ann).delete(`/api/collections/${collection.id}`).expect(204);

      expect(renamed.body).toMatchObject({ name: 'Neu', documentCount: 1 });
      await authed(http, ann).get(`/api/collections/${collection.id}`).expect(404);
      expect(
        await dataSource.query('SELECT id FROM document WHERE id = $1', [document.id])
      ).toHaveLength(1);
      expect(await dataSource.query('SELECT 1 FROM collection_document')).toHaveLength(0);
    });

    it('refuses a name twice, per user, and a name that is empty or has unknown company', async () => {
      await start();
      const first = await create(ann, 'Recht');
      const other = await create(ann, 'Steuer');

      await authed(http, ann).post('/api/collections').send({ name: 'Recht' }).expect(409);
      await authed(http, ann)
        .patch(`/api/collections/${other.id}`)
        .send({ name: 'Recht' })
        .expect(409);
      await create(ben, 'Recht');
      await authed(http, ann).post('/api/collections').send({ name: '   ' }).expect(400);
      await authed(http, ann)
        .post('/api/collections')
        .send({ name: 'x'.repeat(101) })
        .expect(400);
      await authed(http, ann)
        .post('/api/collections')
        .send({ name: 'ok', userId: ben.user.id })
        .expect(400);
      await authed(http, ann).patch(`/api/collections/${first.id}`).send({ name: '' }).expect(400);
      expect(
        await dataSource.query('SELECT 1 FROM collection WHERE user_id = $1', [ann.user.id])
      ).toHaveLength(2);
    });
  });

  describe("somebody else's collection", () => {
    it('is a 404 on every endpoint and stays as it was', async () => {
      await start();
      const mine = await create(ann, 'Privat');
      const document = await insertDocument(dataSource, ann.user.id);
      await linkDocument(dataSource, mine.id, document.id);
      const benDocument = await insertDocument(dataSource, ben.user.id);
      const base = `/api/collections/${mine.id}`;

      await authed(http, ben).get(base).expect(404);
      await authed(http, ben).patch(base).send({ name: 'Gehackt' }).expect(404);
      await authed(http, ben).get(`${base}/documents`).expect(404);
      await authed(http, ben).put(`${base}/documents/${benDocument.id}`).expect(404);
      await authed(http, ben).put(`${base}/documents/${document.id}`).expect(404);
      await authed(http, ben).delete(`${base}/documents/${document.id}`).expect(404);
      await authed(http, ben).delete(base).expect(404);

      expect(
        await dataSource.query('SELECT name FROM collection WHERE id = $1', [mine.id])
      ).toEqual([{ name: 'Privat' }]);
      expect(await dataSource.query('SELECT document_id FROM collection_document')).toEqual([
        { document_id: document.id },
      ]);
      expect((await authed(http, ben).get('/api/collections').expect(200)).body).toEqual({
        items: [],
      });
    });

    it('cannot get a document of its own into it, nor a foreign document into an own collection', async () => {
      await start();
      const annCollection = await create(ann, 'A');
      const benCollection = await create(ben, 'B');
      const annDocument = await insertDocument(dataSource, ann.user.id);
      const benDocument = await insertDocument(dataSource, ben.user.id);

      await authed(http, ben)
        .put(`/api/collections/${annCollection.id}/documents/${benDocument.id}`)
        .expect(404);
      await authed(http, ben)
        .put(`/api/collections/${benCollection.id}/documents/${annDocument.id}`)
        .expect(404);
      await authed(http, ann)
        .put(`/api/collections/${benCollection.id}/documents/${annDocument.id}`)
        .expect(404);

      expect(await dataSource.query('SELECT 1 FROM collection_document')).toHaveLength(0);
    });
  });

  describe('documents in a collection', () => {
    it('adds a document once however often, lists it, and removes only the link', async () => {
      await start();
      const collection = await create(ann, 'Sammlung');
      const document = await insertDocument(dataSource, ann.user.id, { filename: 'a.md' });
      const url = `/api/collections/${collection.id}/documents/${document.id}`;

      await authed(http, ann).put(url).expect(204);
      await authed(http, ann).put(url).expect(204);
      const listed = (
        await authed(http, ann).get(`/api/collections/${collection.id}/documents`).expect(200)
      ).body as DocumentListDto;
      await authed(http, ann).delete(url).expect(204);
      await authed(http, ann).delete(url).expect(404);

      expect(listed.items.map((item) => item.filename)).toEqual(['a.md']);
      expect(Object.keys(listed.items[0] ?? {}).sort()).toEqual(
        [
          'createdAt',
          'failureReason',
          'filename',
          'id',
          'pageCount',
          'sizeBytes',
          'status',
          'type',
        ].sort()
      );
      expect(
        await dataSource.query('SELECT id FROM document WHERE id = $1', [document.id])
      ).toHaveLength(1);
      expect(await dataSource.query('SELECT 1 FROM collection_document')).toHaveLength(0);
    });

    it('answers 404 for a document that does not exist', async () => {
      await start();
      const collection = await create(ann, 'Sammlung');

      await authed(http, ann)
        .put(`/api/collections/${collection.id}/documents/${randomUUID()}`)
        .expect(404);
    });
  });

  describe('ownedIds', () => {
    it('keeps only the collections of the user', async () => {
      await start();
      const mine = await insertCollection(dataSource, ann.user.id);
      const theirs = await insertCollection(dataSource, ben.user.id);
      const service = app.get(CollectionsService);

      expect(await service.ownedIds(ann.user.id, [mine.id, theirs.id, randomUUID()])).toEqual([
        mine.id,
      ]);
      expect(await service.ownedIds(ann.user.id, [])).toEqual([]);
    });
  });
});
