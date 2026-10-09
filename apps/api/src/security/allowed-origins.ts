import type { Env } from '../config/env.js';

/** Origins that may call the API from a browser: the public one plus the configured extras. */
export function allowedOrigins(env: Pick<Env, 'PUBLIC_ORIGIN' | 'CORS_ORIGINS'>): string[] {
  return [...new Set([env.PUBLIC_ORIGIN, ...env.CORS_ORIGINS])];
}
