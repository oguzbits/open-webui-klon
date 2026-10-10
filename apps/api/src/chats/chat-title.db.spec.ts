import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { JOB_QUEUE } from '../jobs/job-queue.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { chatModel } from '../testing/chat-model.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { FakeJobQueue } from '../testing/fake-job-queue.js';
import { authed, type Http, type Login, signupUser } from '../testing/http-session.js';
import { CHAT_JOB, CHAT_TITLE_SOURCE } from './chat-dictionaries.js';
import type { ChatDetailDto } from './chats.dto.js';

const MODEL_ID = 'connection-1:fake-model';

describe('chat titles (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let ann: Login;
  let queue: FakeJobQueue;
  let titleText = 'Wetter in Berlin';
  let whileModelThinks: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await app.close();
    titleText = 'Wetter in Berlin';
    whileModelThinks = undefined;
  });

  async function start(): Promise<void> {
    app = await createDbTestApp(
      testDatabaseUrl(),
      {},
      {
        configure: (builder) =>
          builder.overrideProvider(ModelRegistryService).useValue({
            resolve: async () => {
              await whileModelThinks?.();
              return {
                model: chatModel({ deltas: [titleText] }),
                connection: { id: 'connection-1', name: 'Fake', type: 'ollama' },
                rawModelId: 'fake-model',
              };
            },
          }),
      }
    );
    dataSource = app.get(DataSource);
    queue = app.get<FakeJobQueue>(JOB_QUEUE);
    http = request(app.getHttpServer());
    ann = await signupUser(http, { email: 'ann@example.com' });
  }

  async function chatWithAnswer(): Promise<string> {
    const created = await authed(http, ann)
      .post('/api/chats')
      .send({ modelId: MODEL_ID })
      .expect(201);
    const chatId = (created.body as ChatDetailDto).id;
    await authed(http, ann)
      .post(`/api/chats/${chatId}/stream`)
      .send({ parentId: null, text: 'Wie wird das Wetter in Berlin?' })
      .expect(200);
    return chatId;
  }

  async function titleOf(chatId: string): Promise<{ title: string; title_source: string }> {
    const rows: { title: string; title_source: string }[] = await dataSource.query(
      'SELECT title, title_source FROM chat WHERE id = $1',
      [chatId]
    );
    const row = rows[0];
    if (row === undefined) throw new Error('chat not found');
    return row;
  }

  it('queues one job with the chat id only after the first answer, not after the second', async () => {
    await start();
    const chatId = await chatWithAnswer();
    const detail = (await authed(http, ann).get(`/api/chats/${chatId}`).expect(200))
      .body as ChatDetailDto;

    await authed(http, ann)
      .post(`/api/chats/${chatId}/stream`)
      .send({ parentId: detail.messages[1]?.id, text: 'Und morgen?' })
      .expect(200);

    expect(queue.sent).toEqual([{ name: CHAT_JOB.GENERATE_TITLE, data: { chatId } }]);
  });

  it('replaces the fallback title with the generated one', async () => {
    await start();
    const chatId = await chatWithAnswer();
    expect(await titleOf(chatId)).toEqual({
      title: 'Wie wird das Wetter in Berlin?',
      title_source: CHAT_TITLE_SOURCE.FALLBACK,
    });

    await queue.run(CHAT_JOB.GENERATE_TITLE);

    expect(await titleOf(chatId)).toEqual({
      title: 'Wetter in Berlin',
      title_source: CHAT_TITLE_SOURCE.GENERATED,
    });
  });

  it('does not run the model for a chat the user named before the job started', async () => {
    await start();
    const chatId = await chatWithAnswer();
    await authed(http, ann).patch(`/api/chats/${chatId}`).send({ title: 'Mein Titel' }).expect(200);

    await queue.run(CHAT_JOB.GENERATE_TITLE);

    expect(await titleOf(chatId)).toEqual({
      title: 'Mein Titel',
      title_source: CHAT_TITLE_SOURCE.USER,
    });
  });

  it('does not overwrite a title the user chose while the model was thinking', async () => {
    await start();
    const chatId = await chatWithAnswer();
    whileModelThinks = async () => {
      await authed(http, ann)
        .patch(`/api/chats/${chatId}`)
        .send({ title: 'Mein Titel' })
        .expect(200);
    };

    await queue.run(CHAT_JOB.GENERATE_TITLE);

    expect(await titleOf(chatId)).toEqual({
      title: 'Mein Titel',
      title_source: CHAT_TITLE_SOURCE.USER,
    });
  });

  it('keeps the fallback and throws (so the queue retries) when the model gives no usable title', async () => {
    await start();
    titleText = '"""';
    const chatId = await chatWithAnswer();

    await expect(queue.run(CHAT_JOB.GENERATE_TITLE)).rejects.toThrow(/no usable title/);

    expect((await titleOf(chatId)).title_source).toBe(CHAT_TITLE_SOURCE.FALLBACK);
  });

  it('does nothing for a chat that was deleted meanwhile', async () => {
    await start();
    const chatId = await chatWithAnswer();
    await authed(http, ann).delete(`/api/chats/${chatId}`).expect(204);

    await expect(queue.run(CHAT_JOB.GENERATE_TITLE)).resolves.toBeUndefined();
  });

  it('stores markup in a generated title as plain text (the API never renders it)', async () => {
    await start();
    titleText = '<script>alert(1)</script> Titel';
    const chatId = await chatWithAnswer();

    await queue.run(CHAT_JOB.GENERATE_TITLE);

    expect((await titleOf(chatId)).title).toBe('<script>alert(1)</script> Titel');
  });
});
