import { Body, Controller, Get, HttpException, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IsString, MaxLength } from 'class-validator';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { createTestApp } from '../testing/create-test-app.js';

class EchoDto {
  @IsString()
  @MaxLength(5)
  text!: string;
}

@Controller()
class ProbeController {
  @Post('echo')
  echo(@Body() dto: EchoDto): EchoDto {
    return dto;
  }

  @Get('boom')
  boom(): never {
    throw new Error('connection to postgresql://owui:hunter2@db failed');
  }

  @Get('teapot')
  teapot(): never {
    throw new HttpException('short and stout', 418);
  }

  @Get('provider')
  provider(): never {
    throw new ProviderError(
      PROVIDER_ERROR.UNREACHABLE,
      'connect ECONNREFUSED 10.0.0.5:11434 with key sk-abc'
    );
  }
}

describe('HTTP error handling', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  async function start(): Promise<ReturnType<typeof request>> {
    app = await createTestApp({ controllers: [ProbeController] });
    return request(app.getHttpServer());
  }

  it('answers a failed provider call with 502 and the reason, never with its message', async () => {
    const http = await start();

    const response = await http.get('/api/provider').expect(502);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toMatchObject({
      status: 502,
      title: 'Bad Gateway',
      reason: PROVIDER_ERROR.UNREACHABLE,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5|sk-abc|ECONNREFUSED/);
  });

  it('adds no reason to other errors', async () => {
    const http = await start();

    const response = await http.get('/api/boom').expect(500);

    expect(response.body).not.toHaveProperty('reason');
  });

  it('answers an unknown route with problem details and echoes the request id', async () => {
    const http = await start();

    const response = await http.get('/api/nope').expect(404);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toMatchObject({ status: 404, title: 'Not Found', instance: '/api/nope' });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('lists every validation problem and rejects unknown properties', async () => {
    const http = await start();

    const response = await http.post('/api/echo').send({ text: 'toolong', extra: 1 }).expect(400);

    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('text must be shorter'),
        expect.stringContaining('property extra should not exist'),
      ])
    );
  });

  it('hides internals of unexpected errors', async () => {
    const http = await start();

    const response = await http.get('/api/boom').expect(500);

    expect(response.body.detail).toBe('Internal server error');
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('keeps status and title of deliberate HTTP exceptions', async () => {
    const http = await start();

    const response = await http.get('/api/teapot').expect(418);

    expect(response.body).toMatchObject({ status: 418, detail: 'short and stout' });
  });

  it('answers an oversized JSON body with problem details, not HTML', async () => {
    const http = await start();

    const response = await http
      .post('/api/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(200_000) }))
      .expect(413);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body.status).toBe(413);
  });

  it('keeps a well-formed request id and replaces a malformed one', async () => {
    const http = await start();

    const kept = await http.get('/api/nope').set('x-request-id', 'client-req-0001');
    const replaced = await http.get('/api/nope').set('x-request-id', 'bad id!');

    expect(kept.headers['x-request-id']).toBe('client-req-0001');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
