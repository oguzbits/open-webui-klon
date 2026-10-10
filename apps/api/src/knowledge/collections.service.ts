import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';

import { documentColumns, toDocumentDto, type DocumentRow } from './document-rows.js';
import type { CollectionDto, DocumentDto } from './knowledge.dto.js';

const UNIQUE_VIOLATION = '23505';

interface CollectionRow {
  id: string;
  name: string;
  document_count: number;
  created_at: Date;
}

function toDto(row: CollectionRow): CollectionDto {
  return {
    id: row.id,
    name: row.name,
    documentCount: row.document_count,
    createdAt: row.created_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError: unknown = error.driverError;
  return (
    typeof driverError === 'object' &&
    driverError !== null &&
    'code' in driverError &&
    driverError.code === UNIQUE_VIOLATION
  );
}

/** Collections of one user. Every statement carries the `user_id` of the session; a foreign id is a 404. */
@Injectable()
export class CollectionsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(userId: string): Promise<CollectionDto[]> {
    const rows: CollectionRow[] = await this.dataSource.query(
      `SELECT c.id, c.name, c.created_at, count(cd.document_id)::int AS document_count
         FROM collection c
         LEFT JOIN collection_document cd ON cd.collection_id = c.id
        WHERE c.user_id = $1
        GROUP BY c.id
        ORDER BY lower(c.name), c.id`,
      [userId]
    );
    return rows.map(toDto);
  }

  async get(userId: string, id: string): Promise<CollectionDto> {
    const rows: CollectionRow[] = await this.dataSource.query(
      `SELECT c.id, c.name, c.created_at, count(cd.document_id)::int AS document_count
         FROM collection c
         LEFT JOIN collection_document cd ON cd.collection_id = c.id
        WHERE c.id = $1 AND c.user_id = $2
        GROUP BY c.id`,
      [id, userId]
    );
    const row = rows[0];
    if (row === undefined) throw new NotFoundException('Collection not found');
    return toDto(row);
  }

  async create(userId: string, name: string): Promise<CollectionDto> {
    const rows: CollectionRow[] = await this.dataSource.query(
      `INSERT INTO collection (user_id, name) VALUES ($1, $2)
       ON CONFLICT (user_id, name) DO NOTHING
       RETURNING id, name, created_at, 0 AS document_count`,
      [userId, name]
    );
    const row = rows[0];
    if (row === undefined)
      throw new ConflictException('A collection with this name already exists');
    return toDto(row);
  }

  async rename(userId: string, id: string, name: string): Promise<CollectionDto> {
    try {
      const result: [unknown[], number] = await this.dataSource.query(
        `UPDATE collection SET name = $3, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId, name]
      );
      if (result[0].length === 0) throw new NotFoundException('Collection not found');
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A collection with this name already exists');
      }
      throw error;
    }
    return this.get(userId, id);
  }

  /** Removes the collection and its links; the documents stay. */
  async remove(userId: string, id: string): Promise<void> {
    const result: [unknown[], number] = await this.dataSource.query(
      'DELETE FROM collection WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );
    if (result[0].length === 0) throw new NotFoundException('Collection not found');
  }

  async listDocuments(userId: string, id: string): Promise<DocumentDto[]> {
    await this.get(userId, id);
    const rows: DocumentRow[] = await this.dataSource.query(
      `SELECT ${documentColumns('d')}
         FROM collection_document cd
         JOIN collection c ON c.id = cd.collection_id
         JOIN document d ON d.id = cd.document_id
        WHERE c.id = $1 AND c.user_id = $2 AND d.user_id = $2
        ORDER BY d.created_at DESC, d.id DESC`,
      [id, userId]
    );
    return rows.map(toDocumentDto);
  }

  /** Puts one of the user's documents into one of the user's collections; doing it twice is fine. */
  async addDocument(userId: string, id: string, documentId: string): Promise<void> {
    const inserted: { collection_id: string }[] = await this.dataSource.query(
      `INSERT INTO collection_document (collection_id, document_id)
       SELECT c.id, d.id FROM collection c, document d
        WHERE c.id = $1 AND c.user_id = $3 AND d.id = $2 AND d.user_id = $3
       ON CONFLICT DO NOTHING
       RETURNING collection_id`,
      [id, documentId, userId]
    );
    if (inserted.length > 0) return;
    const both: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM collection c, document d
        WHERE c.id = $1 AND c.user_id = $3 AND d.id = $2 AND d.user_id = $3`,
      [id, documentId, userId]
    );
    if (both.length === 0) throw new NotFoundException('Collection or document not found');
  }

  async removeDocument(userId: string, id: string, documentId: string): Promise<void> {
    const result: [unknown[], number] = await this.dataSource.query(
      `DELETE FROM collection_document cd
        USING collection c
        WHERE cd.collection_id = c.id AND c.id = $1 AND c.user_id = $3 AND cd.document_id = $2
        RETURNING cd.document_id`,
      [id, documentId, userId]
    );
    if (result[0].length === 0)
      throw new NotFoundException('Document not found in this collection');
  }

  /** Of these ids the ones that are collections of the user; what a chat may search in. */
  async ownedIds(userId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows: { id: string }[] = await this.dataSource.query(
      'SELECT id FROM collection WHERE user_id = $1 AND id = ANY($2::uuid[])',
      [userId, ids]
    );
    return rows.map((row) => row.id);
  }
}
