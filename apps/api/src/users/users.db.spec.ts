import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ApiKeyService } from '../auth/api-key.service.js';
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
import { USER_ROLE } from './user-role.js';

const ADMIN = 'admin@example.com';
const NEW_PASSWORD = 'another long passphrase';

describe('users admin routes (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let admin: Login;

  afterEach(async () => {
    await app.close();
  });

  /** The first account is the admin; every later one waits as "pending" and is promoted by the helper. */
  async function start(env: Record<string, string> = {}): Promise<void> {
    app = await createDbTestApp(testDatabaseUrl(), env);
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    admin = await signupUser(http, { email: ADMIN });
  }

  async function memberWith(email: string, role: string): Promise<Login> {
    const login = await signupUser(http, { email });
    await authed(http, admin).patch(`/api/users/${login.user.id}`).send({ role }).expect(200);
    return loginUser(http, email, TEST_PASSWORD);
  }

  describe('access', () => {
    const routes = [
      ['get', '/api/users'],
      ['post', '/api/users'],
      ['patch', `/api/users/${randomUUID()}`],
      ['post', `/api/users/${randomUUID()}/password`],
      ['delete', `/api/users/${randomUUID()}`],
    ] as const;

    it.each(routes)('%s %s refuses anonymous callers with 401', async (method, url) => {
      await start();

      await http[method](url).expect(401);
    });

    it.each(routes)('%s %s refuses a normal user with 403', async (method, url) => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      await authed(http, ben)[method](url).expect(403);
    });

    it.each(routes)('%s %s refuses a pending account with 403', async (method, url) => {
      await start();
      const pending = await signupUser(http, { email: 'pending@example.com' });

      await authed(http, pending)[method](url).expect(403);
    });

    it.each(routes)('%s %s refuses an admin API key with 403', async (method, url) => {
      await start({ ENABLE_API_KEYS: 'true' });
      const { key } = await app.get(ApiKeyService).create(admin.user.id, 'ci');

      await http[method](url).set('Authorization', `Bearer ${key}`).expect(403);
    });

    it('refuses an admin whose account was disabled in the meantime', async () => {
      await start();
      const second = await memberWith('second@example.com', USER_ROLE.ADMIN);
      await authed(http, admin)
        .patch(`/api/users/${second.user.id}`)
        .send({ disabled: true })
        .expect(200);

      await authed(http, second).get('/api/users').expect(401);
    });
  });

  describe('list', () => {
    it('shows every account without secrets', async () => {
      await start();
      await signupUser(http, { email: 'pending@example.com' });

      const response = await authed(http, admin).get('/api/users').expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toMatchObject({
        email: ADMIN,
        role: USER_ROLE.ADMIN,
        disabled: false,
      });
      expect(JSON.stringify(response.body)).not.toMatch(/hash|argon|csrf/i);
    });
  });

  describe('create', () => {
    it('creates an account that can sign in right away, and audits it', async () => {
      await start();

      const response = await authed(http, admin)
        .post('/api/users')
        .send({
          email: ' Cleo@Example.com',
          name: 'Cleo',
          password: NEW_PASSWORD,
          role: USER_ROLE.USER,
        })
        .expect(201);

      expect(response.body).toMatchObject({ email: 'cleo@example.com', role: USER_ROLE.USER });
      await loginUser(http, 'cleo@example.com', NEW_PASSWORD);
      const audit = await dataSource.query<{ action: string; target_id: string }[]>(
        'SELECT action, target_id FROM audit_log WHERE action = $1 AND target_id = $2',
        [AUDIT_ACTION.USER_CREATED, response.body.id]
      );
      expect(audit).toEqual([{ action: AUDIT_ACTION.USER_CREATED, target_id: response.body.id }]);
    });

    it('works even when public sign-up is off', async () => {
      await start({ ENABLE_SIGNUP: 'false' });

      await authed(http, admin)
        .post('/api/users')
        .send({
          email: 'cleo@example.com',
          name: 'Cleo',
          password: NEW_PASSWORD,
          role: USER_ROLE.USER,
        })
        .expect(201);
    });

    it('rejects a taken email (any case) with 409', async () => {
      await start();

      await authed(http, admin)
        .post('/api/users')
        .send({
          email: 'ADMIN@example.com',
          name: 'Twin',
          password: NEW_PASSWORD,
          role: USER_ROLE.USER,
        })
        .expect(409);
    });

    const valid = { email: 'cleo@example.com', name: 'Cleo', password: NEW_PASSWORD, role: 'user' };
    it.each([
      ['an unknown role', { ...valid, role: 'superuser' }],
      ['a missing role', { ...valid, role: undefined }],
      ['a short password', { ...valid, password: 'short' }],
      ['an extra field', { ...valid, disabledAt: null }],
    ])('rejects %s with 400', async (_name, body) => {
      await start();

      await authed(http, admin).post('/api/users').send(body).expect(400);
    });
  });

  describe('update', () => {
    it('approves a pending account, and the change counts on its very next request', async () => {
      await start();
      const pending = await signupUser(http, { email: 'pending@example.com' });
      await authed(http, pending).get('/api/auth/me').expect(200);

      await authed(http, admin)
        .patch(`/api/users/${pending.user.id}`)
        .send({ role: USER_ROLE.USER })
        .expect(200);

      const me = await authed(http, pending).get('/api/auth/me').expect(200);
      expect(me.body.user.role).toBe(USER_ROLE.USER);
    });

    it('renames an account', async () => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      const response = await authed(http, admin)
        .patch(`/api/users/${ben.user.id}`)
        .send({ name: '  Benedikt ' })
        .expect(200);

      expect(response.body.name).toBe('Benedikt');
    });

    it('disabling signs the account out at once, enabling lets it sign in again', async () => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      await authed(http, admin)
        .patch(`/api/users/${ben.user.id}`)
        .send({ disabled: true })
        .expect(200);

      await authed(http, ben).get('/api/auth/me').expect(401);
      await http
        .post('/api/auth/login')
        .send({ email: 'ben@example.com', password: TEST_PASSWORD })
        .expect(401);
      await authed(http, admin)
        .patch(`/api/users/${ben.user.id}`)
        .send({ disabled: false })
        .expect(200);
      await loginUser(http, 'ben@example.com', TEST_PASSWORD);
    });

    it('protects the last active admin from demotion and from being disabled', async () => {
      await start();

      await authed(http, admin)
        .patch(`/api/users/${admin.user.id}`)
        .send({ role: USER_ROLE.USER })
        .expect(409);
      await authed(http, admin)
        .patch(`/api/users/${admin.user.id}`)
        .send({ disabled: true })
        .expect(409);

      await authed(http, admin).get('/api/users').expect(200);
    });

    it('keeps at least one admin when two admins demote each other at the same time', async () => {
      await start();
      const second = await memberWith('second@example.com', USER_ROLE.ADMIN);

      const results = await Promise.all([
        authed(http, admin).patch(`/api/users/${second.user.id}`).send({ role: USER_ROLE.USER }),
        authed(http, second).patch(`/api/users/${admin.user.id}`).send({ role: USER_ROLE.USER }),
      ]);

      // The loser is refused by the service (409) or, when the winner committed before its guard ran, by the
      // guard (403). Either way exactly one demotion happens; the service-level race has its own test.
      const statuses = results.map((result) => result.status).sort();
      expect(statuses[0]).toBe(200);
      expect([403, 409]).toContain(statuses[1]);
      const admins = await dataSource.query<{ count: string }[]>(
        "SELECT count(*) FROM app_user WHERE role = 'admin' AND disabled_at IS NULL"
      );
      expect(admins[0]?.count).toBe('1');
    });

    it.each([
      ['an unknown role', { role: 'root' }],
      ['an email change', { email: 'new@example.com' }],
      ['a password', { password: NEW_PASSWORD }],
      ['a non-boolean disabled flag', { disabled: 'yes' }],
      ['a blank name', { name: '  ' }],
    ])('rejects %s with 400', async (_name, body) => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      await authed(http, admin).patch(`/api/users/${ben.user.id}`).send(body).expect(400);
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      await start();

      await authed(http, admin).patch(`/api/users/${randomUUID()}`).send({ name: 'X' }).expect(404);
      await authed(http, admin).patch('/api/users/not-a-uuid').send({ name: 'X' }).expect(400);
    });

    it('audits role changes and disabling without personal data', async () => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);
      await authed(http, admin)
        .patch(`/api/users/${ben.user.id}`)
        .send({ disabled: true })
        .expect(200);

      const audit = await dataSource.query<{ action: string }[]>(
        "SELECT action, metadata FROM audit_log WHERE target_id = $1 AND action LIKE 'user.%' ORDER BY occurred_at",
        [ben.user.id]
      );

      expect(audit.map((entry) => entry.action)).toEqual([
        AUDIT_ACTION.USER_ROLE_CHANGED,
        AUDIT_ACTION.USER_DISABLED,
      ]);
      expect(JSON.stringify(audit)).not.toContain('ben@example.com');
    });
  });

  describe('set password', () => {
    it('sets a new password and signs the account out everywhere', async () => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      await authed(http, admin)
        .post(`/api/users/${ben.user.id}/password`)
        .send({ password: NEW_PASSWORD })
        .expect(204);

      await authed(http, ben).get('/api/auth/me').expect(401);
      await http
        .post('/api/auth/login')
        .send({ email: 'ben@example.com', password: TEST_PASSWORD })
        .expect(401);
      await loginUser(http, 'ben@example.com', NEW_PASSWORD);
    });

    it('rejects a short password with 400 and an unknown account with 404', async () => {
      await start();

      await authed(http, admin)
        .post(`/api/users/${admin.user.id}/password`)
        .send({ password: 'short' })
        .expect(400);
      await authed(http, admin)
        .post(`/api/users/${randomUUID()}/password`)
        .send({ password: NEW_PASSWORD })
        .expect(404);
    });
  });

  describe('delete', () => {
    it('deletes an account with its sessions', async () => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      await authed(http, admin).delete(`/api/users/${ben.user.id}`).expect(204);

      await authed(http, ben).get('/api/auth/me').expect(401);
      const rows = await dataSource.query<unknown[]>('SELECT 1 FROM app_user WHERE id = $1', [
        ben.user.id,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('protects the last active admin and answers 404 for an unknown id', async () => {
      await start();

      await authed(http, admin).delete(`/api/users/${admin.user.id}`).expect(409);
      await authed(http, admin).delete(`/api/users/${randomUUID()}`).expect(404);
    });

    it('may remove an admin when another active one remains', async () => {
      await start();
      const second = await memberWith('second@example.com', USER_ROLE.ADMIN);

      await authed(http, second).delete(`/api/users/${admin.user.id}`).expect(204);
    });
  });
});
