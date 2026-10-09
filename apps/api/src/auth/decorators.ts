import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';

import type { UserRole } from '../users/user-role.js';
import type { AuthContext, AuthenticatedRequest } from './auth-context.js';

export const AUTH_METADATA = {
  PUBLIC: 'auth:public',
  ALLOW_PENDING: 'auth:allow-pending',
  SESSION_ONLY: 'auth:session-only',
  ROLES: 'auth:roles',
} as const;

/** The guard is global and closed: a route without credentials is only reachable with this marker. */
export const Public = () => SetMetadata(AUTH_METADATA.PUBLIC, true);

/** Accounts that wait for approval may call this route. */
export const AllowPending = () => SetMetadata(AUTH_METADATA.ALLOW_PENDING, true);

/** Refuses API keys; only a login session counts. Admin routes behave this way automatically. */
export const SessionOnly = () => SetMetadata(AUTH_METADATA.SESSION_ONLY, true);

export const Roles = (...roles: UserRole[]) => SetMetadata(AUTH_METADATA.ROLES, roles);

function authFrom(context: ExecutionContext): AuthContext {
  const { auth } = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (auth === undefined) throw new UnauthorizedException();
  return auth;
}

export const CurrentAuth = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  authFrom(context)
);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => authFrom(context).user
);
