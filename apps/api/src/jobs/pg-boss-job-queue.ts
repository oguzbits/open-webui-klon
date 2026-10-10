import {
  type BeforeApplicationShutdown,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PgBoss } from 'pg-boss';

import type { Env } from '../config/env.js';
import type { JobName, JobPayload } from './job-names.js';
import type { JobAttempt, JobQueue } from './job-queue.js';

const RETRY_LIMIT = 2;
const RETRY_DELAY_SECONDS = 1;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const LIVE_STATES: readonly string[] = ['created', 'retry', 'active'];

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

  async send<N extends JobName>(name: N, data: JobPayload[N]): Promise<void> {
    const boss = await this.started();
    await boss.createQueue(name);
    await boss.send(name, data, {
      retryLimit: RETRY_LIMIT,
      retryDelay: RETRY_DELAY_SECONDS,
      retryBackoff: true,
    });
  }

  async work<N extends JobName>(
    name: N,
    handler: (data: JobPayload[N], attempt: JobAttempt) => Promise<void>
  ): Promise<void> {
    const boss = await this.started();
    await boss.createQueue(name);
    await boss.work<JobPayload[N], void, { includeMetadata: true }>(
      name,
      { includeMetadata: true },
      async (jobs) => {
        for (const job of jobs) {
          // pg-boss stores the thrown error in the job table, with every property it carries. Provider and
          // driver errors carry request bodies and query parameters, that is document and chat text. So only
          // the name goes on, and no `cause`.
          await handler(job.data, { retryCount: job.retryCount, retryLimit: job.retryLimit }).catch(
            (error: unknown) => {
              throw new Error(error instanceof Error ? error.name : 'unknown');
            }
          );
        }
      }
    );
  }

  async hasLiveJob<N extends JobName>(name: N, data: Partial<JobPayload[N]>): Promise<boolean> {
    const boss = await this.started();
    await boss.createQueue(name);
    const jobs = await boss.findJobs(name, { data });
    return jobs.some((job) => LIVE_STATES.includes(job.state));
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
