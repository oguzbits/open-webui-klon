import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';

import type { Env } from '../config/env.js';
import { RAG_JOB } from '../jobs/job-names.js';
import { JOB_QUEUE, type JobQueue } from '../jobs/job-queue.js';
import { documentColumns, toDocumentDto, type DocumentRow } from './document-rows.js';
import { EmbeddingService } from './embedding.service.js';
import { cleanFilename } from './file-name.js';
import { FILE_STORAGE, type FileStorage } from './file-storage.js';
import { detectDocumentType } from './file-type.js';
import type { DocumentDto } from './knowledge.dto.js';
import {
  DOCUMENT_STATUS,
  KNOWLEDGE_UNAVAILABLE,
  type DocumentFailure,
} from './rag-dictionaries.js';

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
}

/** Documents of one user. Every statement carries the `user_id` of the session; a foreign id is a 404. */
@Injectable()
export class DocumentsService {
  private readonly maxDocuments: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly embedding: EmbeddingService,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>
  ) {
    this.maxDocuments = config.get('RAG_MAX_DOCUMENTS_PER_USER', { infer: true });
    this.logger.setContext(DocumentsService.name);
  }

  async list(userId: string): Promise<DocumentDto[]> {
    const rows: DocumentRow[] = await this.dataSource.query(
      `SELECT ${documentColumns('d')} FROM document d WHERE d.user_id = $1
        ORDER BY d.created_at DESC, d.id DESC`,
      [userId]
    );
    return rows.map(toDocumentDto);
  }

  /**
   * Stores a new document, or finds the one with the same content (`sha256` per user) and returns that. Nothing
   * is written when the knowledge features are off. A new document is `pending` until the job has read it; if
   * the file or the job cannot be stored, the row goes away again so no `pending` row waits for nothing.
   */
  async upload(
    userId: string,
    file: UploadedFile,
    collectionId?: string
  ): Promise<{ document: DocumentDto; created: boolean }> {
    this.requireConfigured();
    const filename = cleanFilename(file.originalname);
    const type = detectDocumentType(file.buffer, filename);
    if (type === undefined) throw new UnsupportedMediaTypeException('Unsupported file type');
    if (collectionId !== undefined) await this.requireOwnedCollection(userId, collectionId);

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const storageKey = randomUUID();
    // One statement does the quota, the duplicate check and the insert, so concurrent uploads cannot slip past.
    const inserted: DocumentRow[] = await this.dataSource.query(
      `INSERT INTO document (user_id, sha256, filename, type, size_bytes, storage_key)
       SELECT $1::uuid, $2, $3, $4, $5::int, $6::uuid
        WHERE (SELECT count(*) FROM document WHERE user_id = $1::uuid) < $7::int
       ON CONFLICT (user_id, sha256) DO NOTHING
       RETURNING ${documentColumns('document')}`,
      [userId, sha256, filename, type, file.buffer.length, storageKey, this.maxDocuments]
    );
    const row = inserted[0];

    if (row === undefined) {
      const existing = await this.findBySha256(userId, sha256);
      if (existing === undefined) throw new ConflictException('The document limit is reached');
      if (collectionId !== undefined) await this.link(userId, collectionId, existing.id);
      return { document: toDocumentDto(existing), created: false };
    }

    try {
      if (collectionId !== undefined) await this.link(userId, collectionId, row.id);
      await this.storage.put(storageKey, file.buffer);
      await this.queue.send(RAG_JOB.INGEST_DOCUMENT, { documentId: row.id });
    } catch (error) {
      await this.discard(userId, row.id, storageKey);
      throw error;
    }
    return { document: toDocumentDto(row), created: true };
  }

  /** Reads a `failed` document again. Anything else is a 409; a foreign document is a 404. */
  async retry(userId: string, documentId: string): Promise<DocumentDto> {
    this.requireConfigured();
    // UPDATE ... RETURNING comes back as [rows, affected count].
    const [rows]: [(DocumentRow & { previous_failure: DocumentFailure | null })[], number] =
      await this.dataSource.query(
        `UPDATE document d SET status = $3, failure_reason = NULL, updated_at = now()
           FROM (SELECT id, failure_reason AS previous_failure FROM document
                  WHERE id = $1 AND user_id = $2 AND status = $4 FOR UPDATE) old
          WHERE d.id = old.id
          RETURNING ${documentColumns('d')}, old.previous_failure`,
        [documentId, userId, DOCUMENT_STATUS.PENDING, DOCUMENT_STATUS.FAILED]
      );
    const row = rows[0];
    if (row === undefined) {
      const known: unknown[] = await this.dataSource.query(
        'SELECT 1 FROM document WHERE id = $1 AND user_id = $2',
        [documentId, userId]
      );
      if (known.length === 0) throw new NotFoundException('Document not found');
      throw new ConflictException('Only a failed document can be tried again');
    }
    try {
      await this.queue.send(RAG_JOB.INGEST_DOCUMENT, { documentId });
    } catch (error) {
      await this.dataSource.query(
        `UPDATE document SET status = $3, failure_reason = $4, updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [documentId, userId, DOCUMENT_STATUS.FAILED, row.previous_failure]
      );
      throw error;
    }
    return toDocumentDto(row);
  }

  /** Deletes the document (its chunks and links go with it), then its file. */
  async remove(userId: string, documentId: string): Promise<void> {
    const result: [{ storage_key: string }[], number] = await this.dataSource.query(
      'DELETE FROM document WHERE id = $1 AND user_id = $2 RETURNING storage_key',
      [documentId, userId]
    );
    const deleted = result[0][0];
    if (deleted === undefined) throw new NotFoundException('Document not found');
    await this.removeFile(deleted.storage_key, documentId);
  }

  private requireConfigured(): void {
    if (!this.embedding.isConfigured())
      throw new ServiceUnavailableException(KNOWLEDGE_UNAVAILABLE);
  }

  private async requireOwnedCollection(userId: string, collectionId: string): Promise<void> {
    const rows: unknown[] = await this.dataSource.query(
      'SELECT 1 FROM collection WHERE id = $1 AND user_id = $2',
      [collectionId, userId]
    );
    if (rows.length === 0) throw new NotFoundException('Collection not found');
  }

  private async findBySha256(userId: string, sha256: string): Promise<DocumentRow | undefined> {
    const rows: DocumentRow[] = await this.dataSource.query(
      `SELECT ${documentColumns('d')} FROM document d WHERE d.user_id = $1 AND d.sha256 = $2`,
      [userId, sha256]
    );
    return rows[0];
  }

  /** Both ids are checked against the user in the statement itself; a collection that vanished links nothing. */
  private async link(userId: string, collectionId: string, documentId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO collection_document (collection_id, document_id)
       SELECT c.id, d.id FROM collection c, document d
        WHERE c.id = $1 AND c.user_id = $3 AND d.id = $2 AND d.user_id = $3
       ON CONFLICT DO NOTHING`,
      [collectionId, documentId, userId]
    );
  }

  /** Undoes a half-finished upload. A failure here is logged; the caller throws the original error. */
  private async discard(userId: string, documentId: string, storageKey: string): Promise<void> {
    try {
      await this.dataSource.query('DELETE FROM document WHERE id = $1 AND user_id = $2', [
        documentId,
        userId,
      ]);
    } catch (error) {
      this.logger.error({
        documentId,
        errorName: error instanceof Error ? error.name : 'unknown',
        msg: 'could not remove the row of a failed upload',
      });
    }
    await this.removeFile(storageKey, documentId);
  }

  private async removeFile(storageKey: string, documentId: string): Promise<void> {
    try {
      await this.storage.remove(storageKey);
    } catch (error) {
      this.logger.error({
        documentId,
        errorName: error instanceof Error ? error.name : 'unknown',
        msg: 'could not remove a document file',
      });
    }
  }
}
