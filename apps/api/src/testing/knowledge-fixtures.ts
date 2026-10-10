import { createHash, randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { Collection } from '../knowledge/collection.entity.js';
import { Document } from '../knowledge/document.entity.js';
import { DOCUMENT_STATUS, DOCUMENT_TYPE } from '../knowledge/rag-dictionaries.js';

/** Collections, documents and chunks disappear with their user (cascade); this is for tests of these tables alone. */
export async function resetKnowledgeTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE collection, document CASCADE');
}

export function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function insertCollection(
  dataSource: DataSource,
  userId: string,
  overrides: Partial<Pick<Collection, 'name'>> = {}
): Promise<Collection> {
  const repository = dataSource.getRepository(Collection);
  return repository.save(
    repository.create({ userId, name: `Sammlung ${randomUUID()}`, ...overrides })
  );
}

export async function insertDocument(
  dataSource: DataSource,
  userId: string,
  overrides: Partial<Omit<Document, 'user'>> = {}
): Promise<Document> {
  const repository = dataSource.getRepository(Document);
  return repository.save(
    repository.create({
      userId,
      sha256: sha256Of(randomUUID()),
      filename: 'notes.md',
      type: DOCUMENT_TYPE.MARKDOWN,
      sizeBytes: 10,
      status: DOCUMENT_STATUS.READY,
      failureReason: null,
      storageKey: randomUUID(),
      pageCount: null,
      ...overrides,
    })
  );
}

export async function linkDocument(
  dataSource: DataSource,
  collectionId: string,
  documentId: string
): Promise<void> {
  await dataSource.query(
    'INSERT INTO collection_document (collection_id, document_id) VALUES ($1, $2)',
    [collectionId, documentId]
  );
}

export interface ChunkInput {
  documentId: string;
  userId: string;
  ordinal?: number;
  content: string;
  page?: number | null;
  /** Written as `halfvec`; the length is free per row. */
  embedding: number[];
  embeddingModelId?: string;
}

/** Raw SQL like the ingestion: the vector is a parameter cast to halfvec. */
export async function insertChunk(dataSource: DataSource, input: ChunkInput): Promise<string> {
  const rows: { id: string }[] = await dataSource.query(
    `INSERT INTO chunk (document_id, user_id, ordinal, content, page, embedding, embedding_model_id)
     VALUES ($1, $2, $3, $4, $5, $6::halfvec, $7) RETURNING id`,
    [
      input.documentId,
      input.userId,
      input.ordinal ?? 0,
      input.content,
      input.page ?? null,
      `[${input.embedding.join(',')}]`,
      input.embeddingModelId ?? 'connection:embed',
    ]
  );
  const row = rows[0];
  if (row === undefined) throw new Error('insertChunk returned no row');
  return row.id;
}
