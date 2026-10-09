# Teilprojekt 1a: Auth-Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrierung, Anmeldung, Cookie-Sessions, Rollen (`pending`/`user`/`admin`), Nutzerverwaltung und API-Keys in `apps/api`, so nah an Open WebUI wie die Sicherheitsvorgaben erlauben.

**Architecture:** Zwei Feature-Module. `users` besitzt die Nutzertabelle, alle Schreibzugriffe laufen in einer Transaktion unter einem Postgres-Advisory-Lock (erster Admin, letzter Admin). `auth` besitzt Sessions, API-Keys, den globalen `AuthGuard` (standardmäßig geschlossen) und die Auth-Routen. Sessions und Keys liegen nur als SHA-256-Hash in der Datenbank; Passwörter als Argon2id.

**Tech Stack:** NestJS 12, TypeORM 1.x (Postgres), `@node-rs/argon2`, Vitest + Supertest, bestehende Bausteine (`AuditService`, `ProblemDetailsFilter`, `createTestApp`).

**Spec:** [Teilprojekt 1](../specs/2026-10-09-teilprojekt-1-auth-design.md), Rahmen: [Gesamt-Spec](../specs/2026-10-09-open-webui-nestjs-design.md). Das Web (Teilprojekt 1b) folgt in einem eigenen Plan.

## Global Constraints

- `pnpm`, nie `npm` oder `yarn`. Befehle aus `AGENTS.md`: `pnpm check`, `pnpm test`, `pnpm db:up`, `pnpm test:db`, `pnpm openapi`.
- Kein `any`, kein `@ts-ignore`, kein `as unknown as`, kein `export *`. Typen aus DTOs, keine handgeschriebenen Paralleltypen.
- Steuernde Werte als `export const X = {...} as const` (`USER_ROLE`, `AUDIT_ACTION`) und überall importiert, auch in Tests.
- Env nur über `apps/api/src/config/env.ts`. Kein `process.env` in neuem Code. `.env*` wird nie gelesen oder committet.
- Keine Passwörter, Tokens, Keys, E-Mail-Adressen oder Inhalte in Logs und Audit-Metadaten; nur IDs, Rollen, Längen.
- Passwort: mindestens 12, höchstens 128 Zeichen. Argon2id mit den Bibliotheksvorgaben `m=19456, t=2, p=1` (OWASP-Mindestwert, am 2026-10-09 gegen die README von `@node-rs/argon2` geprüft).
- Cookie `session`: `httpOnly`, `SameSite=Lax`, `Path=/`, `Secure` genau dann, wenn `PUBLIC_ORIGIN` mit `https://` beginnt. Token 256 Bit zufällig, in der DB nur SHA-256.
- API-Key-Format `sk-` plus 64 Hex-Zeichen. Nur `Authorization: Bearer`; `x-api-key` und Query-Parameter werden ignoriert.
- Migrationen werden mit `migration:generate` erzeugt und danach nie von Hand geändert. Neue Entities in `database/entities.ts`, Migrationen in `database/migrations/index.ts` eintragen.
- Git: direkt auf `main`, ein Thema pro Commit, Conventional Commits, Imperativ. Hooks nie mit `--no-verify` umgehen. Jede Commit-Nachricht endet mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Nach einem Push: `gh run list --branch main --limit 1` prüfen, rote CI vor neuer Arbeit beheben.

## Review Focus

Eingabeklassen, die die Spec nicht ausdrücklich nennt und die im Alltag auftreten. Jede Zeile hat einen Test in der genannten Task.

1. **E-Mail mit Großbuchstaben oder Leerzeichen** (`" Ada@Example.COM "`): gleiches Konto wie `ada@example.com`, nie ein Duplikat (Task 6 und 7).
2. **Sehr langes Passwort** (129 Zeichen, 200 KB Body): 400 beziehungsweise 413, nie 500 und nie ein hängender Hash (Task 7).
3. **Kaputter `Cookie`-Header** (leer, `session=`, doppelter Name, Müll, nur `;`): 401, nie 500 (Task 3 und 5).
4. **Gleichzeitige Anfragen** (fünf parallele Registrierungen, zwei Admins stufen sich gegenseitig herab): genau ein Admin, immer mindestens ein aktiver Admin (Task 6).
5. **Unbekannte E-Mail, falsches Passwort, gesperrtes Konto:** gleiche Antwort, gleicher Pfad (Task 7).

---

## Dateistruktur

```
apps/api/src/
  users/
    user-role.ts            USER_ROLE, UserRole
    email.ts                normalizeEmail, emailTransform
    password-policy.ts      PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH
    password-hasher.ts      PasswordHasher (Argon2id; von users und auth genutzt)
    user.entity.ts          User (Tabelle app_user)
    users.service.ts        alle Nutzer-Schreibzugriffe, Advisory-Lock, letzter Admin
    users.dto.ts            UserDto, toUserDto, Create/Update/SetPassword-DTOs
    users.controller.ts     /users (nur Admin, nur Session)
    admin-bootstrap.service.ts   Admin aus ADMIN_* beim Start
    users.module.ts
  auth/
    tokens.ts               sha256Hex, generateToken, generateApiKey, safeEqual, API_KEY_PREFIX
    cookies.ts              SESSION_COOKIE, readCookie, sessionCookieOptions
    session.entity.ts       Session
    api-key.entity.ts       ApiKey
    session.service.ts      SessionService
    api-key.service.ts      ApiKeyService
    auth-context.ts         AuthContext, AuthenticatedRequest
    decorators.ts           Public, AllowPending, SessionOnly, Roles, CurrentAuth, CurrentUser
    auth.guard.ts           AuthGuard (global, geschlossen per Standard, CSRF)
    attempt-limiter.ts      AttemptLimiter (im Speicher)
    auth.service.ts         AuthService (signup, login, logout, changePassword)
    auth.dto.ts             SignupDto, LoginDto, ChangePasswordDto, SessionInfoDto
    auth.controller.ts      /auth/*
    api-keys.dto.ts         CreateApiKeyDto, ApiKeyDto, CreatedApiKeyDto
    api-keys.controller.ts  /auth/api-keys
    auth.module.ts
  testing/
    db-fixtures.ts          insertUser, resetAuthTables
    create-db-test-app.ts   App mit echter Datenbank für HTTP-Tests
    http-session.ts         signupUser, loginUser, authed
```

---

### Task 1: Wörterbücher und Konfiguration

**Files:**
- Create: `apps/api/src/users/user-role.ts`, `apps/api/src/users/password-policy.ts`
- Modify: `apps/api/src/database/audit/audit-action.ts`, `apps/api/src/config/env.ts`, `apps/api/src/config/env.spec.ts`, `.env.example`, `compose.yml`

**Interfaces:**
- Produces: `USER_ROLE`, `UserRole`; `PASSWORD_MIN_LENGTH` (12), `PASSWORD_MAX_LENGTH` (128); erweiterte `AUDIT_ACTION`; `Env`-Felder `ENABLE_SIGNUP: boolean`, `DEFAULT_USER_ROLE: 'pending' | 'user'`, `ENABLE_API_KEYS: boolean`, `SESSION_LIFETIME_HOURS: number`, `LOGIN_MAX_ATTEMPTS: number`, `LOGIN_WINDOW_SECONDS: number`, `ADMIN_EMAIL?: string`, `ADMIN_PASSWORD?: string`, `ADMIN_NAME?: string`.

- [ ] **Step 1: Wörterbücher anlegen**

`apps/api/src/users/user-role.ts`:

```ts
export const USER_ROLE = {
  PENDING: 'pending',
  USER: 'user',
  ADMIN: 'admin',
} as const;

export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];
```

`apps/api/src/users/password-policy.ts`:

```ts
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
```

`apps/api/src/database/audit/audit-action.ts` ersetzen durch:

```ts
export const AUDIT_ACTION = {
  SYSTEM_MIGRATED: 'system.migrated',
  AUTH_SIGNUP: 'auth.signup',
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_PASSWORD_CHANGED: 'auth.password_changed',
  USER_CREATED: 'user.created',
  USER_ROLE_CHANGED: 'user.role_changed',
  USER_DISABLED: 'user.disabled',
  USER_ENABLED: 'user.enabled',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_DELETED: 'user.deleted',
  API_KEY_CREATED: 'api_key.created',
  API_KEY_REVOKED: 'api_key.revoked',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
```

- [ ] **Step 2: Fehlschlagende Env-Tests schreiben**

An `apps/api/src/config/env.spec.ts` anhängen (vor dem letzten `});` des äußeren `describe`, oder als eigenes `describe` am Dateiende; Importe oben ergänzen: `import { USER_ROLE } from '../users/user-role.js';`):

```ts
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
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/config/env.spec.ts`
Expected: FAIL (die neuen Felder sind `undefined`).

- [ ] **Step 4: Env erweitern**

In `apps/api/src/config/env.ts` die Importe erweitern:

```ts
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
```

(Die bestehenden Importe `plainToInstance, Transform, Type` und `'reflect-metadata'` bleiben.) Unter `emptyToUndefined` ergänzen:

```ts
function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function adminIsConfigured(env: Env): boolean {
  return env.ADMIN_EMAIL !== undefined || env.ADMIN_PASSWORD !== undefined;
}
```

In der Klasse `Env` nach `SHUTDOWN_DRAIN_MS` einfügen:

```ts
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
```

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/config/env.spec.ts`
Expected: PASS. Wenn `ENABLE_SIGNUP` ohne Wert nicht `true` ergibt (Standardwert durch `@Transform` überschrieben), `toBoolean` so anpassen, dass `undefined` unverändert durchgereicht wird (tut es bereits) und prüfen, dass `exposeDefaultValues` greift; das Muster ist dasselbe wie bei `CORS_ORIGINS`.

- [ ] **Step 6: `.env.example` und `compose.yml`**

An `.env.example` anhängen:

```
# Sign-up and first admin. The first account to register becomes admin. Alternatively create the admin at start-up
# (only used while no user exists; remove ADMIN_PASSWORD from the environment afterwards):
# ADMIN_EMAIL=
# ADMIN_PASSWORD=
# ADMIN_NAME=
ENABLE_SIGNUP=true
# New accounts wait for an admin ("pending") or are active at once ("user").
DEFAULT_USER_ROLE=pending
ENABLE_API_KEYS=false
SESSION_LIFETIME_HOURS=168
```

In `compose.yml` unter `api.environment` nach `OTEL_EXPORTER_OTLP_ENDPOINT` ergänzen:

```yaml
      ENABLE_SIGNUP: ${ENABLE_SIGNUP:-true}
      DEFAULT_USER_ROLE: ${DEFAULT_USER_ROLE:-pending}
      ENABLE_API_KEYS: ${ENABLE_API_KEYS:-false}
      SESSION_LIFETIME_HOURS: ${SESSION_LIFETIME_HOURS:-168}
      ADMIN_EMAIL: ${ADMIN_EMAIL:-}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-}
      ADMIN_NAME: ${ADMIN_NAME:-}
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/users apps/api/src/auth apps/api/src/database/audit apps/api/src/config .env.example compose.yml
git commit -m "feat(api): add auth settings, role dictionary and audit actions" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Entities und Migration

**Files:**
- Create: `apps/api/src/users/user.entity.ts`, `apps/api/src/auth/session.entity.ts`, `apps/api/src/auth/api-key.entity.ts`, `apps/api/src/database/auth-schema.db.spec.ts`, `apps/api/src/database/migrations/<timestamp>-add-auth.ts` (generiert)
- Modify: `apps/api/src/database/entities.ts`, `apps/api/src/database/migrations/index.ts`, `apps/api/src/database/data-source-options.ts`

**Interfaces:**
- Produces: `User` (`id`, `email` kleingeschrieben, `name`, `passwordHash`, `role: UserRole`, `disabledAt: Date | null`, `createdAt`, `updatedAt`), `Session` (`id`, `userId`, `user`, `tokenHash`, `csrfToken`, `expiresAt`, `lastUsedAt`, `createdAt`), `ApiKey` (`id`, `userId`, `user`, `name`, `keyHash`, `prefix`, `expiresAt: Date | null`, `revokedAt: Date | null`, `lastUsedAt: Date | null`, `createdAt`). Tabellen `app_user`, `session`, `api_key`.

- [ ] **Step 1: Entities schreiben**

`apps/api/src/users/user.entity.ts`:

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { USER_ROLE, type UserRole } from './user-role.js';

const ROLE_VALUES = Object.values(USER_ROLE)
  .map((role) => `'${role}'`)
  .join(', ');

/** "user" is a reserved word in Postgres, hence app_user. The email is always stored lower-case. */
@Entity({ name: 'app_user' })
@Index('app_user_email_idx', ['email'], { unique: true })
@Check('app_user_role_check', `role IN (${ROLE_VALUES})`)
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'text', default: USER_ROLE.PENDING })
  role!: UserRole;

  @Column({ name: 'disabled_at', type: 'timestamptz', nullable: true })
  disabledAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

`apps/api/src/auth/session.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../users/user.entity.js';

/** The cookie holds the token; only its SHA-256 is stored, so a leaked table cannot be replayed. */
@Entity({ name: 'session' })
@Index('session_token_hash_idx', ['tokenHash'], { unique: true })
@Index('session_user_id_idx', ['userId'])
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'token_hash', type: 'text' })
  tokenHash!: string;

  @Column({ name: 'csrf_token', type: 'text' })
  csrfToken!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', default: () => 'now()' })
  lastUsedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

`apps/api/src/auth/api-key.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { User } from '../users/user.entity.js';

/** Only the SHA-256 of the key is stored; `prefix` (first characters) lets the owner recognise it. */
@Entity({ name: 'api_key' })
@Index('api_key_key_hash_idx', ['keyHash'], { unique: true })
@Index('api_key_user_id_idx', ['userId'])
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'key_hash', type: 'text' })
  keyHash!: string;

  @Column({ type: 'text' })
  prefix!: string;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

`apps/api/src/database/entities.ts`:

```ts
import { ApiKey } from '../auth/api-key.entity.js';
import { Session } from '../auth/session.entity.js';
import { User } from '../users/user.entity.js';
import { AuditLog } from './audit/audit-log.entity.js';

export const ENTITIES = [AuditLog, User, Session, ApiKey];
```

- [ ] **Step 2: Schema-Test schreiben (schlägt zunächst fehl)**

`apps/api/src/database/auth-schema.db.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ApiKey } from '../auth/api-key.entity.js';
import { Session } from '../auth/session.entity.js';
import { User } from '../users/user.entity.js';
import { USER_ROLE } from '../users/user-role.js';
import { buildDataSourceOptions } from './data-source-options.js';

describe('auth schema (database)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE app_user CASCADE');
  });

  function newUser(email: string) {
    return dataSource.getRepository(User).insert({
      email,
      name: 'Test',
      passwordHash: 'hash',
      role: USER_ROLE.USER,
    });
  }

  it('stores a user with defaults', async () => {
    await newUser('ada@example.com');

    const user = await dataSource.getRepository(User).findOneByOrFail({ email: 'ada@example.com' });
    expect(user.disabledAt).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('refuses a second account with the same email', async () => {
    await newUser('ada@example.com');

    await expect(newUser('ada@example.com')).rejects.toThrow(/app_user_email_idx|duplicate key/);
  });

  it('refuses an unknown role', async () => {
    await expect(
      dataSource.query(
        "INSERT INTO app_user (email, name, password_hash, role) VALUES ('root@example.com', 'x', 'h', 'root')"
      )
    ).rejects.toThrow(/app_user_role_check/);
  });

  it('removes sessions and api keys together with the user', async () => {
    await newUser('ada@example.com');
    const user = await dataSource.getRepository(User).findOneByOrFail({ email: 'ada@example.com' });
    await dataSource.getRepository(Session).insert({
      userId: user.id,
      tokenHash: randomUUID(),
      csrfToken: 'csrf',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await dataSource.getRepository(ApiKey).insert({
      userId: user.id,
      name: 'ci',
      keyHash: randomUUID(),
      prefix: 'sk-abcde',
    });

    await dataSource.getRepository(User).delete({ id: user.id });

    expect(await dataSource.getRepository(Session).count()).toBe(0);
    expect(await dataSource.getRepository(ApiKey).count()).toBe(0);
  });
});
```

- [ ] **Step 3: `uuidExtension` setzen**

TypeORM erzeugt für `PrimaryGeneratedColumn('uuid')` sonst `uuid_generate_v4()` und braucht `uuid-ossp`; die Test-DB wird per `DROP SCHEMA public CASCADE` zurückgesetzt und verliert die Erweiterung. `gen_random_uuid()` (Postgres-Kern) passt außerdem zur bestehenden Migration. In `apps/api/src/database/data-source-options.ts` im Rückgabeobjekt nach `type: 'postgres',` ergänzen:

```ts
    // gen_random_uuid() is built into Postgres; uuid-ossp would vanish with the test schema reset.
    uuidExtension: 'pgcrypto',
```

- [ ] **Step 4: Migration generieren**

```bash
pnpm db:up
export DATABASE_URL=postgresql://owui:owui-dev-password@127.0.0.1:5433/owui
pnpm --filter @owui/api build
pnpm --filter @owui/api migration:run
pnpm --filter @owui/api migration:generate src/database/migrations/add-auth
```

(Die URL ist der Entwicklungswert aus `.env.example`, kein Geheimnis.) Die erzeugte Datei `apps/api/src/database/migrations/<timestamp>-add-auth.ts` prüfen: Sie darf nur `app_user`, `session`, `api_key`, ihre Indizes, die CHECK-Bedingung und die Fremdschlüssel anlegen, und `gen_random_uuid()` verwenden. Berührt sie `audit_log`, ist `uuidExtension` aus Step 3 nicht wirksam; Ursache klären, nicht die Datei ändern. Die Datei **nicht von Hand ändern** (Invariante 9), nur Prettier darf sie formatieren.

In `apps/api/src/database/migrations/index.ts` eintragen (Namen und Zeitstempel aus der erzeugten Datei einsetzen):

```ts
import { InitFoundation1791504000000 } from './1791504000000-init-foundation.js';
import { AddAuth<Zeitstempel> } from './<Zeitstempel>-add-auth.js';

export const MIGRATIONS = [InitFoundation1791504000000, AddAuth<Zeitstempel>];
```

