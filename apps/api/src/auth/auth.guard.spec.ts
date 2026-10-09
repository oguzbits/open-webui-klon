import { randomUUID } from 'node:crypto';
import { Controller, Get, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../testing/create-test-app.js';
import { User } from '../users/user.entity.js';
import { USER_ROLE, type UserRole } from '../users/user-role.js';
import { ApiKey } from './api-key.entity.js';
import { ApiKeyService } from './api-key.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthContext } from './auth-context.js';
import {
  CurrentAuth,
  CurrentUser,
  AllowPending,
  Public,
  Roles,
  SessionOnly,
} from './decorators.js';
import { Session } from './session.entity.js';
import { SessionService } from './session.service.js';

@Controller()
class ProbeController {
  @Public()
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('private')
  privateRoute(): { ok: true } {
    return { ok: true };
  }

  @Get('whoami')
  whoami(@CurrentUser() user: User, @CurrentAuth() auth: AuthContext): object {
    return { id: user.id, viaKey: auth.apiKey !== null };
  }

  @AllowPending()
  @Get('pending-ok')
  pendingOk(): { ok: true } {
    return { ok: true };
  }

  @Roles(USER_ROLE.ADMIN)
  @Get('admin')
  admin(): { ok: true } {
    return { ok: true };
  }

  @SessionOnly()
  @Get('session-only')
  sessionOnly(): { ok: true } {
    return { ok: true };
  }

  @Post('write')
  write(): { ok: true } {
    return { ok: true };
  }
}

const API_KEY = `sk-${'a'.repeat(64)}`;
const PENDING_API_KEY = `sk-${'c'.repeat(64)}`;

function makeUser(role: UserRole, overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: randomUUID(),
    email: `${role}@example.com`,
    name: role,
    passwordHash: 'x',
    role,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function makeSession(user: User, csrfToken: string): Session {
  return Object.assign(new Session(), {
    id: randomUUID(),
    userId: user.id,
    user,
    tokenHash: 'h',
    csrfToken,
    expiresAt: new Date(Date.now() + 60_000),
    lastUsedAt: new Date(),
    createdAt: new Date(),
  });
}

describe('AuthGuard', () => {
  let app: NestExpressApplication;
  const sessions = new Map<string, Session>();
  const keys = new Map<string, ApiKey>();
  const users = {
    user: makeUser(USER_ROLE.USER),
    admin: makeUser(USER_ROLE.ADMIN),
    pending: makeUser(USER_ROLE.PENDING),
    disabled: makeUser(USER_ROLE.USER, { disabledAt: new Date() }),
  };

  beforeEach(() => {
    sessions.clear();
    keys.clear();
    for (const [name, user] of Object.entries(users)) {
      sessions.set(`tok-${name}`, makeSession(user, `csrf-${name}`));
    }
    keys.set(
      API_KEY,
      Object.assign(new ApiKey(), { id: randomUUID(), userId: users.admin.id, user: users.admin })
    );
    keys.set(
      PENDING_API_KEY,
      Object.assign(new ApiKey(), {
        id: randomUUID(),
        userId: users.pending.id,
        user: users.pending,
      })
    );
  });

  afterEach(async () => {
    await app.close();
  });

  async function start(env: Record<string, string> = {}): Promise<ReturnType<typeof request>> {
    app = await createTestApp({
      controllers: [ProbeController],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: SessionService,
          useValue: { resolve: (t: string) => Promise.resolve(sessions.get(t) ?? null) },
        },
        {
          provide: ApiKeyService,
          useValue: { resolve: (k: string) => Promise.resolve(keys.get(k) ?? null) },
        },
      ],
      env: { RATE_LIMIT_LIMIT: '1000', ENABLE_API_KEYS: 'true', ...env },
    });
    return request(app.getHttpServer());
  }

  describe('closed by default', () => {
    it('lets public routes through without credentials', async () => {
      const http = await start();

      await http.get('/api/open').expect(200);
    });

    it('answers 401 problem details on a route without any decorator', async () => {
      const http = await start();

      const response = await http.get('/api/private').expect(401);

      expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    });

    it.each([
      '',
      'session=',
      'session',
      ';',
      'other=1',
      'session="tok-user"',
      'session=; session=tok-user',
      'session=%ZZ',
      'session=unknown',
      `session=${'x'.repeat(5000)}`,
    ])('answers 401, never 500, for the cookie header %j', async (cookie) => {
      const http = await start();

      await http.get('/api/private').set('Cookie', cookie).expect(401);
    });
  });

  describe('session login', () => {
    it('accepts a valid session and exposes the user to handlers', async () => {
      const http = await start();

      const response = await http.get('/api/whoami').set('Cookie', 'session=tok-user').expect(200);

      expect(response.body).toEqual({ id: users.user.id, viaKey: false });
    });

    it('rejects a disabled account with 401 even when its session row survived', async () => {
      const http = await start();

      await http.get('/api/private').set('Cookie', 'session=tok-disabled').expect(401);
    });
  });

  describe('roles', () => {
    it('keeps pending accounts out of everything except routes marked AllowPending', async () => {
      const http = await start();

      await http.get('/api/private').set('Cookie', 'session=tok-pending').expect(403);
      await http.get('/api/pending-ok').set('Cookie', 'session=tok-pending').expect(200);
    });

    it('keeps pending accounts out even with an API key, also on routes marked AllowPending', async () => {
      const http = await start();

      await http
        .get('/api/pending-ok')
        .set('Authorization', `Bearer ${PENDING_API_KEY}`)
        .expect(403);
      await http.get('/api/private').set('Authorization', `Bearer ${PENDING_API_KEY}`).expect(403);
    });

    it('lets only admins into admin routes', async () => {
      const http = await start();

      await http.get('/api/admin').set('Cookie', 'session=tok-user').expect(403);
      await http.get('/api/admin').set('Cookie', 'session=tok-admin').expect(200);
    });
  });

  describe('csrf', () => {
    it('requires the matching X-CSRF-Token for writes made with a cookie', async () => {
      const http = await start();

      await http.post('/api/write').set('Cookie', 'session=tok-user').expect(403);
      await http
        .post('/api/write')
        .set('Cookie', 'session=tok-user')
        .set('X-CSRF-Token', 'csrf-admin')
        .expect(403);
      await http
        .post('/api/write')
        .set('Cookie', 'session=tok-user')
        .set('X-CSRF-Token', 'csrf-user')
        .expect(201);
    });

    it('does not ask for it on reads', async () => {
      const http = await start();

      await http.get('/api/private').set('Cookie', 'session=tok-user').expect(200);
    });
  });

  describe('api keys', () => {
    it('accepts a bearer key (scheme in any case) and needs no CSRF token', async () => {
      const http = await start();

      const response = await http
        .get('/api/whoami')
        .set('Authorization', `Bearer ${API_KEY}`)
        .expect(200);
      expect(response.body).toEqual({ id: users.admin.id, viaKey: true });
      await http.get('/api/private').set('Authorization', `bearer ${API_KEY}`).expect(200);
      await http.post('/api/write').set('Authorization', `Bearer ${API_KEY}`).expect(201);
    });

    it('never reaches admin routes or session-only routes, even with an admin key', async () => {
      const http = await start();

      await http.get('/api/admin').set('Authorization', `Bearer ${API_KEY}`).expect(403);
      await http.get('/api/session-only').set('Authorization', `Bearer ${API_KEY}`).expect(403);
    });

    it('is off while ENABLE_API_KEYS is false', async () => {
      const http = await start({ ENABLE_API_KEYS: 'false' });

      await http.get('/api/private').set('Authorization', `Bearer ${API_KEY}`).expect(401);
    });

    it.each([
      ['an unknown key', `Bearer sk-${'b'.repeat(64)}`],
      ['the wrong scheme', `Basic ${API_KEY}`],
      ['no key at all', 'Bearer'],
      ['a session token in the key slot', 'Bearer tok-admin'],
    ])('rejects %s with 401', async (_name, header) => {
      const http = await start();

      await http.get('/api/private').set('Authorization', header).expect(401);
    });

    it('ignores the key in x-api-key and in the query string', async () => {
      const http = await start();

      await http.get('/api/private').set('x-api-key', API_KEY).expect(401);
      await http.get(`/api/private?api_key=${API_KEY}`).expect(401);
    });

    it('does not fall back to the cookie when the Authorization header is wrong', async () => {
      const http = await start();

      await http
        .get('/api/private')
        .set('Authorization', 'Bearer sk-nope')
        .set('Cookie', 'session=tok-user')
        .expect(401);
    });
  });
});
