import type { NestExpressApplication } from '@nestjs/platform-express';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiKeyManagementService } from '../auth/api-key-management.service.js';
import { ApiKeysController } from '../auth/api-keys.controller.js';
import { AuthController } from '../auth/auth.controller.js';
import { AuthService } from '../auth/auth.service.js';
import { HealthModule } from '../health/health.module.js';
import { createTestApp } from '../testing/create-test-app.js';
import { PasswordHasher } from '../users/password-hasher.js';
import { UsersController } from '../users/users.controller.js';
import { UsersService } from '../users/users.service.js';
import { buildOpenApiDocument } from './build-document.js';

describe('buildOpenApiDocument', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  it('describes the health endpoints with stable operation ids', async () => {
    app = await createTestApp({
      imports: [HealthModule],
      configure: (builder) =>
        builder.overrideProvider(TypeOrmHealthIndicator).useValue({ pingCheck: () => ({}) }),
    });

    const document = buildOpenApiDocument(app);

    expect(document.paths['/api/health/live']?.get?.operationId).toBe('healthLive');
    expect(document.paths['/api/health/ready']?.get?.operationId).toBe('healthReady');
    expect(document.paths['/api/health/ready']?.get?.responses).toHaveProperty('503');
    expect(document.components?.schemas).toHaveProperty('HealthStatusDto');
  });

  it('describes the auth, api key and user routes with stable operation ids', async () => {
    // The controllers are built for real; their services stay empty because only the contract is read.
    app = await createTestApp({
      controllers: [AuthController, ApiKeysController, UsersController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: ApiKeyManagementService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: PasswordHasher, useValue: {} },
      ],
    });

    const document = buildOpenApiDocument(app);

    const operations = Object.entries(document.paths).flatMap(([path, item]) =>
      (['get', 'post', 'patch', 'delete'] as const).flatMap((method) => {
        const operation = item[method];
        return operation === undefined ? [] : [`${method} ${path} ${operation.operationId}`];
      })
    );
    expect(operations.sort()).toEqual(
      [
        'post /api/auth/signup authSignup',
        'post /api/auth/login authLogin',
        'post /api/auth/logout authLogout',
        'get /api/auth/me authMe',
        'get /api/auth/config authConfig',
        'post /api/auth/password authChangePassword',
        'get /api/auth/api-keys apiKeysList',
        'post /api/auth/api-keys apiKeysCreate',
        'delete /api/auth/api-keys/{id} apiKeysRevoke',
        'get /api/users usersList',
        'post /api/users usersCreate',
        'patch /api/users/{id} usersUpdate',
        'post /api/users/{id}/password usersSetPassword',
        'delete /api/users/{id} usersRemove',
      ].sort()
    );
    expect(document.components?.schemas).toHaveProperty('CreatedApiKeyDto');
    expect(JSON.stringify(document)).not.toMatch(/passwordHash|tokenHash|keyHash/);
  });
});