- [ ] **Step 5: Datenbank-Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts`
Expected: PASS, auch die bestehenden `audit.service.db.spec.ts` und `migrate.db.spec.ts` (das Schema wird aus allen Migrationen neu aufgebaut). Zusätzlich: `pnpm --filter @owui/api migration:generate src/database/migrations/check-drift` darf **keine** Änderungen finden ("No changes in database schema were found"); eine dabei entstandene Datei löschen.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/users/user.entity.ts apps/api/src/auth apps/api/src/database
git commit -m "feat(api): add user, session and api key tables" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```


---

### Task 3: Bausteine für Tokens, Cookies, Passwort und E-Mail

**Files:**
- Create: `apps/api/src/auth/tokens.ts`, `apps/api/src/auth/tokens.spec.ts`, `apps/api/src/auth/cookies.ts`, `apps/api/src/auth/cookies.spec.ts`, `apps/api/src/users/password-hasher.ts`, `apps/api/src/users/password-hasher.spec.ts`, `apps/api/src/users/email.ts`, `apps/api/src/users/email.spec.ts`
- Modify: `apps/api/package.json`, `pnpm-lock.yaml`

**Interfaces:**
- Produces:
  - `API_KEY_PREFIX = 'sk-'`, `sha256Hex(value: string): string`, `generateToken(): string` (43 Zeichen Base64url), `generateApiKey(): string`, `safeEqual(a: string, b: string): boolean`
  - `SESSION_COOKIE = 'session'`, `readCookie(header: string | undefined, name: string): string | undefined`, `sessionCookieOptions(secure: boolean): CookieOptions`
  - `PasswordHasher` (`@Injectable`): `hash(password: string): Promise<string>`, `verify(hashed: string, password: string): Promise<boolean>`, `dummyHash(): Promise<string>`
  - `normalizeEmail(value: string): string`, `emailTransform({ value }: { value: unknown }): unknown`

- [ ] **Step 1: Abhängigkeit hinzufügen**

Grund: Argon2id ohne Installationsskript (vorkompilierte Pakete je Plattform, deshalb kein Eintrag in `allowBuilds` nötig). Die Alternative `argon2` (node-gyp) braucht ein Build-Skript.

Run: `pnpm --filter @owui/api add @node-rs/argon2`
Expected: Eintrag in `apps/api/package.json` und `pnpm-lock.yaml`. Wählt pnpm wegen `minimumReleaseAge` eine ältere Version als die neueste, ist das gewollt. Die Installationsskripte-Ausgabe darf keinen Hinweis auf nicht freigegebene Build-Skripte für dieses Paket zeigen.

- [ ] **Step 2: Fehlschlagende Tests schreiben**

`apps/api/src/auth/tokens.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { API_KEY_PREFIX, generateApiKey, generateToken, safeEqual, sha256Hex } from './tokens.js';

describe('tokens', () => {
  it('generates unguessable, unique, URL-safe session tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));

    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates api keys with the sk- prefix and 256 bits of randomness', () => {
    const key = generateApiKey();

    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key).toMatch(/^sk-[0-9a-f]{64}$/);
    expect(generateApiKey()).not.toBe(key);
  });

  it('hashes to a stable 64 character hex digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('compares in constant time and rejects different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });
});
```

`apps/api/src/auth/cookies.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { readCookie, SESSION_COOKIE, sessionCookieOptions } from './cookies.js';

describe('readCookie', () => {
  it('reads the value among other cookies', () => {
    expect(readCookie('theme=dark; session=abc123; lang=de', 'session')).toBe('abc123');
  });

  it('takes the first of two cookies with the same name', () => {
    expect(readCookie('session=first; session=second', 'session')).toBe('first');
  });

  it('strips surrounding quotes', () => {
    expect(readCookie('session="abc"', 'session')).toBe('abc');
  });

  it('keeps an equals sign inside the value', () => {
    expect(readCookie('a=b=c', 'a')).toBe('b=c');
  });

  it.each([undefined, '', ';', ';;', 'session', 'session=', '=x', 'other=1', 'sessionx=1'])(
    'finds nothing in %j',
    (header) => {
      expect(readCookie(header, 'session')).toBeUndefined();
    }
  );
});

describe('sessionCookieOptions', () => {
  it('is httpOnly, SameSite=Lax and site-wide', () => {
    expect(SESSION_COOKIE).toBe('session');
    expect(sessionCookieOptions(false)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    });
  });

  it('sets Secure when asked', () => {
    expect(sessionCookieOptions(true).secure).toBe(true);
  });
});
```

`apps/api/src/users/password-hasher.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { PASSWORD_MAX_LENGTH } from './password-policy.js';
import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes with Argon2id and verifies', async () => {
    const hashed = await hasher.hash('correct horse battery');

    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(hashed, 'correct horse battery')).toBe(true);
    expect(await hasher.verify(hashed, 'wrong horse battery')).toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    expect(await hasher.hash('correct horse battery')).not.toBe(
      await hasher.hash('correct horse battery')
    );
  });

  it('handles the longest allowed password and non-ASCII text', async () => {
    const long = 'ä'.repeat(PASSWORD_MAX_LENGTH);

    expect(await hasher.verify(await hasher.hash(long), long)).toBe(true);
  });

  it('never accepts an empty password for a real hash', async () => {
    expect(await hasher.verify(await hasher.hash('correct horse battery'), '')).toBe(false);
  });

  it('provides one reusable dummy hash that matches no realistic password', async () => {
    const first = await hasher.dummyHash();

    expect(await hasher.dummyHash()).toBe(first);
    expect(first.startsWith('$argon2id$')).toBe(true);
    expect(await hasher.verify(first, 'correct horse battery')).toBe(false);
  });
});
```

`apps/api/src/users/email.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { emailTransform, normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });
});

describe('emailTransform', () => {
  it('normalizes strings and passes everything else on for the validator to reject', () => {
    expect(emailTransform({ value: ' A@B.test ' })).toBe('a@b.test');
    expect(emailTransform({ value: 42 })).toBe(42);
    expect(emailTransform({ value: undefined })).toBeUndefined();
  });
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/auth src/users/email.spec.ts`
Expected: FAIL ("Cannot find module").

- [ ] **Step 4: Implementieren**

`apps/api/src/auth/tokens.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const API_KEY_PREFIX = 'sk-';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 256 bits, URL-safe: used for session tokens and CSRF tokens. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
```

`apps/api/src/auth/cookies.ts`:

```ts
import type { CookieOptions } from 'express';

export const SESSION_COOKIE = 'session';

/** Minimal Cookie header lookup: the first cookie with that name wins, malformed parts are skipped. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    const raw = part.slice(separator + 1).trim();
    const quoted = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
    const value = quoted ? raw.slice(1, -1) : raw;
    return value === '' ? undefined : value;
  }
  return undefined;
}

/** Same options for setting and clearing; the caller adds `expires` when setting. */
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}
```

`apps/api/src/users/password-hasher.ts`:

```ts
import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Argon2id with the library defaults (m=19456 KiB, t=2, p=1: the OWASP minimum). A malformed stored hash makes
 * `verify` throw; that is a data problem and surfaces as a 500 instead of a silent "wrong password".
 */
@Injectable()
export class PasswordHasher {
  private dummy: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password);
  }

  verify(hashed: string, password: string): Promise<boolean> {
    return verify(hashed, password);
  }

  /** Verifying against this takes as long as a real check: used when the account does not exist. */
  dummyHash(): Promise<string> {
    this.dummy ??= hash('a password nobody has');
    return this.dummy;
  }
}
```

`apps/api/src/users/email.ts`:

```ts
/** Emails are compared and stored lower-case, so "Ada@Example.com " and "ada@example.com" are one account. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** class-transformer hook; non-strings pass through so the validator reports them. */
export function emailTransform({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? normalizeEmail(value) : value;
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/auth src/users/email.spec.ts`
Expected: PASS. Meldet TypeScript, dass `@node-rs/argon2` kein `hash` mit der Signatur `(password: string)` hat, die Typen in `node_modules/@node-rs/argon2/index.d.ts` lesen (die Optionen sind optional).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/auth apps/api/src/users/email.ts apps/api/src/users/email.spec.ts
git commit -m "feat(api): add token, cookie, password and email helpers" -m "Adds @node-rs/argon2 (prebuilt binaries, no install script) for Argon2id hashing." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Session- und API-Key-Dienste

**Files:**
- Create: `apps/api/src/testing/db-fixtures.ts`, `apps/api/src/auth/session.service.ts`, `apps/api/src/auth/session.service.db.spec.ts`, `apps/api/src/auth/api-key.service.ts`, `apps/api/src/auth/api-key.service.db.spec.ts`

**Interfaces:**
- Consumes: `Session`, `ApiKey`, `User` (Task 2); `generateToken`, `generateApiKey`, `sha256Hex` (Task 3); `Env.SESSION_LIFETIME_HOURS`.
- Produces:
  - `insertUser(dataSource: DataSource, overrides?: Partial<Pick<User, 'email' | 'name' | 'role' | 'passwordHash' | 'disabledAt'>>): Promise<User>`, `resetAuthTables(dataSource: DataSource): Promise<void>`
  - `IssuedSession { id: string; token: string; csrfToken: string; expiresAt: Date }`
  - `SessionService`: `issue(userId: string, now?: Date): Promise<IssuedSession>`, `resolve(token: string, now?: Date): Promise<Session | null>` (mit geladenem `user`), `revoke(sessionId: string): Promise<void>`, `revokeToken(token: string): Promise<void>`, `purgeExpired(userId: string, now?: Date): Promise<void>`
  - `CreatedApiKey { apiKey: ApiKey; key: string }`
  - `ApiKeyService`: `create(userId: string, name: string, expiresAt?: Date | null): Promise<CreatedApiKey>`, `list(userId: string): Promise<ApiKey[]>`, `revoke(userId: string, id: string, now?: Date): Promise<boolean>`, `resolve(key: string, now?: Date): Promise<ApiKey | null>` (mit geladenem `user`)

- [ ] **Step 1: Testhilfen schreiben**

`apps/api/src/testing/db-fixtures.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

import { User } from '../users/user.entity.js';
import { USER_ROLE } from '../users/user-role.js';

/** Test databases are shared between spec files (they run one after another): start every test from zero users. */
export async function resetAuthTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE app_user CASCADE');
}

export async function insertUser(
  dataSource: DataSource,
  overrides: Partial<Pick<User, 'email' | 'name' | 'role' | 'passwordHash' | 'disabledAt'>> = {}
): Promise<User> {
  const repository = dataSource.getRepository(User);
  return repository.save(
    repository.create({
      email: `${randomUUID()}@example.com`,
      name: 'Test User',
      passwordHash: 'not-a-real-hash',
      role: USER_ROLE.USER,
      disabledAt: null,
      ...overrides,
    })
  );
}
```

- [ ] **Step 2: Fehlschlagende Tests schreiben**

`apps/api/src/auth/session.service.db.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import type { Env } from '../config/env.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { insertUser, resetAuthTables } from '../testing/db-fixtures.js';
import { Session } from './session.entity.js';
import { SessionService } from './session.service.js';
import { sha256Hex } from './tokens.js';

describe('SessionService (database)', () => {
  let dataSource: DataSource;
  let service: SessionService;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
    service = new SessionService(
      dataSource.getRepository(Session),
      new ConfigService<Env, true>({ SESSION_LIFETIME_HOURS: 1 })
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetAuthTables(dataSource);
  });

  it('issues a session and resolves it with its user', async () => {
    const user = await insertUser(dataSource);

    const issued = await service.issue(user.id);
    const resolved = await service.resolve(issued.token);

    expect(resolved?.id).toBe(issued.id);
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.csrfToken).toBe(issued.csrfToken);
  });

  it('stores only the hash of the token', async () => {
    const user = await insertUser(dataSource);

    const issued = await service.issue(user.id);

    const row = await dataSource.getRepository(Session).findOneByOrFail({ id: issued.id });
    expect(row.tokenHash).toBe(sha256Hex(issued.token));
    expect(row.tokenHash).not.toContain(issued.token);
  });

  it('expires after the configured lifetime', async () => {
    const user = await insertUser(dataSource);
    const now = new Date();
    const issued = await service.issue(user.id, now);

    expect(issued.expiresAt.getTime() - now.getTime()).toBe(3_600_000);
    expect(await service.resolve(issued.token, new Date(now.getTime() + 3_599_000))).not.toBeNull();
    expect(await service.resolve(issued.token, new Date(now.getTime() + 3_601_000))).toBeNull();
  });

  it.each(['', 'unknown-token', 'x'.repeat(10_000)])('resolves nothing for %j', async (token) => {
    expect(await service.resolve(token)).toBeNull();
  });

  it('revokes by id and by token', async () => {
    const user = await insertUser(dataSource);
    const byId = await service.issue(user.id);
    const byToken = await service.issue(user.id);

    await service.revoke(byId.id);
    await service.revokeToken(byToken.token);

    expect(await service.resolve(byId.token)).toBeNull();
    expect(await service.resolve(byToken.token)).toBeNull();
  });

  it('touches lastUsedAt at most once per minute', async () => {
    const user = await insertUser(dataSource);
    const start = new Date();
    const issued = await service.issue(user.id, start);
    const repository = dataSource.getRepository(Session);

    await service.resolve(issued.token, new Date(start.getTime() + 30_000));
    expect((await repository.findOneByOrFail({ id: issued.id })).lastUsedAt.getTime()).toBe(
      start.getTime()
    );

    const later = new Date(start.getTime() + 120_000);
    await service.resolve(issued.token, later);
    expect((await repository.findOneByOrFail({ id: issued.id })).lastUsedAt.getTime()).toBe(
      later.getTime()
    );
  });

  it("purges only the user's expired sessions", async () => {
    const user = await insertUser(dataSource);
    const other = await insertUser(dataSource);
    const past = new Date(Date.now() - 7_200_000);
    await service.issue(user.id, past);
    await service.issue(other.id, past);
    const alive = await service.issue(user.id);

    await service.purgeExpired(user.id);

    const remaining = await dataSource.getRepository(Session).find();
    expect(remaining.map((row) => row.userId).sort()).toEqual([user.id, other.id].sort());
    expect(await service.resolve(alive.token)).not.toBeNull();
  });
});
```

`apps/api/src/auth/api-key.service.db.spec.ts`:

```ts
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { insertUser, resetAuthTables } from '../testing/db-fixtures.js';
import { ApiKey } from './api-key.entity.js';
import { ApiKeyService } from './api-key.service.js';
import { sha256Hex } from './tokens.js';

describe('ApiKeyService (database)', () => {
  let dataSource: DataSource;
  let service: ApiKeyService;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
    service = new ApiKeyService(dataSource.getRepository(ApiKey));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetAuthTables(dataSource);
  });

  it('creates a key that is shown once and stored only as a hash', async () => {
    const user = await insertUser(dataSource);

    const { apiKey, key } = await service.create(user.id, 'ci');

    expect(key).toMatch(/^sk-[0-9a-f]{64}$/);
    expect(apiKey.prefix).toBe(key.slice(0, 8));
    const row = await dataSource.getRepository(ApiKey).findOneByOrFail({ id: apiKey.id });
    expect(row.keyHash).toBe(sha256Hex(key));
    expect(JSON.stringify(row)).not.toContain(key);
  });

  it('resolves a valid key with its user', async () => {
    const user = await insertUser(dataSource);
    const { key } = await service.create(user.id, 'ci');

    const resolved = await service.resolve(key);

    expect(resolved?.user.id).toBe(user.id);
  });

  it.each(['', 'sk-unknown', `sk-${'0'.repeat(64)}`])('resolves nothing for %j', async (key) => {
    expect(await service.resolve(key)).toBeNull();
  });

  it('refuses revoked and expired keys', async () => {
    const user = await insertUser(dataSource);
    const revoked = await service.create(user.id, 'revoked');
    const expired = await service.create(user.id, 'expired', new Date(Date.now() - 1000));
    const future = await service.create(user.id, 'future', new Date(Date.now() + 3_600_000));
    await service.revoke(user.id, revoked.apiKey.id);

    expect(await service.resolve(revoked.key)).toBeNull();
    expect(await service.resolve(expired.key)).toBeNull();
    expect(await service.resolve(future.key)).not.toBeNull();
  });

  it("lists only the caller's own active keys", async () => {
    const ada = await insertUser(dataSource);
    const bob = await insertUser(dataSource);
    const adas = await service.create(ada.id, 'ada key');
    await service.create(bob.id, 'bob key');
    const gone = await service.create(ada.id, 'gone');
    await service.revoke(ada.id, gone.apiKey.id);

    const listed = await service.list(ada.id);

    expect(listed.map((row) => row.id)).toEqual([adas.apiKey.id]);
  });

  it("cannot revoke somebody else's key (the owner check is part of the SQL)", async () => {
    const ada = await insertUser(dataSource);
    const bob = await insertUser(dataSource);
    const { apiKey, key } = await service.create(ada.id, 'ada key');

    const revoked = await service.revoke(bob.id, apiKey.id);

    expect(revoked).toBe(false);
    expect(await service.resolve(key)).not.toBeNull();
  });

  it('reports false when revoking twice', async () => {
    const user = await insertUser(dataSource);
    const { apiKey } = await service.create(user.id, 'ci');

    expect(await service.revoke(user.id, apiKey.id)).toBe(true);
    expect(await service.revoke(user.id, apiKey.id)).toBe(false);
  });

  it('touches lastUsedAt at most once per minute', async () => {
    const user = await insertUser(dataSource);
    const { apiKey, key } = await service.create(user.id, 'ci');
    const repository = dataSource.getRepository(ApiKey);
    const start = new Date();

    await service.resolve(key, start);
    await service.resolve(key, new Date(start.getTime() + 30_000));
    expect((await repository.findOneByOrFail({ id: apiKey.id })).lastUsedAt?.getTime()).toBe(
      start.getTime()
    );

    const later = new Date(start.getTime() + 120_000);
    await service.resolve(key, later);
    expect((await repository.findOneByOrFail({ id: apiKey.id })).lastUsedAt?.getTime()).toBe(
      later.getTime()
    );
  });
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/auth`
Expected: FAIL ("Cannot find module './session.service.js'").

