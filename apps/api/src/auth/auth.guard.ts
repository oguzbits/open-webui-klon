import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import type { Env } from '../config/env.js';
import { USER_ROLE, type UserRole } from '../users/user-role.js';
import { ApiKeyService } from './api-key.service.js';
import type { AuthContext, AuthenticatedRequest } from './auth-context.js';
import { SESSION_COOKIE, readCookie } from './cookies.js';
import { AUTH_METADATA } from './decorators.js';
import type { Session } from './session.entity.js';
import { SessionService } from './session.service.js';
import { API_KEY_PREFIX, safeEqual } from './tokens.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const BEARER = /^bearer\s+(\S+)$/i;
const KEY_FORMAT = new RegExp(`^${API_KEY_PREFIX}[0-9a-f]{64}$`);

/**
 * Global and closed by default (registered in AuthModule). Identity comes from the login cookie or, if enabled,
 * from `Authorization: Bearer sk-...`; the role is always read from the database, never from the client.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly apiKeysEnabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly apiKeys: ApiKeyService,
    config: ConfigService<Env, true>
  ) {
    this.apiKeysEnabled = config.get('ENABLE_API_KEYS', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.flag(AUTH_METADATA.PUBLIC, context)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = await this.authenticate(request);
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(AUTH_METADATA.ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);

    const sessionOnly =
      this.flag(AUTH_METADATA.SESSION_ONLY, context) || roles?.includes(USER_ROLE.ADMIN) === true;
    if (auth.apiKey !== null && sessionOnly) {
      throw new ForbiddenException('This endpoint needs a login session');
    }
    // "Pending" only exists for the web app: a key of a waiting account opens nothing, not even AllowPending routes.
    if (
      auth.user.role === USER_ROLE.PENDING &&
      (auth.apiKey !== null || !this.flag(AUTH_METADATA.ALLOW_PENDING, context))
    ) {
      throw new ForbiddenException('The account is waiting for approval');
    }
    if (roles !== undefined && !roles.includes(auth.user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    if (auth.session !== null && !SAFE_METHODS.has(request.method)) {
      this.assertCsrf(request.headers['x-csrf-token'], auth.session);
    }

    request.auth = auth;
    return true;
  }

  private flag(key: string, context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(key, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private async authenticate(request: AuthenticatedRequest): Promise<AuthContext> {
    const { authorization } = request.headers;
    // A present Authorization header decides alone: no silent fallback to the cookie.
    if (authorization !== undefined) return this.authenticateKey(authorization);

    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token === undefined) throw new UnauthorizedException();
    const session = await this.sessions.resolve(token);
    if (session === null || session.user.disabledAt !== null) throw new UnauthorizedException();
    return { user: session.user, session, apiKey: null };
  }

  private async authenticateKey(header: string): Promise<AuthContext> {
    const key = BEARER.exec(header)?.[1];
    if (!this.apiKeysEnabled || key === undefined || !KEY_FORMAT.test(key)) {
      throw new UnauthorizedException();
    }
    const apiKey = await this.apiKeys.resolve(key);
    if (apiKey === null || apiKey.user.disabledAt !== null) throw new UnauthorizedException();
    return { user: apiKey.user, session: null, apiKey };
  }

  private assertCsrf(header: string | string[] | undefined, session: Session): void {
    if (typeof header !== 'string' || !safeEqual(header, session.csrfToken)) {
      throw new ForbiddenException('CSRF token missing or invalid');
    }
  }
}
