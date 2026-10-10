import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import {
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  type MessageRole,
  type MessageStatus,
} from './chat-dictionaries.js';
import type { MessagePart, MessageSource } from './chat-params.js';
import { Chat } from './chat.entity.js';

const ROLE_VALUES = Object.values(MESSAGE_ROLE)
  .map((value) => `'${value}'`)
  .join(', ');
const STATUS_VALUES = Object.values(MESSAGE_STATUS)
  .map((value) => `'${value}'`)
  .join(', ');

/** A node of the message tree: `parentId` null is a root, siblings (same parent) are regenerated or edited branches. */
@Entity({ name: 'message' })
@Index('message_chat_parent_idx', ['chatId', 'parentId'])
@Check('message_role_check', `role IN (${ROLE_VALUES})`)
@Check('message_status_check', `status IN (${STATUS_VALUES})`)
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'chat_id', type: 'uuid' })
  chatId!: string;

  @ManyToOne(() => Chat, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chat_id' })
  chat!: Chat;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => Message, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent!: Message | null;

  @Column({ type: 'text' })
  role!: MessageRole;

  @Column({ type: 'jsonb' })
  parts!: MessagePart[];

  /** The sources sent to the model for this answer; null if no search ran. */
  @Column({ type: 'jsonb', nullable: true })
  sources!: MessageSource[] | null;

  @Column({ type: 'text', default: MESSAGE_STATUS.COMPLETE })
  status!: MessageStatus;

  @Column({ name: 'error_reason', type: 'text', nullable: true })
  errorReason!: string | null;

  @Column({ name: 'model_id', type: 'text', nullable: true })
  modelId!: string | null;

  @Column({ name: 'input_tokens', type: 'int', nullable: true })
  inputTokens!: number | null;

  @Column({ name: 'output_tokens', type: 'int', nullable: true })
  outputTokens!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