- [ ] **Step 4: Implementieren**

`apps/api/src/auth/session.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, Repository } from 'typeorm';

import type { Env } from '../config/env.js';
import { Session } from './session.entity.js';
import { generateToken, sha256Hex } from './tokens.js';

const TOUCH_INTERVAL_MS = 60_000;

export interface IssuedSession {
  id: string;
  /** The only copy of the token: it goes into the cookie and is never stored. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

@Injectable()
export class SessionService {
  private readonly lifetimeMs: number;

  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    config: ConfigService<Env, true>
  ) {
    this.lifetimeMs = config.get('SESSION_LIFETIME_HOURS', { infer: true }) * 3_600_000;
  }

  async issue(userId: string, now = new Date()): Promise<IssuedSession> {
    const token = generateToken();
    const csrfToken = generateToken();
    const expiresAt = new Date(now.getTime() + this.lifetimeMs);
    const row = await this.sessions.save(
      this.sessions.create({ userId, tokenHash: sha256Hex(token), csrfToken, expiresAt, lastUsedAt: now })
    );
    return { id: row.id, token, csrfToken, expiresAt };
  }

  /** The session with its user, or null when the token is unknown or expired. */
  async resolve(token: string, now = new Date()): Promise<Session | null> {
    const session = await this.sessions.findOne({
      where: { tokenHash: sha256Hex(token), expiresAt: MoreThan(now) },
      relations: { user: true },
    });
    if (session === null) return null;
    // Reads stay cheap: write the timestamp at most once per minute and session.
    await this.sessions.update(
      { id: session.id, lastUsedAt: LessThan(new Date(now.getTime() - TOUCH_INTERVAL_MS)) },
      { lastUsedAt: now }
    );
    return session;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.sessions.delete({ id: sessionId });
  }

  async revokeToken(token: string): Promise<void> {
    await this.sessions.delete({ tokenHash: sha256Hex(token) });
  }

  /** Expired rows are removed when their owner signs in again; no background job needed. */
  async purgeExpired(userId: string, now = new Date()): Promise<void> {
    await this.sessions.delete({ userId, expiresAt: LessThan(now) });
  }
}
```

`apps/api/src/auth/api-key.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';

import { ApiKey } from './api-key.entity.js';
import { generateApiKey, sha256Hex } from './tokens.js';

const TOUCH_INTERVAL_MS = 60_000;
const PREFIX_LENGTH = 8;

export interface CreatedApiKey {
  apiKey: ApiKey;
  /** The only copy of the key: shown once, never stored. */
  key: string;
}

@Injectable()
export class ApiKeyService {
  constructor(@InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>) {}

  async create(userId: string, name: string, expiresAt: Date | null = null): Promise<CreatedApiKey> {
    const key = generateApiKey();
    const apiKey = await this.keys.save(
      this.keys.create({
        userId,
        name,
        keyHash: sha256Hex(key),
        prefix: key.slice(0, PREFIX_LENGTH),
        expiresAt,
        revokedAt: null,
        lastUsedAt: null,
      })
    );
    return { apiKey, key };
  }

  list(userId: string): Promise<ApiKey[]> {
    return this.keys.find({ where: { userId, revokedAt: IsNull() }, order: { createdAt: 'DESC' } });
  }

  /** True when the key belonged to the user and is now revoked. The owner check is part of the SQL. */
  async revoke(userId: string, id: string, now = new Date()): Promise<boolean> {
    const result = await this.keys.update({ id, userId, revokedAt: IsNull() }, { revokedAt: now });
    return (result.affected ?? 0) > 0;
  }

  /** The key with its user, or null when it is unknown, revoked or expired. */
  async resolve(key: string, now = new Date()): Promise<ApiKey | null> {
    const keyHash = sha256Hex(key);
    const found = await this.keys.findOne({
      where: [
        { keyHash, revokedAt: IsNull(), expiresAt: IsNull() },
        { keyHash, revokedAt: IsNull(), expiresAt: MoreThan(now) },
      ],
      relations: { user: true },
    });
    if (found === null) return null;
    await this.keys
      .createQueryBuilder()
      .update()
      .set({ lastUsedAt: now })
      .where('id = :id', { id: found.id })
      .andWhere('(last_used_at IS NULL OR last_used_at < :threshold)', {
        threshold: new Date(now.getTime() - TOUCH_INTERVAL_MS),
      })
      .execute();
    return found;
  }
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/auth`
Expected: PASS. Schlägt der `lastUsedAt`-Test um Millisekunden fehl (Postgres speichert Mikrosekunden, JS Millisekunden), ist das ein Testfehler: dann nur auf Gleichheit der Sekunden prüfen, nicht die Implementierung ändern.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/testing apps/api/src/auth
git commit -m "feat(api): add session and api key services" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: AuthGuard und Dekoratoren

**Files:**
- Create: `apps/api/src/auth/auth-context.ts`, `apps/api/src/auth/decorators.ts`, `apps/api/src/auth/auth.guard.ts`, `apps/api/src/auth/auth.guard.spec.ts`

**Interfaces:**
- Consumes: `SessionService.resolve`, `ApiKeyService.resolve` (Task 4); `readCookie`, `SESSION_COOKIE`, `safeEqual`, `API_KEY_PREFIX`; `USER_ROLE`.
- Produces:
  - `AuthContext { user: User; session: Session | null; apiKey: ApiKey | null }`, `AuthenticatedRequest extends Request { auth?: AuthContext }`
  - Dekoratoren `Public()`, `AllowPending()`, `SessionOnly()`, `Roles(...roles: UserRole[])`; Parameter-Dekoratoren `CurrentAuth()` (liefert `AuthContext`) und `CurrentUser()` (liefert `User`)
  - `AuthGuard`: geschlossen per Standard. 401 ohne gültige Anmeldung oder bei gesperrtem Konto, 403 für `pending` (außer `@AllowPending()` mit Session; ein API-Key eines `pending`-Kontos kommt nirgends durch), für zu geringe Rolle, für API-Keys auf `@SessionOnly()` und auf Routen mit `@Roles(USER_ROLE.ADMIN)`, und für schreibende Session-Anfragen ohne passenden `X-CSRF-Token`.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`apps/api/src/auth/auth.guard.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Controller, Get, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../testing/create-test-app.js';
import { User } from '../users/user.entity.js';
import { USER_ROLE, type UserRole } from '../users/user-role.js';
import { ApiKey } from './api-key.entity.js';
import { ApiKeyService } from './api-key.service.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthContext } from './auth-context.js';
import { CurrentAuth, CurrentUser, AllowPending, Public, Roles, SessionOnly } from './decorators.js';
import { Session } from './session.entity.js';
import { SessionService } from './session.service.js';

@Controller()
class ProbeController {
  @Public()
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('private')
  privateRoute(): { ok: true } {
    return { ok: true };
  }

  @Get('whoami')
  whoami(@CurrentUser() user: User, @CurrentAuth() auth: AuthContext): object {
    return { id: user.id, viaKey: auth.apiKey !== null };
  }

  @AllowPending()
  @Get('pending-ok')
  pendingOk(): { ok: true } {
    return { ok: true };
  }

  @Roles(USER_ROLE.ADMIN)
  @Get('admin')
  admin(): { ok: true } {
    return { ok: true };
  }

  @SessionOnly()
  @Get('session-only')
  sessionOnly(): { ok: true } {
    return { ok: true };
  }

  @Post('write')
  write(): { ok: true } {
    return { ok: true };
  }
}

const API_KEY = `sk-${'a'.repeat(64)}`;
const PENDING_API_KEY = `sk-${'c'.repeat(64)}`;

function makeUser(role: UserRole, overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: randomUUID(),
    email: `${role}@example.com`,
    name: role,
    passwordHash: 'x',
    role,
    disabledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function makeSession(user: User, csrfToken: string): Session {
  return Object.assign(new Session(), {
    id: randomUUID(),
    userId: user.id,
    user,
    tokenHash: 'h',
    csrfToken,
    expiresAt: new Date(Date.now() + 60_000),
    lastUsedAt: new Date(),
    createdAt: new Date(),
  });
}

describe('AuthGuard', () => {
  let app: NestExpressApplication;
  const sessions = new Map<string, Session>();
  const keys = new Map<string, ApiKey>();
  const users = {
    user: makeUser(USER_ROLE.USER),
    admin: makeUser(USER_ROLE.ADMIN),
    pending: makeUser(USER_ROLE.PENDING),
    disabled: makeUser(USER_ROLE.USER, { disabledAt: new Date() }),
  };

  beforeEach(() => {
    sessions.clear();
    keys.clear();
    for (const [name, user] of Object.entries(users)) {
      sessions.set(`tok-${name}`, makeSession(user, `csrf-${name}`));
    }
    keys.set(
      API_KEY,
      Object.assign(new ApiKey(), { id: randomUUID(), userId: users.admin.id, user: users.admin })
    );
    keys.set(
      PENDING_API_KEY,
      Object.assign(new ApiKey(), { id: randomUUID(), userId: users.pending.id, user: users.pending })
    );
  });

  afterEach(async () => {
    await app.close();
  });

  async function start(env: Record<string, string> = {}): Promise<ReturnType<typeof request>> {
    app = await createTestApp({
      controllers: [ProbeController],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: SessionService, useValue: { resolve: (t: string) => Promise.resolve(sessions.get(t) ?? null) } },
        { provide: ApiKeyService, useValue: { resolve: (k: string) => Promise.resolve(keys.get(k) ?? null) } },
      ],
      env: { RATE_LIMIT_LIMIT: '1000', ENABLE_API_KEYS: 'true', ...env },
    });
    return request(app.getHttpServer());
  }

  describe('closed by default', () => {
    it('lets public routes through without credentials', async () => {
      const http = await start();

      await http.get('/api/open').expect(200);
    });

    it('answers 401 problem details on a route without any decorator', async () => {
      const http = await start();

      const response = await http.get('/api/private').expect(401);

      expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    });

    it.each([
      '',
      'session=',
      'session',
      ';',
      'other=1',
      'session=unknown',
      `session=${'x'.repeat(5000)}`,
    ])('answers 401, never 500, for the cookie header %j', async (cookie) => {
      const http = await start();

      await http.get('/api/private').set('Cookie', cookie).expect(401);
    });
  });

  describe('session login', () => {
    it('accepts a valid session and exposes the user to handlers', async () => {
      const http = await start();

      const response = await http.get('/api/whoami').set('Cookie', 'session=tok-user').expect(200);

      expect(response.body).toEqual({ id: users.user.id, viaKey: false });
    });

    it('rejects a disabled account with 401 even when its session row survived', async () => {
      const http = await start();

      await http.get('/api/private').set('Cookie', 'session=tok-disabled').expect(401);
    });
  });

  describe('roles', () => {
    it('keeps pending accounts out of everything except routes marked AllowPending', async () => {
      const http = await start();

      await http.get('/api/private').set('Cookie', 'session=tok-pending').expect(403);
      await http.get('/api/pending-ok').set('Cookie', 'session=tok-pending').expect(200);
    });

    it('keeps pending accounts out even with an API key, also on routes marked AllowPending', async () => {
      const http = await start();

      await http.get('/api/pending-ok').set('Authorization', `Bearer ${PENDING_API_KEY}`).expect(403);
      await http.get('/api/private').set('Authorization', `Bearer ${PENDING_API_KEY}`).expect(403);
    });

    it('lets only admins into admin routes', async () => {
      const http = await start();

      await http.get('/api/admin').set('Cookie', 'session=tok-user').expect(403);
      await http.get('/api/admin').set('Cookie', 'session=tok-admin').expect(200);
    });
  });

  describe('csrf', () => {
    it('requires the matching X-CSRF-Token for writes made with a cookie', async () => {
      const http = await start();

      await http.post('/api/write').set('Cookie', 'session=tok-user').expect(403);
      await http
        .post('/api/write')
        .set('Cookie', 'session=tok-user')
        .set('X-CSRF-Token', 'csrf-admin')
        .expect(403);
      await http
        .post('/api/write')
        .set('Cookie', 'session=tok-user')
        .set('X-CSRF-Token', 'csrf-user')
        .expect(201);
    });

    it('does not ask for it on reads', async () => {
      const http = await start();

      await http.get('/api/private').set('Cookie', 'session=tok-user').expect(200);
    });
  });

  describe('api keys', () => {
    it('accepts a bearer key (scheme in any case) and needs no CSRF token', async () => {
      const http = await start();

      const response = await http.get('/api/whoami').set('Authorization', `Bearer ${API_KEY}`).expect(200);
      expect(response.body).toEqual({ id: users.admin.id, viaKey: true });
      await http.get('/api/private').set('Authorization', `bearer ${API_KEY}`).expect(200);
      await http.post('/api/write').set('Authorization', `Bearer ${API_KEY}`).expect(201);
    });

    it('never reaches admin routes or session-only routes, even with an admin key', async () => {
      const http = await start();

      await http.get('/api/admin').set('Authorization', `Bearer ${API_KEY}`).expect(403);
      await http.get('/api/session-only').set('Authorization', `Bearer ${API_KEY}`).expect(403);
    });

    it('is off while ENABLE_API_KEYS is false', async () => {
      const http = await start({ ENABLE_API_KEYS: 'false' });

      await http.get('/api/private').set('Authorization', `Bearer ${API_KEY}`).expect(401);
    });

    it.each([
      ['an unknown key', `Bearer sk-${'b'.repeat(64)}`],
      ['the wrong scheme', `Basic ${API_KEY}`],
      ['no key at all', 'Bearer'],
      ['a session token in the key slot', 'Bearer tok-admin'],
    ])('rejects %s with 401', async (_name, header) => {
      const http = await start();

      await http.get('/api/private').set('Authorization', header).expect(401);
    });

    it('ignores the key in x-api-key and in the query string', async () => {
      const http = await start();

      await http.get('/api/private').set('x-api-key', API_KEY).expect(401);
      await http.get(`/api/private?api_key=${API_KEY}`).expect(401);
    });

    it('does not fall back to the cookie when the Authorization header is wrong', async () => {
      const http = await start();

      await http
        .get('/api/private')
        .set('Authorization', 'Bearer sk-nope')
        .set('Cookie', 'session=tok-user')
        .expect(401);
    });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/auth/auth.guard.spec.ts`
Expected: FAIL (Module fehlen).

- [ ] **Step 3: Implementieren**

`apps/api/src/auth/auth-context.ts`:

```ts
import type { Request } from 'express';

import type { User } from '../users/user.entity.js';
import type { ApiKey } from './api-key.entity.js';
import type { Session } from './session.entity.js';

/** Who is calling and how: exactly one of `session` and `apiKey` is set. */
export interface AuthContext {
  user: User;
  session: Session | null;
  apiKey: ApiKey | null;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}
```

`apps/api/src/auth/decorators.ts`:

```ts
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

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  authFrom(context).user
);
```

`apps/api/src/auth/auth.guard.ts`:

```ts
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
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/auth/auth.guard.spec.ts`
Expected: PASS. Hinweis: Der Bearer-Test mit `'Bearer sk-nope'` (Format ungültig) und der Test mit dem Session-Token im Key-Platz laufen über `KEY_FORMAT` in 401, ohne den Dienst zu fragen.

- [ ] **Step 5: Mutation prüfen (Beleg, dass die Tests den Guard bewachen)**

Ändere kurz in `auth.guard.ts` die erste Zeile von `canActivate` zu `return true;` und führe den Test aus. Erwartet: viele rote Tests. Danach die Änderung zurücknehmen (`git checkout apps/api/src/auth/auth.guard.ts` geht nicht, die Datei ist neu: mit dem Editor zurücksetzen) und den Test erneut grün sehen.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth
git commit -m "feat(api): add closed-by-default auth guard with roles, api keys and csrf" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: UsersService (Registrierung, erster Admin, letzter Admin)

**Files:**
- Create: `apps/api/src/users/users.service.ts`, `apps/api/src/users/users.service.db.spec.ts`

