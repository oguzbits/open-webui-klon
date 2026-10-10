import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { insertChat } from '../testing/chat-fixtures.js';
import { chatModel } from '../testing/chat-model.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import {
  authed,
  type Http,
  type Login,
  loginUser,
  signupUser,
  TEST_PASSWORD,
} from '../testing/http-session.js';
import { USER_ROLE } from '../users/user-role.js';
import type { ChatDetailDto, ChatListDto } from './chats.dto.js';

const MODEL_ID = 'connection-1:fake-model';

describe('chats (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let ann: Login;
  let ben: Login;

  afterEach(async () => {
    await app.close();
  });

  async function start(env: Record<string, string> = {}): Promise<void> {
    app = await createDbTestApp(testDatabaseUrl(), env, {
      configure: (builder) =>
        builder.overrideProvider(ModelRegistryService).useValue({
          resolve: (modelId: string) =>
            modelId === MODEL_ID
              ? Promise.resolve({
                  model: chatModel(),
                  connection: { id: 'connection-1', name: 'Fake', type: 'ollama' },
                  rawModelId: 'fake-model',
                })
              : Promise.reject(Object.assign(new Error('Model not found'), { status: 404 })),
        }),
    });
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    ann = await signupUser(http, { email: 'ann@example.com' });
    const pending = await signupUser(http, { email: 'ben@example.com' });
    await authed(http, ann)
      .patch(`/api/users/${pending.user.id}`)
      .send({ role: USER_ROLE.USER })
      .expect(200);
    ben = await loginUser(http, 'ben@example.com', TEST_PASSWORD);
  }

  async function createChat(login: Login, body: Record<string, unknown> = {}) {
    const response = await authed(http, login)
      .post('/api/chats')
      .send({ modelId: MODEL_ID, ...body })
      .expect(201);
    return response.body as ChatDetailDto;
  }

  describe('create, read, change, delete', () => {
    it('creates a chat with system prompt and parameters and reads it back with no messages', async () => {
      await start();

      const created = await createChat(ann, {
        systemPrompt: 'Antworte kurz.',
        params: { temperature: 0.2, topP: 0.9, maxOutputTokens: 100 },
      });
      const read = await authed(http, ann).get(`/api/chats/${created.id}`).expect(200);

      expect(read.body).toMatchObject({
        id: created.id,
        title: null,
        titleSource: 'fallback',
        modelId: MODEL_ID,
        systemPrompt: 'Antworte kurz.',
        params: { temperature: 0.2, topP: 0.9, maxOutputTokens: 100 },
        activeLeafId: null,
        messages: [],
      });
      expect(read.body).not.toHaveProperty('userId');
    });

    it('refuses an unknown model with 404 and a too long system prompt with 422', async () => {
      await start({ CHAT_SYSTEM_PROMPT_MAX_LENGTH: '10' });

      await authed(http, ann).post('/api/chats').send({ modelId: 'nope:x' }).expect(404);
      await authed(http, ann)
        .post('/api/chats')
        .send({ modelId: MODEL_ID, systemPrompt: 'x'.repeat(11) })
        .expect(422);
      expect(await dataSource.query('SELECT 1 FROM chat')).toHaveLength(0);
    });

    it('rejects unknown fields and bad parameters with 400', async () => {
      await start();

      await authed(http, ann)
        .post('/api/chats')
        .send({ modelId: MODEL_ID, userId: ben.user.id })
        .expect(400);
      await authed(http, ann)
        .post('/api/chats')
        .send({ modelId: MODEL_ID, params: { temperature: 5 } })
        .expect(400);
    });

    it('renames (title source becomes user), changes model, prompt and parameters, and can clear the prompt', async () => {
      await start();
      const chat = await createChat(ann, { systemPrompt: 'alt' });

      const renamed = await authed(http, ann)
        .patch(`/api/chats/${chat.id}`)
        .send({ title: 'Mein Titel', systemPrompt: null, params: { topP: 0.5 } })
        .expect(200);

      expect(renamed.body).toMatchObject({
        title: 'Mein Titel',
        titleSource: 'user',
        systemPrompt: null,
        params: { topP: 0.5 },
      });
      await authed(http, ann)
        .patch(`/api/chats/${chat.id}`)
        .send({ modelId: 'nope:x' })
        .expect(404);
    });

    it('refuses a blank title with 422', async () => {
      await start();
      const chat = await createChat(ann);

      await authed(http, ann).patch(`/api/chats/${chat.id}`).send({ title: '   ' }).expect(422);
    });

    it('deletes a chat with its messages and answers 404 afterwards', async () => {
      await start();
      const chat = await createChat(ann);

      await authed(http, ann).delete(`/api/chats/${chat.id}`).expect(204);

      await authed(http, ann).get(`/api/chats/${chat.id}`).expect(404);
      await authed(http, ann).delete(`/api/chats/${chat.id}`).expect(404);
    });
  });

  describe('the list', () => {
    it('shows only the own chats, newest change first, and searches the title without treating % as a wildcard', async () => {
      await start();
      const user = ann.user.id;
      await insertChat(dataSource, user, { title: 'Reiseplan Italien' });
      await insertChat(dataSource, user, { title: '100% Rabatt' });
      await insertChat(dataSource, user, { title: 'Kochen' });
      await insertChat(dataSource, ben.user.id, { title: 'Reiseplan von Ben' });

      const all = await authed(http, ann).get('/api/chats').expect(200);
      const reise = await authed(http, ann).get('/api/chats?q=reise').expect(200);
      const percent = await authed(http, ann).get('/api/chats?q=%25').expect(200);
      const underscore = await authed(http, ann).get('/api/chats?q=_').expect(200);

      expect((all.body as ChatListDto).items.map((item) => item.title)).toEqual([
        'Kochen',
        '100% Rabatt',
        'Reiseplan Italien',
      ]);
      expect((reise.body as ChatListDto).items.map((item) => item.title)).toEqual([
        'Reiseplan Italien',
      ]);
      expect((percent.body as ChatListDto).items.map((item) => item.title)).toEqual([
        '100% Rabatt',
      ]);
      expect((underscore.body as ChatListDto).items).toHaveLength(0);
    });

    it('pages through chats with identical timestamps without repeating or skipping one', async () => {
      await start();
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push((await insertChat(dataSource, ann.user.id, { title: `Chat ${index}` })).id);
      }
      await dataSource.query(
        `UPDATE chat SET updated_at = '2026-10-10T09:00:00.123456Z' WHERE user_id = $1`,
        [ann.user.id]
      );

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const url: string = `/api/chats?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
        const body = (await authed(http, ann).get(url).expect(200)).body as ChatListDto;
        seen.push(...body.items.map((item) => item.id));
        cursor = body.nextCursor;
        if (cursor === null) break;
      }

      expect([...seen].sort()).toEqual([...ids].sort());
      expect(new Set(seen).size).toBe(5);
    });

    it('answers 422 for a cursor it did not issue', async () => {
      await start();

      await authed(http, ann).get('/api/chats?cursor=garbage').expect(422);
      const unusable = Buffer.from('{"ts":"x","id":"y"}').toString('base64url');
      await authed(http, ann).get(`/api/chats?cursor=${unusable}`).expect(422);
    });
  });

  describe('other users', () => {
    it('cannot read, change, delete or even see the chat of someone else', async () => {
      await start();
      const chat = await createChat(ann);

      await authed(http, ben).get(`/api/chats/${chat.id}`).expect(404);
      await authed(http, ben).patch(`/api/chats/${chat.id}`).send({ title: 'x' }).expect(404);
      await authed(http, ben).delete(`/api/chats/${chat.id}`).expect(404);
      expect(
        ((await authed(http, ben).get('/api/chats').expect(200)).body as ChatListDto).items
      ).toHaveLength(0);
      expect(await dataSource.query('SELECT 1 FROM chat WHERE id = $1', [chat.id])).toHaveLength(1);
    });
  });
});
