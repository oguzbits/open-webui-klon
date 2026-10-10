import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity.js';
import { CHAT_TITLE_SOURCE, type ChatTitleSource } from './chat-dictionaries.js';
import type { ChatParams } from './chat-params.js';

const SOURCE_VALUES = Object.values(CHAT_TITLE_SOURCE)
  .map((value) => `'${value}'`)
  .join(', ');

/** `title` is null until the first message is sent. Every query filters on `userId`. */
@Entity({ name: 'chat' })
@Index('chat_user_updated_idx', ['userId', 'updatedAt', 'id'])
@Check('chat_title_source_check', `title_source IN (${SOURCE_VALUES})`)
export class Chat {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  @Column({ name: 'title_source', type: 'text', default: CHAT_TITLE_SOURCE.FALLBACK })
  titleSource!: ChatTitleSource;

  @Column({ name: 'model_id', type: 'text' })
  modelId!: string;

  @Column({ name: 'system_prompt', type: 'text', nullable: true })
  systemPrompt!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  params!: ChatParams;

  /** Foreign key to `message` by entity name: a relation would import `Message`, which imports `Chat` (cycle). */
  @ForeignKey('Message', { onDelete: 'SET NULL' })
  @Column({ name: 'active_leaf_id', type: 'uuid', nullable: true })
  activeLeafId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
