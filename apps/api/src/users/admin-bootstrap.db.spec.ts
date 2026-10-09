import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { loginUser, signupUser } from '../testing/http-session.js';
import { USER_ROLE } from './user-role.js';

const ADMIN_ENV = {
  ADMIN_EMAIL: 'Root@Example.com',
  ADMIN_PASSWORD: 'a long admin passphrase',
};

describe('admin from the environment (database)', () => {
  const apps: NestExpressApplication[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function start(
    env: Record<string, string>,
    resetUsers = true
  ): Promise<{
    app: NestExpressApplication;
    http: ReturnType<typeof request>;
    dataSource: DataSource;
  }> {
    const app = await createDbTestApp(testDatabaseUrl(), env, { resetUsers });
    apps.push(app);
    return { app, http: request(app.getHttpServer()), dataSource: app.get(DataSource) };
  }

  it('creates the admin on the first start, with a default name, and the account can sign in', async () => {
    const { http } = await start(ADMIN_ENV);

    const login = await loginUser(http, 'root@example.com', ADMIN_ENV.ADMIN_PASSWORD);

    expect(login.user).toMatchObject({
      email: 'root@example.com',
      name: 'Admin',
      role: USER_ROLE.ADMIN,
    });
  });

  it('uses ADMIN_NAME when given', async () => {
    const { http } = await start({ ...ADMIN_ENV, ADMIN_NAME: 'Rita Root' });

    const login = await loginUser(http, 'root@example.com', ADMIN_ENV.ADMIN_PASSWORD);

    expect(login.user.name).toBe('Rita Root');
  });

  it('creates nothing without both values', async () => {
    const { dataSource } = await start({});

    expect(await dataSource.query('SELECT 1 FROM app_user')).toHaveLength(0);
  });

  it('is ignored once any account exists, so a leftover variable never adds an admin', async () => {
    const first = await start({});
    await signupUser(first.http, { email: 'ada@example.com' });
    await first.app.close();
    apps.length = 0;

    const { http, dataSource } = await start(ADMIN_ENV, false);

    const rows = await dataSource.query<{ email: string }[]>('SELECT email FROM app_user');
    expect(rows.map((row) => row.email)).toEqual(['ada@example.com']);
    await http
      .post('/api/auth/login')
      .send({ email: 'root@example.com', password: ADMIN_ENV.ADMIN_PASSWORD })
      .expect(401);
  });

  it('does not create a second admin or reset the password on a restart', async () => {
    const first = await start(ADMIN_ENV);
    await first.app.close();
    apps.length = 0;

    const { http, dataSource } = await start(
      { ...ADMIN_ENV, ADMIN_PASSWORD: 'a different passphrase' },
      false
    );

    expect(await dataSource.query('SELECT 1 FROM app_user')).toHaveLength(1);
    await loginUser(http, 'root@example.com', ADMIN_ENV.ADMIN_PASSWORD);
  });

  it('never writes the password or the email to the log', async () => {
    const written: unknown[] = [];
    for (const method of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        written.push(args);
      });
    }

    await start(ADMIN_ENV);

    expect(written.length).toBeGreaterThan(0);
    const text = JSON.stringify(written);
    expect(text).not.toContain(ADMIN_ENV.ADMIN_PASSWORD);
    expect(text.toLowerCase()).not.toContain('root@example.com');
  });
});
