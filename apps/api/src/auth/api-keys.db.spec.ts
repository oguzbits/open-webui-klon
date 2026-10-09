import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
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

const KEY_FORMAT = /^sk-[0-9a-f]{64}$/;

describe('api keys (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let admin: Login;

  afterEach(async () => {
    await app.close();
  });

  async function start(env: Record<string, string> = { ENABLE_API_KEYS: 'true' }): Promise<void> {
    app = await createDbTestApp(testDatabaseUrl(), env);
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    admin = await signupUser(http, { email: 'admin@example.com' });
  }

  async function member(email: string, role: string = USER_ROLE.USER): Promise<Login> {
    const login = await signupUser(http, { email });
    await authed(http, admin).patch(`/api/users/${login.user.id}`).send({ role }).expect(200);
    return loginUser(http, email, TEST_PASSWORD);
  }

  async function createKey(login: Login, body: object = { name: 'ci' }) {
    const response = await authed(http, login).post('/api/auth/api-keys').send(body).expect(201);
    return {
      id: response.body.id as string,
      key: response.body.key as string,
      body: response.body,
    };
  }

  const bearer = (key: string) => `Bearer ${key}`;

  describe('switch', () => {
    it('answers 404 on every route while ENABLE_API_KEYS is off (the default)', async () => {
      await start({ ENABLE_API_KEYS: 'false' });

      await authed(http, admin).get('/api/auth/api-keys').expect(404);
      await authed(http, admin).post('/api/auth/api-keys').send({ name: 'ci' }).expect(404);
      await authed(http, admin).delete(`/api/auth/api-keys/${randomUUID()}`).expect(404);
    });
  });

  describe('create and list', () => {
    it('shows the key once, stores only its hash and lists it without the secret', async () => {
      await start();

      const created = await createKey(admin, { name: 'CI runner' });

      expect(created.key).toMatch(KEY_FORMAT);
      expect(created.body).toMatchObject({
        name: 'CI runner',
        prefix: created.key.slice(0, 8),
        expiresAt: null,
      });
      const rows = await dataSource.query<{ key_hash: string }[]>('SELECT key_hash FROM api_key');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rows)).not.toContain(created.key);
      const list = await authed(http, admin).get('/api/auth/api-keys').expect(200);
      expect(list.body).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain(created.key);
      expect(list.body[0]).not.toHaveProperty('key');
      expect(list.body[0]).not.toHaveProperty('keyHash');
    });

    it('sets an expiry from expiresInDays', async () => {
      await start();

      const { body } = await createKey(admin, { name: 'short', expiresInDays: 2 });

      const expiresAt = String(body.expiresAt);
      const days = (Date.parse(expiresAt) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(1.9);
      expect(days).toBeLessThan(2.1);
    });

    it.each([
      ['a blank name', { name: '   ' }],
      ['no name', {}],
      ['a name above 100 characters', { name: 'x'.repeat(101) }],
      ['an expiry of zero days', { name: 'k', expiresInDays: 0 }],
      ['an expiry above a year', { name: 'k', expiresInDays: 366 }],
      ['a fractional expiry', { name: 'k', expiresInDays: 1.5 }],
      ['an extra field', { name: 'k', userId: randomUUID() }],
    ])('rejects %s with 400', async (_name, body) => {
      await start();

      await authed(http, admin).post('/api/auth/api-keys').send(body).expect(400);
    });

    it('refuses an account that is still pending', async () => {
      await start();
      const pending = await signupUser(http, { email: 'pending@example.com' });

      await authed(http, pending).post('/api/auth/api-keys').send({ name: 'k' }).expect(403);
    });

    it('audits creation and revocation with the key id, never the key', async () => {
      await start();
      const { id, key } = await createKey(admin);
      await authed(http, admin).delete(`/api/auth/api-keys/${id}`).expect(204);

      const audit = await dataSource.query<{ action: string }[]>(
        'SELECT action, metadata FROM audit_log WHERE target_id = $1 ORDER BY occurred_at',
        [id]
      );

      expect(audit.map((entry) => entry.action)).toEqual([
        AUDIT_ACTION.API_KEY_CREATED,
        AUDIT_ACTION.API_KEY_REVOKED,
      ]);
      expect(JSON.stringify(audit)).not.toContain(key);
    });
  });

  describe('using a key', () => {
    it('signs requests in as the owner, accepts the scheme in any case, and sends no CSRF token', async () => {
      await start();
      const { key } = await createKey(admin);

      const me = await http.get('/api/auth/me').set('Authorization', bearer(key)).expect(200);
      expect(me.body.user.id).toBe(admin.user.id);
      expect(me.body.csrfToken).toBeNull();
      await http.get('/api/auth/me').set('Authorization', `bearer ${key}`).expect(200);
    });

    it('ignores the key in x-api-key and in the query string', async () => {
      await start();
      const { key } = await createKey(admin);

      await http.get('/api/auth/me').set('x-api-key', key).expect(401);
      await http.get(`/api/auth/me?api_key=${key}`).expect(401);
      await http.get(`/api/auth/me?token=${key}`).expect(401);
    });

    it('does not manage keys, passwords, sessions or accounts, not even for an admin', async () => {
      await start();
      const { id, key } = await createKey(admin);
      const call = (method: 'get' | 'post' | 'delete', url: string) =>
        http[method](url).set('Authorization', bearer(key));

      await call('get', '/api/auth/api-keys').expect(403);
      await call('post', '/api/auth/api-keys').send({ name: 'more' }).expect(403);
      await call('delete', `/api/auth/api-keys/${id}`).expect(403);
      await call('post', '/api/auth/password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'another long passphrase' })
        .expect(403);
      await call('post', '/api/auth/logout').expect(403);
      await call('get', '/api/users').expect(403);
    });

    it('stops working the moment it is revoked, and a second revoke answers 404', async () => {
      await start();
      const { id, key } = await createKey(admin);
      await http.get('/api/auth/me').set('Authorization', bearer(key)).expect(200);

      await authed(http, admin).delete(`/api/auth/api-keys/${id}`).expect(204);

      await http.get('/api/auth/me').set('Authorization', bearer(key)).expect(401);
      await authed(http, admin).delete(`/api/auth/api-keys/${id}`).expect(404);
      const list = await authed(http, admin).get('/api/auth/api-keys').expect(200);
      expect(list.body).toEqual([]);
    });

    it('stops working once it has expired', async () => {
      await start();
      const { id, key } = await createKey(admin, { name: 'short', expiresInDays: 1 });
      await dataSource.query(
        "UPDATE api_key SET expires_at = now() - interval '1 minute' WHERE id = $1",
        [id]
      );

      await http.get('/api/auth/me').set('Authorization', bearer(key)).expect(401);
    });

    it('follows the owner: disabled and deleted accounts get 401, a demoted pending account 403', async () => {
      await start();
      const ben = await member('ben@example.com');
      const cleo = await member('cleo@example.com');
      const dora = await member('dora@example.com');
      const benKey = (await createKey(ben)).key;
      const cleoKey = (await createKey(cleo)).key;
      const doraKey = (await createKey(dora)).key;

      await authed(http, admin)
        .patch(`/api/users/${ben.user.id}`)
        .send({ disabled: true })
        .expect(200);
      await authed(http, admin).delete(`/api/users/${cleo.user.id}`).expect(204);
      await authed(http, admin)
        .patch(`/api/users/${dora.user.id}`)
        .send({ role: USER_ROLE.PENDING })
        .expect(200);

      await http.get('/api/auth/me').set('Authorization', bearer(benKey)).expect(401);
      await http.get('/api/auth/me').set('Authorization', bearer(cleoKey)).expect(401);
      await http.get('/api/auth/me').set('Authorization', bearer(doraKey)).expect(403);
    });
  });

  describe("somebody else's keys (BOLA)", () => {
    it('are neither listed nor revocable, and keep working', async () => {
      await start();
      const ben = await member('ben@example.com');
      const adminKey = await createKey(admin);
      const benKey = await createKey(ben);

      const list = await authed(http, ben).get('/api/auth/api-keys').expect(200);
      const entries = list.body as { id: string }[];
      expect(entries.map((entry) => entry.id)).toEqual([benKey.id]);
      await authed(http, ben).delete(`/api/auth/api-keys/${adminKey.id}`).expect(404);

      await http.get('/api/auth/me').set('Authorization', bearer(adminKey.key)).expect(200);
    });

    it('answers 400 for a malformed id', async () => {
      await start();

      await authed(http, admin).delete('/api/auth/api-keys/not-a-uuid').expect(400);
    });
  });
});