**Interfaces:**
- Consumes: `User`, `Session` (Task 2); `normalizeEmail` (Task 3); `AuditService.record(event)` und `AUDIT_ACTION` (Task 1).
- Produces:
  - Typen `NewUser { email: string; name: string; passwordHash: string }`, `SignupPolicy { signupEnabled: boolean; defaultRole: 'pending' | 'user' }`, `UserPatch { name?: string; role?: UserRole; disabled?: boolean }`
  - `UsersService` (`@Injectable`, Konstruktor `(dataSource: DataSource, audit: AuditService)`):
    - `findById(id: string): Promise<User | null>`, `findByEmail(email: string): Promise<User | null>`, `list(): Promise<User[]>`
    - `registerSelf(input: NewUser, policy: SignupPolicy): Promise<User>`: wirft `ForbiddenException`, wenn Registrierung aus ist und schon Nutzer existieren; `ConflictException` bei bekannter E-Mail. Der erste Nutzer wird `admin`.
    - `bootstrapAdmin(input: NewUser): Promise<User | null>`: legt nur bei null Nutzern einen Admin an, sonst `null`.
    - `createByAdmin(actorId: string, input: NewUser & { role: UserRole }): Promise<User>`
    - `update(actorId: string, id: string, patch: UserPatch): Promise<User>`: `NotFoundException`, `ConflictException` beim letzten aktiven Admin; Sperren löscht alle Sessions.
    - `setPassword(id: string, passwordHash: string, keepSessionId?: string): Promise<void>`: löscht alle Sessions des Nutzers außer `keepSessionId`.
    - `resetPassword(actorId: string, id: string, passwordHash: string): Promise<void>` (setzt das Passwort, löscht alle Sessions, schreibt Audit)
    - `remove(actorId: string, id: string): Promise<void>`

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`apps/api/src/users/users.service.db.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ApiKey } from '../auth/api-key.entity.js';
import { Session } from '../auth/session.entity.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditLog } from '../database/audit/audit-log.entity.js';
import { AuditService } from '../database/audit/audit.service.js';
import { insertUser, resetAuthTables } from '../testing/db-fixtures.js';
import { User } from './user.entity.js';
import { USER_ROLE } from './user-role.js';
import { UsersService } from './users.service.js';

const OPEN = { signupEnabled: true, defaultRole: USER_ROLE.PENDING } as const;

function person(name: string) {
  return { email: `${name}@example.com`, name, passwordHash: 'hash' };
}

describe('UsersService (database)', () => {
  let dataSource: DataSource;
  let service: UsersService;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
    service = new UsersService(dataSource, new AuditService(dataSource.getRepository(AuditLog)));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetAuthTables(dataSource);
  });

  async function activeAdmins(): Promise<number> {
    return dataSource.getRepository(User).countBy({ role: USER_ROLE.ADMIN, disabledAt: IsNull() });
  }

  async function insertSession(userId: string): Promise<string> {
    const result = await dataSource.getRepository(Session).insert({
      userId,
      tokenHash: randomUUID(),
      csrfToken: 'csrf',
      expiresAt: new Date(Date.now() + 60_000),
    });
    return (result.identifiers[0] as { id: string }).id;
  }

  describe('registerSelf', () => {
    it('makes the first account an admin even when sign-up is off, and stores the email normalized', async () => {
      const first = await service.registerSelf(
        { ...person('ada'), email: '  Ada@Example.COM ' },
        { signupEnabled: false, defaultRole: USER_ROLE.PENDING }
      );

      expect(first.role).toBe(USER_ROLE.ADMIN);
      expect(first.email).toBe('ada@example.com');
    });

    it('refuses later accounts while sign-up is off', async () => {
      await service.registerSelf(person('ada'), OPEN);

      await expect(
        service.registerSelf(person('bob'), { signupEnabled: false, defaultRole: USER_ROLE.USER })
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each([USER_ROLE.PENDING, USER_ROLE.USER])('gives later accounts the default role %s', async (role) => {
      await service.registerSelf(person('ada'), OPEN);

      const bob = await service.registerSelf(person('bob'), { signupEnabled: true, defaultRole: role });

      expect(bob.role).toBe(role);
    });

    it('treats the same email in another case as taken', async () => {
      await service.registerSelf(person('ada'), OPEN);

      await expect(
        service.registerSelf({ ...person('ada'), email: ' ADA@example.com' }, OPEN)
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates exactly one admin when five people register at the same moment', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, index) => service.registerSelf(person(`p${index}`), OPEN))
      );

      expect(results.filter((user) => user.role === USER_ROLE.ADMIN)).toHaveLength(1);
      expect(await dataSource.getRepository(User).count()).toBe(5);
    });
  });

  describe('bootstrapAdmin', () => {
    it('creates an admin only while there is no user, and audits it without personal data', async () => {
      const created = await service.bootstrapAdmin(person('root'));
      const second = await service.bootstrapAdmin(person('other'));

      expect(created?.role).toBe(USER_ROLE.ADMIN);
      expect(second).toBeNull();
      const audit = await dataSource
        .getRepository(AuditLog)
        .findBy({ action: AUDIT_ACTION.USER_CREATED, targetId: created?.id });
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit[0]?.metadata)).not.toContain('root@example.com');
    });
  });

  describe('createByAdmin', () => {
    it('creates an account with the given role and audits the actor', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      const created = await service.createByAdmin(admin.id, { ...person('bob'), role: USER_ROLE.USER });

      expect(created.role).toBe(USER_ROLE.USER);
      const audit = await dataSource.getRepository(AuditLog).findBy({ targetId: created.id });
      expect(audit.map((row) => row.actorId)).toEqual([admin.id]);
    });

    it('refuses a known email', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      await service.createByAdmin(admin.id, { ...person('bob'), role: USER_ROLE.USER });

      await expect(
        service.createByAdmin(admin.id, { ...person('bob'), role: USER_ROLE.USER })
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('reports an unknown id', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      await expect(service.update(admin.id, randomUUID(), { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException
      );
    });

    it('changes role and name and records the old and new role', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      const bob = await insertUser(dataSource, { role: USER_ROLE.PENDING });

      const updated = await service.update(admin.id, bob.id, { role: USER_ROLE.USER, name: 'Bob' });

      expect(updated).toMatchObject({ role: USER_ROLE.USER, name: 'Bob' });
      const audit = await dataSource
        .getRepository(AuditLog)
        .findOneByOrFail({ action: AUDIT_ACTION.USER_ROLE_CHANGED, targetId: bob.id });
      expect(audit.metadata).toEqual({ from: USER_ROLE.PENDING, to: USER_ROLE.USER });
      expect(audit.actorId).toBe(admin.id);
    });

    it('never demotes or disables the last active admin', async () => {
      const only = await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      await expect(service.update(only.id, only.id, { role: USER_ROLE.USER })).rejects.toBeInstanceOf(
        ConflictException
      );
      await expect(service.update(only.id, only.id, { disabled: true })).rejects.toBeInstanceOf(
        ConflictException
      );
      expect(await activeAdmins()).toBe(1);
    });

    it('lets an admin step down when another active admin exists', async () => {
      const first = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      await service.update(first.id, first.id, { role: USER_ROLE.USER });

      expect(await activeAdmins()).toBe(1);
    });

    it('does not count a disabled admin as the other admin', async () => {
      const first = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      await insertUser(dataSource, { role: USER_ROLE.ADMIN, disabledAt: new Date() });

      await expect(service.update(first.id, first.id, { role: USER_ROLE.USER })).rejects.toBeInstanceOf(
        ConflictException
      );
    });

    it('keeps at least one admin when two admins demote each other at the same moment', async () => {
      const a = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      const b = await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      const results = await Promise.allSettled([
        service.update(a.id, b.id, { role: USER_ROLE.USER }),
        service.update(b.id, a.id, { role: USER_ROLE.USER }),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await activeAdmins()).toBe(1);
    });

    it('signs a disabled account out everywhere and lets it back in when enabled again', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      const bob = await insertUser(dataSource);
      await insertSession(bob.id);
      await insertSession(bob.id);

      const disabled = await service.update(admin.id, bob.id, { disabled: true });
      expect(disabled.disabledAt).toBeInstanceOf(Date);
      expect(await dataSource.getRepository(Session).countBy({ userId: bob.id })).toBe(0);

      const enabled = await service.update(admin.id, bob.id, { disabled: false });
      expect(enabled.disabledAt).toBeNull();
    });
  });

  describe('setPassword and resetPassword', () => {
    it('signs out every other session and keeps the named one', async () => {
      const bob = await insertUser(dataSource);
      const keep = await insertSession(bob.id);
      await insertSession(bob.id);

      await service.setPassword(bob.id, 'new-hash', keep);

      const remaining = await dataSource.getRepository(Session).findBy({ userId: bob.id });
      expect(remaining.map((row) => row.id)).toEqual([keep]);
      expect((await dataSource.getRepository(User).findOneByOrFail({ id: bob.id })).passwordHash).toBe(
        'new-hash'
      );
    });

    it('reports an unknown id', async () => {
      await expect(service.setPassword(randomUUID(), 'x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resets as admin, signs everything out and audits', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      const bob = await insertUser(dataSource);
      await insertSession(bob.id);

      await service.resetPassword(admin.id, bob.id, 'reset-hash');

      expect(await dataSource.getRepository(Session).countBy({ userId: bob.id })).toBe(0);
      const audit = await dataSource
        .getRepository(AuditLog)
        .findBy({ action: AUDIT_ACTION.USER_PASSWORD_RESET, targetId: bob.id });
      expect(audit).toHaveLength(1);
    });
  });

  describe('remove', () => {
    it('deletes an account with its sessions and keys', async () => {
      const admin = await insertUser(dataSource, { role: USER_ROLE.ADMIN });
      const bob = await insertUser(dataSource);
      await insertSession(bob.id);
      await dataSource.getRepository(ApiKey).insert({
        userId: bob.id,
        name: 'ci',
        keyHash: randomUUID(),
        prefix: 'sk-abcde',
      });

      await service.remove(admin.id, bob.id);

      expect(await service.findById(bob.id)).toBeNull();
      expect(await dataSource.getRepository(Session).count()).toBe(0);
      expect(await dataSource.getRepository(ApiKey).count()).toBe(0);
    });

    it('never deletes the last active admin and reports unknown ids', async () => {
      const only = await insertUser(dataSource, { role: USER_ROLE.ADMIN });

      await expect(service.remove(only.id, only.id)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.remove(only.id, randomUUID())).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
```

(`identifiers[0] as { id: string }`: TypeORM liefert die Primärschlüssel als lose getypte Objekte; die Zuweisung ist hier die einzige Stelle, an der eine Typangabe nötig ist. Gefällt dem Linter das nicht, stattdessen `repository.save(repository.create({...}))` verwenden und `.id` lesen.)

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/users`
Expected: FAIL ("Cannot find module './users.service.js'").

- [ ] **Step 3: Implementieren**

`apps/api/src/users/users.service.ts`:

```ts
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager, IsNull, Not } from 'typeorm';

import { Session } from '../auth/session.entity.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditService } from '../database/audit/audit.service.js';
import { normalizeEmail } from './email.js';
import { User } from './user.entity.js';
import { USER_ROLE, type UserRole } from './user-role.js';

/** One advisory lock serializes every write that depends on how many users or admins exist. */
const USERS_LOCK_KEY = 7101;

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
}

export interface SignupPolicy {
  signupEnabled: boolean;
  defaultRole: typeof USER_ROLE.PENDING | typeof USER_ROLE.USER;
}

export interface UserPatch {
  name?: string;
  role?: UserRole;
  disabled?: boolean;
}

function isActiveAdmin(user: User): boolean {
  return user.role === USER_ROLE.ADMIN && user.disabledAt === null;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService
  ) {}

  findById(id: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOneBy({ id });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.dataSource.getRepository(User).findOneBy({ email: normalizeEmail(email) });
  }

  list(): Promise<User[]> {
    return this.dataSource.getRepository(User).find({ order: { createdAt: 'ASC' } });
  }

  /** The first account ever becomes admin, whatever the sign-up setting; everybody else gets the default role. */
  async registerSelf(input: NewUser, policy: SignupPolicy): Promise<User> {
    const email = normalizeEmail(input.email);
    return this.withUserLock(async (manager) => {
      const existing = await manager.count(User);
      if (existing > 0 && !policy.signupEnabled) {
        throw new ForbiddenException('Sign-up is disabled');
      }
      await this.assertEmailFree(manager, email);
      return manager.save(
        manager.create(User, {
          email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: existing === 0 ? USER_ROLE.ADMIN : policy.defaultRole,
          disabledAt: null,
        })
      );
    });
  }

  async bootstrapAdmin(input: NewUser): Promise<User | null> {
    const email = normalizeEmail(input.email);
    const created = await this.withUserLock(async (manager) => {
      if ((await manager.count(User)) > 0) return null;
      return manager.save(
        manager.create(User, {
          email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: USER_ROLE.ADMIN,
          disabledAt: null,
        })
      );
    });
    if (created !== null) {
      await this.audit.record({
        action: AUDIT_ACTION.USER_CREATED,
        targetType: 'user',
        targetId: created.id,
        metadata: { role: USER_ROLE.ADMIN, source: 'environment' },
      });
    }
    return created;
  }

  async createByAdmin(actorId: string, input: NewUser & { role: UserRole }): Promise<User> {
    const email = normalizeEmail(input.email);
    const created = await this.withUserLock(async (manager) => {
      await this.assertEmailFree(manager, email);
      return manager.save(
        manager.create(User, {
          email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: input.role,
          disabledAt: null,
        })
      );
    });
    await this.audit.record({
      actorId,
      action: AUDIT_ACTION.USER_CREATED,
      targetType: 'user',
      targetId: created.id,
      metadata: { role: created.role },
    });
    return created;
  }

  async update(actorId: string, id: string, patch: UserPatch): Promise<User> {
    const { user, before } = await this.withUserLock(async (manager) => {
      const found = await manager.findOneBy(User, { id });
      if (found === null) throw new NotFoundException('User not found');
      const snapshot = { role: found.role, disabled: found.disabledAt !== null };

      const loosesAdmin =
        (patch.role !== undefined && patch.role !== USER_ROLE.ADMIN) || patch.disabled === true;
      if (isActiveAdmin(found) && loosesAdmin) await this.assertAnotherActiveAdmin(manager, id);

      if (patch.name !== undefined) found.name = patch.name;
      if (patch.role !== undefined) found.role = patch.role;
      if (patch.disabled !== undefined) found.disabledAt = patch.disabled ? new Date() : null;
      const saved = await manager.save(found);
      if (patch.disabled === true) await manager.delete(Session, { userId: id });
      return { user: saved, before: snapshot };
    });

    if (user.role !== before.role) {
      await this.audit.record({
        actorId,
        action: AUDIT_ACTION.USER_ROLE_CHANGED,
        targetType: 'user',
        targetId: id,
        metadata: { from: before.role, to: user.role },
      });
    }
    const disabled = user.disabledAt !== null;
    if (disabled !== before.disabled) {
      await this.audit.record({
        actorId,
        action: disabled ? AUDIT_ACTION.USER_DISABLED : AUDIT_ACTION.USER_ENABLED,
        targetType: 'user',
        targetId: id,
      });
    }
    return user;
  }

  async setPassword(id: string, passwordHash: string, keepSessionId?: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const result = await manager.update(User, { id }, { passwordHash });
      if ((result.affected ?? 0) === 0) throw new NotFoundException('User not found');
      await manager.delete(
        Session,
        keepSessionId === undefined ? { userId: id } : { userId: id, id: Not(keepSessionId) }
      );
    });
  }

  async resetPassword(actorId: string, id: string, passwordHash: string): Promise<void> {
    await this.setPassword(id, passwordHash);
    await this.audit.record({
      actorId,
      action: AUDIT_ACTION.USER_PASSWORD_RESET,
      targetType: 'user',
      targetId: id,
    });
  }

  async remove(actorId: string, id: string): Promise<void> {
    await this.withUserLock(async (manager) => {
      const found = await manager.findOneBy(User, { id });
      if (found === null) throw new NotFoundException('User not found');
      if (isActiveAdmin(found)) await this.assertAnotherActiveAdmin(manager, id);
      await manager.delete(User, { id });
    });
    await this.audit.record({
      actorId,
      action: AUDIT_ACTION.USER_DELETED,
      targetType: 'user',
      targetId: id,
    });
  }

  private withUserLock<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [USERS_LOCK_KEY]);
      return work(manager);
    });
  }

  private async assertEmailFree(manager: EntityManager, email: string): Promise<void> {
    if (await manager.existsBy(User, { email })) {
      throw new ConflictException('This email is already registered');
    }
  }

  private async assertAnotherActiveAdmin(manager: EntityManager, excludingId: string): Promise<void> {
    const others = await manager.countBy(User, {
      role: USER_ROLE.ADMIN,
      disabledAt: IsNull(),
      id: Not(excludingId),
    });
    if (others === 0) throw new ConflictException('At least one active admin is required');
  }
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/users`
Expected: PASS. Kennt TypeORM `existsBy`/`countBy` in der installierten Version nicht, in `node_modules/typeorm` die Methoden von `EntityManager` nachsehen und durch `exists({ where })`/`count({ where })` ersetzen.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/users
git commit -m "feat(api): add users service with first-admin and last-admin protection" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Auth-Routen (Registrieren, Anmelden, Abmelden, Passwort, Ich)

**Files:**
- Create: `apps/api/src/auth/attempt-limiter.ts`, `apps/api/src/auth/attempt-limiter.spec.ts`, `apps/api/src/users/users.dto.ts`, `apps/api/src/auth/auth.dto.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/src/users/users.module.ts`, `apps/api/src/testing/create-db-test-app.ts`, `apps/api/src/testing/http-session.ts`, `apps/api/src/auth/auth.db.spec.ts`

**Interfaces:**
- Consumes: `UsersService` (Task 6), `SessionService`/`IssuedSession`, `PasswordHasher`, `AuthGuard`, Dekoratoren (Task 4/5), `AuditService`, `emailTransform`, `readCookie`, `sessionCookieOptions`, `SESSION_COOKIE`.
- Produces:
  - `AttemptLimiter`: `assertAllowed(key: string, limit: number, now?: number): void` (wirft HTTP 429), `record(key: string, now?: number): void`, `reset(key: string): void`, `trackedKeys: number`
  - `UserDto { id; email; name; role: UserRole; disabled: boolean; createdAt: string }`, `toUserDto(user: User): UserDto`, `trimTransform`
  - `SessionInfoDto { user: UserDto; csrfToken: string | null }`
  - `AuthService`: `signup(input: { email; name; password }, client: ClientContext): Promise<AuthResult>`, `login(input: { email; password }, client: ClientContext): Promise<AuthResult>`, `logout(auth: AuthContext): Promise<void>`, `changePassword(auth: AuthContext, input: { currentPassword; newPassword }): Promise<void>`; `ClientContext { ip: string; sessionToken?: string }`, `AuthResult { user: User; session: IssuedSession }`
  - Routen: `POST /api/auth/signup` (201), `POST /api/auth/login` (200), `POST /api/auth/logout` (204), `GET /api/auth/me` (200), `POST /api/auth/password` (204)
  - `UsersModule` (exportiert `UsersService`, `PasswordHasher`), `AuthModule` (registriert den globalen `AuthGuard`)
  - Testhilfen: `createDbTestApp(databaseUrl: string, env?: Record<string, string>, options?: { resetUsers?: boolean }): Promise<NestExpressApplication>`; `TEST_PASSWORD`, `Http`, `Login`, `cookieFrom(response)`, `signupUser(http, body, expected?)`, `loginUser(http, email, password)`, `authed(http, login)` mit `get/post/patch/delete`

- [ ] **Step 1: Begrenzer testen (schlägt fehl)**

`apps/api/src/auth/attempt-limiter.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { Env } from '../config/env.js';
import { AttemptLimiter } from './attempt-limiter.js';

function limiter(): AttemptLimiter {
  return new AttemptLimiter(new ConfigService<Env, true>({ LOGIN_WINDOW_SECONDS: 60 }));
}

