import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller.js';
import { LifecycleService } from './lifecycle.service.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [LifecycleService],
})
export class HealthModule {}
