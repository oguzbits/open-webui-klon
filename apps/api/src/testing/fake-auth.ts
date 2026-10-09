import { randomUUID } from 'node:crypto';
import type { Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ApiKey } from '../auth/api-key.entity.js';
import { ApiKeyService } from '../auth/api-key.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { Session } from '../auth/session.entity.js';
import { SessionService } from '../auth/session.service.js';
import { User } from '../users/user.entity.js';
import { USER_ROLE } from '../users/user-role.js';

type SessionRole = typeof USER_ROLE.ADMIN | typeof USER_ROLE.USER | typeof USER_ROLE.PENDING;
type KeyRole = typeof USER_ROLE.ADMIN | typeof USER_ROLE.USER;

const KEYS: Record<KeyRole, string> = {
  [USER_ROLE.ADMIN]: `sk-${'a'.repeat(64)}`,
  [USER_ROLE.USER]: `sk-${'b'.repeat(64)}`,
};

export interface FakeAuth {
  /** The real AuthGuard (global) in front of in-memory session and key stores. */
  providers: Provider[];
  /** Headers of a signed-in browser: cookie and CSRF token. */
  session(role: SessionRole): Record<string, string>;
  /** Header of an API key (the app needs ENABLE_API_KEYS=true). */
  key(role: KeyRole): Record<string, string>;
}

function makeUser(role: SessionRole): User {
  return Object.assign(new User(), {
    id: randomUUID(),
    email: `${role}@example.com`,
    name: role,
    passwordHash: 'x',
    role,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

export function fakeAuth(): FakeAuth {
  const users = {
    [USER_ROLE.ADMIN]: makeUser(USER_ROLE.ADMIN),
    [USER_ROLE.USER]: makeUser(USER_ROLE.USER),
    [USER_ROLE.PENDING]: makeUser(USER_ROLE.PENDING),
  };
  const sessions = new Map<string, Session>();
  for (const [role, user] of Object.entries(users)) {
    sessions.set(
      `tok-${role}`,
      Object.assign(new Session(), {
        id: randomUUID(),
        userId: user.id,
        user,
        tokenHash: 'h',
        csrfToken: `csrf-${role}`,
        expiresAt: new Date(Date.now() + 60_000),
        lastUsedAt: new Date(),
        createdAt: new Date(),
      })
    );
  }
  const keys = new Map<string, ApiKey>();
  for (const role of [USER_ROLE.ADMIN, USER_ROLE.USER] as const) {
    keys.set(
      KEYS[role],
      Object.assign(new ApiKey(), { id: randomUUID(), userId: users[role].id, user: users[role] })
    );
  }

  return {
    providers: [
      { provide: APP_GUARD, useClass: AuthGuard },
      {
        provide: SessionService,
        useValue: { resolve: (token: string) => Promise.resolve(sessions.get(token) ?? null) },
      },
      {
        provide: ApiKeyService,
        useValue: { resolve: (key: string) => Promise.resolve(keys.get(key) ?? null) },
      },
    ],
    session: (role) => ({ Cookie: `session=tok-${role}`, 'X-CSRF-Token': `csrf-${role}` }),
    key: (role) => ({ Authorization: `Bearer ${KEYS[role]}` }),
  };
}