describe('AttemptLimiter', () => {
  it('allows attempts up to the limit, then answers 429', () => {
    const attempts = limiter();
    for (let index = 0; index < 3; index += 1) attempts.record('email:a', 1000);

    expect(() => attempts.assertAllowed('email:a', 3, 1000)).toThrow(
      expect.objectContaining({ status: 429 })
    );
    expect(() => attempts.assertAllowed('email:a', 4, 1000)).not.toThrow();
  });

  it('forgets attempts once the window has passed', () => {
    const attempts = limiter();
    for (let index = 0; index < 3; index += 1) attempts.record('email:a', 1000);

    expect(() => attempts.assertAllowed('email:a', 3, 1000 + 59_000)).toThrow();
    expect(() => attempts.assertAllowed('email:a', 3, 1000 + 61_000)).not.toThrow();
  });

  it('counts every key on its own and can reset one', () => {
    const attempts = limiter();
    attempts.record('email:a', 1000);
    attempts.record('email:b', 1000);

    attempts.reset('email:a');

    expect(() => attempts.assertAllowed('email:a', 1, 1000)).not.toThrow();
    expect(() => attempts.assertAllowed('email:b', 1, 1000)).toThrow();
  });

  it('keeps its memory bounded when flooded with distinct keys', () => {
    const attempts = limiter();

    for (let index = 0; index < 10_050; index += 1) attempts.record(`email:${index}`, 1000);

    expect(attempts.trackedKeys).toBeLessThanOrEqual(10_000);
  });
});
```

- [ ] **Step 2: Begrenzer implementieren und Test grün sehen**

`apps/api/src/auth/attempt-limiter.ts`:

```ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';

const MAX_TRACKED_KEYS = 10_000;

/**
 * Sliding window per key, held in memory (one API instance; sharing it is in docs/BACKLOG.md). Callers pass the
 * limit, so the per-email and per-IP limits can differ.
 */
@Injectable()
export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly windowMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.windowMs = config.get('LOGIN_WINDOW_SECONDS', { infer: true }) * 1000;
  }

  get trackedKeys(): number {
    return this.attempts.size;
  }

  assertAllowed(key: string, limit: number, now = Date.now()): void {
    if (this.recent(key, now).length >= limit) {
      throw new HttpException('Too many attempts, try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  record(key: string, now = Date.now()): void {
    if (this.attempts.size >= MAX_TRACKED_KEYS) this.makeRoom(now);
    this.attempts.set(key, [...this.recent(key, now), now]);
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private recent(key: string, now: number): number[] {
    return (this.attempts.get(key) ?? []).filter((time) => now - time < this.windowMs);
  }

  /** Drops keys whose attempts all left the window; if that frees nothing, drops the oldest key. */
  private makeRoom(now: number): void {
    for (const [key, times] of this.attempts) {
      if (!times.some((time) => now - time < this.windowMs)) this.attempts.delete(key);
    }
    if (this.attempts.size >= MAX_TRACKED_KEYS) {
      const oldest = this.attempts.keys().next();
      if (oldest.done !== true) this.attempts.delete(oldest.value);
    }
  }
}
```

Run: `pnpm --filter @owui/api exec vitest run src/auth/attempt-limiter.spec.ts`
Expected: PASS.

- [ ] **Step 3: DTOs, Dienst, Controller, Module schreiben**

`apps/api/src/users/users.dto.ts` (Create/Update-DTOs kommen in Task 8 dazu):

```ts
import { ApiProperty } from '@nestjs/swagger';

import type { User } from './user.entity.js';
import { USER_ROLE, type UserRole } from './user-role.js';

export function trimTransform({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UserDto {
  id!: string;
  email!: string;
  name!: string;
  @ApiProperty({ enum: Object.values(USER_ROLE) })
  role!: UserRole;
  disabled!: boolean;
  createdAt!: string;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    disabled: user.disabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}
```

`apps/api/src/auth/auth.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

import { emailTransform } from '../users/email.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../users/password-policy.js';
import { toUserDto, trimTransform, UserDto } from '../users/users.dto.js';
import type { User } from '../users/user.entity.js';

export class SignupDto {
  @Transform(emailTransform)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(trimTransform)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class LoginDto {
  @Transform(emailTransform)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  // No minimum here: the login must not reveal the password rules, and old passwords may be shorter.
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}

export class SessionInfoDto {
  user!: UserDto;

  /** Sent back as X-CSRF-Token on writing requests; null for API-key calls (they need none). */
  @ApiProperty({ type: String, nullable: true })
  csrfToken!: string | null;
}

export function toSessionInfo(user: User, csrfToken: string | null): SessionInfoDto {
  return { user: toUserDto(user), csrfToken };
}
```

`apps/api/src/auth/auth.service.ts`:

```ts
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

  async login(input: { email: string; password: string }, client: ClientContext): Promise<AuthResult> {
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
```

`apps/api/src/auth/auth.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import type { Env } from '../config/env.js';
import type { AuthContext } from './auth-context.js';
import { ChangePasswordDto, LoginDto, SessionInfoDto, SignupDto, toSessionInfo } from './auth.dto.js';
import { type AuthResult, type ClientContext, AuthService } from './auth.service.js';
import { SESSION_COOKIE, readCookie, sessionCookieOptions } from './cookies.js';
import { AllowPending, CurrentAuth, Public, SessionOnly } from './decorators.js';

function clientOf(request: Request): ClientContext {
  return {
    ip: request.ip ?? 'unknown',
    sessionToken: readCookie(request.headers.cookie, SESSION_COOKIE),
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>
  ) {
    this.secureCookie = config.get('PUBLIC_ORIGIN', { infer: true }).startsWith('https://');
  }

  @Public()
  @Post('signup')
  @ApiCreatedResponse({ type: SessionInfoDto })
  async signup(
    @Body() dto: SignupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<SessionInfoDto> {
    return this.respond(response, await this.auth.signup(dto, clientOf(request)));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SessionInfoDto })
  @ApiUnauthorizedResponse({ description: 'Unknown email, wrong password or disabled account' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ): Promise<SessionInfoDto> {
    return this.respond(response, await this.auth.login(dto, clientOf(request)));
  }

  @SessionOnly()
  @AllowPending()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) response: Response
  ): Promise<void> {
    await this.auth.logout(auth);
    response.clearCookie(SESSION_COOKIE, sessionCookieOptions(this.secureCookie));
  }

  @AllowPending()
  @Get('me')
  @ApiOkResponse({ type: SessionInfoDto })
  me(@CurrentAuth() auth: AuthContext): SessionInfoDto {
    return toSessionInfo(auth.user, auth.session?.csrfToken ?? null);
  }

  @SessionOnly()
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async changePassword(@CurrentAuth() auth: AuthContext, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(auth, dto);
  }

  private respond(response: Response, result: AuthResult): SessionInfoDto {
    response.cookie(SESSION_COOKIE, result.session.token, {
      ...sessionCookieOptions(this.secureCookie),
      expires: result.session.expiresAt,
    });
    return toSessionInfo(result.user, result.session.csrfToken);
  }
}
```

`apps/api/src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { AuditModule } from '../database/audit/audit.module.js';
import { PasswordHasher } from './password-hasher.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuditModule],
  providers: [UsersService, PasswordHasher],
  exports: [UsersService, PasswordHasher],
})
export class UsersModule {}
```

`apps/api/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditModule } from '../database/audit/audit.module.js';
import { UsersModule } from '../users/users.module.js';
import { ApiKey } from './api-key.entity.js';
import { ApiKeyService } from './api-key.service.js';
import { AttemptLimiter } from './attempt-limiter.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { Session } from './session.entity.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Session, ApiKey]), UsersModule, AuditModule],
  controllers: [AuthController],
  providers: [
    SessionService,
    ApiKeyService,
    AttemptLimiter,
    AuthService,
    // Global and closed by default: every route needs a login unless it is marked @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
```

- [ ] **Step 4: Testhilfen schreiben**

`apps/api/src/testing/create-db-test-app.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { configureApp } from '../app.factory.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommonModule } from '../common/common.module.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { AuditModule } from '../database/audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { HealthModule } from '../health/health.module.js';
import { AppLoggerModule } from '../logging/logger.module.js';
import { SecurityModule } from '../security/security.module.js';
import { UsersModule } from '../users/users.module.js';
import { BASE_TEST_ENV } from './create-test-app.js';
import { resetAuthTables } from './db-fixtures.js';

export interface DbTestAppOptions {
  /** Empty the user tables before the app starts (default). Turn off to test start-up against existing data. */
  resetUsers?: boolean;
}

/** The real modules against the test database. Limits are lifted so a test only hits the one it is about. */
export async function createDbTestApp(
  databaseUrl: string,
  env: Record<string, string> = {},
  options: DbTestAppOptions = {}
): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot({
        raw: {
          ...BASE_TEST_ENV,
          DATABASE_URL: databaseUrl,
          RATE_LIMIT_LIMIT: '100000',
          LOGIN_MAX_ATTEMPTS: '1000',
          ...env,
        },
        ignoreEnvFile: true,
      }),
      AppLoggerModule,
      CommonModule,
      SecurityModule,
      DatabaseModule,
      AuditModule,
      UsersModule,
      AuthModule,
      HealthModule,
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  if (options.resetUsers !== false) await resetAuthTables(app.get(DataSource));
  await app.init();
  return app;
}
```

`apps/api/src/testing/http-session.ts`:

```ts
import request from 'supertest';

export type Http = ReturnType<typeof request>;

export const TEST_PASSWORD = 'correct horse battery';

export interface Login {
  cookie: string;
  csrf: string;
  user: { id: string; email: string; name: string; role: string };
}

/** "session=abc" from the Set-Cookie header, ready to send back as Cookie. */
export function cookieFrom(response: request.Response): string {
  const raw: unknown = response.headers['set-cookie'];
  const first: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('The response set no cookie');
  return first.split(';')[0] ?? '';
}

function loginFrom(response: request.Response): Login {
  return { cookie: cookieFrom(response), csrf: response.body.csrfToken, user: response.body.user };
}

export async function signupUser(
  http: Http,
  body: { email: string; name?: string; password?: string },
  expected = 201
): Promise<Login> {
  const response = await http
    .post('/api/auth/signup')
    .send({ name: 'Test User', password: TEST_PASSWORD, ...body })
    .expect(expected);
  return loginFrom(response);
}

export async function loginUser(http: Http, email: string, password: string): Promise<Login> {
  const response = await http.post('/api/auth/login').send({ email, password }).expect(200);
  return loginFrom(response);
}

/** Requests as a signed-in browser: the cookie always, the CSRF header on writes. */
export function authed(http: Http, login: Login) {
  return {
    get: (url: string) => http.get(url).set('Cookie', login.cookie),
    post: (url: string) => http.post(url).set('Cookie', login.cookie).set('X-CSRF-Token', login.csrf),
    patch: (url: string) => http.patch(url).set('Cookie', login.cookie).set('X-CSRF-Token', login.csrf),
    delete: (url: string) =>
      http.delete(url).set('Cookie', login.cookie).set('X-CSRF-Token', login.csrf),
  };
}
```

- [ ] **Step 5: Fehlschlagenden Ablauf-Test schreiben**

`apps/api/src/auth/auth.db.spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import {
  authed,
  cookieFrom,
  type Http,
  loginUser,
  signupUser,
  TEST_PASSWORD,
} from '../testing/http-session.js';
import { PasswordHasher } from '../users/password-hasher.js';
import { User } from '../users/user.entity.js';
import { USER_ROLE } from '../users/user-role.js';

const NEW_PASSWORD = 'another long passphrase';
const ADA = 'ada@example.com';

describe('auth flows (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  async function start(env: Record<string, string> = {}): Promise<Http> {
    app = await createDbTestApp(testDatabaseUrl(), env);
    dataSource = app.get(DataSource);
    return request(app.getHttpServer());
  }

  describe('signup', () => {
    it('makes the first account an admin and signs it in', async () => {
      const http = await start();

      const response = await http
        .post('/api/auth/signup')
        .send({ email: ' Ada@Example.com ', name: 'Ada', password: TEST_PASSWORD })
        .expect(201);

      expect(response.body.user).toMatchObject({
        email: ADA,
        name: 'Ada',
        role: USER_ROLE.ADMIN,
        disabled: false,
      });
      expect(JSON.stringify(response.body)).not.toMatch(/hash|argon/i);
      const me = await http.get('/api/auth/me').set('Cookie', cookieFrom(response)).expect(200);
      expect(me.body.user.id).toBe(response.body.user.id);
      expect(me.body.csrfToken).toBe(response.body.csrfToken);
    });

    it('sets a httpOnly, SameSite=Lax cookie that expires, and no Secure flag over plain http', async () => {
      const http = await start();

      const response = await http.post('/api/auth/signup').send({ email: ADA, name: 'Ada', password: TEST_PASSWORD });

      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toMatch(/^session=/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Expires=');
      expect(cookie).not.toContain('Secure');
    });

    it('adds Secure when the public origin is https', async () => {
      const http = await start({ PUBLIC_ORIGIN: 'https://chat.example.com' });

      const response = await http.post('/api/auth/signup').send({ email: ADA, name: 'Ada', password: TEST_PASSWORD });

      expect(String(response.headers['set-cookie'])).toContain('Secure');
    });

    it('parks later accounts as pending by default and uses DEFAULT_USER_ROLE when set', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });
      const bob = await signupUser(http, { email: 'bob@example.com' });
      expect(bob.user.role).toBe(USER_ROLE.PENDING);
      await authed(http, bob).get('/api/auth/me').expect(200);

      const open = await start({ DEFAULT_USER_ROLE: 'user' });
      await signupUser(open, { email: ADA });
      const carl = await signupUser(open, { email: 'carl@example.com' });
      expect(carl.user.role).toBe(USER_ROLE.USER);
    });

    it('lets the first account in even when sign-up is off, then closes the door', async () => {
      const http = await start({ ENABLE_SIGNUP: 'false' });

      const first = await signupUser(http, { email: ADA });

      expect(first.user.role).toBe(USER_ROLE.ADMIN);
      await http
        .post('/api/auth/signup')
        .send({ email: 'bob@example.com', name: 'Bob', password: TEST_PASSWORD })
        .expect(403);
    });

    it('rejects the same email in another case with 409', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });

      await http
        .post('/api/auth/signup')
        .send({ email: 'ADA@example.com ', name: 'Ada', password: TEST_PASSWORD })
        .expect(409);
    });

    const valid = { email: ADA, name: 'Ada', password: TEST_PASSWORD };
    it.each([
      ['an invalid email', { ...valid, email: 'not-an-email' }],
      ['a password below the minimum', { ...valid, password: 'short' }],
      ['a password above the maximum', { ...valid, password: 'x'.repeat(129) }],
      ['a missing name', { ...valid, name: undefined }],
      ['a blank name', { ...valid, name: '   ' }],
      ['a role in the payload (mass assignment)', { ...valid, role: 'admin' }],
    ])('rejects %s with 400 and creates nothing', async (_name, body) => {
      const http = await start();

      await http.post('/api/auth/signup').send(body).expect(400);

      expect(await dataSource.getRepository(User).count()).toBe(0);
    });

    it('answers 413, not 500, for an enormous body', async () => {
      const http = await start();

      await http
        .post('/api/auth/signup')
        .send({ ...valid, password: 'x'.repeat(200_000) })
        .expect(413);
    });

    it('limits sign-ups per address', async () => {
      const http = await start({ LOGIN_MAX_ATTEMPTS: '1' });

      for (let index = 0; index < 5; index += 1) {
        await signupUser(http, { email: `person${index}@example.com` });
      }

      await http
        .post('/api/auth/signup')
        .send({ email: 'one-too-many@example.com', name: 'X', password: TEST_PASSWORD })
        .expect(429);
    });

    it('stores only an Argon2id hash and audits without personal data', async () => {
      const http = await start();

      const ada = await signupUser(http, { email: ADA });

      const [row] = await dataSource.query<{ password_hash: string }[]>(
        'SELECT password_hash FROM app_user'
      );
      expect(row?.password_hash.startsWith('$argon2id$')).toBe(true);
      expect(row?.password_hash).not.toContain(TEST_PASSWORD);
      const audit = await dataSource.query<{ action: string }[]>(
        'SELECT action, metadata FROM audit_log WHERE actor_id = $1',
        [ada.user.id]
      );
      expect(audit.map((entry) => entry.action)).toEqual([AUDIT_ACTION.AUTH_SIGNUP]);
      expect(JSON.stringify(audit)).not.toContain(TEST_PASSWORD);
      expect(JSON.stringify(audit)).not.toContain(ADA);
    });
  });

  describe('login', () => {
    it('signs in with the right password, whatever the email case', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });

      const login = await loginUser(http, ' ADA@example.com', TEST_PASSWORD);

      await authed(http, login).get('/api/auth/me').expect(200);
    });

    it('replaces the session cookie the request came with', async () => {
      const http = await start();
      const first = await signupUser(http, { email: ADA });

      const response = await http
        .post('/api/auth/login')
        .set('Cookie', first.cookie)
        .send({ email: ADA, password: TEST_PASSWORD })
        .expect(200);

      expect(cookieFrom(response)).not.toBe(first.cookie);
      await authed(http, first).get('/api/auth/me').expect(401);
      await http.get('/api/auth/me').set('Cookie', cookieFrom(response)).expect(200);
    });

    it('answers unknown email, wrong password and disabled account identically', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });
      await signupUser(http, { email: 'bob@example.com' });
      await dataSource.query("UPDATE app_user SET disabled_at = now() WHERE email = 'bob@example.com'");

      const unknown = await http.post('/api/auth/login').send({ email: 'nobody@example.com', password: TEST_PASSWORD });
      const wrong = await http.post('/api/auth/login').send({ email: ADA, password: 'wrong password!' });
      const disabled = await http.post('/api/auth/login').send({ email: 'bob@example.com', password: TEST_PASSWORD });

      for (const response of [unknown, wrong, disabled]) {
        expect(response.status).toBe(401);
        expect(response.body.title).toBe(wrong.body.title);
        expect(response.body.detail).toBe(wrong.body.detail);
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    });

    it('still runs a password check for an unknown email', async () => {
      const http = await start();
      const verify = vi.spyOn(PasswordHasher.prototype, 'verify');

      await http.post('/api/auth/login').send({ email: 'nobody@example.com', password: TEST_PASSWORD }).expect(401);

      expect(verify).toHaveBeenCalledTimes(1);
    });

    it('lets a pending account sign in', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });
      await signupUser(http, { email: 'bob@example.com' });

      const login = await loginUser(http, 'bob@example.com', TEST_PASSWORD);

      expect(login.user.role).toBe(USER_ROLE.PENDING);
    });

    it('blocks an email after repeated failures, known or not, even for the right password', async () => {
      const http = await start({ LOGIN_MAX_ATTEMPTS: '3' });
      await signupUser(http, { email: ADA });

      for (const email of [ADA, 'nobody@example.com']) {
        for (let index = 0; index < 3; index += 1) {
          await http.post('/api/auth/login').send({ email, password: 'wrong password!' }).expect(401);
        }
        await http.post('/api/auth/login').send({ email, password: TEST_PASSWORD }).expect(429);
      }
    });

    it('clears the failure counter after a successful login', async () => {
      const http = await start({ LOGIN_MAX_ATTEMPTS: '3' });
      await signupUser(http, { email: ADA });
      for (let index = 0; index < 2; index += 1) {
        await http.post('/api/auth/login').send({ email: ADA, password: 'wrong password!' }).expect(401);
      }
      await loginUser(http, ADA, TEST_PASSWORD);

      for (let index = 0; index < 2; index += 1) {
        await http.post('/api/auth/login').send({ email: ADA, password: 'wrong password!' }).expect(401);
      }
    });

    it.each([
      ['a password above the maximum', { email: ADA, password: 'x'.repeat(129) }, 400],
      ['an empty password', { email: ADA, password: '' }, 400],
      ['no email', { password: TEST_PASSWORD }, 400],
      ['an enormous body', { email: ADA, password: 'x'.repeat(200_000) }, 413],
    ])('answers %s with %i, never 500', async (_name, body, status) => {
      const http = await start();

      await http.post('/api/auth/login').send(body).expect(status);
    });

    it('audits failures and successes without personal data', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });
      await http.post('/api/auth/login').send({ email: ADA, password: 'wrong password!' }).expect(401);
      await loginUser(http, ADA, TEST_PASSWORD);

      const audit = await dataSource.query<{ action: string }[]>(
        'SELECT action, metadata FROM audit_log WHERE actor_id = $1 ORDER BY occurred_at',
        [ada.user.id]
      );

      expect(audit.map((entry) => entry.action)).toEqual([
        AUDIT_ACTION.AUTH_SIGNUP,
        AUDIT_ACTION.AUTH_LOGIN_FAILED,
        AUDIT_ACTION.AUTH_LOGIN,
      ]);
      expect(JSON.stringify(audit)).not.toContain('wrong password!');
    });
  });

  describe('logout', () => {
    it('ends the session and clears the cookie', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });

      const response = await authed(http, ada).post('/api/auth/logout').expect(204);

      expect(String(response.headers['set-cookie'])).toMatch(/session=;/);
      await authed(http, ada).get('/api/auth/me').expect(401);
    });

    it('needs the CSRF token and a session', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });

      await http.post('/api/auth/logout').set('Cookie', ada.cookie).expect(403);
      await authed(http, ada).get('/api/auth/me').expect(200);
      await http.post('/api/auth/logout').expect(401);
    });
  });

  describe('me', () => {
    it('is closed to anonymous callers', async () => {
      const http = await start();

      await http.get('/api/auth/me').expect(401);
    });
  });

  describe('password change', () => {
    it('changes the password, keeps this session and signs the others out', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });
      const other = await loginUser(http, ADA, TEST_PASSWORD);

      await authed(http, ada)
        .post('/api/auth/password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(204);

      await authed(http, ada).get('/api/auth/me').expect(200);
      await authed(http, other).get('/api/auth/me').expect(401);
      await http.post('/api/auth/login').send({ email: ADA, password: TEST_PASSWORD }).expect(401);
      await loginUser(http, ADA, NEW_PASSWORD);
    });

    it('refuses a wrong current password with 400 and changes nothing', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });

      await authed(http, ada)
        .post('/api/auth/password')
        .send({ currentPassword: 'not my password', newPassword: NEW_PASSWORD })
        .expect(400);

      await loginUser(http, ADA, TEST_PASSWORD);
    });

    it('refuses a new password below the minimum', async () => {
      const http = await start();
      const ada = await signupUser(http, { email: ADA });

      await authed(http, ada)
        .post('/api/auth/password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' })
        .expect(400);
    });

    it('is not available to pending accounts', async () => {
      const http = await start();
      await signupUser(http, { email: ADA });
      const bob = await signupUser(http, { email: 'bob@example.com' });

      await authed(http, bob)
        .post('/api/auth/password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD })
        .expect(403);
    });
  });
});
```

- [ ] **Step 6: Test laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/auth/auth.db.spec.ts`
Expected: PASS. Typische Stolpersteine: (a) fehlt `password-hasher.ts` unter `users/`, siehe Task 3 (die Datei liegt in `apps/api/src/users/`, nicht in `auth/`); (b) schlägt der Test "adds Secure" fehl, weil `BASE_TEST_ENV.PUBLIC_ORIGIN` die `CORS_ORIGINS`-Prüfung stört, nur `PUBLIC_ORIGIN` ersetzen, nicht `CORS_ORIGINS`; (c) die 413-Fälle brauchen das Express-Standardlimit von 100 kB, nichts konfigurieren.

