import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { type Http, signupUser } from '../testing/http-session.js';

describe('public auth config (database)', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  async function start(env: Record<string, string> = {}): Promise<Http> {
    app = await createDbTestApp(testDatabaseUrl(), env);
    return request(app.getHttpServer());
  }

  it('answers without a login, sets no cookie and exposes exactly three flags', async () => {
    const http = await start();

    const response = await http.get('/api/auth/config').expect(200);

    expect(response.body).toStrictEqual({
      apiKeysEnabled: false,
      onboarding: true,
      signupEnabled: true,
    });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('asks for the first account while none exists, even with sign-up switched off', async () => {
    const http = await start({ ENABLE_SIGNUP: 'false' });

    const response = await http.get('/api/auth/config').expect(200);

    expect(response.body).toEqual({ onboarding: true, signupEnabled: true, apiKeysEnabled: false });
  });

  it('follows ENABLE_SIGNUP once an account exists', async () => {
    const closed = await start({ ENABLE_SIGNUP: 'false' });
    await signupUser(closed, { email: 'ada@example.com' });
    const afterClosed = await closed.get('/api/auth/config').expect(200);
    expect(afterClosed.body).toMatchObject({ onboarding: false, signupEnabled: false });
    await app.close();

    const open = await start();
    await signupUser(open, { email: 'ada@example.com' });
    const afterOpen = await open.get('/api/auth/config').expect(200);
    expect(afterOpen.body).toMatchObject({ onboarding: false, signupEnabled: true });
  });

  it('reports whether API keys are switched on', async () => {
    const http = await start({ ENABLE_API_KEYS: 'true' });

    const response = await http.get('/api/auth/config').expect(200);

    expect(response.body.apiKeysEnabled).toBe(true);
  });
});
