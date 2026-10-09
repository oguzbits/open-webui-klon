import { Module } from '@nestjs/common';

import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { AuditModule } from './database/audit/audit.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AppLoggerModule } from './logging/logger.module.js';
import { SecurityModule } from './security/security.module.js';

@Module({
  imports: [
    AppConfigModule.forRoot(),
    AppLoggerModule,
    CommonModule,
    SecurityModule,
    DatabaseModule,
    AuditModule,
  ],
})
export class AppModule {}
