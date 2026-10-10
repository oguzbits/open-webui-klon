import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { configureApp } from '../app.factory.js';
import { AuthModule } from '../auth/auth.module.js';
import { ChatsModule } from '../chats/chats.module.js';
import { CommonModule } from '../common/common.module.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { AuditModule } from '../database/audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { HealthModule } from '../health/health.module.js';
import { JOB_QUEUE } from '../jobs/job-queue.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { AppLoggerModule } from '../logging/logger.module.js';
import { ModelsModule } from '../models/models.module.js';
import { SecurityModule } from '../security/security.module.js';
import { UsersModule } from '../users/users.module.js';
import { BASE_TEST_ENV } from './create-test-app.js';
import { resetChatTables } from './chat-fixtures.js';
import { resetAuthTables, resetProviderTables } from './db-fixtures.js';
import { resetKnowledgeTables } from './knowledge-fixtures.js';
import { FakeJobQueue } from './fake-job-queue.js';

export interface DbTestAppOptions {
  /** Empty the user and connection tables before the app starts (default). Turn off to test start-up against existing data. */
  resetUsers?: boolean;
  /** Swap providers (for example the logger) before the app is built. */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  /** The job queue: an in-memory fake (default) or the real pg-boss one. */
  jobs?: 'fake' | 'real';
}

/** The real modules against the test database. Limits are lifted so a test only hits the one it is about. */
export async function createDbTestApp(
  databaseUrl: string,
  env: Record<string, string> = {},
  options: DbTestAppOptions = {}
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot({
        raw: {
          ...BASE_TEST_ENV,
          DATABASE_URL: databaseUrl,
          RATE_LIMIT_LIMIT: '100000',
          LOGIN_MAX_ATTEMPTS: '1000',
          // The fake providers of the tests listen on loopback.
          PROVIDER_ALLOWED_HOSTS: '127.0.0.1',
          // Uploads of a test land in a directory of their own, never in the working directory.
          FILE_STORAGE_PATH: mkdtempSync(join(tmpdir(), 'owui-files-')),
          ...env,
        },
        ignoreEnvFile: true,
      }),
      AppLoggerModule,
      CommonModule,
      SecurityModule,
      DatabaseModule,
      AuditModule,
      UsersModule,
      AuthModule,
      ModelsModule,
      ChatsModule,
      KnowledgeModule,
      HealthModule,
    ],
  });
  if (options.configure) builder = options.configure(builder);
  if (options.jobs !== 'real')
    builder = builder.overrideProvider(JOB_QUEUE).useValue(new FakeJobQueue());
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  if (options.resetUsers !== false) {
    const dataSource = app.get(DataSource);
    await resetKnowledgeTables(dataSource);
    await resetChatTables(dataSource);
    await resetAuthTables(dataSource);
    await resetProviderTables(dataSource);
  }
  await app.init();
  return app;
}
