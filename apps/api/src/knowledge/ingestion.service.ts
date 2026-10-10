import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';

import type { Env } from '../config/env.js';
import { RAG_JOB } from '../jobs/job-names.js';
import { JOB_QUEUE, type JobAttempt, type JobQueue } from '../jobs/job-queue.js';
import { chunkPages, type TextChunk } from './chunker.js';
import { EmbeddingService } from './embedding.service.js';
import { FILE_STORAGE, FileNotFoundError, type FileStorage } from './file-storage.js';
import { ParseError } from './parse-error.js';
import { ParserService } from './parser.service.js';
import {
  DOCUMENT_FAILURE,
  DOCUMENT_STATUS,
  type DocumentFailure,
  type DocumentType,
} from './rag-dictionaries.js';

/** Chunks sent to the embedding model per call; keeps one call small however long the document is. */
const EMBED_BATCH_SIZE = 64;

interface ClaimedDocument {
  user_id: string;
  type: DocumentType;
  storage_key: string;
}

/** Which part of the work was running when something broke; decides the reason of a final failure. */
const STAGE = { READ: 'read', EMBED: 'embed' } as const;

/**
 * The ingestion job: file → text → chunks → vectors → `ready`. Safe to run twice: only `pending` and `processing`
 * documents are picked up, and the chunks of a document are replaced as a whole in one transaction. A document
 * that cannot be parsed fails for good (trying again would not help); a failing embedding model throws so the
 * queue retries, and the last try marks the document `failed`.
 */
