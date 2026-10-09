import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import type { Env } from '../config/env.js';
import { allowedOrigins } from './allowed-origins.js';

export function applyHttpSecurity(
  app: NestExpressApplication,
  env: Pick<Env, 'PUBLIC_ORIGIN' | 'CORS_ORIGINS' | 'TRUST_PROXY_HOPS'>
): void {
  // Behind Caddy the client address comes from X-Forwarded-For; hops = number of trusted proxies.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  // The API only returns JSON: nothing may be loaded or framed from its responses.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    })
  );
  // An explicit list (never "*" and never a reflected origin): cookies are sent along.
  app.enableCors({
    origin: allowedOrigins(env),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
}
