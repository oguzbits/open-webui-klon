import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { ChatsModule } from './chats/chats.module.js';
import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { AuditModule } from './database/audit/audit.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { AppLoggerModule } from './logging/logger.module.js';
import { SecurityModule } from './security/security.module.js';
import { UsersModule } from './users/users.module.js';
import { ModelsModule } from './models/models.module.js';

@Module({
  imports: [
    AppConfigModule.forRoot(),
    AppLoggerModule,
    CommonModule,
    SecurityModule,
    DatabaseModule,
    AuditModule,
    UsersModule,
    AuthModule,
    ModelsModule,
    JobsModule,
    ChatsModule,
    HealthModule,
  ],
})
export class AppModule {}
