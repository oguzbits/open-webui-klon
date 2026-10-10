import { Module } from '@nestjs/common';

import { JOB_QUEUE } from './job-queue.js';
import { PgBossJobQueue } from './pg-boss-job-queue.js';

@Module({
  providers: [PgBossJobQueue, { provide: JOB_QUEUE, useExisting: PgBossJobQueue }],
  exports: [JOB_QUEUE],
})
export class JobsModule {}
