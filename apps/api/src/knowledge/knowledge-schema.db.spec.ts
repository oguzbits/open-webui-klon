import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { resetAuthTables, insertUser } from '../testing/db-fixtures.js';
import {
  insertChunk,
  insertCollection,
  insertDocument,
  linkDocument,
  resetKnowledgeTables,
  sha256Of,
} from '../testing/knowledge-fixtures.js';
import { DOCUMENT_STATUS } from './rag-dictionaries.js';

describe('knowledge schema (database)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
  });
  afterAll(async () => {
    await dataSource.destroy();
  });
  beforeEach(async () => {
    await resetAuthTables(dataSource);
    await resetKnowledgeTables(dataSource);
  });

  it('matches the entities: the migrations leave nothing for migration:generate to add', async () => {
    const queries = await dataSource.driver.createSchemaBuilder().log();

    expect(queries.upQueries.map((query) => query.query)).toEqual([]);
  });

  it('keeps one document per user and content, but lets another user store the same content', async () => {
    const alice = await insertUser(dataSource);
    const bob = await insertUser(dataSource);
    const sha256 = sha256Of('same bytes');
    await insertDocument(dataSource, alice.id, { sha256 });

    await expect(insertDocument(dataSource, alice.id, { sha256 })).rejects.toThrow(
      /document_user_sha256_idx/
    );
    await expect(insertDocument(dataSource, bob.id, { sha256 })).resolves.toBeDefined();
  });

  it('rejects a status or failure reason outside the dictionaries and a malformed hash', async () => {
    const user = await insertUser(dataSource);
    const document = await insertDocument(dataSource, user.id);

    await expect(
      dataSource.query(`UPDATE document SET status = 'robot' WHERE id = $1`, [document.id])
    ).rejects.toThrow(/document_status_check/);
    await expect(
      dataSource.query(`UPDATE document SET failure_reason = 'oops' WHERE id = $1`, [document.id])
    ).rejects.toThrow(/document_failure_check/);
    await expect(insertDocument(dataSource, user.id, { sha256: 'abc' })).rejects.toThrow(
      /document_sha256_check/
    );
  });

  it('keeps a collection name once per user', async () => {
    const alice = await insertUser(dataSource);
    const bob = await insertUser(dataSource);
    await insertCollection(dataSource, alice.id, { name: 'Handbuch' });

    await expect(insertCollection(dataSource, alice.id, { name: 'Handbuch' })).rejects.toThrow(
      /collection_user_name_idx/
    );
    await expect(insertCollection(dataSource, bob.id, { name: 'Handbuch' })).resolves.toBeDefined();
  });

  it('removes documents, collections and chunks with their user', async () => {
    const user = await insertUser(dataSource);
    const collection = await insertCollection(dataSource, user.id);
    const document = await insertDocument(dataSource, user.id);
    await linkDocument(dataSource, collection.id, document.id);
    await insertChunk(dataSource, {
      documentId: document.id,
      userId: user.id,
      content: 'Text',
      embedding: [1, 0, 0],
    });

    await dataSource.query('DELETE FROM app_user WHERE id = $1', [user.id]);

    for (const table of ['document', 'collection', 'collection_document', 'chunk']) {
      expect(await dataSource.query(`SELECT 1 FROM ${table}`)).toHaveLength(0);
    }
  });

  it('removes chunks and links with their document, and links only with their collection', async () => {
    const user = await insertUser(dataSource);
    const collection = await insertCollection(dataSource, user.id);
    const document = await insertDocument(dataSource, user.id);
    const other = await insertDocument(dataSource, user.id);
    await linkDocument(dataSource, collection.id, document.id);
    await linkDocument(dataSource, collection.id, other.id);
    await insertChunk(dataSource, {
      documentId: document.id,
      userId: user.id,
      content: 'Text',
      embedding: [1, 0, 0],
    });

    await dataSource.query('DELETE FROM document WHERE id = $1', [document.id]);
    expect(await dataSource.query('SELECT 1 FROM chunk')).toHaveLength(0);
    expect(await dataSource.query('SELECT 1 FROM collection_document')).toHaveLength(1);

    await dataSource.query('DELETE FROM collection WHERE id = $1', [collection.id]);
    expect(await dataSource.query('SELECT 1 FROM collection_document')).toHaveLength(0);
    expect(await dataSource.query('SELECT 1 FROM document WHERE id = $1', [other.id])).toHaveLength(
      1
    );
  });

  it('stores vectors of different lengths per row and can search the content as text', async () => {
    const user = await insertUser(dataSource);
    const document = await insertDocument(dataSource, user.id, {
      status: DOCUMENT_STATUS.PROCESSING,
    });
    await insertChunk(dataSource, {
      documentId: document.id,
      userId: user.id,
      ordinal: 0,
      content: 'Der Hund bellt laut',
      embedding: [1, 0, 0],
    });
    await insertChunk(dataSource, {
      documentId: document.id,
      userId: user.id,
      ordinal: 1,
      content: 'Die Katze schläft',
      embedding: [1, 0, 0, 0, 0],
    });

    const hits: { content: string }[] = await dataSource.query(
      `SELECT content FROM chunk WHERE to_tsvector('simple', content) @@ websearch_to_tsquery('simple', 'bellt')`
    );
    const dims: { dims: number }[] = await dataSource.query(
      'SELECT vector_dims(embedding) AS dims FROM chunk ORDER BY ordinal'
    );

    expect(hits).toEqual([{ content: 'Der Hund bellt laut' }]);
    expect(dims.map((row) => row.dims)).toEqual([3, 5]);
  });

  it('keeps one chunk per document and position', async () => {
    const user = await insertUser(dataSource);
    const document = await insertDocument(dataSource, user.id);
    const input = { documentId: document.id, userId: user.id, content: 'a', embedding: [1] };
    await insertChunk(dataSource, input);

    await expect(insertChunk(dataSource, input)).rejects.toThrow(/chunk_document_ordinal_idx/);
  });
});
