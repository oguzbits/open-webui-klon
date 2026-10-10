import { describe, expect, it } from 'vitest';

import { USER_ROLE } from '../users/user-role.js';
import { validateEnv } from './env.js';

/** 32 zero bytes: a syntactically valid key for tests only. */
const KEY_ENTRY = `test:${Buffer.alloc(32).toString('base64')}`;

const VALID = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://owui:secret@localhost:5432/owui',
  PROVIDER_KEY_ENCRYPTION_KEYS: KEY_ENTRY,
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

  it('has defaults for the chat limits and rejects values outside their range', () => {
    const env = validateEnv(VALID);

    expect(env.CHAT_MAX_CONCURRENT_STREAMS).toBe(2);
    expect(env.CHAT_STREAM_MAX_DURATION_MS).toBe(300000);
    expect(env.CHAT_MESSAGE_MAX_LENGTH).toBe(20000);
    expect(env.CHAT_SYSTEM_PROMPT_MAX_LENGTH).toBe(4000);
    expect(env.CHAT_CONTEXT_MAX_CHARS).toBe(60000);
    expect(env.CHAT_MAX_OUTPUT_TOKENS).toBe(4096);
    expect(env.CHAT_MAX_MESSAGES_PER_CHAT).toBe(1000);

    expect(() => validateEnv({ ...VALID, CHAT_MAX_CONCURRENT_STREAMS: '0' })).toThrow(
      /CHAT_MAX_CONCURRENT_STREAMS/
    );
    expect(() => validateEnv({ ...VALID, CHAT_STREAM_MAX_DURATION_MS: '10' })).toThrow(
      /CHAT_STREAM_MAX_DURATION_MS/
    );
    expect(() => validateEnv({ ...VALID, CHAT_MAX_OUTPUT_TOKENS: 'many' })).toThrow(
      /CHAT_MAX_OUTPUT_TOKENS/
    );
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

describe('validateEnv: provider settings', () => {
  it('has safe defaults', () => {
    const env = validateEnv(VALID);

    expect(env.PROVIDER_KEY_ENCRYPTION_KEYS).toEqual([KEY_ENTRY]);
    expect(env.PROVIDER_ALLOWED_HOSTS).toEqual([]);
    expect(env.MODEL_LIST_CACHE_TTL_MS).toBe(30000);
    expect(env.PROVIDER_REQUEST_TIMEOUT_MS).toBe(10000);
  });

  it('requires an encryption key', () => {
    const without = Object.fromEntries(
      Object.entries(VALID).filter(([name]) => name !== 'PROVIDER_KEY_ENCRYPTION_KEYS')
    );

    expect(() => validateEnv(without)).toThrow(/PROVIDER_KEY_ENCRYPTION_KEYS/);
    expect(() => validateEnv({ ...VALID, PROVIDER_KEY_ENCRYPTION_KEYS: '' })).toThrow(
      /PROVIDER_KEY_ENCRYPTION_KEYS/
    );
  });

  it('accepts several keys, the first one encrypts', () => {
    const second = `old:${Buffer.alloc(32, 1).toString('base64')}`;

    const env = validateEnv({ ...VALID, PROVIDER_KEY_ENCRYPTION_KEYS: `${KEY_ENTRY}, ${second}` });

    expect(env.PROVIDER_KEY_ENCRYPTION_KEYS).toEqual([KEY_ENTRY, second]);
  });

  it.each([
    ['no key id', Buffer.alloc(32).toString('base64')],
    ['a key of 31 bytes', `k:${Buffer.alloc(31).toString('base64')}`],
    ['a key of 33 bytes', `k:${Buffer.alloc(33).toString('base64')}`],
    ['a key id with a dot', `a.b:${Buffer.alloc(32).toString('base64')}`],
    ['text instead of base64', 'k:not base64 at all, really not base64 at all!!'],
  ])('rejects %s without echoing it', (_name, entry) => {
    const attempt = () => validateEnv({ ...VALID, PROVIDER_KEY_ENCRYPTION_KEYS: entry });

    expect(attempt).toThrow(/PROVIDER_KEY_ENCRYPTION_KEYS/);
    expect(attempt).not.toThrow(new RegExp(entry.slice(0, 20).replace(/[+/]/g, '.')));
  });

  it('parses the allowed hosts as a list', () => {
    const env = validateEnv({
      ...VALID,
      PROVIDER_ALLOWED_HOSTS: 'host.docker.internal, ollama ,localhost:11434,[::1]:11434',
    });

    expect(env.PROVIDER_ALLOWED_HOSTS).toEqual([
      'host.docker.internal',
      'ollama',
      'localhost:11434',
      '[::1]:11434',
    ]);
  });

  it.each(['http://ollama', 'ollama/path', '*.example.com', 'ollama:99999x', 'a b'])(
    'rejects %s as an allowed host',
    (entry) => {
      expect(() => validateEnv({ ...VALID, PROVIDER_ALLOWED_HOSTS: entry })).toThrow(
        /PROVIDER_ALLOWED_HOSTS/
      );
    }
  );

  it('reads the cache time-to-live and the request timeout', () => {
    const env = validateEnv({
      ...VALID,
      MODEL_LIST_CACHE_TTL_MS: '0',
      PROVIDER_REQUEST_TIMEOUT_MS: '2500',
    });

    expect(env.MODEL_LIST_CACHE_TTL_MS).toBe(0);
    expect(env.PROVIDER_REQUEST_TIMEOUT_MS).toBe(2500);
    expect(() => validateEnv({ ...VALID, PROVIDER_REQUEST_TIMEOUT_MS: '0' })).toThrow(
      /PROVIDER_REQUEST_TIMEOUT_MS/
    );
  });
});
