import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { createTestApp } from '../testing/create-test-app.js';
import { fakeAuth } from '../testing/fake-auth.js';
import { USER_ROLE } from '../users/user-role.js';
import { ModelRegistryService } from './model-registry.service.js';
import { ModelsController } from './models.controller.js';
import { ProviderConnection } from './provider-connection.entity.js';
import { ProviderConnectionsController } from './provider-connections.controller.js';
import { ProviderConnectionsService } from './provider-connections.service.js';
import { PROVIDER_TYPE } from './provider-type.js';

const ID = randomUUID();
const CIPHERTEXT = 'v1.test.AAAAAAAAAAAAAAAA.ciphertext-that-must-not-leave';

function makeConnection(): ProviderConnection {
  return Object.assign(new ProviderConnection(), {
    id: ID,
    name: 'Lokales Ollama',
    type: PROVIDER_TYPE.OLLAMA,
    baseUrl: 'http://ollama:11434',
    apiKeyCiphertext: CIPHERTEXT,
    enabled: true,
    hiddenModelIds: ['mistral:7b'],
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
  });
}

class FakeConnections {
  readonly calls: { method: string; args: unknown[] }[] = [];
  readonly entity = makeConnection();
  failure: Error | undefined;

  list() {
    return this.record('list', [], [this.entity]);
  }
  create(actorId: string, input: unknown) {
    return this.record('create', [actorId, input], this.entity);
  }
  update(actorId: string, id: string, patch: unknown) {
    return this.record('update', [actorId, id, patch], this.entity);
  }
  remove(actorId: string, id: string) {
    return this.record('remove', [actorId, id], undefined);
  }

  private record<T>(method: string, args: unknown[], result: T): Promise<T> {
    this.calls.push({ method, args });
    return this.failure === undefined ? Promise.resolve(result) : Promise.reject(this.failure);
  }
}

class FakeRegistry {
  failure: Error | undefined;

  list() {
    return Promise.resolve({
      models: [
        {
          id: `${ID}:llama3:8b`,
          name: 'llama3:8b',
          connectionId: ID,
          providerName: 'Lokales Ollama',
          providerType: PROVIDER_TYPE.OLLAMA,
        },
      ],
      unavailableConnections: [],
    });
  }
  listForConnection() {
    return this.answer({ models: [{ rawModelId: 'llama3:8b', name: 'llama3:8b', hidden: false }] });
  }
  test() {
    return this.answer({ ok: true, modelCount: 2 });
  }

  private answer<T>(result: T): Promise<T> {
    return this.failure === undefined ? Promise.resolve(result) : Promise.reject(this.failure);
  }
}

const VALID_CREATE = {
  name: 'Lokales Ollama',
  type: PROVIDER_TYPE.OLLAMA,
  baseUrl: 'http://ollama:11434',
};

const ADMIN_ROUTES = [
  ['get', '/api/admin/provider-connections'],
  ['post', '/api/admin/provider-connections'],
  ['patch', `/api/admin/provider-connections/${ID}`],
  ['delete', `/api/admin/provider-connections/${ID}`],
  ['post', `/api/admin/provider-connections/${ID}/test`],
  ['get', `/api/admin/provider-connections/${ID}/models`],
] as const;

