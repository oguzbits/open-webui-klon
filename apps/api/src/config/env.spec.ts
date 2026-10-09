import { describe, expect, it } from 'vitest';

import { USER_ROLE } from '../users/user-role.js';
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

describe('validateEnv: auth settings', () => {
  it('has safe defaults', () => {
    const env = validateEnv(VALID);

    expect(env.ENABLE_SIGNUP).toBe(true);
    expect(env.DEFAULT_USER_ROLE).toBe(USER_ROLE.PENDING);
    expect(env.ENABLE_API_KEYS).toBe(false);
    expect(env.SESSION_LIFETIME_HOURS).toBe(168);
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(10);
    expect(env.LOGIN_WINDOW_SECONDS).toBe(300);
    expect(env.ADMIN_EMAIL).toBeUndefined();
    expect(env.ADMIN_PASSWORD).toBeUndefined();
  });

  it('parses the booleans from text', () => {
    const env = validateEnv({ ...VALID, ENABLE_SIGNUP: 'false', ENABLE_API_KEYS: 'true' });

    expect(env.ENABLE_SIGNUP).toBe(false);
    expect(env.ENABLE_API_KEYS).toBe(true);
  });

  it.each(['yes', '1', 'TRUE'])('rejects %s as a boolean', (value) => {
    expect(() => validateEnv({ ...VALID, ENABLE_SIGNUP: value })).toThrow(/ENABLE_SIGNUP/);
  });

  it('never allows admin as the default role', () => {
    expect(() => validateEnv({ ...VALID, DEFAULT_USER_ROLE: USER_ROLE.ADMIN })).toThrow(
      /DEFAULT_USER_ROLE/
    );
    expect(validateEnv({ ...VALID, DEFAULT_USER_ROLE: USER_ROLE.USER }).DEFAULT_USER_ROLE).toBe(
      USER_ROLE.USER
    );
  });

  it('accepts an admin from the environment', () => {
    const env = validateEnv({
      ...VALID,
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: 'correct horse battery',
      ADMIN_NAME: 'Ada',
    });

    expect(env.ADMIN_EMAIL).toBe('admin@example.com');
    expect(env.ADMIN_NAME).toBe('Ada');
  });

  it('treats empty admin values as unset (compose passes empty strings)', () => {
    const env = validateEnv({ ...VALID, ADMIN_EMAIL: '', ADMIN_PASSWORD: '', ADMIN_NAME: '' });

    expect(env.ADMIN_EMAIL).toBeUndefined();
    expect(env.ADMIN_PASSWORD).toBeUndefined();
  });

  it('requires ADMIN_EMAIL and ADMIN_PASSWORD together', () => {
    expect(() => validateEnv({ ...VALID, ADMIN_EMAIL: 'admin@example.com' })).toThrow(
      /ADMIN_PASSWORD/
    );
    expect(() => validateEnv({ ...VALID, ADMIN_PASSWORD: 'correct horse battery' })).toThrow(
      /ADMIN_EMAIL/
    );
  });

  it('rejects a short admin password without echoing it', () => {
    const attempt = () =>
      validateEnv({ ...VALID, ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'tiny-s3cret' });

    expect(attempt).toThrow(/ADMIN_PASSWORD/);
    expect(attempt).not.toThrow(/tiny-s3cret/);
  });
});
