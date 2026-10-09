import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestApp } from '../testing/create-test-app.js';
import { HealthModule } from './health.module.js';
import { LifecycleService } from './lifecycle.service.js';

const databaseUp = { pingCheck: (key: string) => Promise.resolve({ [key]: { status: 'up' } }) };
const databaseDown = {
  pingCheck: (key: string) => Promise.resolve({ [key]: { status: 'down' } }),
};

describe('health', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  async function start(
    database: typeof databaseUp,
    env: Record<string, string> = {}
  ): Promise<ReturnType<typeof request>> {
    app = await createTestApp({
      imports: [HealthModule],
      env,
      configure: (builder) => builder.overrideProvider(TypeOrmHealthIndicator).useValue(database),
    });
    return request(app.getHttpServer());
  }

  it('reports liveness without touching the database', async () => {
    const http = await start(databaseDown);

    const response = await http.get('/api/health/live').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('is ready when the database answers', async () => {
    const http = await start(databaseUp);

    const response = await http.get('/api/health/ready').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('is not ready when the database does not answer, while liveness stays green', async () => {
    const http = await start(databaseDown);

    const ready = await http.get('/api/health/ready').expect(503);
    await http.get('/api/health/live').expect(200);

    expect(ready.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('turns not ready as soon as shutdown begins, while liveness stays green', async () => {
    const http = await start(databaseUp);

    app.get(LifecycleService).onModuleDestroy();

    await http.get('/api/health/ready').expect(503);
    await http.get('/api/health/live').expect(200);
  });

  it('is exempt from the rate limit', async () => {
    const http = await start(databaseUp, { RATE_LIMIT_LIMIT: '2' });

    for (let i = 0; i < 6; i += 1) {
      await http.get('/api/health/live').expect(200);
    }
  });
});

describe('LifecycleService drain period', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the configured drain time before the server closes', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [LifecycleService, { provide: ConfigService, useValue: { get: () => 5000 } }],
    }).compile();
    const lifecycle = moduleRef.get(LifecycleService);
    vi.useFakeTimers();
    const finished = vi.fn();

    const pending = lifecycle.beforeApplicationShutdown().then(finished);
    await vi.advanceTimersByTimeAsync(4999);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(finished).toHaveBeenCalledOnce();
  });
});