- [ ] **Step 7: `pnpm check` und Commit**

Run: `pnpm check`
Expected: grün (Typen, ESLint, Prettier, dependency-cruiser). Die Zyklenprüfung muss ohne Treffer laufen: `users` importiert `auth/session.entity` (nur die Entity), `auth` importiert `users`-Dienste.

```bash
git add apps/api/src
git commit -m "feat(api): add signup, login, logout, password change and session info" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Nutzerverwaltung (`/users`, nur Admin, nur Session)

**Files:**
- Modify: `apps/api/src/users/users.dto.ts`, `apps/api/src/users/users.module.ts`
- Create: `apps/api/src/users/users.controller.ts`, `apps/api/src/users/users.db.spec.ts`

**Interfaces:**
- Consumes: `UsersService` (Task 6), `PasswordHasher`, `toUserDto`, `UserDto`, `trimTransform` (Task 7), `Roles`, `CurrentUser`, `USER_ROLE`, Testhilfen aus Task 7 (`createDbTestApp`, `signupUser`, `authed`, `Http`).
- Produces:
  - DTOs `CreateUserDto { email; name; password; role: UserRole }`, `UpdateUserDto { name?; role?; disabled? }`, `SetUserPasswordDto { password }`
  - Routen (alle `@Roles(USER_ROLE.ADMIN)`, damit per Guard nur mit Session erreichbar): `GET /api/users` (200, `UserDto[]`), `POST /api/users` (201, `UserDto`), `PATCH /api/users/:id` (200, `UserDto`), `POST /api/users/:id/password` (204), `DELETE /api/users/:id` (204)

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`apps/api/src/users/users.db.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ApiKeyService } from '../auth/api-key.service.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import {
  authed,
  type Http,
  type Login,
  loginUser,
  signupUser,
  TEST_PASSWORD,
} from '../testing/http-session.js';
import { USER_ROLE } from './user-role.js';

const ADMIN = 'admin@example.com';
const NEW_PASSWORD = 'another long passphrase';

