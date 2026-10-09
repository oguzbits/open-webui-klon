import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';

import { configureApp } from '../app.factory.js';
import { CommonModule } from '../common/common.module.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { AppLoggerModule } from '../logging/logger.module.js';
import { SecurityModule } from '../security/security.module.js';

export const BASE_TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  LOG_LEVEL: 'silent',
  PUBLIC_ORIGIN: 'http://app.test',
  CORS_ORIGINS: 'http://dev.test',
  SHUTDOWN_DRAIN_MS: '0',
};

export interface TestAppOptions {
  env?: Record<string, string>;
  imports?: ModuleMetadata['imports'];
  controllers?: ModuleMetadata['controllers'];
  providers?: ModuleMetadata['providers'];
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/** Boots the same HTTP setup as main.ts, without a database. */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot({ raw: { ...BASE_TEST_ENV, ...options.env }, ignoreEnvFile: true }),
      AppLoggerModule,
      CommonModule,
      SecurityModule,
      ...(options.imports ?? []),
    ],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  });
  if (options.configure) builder = options.configure(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
