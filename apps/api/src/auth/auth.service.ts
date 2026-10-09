import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditService } from '../database/audit/audit.service.js';
import { PasswordHasher } from '../users/password-hasher.js';
import type { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AttemptLimiter } from './attempt-limiter.js';
import type { AuthContext } from './auth-context.js';
import { type IssuedSession, SessionService } from './session.service.js';

/** A shared address may sign in for many people, so its limit is a multiple of the per-email limit. */
const IP_LIMIT_FACTOR = 5;

export interface ClientContext {
  ip: string;
  /** The session cookie the request came with, if any (replaced on login). */
  sessionToken?: string;
}

export interface AuthResult {
  user: User;
  session: IssuedSession;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly hasher: PasswordHasher,
    private readonly limiter: AttemptLimiter,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>
  ) {}

  async signup(
    input: { email: string; name: string; password: string },
    client: ClientContext
  ): Promise<AuthResult> {
    const ipKey = `signup:${client.ip}`;
    this.limiter.assertAllowed(ipKey, this.ipLimit());
    this.limiter.record(ipKey);

    const passwordHash = await this.hasher.hash(input.password);
    const user = await this.users.registerSelf(
      { email: input.email, name: input.name, passwordHash },
      {
        signupEnabled: this.config.get('ENABLE_SIGNUP', { infer: true }),
        defaultRole: this.config.get('DEFAULT_USER_ROLE', { infer: true }),
      }
    );
    const session = await this.sessions.issue(user.id);
    await this.audit.record({
      actorId: user.id,
      action: AUDIT_ACTION.AUTH_SIGNUP,
      targetType: 'user',
      targetId: user.id,
      metadata: { role: user.role },
    });
    return { user, session };
  }

  async login(
    input: { email: string; password: string },
    client: ClientContext
  ): Promise<AuthResult> {
    const ipKey = `ip:${client.ip}`;
    const emailKey = `email:${input.email}`;
    this.limiter.assertAllowed(ipKey, this.ipLimit());
    this.limiter.assertAllowed(emailKey, this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true }));

    const user = await this.users.findByEmail(input.email);
    // Unknown accounts cost the same time as known ones: the check always runs.
    const stored = user?.passwordHash ?? (await this.hasher.dummyHash());
    const passwordOk = await this.hasher.verify(stored, input.password);

    if (user === null || !passwordOk || user.disabledAt !== null) {
      this.limiter.record(ipKey);
      this.limiter.record(emailKey);
      await this.audit.record({ actorId: user?.id, action: AUDIT_ACTION.AUTH_LOGIN_FAILED });
      // One message for unknown email, wrong password and disabled account.
      throw new UnauthorizedException('Invalid email or password');
    }

    this.limiter.reset(emailKey);
    // Rotation: the cookie the request arrived with never survives a login.
    if (client.sessionToken !== undefined) await this.sessions.revokeToken(client.sessionToken);
    await this.sessions.purgeExpired(user.id);
    const session = await this.sessions.issue(user.id);
    await this.audit.record({ actorId: user.id, action: AUDIT_ACTION.AUTH_LOGIN });
    return { user, session };
  }

  async logout(auth: AuthContext): Promise<void> {
    if (auth.session !== null) await this.sessions.revoke(auth.session.id);
    await this.audit.record({ actorId: auth.user.id, action: AUDIT_ACTION.AUTH_LOGOUT });
  }

  async changePassword(
    auth: AuthContext,
    input: { currentPassword: string; newPassword: string }
  ): Promise<void> {
    const matches = await this.hasher.verify(auth.user.passwordHash, input.currentPassword);
    // 400, not 401: a 401 would make the web app think the session ended.
    if (!matches) throw new BadRequestException('The current password is incorrect');
    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.users.setPassword(auth.user.id, passwordHash, auth.session?.id);
    await this.audit.record({ actorId: auth.user.id, action: AUDIT_ACTION.AUTH_PASSWORD_CHANGED });
  }

  private ipLimit(): number {
    return this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true }) * IP_LIMIT_FACTOR;
  }
}
