import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.js';

const VALID = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://owui:secret@localhost:5432/owui',
};

describe('validateEnv', () => {
  it('applies defaults for optional values', () => {
    const env = validateEnv(VALID);

    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.PUBLIC_ORIGIN).toBe('http://localhost:8080');
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.RATE_LIMIT_LIMIT).toBe(100);
    expect(env.RATE_LIMIT_WINDOW_SECONDS).toBe(60);
    expect(env.SHUTDOWN_DRAIN_MS).toBe(5000);
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('converts numbers and splits the CORS origin list', () => {
    const env = validateEnv({
      ...VALID,
      PORT: '4000',
      CORS_ORIGINS: ' http://a.test , http://b.test:5173 ,',
    });

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test:5173']);
  });

  it.each(['*', 'http://a.test/path', 'a.test', 'http://a.test/'])(
    'rejects %s as a CORS origin',
    (origin) => {
      expect(() => validateEnv({ ...VALID, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
    }
  );

  it('treats an empty optional value as unset', () => {
    const env = validateEnv({ ...VALID, OTEL_EXPORTER_OTLP_ENDPOINT: '' });

    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('reports every problem at once and never echoes values', () => {
    const attempt = () =>
      validateEnv({ NODE_ENV: 'test', PORT: '99999', DATABASE_URL: 'mysql://root:hunter2@db/x' });

    expect(attempt).toThrow(/PORT/);
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).not.toThrow(/hunter2/);
  });
});
