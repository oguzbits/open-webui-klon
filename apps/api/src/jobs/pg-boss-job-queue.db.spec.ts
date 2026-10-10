import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';
import pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { AppLoggerModule } from '../logging/logger.module.js';
import { BASE_TEST_ENV } from '../testing/create-test-app.js';
import { CHAT_JOB } from './job-names.js';
import { PgBossJobQueue } from './pg-boss-job-queue.js';

const NAME = CHAT_JOB.GENERATE_TITLE;

describe('PgBossJobQueue (database)', () => {
  let queue: PgBossJobQueue;
  let close: () => Promise<void>;

  afterEach(async () => {
    await close();
  });

  async function start(): Promise<void> {
    const module = await Test.createTestingModule({
      imports: [
        AppConfigModule.forRoot({
          raw: { ...BASE_TEST_ENV, DATABASE_URL: testDatabaseUrl() },
          ignoreEnvFile: true,
        }),
        AppLoggerModule,
      ],
      providers: [PgBossJobQueue],
    }).compile();
    await module.init();
    queue = module.get(PgBossJobQueue);
    close = () => module.close();
  }

  it('delivers a job to the worker and retries a failing one', async () => {
    await start();
    const seen: string[] = [];
    let attempts = 0;
    const tries: unknown[] = [];
    await queue.work(NAME, (data, attempt) => {
      attempts += 1;
      tries.push(attempt);
      if (attempts === 1) return Promise.reject(new Error('first attempt fails'));
      seen.push(data.chatId);
      return Promise.resolve();
    });

    await queue.send(NAME, { chatId: 'chat-1' });

    const deadline = Date.now() + 30_000;
    while (seen.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(seen).toEqual(['chat-1']);
    expect(attempts).toBe(2);
    // The handler learns which try it is on, so it can give up for good on the last one.
    expect(tries).toEqual([
      { retryCount: 0, retryLimit: 2 },
      { retryCount: 1, retryLimit: 2 },
    ]);
  }, 40_000);

  async function until(done: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (!(await done()) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(await done()).toBe(true);
  }

  it('keeps everything a failing handler carried out of the job table', async () => {
    await start();
    const chatId = randomUUID();
    let calls = 0;
    await queue.work(NAME, () => {
      calls += 1;
      // The AI SDK and the database driver attach request bodies and query parameters to their errors.
      return Promise.reject(
        Object.assign(new TypeError('failed with SECRET-TEXT'), {
          requestBodyValues: { input: ['SECRET-TEXT'] },
          errors: [{ parameters: ['SECRET-TEXT'] }],
        })
      );
    });
    await queue.send(NAME, { chatId });

    const client = new pg.Client({ connectionString: testDatabaseUrl() });
    await client.connect();
    try {
      await until(async () => {
        const result = await client.query<{ output: unknown }>(
          `SELECT output FROM pgboss.job WHERE name = $1 AND data->>'chatId' = $2 AND output IS NOT NULL`,
          [NAME, chatId]
        );
        return result.rows.length > 0;
      });
      const stored = await client.query<{ output: unknown }>(
        `SELECT output FROM pgboss.job WHERE name = $1 AND data->>'chatId' = $2`,
        [NAME, chatId]
      );
      expect(calls).toBeGreaterThan(0);
      expect(JSON.stringify(stored.rows)).not.toContain('SECRET-TEXT');
      expect(JSON.stringify(stored.rows)).toContain('TypeError');
    } finally {
      // Stop the worker first, or it keeps retrying the job; the table outlives the test database's schema reset.
      await close();
      close = () => Promise.resolve();
      await client.query(`DELETE FROM pgboss.job WHERE name = $1 AND data->>'chatId' = $2`, [
        NAME,
        chatId,
      ]);
      await client.end();
    }
  }, 40_000);

  it('knows whether a job for some data is still waiting or running', async () => {
    await start();
    const waiting = randomUUID();
    const other = randomUUID();
    await queue.send(NAME, { chatId: waiting });

    expect(await queue.hasLiveJob(NAME, { chatId: waiting })).toBe(true);
    expect(await queue.hasLiveJob(NAME, { chatId: other })).toBe(false);

    const seen: string[] = [];
    await queue.work(NAME, (data) => {
      seen.push(data.chatId);
      return Promise.resolve();
    });
    await until(() => Promise.resolve(seen.includes(waiting)));
    await until(async () => !(await queue.hasLiveJob(NAME, { chatId: waiting })));
  }, 40_000);
});
