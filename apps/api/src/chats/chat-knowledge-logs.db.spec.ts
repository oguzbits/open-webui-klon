import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { EmbeddingService } from '../knowledge/embedding.service.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { chatModel } from '../testing/chat-model.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { fakeEmbedding } from '../testing/fake-embedding.js';
import { authed, signupUser } from '../testing/http-session.js';
import {
  insertChunk,
  insertCollection,
  insertDocument,
  linkDocument,
} from '../testing/knowledge-fixtures.js';
import { capturingLogger } from '../testing/provider-fixtures.js';
import type { ChatDetailDto } from './chats.dto.js';

const EMBED_MODEL = 'connection:embed';
const EXCERPT = 'GEHEIMER-AUSZUG-7701 über Wale';
const QUESTION = 'GEHEIME-FRAGE-7702 Wale?';

// nestjs-pino keeps the stream of the first logger of a process, so this check has a file of its own.
describe('knowledge in chats stays out of the logs (database)', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  it('names the chat and counts the hits, but never shows the question or the excerpts', async () => {
    const logs = capturingLogger();
    app = await createDbTestApp(
      testDatabaseUrl(),
      { LOG_LEVEL: 'trace', EMBEDDING_MODEL_ID: EMBED_MODEL },
      {
        configure: (builder) =>
          builder
            .overrideProvider(PinoLogger)
            .useValue(logs.logger)
            .overrideProvider(EmbeddingService)
            .useValue({
              embedQuery: (text: string) =>
                Promise.resolve({ modelId: EMBED_MODEL, vector: fakeEmbedding(text) }),
            })
            .overrideProvider(ModelRegistryService)
            .useValue({
              resolve: () =>
                Promise.resolve({
                  model: chatModel(),
                  connection: { id: 'connection-1', name: 'Fake', type: 'ollama' },
                  rawModelId: 'fake-model',
                }),
            }),
      }
    );
    const dataSource = app.get(DataSource);
    const http = request(app.getHttpServer());
    const ann = await signupUser(http, { email: 'ann@example.com' });
    const collection = await insertCollection(dataSource, ann.user.id);
    const document = await insertDocument(dataSource, ann.user.id);
    await insertChunk(dataSource, {
      documentId: document.id,
      userId: ann.user.id,
      content: EXCERPT,
      embedding: fakeEmbedding(EXCERPT),
      embeddingModelId: EMBED_MODEL,
    });
    await linkDocument(dataSource, collection.id, document.id);
    const created = await authed(http, ann)
      .post('/api/chats')
      .send({ modelId: 'connection-1:fake-model' })
      .expect(201);
    const chatId = (created.body as ChatDetailDto).id;
    await authed(http, ann)
      .patch(`/api/chats/${chatId}`)
      .send({ collectionIds: [collection.id] })
      .expect(200);

    await authed(http, ann)
      .post(`/api/chats/${chatId}/stream`)
      .send({ parentId: null, text: QUESTION })
      .expect(200);

    const output = logs.output();
    expect(output).toContain(chatId);
    expect(output).toContain('"hits":1');
    expect(output).not.toContain('GEHEIMER-AUSZUG-7701');
    expect(output).not.toContain('GEHEIME-FRAGE-7702');
  });
});
