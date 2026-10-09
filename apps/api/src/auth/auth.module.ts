import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../database/audit/audit.module.js';
import { UsersModule } from '../users/users.module.js';
import { ApiKey } from './api-key.entity.js';
import { ApiKeyService } from './api-key.service.js';
import { AttemptLimiter } from './attempt-limiter.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { Session } from './session.entity.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Session, ApiKey]), UsersModule, AuditModule],
  controllers: [AuthController],
  providers: [
    SessionService,
    ApiKeyService,
    AttemptLimiter,
    AuthService,
    // Global and closed by default: every route needs a login unless it is marked @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
