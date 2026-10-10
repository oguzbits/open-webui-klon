import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { chatModel } from '../testing/chat-model.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { FakeJobQueue } from '../testing/fake-job-queue.js';
import { authed, signupUser } from '../testing/http-session.js';
import { capturingLogger } from '../testing/provider-fixtures.js';
import { JOB_QUEUE } from '../jobs/job-queue.js';
import { CHAT_JOB } from '../jobs/job-names.js';
import type { ChatDetailDto } from './chats.dto.js';

const MESSAGE = 'GEHEIME-NACHRICHT-4711';
const PROMPT = 'GEHEIMER-SYSTEMPROMPT-4712';
const ANSWER = 'GEHEIME-ANTWORT-4713';

describe('chat content stays out of the logs (database)', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  it('writes ids, lengths and counts, never message, prompt, answer or title', async () => {
    const logs = capturingLogger();
    app = await createDbTestApp(
      testDatabaseUrl(),
      { LOG_LEVEL: 'trace' },
      {
        configure: (builder) =>
          builder
            .overrideProvider(PinoLogger)
            .useValue(logs.logger)
            .overrideProvider(ModelRegistryService)
            .useValue({
              resolve: () =>
                Promise.resolve({
                  model: chatModel({ deltas: [ANSWER] }),
                  connection: { id: 'connection-1', name: 'Fake', type: 'ollama' },
                  rawModelId: 'fake-model',
                }),
            }),
      }
    );
    const http = request(app.getHttpServer());
    const ann = await signupUser(http, { email: 'ann@example.com' });
    const created = await authed(http, ann)
      .post('/api/chats')
      .send({ modelId: 'connection-1:fake-model', systemPrompt: PROMPT })
      .expect(201);
    const chatId = (created.body as ChatDetailDto).id;

    await authed(http, ann)
      .post(`/api/chats/${chatId}/stream`)
      .send({ parentId: null, text: MESSAGE })
      .expect(200);
    await app.get<FakeJobQueue>(JOB_QUEUE).run(CHAT_JOB.GENERATE_TITLE);
    await authed(http, ann).patch(`/api/chats/${chatId}`).send({ title: MESSAGE }).expect(200);

    const output = logs.output();
    expect(output).toContain(chatId);
    expect(output).not.toContain(MESSAGE);
    expect(output).not.toContain(PROMPT);
    expect(output).not.toContain(ANSWER);
  });
});
