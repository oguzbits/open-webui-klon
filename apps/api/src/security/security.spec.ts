import { Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../testing/create-test-app.js';

@Controller()
class ProbeController {
  @Get('ping')
  ping(): { ok: true } {
    return { ok: true };
  }

  @Post('write')
  write(): { ok: true } {
    return { ok: true };
  }
}

describe('HTTP security', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  async function start(env: Record<string, string> = {}): Promise<ReturnType<typeof request>> {
    app = await createTestApp({
      controllers: [ProbeController],
      env: { RATE_LIMIT_LIMIT: '1000', ...env },
    });
    return request(app.getHttpServer());
  }

  describe('security headers', () => {
    it('sets a restrictive CSP, nosniff and hides the framework', async () => {
      const http = await start();

      const response = await http.get('/api/ping').expect(200);

      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('origin check for writing requests', () => {
    it('allows the public origin and the configured dev origin', async () => {
      const http = await start();

      await http.post('/api/write').set('Origin', 'http://app.test').expect(201);
      await http.post('/api/write').set('Origin', 'http://dev.test').expect(201);
    });

    it('allows requests without an Origin header (non-browser clients)', async () => {
      const http = await start();

      await http.post('/api/write').expect(201);
    });

    it.each(['http://evil.test', 'null', 'http://app.test.evil.test'])(
      'rejects a POST from origin %s with problem details',
      async (origin) => {
        const http = await start();

        const response = await http.post('/api/write').set('Origin', origin).expect(403);

        expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
      }
    );

    it('does not check safe methods', async () => {
      const http = await start();

      await http.get('/api/ping').set('Origin', 'http://evil.test').expect(200);
    });
  });

  describe('CORS', () => {
    it('answers a preflight from a listed origin with credentials allowed', async () => {
      const http = await start();

      const response = await http
        .options('/api/write')
        .set('Origin', 'http://dev.test')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe('http://dev.test');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it.each(['http://evil.test', 'null'])('sends no CORS headers to origin %s', async (origin) => {
      const http = await start();

      const response = await http
        .options('/api/write')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST');

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('rate limit', () => {
    it('answers requests over the limit with 429 problem details', async () => {
      const http = await start({ RATE_LIMIT_LIMIT: '2', RATE_LIMIT_WINDOW_SECONDS: '60' });

      await http.get('/api/ping').expect(200);
      await http.get('/api/ping').expect(200);
      const response = await http.get('/api/ping').expect(429);

      expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(response.body.status).toBe(429);
    });
  });
});
