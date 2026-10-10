import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

import type { Env } from '../config/env.js';
import {
  CHAT_TITLE_SOURCE,
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  type MessageRole,
  type MessageStatus,
} from './chat-dictionaries.js';
import type { HistoryRow } from './chat-history.js';
import type { MessagePart } from './chat-params.js';
import { fallbackTitle } from './chat-title.js';
import type { MessageDto } from './chats.dto.js';

export interface SaveAssistantInput {
  userId: string;
  chatId: string;
  id: string;
  parentId: string;
  status: MessageStatus;
  parts: MessagePart[];
  errorReason: string | null;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface MessageRow {
  id: string;
  parent_id: string | null;
  role: MessageRole;
  parts: MessagePart[];
  status: MessageStatus;
  error_reason: string | null;
  model_id: string | null;
  created_at: Date;
}

/**
 * The message tree of a chat. Every method names the user and joins `chat` on `user_id`, so a message of someone
 * else is never reachable, whatever ids the client sends. Writes run in one transaction with the chat row locked.
 */
@Injectable()
export class MessageTreeService {
  private readonly maxMessages: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService<Env, true>
  ) {
    this.maxMessages = config.get('CHAT_MAX_MESSAGES_PER_CHAT', { infer: true });
  }

  async listMessages(userId: string, chatId: string): Promise<MessageDto[]> {
    const rows: MessageRow[] = await this.dataSource.query(
      `SELECT m.id, m.parent_id, m.role, m.parts, m.status, m.error_reason, m.model_id, m.created_at
         FROM message m JOIN chat c ON c.id = m.chat_id
        WHERE m.chat_id = $1 AND c.user_id = $2
        ORDER BY m.created_at, m.id`,
      [chatId, userId]
    );
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      role: row.role,
      parts: row.parts,
      status: row.status,
      errorReason: row.error_reason,
      modelId: row.model_id,
      createdAt: row.created_at,
    }));
  }

  async loadPath(userId: string, chatId: string, leafId: string): Promise<HistoryRow[]> {
    const rows: Pick<MessageRow, 'role' | 'status' | 'parts'>[] = await this.dataSource.query(
      `WITH RECURSIVE path AS (
         SELECT m.id, m.parent_id, m.role, m.status, m.parts, 0 AS depth
           FROM message m JOIN chat c ON c.id = m.chat_id
          WHERE m.id = $1 AND m.chat_id = $2 AND c.user_id = $3
         UNION ALL
         SELECT p.id, p.parent_id, p.role, p.status, p.parts, path.depth + 1
           FROM message p JOIN path ON p.id = path.parent_id
       )
       SELECT role, status, parts FROM path ORDER BY depth DESC`,
      [leafId, chatId, userId]
    );
    return rows;
  }

  async newestLeafBelow(userId: string, chatId: string, messageId: string): Promise<string> {
    const rows: { id: string }[] = await this.dataSource.query(
      `WITH RECURSIVE below AS (
         SELECT m.id, 0 AS depth
           FROM message m JOIN chat c ON c.id = m.chat_id
          WHERE m.id = $1 AND m.chat_id = $2 AND c.user_id = $3
         UNION ALL
         SELECT child.id, below.depth + 1
           FROM below
           JOIN LATERAL (
             SELECT id FROM message WHERE parent_id = below.id ORDER BY created_at DESC, id DESC LIMIT 1
           ) child ON true
       )
       SELECT id FROM below ORDER BY depth DESC LIMIT 1`,
      [messageId, chatId, userId]
    );
    const leaf = rows[0];
    if (leaf === undefined) throw new NotFoundException('Message not found');
    return leaf.id;
  }

  async appendUserMessage(
    userId: string,
    chatId: string,
    parentId: string | null,
    text: string
  ): Promise<{ messageId: string }> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockChat(manager, userId, chatId);
      await this.checkRoom(manager, chatId);
      if (parentId !== null) {
        const role = await this.roleOf(manager, userId, chatId, parentId);
        if (role !== MESSAGE_ROLE.ASSISTANT) {
          throw new UnprocessableEntityException('A message can only follow an answer');
        }
      }
      const rows: { id: string }[] = await manager.query(
        `INSERT INTO message (chat_id, parent_id, role, parts, status)
         VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
        [
          chatId,
          parentId,
          MESSAGE_ROLE.USER,
          JSON.stringify([{ type: 'text', text }]),
          MESSAGE_STATUS.COMPLETE,
        ]
      );
      const messageId = rows[0]?.id;
      if (messageId === undefined) throw new Error('Insert returned no id');
      await manager.query(
        `UPDATE chat
            SET active_leaf_id = $2,
                updated_at = now(),
                title = COALESCE(title, $3),
                title_source = CASE WHEN title IS NULL THEN $4 ELSE title_source END
          WHERE id = $1`,
        [chatId, messageId, fallbackTitle(text), CHAT_TITLE_SOURCE.FALLBACK]
      );
      return { messageId };
    });
  }

  async prepareRegenerate(
    userId: string,
    chatId: string,
    messageId: string
  ): Promise<{ userMessageId: string }> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockChat(manager, userId, chatId);
      await this.checkRoom(manager, chatId);
      const rows: { role: MessageRole; parent_id: string | null }[] = await manager.query(
        `SELECT m.role, m.parent_id
           FROM message m JOIN chat c ON c.id = m.chat_id
          WHERE m.id = $1 AND m.chat_id = $2 AND c.user_id = $3`,
        [messageId, chatId, userId]
      );
      const row = rows[0];
      if (row === undefined) throw new NotFoundException('Message not found');
      if (row.role !== MESSAGE_ROLE.ASSISTANT || row.parent_id === null) {
        throw new UnprocessableEntityException('Only an answer can be regenerated');
      }
      return { userMessageId: row.parent_id };
    });
  }

  /** Stores the answer and makes it the active leaf. False when the chat is gone (deleted while it was streaming). */
  async saveAssistant(input: SaveAssistantInput): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const inserted: { id: string }[] = await manager.query(
        `INSERT INTO message (id, chat_id, parent_id, role, parts, status, error_reason, model_id, input_tokens, output_tokens)
         SELECT $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10
          WHERE EXISTS (SELECT 1 FROM chat WHERE id = $2 AND user_id = $11)
          RETURNING id`,
        [
          input.id,
          input.chatId,
          input.parentId,
          MESSAGE_ROLE.ASSISTANT,
          JSON.stringify(input.parts),
          input.status,
          input.errorReason,
          input.modelId,
          input.inputTokens,
          input.outputTokens,
          input.userId,
        ]
      );
      if (inserted.length === 0) return false;
      await manager.query(
        'UPDATE chat SET active_leaf_id = $2, updated_at = now() WHERE id = $1 AND user_id = $3',
        [input.chatId, input.id, input.userId]
      );
      return true;
    });
  }

  async countCompletedAnswers(chatId: string): Promise<number> {
    const rows: { count: string }[] = await this.dataSource.query(
      'SELECT count(*) AS count FROM message WHERE chat_id = $1 AND role = $2 AND status = $3',
      [chatId, MESSAGE_ROLE.ASSISTANT, MESSAGE_STATUS.COMPLETE]
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async lockChat(manager: EntityManager, userId: string, chatId: string): Promise<void> {
    const rows: unknown[] = await manager.query(
      'SELECT 1 FROM chat WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [chatId, userId]
    );
    if (rows.length === 0) throw new NotFoundException('Chat not found');
  }

  private async checkRoom(manager: EntityManager, chatId: string): Promise<void> {
    const rows: { count: string }[] = await manager.query(
      'SELECT count(*) AS count FROM message WHERE chat_id = $1',
      [chatId]
    );
    if (Number(rows[0]?.count ?? 0) >= this.maxMessages) {
      throw new ConflictException('This chat holds the maximum number of messages');
    }
  }

  private async roleOf(
    manager: EntityManager,
    userId: string,
    chatId: string,
    messageId: string
  ): Promise<MessageRole> {
    const rows: { role: MessageRole }[] = await manager.query(
      `SELECT m.role FROM message m JOIN chat c ON c.id = m.chat_id
        WHERE m.id = $1 AND m.chat_id = $2 AND c.user_id = $3`,
      [messageId, chatId, userId]
    );
    const row = rows[0];
    if (row === undefined) throw new NotFoundException('Message not found');
    return row.role;
  }
}
