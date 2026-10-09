import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.js';
import { parseAllowedHost } from './address-policy.js';
import {
  PROVIDER_FETCH_DEFAULTS,
  PROVIDER_FETCH_OPTIONS,
  type ProviderFetchOptions,
  ProviderFetchService,
} from './provider-fetch.service.js';
import { SAFE_FETCH_DEFAULTS, SAFE_FETCH_OPTIONS, SafeFetchService } from './safe-fetch.service.js';

@Module({
  providers: [
    { provide: SAFE_FETCH_OPTIONS, useValue: SAFE_FETCH_DEFAULTS },
    SafeFetchService,
    {
      provide: PROVIDER_FETCH_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ProviderFetchOptions => ({
        ...PROVIDER_FETCH_DEFAULTS,
        timeoutMs: config.get('PROVIDER_REQUEST_TIMEOUT_MS', { infer: true }),
        allowedHosts: config.get('PROVIDER_ALLOWED_HOSTS', { infer: true }).map(parseAllowedHost),
      }),
    },
    ProviderFetchService,
  ],
  exports: [SafeFetchService, ProviderFetchService],
})
export class SafeFetchModule {}
