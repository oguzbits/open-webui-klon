import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { insertChat, insertMessage, resetChatTables } from '../testing/chat-fixtures.js';
import { BASE_TEST_ENV } from '../testing/create-test-app.js';
import { insertUser, resetAuthTables } from '../testing/db-fixtures.js';
import { MESSAGE_ROLE, MESSAGE_STATUS } from './chat-dictionaries.js';
import { MessageTreeService } from './message-tree.service.js';

describe('MessageTreeService (database)', () => {
  let dataSource: DataSource;
  let tree: MessageTreeService;
  let close: () => Promise<void>;

  async function build(env: Record<string, string> = {}): Promise<void> {
    const module = await Test.createTestingModule({
      imports: [
        AppConfigModule.forRoot({
          raw: { ...BASE_TEST_ENV, DATABASE_URL: testDatabaseUrl(), ...env },
          ignoreEnvFile: true,
        }),
        TypeOrmModule.forRoot(buildDataSourceOptions(testDatabaseUrl())),
      ],
      providers: [MessageTreeService],
    }).compile();
    dataSource = module.get(DataSource);
    tree = module.get(MessageTreeService);
    close = () => module.close();
  }

  beforeAll(async () => {
    await build();
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await resetAuthTables(dataSource);
    await resetChatTables(dataSource);
  });

  async function setup() {
    const ann = await insertUser(dataSource);
    const ben = await insertUser(dataSource);
    const chat = await insertChat(dataSource, ann.id);
    return { ann, ben, chat };
  }

  describe('appendUserMessage', () => {
    it('stores the first message as a root, sets the active leaf and the fallback title', async () => {
      const { ann, chat } = await setup();

      const { messageId } = await tree.appendUserMessage(
        ann.id,
        chat.id,
        null,
        '  Wie wird das Wetter?  '
      );

      const rows = await dataSource.query(
        'SELECT title, title_source, active_leaf_id FROM chat WHERE id = $1',
        [chat.id]
      );
      expect(rows[0]).toEqual({
        title: 'Wie wird das Wetter?',
        title_source: 'fallback',
        active_leaf_id: messageId,
      });
      const messages = await tree.listMessages(ann.id, chat.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: MESSAGE_ROLE.USER,
        parentId: null,
        status: MESSAGE_STATUS.COMPLETE,
      });
      expect(messages[0]?.parts).toEqual([{ type: 'text', text: '  Wie wird das Wetter?  ' }]);
    });

    it('does not touch an existing title', async () => {
      const { ann, chat } = await setup();
      await dataSource.query(
        `UPDATE chat SET title = 'Mein Titel', title_source = 'user' WHERE id = $1`,
        [chat.id]
      );

      await tree.appendUserMessage(ann.id, chat.id, null, 'Hallo');

      const rows = await dataSource.query('SELECT title, title_source FROM chat WHERE id = $1', [
        chat.id,
      ]);
      expect(rows[0]).toEqual({ title: 'Mein Titel', title_source: 'user' });
    });

    it('allows only an answer, or nothing, as parent of a user message', async () => {
      const { ann, chat } = await setup();
      const first = await tree.appendUserMessage(ann.id, chat.id, null, 'a');

      await expect(
        tree.appendUserMessage(ann.id, chat.id, first.messageId, 'b')
      ).rejects.toMatchObject({ status: 422 });
    });

    it('answers 404 for a parent of another chat or of another user, and writes nothing', async () => {
      const { ann, ben, chat } = await setup();
      const otherChatOfAnn = await insertChat(dataSource, ann.id);
      const foreign = await insertChat(dataSource, ben.id);
      const inOther = await insertMessage(dataSource, otherChatOfAnn.id, {
        role: MESSAGE_ROLE.ASSISTANT,
      });
      const inForeign = await insertMessage(dataSource, foreign.id, {
        role: MESSAGE_ROLE.ASSISTANT,
      });

      await expect(tree.appendUserMessage(ann.id, chat.id, inOther.id, 'x')).rejects.toMatchObject({
        status: 404,
      });
      await expect(
        tree.appendUserMessage(ann.id, chat.id, inForeign.id, 'x')
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        tree.appendUserMessage(ann.id, chat.id, randomUUID(), 'x')
      ).rejects.toMatchObject({ status: 404 });
      await expect(tree.appendUserMessage(ben.id, chat.id, null, 'x')).rejects.toMatchObject({
        status: 404,
      });
      expect(
        await dataSource.query('SELECT 1 FROM message WHERE chat_id = $1', [chat.id])
      ).toHaveLength(0);
    });

    it('refuses with 409 when the chat holds the maximum number of messages', async () => {
      await close();
      await build({ CHAT_MAX_MESSAGES_PER_CHAT: '2' });
      const { ann, chat } = await setup();
      const first = await tree.appendUserMessage(ann.id, chat.id, null, 'a');
      await insertMessage(dataSource, chat.id, {
        parentId: first.messageId,
        role: MESSAGE_ROLE.ASSISTANT,
      });

      await expect(tree.appendUserMessage(ann.id, chat.id, null, 'b')).rejects.toMatchObject({
        status: 409,
      });
      await close();
      await build();
    });
  });

  describe('loadPath and newestLeafBelow', () => {
    async function branches() {
      const { ann, ben, chat } = await setup();
      const q = await insertMessage(dataSource, chat.id, {
        createdAt: new Date('2026-10-10T09:00:00Z'),
      });
      const a1 = await insertMessage(dataSource, chat.id, {
        parentId: q.id,
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: 'text', text: 'erste' }],
        createdAt: new Date('2026-10-10T09:01:00Z'),
      });
      const a2 = await insertMessage(dataSource, chat.id, {
        parentId: q.id,
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: 'text', text: 'zweite' }],
        createdAt: new Date('2026-10-10T09:02:00Z'),
      });
      const q2 = await insertMessage(dataSource, chat.id, {
        parentId: a1.id,
        createdAt: new Date('2026-10-10T09:03:00Z'),
      });
      return { ann, ben, chat, q, a1, a2, q2 };
    }

    it('returns the path from the root to a leaf in order', async () => {
      const { ann, chat, q2 } = await branches();

      const path = await tree.loadPath(ann.id, chat.id, q2.id);

      expect(path.map((row) => row.role)).toEqual(['user', 'assistant', 'user']);
      expect(path[1]?.parts).toEqual([{ type: 'text', text: 'erste' }]);
    });

    it('returns nothing for a leaf of someone else', async () => {
      const { ben, chat, q2 } = await branches();

      expect(await tree.loadPath(ben.id, chat.id, q2.id)).toEqual([]);
    });

    it('finds the newest leaf below a message, following the newest child at each step', async () => {
      const { ann, chat, q, a1, a2, q2 } = await branches();

      expect(await tree.newestLeafBelow(ann.id, chat.id, q.id)).toBe(a2.id);
      expect(await tree.newestLeafBelow(ann.id, chat.id, a1.id)).toBe(q2.id);
      expect(await tree.newestLeafBelow(ann.id, chat.id, q2.id)).toBe(q2.id);
    });

    it('answers 404 for a message of another chat or user', async () => {
      const { ann, ben, chat, q } = await branches();

      await expect(tree.newestLeafBelow(ben.id, chat.id, q.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(tree.newestLeafBelow(ann.id, chat.id, randomUUID())).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('prepareRegenerate', () => {
    it('accepts an answer and returns the user message it answers', async () => {
      const { ann, chat } = await setup();
      const q = await insertMessage(dataSource, chat.id, {
        parts: [
          { type: 'text', text: 'Frage ' },
          { type: 'text', text: 'Zwei' },
        ],
      });
      const a = await insertMessage(dataSource, chat.id, {
        parentId: q.id,
        role: MESSAGE_ROLE.ASSISTANT,
      });

      expect(await tree.prepareRegenerate(ann.id, chat.id, a.id)).toEqual({
        userMessageId: q.id,
        userText: 'Frage Zwei',
      });
    });

    it('refuses a user message (422) and a foreign or unknown message (404)', async () => {
      const { ann, ben, chat } = await setup();
      const q = await insertMessage(dataSource, chat.id);
      const a = await insertMessage(dataSource, chat.id, {
        parentId: q.id,
        role: MESSAGE_ROLE.ASSISTANT,
      });

      await expect(tree.prepareRegenerate(ann.id, chat.id, q.id)).rejects.toMatchObject({
        status: 422,
      });
      await expect(tree.prepareRegenerate(ben.id, chat.id, a.id)).rejects.toMatchObject({
        status: 404,
      });
      await expect(tree.prepareRegenerate(ann.id, chat.id, randomUUID())).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('saveAssistant', () => {
    const base = {
      status: MESSAGE_STATUS.COMPLETE,
      parts: [{ type: 'text' as const, text: 'Antwort' }],
      sources: null,
      errorReason: null,
      modelId: 'c:m',
      inputTokens: 3,
      outputTokens: 5,
    };

    it('stores the answer and makes it the active leaf', async () => {
      const { ann, chat } = await setup();
      const { messageId } = await tree.appendUserMessage(ann.id, chat.id, null, 'Frage');
      const id = randomUUID();

      const saved = await tree.saveAssistant({
        ...base,
        userId: ann.id,
        chatId: chat.id,
        id,
        parentId: messageId,
      });

      expect(saved).toBe(true);
      const rows = await dataSource.query('SELECT active_leaf_id FROM chat WHERE id = $1', [
        chat.id,
      ]);
      expect(rows[0].active_leaf_id).toBe(id);
      expect(await tree.countCompletedAnswers(chat.id)).toBe(1);
    });

    it('stores the sources as sent, an empty list as empty and none as null', async () => {
      const { ann, chat } = await setup();
      const { messageId } = await tree.appendUserMessage(ann.id, chat.id, null, 'Frage');
      const source = { n: 1, documentId: randomUUID(), filename: 'a.md', page: 2, excerpt: 'Text' };
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const inputs = [[source], [], null];

      for (const [index, sources] of inputs.entries()) {
        await tree.saveAssistant({
          ...base,
          sources,
          userId: ann.id,
          chatId: chat.id,
          id: ids[index] ?? randomUUID(),
          parentId: messageId,
        });
      }

      const read = await tree.listMessages(ann.id, chat.id);
      expect(ids.map((id) => read.find((message) => message.id === id)?.sources)).toEqual(inputs);
    });

    it('does not count aborted or failed answers as completed', async () => {
      const { ann, chat } = await setup();
      const { messageId } = await tree.appendUserMessage(ann.id, chat.id, null, 'Frage');
      await tree.saveAssistant({
        ...base,
        status: MESSAGE_STATUS.ABORTED,
        userId: ann.id,
        chatId: chat.id,
        id: randomUUID(),
        parentId: messageId,
      });

      expect(await tree.countCompletedAnswers(chat.id)).toBe(0);
    });

    it('returns false and writes nothing when the chat was deleted meanwhile', async () => {
      const { ann, chat } = await setup();
      const { messageId } = await tree.appendUserMessage(ann.id, chat.id, null, 'Frage');
      await dataSource.query('DELETE FROM chat WHERE id = $1', [chat.id]);

      const saved = await tree.saveAssistant({
        ...base,
        userId: ann.id,
        chatId: chat.id,
        id: randomUUID(),
        parentId: messageId,
      });

      expect(saved).toBe(false);
      expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
    });

    it('does not write into the chat of another user', async () => {
      const { ann, ben, chat } = await setup();
      const { messageId } = await tree.appendUserMessage(ann.id, chat.id, null, 'Frage');

      const saved = await tree.saveAssistant({
        ...base,
        userId: ben.id,
        chatId: chat.id,
        id: randomUUID(),
        parentId: messageId,
      });

      expect(saved).toBe(false);
      expect(
        await dataSource.query('SELECT 1 FROM message WHERE role = $1', [MESSAGE_ROLE.ASSISTANT])
      ).toHaveLength(0);
    });
  });
});
