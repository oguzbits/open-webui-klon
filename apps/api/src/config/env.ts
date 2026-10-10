import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  validateSync,
  ValidateIf,
} from 'class-validator';

import { ALLOWED_HOST_PATTERN } from '../http/safe-fetch/address-policy.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../users/password-policy.js';
import { USER_ROLE } from '../users/user-role.js';

export const NODE_ENV = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  PRODUCTION: 'production',
} as const;

export const LOG_LEVEL = {
  FATAL: 'fatal',
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace',
  SILENT: 'silent',
} as const;

type ValueOf<T> = T[keyof T];

// An origin is scheme://host[:port] without path, wildcard or trailing slash.
const ORIGIN_PATTERN = /^https?:\/\/[^\s/*?#]+$/;
const POSTGRES_URL_PATTERN = /^postgres(ql)?:\/\/\S+$/;
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/;
// keyId:base64(32 bytes). The id has no dot (it sits between dots in the stored format).
const KEYRING_ENTRY_PATTERN = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9+/]{43}=$/;

function emptyToUndefined({ value }: { value: unknown }): unknown {
  return value === '' ? undefined : value;
}

function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function adminIsConfigured(env: Env): boolean {
  return env.ADMIN_EMAIL !== undefined || env.ADMIN_PASSWORD !== undefined;
}

function splitList({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class Env {
  @IsIn(Object.values(NODE_ENV))
  NODE_ENV: ValueOf<typeof NODE_ENV> = NODE_ENV.DEVELOPMENT;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @Matches(POSTGRES_URL_PATTERN, {
    message: 'DATABASE_URL must be a postgres:// or postgresql:// URL',
  })
  DATABASE_URL!: string;

  @IsIn(Object.values(LOG_LEVEL))
  LOG_LEVEL: ValueOf<typeof LOG_LEVEL> = LOG_LEVEL.INFO;

  @Matches(ORIGIN_PATTERN, {
    message: 'PUBLIC_ORIGIN must be an origin like https://chat.example.com (no path)',
  })
  PUBLIC_ORIGIN = 'http://localhost:8080';

  @Transform(splitList)
  @IsArray()
  @Matches(ORIGIN_PATTERN, {
    each: true,
    message: 'CORS_ORIGINS must be a comma-separated list of origins without path or wildcard',
  })
  CORS_ORIGINS: string[] = [];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY_HOPS = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_LIMIT = 100;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_WINDOW_SECONDS = 60;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60000)
  SHUTDOWN_DRAIN_MS = 5000;

  @Transform(toBoolean)
  @IsBoolean()
  ENABLE_SIGNUP = true;

  // "admin" is deliberately not allowed: the first account becomes admin on its own.
  @IsIn([USER_ROLE.PENDING, USER_ROLE.USER])
  DEFAULT_USER_ROLE: typeof USER_ROLE.PENDING | typeof USER_ROLE.USER = USER_ROLE.PENDING;

  @Transform(toBoolean)
  @IsBoolean()
  ENABLE_API_KEYS = false;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  SESSION_LIFETIME_HOURS = 168;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOGIN_MAX_ATTEMPTS = 10;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOGIN_WINDOW_SECONDS = 300;

  @Transform(emptyToUndefined)
  @ValidateIf(adminIsConfigured)
  @IsEmail()
  ADMIN_EMAIL?: string;

  @Transform(emptyToUndefined)
  @ValidateIf(adminIsConfigured)
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  ADMIN_PASSWORD?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  ADMIN_NAME?: string;

  // Newest key first: it encrypts, all of them decrypt (rotation = put a new key in front).
  @Transform(splitList)
  @IsArray({ message: 'PROVIDER_KEY_ENCRYPTION_KEYS is required (keyId:base64 of 32 bytes)' })
  @ArrayMinSize(1, { message: 'PROVIDER_KEY_ENCRYPTION_KEYS needs at least one key' })
  @Matches(KEYRING_ENTRY_PATTERN, {
    each: true,
    message: 'PROVIDER_KEY_ENCRYPTION_KEYS entries must look like keyId:base64 (32 bytes)',
  })
  PROVIDER_KEY_ENCRYPTION_KEYS!: string[];

  @Transform(splitList)
  @IsArray()
  @Matches(ALLOWED_HOST_PATTERN, {
    each: true,
    message: 'PROVIDER_ALLOWED_HOSTS must be a comma-separated list of host or host:port',
  })
  PROVIDER_ALLOWED_HOSTS: string[] = [];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  MODEL_LIST_CACHE_TTL_MS = 30000;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(120000)
  PROVIDER_REQUEST_TIMEOUT_MS = 10000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  CHAT_MAX_CONCURRENT_STREAMS = 2;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(3600000)
  CHAT_STREAM_MAX_DURATION_MS = 300000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200000)
  CHAT_MESSAGE_MAX_LENGTH = 20000;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200000)
  CHAT_SYSTEM_PROMPT_MAX_LENGTH = 4000;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(2000000)
  CHAT_CONTEXT_MAX_CHARS = 60000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  CHAT_MAX_OUTPUT_TOKENS = 4096;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100000)
  CHAT_MAX_MESSAGES_PER_CHAT = 1000;

  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(HTTP_URL_PATTERN, { message: 'OTEL_EXPORTER_OTLP_ENDPOINT must be an http(s) URL' })
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

/** Validates raw configuration. The message names the problems but never the values (they may be secrets). */
export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { exposeDefaultValues: true });
  const errors = validateSync(env, {
    forbidUnknownValues: false,
    validationError: { target: false, value: false },
  });
  if (errors.length > 0) {
    const lines = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}).map((message) => ` - ${message}`)
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return env;
}

/** Entry points (see AGENTS.md rule 6) call this; nothing else reads process.env. */
export function loadEnv(): Env {
  return validateEnv(process.env);
}
