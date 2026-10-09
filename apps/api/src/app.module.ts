import { Module } from '@nestjs/common';

import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { AppLoggerModule } from './logging/logger.module.js';
import { SecurityModule } from './security/security.module.js';

@Module({ imports: [AppConfigModule.forRoot(), AppLoggerModule, CommonModule, SecurityModule] })
export class AppModule {}
