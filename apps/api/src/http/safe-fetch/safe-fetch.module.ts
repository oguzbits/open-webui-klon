import { Module } from '@nestjs/common';

import { SAFE_FETCH_DEFAULTS, SAFE_FETCH_OPTIONS, SafeFetchService } from './safe-fetch.service.js';

@Module({
  providers: [{ provide: SAFE_FETCH_OPTIONS, useValue: SAFE_FETCH_DEFAULTS }, SafeFetchService],
  exports: [SafeFetchService],
})
export class SafeFetchModule {}
