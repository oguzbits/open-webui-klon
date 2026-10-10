import {
  type BeforeApplicationShutdown,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PgBoss } from 'pg-boss';

import type { Env } from '../config/env.js';
import type { ChatJobData, JobQueue } from './job-queue.js';

const RETRY_LIMIT = 2;
const RETRY_DELAY_SECONDS = 1;
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * pg-boss with its own small connection pool (it cannot share TypeORM's). It starts on the first use or at
 * application start, whichever comes first, so the order of the modules does not matter.
 */
@Injectable()
export class PgBossJobQueue implements JobQueue, OnApplicationBootstrap, BeforeApplicationShutdown {
  private boss: Promise<PgBoss> | undefined;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(PgBossJobQueue.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.started();
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.boss === undefined) return;
    const boss = await this.boss;
    await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
  }

  async send(name: string, data: ChatJobData): Promise<void> {
    const boss = await this.started();
    await boss.createQueue(name);
    await boss.send(name, data, {
      retryLimit: RETRY_LIMIT,
      retryDelay: RETRY_DELAY_SECONDS,
      retryBackoff: true,
    });
  }

  async work(name: string, handler: (data: ChatJobData) => Promise<void>): Promise<void> {
    const boss = await this.started();
    await boss.createQueue(name);
    await boss.work<ChatJobData>(name, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }

  private started(): Promise<PgBoss> {
    this.boss ??= this.start();
    return this.boss;
  }

  private async start(): Promise<PgBoss> {
    const boss = new PgBoss({
      connectionString: this.config.get('DATABASE_URL', { infer: true }),
      max: 3,
    });
    boss.on('error', (error: Error) => {
      this.logger.error({ errorName: error.name, msg: 'pg-boss error' });
    });
    await boss.start();
    return boss;
  }
}
