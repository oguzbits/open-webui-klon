import { Module } from '@nestjs/common';

import { AuditModule } from '../database/audit/audit.module.js';
import { AdminBootstrapService } from './admin-bootstrap.service.js';
import { PasswordHasher } from './password-hasher.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuditModule],
  controllers: [UsersController],
  providers: [UsersService, PasswordHasher, AdminBootstrapService],
  exports: [UsersService, PasswordHasher],
})
export class UsersModule {}
