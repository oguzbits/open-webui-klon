import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';

describe('health endpoints behind the global auth guard (database)', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  it('answer without a login, because Docker and the proxy cannot sign in', async () => {
    app = await createDbTestApp(testDatabaseUrl());
    const http = request(app.getHttpServer());

    await http.get('/api/health/live').expect(200);
    await http.get('/api/health/ready').expect(200);
  });
});
