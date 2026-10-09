import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { configureApp } from '../app.factory.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommonModule } from '../common/common.module.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { AuditModule } from '../database/audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { HealthModule } from '../health/health.module.js';
import { AppLoggerModule } from '../logging/logger.module.js';
import { SecurityModule } from '../security/security.module.js';
import { UsersModule } from '../users/users.module.js';
import { BASE_TEST_ENV } from './create-test-app.js';
import { resetAuthTables } from './db-fixtures.js';

export interface DbTestAppOptions {
  /** Empty the user tables before the app starts (default). Turn off to test start-up against existing data. */
  resetUsers?: boolean;
}

/** The real modules against the test database. Limits are lifted so a test only hits the one it is about. */
export async function createDbTestApp(
  databaseUrl: string,
  env: Record<string, string> = {},
  options: DbTestAppOptions = {}
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot({
        raw: {
          ...BASE_TEST_ENV,
          DATABASE_URL: databaseUrl,
          RATE_LIMIT_LIMIT: '100000',
          LOGIN_MAX_ATTEMPTS: '1000',
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
      HealthModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  if (options.resetUsers !== false) await resetAuthTables(app.get(DataSource));
  await app.init();
  return app;
}
