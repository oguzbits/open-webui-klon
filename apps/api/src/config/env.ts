import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
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
