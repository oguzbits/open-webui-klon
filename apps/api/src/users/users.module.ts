import { Module } from '@nestjs/common';

import { AuditModule } from '../database/audit/audit.module.js';
import { PasswordHasher } from './password-hasher.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuditModule],
  providers: [UsersService, PasswordHasher],
  exports: [UsersService, PasswordHasher],
})
export class UsersModule {}
