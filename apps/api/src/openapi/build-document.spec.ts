import type { NestExpressApplication } from '@nestjs/platform-express';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { afterEach, describe, expect, it } from 'vitest';

import { HealthModule } from '../health/health.module.js';
import { createTestApp } from '../testing/create-test-app.js';
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
});
