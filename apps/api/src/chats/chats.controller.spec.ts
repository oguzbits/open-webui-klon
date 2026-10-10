import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../testing/create-test-app.js';
import { fakeAuth } from '../testing/fake-auth.js';
import { ChatStreamService } from './chat-stream.service.js';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';

class FakeChats {
  readonly calls: { method: string; args: unknown[] }[] = [];
  private record<T>(method: string, args: unknown[], result: T): Promise<T> {
    this.calls.push({ method, args });
    return Promise.resolve(result);
  }
  list(userId: string, query: unknown) {
    return this.record('list', [userId, query], { items: [], nextCursor: null });
  }
  create(userId: string, dto: unknown) {
    return this.record('create', [userId, dto], { id: randomUUID() });
  }
  getDetail(userId: string, id: string) {
    return this.record('getDetail', [userId, id], { id, messages: [] });
  }
  update(userId: string, id: string, dto: unknown) {
    return this.record('update', [userId, id, dto], { id });
  }
  remove(userId: string, id: string) {
    return this.record('remove', [userId, id], undefined);
  }
}

describe('ChatsController (HTTP, no database)', () => {
  let app: NestExpressApplication;
  const auth = fakeAuth();
  const fake = new FakeChats();

  afterEach(async () => {
    await app.close();
    fake.calls.length = 0;
  });

  async function start() {
    app = await createTestApp({
      controllers: [ChatsController],
      providers: [
        ...auth.providers,
        { provide: ChatsService, useValue: fake },
        { provide: ChatStreamService, useValue: {} },
      ],
    });
    return request(app.getHttpServer());
  }

  const ID = randomUUID();
  const routes = [
    ['get', '/api/chats'],
    ['post', '/api/chats'],
    ['get', `/api/chats/${ID}`],
    ['patch', `/api/chats/${ID}`],
    ['delete', `/api/chats/${ID}`],
    ['post', `/api/chats/${ID}/stream`],
    ['post', `/api/chats/${ID}/messages/${randomUUID()}/regenerate`],
  ] as const;

  it.each(routes)(
    '%s %s needs a session (401) and refuses a pending account (403)',
    async (method, url) => {
      const http = await start();

      await http[method](url).expect(401);
      await http[method](url).set(auth.session('pending')).expect(403);
      expect(fake.calls).toHaveLength(0);
    }
  );

  it('hands the user of the session to the service, never one from the request', async () => {
    const http = await start();

    await http.post('/api/chats').set(auth.session('user')).send({ modelId: 'c:m' }).expect(201);
    await http
      .post('/api/chats')
      .set(auth.session('user'))
      .send({ modelId: 'c:m', userId: 'x' })
      .expect(400);

    expect(fake.calls.filter((call) => call.method === 'create')).toHaveLength(1);
    expect(fake.calls[0]?.args[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a malformed id and bad query values before the service', async () => {
    const http = await start();

    await http.get('/api/chats/not-a-uuid').set(auth.session('user')).expect(400);
    await http.get('/api/chats?limit=1000').set(auth.session('user')).expect(400);
    expect(fake.calls).toHaveLength(0);
  });
});
