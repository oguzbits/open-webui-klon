import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity.js';
import {
  DOCUMENT_FAILURE,
  DOCUMENT_STATUS,
  DOCUMENT_TYPE,
  type DocumentFailure,
  type DocumentStatus,
  type DocumentType,
} from './rag-dictionaries.js';

function quoted(values: Record<string, string>): string {
  return Object.values(values)
    .map((value) => `'${value}'`)
    .join(', ');
}

/** An uploaded file of one user, parsed once per content (`sha256`). Every query filters on `userId`. */
@Entity({ name: 'document' })
@Index('document_user_sha256_idx', ['userId', 'sha256'], { unique: true })
@Check('document_status_check', `status IN (${quoted(DOCUMENT_STATUS)})`)
@Check(
  'document_failure_check',
  `failure_reason IS NULL OR failure_reason IN (${quoted(DOCUMENT_FAILURE)})`
)
@Check('document_type_check', `type IN (${quoted(DOCUMENT_TYPE)})`)
@Check('document_sha256_check', `sha256 ~ '^[0-9a-f]{64}$'`)
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'text' })
  sha256!: string;

  /** As uploaded, cleaned; it lives only in the database, the file on disk is named by `storageKey`. */
  @Column({ type: 'text' })
  filename!: string;

  @Column({ type: 'text' })
  type!: DocumentType;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes!: number;

  @Column({ type: 'text', default: DOCUMENT_STATUS.PENDING })
  status!: DocumentStatus;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: DocumentFailure | null;

  @Column({ name: 'storage_key', type: 'uuid' })
  storageKey!: string;

  @Column({ name: 'page_count', type: 'int', nullable: true })
  pageCount!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
