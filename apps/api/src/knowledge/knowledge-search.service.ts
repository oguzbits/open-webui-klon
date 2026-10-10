import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { Env } from '../config/env.js';
import { EmbeddingService } from './embedding.service.js';
import type { KnowledgeHitText } from './knowledge-context.js';

export interface KnowledgeHit extends KnowledgeHitText {
  chunkId: string;
}

interface HitRow {
  id: string;
  document_id: string;
  filename: string;
  page: number | null;
  content: string;
}

/** Reciprocal Rank Fusion constant: the usual 60, so a first place is worth little more than a tenth. */
const RRF_K = 60;

/**
 * Hybrid search over the collections a user names. One SQL statement does everything: `scope` is the only place
 * that decides what may be found (the user's own ready documents of the current embedding model, inside the
 * named collections of that user); the vector and the full-text ranking both read from it, and the two ranks
 * are fused with RRF. Nothing is filtered or ranked in Node.
 */
@Injectable()
export class KnowledgeSearchService {
  private readonly candidates: number;
  private readonly topK: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly embedding: EmbeddingService,
    config: ConfigService<Env, true>
  ) {
    this.candidates = config.get('RAG_CANDIDATES', { infer: true });
    this.topK = config.get('RAG_TOP_K', { infer: true });
  }

  async search(
    userId: string,
    collectionIds: string[],
    query: string,
    signal?: AbortSignal
  ): Promise<KnowledgeHit[]> {
    if (collectionIds.length === 0 || query.trim() === '') return [];
    const { modelId, vector } = await this.embedding.embedQuery(query, signal);

    const rows: HitRow[] = await this.dataSource.query(
      `WITH scope AS (
         SELECT c.id, c.document_id, c.content, c.page, c.embedding, d.filename
           FROM chunk c
           JOIN document d ON d.id = c.document_id AND d.user_id = $1 AND d.status = 'ready'
          WHERE c.user_id = $1
            AND c.embedding_model_id = $3
            AND EXISTS (
              SELECT 1
                FROM collection_document cd
                JOIN collection col ON col.id = cd.collection_id AND col.user_id = $1
               WHERE cd.document_id = d.id AND cd.collection_id = ANY($2::uuid[])
            )
       ),
       vec AS (
         SELECT id, row_number() OVER (ORDER BY embedding <=> $4::halfvec) AS rank
           FROM scope
          ORDER BY embedding <=> $4::halfvec
          LIMIT $6
       ),
       fts AS (
         SELECT id, row_number() OVER (ORDER BY ts_rank_cd(to_tsvector('simple', content), q) DESC) AS rank
           FROM scope, websearch_to_tsquery('simple', $5) q
          WHERE to_tsvector('simple', content) @@ q
          ORDER BY ts_rank_cd(to_tsvector('simple', content), q) DESC
          LIMIT $6
       )
       SELECT s.id, s.document_id, s.filename, s.page, s.content
         FROM scope s
         LEFT JOIN vec ON vec.id = s.id
         LEFT JOIN fts ON fts.id = s.id
        WHERE vec.id IS NOT NULL OR fts.id IS NOT NULL
        ORDER BY coalesce(1.0 / (${RRF_K} + vec.rank), 0) + coalesce(1.0 / (${RRF_K} + fts.rank), 0) DESC, s.id
        LIMIT $7`,
      [userId, collectionIds, modelId, `[${vector.join(',')}]`, query, this.candidates, this.topK]
    );

    return rows.map((row) => ({
      chunkId: row.id,
      documentId: row.document_id,
      filename: row.filename,
      page: row.page,
      content: row.content,
    }));
  }
}
