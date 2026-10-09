import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import type { Env } from '../config/env.js';
import { OriginCheckGuard } from './origin-check.guard.js';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl: config.get('RATE_LIMIT_WINDOW_SECONDS', { infer: true }) * 1000,
            limit: config.get('RATE_LIMIT_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginCheckGuard },
  ],
})
export class SecurityModule {}
