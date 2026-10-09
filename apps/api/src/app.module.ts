import { Module } from '@nestjs/common';

import { CommonModule } from './common/common.module.js';
import { AppConfigModule } from './config/app-config.module.js';
import { AppLoggerModule } from './logging/logger.module.js';

@Module({ imports: [AppConfigModule.forRoot(), AppLoggerModule, CommonModule] })
export class AppModule {}