describe('users admin routes (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let admin: Login;

  afterEach(async () => {
    await app.close();
  });

  /** The first account is the admin; every later one waits as "pending" and is promoted by the helper. */
  async function start(env: Record<string, string> = {}): Promise<void> {
    app = await createDbTestApp(testDatabaseUrl(), env);
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    admin = await signupUser(http, { email: ADMIN });
  }

  async function memberWith(email: string, role: string): Promise<Login> {
    const login = await signupUser(http, { email });
    await authed(http, admin).patch(`/api/users/${login.user.id}`).send({ role }).expect(200);
    return loginUser(http, email, TEST_PASSWORD);
  }

  describe('access', () => {
    const routes = [
      ['get', '/api/users'],
      ['post', '/api/users'],
      ['patch', `/api/users/${randomUUID()}`],
      ['post', `/api/users/${randomUUID()}/password`],
      ['delete', `/api/users/${randomUUID()}`],
    ] as const;

    it.each(routes)('%s %s refuses anonymous callers with 401', async (method, url) => {
      await start();

      await http[method](url).expect(401);
    });

    it.each(routes)('%s %s refuses a normal user with 403', async (method, url) => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      await authed(http, ben)[method](url).expect(403);
    });

    it.each(routes)('%s %s refuses a pending account with 403', async (method, url) => {
      await start();
      const pending = await signupUser(http, { email: 'pending@example.com' });

      await authed(http, pending)[method](url).expect(403);
    });

    it.each(routes)('%s %s refuses an admin API key with 403', async (method, url) => {
      await start({ ENABLE_API_KEYS: 'true' });
      const { key } = await app.get(ApiKeyService).create(admin.user.id, 'ci');

      await http[method](url).set('Authorization', `Bearer ${key}`).expect(403);
    });

    it('refuses an admin whose account was disabled in the meantime', async () => {
      await start();
      const second = await memberWith('second@example.com', USER_ROLE.ADMIN);
      await authed(http, admin).patch(`/api/users/${second.user.id}`).send({ disabled: true }).expect(200);

      await authed(http, second).get('/api/users').expect(401);
    });
  });

  describe('list', () => {
    it('shows every account without secrets', async () => {
      await start();
      await signupUser(http, { email: 'pending@example.com' });

      const response = await authed(http, admin).get('/api/users').expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toMatchObject({ email: ADMIN, role: USER_ROLE.ADMIN, disabled: false });
      expect(JSON.stringify(response.body)).not.toMatch(/hash|argon|csrf/i);
    });
  });

  describe('create', () => {
    it('creates an account that can sign in right away, and audits it', async () => {
      await start();

      const response = await authed(http, admin)
        .post('/api/users')
        .send({ email: ' Cleo@Example.com', name: 'Cleo', password: NEW_PASSWORD, role: USER_ROLE.USER })
        .expect(201);

      expect(response.body).toMatchObject({ email: 'cleo@example.com', role: USER_ROLE.USER });
      await loginUser(http, 'cleo@example.com', NEW_PASSWORD);
      const audit = await dataSource.query<{ action: string; target_id: string }[]>(
        'SELECT action, target_id FROM audit_log WHERE action = $1 AND target_id = $2',
        [AUDIT_ACTION.USER_CREATED, response.body.id]
      );
      expect(audit).toEqual([{ action: AUDIT_ACTION.USER_CREATED, target_id: response.body.id }]);
    });

    it('works even when public sign-up is off', async () => {
      await start({ ENABLE_SIGNUP: 'false' });

      await authed(http, admin)
        .post('/api/users')
        .send({ email: 'cleo@example.com', name: 'Cleo', password: NEW_PASSWORD, role: USER_ROLE.USER })
        .expect(201);
    });

    it('rejects a taken email (any case) with 409', async () => {
      await start();

      await authed(http, admin)
        .post('/api/users')
        .send({ email: 'ADMIN@example.com', name: 'Twin', password: NEW_PASSWORD, role: USER_ROLE.USER })
        .expect(409);
    });

    const valid = { email: 'cleo@example.com', name: 'Cleo', password: NEW_PASSWORD, role: 'user' };
    it.each([
      ['an unknown role', { ...valid, role: 'superuser' }],
      ['a missing role', { ...valid, role: undefined }],
      ['a short password', { ...valid, password: 'short' }],
      ['an extra field', { ...valid, disabledAt: null }],
    ])('rejects %s with 400', async (_name, body) => {
      await start();

      await authed(http, admin).post('/api/users').send(body).expect(400);
    });
  });

  describe('update', () => {
    it('approves a pending account, and the change counts on its very next request', async () => {
      await start();
      const pending = await signupUser(http, { email: 'pending@example.com' });
      await authed(http, pending).get('/api/auth/me').expect(200);

      await authed(http, admin)
        .patch(`/api/users/${pending.user.id}`)
        .send({ role: USER_ROLE.USER })
        .expect(200);

      const me = await authed(http, pending).get('/api/auth/me').expect(200);
      expect(me.body.user.role).toBe(USER_ROLE.USER);
    });

    it('renames an account', async () => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      const response = await authed(http, admin)
        .patch(`/api/users/${ben.user.id}`)
        .send({ name: '  Benedikt ' })
        .expect(200);

      expect(response.body.name).toBe('Benedikt');
    });

    it('disabling signs the account out at once, enabling lets it sign in again', async () => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      await authed(http, admin).patch(`/api/users/${ben.user.id}`).send({ disabled: true }).expect(200);

      await authed(http, ben).get('/api/auth/me').expect(401);
      await http.post('/api/auth/login').send({ email: 'ben@example.com', password: TEST_PASSWORD }).expect(401);
      await authed(http, admin).patch(`/api/users/${ben.user.id}`).send({ disabled: false }).expect(200);
      await loginUser(http, 'ben@example.com', TEST_PASSWORD);
    });

    it('protects the last active admin from demotion and from being disabled', async () => {
      await start();

      await authed(http, admin).patch(`/api/users/${admin.user.id}`).send({ role: USER_ROLE.USER }).expect(409);
      await authed(http, admin).patch(`/api/users/${admin.user.id}`).send({ disabled: true }).expect(409);

      await authed(http, admin).get('/api/users').expect(200);
    });

    it('keeps at least one admin when two admins demote each other at the same time', async () => {
      await start();
      const second = await memberWith('second@example.com', USER_ROLE.ADMIN);

      const results = await Promise.all([
        authed(http, admin).patch(`/api/users/${second.user.id}`).send({ role: USER_ROLE.USER }),
        authed(http, second).patch(`/api/users/${admin.user.id}`).send({ role: USER_ROLE.USER }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
      const admins = await dataSource.query<{ count: string }[]>(
        "SELECT count(*) FROM app_user WHERE role = 'admin' AND disabled_at IS NULL"
      );
      expect(admins[0]?.count).toBe('1');
    });

    it.each([
      ['an unknown role', { role: 'root' }],
      ['an email change', { email: 'new@example.com' }],
      ['a password', { password: NEW_PASSWORD }],
      ['a non-boolean disabled flag', { disabled: 'yes' }],
      ['a blank name', { name: '  ' }],
    ])('rejects %s with 400', async (_name, body) => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      await authed(http, admin).patch(`/api/users/${ben.user.id}`).send(body).expect(400);
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      await start();

      await authed(http, admin).patch(`/api/users/${randomUUID()}`).send({ name: 'X' }).expect(404);
      await authed(http, admin).patch('/api/users/not-a-uuid').send({ name: 'X' }).expect(400);
    });

    it('audits role changes and disabling without personal data', async () => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);
      await authed(http, admin).patch(`/api/users/${ben.user.id}`).send({ disabled: true }).expect(200);

      const audit = await dataSource.query<{ action: string }[]>(
        "SELECT action, metadata FROM audit_log WHERE target_id = $1 AND action LIKE 'user.%' ORDER BY occurred_at",
        [ben.user.id]
      );

      expect(audit.map((entry) => entry.action)).toEqual([
        AUDIT_ACTION.USER_ROLE_CHANGED,
        AUDIT_ACTION.USER_DISABLED,
      ]);
      expect(JSON.stringify(audit)).not.toContain('ben@example.com');
    });
  });

  describe('set password', () => {
    it('sets a new password and signs the account out everywhere', async () => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      await authed(http, admin)
        .post(`/api/users/${ben.user.id}/password`)
        .send({ password: NEW_PASSWORD })
        .expect(204);

      await authed(http, ben).get('/api/auth/me').expect(401);
      await http.post('/api/auth/login').send({ email: 'ben@example.com', password: TEST_PASSWORD }).expect(401);
      await loginUser(http, 'ben@example.com', NEW_PASSWORD);
    });

    it('rejects a short password with 400 and an unknown account with 404', async () => {
      await start();

      await authed(http, admin)
        .post(`/api/users/${admin.user.id}/password`)
        .send({ password: 'short' })
        .expect(400);
      await authed(http, admin)
        .post(`/api/users/${randomUUID()}/password`)
        .send({ password: NEW_PASSWORD })
        .expect(404);
    });
  });

  describe('delete', () => {
    it('deletes an account with its sessions', async () => {
      await start();
      const ben = await memberWith('ben@example.com', USER_ROLE.USER);

      await authed(http, admin).delete(`/api/users/${ben.user.id}`).expect(204);

      await authed(http, ben).get('/api/auth/me').expect(401);
      const rows = await dataSource.query<unknown[]>('SELECT 1 FROM app_user WHERE id = $1', [ben.user.id]);
      expect(rows).toHaveLength(0);
    });

    it('protects the last active admin and answers 404 for an unknown id', async () => {
      await start();

      await authed(http, admin).delete(`/api/users/${admin.user.id}`).expect(409);
      await authed(http, admin).delete(`/api/users/${randomUUID()}`).expect(404);
    });

    it('may remove an admin when another active one remains', async () => {
      await start();
      const second = await memberWith('second@example.com', USER_ROLE.ADMIN);

      await authed(http, second).delete(`/api/users/${admin.user.id}`).expect(204);
    });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/users/users.db.spec.ts`
Expected: FAIL (alle `/api/users`-Routen liefern 404, weil der Controller fehlt).

- [ ] **Step 3: DTOs ergänzen**

In `apps/api/src/users/users.dto.ts` die Importe ersetzen und ans Ende anhängen:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { emailTransform } from './email.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy.js';
import type { User } from './user.entity.js';
import { USER_ROLE, type UserRole } from './user-role.js';
```

```ts
const ROLES = Object.values(USER_ROLE);

export class CreateUserDto {
  @Transform(emailTransform)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(trimTransform)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role!: UserRole;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimTransform)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}

export class SetUserPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;
}
```

(`ApiProperty` und die Importe von `User`/`USER_ROLE`/`UserRole` standen schon in der Datei aus Task 7; die Importzeile oben ersetzt den alten Block, damit nichts doppelt steht.)

- [ ] **Step 4: Controller schreiben und eintragen**

`apps/api/src/users/users.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser, Roles } from '../auth/decorators.js';
import { PasswordHasher } from './password-hasher.js';
import type { User } from './user.entity.js';
import { USER_ROLE } from './user-role.js';
import {
  CreateUserDto,
  SetUserPasswordDto,
  toUserDto,
  UpdateUserDto,
  UserDto,
} from './users.dto.js';
import { UsersService } from './users.service.js';

/** Admin only. The guard also keeps API keys out of every route that asks for the admin role. */
@ApiTags('users')
@Roles(USER_ROLE.ADMIN)
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher
  ) {}

  @Get()
  @ApiOkResponse({ type: UserDto, isArray: true })
  async list(): Promise<UserDto[]> {
    return (await this.users.list()).map(toUserDto);
  }

  @Post()
  @ApiCreatedResponse({ type: UserDto })
  async create(@CurrentUser() actor: User, @Body() dto: CreateUserDto): Promise<UserDto> {
    const passwordHash = await this.hasher.hash(dto.password);
    const created = await this.users.createByAdmin(actor.id, {
      email: dto.email,
      name: dto.name,
      passwordHash,
      role: dto.role,
    });
    return toUserDto(created);
  }

  @Patch(':id')
  @ApiOkResponse({ type: UserDto })
  @ApiNotFoundResponse()
  async update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto
  ): Promise<UserDto> {
    return toUserDto(await this.users.update(actor.id, id, dto));
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async setPassword(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserPasswordDto
  ): Promise<void> {
    await this.users.resetPassword(actor.id, id, await this.hasher.hash(dto.password));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async remove(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.users.remove(actor.id, id);
  }
}
```

In `apps/api/src/users/users.module.ts` den Controller eintragen (`import { UsersController } from './users.controller.js';` und `controllers: [UsersController],` vor `providers`).

- [ ] **Step 5: Test laufen lassen, grün sehen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/users/users.db.spec.ts`
Expected: PASS. Stolpersteine: (a) `UsersService.update` muss `name` trimmen lassen? Nein, das erledigt `trimTransform` im DTO; (b) das `Promise.all`-Rennen ergibt je nach Reihenfolge `[200, 409]` oder `[409, 200]`, daher das Sortieren.

- [ ] **Step 6: `pnpm check` und Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/api/src/users
git commit -m "feat(api): add admin user management routes" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: API-Key-Verwaltung (`/auth/api-keys`)

**Files:**
- Create: `apps/api/src/auth/api-keys.dto.ts`, `apps/api/src/auth/api-key-management.service.ts`, `apps/api/src/auth/api-keys.controller.ts`, `apps/api/src/auth/api-keys.db.spec.ts`
- Modify: `apps/api/src/auth/auth.module.ts`

**Interfaces:**
- Consumes: `ApiKeyService` (Task 4), `AuditService`, `AUDIT_ACTION`, Dekoratoren `SessionOnly`/`CurrentUser`, `trimTransform` (Task 7), `Env.ENABLE_API_KEYS`.
- Produces:
  - `CreateApiKeyDto { name: string; expiresInDays?: number }`, `ApiKeyDto { id; name; prefix; expiresAt: string | null; lastUsedAt: string | null; createdAt }`, `CreatedApiKeyDto extends ApiKeyDto { key: string }`, `toApiKeyDto(apiKey: ApiKey): ApiKeyDto`
  - `ApiKeyManagementService`: `list(userId: string): Promise<ApiKey[]>`, `create(userId: string, input: { name: string; expiresInDays?: number }): Promise<CreatedApiKey>`, `revoke(userId: string, id: string): Promise<void>` (alle werfen `NotFoundException`, solange `ENABLE_API_KEYS` aus ist; `revoke` wirft sie auch für fremde, unbekannte und schon widerrufene Keys)
  - Routen (alle `@SessionOnly()`): `GET /api/auth/api-keys` (200), `POST /api/auth/api-keys` (201, Klartext-Key genau einmal), `DELETE /api/auth/api-keys/:id` (204)

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`apps/api/src/auth/api-keys.db.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { authed, type Http, type Login, loginUser, signupUser, TEST_PASSWORD } from '../testing/http-session.js';
import { USER_ROLE } from '../users/user-role.js';

const KEY_FORMAT = /^sk-[0-9a-f]{64}$/;

describe('api keys (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let admin: Login;

  afterEach(async () => {
    await app.close();
  });

  async function start(env: Record<string, string> = { ENABLE_API_KEYS: 'true' }): Promise<void> {
    app = await createDbTestApp(testDatabaseUrl(), env);
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    admin = await signupUser(http, { email: 'admin@example.com' });
  }

  async function member(email: string, role: string = USER_ROLE.USER): Promise<Login> {
    const login = await signupUser(http, { email });
    await authed(http, admin).patch(`/api/users/${login.user.id}`).send({ role }).expect(200);
    return loginUser(http, email, TEST_PASSWORD);
  }

  async function createKey(login: Login, body: object = { name: 'ci' }) {
    const response = await authed(http, login).post('/api/auth/api-keys').send(body).expect(201);
    return { id: response.body.id as string, key: response.body.key as string, body: response.body };
  }

  const bearer = (key: string) => `Bearer ${key}`;

  describe('switch', () => {
    it('answers 404 on every route while ENABLE_API_KEYS is off (the default)', async () => {
      await start({ ENABLE_API_KEYS: 'false' });

      await authed(http, admin).get('/api/auth/api-keys').expect(404);
      await authed(http, admin).post('/api/auth/api-keys').send({ name: 'ci' }).expect(404);
      await authed(http, admin).delete(`/api/auth/api-keys/${randomUUID()}`).expect(404);
    });
  });

  describe('create and list', () => {
    it('shows the key once, stores only its hash and lists it without the secret', async () => {
      await start();

      const created = await createKey(admin, { name: 'CI runner' });

      expect(created.key).toMatch(KEY_FORMAT);
      expect(created.body).toMatchObject({ name: 'CI runner', prefix: created.key.slice(0, 8), expiresAt: null });
      const rows = await dataSource.query<{ key_hash: string }[]>('SELECT key_hash FROM api_key');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rows)).not.toContain(created.key);
      const list = await authed(http, admin).get('/api/auth/api-keys').expect(200);
      expect(list.body).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain(created.key);
      expect(list.body[0]).not.toHaveProperty('key');
      expect(list.body[0]).not.toHaveProperty('keyHash');
    });

    it('sets an expiry from expiresInDays', async () => {
      await start();

      const { body } = await createKey(admin, { name: 'short', expiresInDays: 2 });

      const days = (Date.parse(body.expiresAt) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(1.9);
      expect(days).toBeLessThan(2.1);
    });

    it.each([
      ['a blank name', { name: '   ' }],
      ['no name', {}],
      ['a name above 100 characters', { name: 'x'.repeat(101) }],
      ['an expiry of zero days', { name: 'k', expiresInDays: 0 }],
      ['an expiry above a year', { name: 'k', expiresInDays: 366 }],
      ['a fractional expiry', { name: 'k', expiresInDays: 1.5 }],
      ['an extra field', { name: 'k', userId: randomUUID() }],
    ])('rejects %s with 400', async (_name, body) => {
      await start();

      await authed(http, admin).post('/api/auth/api-keys').send(body).expect(400);
    });

    it('refuses an account that is still pending', async () => {
      await start();
      const pending = await signupUser(http, { email: 'pending@example.com' });

      await authed(http, pending).post('/api/auth/api-keys').send({ name: 'k' }).expect(403);
    });

    it('audits creation and revocation with the key id, never the key', async () => {
      await start();
      const { id, key } = await createKey(admin);
      await authed(http, admin).delete(`/api/auth/api-keys/${id}`).expect(204);

      const audit = await dataSource.query<{ action: string }[]>(
        'SELECT action, metadata FROM audit_log WHERE target_id = $1 ORDER BY occurred_at',
        [id]
      );

      expect(audit.map((entry) => entry.action)).toEqual([AUDIT_ACTION.API_KEY_CREATED, AUDIT_ACTION.API_KEY_REVOKED]);
      expect(JSON.stringify(audit)).not.toContain(key);
    });
  });

  describe('using a key', () => {
    it('signs requests in as the owner, accepts the scheme in any case, and sends no CSRF token', async () => {
      await start();
      const { key } = await createKey(admin);

      const me = await http.get('/api/auth/me').set('Authorization', bearer(key)).expect(200);
      expect(me.body.user.id).toBe(admin.user.id);
      expect(me.body.csrfToken).toBeNull();
      await http.get('/api/auth/me').set('Authorization', `bearer ${key}`).expect(200);
    });

    it('ignores the key in x-api-key and in the query string', async () => {
      await start();
      const { key } = await createKey(admin);

      await http.get('/api/auth/me').set('x-api-key', key).expect(401);
      await http.get(`/api/auth/me?api_key=${key}`).expect(401);
      await http.get(`/api/auth/me?token=${key}`).expect(401);
    });

    it('does not manage keys, passwords, sessions or accounts, not even for an admin', async () => {
      await start();
      const { id, key } = await createKey(admin);
      const call = (method: 'get' | 'post' | 'delete', url: string) =>
        http[method](url).set('Authorization', bearer(key));

      await call('get', '/api/auth/api-keys').expect(403);
      await call('post', '/api/auth/api-keys').send({ name: 'more' }).expect(403);
      await call('delete', `/api/auth/api-keys/${id}`).expect(403);
      await call('post', '/api/auth/password')
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'another long passphrase' })
        .expect(403);
      await call('post', '/api/auth/logout').expect(403);
      await call('get', '/api/users').expect(403);
    });

    it('stops working the moment it is revoked, and a second revoke answers 404', async () => {
      await start();
      const { id, key } = await createKey(admin);
      await http.get('/api/auth/me').set('Authorization', bearer(key)).expect(200);

      await authed(http, admin).delete(`/api/auth/api-keys/${id}`).expect(204);

      await http.get('/api/auth/me').set('Authorization', bearer(key)).expect(401);
      await authed(http, admin).delete(`/api/auth/api-keys/${id}`).expect(404);
      const list = await authed(http, admin).get('/api/auth/api-keys').expect(200);
      expect(list.body).toEqual([]);
    });

    it('stops working once it has expired', async () => {
      await start();
      const { id, key } = await createKey(admin, { name: 'short', expiresInDays: 1 });
      await dataSource.query("UPDATE api_key SET expires_at = now() - interval '1 minute' WHERE id = $1", [id]);

      await http.get('/api/auth/me').set('Authorization', bearer(key)).expect(401);
    });

    it('follows the owner: disabled and deleted accounts get 401, a demoted pending account 403', async () => {
      await start();
      const ben = await member('ben@example.com');
      const cleo = await member('cleo@example.com');
      const dora = await member('dora@example.com');
      const benKey = (await createKey(ben)).key;
      const cleoKey = (await createKey(cleo)).key;
      const doraKey = (await createKey(dora)).key;

      await authed(http, admin).patch(`/api/users/${ben.user.id}`).send({ disabled: true }).expect(200);
      await authed(http, admin).delete(`/api/users/${cleo.user.id}`).expect(204);
      await authed(http, admin).patch(`/api/users/${dora.user.id}`).send({ role: USER_ROLE.PENDING }).expect(200);

      await http.get('/api/auth/me').set('Authorization', bearer(benKey)).expect(401);
      await http.get('/api/auth/me').set('Authorization', bearer(cleoKey)).expect(401);
      await http.get('/api/auth/me').set('Authorization', bearer(doraKey)).expect(403);
    });
  });

  describe("somebody else's keys (BOLA)", () => {
    it('are neither listed nor revocable, and keep working', async () => {
      await start();
      const ben = await member('ben@example.com');
      const adminKey = await createKey(admin);
      const benKey = await createKey(ben);

      const list = await authed(http, ben).get('/api/auth/api-keys').expect(200);
      expect(list.body.map((entry: { id: string }) => entry.id)).toEqual([benKey.id]);
      await authed(http, ben).delete(`/api/auth/api-keys/${adminKey.id}`).expect(404);

      await http.get('/api/auth/me').set('Authorization', bearer(adminKey.key)).expect(200);
    });

    it('answers 400 for a malformed id', async () => {
      await start();

      await authed(http, admin).delete('/api/auth/api-keys/not-a-uuid').expect(400);
    });
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/auth/api-keys.db.spec.ts`
Expected: FAIL (Routen fehlen: 404 statt 201/200).

- [ ] **Step 3: DTOs, Dienst und Controller schreiben**

`apps/api/src/auth/api-keys.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { trimTransform } from '../users/users.dto.js';
import type { ApiKey } from './api-key.entity.js';

export class CreateApiKeyDto {
  @Transform(trimTransform)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365, description: 'Without a value the key never expires' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  expiresInDays?: number;
}

export class ApiKeyDto {
  id!: string;
  name!: string;
  /** The first characters of the key, to tell keys apart in a list. */
  prefix!: string;
  @ApiProperty({ type: String, nullable: true })
  expiresAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  lastUsedAt!: string | null;
  createdAt!: string;
}

export class CreatedApiKeyDto extends ApiKeyDto {
  /** The only time the full key is shown. */
  key!: string;
}

export function toApiKeyDto(apiKey: ApiKey): ApiKeyDto {
  return {
    id: apiKey.id,
    name: apiKey.name,
    prefix: apiKey.prefix,
    expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    createdAt: apiKey.createdAt.toISOString(),
  };
}
```

`apps/api/src/auth/api-key-management.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditService } from '../database/audit/audit.service.js';
import type { ApiKey } from './api-key.entity.js';
import { type CreatedApiKey, ApiKeyService } from './api-key.service.js';

const DAY_MS = 86_400_000;

/** What a signed-in user may do with their own keys: switch, ownership and audit live here, not in the controller. */
@Injectable()
export class ApiKeyManagementService {
  private readonly enabled: boolean;

  constructor(
    private readonly keys: ApiKeyService,
    private readonly audit: AuditService,
    config: ConfigService<Env, true>
  ) {
    this.enabled = config.get('ENABLE_API_KEYS', { infer: true });
  }

  list(userId: string): Promise<ApiKey[]> {
    this.assertEnabled();
    return this.keys.list(userId);
  }

  async create(userId: string, input: { name: string; expiresInDays?: number }): Promise<CreatedApiKey> {
    this.assertEnabled();
    const expiresAt =
      input.expiresInDays === undefined ? null : new Date(Date.now() + input.expiresInDays * DAY_MS);
    const created = await this.keys.create(userId, input.name, expiresAt);
    await this.audit.record({
      actorId: userId,
      action: AUDIT_ACTION.API_KEY_CREATED,
      targetType: 'api_key',
      targetId: created.apiKey.id,
    });
    return created;
  }

  async revoke(userId: string, id: string): Promise<void> {
    this.assertEnabled();
    // The owner check is part of the UPDATE: a foreign id looks exactly like an unknown one.
    if (!(await this.keys.revoke(userId, id))) throw new NotFoundException('API key not found');
    await this.audit.record({
      actorId: userId,
      action: AUDIT_ACTION.API_KEY_REVOKED,
      targetType: 'api_key',
      targetId: id,
    });
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new NotFoundException();
  }
}
```

`apps/api/src/auth/api-keys.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import type { User } from '../users/user.entity.js';
import { ApiKeyManagementService } from './api-key-management.service.js';
import { ApiKeyDto, CreatedApiKeyDto, CreateApiKeyDto, toApiKeyDto } from './api-keys.dto.js';
import { CurrentUser, SessionOnly } from './decorators.js';

/** Keys are managed from the browser session only; a key can never mint or revoke keys. */
@ApiTags('api-keys')
@SessionOnly()
@Controller('auth/api-keys')
export class ApiKeysController {
  constructor(private readonly management: ApiKeyManagementService) {}

  @Get()
  @ApiOkResponse({ type: ApiKeyDto, isArray: true })
  @ApiNotFoundResponse({ description: 'API keys are switched off' })
  async list(@CurrentUser() user: User): Promise<ApiKeyDto[]> {
    return (await this.management.list(user.id)).map(toApiKeyDto);
  }

  @Post()
  @ApiCreatedResponse({ type: CreatedApiKeyDto })
  @ApiNotFoundResponse({ description: 'API keys are switched off' })
  async create(@CurrentUser() user: User, @Body() dto: CreateApiKeyDto): Promise<CreatedApiKeyDto> {
    const { apiKey, key } = await this.management.create(user.id, dto);
    return { ...toApiKeyDto(apiKey), key };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Unknown key, not yours, or already revoked' })
  async revoke(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.management.revoke(user.id, id);
  }
}
```

In `apps/api/src/auth/auth.module.ts` ergänzen: Importe `ApiKeyManagementService`, `ApiKeysController`; `controllers: [AuthController, ApiKeysController]`; `ApiKeyManagementService` in `providers`.

- [ ] **Step 4: Test laufen lassen, grün sehen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/auth`
Expected: PASS (auch die früheren DB-Tests im Ordner). Stolperstein: `ApiKey.createdAt` muss ein `Date` sein (Entity aus Task 2 mit `@CreateDateColumn`); `save` liefert es nach dem Insert.

- [ ] **Step 5: `pnpm check` und Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/api/src/auth
git commit -m "feat(api): add api key management for signed-in users" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Admin aus der Umgebung beim Start

**Files:**
- Create: `apps/api/src/users/admin-bootstrap.service.ts`, `apps/api/src/users/admin-bootstrap.db.spec.ts`
- Modify: `apps/api/src/users/users.module.ts`

**Interfaces:**
- Consumes: `UsersService.bootstrapAdmin` (Task 6), `PasswordHasher`, `Env.ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME` (Task 1), `createDbTestApp(..., { resetUsers })` (Task 7).
- Produces: `AdminBootstrapService` (`OnApplicationBootstrap`): legt beim Start den Admin aus `ADMIN_EMAIL` und `ADMIN_PASSWORD` an, **nur wenn kein Nutzer existiert**. Name: `ADMIN_NAME`, sonst `Admin`. Ein Fehler beim Anlegen bricht den Start ab (fail fast).

- [ ] **Step 1: Fehlschlagenden Test schreiben**

`apps/api/src/users/admin-bootstrap.db.spec.ts`:

```ts
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { loginUser, signupUser } from '../testing/http-session.js';
import { USER_ROLE } from './user-role.js';

const ADMIN_ENV = {
  ADMIN_EMAIL: 'Root@Example.com',
  ADMIN_PASSWORD: 'a long admin passphrase',
};

describe('admin from the environment (database)', () => {
  const apps: NestExpressApplication[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function start(
    env: Record<string, string>,
    resetUsers = true
  ): Promise<{ app: NestExpressApplication; http: ReturnType<typeof request>; dataSource: DataSource }> {
    const app = await createDbTestApp(testDatabaseUrl(), env, { resetUsers });
    apps.push(app);
    return { app, http: request(app.getHttpServer()), dataSource: app.get(DataSource) };
  }

  it('creates the admin on the first start, with a default name, and the account can sign in', async () => {
    const { http } = await start(ADMIN_ENV);

    const login = await loginUser(http, 'root@example.com', ADMIN_ENV.ADMIN_PASSWORD);

    expect(login.user).toMatchObject({ email: 'root@example.com', name: 'Admin', role: USER_ROLE.ADMIN });
  });

  it('uses ADMIN_NAME when given', async () => {
    const { http } = await start({ ...ADMIN_ENV, ADMIN_NAME: 'Rita Root' });

    const login = await loginUser(http, 'root@example.com', ADMIN_ENV.ADMIN_PASSWORD);

    expect(login.user.name).toBe('Rita Root');
  });

  it('creates nothing without both values', async () => {
    const { dataSource } = await start({});

    expect(await dataSource.query('SELECT 1 FROM app_user')).toHaveLength(0);
  });

  it('is ignored once any account exists, so a leftover variable never adds an admin', async () => {
    const first = await start({});
    await signupUser(first.http, { email: 'ada@example.com' });
    await first.app.close();
    apps.length = 0;

    const { http, dataSource } = await start(ADMIN_ENV, false);

    const rows = await dataSource.query<{ email: string }[]>('SELECT email FROM app_user');
    expect(rows.map((row) => row.email)).toEqual(['ada@example.com']);
    await http
      .post('/api/auth/login')
      .send({ email: 'root@example.com', password: ADMIN_ENV.ADMIN_PASSWORD })
      .expect(401);
  });

  it('does not create a second admin or reset the password on a restart', async () => {
    const first = await start(ADMIN_ENV);
    await first.app.close();
    apps.length = 0;

    const { http, dataSource } = await start({ ...ADMIN_ENV, ADMIN_PASSWORD: 'a different passphrase' }, false);

    expect(await dataSource.query('SELECT 1 FROM app_user')).toHaveLength(1);
    await loginUser(http, 'root@example.com', ADMIN_ENV.ADMIN_PASSWORD);
  });

  it('never writes the password or the email to the log', async () => {
    const written: unknown[] = [];
    for (const method of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        written.push(args);
      });
    }

    await start(ADMIN_ENV);

    expect(written.length).toBeGreaterThan(0);
    const text = JSON.stringify(written);
    expect(text).not.toContain(ADMIN_ENV.ADMIN_PASSWORD);
    expect(text.toLowerCase()).not.toContain('root@example.com');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/users/admin-bootstrap.db.spec.ts`
Expected: FAIL (es wird kein Admin angelegt, die Anmeldung liefert 401).

- [ ] **Step 3: Dienst schreiben und eintragen**

`apps/api/src/users/admin-bootstrap.service.ts`:

```ts
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import { PasswordHasher } from './password-hasher.js';
import { UsersService } from './users.service.js';

const DEFAULT_ADMIN_NAME = 'Admin';

/**
 * Optional first admin from ADMIN_EMAIL and ADMIN_PASSWORD. It only ever acts while the user table is empty,
 * so a variable that stays in the environment cannot add or reset an admin later. Nothing here logs the
 * email or the password.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly users: UsersService,
    private readonly hasher: PasswordHasher,
    private readonly config: ConfigService<Env, true>
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get('ADMIN_EMAIL', { infer: true });
    const password = this.config.get('ADMIN_PASSWORD', { infer: true });
    if (email === undefined || password === undefined) return;

    const created = await this.users.bootstrapAdmin({
      email,
      name: this.config.get('ADMIN_NAME', { infer: true }) ?? DEFAULT_ADMIN_NAME,
      passwordHash: await this.hasher.hash(password),
    });
    if (created === null) {
      this.logger.warn('ADMIN_EMAIL and ADMIN_PASSWORD are set but accounts exist: ignored. Remove them.');
      return;
    }
    this.logger.log(`Created the first admin (user ${created.id}). Remove ADMIN_PASSWORD from the environment.`);
  }
}
```

In `apps/api/src/users/users.module.ts`: `import { AdminBootstrapService } from './admin-bootstrap.service.js';` und `AdminBootstrapService` in `providers` ergänzen (nicht in `exports`).

- [ ] **Step 4: Test laufen lassen, grün sehen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/users`
Expected: PASS. Stolpersteine: (a) der Log-Test verlangt, dass wenigstens eine Logzeile entstand (`written.length > 0`): die Zeile "Created the first admin" liefert das; (b) `Logger.prototype.log` ist die Methode der Nest-Klasse; ruft der Dienst eine andere Logger-Klasse auf (etwa `nestjs-pino`), den Spion dort setzen.

- [ ] **Step 5: `pnpm check` und Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/api/src/users
git commit -m "feat(api): create the first admin from ADMIN_* on an empty database" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Einbinden in die App, Health öffentlich, Vertrag erzeugen

**Files:**
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/health/health.controller.ts`, `apps/api/src/openapi/build-document.spec.ts`, `apps/api/openapi.json` (erzeugt), `apps/web/src/api/generated/**` (erzeugt)
- Create: `apps/api/src/app.module.spec.ts`

**Interfaces:**
- Consumes: `UsersModule`, `AuthModule` (Task 7), `Public` (Task 5).
- Produces: `AppModule` importiert beide Module; `GET /api/health/live` und `/ready` bleiben ohne Anmeldung erreichbar (`@Public()`); der OpenAPI-Vertrag enthält alle neuen Routen mit stabilen Operation-IDs (`authSignup`, `authLogin`, `authLogout`, `authMe`, `authChangePassword`, `apiKeysList`, `apiKeysCreate`, `apiKeysRevoke`, `usersList`, `usersCreate`, `usersUpdate`, `usersSetPassword`, `usersRemove`).

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`apps/api/src/app.module.spec.ts`:

```ts
import { MODULE_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { AppModule } from './app.module.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';

describe('AppModule wiring', () => {
  it('imports the auth and user modules', () => {
    const imports: unknown[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule);

    expect(imports).toEqual(expect.arrayContaining([AuthModule, UsersModule]));
  });

  it('registers the auth guard globally, so a route is closed unless it is marked public', () => {
    const providers: unknown[] = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuthModule);

    expect(providers).toContainEqual({ provide: APP_GUARD, useClass: AuthGuard });
  });
});
```

In `apps/api/src/openapi/build-document.spec.ts` einen zweiten Test ergänzen (Importe oben: `AuthModule`, `UsersModule`, `DatabaseModule` brauchen wir nicht; die Controller allein genügen, die Dienste werden nicht erzeugt, weil nur der Vertrag gelesen wird):

```ts
  it('describes the auth, api key and user routes with stable operation ids', async () => {
    // The controllers are built for real; their services stay empty because only the contract is read.
    app = await createTestApp({
      controllers: [AuthController, ApiKeysController, UsersController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: ApiKeyManagementService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: PasswordHasher, useValue: {} },
      ],
    });

    const document = buildOpenApiDocument(app);

    const operations = Object.entries(document.paths).flatMap(([path, item]) =>
      (['get', 'post', 'patch', 'delete'] as const).flatMap((method) => {
        const operation = item[method];
        return operation === undefined ? [] : [`${method} ${path} ${operation.operationId}`];
      })
    );
    expect(operations.sort()).toEqual(
      [
        'post /api/auth/signup authSignup',
        'post /api/auth/login authLogin',
        'post /api/auth/logout authLogout',
        'get /api/auth/me authMe',
        'post /api/auth/password authChangePassword',
        'get /api/auth/api-keys apiKeysList',
        'post /api/auth/api-keys apiKeysCreate',
        'delete /api/auth/api-keys/{id} apiKeysRevoke',
        'get /api/users usersList',
        'post /api/users usersCreate',
        'patch /api/users/{id} usersUpdate',
        'post /api/users/{id}/password usersSetPassword',
        'delete /api/users/{id} usersRemove',
      ].sort()
    );
    expect(document.components?.schemas).toHaveProperty('CreatedApiKeyDto');
    expect(JSON.stringify(document)).not.toMatch(/passwordHash|tokenHash|keyHash/);
  });
```

Importe oben ergänzen: `ApiKeyManagementService` (`../auth/api-key-management.service.js`), `ApiKeysController` (`../auth/api-keys.controller.js`), `AuthController` (`../auth/auth.controller.js`), `AuthService` (`../auth/auth.service.js`), `PasswordHasher` (`../users/password-hasher.js`), `UsersController` (`../users/users.controller.js`), `UsersService` (`../users/users.service.js`).

Run: `pnpm --filter @owui/api exec vitest run src/app.module.spec.ts src/openapi`
Expected: FAIL (AppModule kennt die Module noch nicht).

- [ ] **Step 2: Einbinden**

`apps/api/src/app.module.ts`: Importe `AuthModule` (`./auth/auth.module.js`) und `UsersModule` (`./users/users.module.js`) ergänzen und in `imports` nach `AuditModule` eintragen: `AuditModule, UsersModule, AuthModule, HealthModule`. Die Reihenfolge ist wichtig: `SecurityModule` steht vor `AuthModule`, damit Throttler und Origin-Prüfung vor dem `AuthGuard` laufen.

`apps/api/src/health/health.controller.ts`: Import `import { Public } from '../auth/decorators.js';` und `@Public()` über `@SkipThrottle()` an die Klasse setzen (Liveness und Readiness müssen für Docker und Caddy ohne Anmeldung antworten).

- [ ] **Step 3: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run`
Expected: PASS.

- [ ] **Step 4: Vertrag und Client erzeugen**

Run: `pnpm openapi`
Expected: `apps/api/openapi.json` und `apps/web/src/api/generated/**` ändern sich (neue Modelle und Hooks). Danach `git diff --stat` ansehen: es dürfen nur diese Pfade betroffen sein.

Run: `pnpm check`
Expected: grün (der Web-Typecheck bleibt grün, weil nur Dateien dazukommen).

- [ ] **Step 5: Alle Tests, Commit**

Run: `pnpm test && pnpm db:up && pnpm test:db`
Expected: alle grün.

```bash
git add apps/api apps/web/src/api/generated
git commit -m "feat(api): wire auth and users into the app and publish the contract" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Smoke-Test, Handprobe, Docs und Beleg

**Files:**
- Modify: `scripts/smoke.mjs`, `docs/PLAN.md`, `docs/BACKLOG.md`, `docs/THREAT-MODEL.md`, `README.md` (nur Abschnitt Konfiguration, falls vorhanden), `docs/superpowers/plans/2026-10-09-teilprojekt-1a-auth-backend.md` (Häkchen)
- Create: `docs/dod/01-auth-backend.md`

**Interfaces:**
- Consumes: laufender Stack (`docker compose up -d --build --wait`).
- Produces: Beleg `docs/dod/01-auth-backend.md`; aktualisierte Docs.

- [ ] **Step 1: Smoke-Test erweitern**

In `scripts/smoke.mjs` vor dem Block `if (failures.length > 0)` ergänzen (die Prüfungen verändern keine Daten):

```js
const anonymousMe = await fetch(`${BASE_URL}/api/auth/me`);
check(
  'anonymous /auth/me answers 401 problem details',
  anonymousMe.status === 401 &&
    (anonymousMe.headers.get('content-type') ?? '').includes('application/problem+json')
);

const anonymousUsers = await fetch(`${BASE_URL}/api/users`);
check('anonymous /users answers 401', anonymousUsers.status === 401);

const badSignup = await fetch(`${BASE_URL}/api/auth/signup`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE_URL },
  body: '{}',
});
check(
  'invalid sign-up answers 400 and sets no cookie',
  badSignup.status === 400 && !badSignup.headers.has('set-cookie')
);
```

- [ ] **Step 2: Stack starten, Smoke-Test und Handprobe**

Run: `docker compose up -d --build --wait && node scripts/smoke.mjs`
Expected: `smoke test passed`.

Handprobe gegen den laufenden Stack (frische Datenbank, also wird das erste Konto Admin):

```bash
B=http://localhost:8080
JAR=$(mktemp)
H=(-H "Origin: $B" -H 'content-type: application/json')
curl -s -c "$JAR" "${H[@]}" -d '{"email":"admin@example.com","name":"Admin","password":"correct horse battery"}' "$B/api/auth/signup"
curl -s -b "$JAR" "$B/api/auth/me"
curl -s -o /dev/null -w '%{http_code}\n' -b "$JAR" "${H[@]}" -X POST "$B/api/auth/logout"
```

Expected: erste Antwort enthält `"role":"admin"` und ein `csrfToken`; `me` liefert denselben Nutzer; der Logout ohne `X-CSRF-Token` liefert `403`. Mit `-H "X-CSRF-Token: <Wert aus signup>"` liefert er `204`, danach liefert `me` `401`. Danach `docker compose down -v`.

- [ ] **Step 3: Docs aktualisieren**

- `docs/THREAT-MODEL.md`: In der Tabelle die Zeile "Konto-Übernahme, Brute Force" ergänzen um "Cookie `httpOnly`/`SameSite=Lax`, Token nur als SHA-256, CSRF-Header (1)" und neue Zeilen anfügen:
  - Spoofing: "Gestohlener Session-Cookie oder Key" mit "Session und Key sofort widerrufbar, Sperren/Löschen/Passwortwechsel löschen Sessions, Keys nur als Hash (1)".
  - Information disclosure: "Konten erraten (Enumeration)" mit "gleiche Antwort und Rechenzeit für unbekannte E-Mail, falsches Passwort, gesperrtes Konto; Rate Limit je E-Mail und IP (1)".
  - Elevation of privilege: "Gestohlener Admin-Key, wartendes Konto per Key, Rollenänderung per Mass Assignment" mit "Keys erreichen nie Admin- oder Key-Routen, `pending` nie per Key, Rolle immer aus der DB, DTO-Whitelist (1)".
  - Das Datum "Stand" auf "Teilprojekt 1a" ändern.
- `docs/BACKLOG.md`: Zeile "CSRF-Token" löschen (erledigt). Zeile "Datenbank-Rollen trennen" ergänzen um: "Das Audit-Log enthält seit Teilprojekt 1 echte Einträge (nur IDs und Aktionen); Trennung vor dem ersten Produktivbetrieb, spätestens in Teilprojekt 6." Neue Zeilen: "Passwort-Reset per Mail und MFA/OIDC/LDAP (kein Mailversand; Teilprojekt 9)", "Eigene Sessions auflisten und beenden (Sitzungsübersicht)", "Begrenzung der Zahl aktiver API-Keys je Nutzer".
- `docs/PLAN.md`: Teilprojekt 1 auf "Backend fertig (1a), Web offen (1b), Plan: [1a](superpowers/plans/2026-10-09-teilprojekt-1a-auth-backend.md), Beleg: [DoD](dod/01-auth-backend.md)" setzen; "Als Nächstes" Punkt 1 auf "Plan 1b (Web) umsetzen".
- `README.md`: falls es einen Abschnitt zu Umgebungsvariablen gibt, die neuen Variablen aus `.env.example` (`ENABLE_SIGNUP`, `DEFAULT_USER_ROLE`, `ENABLE_API_KEYS`, `SESSION_LIFETIME_HOURS`, `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_SECONDS`, `ADMIN_*`) in einem Satz verweisen: "Konfiguration: siehe `.env.example`". Gibt es keinen solchen Abschnitt, nichts ändern.

- [ ] **Step 4: Beleg schreiben**

`docs/dod/01-auth-backend.md` nach dem Muster von [DoD 00](../../dod/00-fundament.md) anlegen, mit den echten Zahlen aus den Läufen von Task 11 Step 5 (Anzahl der API-, DB- und Web-Tests aus der Vitest-Ausgabe):

```markdown
### DoD: Teilprojekt 1a (Auth-Backend)

- [x] Vertrag: OpenAPI enthält Auth-, API-Key- und Nutzerrouten, Orval-Client neu erzeugt, CI-Drift-Prüfung grün
- [x] Tests: <API-Zahl> API, <DB-Zahl> DB, <Web-Zahl> Web grün; `pnpm check` grün; Guard-Mutation ("immer erlauben") macht Tests rot
- [x] Invarianten: jede Route außer `@Public()` geschlossen; Rolle aus der DB; Keys nie auf Admin-/Key-Routen und nie für `pending`; Passwörter Argon2id, Sessions und Keys nur als SHA-256; keine Geheimnisse in Logs und Audit
- [x] Betrieb: `docker compose up` grün, Smoke-Test inklusive Auth-Prüfungen, Handprobe (Signup, `me`, Logout mit und ohne CSRF-Header)
- [x] Docs: PLAN, BACKLOG, THREAT-MODEL, Spec aktualisiert
- [ ] Offen: Web (Teilprojekt 1b), siehe docs/BACKLOG.md
```

Die spitzen Klammern durch die gemessenen Zahlen ersetzen, bevor die Datei committet wird.

- [ ] **Step 5: Plan abhaken, Commit, Push, CI**

In diesem Plan alle erledigten Schritte mit `- [x]` markieren.

```bash
git add scripts docs README.md
git commit -m "docs: record Teilprojekt 1a (smoke checks, threat model, backlog, DoD)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
gh run list --branch main --limit 1
```

Expected: Push ohne Ablehnung; die CI läuft. Bis sie grün ist, `gh run watch` nutzen; eine rote CI vor jeder weiteren Arbeit beheben.
