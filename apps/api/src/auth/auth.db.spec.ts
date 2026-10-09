import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import {
  authed,
  cookieFrom,
  type Http,
  loginUser,
  signupUser,
  TEST_PASSWORD,
} from '../testing/http-session.js';
import { PasswordHasher } from '../users/password-hasher.js';
import { User } from '../users/user.entity.js';
import { USER_ROLE } from '../users/user-role.js';

const NEW_PASSWORD = 'another long passphrase';
const ADA = 'ada@example.com';

describe('auth flows (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  async function start(env: Record<string, string> = {}): Promise<Http> {
    app = await createDbTestApp(testDatabaseUrl(), env);
    dataSource = app.get(DataSource);
    return request(app.getHttpServer());
  }

  describe('signup', () => {
    it('makes the first account an admin and signs it in', async () => {
      const http = await start();

      const response = await http
        .post('/api/auth/signup')
        .send({ email: ' Ada@Example.com ', name: 'Ada', password: TEST_PASSWORD })
        .expect(201);

      expect(response.body.user).toMatchObject({
        email: ADA,
        name: 'Ada',
        role: USER_ROLE.ADMIN,
        disabled: false,
      });
      expect(JSON.stringify(response.body)).not.toMatch(/hash|argon/i);
      const me = await http.get('/api/auth/me').set('Cookie', cookieFrom(response)).expect(200);
      expect(me.body.user.id).toBe(response.body.user.id);
      expect(me.body.csrfToken).toBe(response.body.csrfToken);
    });

    it('sets a httpOnly, SameSite=Lax cookie that expires, and no Secure flag over plain http', async () => {
      const http = await start();

      const response = await http
        .post('/api/auth/signup')
        .send({ email: ADA, name: 'Ada', password: TEST_PASSWORD });

      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toMatch(/^session=/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Expires=');
      expect(cookie).not.toContain('Secure');
    });

    it('adds Secure when the public origin is https', async () => {
      const http = await start({ PUBLIC_ORIGIN: 'https://chat.example.com' });

      const response = await http
        .post('/api/auth/signup')
        .send({ email: ADA, name: 'Ada', password: TEST_PASSWORD });

      expect(String(response.headers['set-cookie'])).toContain('Secure');
    });

    it('parks later accounts as pending by default and uses DEFAULT_USER_ROLE when set', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });
      const bob = await signupUser(http, { email: 'bob@example.com' });
      expect(bob.user.role).toBe(USER_ROLE.PENDING);
      await authed(http, bob).get('/api/auth/me').expect(200);

      const open = await start({ DEFAULT_USER_ROLE: 'user' });
      await signupUser(open, { email: ADA });
      const carl = await signupUser(open, { email: 'carl@example.com' });
      expect(carl.user.role).toBe(USER_ROLE.USER);
    });

    it('lets the first account in even when sign-up is off, then closes the door', async () => {
      const http = await start({ ENABLE_SIGNUP: 'false' });

      const first = await signupUser(http, { email: ADA });

      expect(first.user.role).toBe(USER_ROLE.ADMIN);
      await http
        .post('/api/auth/signup')
        .send({ email: 'bob@example.com', name: 'Bob', password: TEST_PASSWORD })
        .expect(403);
    });

    it('rejects the same email in another case with 409', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });

      await http
        .post('/api/auth/signup')
        .send({ email: 'ADA@example.com ', name: 'Ada', password: TEST_PASSWORD })
        .expect(409);
    });

    const valid = { email: ADA, name: 'Ada', password: TEST_PASSWORD };
    it.each([
      ['an invalid email', { ...valid, email: 'not-an-email' }],
      ['a password below the minimum', { ...valid, password: 'short' }],
      ['a password above the maximum', { ...valid, password: 'x'.repeat(129) }],
      ['a missing name', { ...valid, name: undefined }],
      ['a blank name', { ...valid, name: '   ' }],
      ['a role in the payload (mass assignment)', { ...valid, role: 'admin' }],
    ])('rejects %s with 400 and creates nothing', async (_name, body) => {
      const http = await start();

      await http.post('/api/auth/signup').send(body).expect(400);

      expect(await dataSource.getRepository(User).count()).toBe(0);
    });

    it('answers 413, not 500, for an enormous body', async () => {
      const http = await start();

      await http
        .post('/api/auth/signup')
        .send({ ...valid, password: 'x'.repeat(200_000) })
        .expect(413);
    });

    it('limits sign-ups per address', async () => {
      const http = await start({ LOGIN_MAX_ATTEMPTS: '1' });

      for (let index = 0; index < 5; index += 1) {
        await signupUser(http, { email: `person${index}@example.com` });
      }

      await http
        .post('/api/auth/signup')
        .send({ email: 'one-too-many@example.com', name: 'X', password: TEST_PASSWORD })
        .expect(429);
    });

    it('stores only an Argon2id hash and audits without personal data', async () => {
      const http = await start();

      const ada = await signupUser(http, { email: ADA });

      const [row] = await dataSource.query<{ password_hash: string }[]>(
        'SELECT password_hash FROM app_user'
      );
      expect(row?.password_hash.startsWith('$argon2id$')).toBe(true);
      expect(row?.password_hash).not.toContain(TEST_PASSWORD);
      const audit = await dataSource.query<{ action: string }[]>(
        'SELECT action, metadata FROM audit_log WHERE actor_id = $1',
        [ada.user.id]
      );
      expect(audit.map((entry) => entry.action)).toEqual([AUDIT_ACTION.AUTH_SIGNUP]);
      expect(JSON.stringify(audit)).not.toContain(TEST_PASSWORD);
      expect(JSON.stringify(audit)).not.toContain(ADA);
    });
  });

  describe('login', () => {
    it('signs in with the right password, whatever the email case', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });

      const login = await loginUser(http, ' ADA@example.com', TEST_PASSWORD);

      await authed(http, login).get('/api/auth/me').expect(200);
    });

    it('replaces the session cookie the request came with', async () => {
      const http = await start();
      const first = await signupUser(http, { email: ADA });

      const response = await http
        .post('/api/auth/login')
        .set('Cookie', first.cookie)
        .send({ email: ADA, password: TEST_PASSWORD })
        .expect(200);

      expect(cookieFrom(response)).not.toBe(first.cookie);
      await authed(http, first).get('/api/auth/me').expect(401);
      await http.get('/api/auth/me').set('Cookie', cookieFrom(response)).expect(200);
    });

    it('answers unknown email, wrong password and disabled account identically', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });
      await signupUser(http, { email: 'bob@example.com' });
      await dataSource.query(
        "UPDATE app_user SET disabled_at = now() WHERE email = 'bob@example.com'"
      );

      const unknown = await http
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: TEST_PASSWORD });
      const wrong = await http
        .post('/api/auth/login')
        .send({ email: ADA, password: 'wrong password!' });
      const disabled = await http
        .post('/api/auth/login')
        .send({ email: 'bob@example.com', password: TEST_PASSWORD });

      for (const response of [unknown, wrong, disabled]) {
        expect(response.status).toBe(401);
        expect(response.body.title).toBe(wrong.body.title);
        expect(response.body.detail).toBe(wrong.body.detail);
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    });

    it('still runs a password check for an unknown email', async () => {
      const http = await start();
      const verify = vi.spyOn(PasswordHasher.prototype, 'verify');

      await http
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: TEST_PASSWORD })
        .expect(401);

      expect(verify).toHaveBeenCalledTimes(1);
    });

    it('lets a pending account sign in', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });
      await signupUser(http, { email: 'bob@example.com' });

      const login = await loginUser(http, 'bob@example.com', TEST_PASSWORD);

      expect(login.user.role).toBe(USER_ROLE.PENDING);
    });

    it('blocks an email after repeated failures, known or not, even for the right password', async () => {
      const http = await start({ LOGIN_MAX_ATTEMPTS: '3' });
      await signupUser(http, { email: ADA });

      for (const email of [ADA, 'nobody@example.com']) {
        for (let index = 0; index < 3; index += 1) {
          await http
            .post('/api/auth/login')
            .send({ email, password: 'wrong password!' })
            .expect(401);
        }
        await http.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(429);
      }
    });

    it('clears the failure counter after a successful login', async () => {
      const http = await start({ LOGIN_MAX_ATTEMPTS: '3' });
      await signupUser(http, { email: ADA });
      for (let index = 0; index < 2; index += 1) {
        await http
          .post('/api/auth/login')
          .send({ email: ADA, password: 'wrong password!' })
          .expect(401);
      }
      await loginUser(http, ADA, TEST_PASSWORD);

      for (let index = 0; index < 2; index += 1) {
        await http
          .post('/api/auth/login')
          .send({ email: ADA, password: 'wrong password!' })
          .expect(401);
      }
    });

    it.each([
      ['a password above the maximum', { email: ADA, password: 'x'.repeat(129) }, 400],
      ['an empty password', { email: ADA, password: '' }, 400],
      ['no email', { password: TEST_PASSWORD }, 400],
      ['an enormous body', { email: ADA, password: 'x'.repeat(200_000) }, 413],
    ])('answers %s with %i, never 500', async (_name, body, status) => {
      const http = await start();

      await http.post('/api/auth/login').send(body).expect(status);
    });

    it('audits failures and successes without personal data', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });
      await http
        .post('/api/auth/login')
        .send({ email: ADA, password: 'wrong password!' })
        .expect(401);
      await loginUser(http, ADA, TEST_PASSWORD);

      const audit = await dataSource.query<{ action: string }[]>(
        'SELECT action, metadata FROM audit_log WHERE actor_id = $1 ORDER BY occurred_at',
        [ada.user.id]
      );

      expect(audit.map((entry) => entry.action)).toEqual([
        AUDIT_ACTION.AUTH_SIGNUP,
        AUDIT_ACTION.AUTH_LOGIN_FAILED,
        AUDIT_ACTION.AUTH_LOGIN,
      ]);
      expect(JSON.stringify(audit)).not.toContain('wrong password!');
    });
  });

  describe('logout', () => {
    it('ends the session and clears the cookie', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });

      const response = await authed(http, ada).post('/api/auth/logout').expect(204);

      expect(String(response.headers['set-cookie'])).toMatch(/session=;/);
      await authed(http, ada).get('/api/auth/me').expect(401);
    });

    it('needs the CSRF token and a session', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });

      await http.post('/api/auth/logout').set('Cookie', ada.cookie).expect(403);
      await authed(http, ada).get('/api/auth/me').expect(200);
      await http.post('/api/auth/logout').expect(401);
    });
  });

  describe('me', () => {
    it('is closed to anonymous callers', async () => {
      const http = await start();

      await http.get('/api/auth/me').expect(401);
    });
  });

  describe('password change', () => {
    it('changes the password, keeps this session and signs the others out', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });
      const other = await loginUser(http, ADA, TEST_PASSWORD);

      await authed(http, ada)
        .post('/api/auth/password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(204);

      await authed(http, ada).get('/api/auth/me').expect(200);
      await authed(http, other).get('/api/auth/me').expect(401);
      await http.post('/api/auth/login').send({ email: ADA, password: TEST_PASSWORD }).expect(401);
      await loginUser(http, ADA, NEW_PASSWORD);
    });

    it('refuses a wrong current password with 400 and changes nothing', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });

      await authed(http, ada)
        .post('/api/auth/password')
        .send({ currentPassword: 'not my password', newPassword: NEW_PASSWORD })
        .expect(400);

      await loginUser(http, ADA, TEST_PASSWORD);
    });

    it('refuses a new password below the minimum', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });

      await authed(http, ada)
        .post('/api/auth/password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' })
        .expect(400);
    });

    it('is not available to pending accounts', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });
      const bob = await signupUser(http, { email: 'bob@example.com' });

      await authed(http, bob)
        .post('/api/auth/password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(403);
    });
  });
});
