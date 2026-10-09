import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { PasswordHasher } from './password-hasher.js';
import { UsersService } from './users.service.js';

const DEFAULT_ADMIN_NAME = 'Admin';

/**
 * Optional first admin from ADMIN_EMAIL and ADMIN_PASSWORD. It only ever acts while the user table is empty,
 * so a variable that stays in the environment cannot add or reset an admin later. Nothing here logs the
 * email or the password.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly config: ConfigService<Env, true>
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get('ADMIN_EMAIL', { infer: true });
    const password = this.config.get('ADMIN_PASSWORD', { infer: true });
    if (email === undefined || password === undefined) return;

    const created = await this.users.bootstrapAdmin({
      email,
      name: this.config.get('ADMIN_NAME', { infer: true }) ?? DEFAULT_ADMIN_NAME,
      passwordHash: await this.hasher.hash(password),
    });
    if (created === null) {
      this.logger.warn(
        'ADMIN_EMAIL and ADMIN_PASSWORD are set but accounts exist: ignored. Remove them.'
      );
      return;
    }
    this.logger.log(
      `Created the first admin (user ${created.id}). Remove ADMIN_PASSWORD from the environment.`
    );
  }
}
