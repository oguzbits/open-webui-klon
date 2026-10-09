import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { Env } from '../config/env.js';
import { allowedOrigins } from './allowed-origins.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Blocks cross-site writes: a browser always sends Origin on a cross-origin POST/PUT/PATCH/DELETE.
 * Requests without Origin come from non-browser clients. The CSRF token for cookie sessions follows in
 * subproject 1.
 */
@Injectable()
export class OriginCheckGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;

  constructor(config: ConfigService<Env, true>) {
    this.allowed = new Set(
      allowedOrigins({
        PUBLIC_ORIGIN: config.get('PUBLIC_ORIGIN', { infer: true }),
        CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
      })
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method)) return true;
    const { origin } = request.headers;
    if (origin === undefined || this.allowed.has(origin)) return true;
    throw new ForbiddenException('Origin not allowed');
  }
}