describe('model routes', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  async function start() {
    const auth = fakeAuth();
    const connections = new FakeConnections();
    const registry = new FakeRegistry();
    app = await createTestApp({
      controllers: [ProviderConnectionsController, ModelsController],
      providers: [
        ...auth.providers,
        { provide: ProviderConnectionsService, useValue: connections },
        { provide: ModelRegistryService, useValue: registry },
      ],
      env: { RATE_LIMIT_LIMIT: '1000', ENABLE_API_KEYS: 'true' },
    });
    return { http: request(app.getHttpServer()), auth, connections, registry };
  }

  describe('access to the admin routes', () => {
    it.each(ADMIN_ROUTES)('%s %s refuses anonymous callers with 401', async (method, url) => {
      const { http, connections } = await start();

      await http[method](url).expect(401);

      expect(connections.calls).toEqual([]);
    });

    it.each(ADMIN_ROUTES)('%s %s refuses a normal user with 403', async (method, url) => {
      const { http, auth, connections } = await start();

      await http[method](url).set(auth.session(USER_ROLE.USER)).expect(403);

      expect(connections.calls).toEqual([]);
    });

    it.each(ADMIN_ROUTES)('%s %s refuses a pending account with 403', async (method, url) => {
      const { http, auth, connections } = await start();

      await http[method](url).set(auth.session(USER_ROLE.PENDING)).expect(403);

      expect(connections.calls).toEqual([]);
    });

    it.each(ADMIN_ROUTES)('%s %s refuses an admin API key with 403', async (method, url) => {
      const { http, auth, connections } = await start();

      await http[method](url).set(auth.key(USER_ROLE.ADMIN)).expect(403);

      expect(connections.calls).toEqual([]);
    });
  });

  describe('what an answer contains', () => {
    it('shows hasApiKey instead of the key or its ciphertext, in every answer', async () => {
      const { http, auth } = await start();
      const admin = auth.session(USER_ROLE.ADMIN);

      const list = await http.get('/api/admin/provider-connections').set(admin).expect(200);
      const created = await http
        .post('/api/admin/provider-connections')
        .set(admin)
        .send({ ...VALID_CREATE, apiKey: 'sk-live-secret' })
        .expect(201);
      const updated = await http
        .patch(`/api/admin/provider-connections/${ID}`)
        .set(admin)
        .send({ enabled: true })
        .expect(200);

      for (const response of [list, created, updated]) {
        const text = JSON.stringify(response.body);
        expect(text).not.toContain(CIPHERTEXT);
        expect(text).not.toContain('sk-live-secret');
        expect(text).not.toContain('apiKey');
      }
      expect(list.body).toEqual([
        {
          id: ID,
          name: 'Lokales Ollama',
          type: PROVIDER_TYPE.OLLAMA,
          baseUrl: 'http://ollama:11434',
          hasApiKey: true,
          enabled: true,
          hiddenModelIds: ['mistral:7b'],
          createdAt: '2026-10-09T10:00:00.000Z',
          updatedAt: '2026-10-09T10:00:00.000Z',
        },
      ]);
    });
  });

  describe('creating', () => {
    it('trims name, URL and key before the service sees them', async () => {
      const { http, auth, connections } = await start();

      await http
        .post('/api/admin/provider-connections')
        .set(auth.session(USER_ROLE.ADMIN))
        .send({
          name: '  Lokales Ollama \n',
          type: PROVIDER_TYPE.OLLAMA,
          baseUrl: ' http://ollama:11434\n',
          apiKey: '  sk-abc\n',
        })
        .expect(201);

      expect(connections.calls[0]?.args[1]).toEqual({
        name: 'Lokales Ollama',
        type: PROVIDER_TYPE.OLLAMA,
        baseUrl: 'http://ollama:11434',
        apiKey: 'sk-abc',
      });
    });

    it.each([
      ['an api key with a line break inside', { apiKey: 'sk-a\nbc' }],
      ['an api key with a space inside', { apiKey: 'sk-a bc' }],
      ['an api key with a control character', { apiKey: 'sk-a\u0000bc' }],
      ['an empty api key', { apiKey: '' }],
      ['an api key of only spaces', { apiKey: '   ' }],
      ['a null api key', { apiKey: null }],
      ['an api key that is too long', { apiKey: 'k'.repeat(513) }],
      ['an unknown field', { extra: 1 }],
      ['an unknown type', { type: 'anthropic' }],
      ['an empty name', { name: '   ' }],
      ['a name of 81 characters', { name: 'n'.repeat(81) }],
      ['a missing URL', { baseUrl: undefined }],
      ['a URL of 2049 characters', { baseUrl: `http://${'a'.repeat(2042)}` }],
      ['a number as enabled', { enabled: 1 }],
    ])('refuses %s with 400 and never calls the service', async (_name, change) => {
      const { http, auth, connections } = await start();

      const response = await http
        .post('/api/admin/provider-connections')
        .set(auth.session(USER_ROLE.ADMIN))
        .send({ ...VALID_CREATE, ...change })
        .expect(400);

      expect(response.headers['content-type']).toMatch(/problem\+json/);
      expect(connections.calls).toEqual([]);
    });
  });

  describe('changing', () => {
    it('passes the key as missing, null or string, as the client sent it', async () => {
      const { http, auth, connections } = await start();
      const admin = auth.session(USER_ROLE.ADMIN);
      const url = `/api/admin/provider-connections/${ID}`;

      await http.patch(url).set(admin).send({ name: 'Neu' }).expect(200);
      await http.patch(url).set(admin).send({ apiKey: null }).expect(200);
      await http.patch(url).set(admin).send({ apiKey: '  sk-new \n' }).expect(200);

      expect(connections.calls.map((call) => call.args[2])).toEqual([
        { name: 'Neu' },
        { apiKey: null },
        { apiKey: 'sk-new' },
      ]);
    });

    it.each([
      ['a type change', { type: PROVIDER_TYPE.OPENAI_COMPATIBLE }],
      ['an api key with a line break inside', { apiKey: 'sk-a\nbc' }],
      ['an empty api key (use null to remove it)', { apiKey: '' }],
      ['hidden models that are not a list', { hiddenModelIds: 'llama3:8b' }],
      ['an empty entry in the hidden models', { hiddenModelIds: [''] }],
      [
        'more than 1000 hidden models',
        { hiddenModelIds: Array.from({ length: 1001 }, (_v, i) => `m${i}`) },
      ],
    ])('refuses %s with 400', async (_name, patch) => {
      const { http, auth, connections } = await start();

      await http
        .patch(`/api/admin/provider-connections/${ID}`)
        .set(auth.session(USER_ROLE.ADMIN))
        .send(patch)
        .expect(400);

      expect(connections.calls).toEqual([]);
    });

    it('refuses an id that is not a uuid with 400', async () => {
      const { http, auth } = await start();

      await http
        .patch('/api/admin/provider-connections/not-a-uuid')
        .set(auth.session(USER_ROLE.ADMIN))
        .send({ enabled: false })
        .expect(400);
    });

    it('answers 204 when deleting and passes a 404 of the service on', async () => {
      const { http, auth, connections } = await start();
      const admin = auth.session(USER_ROLE.ADMIN);

      await http.delete(`/api/admin/provider-connections/${ID}`).set(admin).expect(204);
      connections.failure = new NotFoundException('Connection not found');
      await http.delete(`/api/admin/provider-connections/${ID}`).set(admin).expect(404);
    });
  });

  describe('testing a connection', () => {
    it('answers 200 with ok and the number of models', async () => {
      const { http, auth } = await start();

      const response = await http
        .post(`/api/admin/provider-connections/${ID}/test`)
        .set(auth.session(USER_ROLE.ADMIN))
        .expect(200);

      expect(response.body).toEqual({ ok: true, modelCount: 2 });
    });

    it.each(Object.values(PROVIDER_ERROR))('answers 502 with the reason %s', async (reason) => {
      const { http, auth, registry } = await start();
      registry.failure = new ProviderError(reason, 'connect ECONNREFUSED 10.0.0.5:11434 sk-abc');

      const response = await http
        .post(`/api/admin/provider-connections/${ID}/test`)
        .set(auth.session(USER_ROLE.ADMIN))
        .expect(502);

      expect(response.headers['content-type']).toMatch(/problem\+json/);
      expect(response.body).toMatchObject({ status: 502, reason });
      expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5|sk-abc/);
    });

    it('also answers 502 with the reason when listing the models of a connection fails', async () => {
      const { http, auth, registry } = await start();
      registry.failure = new ProviderError(PROVIDER_ERROR.TIMEOUT, 'slow');

      const response = await http
        .get(`/api/admin/provider-connections/${ID}/models`)
        .set(auth.session(USER_ROLE.ADMIN))
        .expect(502);

      expect(response.body.reason).toBe(PROVIDER_ERROR.TIMEOUT);
    });

    it('allows 10 tests a minute and then answers 429, without touching other routes', async () => {
      const { http, auth } = await start();
      const admin = auth.session(USER_ROLE.ADMIN);
      const test = () => http.post(`/api/admin/provider-connections/${ID}/test`).set(admin);

      for (let call = 0; call < 10; call += 1) await test().expect(200);
      await test().expect(429);

      await http.get('/api/admin/provider-connections').set(admin).expect(200);
    });
  });

  describe('GET /models', () => {
    it('refuses anonymous callers and pending accounts', async () => {
      const { http, auth } = await start();

      await http.get('/api/models').expect(401);
      await http.get('/api/models').set(auth.session(USER_ROLE.PENDING)).expect(403);
    });

    it.each([
      ['a user session', (auth: ReturnType<typeof fakeAuth>) => auth.session(USER_ROLE.USER)],
      ['an admin session', (auth: ReturnType<typeof fakeAuth>) => auth.session(USER_ROLE.ADMIN)],
      ['a user API key', (auth: ReturnType<typeof fakeAuth>) => auth.key(USER_ROLE.USER)],
    ])('returns the model list for %s', async (_name, headers) => {
      const { http, auth } = await start();

      const response = await http.get('/api/models').set(headers(auth)).expect(200);

      expect(response.body).toEqual({
        models: [
          {
            id: `${ID}:llama3:8b`,
            name: 'llama3:8b',
            connectionId: ID,
            providerName: 'Lokales Ollama',
            providerType: PROVIDER_TYPE.OLLAMA,
          },
        ],
        unavailableConnections: [],
      });
    });
  });
});