@Injectable()
export class IngestionService implements OnApplicationBootstrap {
  private readonly chunkChars: number;
  private readonly chunkOverlap: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    // Narrow types keep the test's fakes honest; the explicit tokens are needed because a Pick has no runtime type.
    @Inject(ParserService) private readonly parser: Pick<ParserService, 'parse'>,
    @Inject(EmbeddingService) private readonly embedding: Pick<EmbeddingService, 'embedTexts'>,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(PinoLogger) private readonly logger: Pick<PinoLogger, 'setContext' | 'info' | 'warn'>,
    config: ConfigService<Env, true>
  ) {
    this.chunkChars = config.get('RAG_CHUNK_CHARS', { infer: true });
    this.chunkOverlap = config.get('RAG_CHUNK_OVERLAP_CHARS', { infer: true });
    this.logger.setContext(IngestionService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work(RAG_JOB.INGEST_DOCUMENT, (data, attempt) =>
      this.ingest(data.documentId, attempt)
    );
  }

  async ingest(documentId: string, attempt: JobAttempt): Promise<void> {
    const started = Date.now();
    const claimed = await this.claim(documentId);
    if (claimed === undefined) return;

    let stage: (typeof STAGE)[keyof typeof STAGE] = STAGE.READ;
    try {
      const bytes = await this.storage.get(claimed.storage_key);
      const parsed = await this.parser.parse(bytes, claimed.type);
      const chunks = chunkPages(parsed.pages, {
        chars: this.chunkChars,
        overlap: this.chunkOverlap,
      });
      if (chunks.length === 0) throw new ParseError(DOCUMENT_FAILURE.NO_TEXT);

      stage = STAGE.EMBED;
      const embedded = await this.embedAll(chunks.map((chunk) => chunk.content));
      const stored = await this.store(
        documentId,
        claimed.user_id,
        chunks,
        embedded,
        parsed.pageCount
      );
      this.logger.info({
        documentId,
        status: stored ? DOCUMENT_STATUS.READY : 'deleted',
        chunks: chunks.length,
        durationMs: Date.now() - started,
        tokens: embedded.tokens,
        msg: 'document ingested',
      });
    } catch (error) {
      const reason = this.failureReason(error);
      const final = attempt.retryCount >= attempt.retryLimit;
      // Parsing again gives the same answer, so a parse failure is final; anything else gets its retries first.
      if (reason === undefined && !final) throw error;
      await this.fail(documentId, reason ?? this.fallbackReason(stage));
      this.logger.warn({
        documentId,
        status: DOCUMENT_STATUS.FAILED,
        failureReason: reason ?? this.fallbackReason(stage),
        errorName: error instanceof Error ? error.name : 'unknown',
        durationMs: Date.now() - started,
        msg: 'document ingestion failed',
      });
    }
  }

  /** Takes the document if there is work left to do; a deleted, ready or failed document is left alone. */
  private async claim(documentId: string): Promise<ClaimedDocument | undefined> {
    // UPDATE ... RETURNING comes back as [rows, affected count].
    const [rows]: [ClaimedDocument[], number] = await this.dataSource.query(
      `UPDATE document SET status = $2, failure_reason = NULL, updated_at = now()
        WHERE id = $1 AND status IN ($3, $2)
        RETURNING user_id, type, storage_key`,
      [documentId, DOCUMENT_STATUS.PROCESSING, DOCUMENT_STATUS.PENDING]
    );
    return rows[0];
  }

  private async embedAll(
    texts: string[]
  ): Promise<{ modelId: string; vectors: number[][]; tokens: number }> {
    let modelId = '';
    let tokens = 0;
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
      const result = await this.embedding.embedTexts(batch);
      if (
        result.vectors.length !== batch.length ||
        result.vectors.some((vector) => vector.length === 0)
      ) {
        throw new Error('The embedding model returned the wrong number of vectors');
      }
      modelId = result.modelId;
      tokens += result.tokens;
      vectors.push(...result.vectors);
    }
    return { modelId, vectors, tokens };
  }

  /**
   * Replaces the chunks and marks the document ready, in one transaction. The row is locked first: a document
   * deleted in the meantime ends the job quietly (false) instead of failing on the foreign key.
   */
  private async store(
    documentId: string,
    userId: string,
    chunks: TextChunk[],
    embedded: { modelId: string; vectors: number[][] },
    pageCount: number | null
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const locked: unknown[] = await manager.query(
        'SELECT 1 FROM document WHERE id = $1 AND status = $2 FOR UPDATE',
        [documentId, DOCUMENT_STATUS.PROCESSING]
      );
      if (locked.length === 0) return false;
      await manager.query('DELETE FROM chunk WHERE document_id = $1', [documentId]);
      await manager.query(
        `INSERT INTO chunk (document_id, user_id, ordinal, content, page, embedding, embedding_model_id)
         SELECT $1, $2, t.ordinal, t.content, t.page, t.embedding::halfvec, $3
           FROM unnest($4::int[], $5::text[], $6::int[], $7::text[]) AS t(ordinal, content, page, embedding)`,
        [
          documentId,
          userId,
          embedded.modelId,
          chunks.map((chunk) => chunk.ordinal),
          chunks.map((chunk) => chunk.content),
          chunks.map((chunk) => chunk.page),
          embedded.vectors.map((vector) => `[${vector.join(',')}]`),
        ]
      );
      await manager.query(
        `UPDATE document SET status = $2, failure_reason = NULL, page_count = $3, updated_at = now()
          WHERE id = $1`,
        [documentId, DOCUMENT_STATUS.READY, pageCount]
      );
      return true;
    });
  }

  private async fail(documentId: string, reason: DocumentFailure): Promise<void> {
    await this.dataSource.query(
      `UPDATE document SET status = $2, failure_reason = $3, updated_at = now()
        WHERE id = $1 AND status = $4`,
      [documentId, DOCUMENT_STATUS.FAILED, reason, DOCUMENT_STATUS.PROCESSING]
    );
  }

  /** The reason for errors that are final at once; undefined for errors worth another try. */
  private failureReason(error: unknown): DocumentFailure | undefined {
    if (error instanceof ParseError) return error.reason;
    if (error instanceof FileNotFoundError) return DOCUMENT_FAILURE.UNREADABLE;
    return undefined;
  }

  private fallbackReason(stage: string): DocumentFailure {
    return stage === STAGE.EMBED ? DOCUMENT_FAILURE.EMBEDDING_FAILED : DOCUMENT_FAILURE.UNREADABLE;
  }
}
