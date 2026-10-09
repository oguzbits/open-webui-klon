import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import type { Env } from '../config/env.js';
import { REDACT_CENSOR, REDACT_PATHS } from './redact.js';
import { generateRequestId } from './request-id.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: generateRequestId,
          redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
          // Log method and path only: query strings can carry tokens.
          serializers: {
            req: (req: { id: string; method: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              path: req.url?.split('?')[0],
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
  ],
})
export class AppLoggerModule {}
