import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

import type { Env } from './config/env.js';
import { applyHttpSecurity } from './security/http-security.js';

export const API_PREFIX = 'api';

/** HTTP-level setup shared by main.ts and the tests. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.setGlobalPrefix(API_PREFIX);
  applyHttpSecurity(app, {
    PUBLIC_ORIGIN: config.get('PUBLIC_ORIGIN', { infer: true }),
    CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
    TRUST_PROXY_HOPS: config.get('TRUST_PROXY_HOPS', { infer: true }),
  });
  app.enableShutdownHooks();
}
