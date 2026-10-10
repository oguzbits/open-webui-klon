import { Test } from '@nestjs/testing';
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
    await queue.work(NAME, (data) => {
      attempts += 1;
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
  }, 40_000);
});
