import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { User } from '../users/user.entity.js';
import { Document } from './document.entity.js';

/**
 * A piece of a document with its vector. `userId` is stored again so the search can filter on it without a join.
 * `embedding` has no fixed length (rows of different models differ); the search only compares rows of one model.
 * The vector is written and read with raw SQL (`$n::halfvec`), never through the repository. The full-text vector is
 * computed in the query (`to_tsvector('simple', content)`): a stored generated column would make
 * `migration:generate` see a difference in every database whose name differs (TypeORM keeps the database name in
 * `typeorm_metadata`) and TypeORM cannot declare the GIN index that would make it worth storing.
 */
@Entity({ name: 'chunk' })
@Index('chunk_user_document_idx', ['userId', 'documentId'])
@Index('chunk_document_ordinal_idx', ['documentId', 'ordinal'], { unique: true })
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @ManyToOne(() => Document, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document!: Document;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'int' })
  ordinal!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'int', nullable: true })
  page!: number | null;

  @Column({ type: 'halfvec' })
  embedding!: string;

  @Column({ name: 'embedding_model_id', type: 'text' })
  embeddingModelId!: string;
}
