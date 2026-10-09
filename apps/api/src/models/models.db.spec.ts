import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ApiKeyService } from '../auth/api-key.service.js';
import { PROVIDER_ERROR } from '../http/safe-fetch/provider-error.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { FAKE_MODE, FakeProvider } from '../testing/fake-provider.js';
import {
  authed,
  type Http,
  type Login,
  loginUser,
  signupUser,
  TEST_PASSWORD,
} from '../testing/http-session.js';
import { capturingLogger } from '../testing/provider-fixtures.js';
import { USER_ROLE } from '../users/user-role.js';
import { ModelRegistryService } from './model-registry.service.js';
import type { ModelListDto } from './models.dto.js';
import { PROVIDER_TYPE } from './provider-type.js';

const SECRET = 'sk-e2e-secret-value-123';
const NEW_SECRET = 'sk-e2e-replaced-value-456';
const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'ping' }] }];

describe('model connections end to end (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let admin: Login;
  let ben: Login;
  let provider: FakeProvider;
  let logs: ReturnType<typeof capturingLogger>;
  const others: FakeProvider[] = [];

  afterEach(async () => {
    await app.close();
    await Promise.all([provider, ...others.splice(0)].map((fake) => fake.close()));
  });

  /** The first account is the admin; Ben is promoted to a normal user. */
  async function start(): Promise<void> {
    provider = await FakeProvider.start();
    logs = capturingLogger();
    app = await createDbTestApp(
      testDatabaseUrl(),
      { ENABLE_API_KEYS: 'true' },
      { configure: (builder) => builder.overrideProvider(PinoLogger).useValue(logs.logger) }
    );
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    admin = await signupUser(http, { email: 'admin@example.com' });
    const pending = await signupUser(http, { email: 'ben@example.com' });
    await authed(http, admin)
      .patch(`/api/users/${pending.user.id}`)
      .send({ role: USER_ROLE.USER })
      .expect(200);
    ben = await loginUser(http, 'ben@example.com', TEST_PASSWORD);
  }

  async function connect(body: Record<string, unknown> = {}, target = provider) {
    const response = await authed(http, admin)
      .post('/api/admin/provider-connections')
      .send({
        name: 'Lokal',
        type: PROVIDER_TYPE.OLLAMA,
        baseUrl: target.url,
        apiKey: SECRET,
        ...body,
      })
      .expect(201);
    return response.body as { id: string; name: string; hasApiKey: boolean };
  }

  function modelNames(body: unknown): string[] {
    return (body as ModelListDto).models.map((model) => model.name);
  }

  describe('the key', () => {
    it('is stored encrypted and appears in no answer, audit entry or log line', async () => {
      await start();
      provider.requiredKey = SECRET;

      const created = await connect();
      const list = await authed(http, admin).get('/api/admin/provider-connections').expect(200);
      await authed(http, admin)
        .post(`/api/admin/provider-connections/${created.id}/test`)
        .expect(200);
      await authed(http, admin)
        .patch(`/api/admin/provider-connections/${created.id}`)
        .send({ name: 'Umbenannt' })
        .expect(200);
      await authed(http, ben).get('/api/models').expect(200);

      expect(created.hasApiKey).toBe(true);
      expect(JSON.stringify(created)).not.toContain(SECRET);
      expect(JSON.stringify(list.body)).not.toContain(SECRET);
      const [row] = await dataSource.query<{ api_key_ciphertext: string }[]>(
        'SELECT api_key_ciphertext FROM provider_connection WHERE id = $1',
        [created.id]
      );
      expect(row?.api_key_ciphertext).toMatch(/^v1\./);
      expect(row?.api_key_ciphertext).not.toContain(SECRET);
      const audit = await dataSource.query<object[]>(
        'SELECT * FROM audit_log WHERE target_id = $1',
        [created.id]
      );
      expect(audit).toHaveLength(2);
      expect(JSON.stringify(audit)).not.toContain(SECRET);
      expect(logs.output()).toContain('Model list fetched');
      expect(logs.output()).not.toContain(SECRET);
    });

    it('is sent to the provider as a Bearer token, until it is replaced or removed', async () => {
      await start();
      provider.requiredKey = SECRET;
      const created = await connect();
      const url = `/api/admin/provider-connections/${created.id}`;

      await authed(http, admin).post(`${url}/test`).expect(200);
      expect(provider.requests.at(-1)?.authorization).toBe(`Bearer ${SECRET}`);

      await authed(http, admin).patch(url).send({ name: 'Umbenannt' }).expect(200);
      await authed(http, admin).post(`${url}/test`).expect(200);

      const removed = await authed(http, admin).patch(url).send({ apiKey: null }).expect(200);
      expect(removed.body.hasApiKey).toBe(false);
      const refused = await authed(http, admin).post(`${url}/test`).expect(502);
      expect(refused.body.reason).toBe(PROVIDER_ERROR.UNAUTHORIZED);

      provider.requiredKey = NEW_SECRET;
      const replaced = await authed(http, admin)
        .patch(url)
        .send({ apiKey: NEW_SECRET })
        .expect(200);
      expect(replaced.body.hasApiKey).toBe(true);
      await authed(http, admin).post(`${url}/test`).expect(200);

      expect(logs.output()).not.toContain(SECRET);
      expect(logs.output()).not.toContain(NEW_SECRET);
    });
  });

  describe('models', () => {
    it('lets an admin test and see every model, and a user see them without the hidden ones', async () => {
      await start();
      const created = await connect({ apiKey: undefined });
      const url = `/api/admin/provider-connections/${created.id}`;

      const test = await authed(http, admin).post(`${url}/test`).expect(200);
      expect(test.body).toEqual({ ok: true, modelCount: 2 });

      await authed(http, admin)
        .patch(url)
        .send({ hiddenModelIds: ['mistral:7b'] })
        .expect(200);

      const forAdmin = await authed(http, admin).get(`${url}/models`).expect(200);
      expect(forAdmin.body.models).toEqual([
        { rawModelId: 'llama3:8b', name: 'llama3:8b', hidden: false },
        { rawModelId: 'mistral:7b', name: 'mistral:7b', hidden: true },
      ]);
      const forBen = await authed(http, ben).get('/api/models').expect(200);
      expect(forBen.body).toEqual({
        models: [
          {
            id: `${created.id}:llama3:8b`,
            name: 'llama3:8b',
            connectionId: created.id,
            providerName: 'Lokal',
            providerType: PROVIDER_TYPE.OLLAMA,
          },
        ],
        unavailableConnections: [],
      });
    });

    it('keeps the list in memory and drops it after an edit', async () => {
      await start();
      const created = await connect({ apiKey: undefined });
      const tagRequests = () =>
        provider.requests.filter((item) => item.path === '/api/tags').length;

      await authed(http, ben).get('/api/models').expect(200);
      await authed(http, ben).get('/api/models').expect(200);
      expect(tagRequests()).toBe(1);

      provider.models = ['llama3:8b', 'new-model'];
      const cached = await authed(http, ben).get('/api/models').expect(200);
      expect(modelNames(cached.body)).toEqual(['llama3:8b', 'mistral:7b']);

      await authed(http, admin)
        .patch(`/api/admin/provider-connections/${created.id}`)
        .send({ name: 'Umbenannt' })
        .expect(200);
      const fresh = await authed(http, ben).get('/api/models').expect(200);
      expect(modelNames(fresh.body)).toEqual(['llama3:8b', 'new-model']);
      expect(tagRequests()).toBe(2);
    });

    it('names a failing connection and still lists the models of the others', async () => {
      await start();
      const broken = await FakeProvider.start();
      others.push(broken);
      broken.mode = FAKE_MODE.UNAUTHORIZED;
      await connect({ apiKey: undefined });
      const down = await connect({ name: 'Kaputt', apiKey: undefined }, broken);

      const response = await authed(http, ben).get('/api/models').expect(200);

      expect(modelNames(response.body)).toEqual(['llama3:8b', 'mistral:7b']);
      expect(response.body.unavailableConnections).toEqual([
        { id: down.id, name: 'Kaputt', reason: PROVIDER_ERROR.UNAUTHORIZED },
      ]);
    });

    it('does not list a disabled connection, and a deleted one is gone', async () => {
      await start();
      const created = await connect({ apiKey: undefined });
      const url = `/api/admin/provider-connections/${created.id}`;

      await authed(http, admin).patch(url).send({ enabled: false }).expect(200);
      expect((await authed(http, ben).get('/api/models').expect(200)).body.models).toEqual([]);

      await authed(http, admin).delete(url).expect(204);
      expect((await authed(http, admin).get('/api/admin/provider-connections')).body).toEqual([]);
      await authed(http, admin).post(`${url}/test`).expect(404);
    });

    it('gives the chat a model that reaches the provider with the stored key', async () => {
      await start();
      provider.requiredKey = SECRET;
      const created = await connect();

      const { model, rawModelId } = await app
        .get(ModelRegistryService)
        .resolve(`${created.id}:llama3:8b`);
      if (typeof model === 'string') throw new Error('expected a model object');
      await model.doGenerate({ prompt: PROMPT });

      expect(rawModelId).toBe('llama3:8b');
      expect(provider.requests.at(-1)).toMatchObject({
        path: '/v1/chat/completions',
        authorization: `Bearer ${SECRET}`,
      });
    });
  });

  describe('names and hosts', () => {
    it('answers 409 for a taken name, and lets exactly one of two parallel requests win', async () => {
      await start();
      await connect({ apiKey: undefined });

      await authed(http, admin)
        .post('/api/admin/provider-connections')
        .send({ name: 'Lokal', type: PROVIDER_TYPE.OLLAMA, baseUrl: provider.url })
        .expect(409);

      const statuses = (
        await Promise.all(
          [1, 2].map(() =>
            authed(http, admin)
              .post('/api/admin/provider-connections')
              .send({ name: 'Parallel', type: PROVIDER_TYPE.OLLAMA, baseUrl: provider.url })
          )
        )
      )
        .map((response) => response.status)
        .sort();
      expect(statuses).toEqual([201, 409]);
    });

    it.each([
      'http://169.254.169.254',
      'http://[fe80::1]:11434',
      'http://10.0.0.9:11434',
      'http://user:secret@127.0.0.1:11434',
      'http://127.0.0.1:11434/?token=abc',
      'ftp://127.0.0.1',
      'not a url',
    ])('refuses %s with 422 and stores nothing', async (baseUrl) => {
      await start();

      const response = await authed(http, admin)
        .post('/api/admin/provider-connections')
        .send({ name: 'Boese', type: PROVIDER_TYPE.OLLAMA, baseUrl, apiKey: SECRET })
        .expect(422);

      expect(JSON.stringify(response.body)).not.toContain(SECRET);
      expect(JSON.stringify(response.body)).not.toContain('secret@');
      expect((await authed(http, admin).get('/api/admin/provider-connections')).body).toEqual([]);
    });

    it('refuses a new address for a saved connection, too', async () => {
      await start();
      const created = await connect({ apiKey: undefined });

      await authed(http, admin)
        .patch(`/api/admin/provider-connections/${created.id}`)
        .send({ baseUrl: 'http://169.254.169.254' })
        .expect(422);
    });
  });

  describe('access', () => {
    it('keeps users, pending accounts and API keys out of the admin routes', async () => {
      await start();
      const { key } = await app.get(ApiKeyService).create(admin.user.id, 'ci');
      const pending = await signupUser(http, { email: 'pending@example.com' });

      await http.get('/api/admin/provider-connections').expect(401);
      await authed(http, ben).get('/api/admin/provider-connections').expect(403);
      await authed(http, pending).get('/api/admin/provider-connections').expect(403);
      await http
        .get('/api/admin/provider-connections')
        .set('Authorization', `Bearer ${key}`)
        .expect(403);
    });

    it('lets a user read the models with a session or an API key, but not a pending account', async () => {
      await start();
      const { key } = await app.get(ApiKeyService).create(ben.user.id, 'ci');
      const pending = await signupUser(http, { email: 'pending@example.com' });

      await http.get('/api/models').expect(401);
      await authed(http, pending).get('/api/models').expect(403);
      await authed(http, ben).get('/api/models').expect(200);
      await http.get('/api/models').set('Authorization', `Bearer ${key}`).expect(200);
    });
  });
});
