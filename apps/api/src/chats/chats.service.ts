import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { Env } from '../config/env.js';
import { CollectionsService } from '../knowledge/collections.service.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { CHAT_TITLE_SOURCE } from './chat-dictionaries.js';
import { Chat } from './chat.entity.js';
import type {
  ChatDetailDto,
  ChatListDto,
  CreateChatDto,
  ListChatsQueryDto,
  UpdateChatDto,
} from './chats.dto.js';
import { decodeCursor, encodeCursor, escapeLike } from './list-cursor.js';
import { MessageTreeService } from './message-tree.service.js';

const DEFAULT_PAGE_SIZE = 30;

interface ListRow {
  id: string;
  title: string | null;
  model_id: string;
  updated_at: Date;
  cursor_ts: string;
}

@Injectable()
export class ChatsService {
  private readonly systemPromptMax: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: ModelRegistryService,
    private readonly tree: MessageTreeService,
    private readonly collections: CollectionsService,
    config: ConfigService<Env, true>
  ) {
    this.systemPromptMax = config.get('CHAT_SYSTEM_PROMPT_MAX_LENGTH', { infer: true });
  }

  async create(userId: string, dto: CreateChatDto): Promise<Chat> {
    await this.registry.resolve(dto.modelId);
    this.checkSystemPrompt(dto.systemPrompt);
    const repository = this.dataSource.getRepository(Chat);
    return repository.save(
      repository.create({
        userId,
        title: null,
        modelId: dto.modelId,
        systemPrompt: dto.systemPrompt ?? null,
        params: dto.params ?? {},
      })
    );
  }

  /** The chat if it belongs to the user, else 404 (the same answer for "does not exist"). */
  async getOwned(userId: string, chatId: string): Promise<Chat> {
    const chat = await this.dataSource.getRepository(Chat).findOneBy({ id: chatId, userId });
    if (chat === null) throw new NotFoundException('Chat not found');
    return chat;
  }

  async getDetail(userId: string, chatId: string): Promise<ChatDetailDto> {
    const chat = await this.getOwned(userId, chatId);
    const messages = await this.tree.listMessages(userId, chatId);
    const collectionIds = await this.collections.ownedIds(userId, chat.collectionIds);
    return {
      id: chat.id,
      title: chat.title,
      titleSource: chat.titleSource,
      modelId: chat.modelId,
      systemPrompt: chat.systemPrompt,
      params: chat.params,
      collectionIds,
      activeLeafId: chat.activeLeafId,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages,
    };
  }

  async list(userId: string, query: ListChatsQueryDto): Promise<ChatListDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === undefined) {
      throw new UnprocessableEntityException('Invalid cursor');
    }
    const pattern = query.q === undefined || query.q === '' ? null : `%${escapeLike(query.q)}%`;

    const rows: ListRow[] = await this.dataSource.query(
      `SELECT id, title, model_id, updated_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
         FROM chat
        WHERE user_id = $1
          AND ($2::text IS NULL OR title ILIKE $2 ESCAPE '\\')
          AND ($3::timestamptz IS NULL OR (updated_at, id) < ($3::timestamptz, $4::uuid))
        ORDER BY updated_at DESC, id DESC
        LIMIT $5`,
      [userId, pattern, cursor?.ts ?? null, cursor?.id ?? null, limit + 1]
    );

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        id: row.id,
        title: row.title,
        modelId: row.model_id,
        updatedAt: row.updated_at,
      })),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor({ ts: last.cursor_ts, id: last.id })
          : null,
    };
  }

  async update(userId: string, chatId: string, dto: UpdateChatDto): Promise<Chat> {
    const chat = await this.getOwned(userId, chatId);
    if (dto.title !== undefined && dto.title.trim() === '') {
      throw new UnprocessableEntityException('The title is blank');
    }
    if (dto.modelId !== undefined) {
      await this.registry.resolve(dto.modelId);
      chat.modelId = dto.modelId;
    }
    if (dto.systemPrompt !== undefined) {
      this.checkSystemPrompt(dto.systemPrompt);
      chat.systemPrompt = dto.systemPrompt;
    }
    if (dto.params !== undefined) chat.params = dto.params;
    if (dto.collectionIds !== undefined) {
      // Nothing is saved unless every id is a collection of this user (the same 404 for "foreign" and "missing").
      const owned = await this.collections.ownedIds(userId, dto.collectionIds);
      if (owned.length !== dto.collectionIds.length) {
        throw new NotFoundException('Collection not found');
      }
      chat.collectionIds = dto.collectionIds;
    }
    if (dto.title !== undefined) {
      chat.title = dto.title.trim();
      chat.titleSource = CHAT_TITLE_SOURCE.USER;
    }
    if (dto.activeMessageId !== undefined) {
      chat.activeLeafId = await this.tree.newestLeafBelow(userId, chatId, dto.activeMessageId);
    }
    return this.dataSource.getRepository(Chat).save(chat);
  }

  async remove(userId: string, chatId: string): Promise<void> {
    const result: [unknown[], number] = await this.dataSource.query(
      'DELETE FROM chat WHERE id = $1 AND user_id = $2',
      [chatId, userId]
    );
    if (result[1] === 0) throw new NotFoundException('Chat not found');
  }

  private checkSystemPrompt(prompt: string | null | undefined): void {
    if (typeof prompt === 'string' && prompt.length > this.systemPromptMax) {
      throw new UnprocessableEntityException('System prompt is too long');
    }
  }
}
