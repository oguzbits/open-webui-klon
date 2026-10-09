import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';

describe('AppModule wiring', () => {
  it('imports the auth and user modules', () => {
    const imports: unknown[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule);

    expect(imports).toEqual(expect.arrayContaining([AuthModule, UsersModule]));
  });

  it('registers the auth guard globally, so a route is closed unless it is marked public', () => {
    const providers: unknown[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuthModule);

    expect(providers).toContainEqual({ provide: APP_GUARD, useClass: AuthGuard });
  });
});
