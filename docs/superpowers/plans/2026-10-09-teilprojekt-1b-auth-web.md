# Teilprojekt 1b: Auth-Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anmeldeseite mit Registrierung, Wartebildschirm für nicht freigeschaltete Konten, Kontoseite (Passwort, eigene API-Schlüssel) und Nutzerverwaltung für Admins in `apps/web`, mit Router-Wächtern und automatischem CSRF-Header.

**Architecture:** Der Sitzungszustand ist die generierte Abfrage `GET /auth/me` (TanStack Query). Eine Wächter-Komponente (`SessionGate`) leitet je nach Zustand um (anonym, wartend, Mitglied, Admin) und zeigt für Laden und Fehler eigene Ansichten. Der Fetcher merkt sich das CSRF-Token aus `me`/`login`/`signup` und hängt es an schreibende Anfragen; ein 401 auf normale Anfragen löst eine Neuprüfung der Sitzung aus. Alle Texte stehen in i18n, alle API-Typen kommen aus dem generierten Client.

**Tech Stack:** React 19, React Router 8, TanStack Query 5, Orval-Client (aus Plan 1a erzeugt), shadcn/ui (`radix-nova`), i18next, Vitest + Testing Library.

**Spec:** [Teilprojekt 1](../specs/2026-10-09-teilprojekt-1-auth-design.md), Abschnitt 7. Voraussetzung: Plan [1a](2026-10-09-teilprojekt-1a-auth-backend.md) ist umgesetzt und `pnpm openapi` hat den Client mit Auth-, API-Key- und Nutzerrouten erzeugt.

## Global Constraints

- `pnpm`, nie `npm` oder `yarn`. Befehle aus `AGENTS.md`: `pnpm check`, `pnpm test`, `pnpm openapi`.
- Serverzustand nur über TanStack Query und den **generierten** Client; keine handgeschriebenen API-Typen oder Fetch-Aufrufe in Features. `apps/web` importiert nie Laufzeitcode aus `apps/api`.
- Kein `any`, kein `@ts-ignore`, kein `as unknown as`, kein `export *`. Steuernde Werte (Rolle, Sitzungszustand) als `as const`-Wörterbuch, überall importiert, auch in Tests; Rollen kommen aus dem generierten `UserDtoRole`.
- UI-Texte nur über i18n-Schlüssel (`apps/web/src/i18n/locales/de.json` und `en.json`, gleiche Schlüssel, geprüft von `locales.spec.ts`). Standardsprache Deutsch. Keine Fachbegriffe wie „JWT“, „CSRF“, „RAG“, „Embedding“ in Texten.
- shadcn-Bausteine und semantische Tokens (`text-destructive`, `bg-card`, `text-muted-foreground`), keine freien Palettenfarben.
- Jede asynchrone Ansicht kennt leer (oder „nicht anwendbar“, begründet), laden (`role="status"`), Fehler mit „Erneut versuchen“ und „in Arbeit“ (Schaltflächen gesperrt, kein Doppel-Submit).
- Modellausgabe und Nutzereingaben werden nie als HTML gerendert (Invariante 7a); React escaped, `dangerouslySetInnerHTML` ist verboten.
- Git: direkt auf `main`, ein Thema pro Commit, Conventional Commits, Imperativ. Hooks nie mit `--no-verify` umgehen. Jede Commit-Nachricht endet mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- UI-Änderungen werden im Browser angesehen (Konsole auf CSP-Verstöße prüfen), bevor sie als fertig gelten.
- Nach einem Push: `gh run list --branch main --limit 1` prüfen, rote CI vor neuer Arbeit beheben.

## Review Focus

Eingaben und Zustände, die die Spec nicht ausdrücklich nennt und die im Alltag auftreten. Jede Zeile hat einen Test in der genannten Task.

1. **Sitzung läuft mitten in der Arbeit ab** (401 auf eine normale Anfrage): Weiterleitung auf die Anmeldung, und der nächste Nutzer im selben Browser sieht keine zwischengespeicherten Daten des vorigen (Task 1 und 3).
2. **Server nicht erreichbar beim ersten Laden** oder 500 auf `me`: Fehleransicht mit „Erneut versuchen“, weder weiße Seite noch Weiterleitungsschleife (Task 3).
3. **Adresse von Hand eingegeben** (Nicht-Admin auf `/admin/users`, angemeldeter Nutzer auf `/login`, wartendes Konto auf `/`): immer das richtige Ziel (Task 3).
4. **Doppelklick auf Absenden** in jedem Formular: genau eine Anfrage, Schaltfläche gesperrt (Task 2, 4, 5).
5. **Nutzername mit HTML** (`<img src=x onerror=alert(1)>`) in der Nutzerliste: erscheint als Text, nicht als Element (Task 5). Ein neuer API-Schlüssel ist nach dem Schließen des Dialogs nicht mehr auf der Seite (Task 4).

---

## Dateistruktur

```
apps/web/src/
  api/
    session-state.ts        CSRF-Token und Handler für „Sitzung abgelaufen“ (Modulzustand)
    error-message.ts        errorMessageKey(error, specific): i18n-Schlüssel je HTTP-Status
    fetcher.ts              (ändern) CSRF-Header, Token lernen, 401 melden
  test/
    stub-api.ts             stubApi, json, noContent, problem
    fixtures.ts             userDto, sessionInfo, authConfig
    render-app.tsx          (ändern) Query-Client zurückgeben
  components/
    common/page-loading.tsx Ladeansicht (role=status)
    common/load-error.tsx   Fehleransicht mit „Erneut versuchen“
    ui/                     (shadcn) label, card, field, badge, table, dialog, alert-dialog, native-select
    layout/app-layout.tsx   (ändern) Nutzer-Fußzeile, Navigation je Rolle
  features/auth/
    session.ts              SESSION_STATUS, useSession, useCurrentUser
    session-gate.tsx        GATE, SessionGate
    store-session.ts        storeSession (Cache leeren, Sitzung setzen)
    use-sign-out.ts         useSignOut
    password-policy.ts      PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH
    login-form.tsx          LoginForm
    signup-form.tsx         SignupForm
  features/account/
    password-form.tsx       PasswordForm
    api-keys-section.tsx    ApiKeysSection (+ Dialog für den neuen Schlüssel)
  features/admin/
    users-table.tsx         UsersTable (Liste, Rolle, Sperren, Freischalten)
    create-user-dialog.tsx  CreateUserDialog
    set-password-dialog.tsx SetPasswordDialog
    delete-user-dialog.tsx  DeleteUserDialog
  pages/
    login-page.tsx, pending-page.tsx, account-page.tsx, admin-users-page.tsx
  app/router.tsx            (ändern) Routen mit Wächtern
  app/providers.tsx         (ändern) Handler für „Sitzung abgelaufen“ eintragen
  i18n/locales/de.json, en.json  (ändern)
```

---

### Task 1: Fetcher (CSRF-Header, abgelaufene Sitzung) und Test-Hilfen

**Files:**
- Create: `apps/web/src/api/session-state.ts`, `apps/web/src/api/session-state.spec.ts`, `apps/web/src/api/error-message.ts`, `apps/web/src/api/error-message.spec.ts`, `apps/web/src/test/stub-api.ts`, `apps/web/src/test/fixtures.ts`
- Modify: `apps/web/src/api/fetcher.ts`, `apps/web/src/api/fetcher.spec.ts`, `apps/web/src/i18n/locales/de.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Produces:
  - `rememberCsrfToken(token: string | undefined): void`, `csrfHeaderFor(method: string): string | undefined` (nur für schreibende Methoden), `setUnauthorizedHandler(handler: (() => void) | undefined): void`, `notifyUnauthorized(): void`
  - `apiFetch` hängt `X-CSRF-Token` an schreibende Anfragen, lernt das Token aus den Antworten von `/api/auth/me`, `/api/auth/login`, `/api/auth/signup`, vergisst es nach `/api/auth/logout` und nach einem 401 auf diesen Routen, und ruft `notifyUnauthorized()` bei einem 401 auf jeder anderen Route außer `/api/auth/config`
  - `errorMessageKey(error: unknown, specific?: Partial<Record<number, string>>): string` (liefert i18n-Schlüssel: `error.forbidden` 403, `error.notFound` 404, `error.tooLarge` 413, `error.tooMany` 429, `error.network` bei Nicht-`ApiError`, sonst `error.generic`; `specific` überschreibt je Status)
  - Testhilfen: `stubApi(handlers: Record<string, Handler>): Mock<typeof fetch>` (Schlüssel `"METHOD /pfad"`; unbekannte Anfragen liefern 404 mit Titel `Unexpected request: METHOD /pfad`), `json(status, body)`, `noContent()`, `problem(status, title, detail?)`; `Handler = (request: { method: string; url: URL; body: unknown; headers: Headers }) => Response | Promise<Response>`
  - Fixtures: `userDto(overrides?: Partial<UserDto>): UserDto` (Rolle `user`), `sessionInfo(user?: UserDto, csrfToken?: string): SessionInfoDto`, `authConfig(overrides?: Partial<AuthConfigDto>): AuthConfigDto` (`signupEnabled: true, onboarding: false, apiKeysEnabled: true`)

- [x] **Step 1: Namen im erzeugten Client prüfen**

Run: `grep -E "^export (const|function) use(Auth|ApiKeys|Users)" apps/web/src/api/generated/api.ts | sed -E 's/\(.*//' | sort -u && ls apps/web/src/api/generated/model | grep -iE "role|dto" | sort`

Expected: Hooks `useAuthSignup`, `useAuthLogin`, `useAuthLogout`, `useAuthMe`, `useAuthConfig`, `useAuthChangePassword`, `useApiKeysList`, `useApiKeysCreate`, `useApiKeysRevoke`, `useUsersList`, `useUsersCreate`, `useUsersUpdate`, `useUsersSetPassword`, `useUsersRemove`; Modelle `userDto.ts`, `userDtoRole.ts`, `sessionInfoDto.ts`, `authConfigDto.ts`, `apiKeyDto.ts`, `createdApiKeyDto.ts`, `createUserDtoRole.ts`, `updateUserDtoRole.ts` und die Anfrage-DTOs. Weicht ein Name ab (zum Beispiel `useUsersDelete`), diesen Plan an allen Stellen mit dem tatsächlichen Namen lesen; die Form (`mutate({ data })`, `mutate({ id })`, `mutate({ id, data })`) bleibt gleich. Die Abfrageschlüssel kommen als `getAuthMeQueryKey()`, `getAuthConfigQueryKey()`, `getUsersListQueryKey()`, `getApiKeysListQueryKey()` aus derselben Datei.

- [x] **Step 2: Fehlschlagende Tests schreiben**

`apps/web/src/api/session-state.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  csrfHeaderFor,
  notifyUnauthorized,
  rememberCsrfToken,
  setUnauthorizedHandler,
} from './session-state';

afterEach(() => {
  rememberCsrfToken(undefined);
  setUnauthorizedHandler(undefined);
});

describe('session state', () => {
  it('offers the token for writing methods only, in any letter case', () => {
    rememberCsrfToken('token-1');

    expect(csrfHeaderFor('POST')).toBe('token-1');
    expect(csrfHeaderFor('patch')).toBe('token-1');
    expect(csrfHeaderFor('DELETE')).toBe('token-1');
    expect(csrfHeaderFor('GET')).toBeUndefined();
    expect(csrfHeaderFor('head')).toBeUndefined();
  });

  it('offers nothing before a token is known and after it was forgotten', () => {
    expect(csrfHeaderFor('POST')).toBeUndefined();
    rememberCsrfToken('token-1');
    rememberCsrfToken(undefined);

    expect(csrfHeaderFor('POST')).toBeUndefined();
  });

  it('calls the registered handler and survives having none', () => {
    expect(() => {
      notifyUnauthorized();
    }).not.toThrow();
    const handler = vi.fn();
    setUnauthorizedHandler(handler);

    notifyUnauthorized();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

`apps/web/src/api/error-message.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { errorMessageKey } from './error-message';
import { ApiError } from './fetcher';

describe('errorMessageKey', () => {
  it.each([
    [403, 'error.forbidden'],
    [404, 'error.notFound'],
    [413, 'error.tooLarge'],
    [429, 'error.tooMany'],
    [500, 'error.generic'],
    [418, 'error.generic'],
  ])('maps status %i to %s', (status, key) => {
    expect(errorMessageKey(new ApiError(status, 'x'))).toBe(key);
  });

  it('lets the caller give a status its own meaning', () => {
    const error = new ApiError(409, 'conflict');

    expect(errorMessageKey(error, { 409: 'auth.error.taken' })).toBe('auth.error.taken');
    expect(errorMessageKey(new ApiError(429, 'x'), { 409: 'auth.error.taken' })).toBe('error.tooMany');
  });

  it('treats anything that is not an ApiError as a network problem', () => {
    expect(errorMessageKey(new TypeError('Failed to fetch'))).toBe('error.network');
    expect(errorMessageKey('boom')).toBe('error.network');
  });
});
```

An `apps/web/src/api/fetcher.spec.ts` anhängen (Importe oben ergänzen: `import { noContent, json, problem, stubApi } from '@/test/stub-api';`, `import { csrfHeaderFor, rememberCsrfToken, setUnauthorizedHandler } from './session-state';`):

```ts
describe('apiFetch: session handling', () => {
  afterEach(() => {
    rememberCsrfToken(undefined);
    setUnauthorizedHandler(undefined);
  });

  const SESSION = { user: { id: 'u1' }, csrfToken: 'csrf-1' };

  it.each(['/api/auth/me', '/api/auth/login', '/api/auth/signup'])(
    'learns the token from %s',
    async (path) => {
      stubApi({ [`GET ${path}`]: () => json(200, SESSION), [`POST ${path}`]: () => json(200, SESSION) });

      await apiFetch(path, { method: path === '/api/auth/me' ? 'GET' : 'POST' });

      expect(csrfHeaderFor('POST')).toBe('csrf-1');
    }
  );

  it('sends the token on writing requests and never on reads', async () => {
    const fetchMock = stubApi({
      'GET /api/auth/me': () => json(200, SESSION),
      'GET /api/users': () => json(200, []),
      'POST /api/users': () => json(201, {}),
      'DELETE /api/users/1': () => noContent(),
    });
    await apiFetch('/api/auth/me');

    await apiFetch('/api/users');
    await apiFetch('/api/users', { method: 'POST', body: '{}' });
    await apiFetch('/api/users/1', { method: 'DELETE' });

    const sent = fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get('X-CSRF-Token'));
    expect(sent).toEqual([null, null, 'csrf-1', 'csrf-1']);
  });

  it('does not invent a token when the answer has none', async () => {
    stubApi({ 'GET /api/auth/me': () => json(200, { user: { id: 'u1' } }) });

    await apiFetch('/api/auth/me');

    expect(csrfHeaderFor('POST')).toBeUndefined();
  });

  it('forgets the token after logout and when me answers 401', async () => {
    stubApi({
      'GET /api/auth/me': () => json(200, SESSION),
      'POST /api/auth/logout': () => noContent(),
    });
    await apiFetch('/api/auth/me');
    await apiFetch('/api/auth/logout', { method: 'POST' });
    expect(csrfHeaderFor('POST')).toBeUndefined();

    rememberCsrfToken('stale');
    stubApi({ 'GET /api/auth/me': () => problem(401, 'Unauthorized') });
    await expect(apiFetch('/api/auth/me')).rejects.toMatchObject({ status: 401 });

    expect(csrfHeaderFor('POST')).toBeUndefined();
  });

  it('reports a 401 on an ordinary request, but not on login, signup, me or config', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    stubApi({
      'GET /api/users': () => problem(401, 'Unauthorized'),
      'POST /api/auth/login': () => problem(401, 'Unauthorized'),
      'POST /api/auth/signup': () => problem(401, 'Unauthorized'),
      'GET /api/auth/me': () => problem(401, 'Unauthorized'),
      'GET /api/auth/config': () => problem(401, 'Unauthorized'),
    });

    const expected = [
      { path: '/api/auth/login', method: 'POST' },
      { path: '/api/auth/signup', method: 'POST' },
      { path: '/api/auth/me', method: 'GET' },
      { path: '/api/auth/config', method: 'GET' },
    ];
    for (const { path, method } of expected) {
      await expect(apiFetch(`${path}?x=1`, { method })).rejects.toMatchObject({ status: 401 });
    }
    expect(handler).not.toHaveBeenCalled();

    await expect(apiFetch('/api/users')).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not report other failures as an ended session', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    stubApi({ 'GET /api/users': () => problem(403, 'Forbidden') });

    await expect(apiFetch('/api/users')).rejects.toMatchObject({ status: 403 });

    expect(handler).not.toHaveBeenCalled();
  });
});
```

Run: `pnpm --filter @owui/web exec vitest run src/api`
Expected: FAIL (Module `session-state`, `error-message`, `test/stub-api` fehlen).

- [x] **Step 3: Testhilfen und Module schreiben**

`apps/web/src/test/stub-api.ts`:

```ts
import { vi } from 'vitest';

export interface StubRequest {
  method: string;
  url: URL;
  body: unknown;
  headers: Headers;
}

export type Handler = (request: StubRequest) => Response | Promise<Response>;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function problem(status: number, title: string, detail?: string): Response {
  return new Response(JSON.stringify({ title, detail, status }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/**
 * Replaces fetch for one test. Handlers are keyed "METHOD /path" (query string ignored) and may be swapped
 * between steps of a test; a request nobody expected answers 404 with a title that names it.
 */
export function stubApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://app.test');
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = handlers[`${method} ${url.pathname}`];
    if (handler === undefined) {
      return Promise.resolve(problem(404, `Unexpected request: ${method} ${url.pathname}`));
    }
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    return Promise.resolve(handler({ method, url, body, headers: new Headers(init?.headers) }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
```

`apps/web/src/test/fixtures.ts`:

```ts
import { type AuthConfigDto, type SessionInfoDto, type UserDto, UserDtoRole } from '@/api/generated/model';

export function userDto(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'user-1',
    email: 'ben@example.com',
    name: 'Ben Beispiel',
    role: UserDtoRole.user,
    disabled: false,
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

export function sessionInfo(user: UserDto = userDto(), csrfToken = 'csrf-test'): SessionInfoDto {
  return { user, csrfToken };
}

export function authConfig(overrides: Partial<AuthConfigDto> = {}): AuthConfigDto {
  return { signupEnabled: true, onboarding: false, apiKeysEnabled: true, ...overrides };
}
```

`apps/web/src/api/session-state.ts`:

```ts
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

let csrfToken: string | undefined;
let unauthorizedHandler: (() => void) | undefined;

/** The server hands the token out with the session (me, login, signup); the fetcher sends it back on writes. */
export function rememberCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

export function csrfHeaderFor(method: string): string | undefined {
  return SAFE_METHODS.has(method.toUpperCase()) ? undefined : csrfToken;
}

/** The app registers what happens when an ordinary request learns that the session is gone. */
export function setUnauthorizedHandler(handler: (() => void) | undefined): void {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}
```

`apps/web/src/api/error-message.ts`:

```ts
import { ApiError } from './fetcher';

const BY_STATUS: Record<number, string> = {
  403: 'error.forbidden',
  404: 'error.notFound',
  413: 'error.tooLarge',
  429: 'error.tooMany',
};

/**
 * The i18n key for a failed request. `specific` gives a status the meaning it has in the caller's context
 * (a 401 means "wrong password" on the login form), the rest is shared.
 */
export function errorMessageKey(error: unknown, specific: Partial<Record<number, string>> = {}): string {
  if (!(error instanceof ApiError)) return 'error.network';
  return specific[error.status] ?? BY_STATUS[error.status] ?? 'error.generic';
}
```

`apps/web/src/api/fetcher.ts` ersetzen durch (die Hilfsfunktionen `ApiError`, `parseJson`, `stringField` bleiben unverändert, `apiFetch` ist neu):

```ts
import { csrfHeaderFor, notifyUnauthorized, rememberCsrfToken } from './session-state';
import { createTraceparent } from './trace';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
    readonly requestId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** Answers that carry the session's token. */
const TOKEN_SOURCES = new Set(['/api/auth/me', '/api/auth/login', '/api/auth/signup']);
const LOGOUT = '/api/auth/logout';
/** A 401 here means "wrong credentials" or "not signed in yet", not "the session ended". */
const EXPECTED_401 = new Set([...TOKEN_SOURCES, '/api/auth/config']);

/**
 * Orval mutator. The server answers errors as RFC 9457 problem details; anything else
 * (a proxy's HTML page) still becomes an ApiError with the status code. Writing requests carry the CSRF token
 * of the session; a 401 on an ordinary request tells the app that the session is over.
 */
export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const path = url.split('?')[0] ?? url;
  const headers = new Headers(options.headers);
  headers.set('traceparent', createTraceparent());
  const token = csrfHeaderFor(options.method ?? 'GET');
  if (token !== undefined) headers.set('X-CSRF-Token', token);

  const response = await fetch(url, { ...options, headers, credentials: 'include' });
  const text = await response.text();
  const body: unknown = text === '' ? undefined : parseJson(text);

  if (!response.ok) {
    if (response.status === 401) {
      if (TOKEN_SOURCES.has(path)) rememberCsrfToken(undefined);
      if (!EXPECTED_401.has(path)) notifyUnauthorized();
    }
    throw new ApiError(
      response.status,
      stringField(body, 'title') ?? `Request failed (${response.status})`,
      stringField(body, 'detail'),
      stringField(body, 'requestId')
    );
  }
  if (TOKEN_SOURCES.has(path)) rememberCsrfToken(stringField(body, 'csrfToken'));
  if (path === LOGOUT) rememberCsrfToken(undefined);
  return { data: body, status: response.status, headers: response.headers } as T;
}
```

In `de.json` und `en.json` den Block `error` ergänzen (nach `status`):

```json
  "error": {
    "network": "Der Server ist gerade nicht erreichbar.",
    "generic": "Das hat nicht geklappt. Bitte versuche es erneut.",
    "forbidden": "Dafür fehlt dir die Berechtigung.",
    "notFound": "Das gibt es nicht (mehr).",
    "tooLarge": "Die Eingabe ist zu groß.",
    "tooMany": "Zu viele Versuche. Bitte warte einen Moment."
  },
```

```json
  "error": {
    "network": "The server cannot be reached right now.",
    "generic": "That did not work. Please try again.",
    "forbidden": "You are not allowed to do that.",
    "notFound": "That does not exist (any more).",
    "tooLarge": "The input is too large.",
    "tooMany": "Too many attempts. Please wait a moment."
  },
```

- [x] **Step 4: Tests laufen lassen, grün sehen**

Run: `pnpm --filter @owui/web exec vitest run src/api src/i18n`
Expected: PASS.

- [x] **Step 5: `pnpm check` und Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web
git commit -m "feat(web): send the session token on writes and report an ended session" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Anmelden und Registrieren

**Files:**
- Create: `apps/web/src/components/common/page-loading.tsx`, `apps/web/src/components/common/load-error.tsx`, `apps/web/src/features/auth/password-policy.ts`, `apps/web/src/features/auth/store-session.ts`, `apps/web/src/features/auth/store-session.spec.ts`, `apps/web/src/features/auth/login-form.tsx`, `apps/web/src/features/auth/signup-form.tsx`, `apps/web/src/pages/login-page.tsx`, `apps/web/src/pages/login-page.spec.tsx`
- Create (erzeugt): `apps/web/src/components/ui/{label,field,card,badge,table,dialog,alert-dialog,native-select}.tsx`
- Modify: `apps/web/src/test/render-app.tsx`, `apps/web/src/app/providers.tsx`, `apps/web/src/i18n/locales/de.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `useAuthConfig`, `useAuthLogin`, `useAuthSignup`, `getAuthMeQueryKey` (generierter Client), `errorMessageKey` (Task 1), `stubApi`/`json`/`problem`, `userDto`/`sessionInfo`/`authConfig` (Task 1).
- Produces:
  - `PageLoading()` (`role="status"`, sr-only-Text `common.loading`), `LoadError({ error: unknown; onRetry: () => void; busy: boolean })`
  - `PASSWORD_MIN_LENGTH` (12), `PASSWORD_MAX_LENGTH` (128) in `features/auth/password-policy.ts` (spiegeln `apps/api/src/users/password-policy.ts`; der Server setzt sie durch)
  - `storeSession(queryClient: QueryClient, session: SessionInfoDto): void`: entfernt alle Abfragen außer `me` und setzt `me` auf die neue Sitzung
  - `LoginForm()`, `SignupForm()`, `LoginPage()` (zeigt Laden/Fehler der Konfiguration, wählt Anmelden oder Registrieren)
  - Testhilfe `renderPage(ui: ReactElement, path?: string): { queryClient: QueryClient }` und `renderApp(path)` gibt jetzt `{ ...view, queryClient }` zurück
  - Der Standard des `QueryClient` für Abfragen ist `retry: false` (die Schaltfläche „Erneut versuchen“ ist der Wiederholungsweg)

- [x] **Step 1: shadcn-Bausteine holen**

Die Registry ist erreichbar und kennt alle Bausteine (am 2026-10-09 mit `pnpm exec shadcn view` geprüft).

Run: `pnpm --filter @owui/web exec shadcn add label field card badge table dialog alert-dialog native-select`
Expected: acht neue Dateien unter `apps/web/src/components/ui/`. Danach `git status` und `git diff` ansehen: `package.json` und `pnpm-lock.yaml` dürfen sich nicht ändern (alles kommt aus `radix-ui`, `cn`, `lucide-react`, die schon da sind), `src/index.css` höchstens um Variablen. Importiert eine neue Datei ein Paket, das nicht in `apps/web/package.json` steht, dieses Paket mit `pnpm --filter @owui/web add <paket>` ergänzen (Karenzzeit beachten) und den Grund in die Commit-Nachricht schreiben.

Run: `pnpm check`
Expected: grün (`components/ui/**` ist von ESLint und Prettier ausgenommen).

- [x] **Step 2: Fehlschlagende Tests schreiben**

`apps/web/src/features/auth/store-session.spec.ts`:

```ts
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { getAuthMeQueryKey } from '@/api/generated/api';
import { sessionInfo, userDto } from '@/test/fixtures';

import { storeSession } from './store-session';

describe('storeSession', () => {
  it('drops everything cached for the previous user and keeps only the new session', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(getAuthMeQueryKey(), { data: sessionInfo(userDto({ id: 'old' })), status: 200 });
    queryClient.setQueryData(['/api/users'], { data: [userDto({ id: 'secret' })] });
    queryClient.setQueryData(['/api/auth/api-keys'], { data: [] });

    storeSession(queryClient, sessionInfo(userDto({ id: 'new' })));

    expect(queryClient.getQueryData(['/api/users'])).toBeUndefined();
    expect(queryClient.getQueryData(['/api/auth/api-keys'])).toBeUndefined();
    expect(queryClient.getQueryData(getAuthMeQueryKey())).toMatchObject({
      data: { user: { id: 'new' } },
      status: 200,
    });
  });
});
```

`apps/web/src/pages/login-page.spec.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAuthMeQueryKey } from '@/api/generated/api';
import { authConfig, sessionInfo, userDto } from '@/test/fixtures';
import { renderPage } from '@/test/render-app';
import { type Handler, json, problem, stubApi } from '@/test/stub-api';

import { LoginPage } from './login-page';

const ADA = userDto({ id: 'u-ada', name: 'Ada', email: 'ada@example.com' });
const PASSWORD = 'correct horse battery';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubAuth(handlers: Record<string, Handler> = {}, config = authConfig()) {
  return stubApi({ 'GET /api/auth/config': () => json(200, config), ...handlers });
}

function postsTo(fetchMock: ReturnType<typeof stubApi>, path: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => String(input) === path && (init?.method ?? 'GET') === 'POST'
  );
}

async function fillLogin(user: ReturnType<typeof userEvent.setup>, password = PASSWORD) {
  await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ada@example.com');
  await user.type(screen.getByLabelText('Passwort'), password);
}

describe('LoginPage: sign in', () => {
  it('shows a loading state, then the form', async () => {
    stubAuth();

    renderPage(<LoginPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
    expect(screen.getByLabelText('E-Mail-Adresse')).toBeInTheDocument();
  });

  it('signs in with what was typed and replaces the cache with the new session', async () => {
    let sent: unknown;
    stubAuth({
      'POST /api/auth/login': ({ body }) => {
        sent = body;
        return json(200, sessionInfo(ADA));
      },
    });
    const user = userEvent.setup();
    const { queryClient } = renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });
    queryClient.setQueryData(['/api/users'], { data: [userDto({ id: 'previous-users-data' })] });
    await fillLogin(user);

    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    await waitFor(() => {
      expect(queryClient.getQueryData(getAuthMeQueryKey())).toMatchObject({
        data: { user: { id: 'u-ada' } },
      });
    });
    expect(sent).toEqual({ email: 'ada@example.com', password: PASSWORD });
    expect(queryClient.getQueryData(['/api/users'])).toBeUndefined();
  });

  it('explains a wrong password and lets the user try again with the email still filled', async () => {
    stubAuth({ 'POST /api/auth/login': () => problem(401, 'Unauthorized') });
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });
    await fillLogin(user, 'wrong password!');

    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-Mail-Adresse oder Passwort stimmt nicht.'
    );
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeEnabled();
    expect(screen.getByLabelText('E-Mail-Adresse')).toHaveValue('ada@example.com');
  });

  it('asks for both fields and sends nothing when one is empty', async () => {
    const fetchMock = stubAuth();
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ada@example.com');

    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Bitte fülle alle Felder aus.');
    expect(postsTo(fetchMock, '/api/auth/login')).toHaveLength(0);
  });

  it('sends one request on a double click and locks the button meanwhile', async () => {
    const fetchMock = stubAuth({ 'POST /api/auth/login': () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });
    await fillLogin(user);

    await user.dblClick(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('button', { name: 'Anmeldung läuft …' })).toBeDisabled();
    expect(postsTo(fetchMock, '/api/auth/login')).toHaveLength(1);
  });

  it.each([
    ['too many attempts', () => problem(429, 'Too Many Requests'), 'Zu viele Versuche. Bitte warte einen Moment.'],
    ['invalid input', () => problem(400, 'Bad Request'), 'Bitte prüfe deine Eingaben.'],
    ['a server error', () => problem(500, 'Internal Server Error'), 'Das hat nicht geklappt. Bitte versuche es erneut.'],
    [
      'an unreachable server',
      () => {
        throw new TypeError('Failed to fetch');
      },
      'Der Server ist gerade nicht erreichbar.',
    ],
  ])('says what happened after %s', async (_name, handler, message) => {
    stubAuth({ 'POST /api/auth/login': handler });
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });
    await fillLogin(user);

    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeEnabled();
  });

  it('shows an error with a retry button when the page settings cannot be loaded, and recovers', async () => {
    let healthy = false;
    stubApi({
      'GET /api/auth/config': () => (healthy ? json(200, authConfig()) : problem(503, 'Unavailable')),
    });
    const user = userEvent.setup();
    renderPage(<LoginPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
  });
});

describe('LoginPage: sign up', () => {
  it('offers registration only when the server allows it', async () => {
    stubAuth({}, authConfig({ signupEnabled: false }));
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });

    expect(screen.queryByRole('button', { name: /Registrieren/ })).not.toBeInTheDocument();
  });

  it('switches between the two forms', async () => {
    stubAuth();
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });

    await user.click(screen.getByRole('button', { name: /Registrieren/ }));
    expect(screen.getByRole('heading', { name: 'Konto erstellen' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Anmelden/ }));
    expect(screen.getByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
  });

  it('starts with registration and explains the admin role while no account exists', async () => {
    stubAuth({}, authConfig({ onboarding: true }));
    renderPage(<LoginPage />);

    expect(await screen.findByRole('heading', { name: 'Konto erstellen' })).toBeInTheDocument();
    expect(
      screen.getByText('Es gibt noch kein Konto. Das erste Konto wird Administrator.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anmelden/ })).not.toBeInTheDocument();
  });

  it('creates the account with the three fields and stores the session', async () => {
    let sent: unknown;
    stubAuth(
      {
        'POST /api/auth/signup': ({ body }) => {
          sent = body;
          return json(201, sessionInfo(ADA));
        },
      },
      authConfig({ onboarding: true })
    );
    const user = userEvent.setup();
    const { queryClient } = renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Konto erstellen' });
    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ada@example.com');
    await user.type(screen.getByLabelText('Passwort'), PASSWORD);

    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    await waitFor(() => {
      expect(queryClient.getQueryData(getAuthMeQueryKey())).toMatchObject({
        data: { user: { id: 'u-ada' } },
      });
    });
    expect(sent).toEqual({ email: 'ada@example.com', name: 'Ada', password: PASSWORD });
  });

  it.each([
    [409, 'Diese E-Mail-Adresse ist schon registriert.'],
    [403, 'Die Registrierung ist ausgeschaltet.'],
    [400, 'Bitte prüfe deine Eingaben.'],
    [429, 'Zu viele Versuche. Bitte warte einen Moment.'],
  ])('explains a %i answer', async (status, message) => {
    stubAuth({ 'POST /api/auth/signup': () => problem(status, 'x') }, authConfig({ onboarding: true }));
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Konto erstellen' });
    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ada@example.com');
    await user.type(screen.getByLabelText('Passwort'), PASSWORD);

    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Konto erstellen' })).toBeEnabled();
  });

  it.each([
    ['11 characters', 'x'.repeat(11), 'Das Passwort braucht mindestens 12 Zeichen.'],
    ['129 characters', 'x'.repeat(129), 'Das Passwort darf höchstens 128 Zeichen haben.'],
  ])('rejects a password of %s without asking the server', async (_name, password, message) => {
    const fetchMock = stubAuth({}, authConfig({ onboarding: true }));
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Konto erstellen' });
    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ada@example.com');
    await user.click(screen.getByLabelText('Passwort'));
    await user.paste(password);

    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(postsTo(fetchMock, '/api/auth/signup')).toHaveLength(0);
  });
});
```

Run: `pnpm --filter @owui/web exec vitest run src/features/auth src/pages`
Expected: FAIL (Module fehlen).

- [x] **Step 3: Gemeinsame Bausteine, Testhilfe und Texte**

`apps/web/src/components/common/page-loading.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';

export function PageLoading() {
  const { t } = useTranslation();
  return (
    <div role="status" className="w-full max-w-md">
      <Skeleton className="h-24 w-full" />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}
```

`apps/web/src/components/common/load-error.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** The error state of an asynchronous view: what failed, and a way to try again. */
export function LoadError({
  error,
  onRetry,
  busy,
}: {
  error: unknown;
  onRetry: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive">
      <AlertTitle>{t('common.loadFailed')}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t(errorMessageKey(error))}</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      </AlertDescription>
    </Alert>
  );
}
```

`apps/web/src/test/render-app.tsx` ersetzen:

```tsx
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';

import { AppProviders, createQueryClient } from '@/app/providers';
import { routes } from '@/app/router';

export function renderApp(path = '/') {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  return { ...view, queryClient, router };
}

/** One component inside the real providers, without the route table. */
export function renderPage(ui: ReactElement, path = '/') {
  const queryClient = createQueryClient();
  render(
    <AppProviders queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </AppProviders>
  );
  return { queryClient };
}
```

In `apps/web/src/app/providers.tsx` `createQueryClient` ändern:

```tsx
export function createQueryClient(): QueryClient {
  // No automatic retries: every failed view shows its own "Erneut versuchen" button.
  return new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  });
}
```

`apps/web/src/features/auth/password-policy.ts`:

```ts
/** Mirrors apps/api/src/users/password-policy.ts. Only for early feedback; the server enforces it. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
```

`apps/web/src/features/auth/store-session.ts`:

```ts
import type { QueryClient } from '@tanstack/react-query';

import { getAuthMeQueryKey } from '@/api/generated/api';
import type { SessionInfoDto } from '@/api/generated/model';

/**
 * Makes the given session the current one. Everything else in the cache belongs to whoever was signed in
 * before, so it goes; `me` stays and is overwritten so the views that watch it update.
 */
export function storeSession(queryClient: QueryClient, session: SessionInfoDto): void {
  const meKey = getAuthMeQueryKey();
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== meKey[0] });
  queryClient.setQueryData(meKey, { data: session, status: 200 as const, headers: new Headers() });
}
```

Texte: in `de.json` ergänzen:

```json
  "common": {
    "loading": "Wird geladen …",
    "loadFailed": "Das Laden hat nicht geklappt.",
    "retry": "Erneut versuchen",
    "cancel": "Abbrechen",
    "close": "Schließen",
    "save": "Speichern",
    "delete": "Löschen"
  },
  "auth": {
    "login": {
      "title": "Anmelden",
      "description": "Melde dich mit deinem Konto an.",
      "email": "E-Mail-Adresse",
      "password": "Passwort",
      "submit": "Anmelden",
      "submitting": "Anmeldung läuft …"
    },
    "signup": {
      "title": "Konto erstellen",
      "description": "Lege ein Konto an, um loszulegen.",
      "onboarding": "Es gibt noch kein Konto. Das erste Konto wird Administrator.",
      "name": "Name",
      "passwordHint": "Mindestens 12 Zeichen.",
      "submit": "Konto erstellen",
      "submitting": "Konto wird erstellt …"
    },
    "switch": {
      "toSignup": "Noch kein Konto? Registrieren",
      "toLogin": "Schon ein Konto? Anmelden"
    },
    "error": {
      "required": "Bitte fülle alle Felder aus.",
      "passwordShort": "Das Passwort braucht mindestens 12 Zeichen.",
      "passwordLong": "Das Passwort darf höchstens 128 Zeichen haben.",
      "credentials": "E-Mail-Adresse oder Passwort stimmt nicht.",
      "taken": "Diese E-Mail-Adresse ist schon registriert.",
      "closed": "Die Registrierung ist ausgeschaltet.",
      "invalid": "Bitte prüfe deine Eingaben."
    }
  },
```

in `en.json`:

```json
  "common": {
    "loading": "Loading …",
    "loadFailed": "Loading failed.",
    "retry": "Try again",
    "cancel": "Cancel",
    "close": "Close",
    "save": "Save",
    "delete": "Delete"
  },
  "auth": {
    "login": {
      "title": "Sign in",
      "description": "Sign in with your account.",
      "email": "Email address",
      "password": "Password",
      "submit": "Sign in",
      "submitting": "Signing in …"
    },
    "signup": {
      "title": "Create account",
      "description": "Create an account to get started.",
      "onboarding": "There is no account yet. The first account becomes the administrator.",
      "name": "Name",
      "passwordHint": "At least 12 characters.",
      "submit": "Create account",
      "submitting": "Creating account …"
    },
    "switch": {
      "toSignup": "No account yet? Sign up",
      "toLogin": "Already have an account? Sign in"
    },
    "error": {
      "required": "Please fill in all fields.",
      "passwordShort": "The password needs at least 12 characters.",
      "passwordLong": "The password may have at most 128 characters.",
      "credentials": "The email address or password is wrong.",
      "taken": "This email address is already registered.",
      "closed": "Sign-up is switched off.",
      "invalid": "Please check your input."
    }
  },
```

- [x] **Step 4: Formulare und Seite schreiben**

`apps/web/src/features/auth/login-form.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { useAuthLogin } from '@/api/generated/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { storeSession } from './store-session';

export function LoginForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string>();
  const login = useAuthLogin({
    mutation: {
      onSuccess: (result) => {
        storeSession(queryClient, result.data);
      },
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (login.isPending) return;
    if (email.trim() === '' || password === '') {
      setFormError('auth.error.required');
      return;
    }
    setFormError(undefined);
    login.mutate({ data: { email, password } });
  }

  const errorKey =
    formError ??
    (login.isError
      ? errorMessageKey(login.error, { 400: 'auth.error.invalid', 401: 'auth.error.credentials' })
      : undefined);

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={emailId}>{t('auth.login.email')}</FieldLabel>
          <Input
            id={emailId}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={passwordId}>{t('auth.login.password')}</FieldLabel>
          <Input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
        </Field>
      </FieldGroup>
      {errorKey !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorKey)}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={login.isPending}>
        {login.isPending ? t('auth.login.submitting') : t('auth.login.submit')}
      </Button>
    </form>
  );
}
```

`apps/web/src/features/auth/signup-form.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { useAuthSignup } from '@/api/generated/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password-policy';
import { storeSession } from './store-session';

export function SignupForm() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string>();
  const signup = useAuthSignup({
    mutation: {
      onSuccess: (result) => {
        storeSession(queryClient, result.data);
      },
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (signup.isPending) return;
    if (name.trim() === '' || email.trim() === '' || password === '') {
      setFormError('auth.error.required');
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setFormError('auth.error.passwordShort');
      return;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      setFormError('auth.error.passwordLong');
      return;
    }
    setFormError(undefined);
    signup.mutate({ data: { email, name, password } });
  }

  const errorKey =
    formError ??
    (signup.isError
      ? errorMessageKey(signup.error, {
          400: 'auth.error.invalid',
          403: 'auth.error.closed',
          409: 'auth.error.taken',
        })
      : undefined);

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={nameId}>{t('auth.signup.name')}</FieldLabel>
          <Input
            id={nameId}
            autoComplete="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={emailId}>{t('auth.login.email')}</FieldLabel>
          <Input
            id={emailId}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={passwordId}>{t('auth.login.password')}</FieldLabel>
          <Input
            id={passwordId}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <FieldDescription>{t('auth.signup.passwordHint')}</FieldDescription>
        </Field>
      </FieldGroup>
      {errorKey !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorKey)}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={signup.isPending}>
        {signup.isPending ? t('auth.signup.submitting') : t('auth.signup.submit')}
      </Button>
    </form>
  );
}
```

`apps/web/src/pages/login-page.tsx`:

```tsx
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthConfig } from '@/api/generated/api';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { LoginForm } from '@/features/auth/login-form';
import { SignupForm } from '@/features/auth/signup-form';

const AUTH_MODE = { LOGIN: 'login', SIGNUP: 'signup' } as const;
type AuthMode = (typeof AUTH_MODE)[keyof typeof AUTH_MODE];

export function LoginPage() {
  const { t } = useTranslation();
  const config = useAuthConfig();
  const [chosen, setChosen] = useState<AuthMode>();

  let content: ReactNode;
  if (config.isPending) {
    content = <PageLoading />;
  } else if (config.isError) {
    content = (
      <LoadError
        error={config.error}
        busy={config.isFetching}
        onRetry={() => {
          void config.refetch();
        }}
      />
    );
  } else {
    const { signupEnabled, onboarding } = config.data.data;
    const mode = chosen ?? (onboarding ? AUTH_MODE.SIGNUP : AUTH_MODE.LOGIN);
    const signingUp = mode === AUTH_MODE.SIGNUP;
    let description = t(signingUp ? 'auth.signup.description' : 'auth.login.description');
    if (signingUp && onboarding) description = t('auth.signup.onboarding');
    content = (
      <Card>
        <CardHeader>
          <h1 className="text-xl font-semibold">
            {t(signingUp ? 'auth.signup.title' : 'auth.login.title')}
          </h1>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{signingUp ? <SignupForm /> : <LoginForm />}</CardContent>
        {signupEnabled && !onboarding && (
          <CardFooter>
            <Button
              variant="link"
              className="px-0"
              onClick={() => {
                setChosen(signingUp ? AUTH_MODE.LOGIN : AUTH_MODE.SIGNUP);
              }}
            >
              {t(signingUp ? 'auth.switch.toLogin' : 'auth.switch.toSignup')}
            </Button>
          </CardFooter>
        )}
      </Card>
    );
  }

  return (
    <main className="grid min-h-svh place-items-center p-4">
      <div className="w-full max-w-sm">{content}</div>
    </main>
  );
}
```

- [x] **Step 5: Tests laufen lassen, grün sehen**

Run: `pnpm --filter @owui/web exec vitest run`
Expected: PASS (auch die bestehenden Web-Tests; `renderApp` liefert jetzt ein Objekt, die Aufrufer ignorieren den Rückgabewert). Stolpersteine: (a) heißt die Anmeldeschaltfläche und der Umschalter beide „Anmelden“, trennt `getByRole('button', { name: /Anmelden/ })` nur im Modus „Registrieren“ eindeutig, dort gibt es keine Anmeldeschaltfläche; (b) `userEvent.paste` braucht vorher einen Klick ins Feld, der Test macht das; (c) die Karten-Bausteine aus `shadcn add` können `CardTitle` als `div` rendern, deshalb steht die Überschrift als eigenes `h1`.

- [x] **Step 6: `pnpm check` und Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web
git commit -m "feat(web): add sign-in and sign-up pages" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sitzung, Router-Wächter, Abmelden und Wartebildschirm

**Files:**
- Create: `apps/web/src/features/auth/session.ts`, `apps/web/src/features/auth/session-gate.tsx`, `apps/web/src/features/auth/session-gate.spec.tsx`, `apps/web/src/features/auth/use-sign-out.ts`, `apps/web/src/pages/pending-page.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/app/router.spec.tsx`, `apps/web/src/app/providers.tsx`, `apps/web/src/components/layout/app-layout.tsx`, `apps/web/src/i18n/locales/de.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `useAuthMe`, `useAuthLogout`, `getAuthMeQueryKey` (generierter Client), `UserDtoRole`, `ApiError`, `setUnauthorizedHandler` (Task 1), `PageLoading`, `LoadError`, `LoginPage` (Task 2), `renderApp`/`renderPage`, `stubApi`.
- Produces:
  - `SESSION_STATUS = { LOADING, ANONYMOUS, ERROR, READY }`, `Session` (Union; `ERROR` trägt `error`, `retry()`, `retrying`; `READY` trägt `user: UserDto`), `useSession(): Session`, `useCurrentUser(): UserDto` (wirft außerhalb einer bereiten Sitzung)
  - `GATE = { ANONYMOUS, PENDING, MEMBER, ADMIN }`, `SessionGate({ allow: Gate })` (Layout-Route, rendert `<Outlet />` oder leitet um)
  - `useSignOut()`: Mutation; bei Erfolg Cache leeren und auf `/login`
  - Routen: `/login` (nur anonym), `/pending` (nur wartend), `/` mit `AppLayout` (nur Mitglieder)
  - Zuordnung (Zeile = Zustand, Spalte = Wächter): anonym → Ziel | Login | Login | Login; wartend → `/pending` | Ziel | `/pending` | `/pending`; Nutzer → `/` | `/` | Ziel | `/`; Admin → `/` | `/` | Ziel | Ziel (Spalten: ANONYMOUS, PENDING, MEMBER, ADMIN)

- [x] **Step 1: Fehlschlagende Tests schreiben**

`apps/web/src/features/auth/session-gate.spec.tsx`:

```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '@/api/fetcher';
import { getAuthMeQueryKey } from '@/api/generated/api';
import { UserDtoRole } from '@/api/generated/model';
import { AppProviders, createQueryClient } from '@/app/providers';
import { authConfig, sessionInfo, userDto } from '@/test/fixtures';
import { type Handler, json, problem, stubApi } from '@/test/stub-api';

import { type Gate, GATE, SessionGate } from './session-gate';

afterEach(() => {
  vi.unstubAllGlobals();
});

const WHO = {
  anonymous: () => problem(401, 'Unauthorized'),
  pending: () => json(200, sessionInfo(userDto({ role: UserDtoRole.pending }))),
  user: () => json(200, sessionInfo(userDto({ role: UserDtoRole.user }))),
  admin: () => json(200, sessionInfo(userDto({ role: UserDtoRole.admin }))),
} satisfies Record<string, Handler>;

function renderGate(allow: Gate, me: Handler) {
  stubApi({ 'GET /api/auth/me': me, 'GET /api/auth/config': () => json(200, authConfig()) });
  const queryClient = createQueryClient();
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Startseite</p> },
      { path: '/login', element: <p>Anmeldeseite</p> },
      { path: '/pending', element: <p>Wartebildschirm</p> },
      { element: <SessionGate allow={allow} />, children: [{ path: '/target', element: <p>Ziel</p> }] },
    ],
    { initialEntries: ['/target'] }
  );
  render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  return { queryClient, router };
}

describe('SessionGate', () => {
  const MATRIX: [Gate, keyof typeof WHO, string][] = [
    [GATE.ANONYMOUS, 'anonymous', 'Ziel'],
    [GATE.ANONYMOUS, 'pending', 'Wartebildschirm'],
    [GATE.ANONYMOUS, 'user', 'Startseite'],
    [GATE.ANONYMOUS, 'admin', 'Startseite'],
    [GATE.PENDING, 'anonymous', 'Anmeldeseite'],
    [GATE.PENDING, 'pending', 'Ziel'],
    [GATE.PENDING, 'user', 'Startseite'],
    [GATE.PENDING, 'admin', 'Startseite'],
    [GATE.MEMBER, 'anonymous', 'Anmeldeseite'],
    [GATE.MEMBER, 'pending', 'Wartebildschirm'],
    [GATE.MEMBER, 'user', 'Ziel'],
    [GATE.MEMBER, 'admin', 'Ziel'],
    [GATE.ADMIN, 'anonymous', 'Anmeldeseite'],
    [GATE.ADMIN, 'pending', 'Wartebildschirm'],
    [GATE.ADMIN, 'user', 'Startseite'],
    [GATE.ADMIN, 'admin', 'Ziel'],
  ];

  it.each(MATRIX)('gate %s, state %s: shows %s', async (allow, who, expected) => {
    renderGate(allow, WHO[who]);

    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('shows a loading state while the session is being checked', () => {
    renderGate(GATE.MEMBER, () => new Promise<Response>(() => undefined));

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an error with a retry button when the server fails, and recovers', async () => {
    let healthy = false;
    renderGate(GATE.MEMBER, () => (healthy ? WHO.user() : problem(500, 'Internal Server Error')));
    const user = userEvent.setup();

    expect(await screen.findByRole('alert')).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByText('Ziel')).toBeInTheDocument();
  });

  it('lets the sign-in page appear even when the session check fails', async () => {
    renderGate(GATE.ANONYMOUS, () => problem(503, 'Unavailable'));

    expect(await screen.findByText('Ziel')).toBeInTheDocument();
  });

  it('keeps a signed-in user in place when a later refresh fails for another reason than 401', async () => {
    let failing = false;
    const { queryClient } = renderGate(GATE.MEMBER, () => (failing ? problem(500, 'x') : WHO.user()));
    await screen.findByText('Ziel');

    failing = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: getAuthMeQueryKey() });
    });

    expect(screen.getByText('Ziel')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends the user to sign-in when an ordinary request learns the session ended', async () => {
    let signedIn = true;
    stubApi({
      'GET /api/auth/me': () => (signedIn ? WHO.user() : WHO.anonymous()),
      'GET /api/something': () => problem(401, 'Unauthorized'),
    });
    const router = createMemoryRouter(
      [
        { path: '/login', element: <p>Anmeldeseite</p> },
        { element: <SessionGate allow={GATE.MEMBER} />, children: [{ path: '/', element: <p>Ziel</p> }] },
      ],
      { initialEntries: ['/'] }
    );
    render(
      <AppProviders queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>
    );
    await screen.findByText('Ziel');

    signedIn = false;
    await act(async () => {
      await apiFetch('/api/something').catch(() => undefined);
    });

    expect(await screen.findByText('Anmeldeseite')).toBeInTheDocument();
  });

  it('remembers where the visitor wanted to go', async () => {
    const { router } = renderGate(GATE.MEMBER, WHO.anonymous);

    await screen.findByText('Anmeldeseite');

    expect(router.state.location.state).toEqual({ from: '/target' });
  });
});
```

`apps/web/src/app/router.spec.tsx` ersetzen (die drei bisherigen Tests laufen jetzt als angemeldeter Nutzer, dazu kommen die Seiten dieser Task):

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserDtoRole } from '@/api/generated/model';
import { authConfig, sessionInfo, userDto } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { json, noContent, problem, stubApi } from '@/test/stub-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSignedIn(user = userDto({ name: 'Ben Beispiel' })) {
  return stubApi({
    'GET /api/auth/me': () => json(200, sessionInfo(user)),
    'GET /api/health/ready': () => json(200, { status: 'ok' }),
  });
}

describe('app routing and layout', () => {
  it('renders the home page inside a main landmark with navigation and theme toggle', async () => {
    stubSignedIn();

    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Willkommen' })
    );
    expect(screen.getByRole('link', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Darstellung wechseln/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute(
      'href',
      '#content'
    );
  });

  it('answers an unknown address with a friendly page and a way back', async () => {
    stubSignedIn();

    renderApp('/gibt-es-nicht');

    expect(await screen.findByRole('heading', { name: 'Seite nicht gefunden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Startseite' })).toHaveAttribute('href', '/');
  });

  it('announces the mobile sidebar in German instead of the generated English text', async () => {
    stubSignedIn();
    vi.stubGlobal('innerWidth', 375);
    const user = userEvent.setup();
    renderApp('/');

    await user.click(
      await screen.findByRole('button', { name: 'Seitenleiste ein- oder ausblenden' })
    );

    expect(await screen.findByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
  });

  it('sends an anonymous visitor to sign-in and, after signing in, back to the wanted address', async () => {
    let signedIn = false;
    stubApi({
      'GET /api/auth/me': () => (signedIn ? json(200, sessionInfo(userDto())) : problem(401, 'Unauthorized')),
      'GET /api/auth/config': () => json(200, authConfig()),
      'POST /api/auth/login': () => {
        signedIn = true;
        return json(200, sessionInfo(userDto()));
      },
    });
    const user = userEvent.setup();
    renderApp('/gibt-es-nicht');

    await screen.findByRole('heading', { name: 'Anmelden' });
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ben@example.com');
    await user.type(screen.getByLabelText('Passwort'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('heading', { name: 'Seite nicht gefunden' })).toBeInTheDocument();
  });

  it('keeps a waiting account on the waiting screen, whatever address it types', async () => {
    stubSignedIn(userDto({ role: UserDtoRole.pending, name: 'Pia' }));

    renderApp('/');

    expect(
      await screen.findByRole('heading', { name: 'Dein Konto wartet auf Freischaltung' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('lets a waiting account check its status and moves on once it was approved', async () => {
    let role: 'pending' | 'user' = UserDtoRole.pending;
    stubApi({
      'GET /api/auth/me': () => json(200, sessionInfo(userDto({ role, name: 'Pia' }))),
      'GET /api/health/ready': () => json(200, { status: 'ok' }),
    });
    const user = userEvent.setup();
    renderApp('/pending');
    await screen.findByRole('heading', { name: 'Dein Konto wartet auf Freischaltung' });

    role = UserDtoRole.user;
    await user.click(screen.getByRole('button', { name: 'Status prüfen' }));

    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
  });

  it('shows the signed-in name and signs out: cache gone, back on the sign-in page', async () => {
    let signedIn = true;
    const fetchMock = stubApi({
      'GET /api/auth/me': () =>
        signedIn ? json(200, sessionInfo(userDto({ name: 'Ben Beispiel' }))) : problem(401, 'Unauthorized'),
      'GET /api/auth/config': () => json(200, authConfig()),
      'GET /api/health/ready': () => json(200, { status: 'ok' }),
      'POST /api/auth/logout': () => {
        signedIn = false;
        return noContent();
      },
    });
    const user = userEvent.setup();
    const { queryClient } = renderApp('/');
    expect(await screen.findByText('Ben Beispiel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abmelden' }));

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
    expect(queryClient.getQueryCache().findAll({ queryKey: ['/api/health/ready'] })).toHaveLength(0);
    const logoutCalls = fetchMock.mock.calls.filter(([input]) => String(input) === '/api/auth/logout');
    expect(logoutCalls).toHaveLength(1);
  });

  it('keeps the user in place and says so when signing out fails', async () => {
    stubApi({
      'GET /api/auth/me': () => json(200, sessionInfo(userDto())),
      'GET /api/health/ready': () => json(200, { status: 'ok' }),
      'POST /api/auth/logout': () => problem(500, 'Internal Server Error'),
    });
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { name: 'Willkommen' });

    await user.click(screen.getByRole('button', { name: 'Abmelden' }));

    expect(await screen.findByText('Das hat nicht geklappt. Bitte versuche es erneut.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeEnabled();
  });
});
```

Run: `pnpm --filter @owui/web exec vitest run src/features/auth/session-gate.spec.tsx src/app`
Expected: FAIL (Module fehlen).

- [x] **Step 2: Sitzung und Wächter schreiben**

`apps/web/src/features/auth/session.ts`:

```ts
import { ApiError } from '@/api/fetcher';
import { useAuthMe } from '@/api/generated/api';
import type { UserDto } from '@/api/generated/model';

export const SESSION_STATUS = {
  LOADING: 'loading',
  ANONYMOUS: 'anonymous',
  ERROR: 'error',
  READY: 'ready',
} as const;

export type Session =
  | { status: typeof SESSION_STATUS.LOADING }
  | { status: typeof SESSION_STATUS.ANONYMOUS }
  | { status: typeof SESSION_STATUS.ERROR; error: unknown; retry: () => void; retrying: boolean }
  | { status: typeof SESSION_STATUS.READY; user: UserDto };

/** Who is signed in, from the one `me` query. Only a 401 means "nobody"; other failures keep what was known. */
export function useSession(): Session {
  const me = useAuthMe({ query: { staleTime: 60_000 } });
  if (me.error instanceof ApiError && me.error.status === 401) {
    return { status: SESSION_STATUS.ANONYMOUS };
  }
  // A failed background refresh must not throw a signed-in user out.
  if (me.data !== undefined) return { status: SESSION_STATUS.READY, user: me.data.data.user };
  if (me.isPending) return { status: SESSION_STATUS.LOADING };
  return {
    status: SESSION_STATUS.ERROR,
    error: me.error,
    retry: () => {
      void me.refetch();
    },
    retrying: me.isFetching,
  };
}

/** For views below a `SessionGate`: the gate guarantees a user, so anything else is a programming error. */
export function useCurrentUser(): UserDto {
  const session = useSession();
  if (session.status !== SESSION_STATUS.READY) {
    throw new Error('useCurrentUser needs a signed-in session: render it below a SessionGate');
  }
  return session.user;
}
```

`apps/web/src/features/auth/session-gate.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { UserDtoRole } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';

import { SESSION_STATUS, useSession } from './session';

export const GATE = {
  /** The sign-in page: only for visitors who are not signed in. */
  ANONYMOUS: 'anonymous',
  /** The waiting screen: only for accounts that wait for approval. */
  PENDING: 'pending',
  /** Everything else: signed in and approved. */
  MEMBER: 'member',
  ADMIN: 'admin',
} as const;

export type Gate = (typeof GATE)[keyof typeof GATE];

/** Convenience only. The server decides what a session may do; this just sends people to the right page. */
function redirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state && typeof state.from === 'string') {
    const { from } = state;
    if (from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login')) return from;
  }
  return '/';
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-[50svh] place-items-center p-4">{children}</div>;
}

export function SessionGate({ allow }: { allow: Gate }) {
  const session = useSession();
  const location = useLocation();

  if (session.status === SESSION_STATUS.LOADING) {
    return (
      <Centered>
        <PageLoading />
      </Centered>
    );
  }
  if (session.status === SESSION_STATUS.ERROR) {
    // The sign-in page copes with an unreachable server on its own.
    if (allow === GATE.ANONYMOUS) return <Outlet />;
    return (
      <Centered>
        <div className="w-full max-w-md">
          <LoadError error={session.error} busy={session.retrying} onRetry={session.retry} />
        </div>
      </Centered>
    );
  }
  if (session.status === SESSION_STATUS.ANONYMOUS) {
    if (allow === GATE.ANONYMOUS) return <Outlet />;
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  const pending = session.user.role === UserDtoRole.pending;
  switch (allow) {
    case GATE.ANONYMOUS:
      return <Navigate to={pending ? '/pending' : redirectTarget(location.state)} replace />;
    case GATE.PENDING:
      return pending ? <Outlet /> : <Navigate to="/" replace />;
    case GATE.MEMBER:
      return pending ? <Navigate to="/pending" replace /> : <Outlet />;
    case GATE.ADMIN:
      if (pending) return <Navigate to="/pending" replace />;
      return session.user.role === UserDtoRole.admin ? <Outlet /> : <Navigate to="/" replace />;
  }
}
```

`apps/web/src/features/auth/use-sign-out.ts`:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { useAuthLogout } from '@/api/generated/api';

/** Ends the session on the server, forgets everything cached for this user and goes to the sign-in page. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useAuthLogout({
    mutation: {
      onSuccess: () => {
        queryClient.removeQueries();
        void navigate('/login', { replace: true });
      },
    },
  });
}
```

`apps/web/src/pages/pending-page.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { useAuthMe } from '@/api/generated/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { useCurrentUser } from '@/features/auth/session';
import { useSignOut } from '@/features/auth/use-sign-out';

export function PendingPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const me = useAuthMe();
  const signOut = useSignOut();

  return (
    <main className="grid min-h-svh place-items-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-xl font-semibold">{t('pending.title')}</h1>
          <CardDescription>{t('pending.body', { name: user.name })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(me.isError || signOut.isError) && (
            <Alert variant="destructive">
              <AlertDescription>{t(errorMessageKey(me.error ?? signOut.error))}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={me.isFetching}
              onClick={() => {
                void me.refetch();
              }}
            >
              {me.isFetching ? t('pending.checking') : t('pending.check')}
            </Button>
            <Button
              variant="outline"
              disabled={signOut.isPending}
              onClick={() => {
                signOut.mutate();
              }}
            >
              {signOut.isPending ? t('userMenu.signingOut') : t('userMenu.signOut')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
```

`apps/web/src/app/router.tsx`:

```tsx
import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppLayout } from '@/components/layout/app-layout';
import { GATE, SessionGate } from '@/features/auth/session-gate';
import { HomePage } from '@/pages/home-page';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { PendingPage } from '@/pages/pending-page';

export const routes: RouteObject[] = [
  {
    element: <SessionGate allow={GATE.ANONYMOUS} />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  {
    element: <SessionGate allow={GATE.PENDING} />,
    children: [{ path: '/pending', element: <PendingPage /> }],
  },
  {
    element: <SessionGate allow={GATE.MEMBER} />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
```

`apps/web/src/app/providers.tsx`: Importe `useEffect`, `getAuthMeQueryKey`, `setUnauthorizedHandler` ergänzen und `AppProviders` ersetzen:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';

import { setUnauthorizedHandler } from '@/api/session-state';
import { getAuthMeQueryKey } from '@/api/generated/api';
import { ThemeProvider } from '@/components/theme/theme-provider';

export function createQueryClient(): QueryClient {
  // No automatic retries: every failed view shows its own "Erneut versuchen" button.
  return new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  });
}

const appQueryClient = createQueryClient();

export function AppProviders({
  children,
  queryClient = appQueryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  // An ordinary request that answers 401 means the session ended: look again, the gates do the rest.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void queryClient.invalidateQueries({ queryKey: getAuthMeQueryKey() });
    });
    return () => {
      setUnauthorizedHandler(undefined);
    };
  }, [queryClient]);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
```

`apps/web/src/components/layout/app-layout.tsx`: Importe `SidebarFooter` (aus `@/components/ui/sidebar`), `errorMessageKey`, `useCurrentUser`, `useSignOut` ergänzen; Komponente `UserFooter` einfügen und nach `</SidebarContent>` einsetzen:

```tsx
function UserFooter() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  const signOut = useSignOut();
  return (
    <SidebarFooter className="gap-2">
      <p className="truncate px-2 text-sm" title={user.email}>
        {user.name}
      </p>
      {signOut.isError && (
        <p role="alert" className="text-destructive px-2 text-xs">
          {t(errorMessageKey(signOut.error))}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={signOut.isPending}
        onClick={() => {
          signOut.mutate();
        }}
      >
        {signOut.isPending ? t('userMenu.signingOut') : t('userMenu.signOut')}
      </Button>
    </SidebarFooter>
  );
}
```

```tsx
        </SidebarContent>
        <UserFooter />
      </Sidebar>
```

Texte ergänzen. `de.json`:

```json
  "pending": {
    "title": "Dein Konto wartet auf Freischaltung",
    "body": "Hallo {{name}}, ein Administrator muss dein Konto noch freigeben. Danach kannst du loslegen.",
    "check": "Status prüfen",
    "checking": "Wird geprüft …"
  },
  "userMenu": {
    "signOut": "Abmelden",
    "signingOut": "Abmeldung läuft …"
  },
```

`en.json`:

```json
  "pending": {
    "title": "Your account is waiting for approval",
    "body": "Hello {{name}}, an administrator still has to approve your account. After that you can get started.",
    "check": "Check status",
    "checking": "Checking …"
  },
  "userMenu": {
    "signOut": "Sign out",
    "signingOut": "Signing out …"
  },
```

- [x] **Step 3: Tests laufen lassen, grün sehen**

Run: `pnpm --filter @owui/web exec vitest run`
Expected: PASS. Stolpersteine: (a) `let role: 'pending' | 'user' = UserDtoRole.pending;` im Router-Test: TypeScript verengt `role` auf den Literaltyp der Zuweisung; schlägt der Linter bei der späteren Zuweisung an, `let role: string = UserDtoRole.pending;` und `userDto({ role: ... })` mit dem Wörterbuch-Wert füttern, oder zwei Handler tauschen; (b) die Matrix-Tests lassen `findByText('Startseite')` auch bei kurz sichtbarem Ziel durch; das ist gewollt, weil `Navigate` synchron umleitet; (c) `router.state.location.state` ist in React Router 8 öffentlich; fehlt das Feld, `router.state.location` im Debugger ansehen.

- [x] **Step 4: `pnpm check` und Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web
git commit -m "feat(web): guard routes by session state and add sign-out and waiting screen" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Kontoseite (Passwort ändern, eigene API-Schlüssel)

**Files:**
- Create: `apps/web/src/lib/format-date.ts`, `apps/web/src/lib/format-date.spec.ts`, `apps/web/src/features/account/password-form.tsx`, `apps/web/src/features/account/api-keys-section.tsx`, `apps/web/src/pages/account-page.tsx`, `apps/web/src/pages/account-page.spec.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/components/layout/app-layout.tsx`, `apps/web/src/i18n/locales/de.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `useAuthChangePassword`, `useAuthConfig`, `useApiKeysList`, `useApiKeysCreate`, `useApiKeysRevoke`, `getApiKeysListQueryKey` (generierter Client; Formen `mutate({ data })` und `mutate({ id })`), `ApiKeyDto`, `CreatedApiKeyDto`, `useCurrentUser` (Task 3), `errorMessageKey`, `PageLoading`, `LoadError`, `PASSWORD_MIN_LENGTH`/`PASSWORD_MAX_LENGTH` (Task 2), `renderApp`, `stubApi`, Fixtures.
- Produces:
  - `formatDate(iso: string, language: string): string` (Datum ohne Uhrzeit, in der Sprache der Oberfläche)
  - `PasswordForm()`, `ApiKeysSection()`, `AccountPage()`; Route `/settings/account` unter dem Layout (Mitglieder), Navigationslink „Konto“
  - Der Klartext eines neuen Schlüssels lebt nur im Zustand des Dialogs-Eigentümers (`ApiKeysSection`) und wird beim Schließen verworfen.

**Verhalten:**
- Passwort: aktuelles, neues und Wiederholung. Leere Felder, zu kurz (< 12), zu lang (> 128) und Wiederholung ungleich werden vor dem Senden gemeldet. Der Server antwortet bei falschem aktuellem Passwort mit **400** (nicht 401, sonst würde der Fetcher die Sitzung für beendet halten); die Meldung nennt beide Möglichkeiten. Bei Erfolg sind die Felder leer und eine Erfolgsmeldung steht da; die anderen Geräte sind abgemeldet (das sagt der Text).
- API-Schlüssel: Ist `apiKeysEnabled` aus (aus `GET /auth/config`), erscheint ein Hinweis statt der Liste und es gibt keine Anfrage an `/api/auth/api-keys`. Sonst: Laden, Fehler mit „Erneut versuchen“, leer, Liste (Name, Anfang, Erstellt, Zuletzt benutzt, Läuft ab) mit „Widerrufen“ nach Rückfrage. „Neuen Schlüssel erstellen“: Name und Laufzeit (nie, 30, 90, 365 Tage); danach zeigt ein Dialog den Schlüssel **einmal** mit Kopieren-Schaltfläche und Warnung.

- [x] **Step 1: Fehlschlagende Tests schreiben**

`apps/web/src/lib/format-date.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { formatDate } from './format-date';

describe('formatDate', () => {
  it('writes the day in the language of the interface, without a time', () => {
    expect(formatDate('2026-10-01T12:00:00.000Z', 'de')).toMatch(/^0?1\.\s?(10\.|Okt\.?)\s?2026$/);
    expect(formatDate('2026-10-01T12:00:00.000Z', 'en')).toMatch(/Oct/);
  });
});
```

`apps/web/src/pages/account-page.spec.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiKeyDto } from '@/api/generated/model';
import { authConfig, sessionInfo, userDto } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { type Handler, json, noContent, problem, stubApi } from '@/test/stub-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CURRENT = 'old passphrase 1234';
const NEXT = 'brand new passphrase';

function apiKey(overrides: Partial<ApiKeyDto> = {}): ApiKeyDto {
  return {
    id: 'key-1',
    name: 'Skript',
    prefix: 'sk-1a2b3c4d',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

function stubAccount(handlers: Record<string, Handler> = {}, config = authConfig()) {
  return stubApi({
    'GET /api/auth/me': () => json(200, sessionInfo(userDto({ name: 'Ben Beispiel', email: 'ben@example.com' }))),
    'GET /api/auth/config': () => json(200, config),
    'GET /api/auth/api-keys': () => json(200, []),
    ...handlers,
  });
}

function callsTo(fetchMock: ReturnType<typeof stubApi>, method: string, path: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => String(input) === path && (init?.method ?? 'GET') === method
  );
}

async function openAccount() {
  renderApp('/settings/account');
  await screen.findByRole('heading', { name: 'Konto' });
}

async function fillPasswords(
  user: ReturnType<typeof userEvent.setup>,
  { current = CURRENT, next = NEXT, repeat = NEXT } = {}
) {
  await user.type(screen.getByLabelText('Aktuelles Passwort'), current);
  await user.type(screen.getByLabelText('Neues Passwort'), next);
  await user.type(screen.getByLabelText('Neues Passwort wiederholen'), repeat);
}

describe('AccountPage: profile and navigation', () => {
  it('shows who is signed in and is reachable from the navigation', async () => {
    stubAccount();
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { name: 'Willkommen' });

    await user.click(screen.getByRole('link', { name: 'Konto' }));

    expect(await screen.findByRole('heading', { name: 'Konto' })).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    expect(main.getByText('Ben Beispiel')).toBeInTheDocument();
    expect(main.getByText('ben@example.com')).toBeInTheDocument();
  });
});

describe('AccountPage: change password', () => {
  it('sends the passwords, empties the fields and confirms', async () => {
    let sent: unknown;
    stubAccount({
      'POST /api/auth/password': ({ body }) => {
        sent = body;
        return noContent();
      },
    });
    const user = userEvent.setup();
    await openAccount();
    await fillPasswords(user);

    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByText(/Dein Passwort ist geändert/)).toBeInTheDocument();
    expect(sent).toEqual({ currentPassword: CURRENT, newPassword: NEXT });
    expect(screen.getByLabelText('Aktuelles Passwort')).toHaveValue('');
    expect(screen.getByLabelText('Neues Passwort')).toHaveValue('');
  });

  it.each([
    ['a field is empty', { current: '' }, 'Bitte fülle alle Felder aus.'],
    ['the new password is too short', { next: 'short', repeat: 'short' }, 'Das Passwort braucht mindestens 12 Zeichen.'],
    [
      'the new password is too long',
      { next: 'x'.repeat(129), repeat: 'x'.repeat(129) },
      'Das Passwort darf höchstens 128 Zeichen haben.',
    ],
    ['the repetition differs', { repeat: 'something else entirely' }, 'Die beiden neuen Passwörter sind nicht gleich.'],
  ])('does not send anything when %s', async (_name, input, message) => {
    const fetchMock = stubAccount();
    const user = userEvent.setup();
    await openAccount();
    await fillPasswords(user, input);

    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/auth/password')).toHaveLength(0);
  });

  it('names both possible reasons when the server says 400, and keeps the typed values', async () => {
    stubAccount({ 'POST /api/auth/password': () => problem(400, 'Bad Request') });
    const user = userEvent.setup();
    await openAccount();
    await fillPasswords(user);

    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByText(/Das aktuelle Passwort stimmt nicht/)).toBeInTheDocument();
    expect(screen.getByLabelText('Neues Passwort')).toHaveValue(NEXT);
  });

  it('stays signed in after a failed change (a 400 is no lost session)', async () => {
    stubAccount({ 'POST /api/auth/password': () => problem(400, 'Bad Request') });
    const user = userEvent.setup();
    await openAccount();
    await fillPasswords(user);

    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));
    await screen.findByText(/Das aktuelle Passwort stimmt nicht/);

    expect(screen.getByRole('heading', { name: 'Konto' })).toBeInTheDocument();
  });

  it('sends one request on a double click and locks the button meanwhile', async () => {
    const fetchMock = stubAccount({ 'POST /api/auth/password': () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await openAccount();
    await fillPasswords(user);

    await user.dblClick(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByRole('button', { name: 'Wird geändert …' })).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', '/api/auth/password')).toHaveLength(1);
  });
});

describe('AccountPage: api keys', () => {
  it('shows a loading state while the keys are fetched', async () => {
    stubAccount({ 'GET /api/auth/api-keys': () => new Promise<Response>(() => undefined) });

    await openAccount();

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('shows the empty state with the create button', async () => {
    stubAccount();

    await openAccount();

    expect(await screen.findByText('Du hast noch keine API-Schlüssel.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neuen Schlüssel erstellen' })).toBeEnabled();
  });

  it('lists the keys with their dates and "never" for what did not happen', async () => {
    stubAccount({
      'GET /api/auth/api-keys': () =>
        json(200, [
          apiKey(),
          apiKey({ id: 'key-2', name: 'Cron', prefix: 'sk-ffeeddcc', expiresAt: '2027-01-01T00:00:00.000Z', lastUsedAt: '2026-10-05T10:00:00.000Z' }),
        ]),
    });

    await openAccount();

    const skript = await screen.findByRole('row', { name: /Skript/ });
    expect(within(skript).getByText('sk-1a2b3c4d')).toBeInTheDocument();
    expect(within(skript).getByText('Nie benutzt')).toBeInTheDocument();
    expect(within(skript).getByText('Läuft nie ab')).toBeInTheDocument();
    const cron = screen.getByRole('row', { name: /Cron/ });
    expect(within(cron).queryByText('Nie benutzt')).not.toBeInTheDocument();
    expect(within(cron).queryByText('Läuft nie ab')).not.toBeInTheDocument();
  });

  it('shows an error with a retry button and recovers', async () => {
    let healthy = false;
    stubAccount({
      'GET /api/auth/api-keys': () => (healthy ? json(200, [apiKey()]) : problem(500, 'Internal Server Error')),
    });
    const user = userEvent.setup();
    await openAccount();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('row', { name: /Skript/ })).toBeInTheDocument();
  });

  it('explains that keys are switched off and sends no request for them', async () => {
    const fetchMock = stubAccount({}, authConfig({ apiKeysEnabled: false }));

    await openAccount();

    expect(await screen.findByText('API-Schlüssel sind auf diesem Server ausgeschaltet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Neuen Schlüssel erstellen' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', '/api/auth/api-keys')).toHaveLength(0);
  });

  it('creates a key, shows it once with a warning, and the page forgets it on close', async () => {
    const SECRET = `sk-${'ab'.repeat(32)}`;
    let created = false;
    let sent: unknown;
    stubAccount({
      'GET /api/auth/api-keys': () => json(200, created ? [apiKey({ name: 'Neu' })] : []),
      'POST /api/auth/api-keys': ({ body }) => {
        created = true;
        sent = body;
        return json(201, { ...apiKey({ name: 'Neu' }), key: SECRET });
      },
    });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Neuen Schlüssel erstellen' }));
    const form = await screen.findByRole('dialog', { name: 'Neuen Schlüssel erstellen' });
    await user.type(within(form).getByLabelText('Name'), '  Neu  ');
    await user.selectOptions(within(form).getByLabelText('Laufzeit'), '30');

    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));

    const shown = await screen.findByRole('dialog', { name: 'Dein neuer Schlüssel' });
    expect(within(shown).getByText(SECRET)).toBeInTheDocument();
    expect(within(shown).getByText(/nur jetzt/)).toBeInTheDocument();
    expect(sent).toEqual({ name: '  Neu  ', expiresInDays: 30 });

    await user.click(within(shown).getByRole('button', { name: 'Schließen' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(SECRET);
    expect(await screen.findByRole('row', { name: /Neu/ })).toBeInTheDocument();
  });

  it('sends no expiry when the key should not expire, and refuses an empty name', async () => {
    let sent: unknown;
    const fetchMock = stubAccount({
      'POST /api/auth/api-keys': ({ body }) => {
        sent = body;
        return json(201, { ...apiKey({ name: 'Dauer' }), key: `sk-${'cd'.repeat(32)}` });
      },
    });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Neuen Schlüssel erstellen' }));
    const form = await screen.findByRole('dialog', { name: 'Neuen Schlüssel erstellen' });

    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));
    expect(await within(form).findByText('Bitte gib einen Namen ein.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/auth/api-keys')).toHaveLength(0);

    await user.type(within(form).getByLabelText('Name'), 'Dauer');
    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));

    await screen.findByRole('dialog', { name: 'Dein neuer Schlüssel' });
    expect(sent).toEqual({ name: 'Dauer' });
  });

  it('sends one request on a double click while creating', async () => {
    const fetchMock = stubAccount({ 'POST /api/auth/api-keys': () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Neuen Schlüssel erstellen' }));
    const form = await screen.findByRole('dialog', { name: 'Neuen Schlüssel erstellen' });
    await user.type(within(form).getByLabelText('Name'), 'Doppelt');

    await user.dblClick(within(form).getByRole('button', { name: 'Erstellen' }));

    expect(await within(form).findByRole('button', { name: 'Wird erstellt …' })).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', '/api/auth/api-keys')).toHaveLength(1);
  });

  it('says so in the dialog when creating fails, and keeps the dialog open', async () => {
    stubAccount({ 'POST /api/auth/api-keys': () => problem(500, 'Internal Server Error') });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Neuen Schlüssel erstellen' }));
    const form = await screen.findByRole('dialog', { name: 'Neuen Schlüssel erstellen' });
    await user.type(within(form).getByLabelText('Name'), 'Kaputt');

    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));

    expect(await within(form).findByText('Das hat nicht geklappt. Bitte versuche es erneut.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Erstellen' })).toBeEnabled();
  });

  it('copies the key and tells when copying is not possible', async () => {
    const SECRET = `sk-${'ef'.repeat(32)}`;
    stubAccount({ 'POST /api/auth/api-keys': () => json(201, { ...apiKey({ name: 'Kopie' }), key: SECRET }) });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Neuen Schlüssel erstellen' }));
    const form = await screen.findByRole('dialog', { name: 'Neuen Schlüssel erstellen' });
    await user.type(within(form).getByLabelText('Name'), 'Kopie');
    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));
    const shown = await screen.findByRole('dialog', { name: 'Dein neuer Schlüssel' });

    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await user.click(within(shown).getByRole('button', { name: 'Kopieren' }));
    expect(await within(shown).findByText('Kopiert.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(SECRET);

    await user.click(within(shown).getByRole('button', { name: 'Kopieren' }));
    expect(await within(shown).findByText(/Kopieren ist nicht möglich/)).toBeInTheDocument();
  });

  it('revokes a key after a confirmation, once, and refreshes the list', async () => {
    let revoked = false;
    const fetchMock = stubAccount({
      'GET /api/auth/api-keys': () => json(200, revoked ? [] : [apiKey()]),
      'DELETE /api/auth/api-keys/key-1': () => {
        revoked = true;
        return noContent();
      },
    });
    const user = userEvent.setup();
    await openAccount();

    await user.click(await screen.findByRole('button', { name: 'Skript widerrufen' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(callsTo(fetchMock, 'DELETE', '/api/auth/api-keys/key-1')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Widerrufen' }));

    expect(await screen.findByText('Du hast noch keine API-Schlüssel.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'DELETE', '/api/auth/api-keys/key-1')).toHaveLength(1);
  });

  it('keeps the key and says so when revoking fails; cancelling sends nothing', async () => {
    const fetchMock = stubAccount({
      'GET /api/auth/api-keys': () => json(200, [apiKey()]),
      'DELETE /api/auth/api-keys/key-1': () => problem(500, 'Internal Server Error'),
    });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Skript widerrufen' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }));
    expect(callsTo(fetchMock, 'DELETE', '/api/auth/api-keys/key-1')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Skript widerrufen' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Widerrufen' }));

    expect(await screen.findByText('Das hat nicht geklappt. Bitte versuche es erneut.')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Skript/ })).toBeInTheDocument();
  });

  it('renders a key name that looks like HTML as plain text', async () => {
    stubAccount({
      'GET /api/auth/api-keys': () => json(200, [apiKey({ name: '<img src=x onerror=alert(1)>' })]),
    });

    await openAccount();

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
```

Run: `pnpm --filter @owui/web exec vitest run src/lib src/pages/account-page.spec.tsx`
Expected: FAIL (Module fehlen).

- [x] **Step 2: Hilfsfunktion, Formular, Abschnitt und Seite schreiben**

`apps/web/src/lib/format-date.ts`:

```ts
/** A calendar day in the interface language; the time of day does not matter in a key list. */
export function formatDate(iso: string, language: string): string {
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(iso));
}
```

`apps/web/src/features/account/password-form.tsx`:

```tsx
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { useAuthChangePassword } from '@/api/generated/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/features/auth/password-policy';

export function PasswordForm() {
  const { t } = useTranslation();
  const currentId = useId();
  const nextId = useId();
  const repeatId = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [formError, setFormError] = useState<string>();
  const change = useAuthChangePassword({
    mutation: {
      onSuccess: () => {
        setCurrent('');
        setNext('');
        setRepeat('');
      },
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (change.isPending) return;
    change.reset();
    if (current === '' || next === '' || repeat === '') {
      setFormError('auth.error.required');
      return;
    }
    if (next.length < PASSWORD_MIN_LENGTH) {
      setFormError('auth.error.passwordShort');
      return;
    }
    if (next.length > PASSWORD_MAX_LENGTH) {
      setFormError('auth.error.passwordLong');
      return;
    }
    if (next !== repeat) {
      setFormError('account.password.error.mismatch');
      return;
    }
    setFormError(undefined);
    change.mutate({ data: { currentPassword: current, newPassword: next } });
  }

  // A wrong current password is a 400 on purpose (a 401 would end the session in the fetcher), so 400 covers both.
  const errorKey =
    formError ??
    (change.isError ? errorMessageKey(change.error, { 400: 'account.password.error.rejected' }) : undefined);

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={currentId}>{t('account.password.current')}</FieldLabel>
          <Input
            id={currentId}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => {
              setCurrent(event.target.value);
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={nextId}>{t('account.password.next')}</FieldLabel>
          <Input
            id={nextId}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => {
              setNext(event.target.value);
            }}
          />
          <FieldDescription>{t('auth.signup.passwordHint')}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={repeatId}>{t('account.password.repeat')}</FieldLabel>
          <Input
            id={repeatId}
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => {
              setRepeat(event.target.value);
            }}
          />
        </Field>
      </FieldGroup>
      {errorKey !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorKey)}</AlertDescription>
        </Alert>
      )}
      {change.isSuccess && formError === undefined && (
        <Alert>
          <AlertDescription>{t('account.password.done')}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={change.isPending}>
        {change.isPending ? t('account.password.submitting') : t('account.password.submit')}
      </Button>
    </form>
  );
}
```

`apps/web/src/features/account/api-keys-section.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import {
  getApiKeysListQueryKey,
  useApiKeysCreate,
  useApiKeysList,
  useApiKeysRevoke,
  useAuthConfig,
} from '@/api/generated/api';
import type { ApiKeyDto, CreatedApiKeyDto } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format-date';

/** The choices of the "Laufzeit" select; the value is what the select holds, `days` what the server gets. */
const EXPIRY = {
  NEVER: { value: 'never', days: undefined },
  DAYS_30: { value: '30', days: 30 },
  DAYS_90: { value: '90', days: 90 },
  DAYS_365: { value: '365', days: 365 },
} as const;
type ExpiryChoice = (typeof EXPIRY)[keyof typeof EXPIRY];

function expiryFor(value: string): ExpiryChoice {
  return Object.values(EXPIRY).find((choice) => choice.value === value) ?? EXPIRY.NEVER;
}

const COPY_STATE = { IDLE: 'idle', DONE: 'done', FAILED: 'failed' } as const;
type CopyState = (typeof COPY_STATE)[keyof typeof COPY_STATE];

/** Mounted only while open, so every opening starts with empty fields. */
function CreateKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (key: CreatedApiKeyDto) => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const expiryId = useId();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<string>(EXPIRY.NEVER.value);
  const [formError, setFormError] = useState<string>();
  const create = useApiKeysCreate({
    mutation: {
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: getApiKeysListQueryKey() });
        onCreated(result.data);
      },
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
    if (name.trim() === '') {
      setFormError('account.keys.error.nameRequired');
      return;
    }
    setFormError(undefined);
    const { days } = expiryFor(expiry);
    create.mutate({ data: days === undefined ? { name } : { name, expiresInDays: days } });
  }

  const errorKey = formError ?? (create.isError ? errorMessageKey(create.error) : undefined);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('account.keys.create')}</DialogTitle>
            <DialogDescription>{t('account.keys.createHint')}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={nameId}>{t('account.keys.name')}</FieldLabel>
              <Input
                id={nameId}
                value={name}
                maxLength={100}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={expiryId}>{t('account.keys.expiry')}</FieldLabel>
              <NativeSelect
                id={expiryId}
                value={expiry}
                onChange={(event) => {
                  setExpiry(event.target.value);
                }}
              >
                <NativeSelectOption value={EXPIRY.NEVER.value}>{t('account.keys.expiryNever')}</NativeSelectOption>
                <NativeSelectOption value={EXPIRY.DAYS_30.value}>{t('account.keys.expiryDays', { count: 30 })}</NativeSelectOption>
                <NativeSelectOption value={EXPIRY.DAYS_90.value}>{t('account.keys.expiryDays', { count: 90 })}</NativeSelectOption>
                <NativeSelectOption value={EXPIRY.DAYS_365.value}>{t('account.keys.expiryDays', { count: 365 })}</NativeSelectOption>
              </NativeSelect>
            </Field>
          </FieldGroup>
          {errorKey !== undefined && (
            <Alert variant="destructive">
              <AlertDescription>{t(errorKey)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t('account.keys.creating') : t('account.keys.createSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while a key is to be shown: closing drops the plaintext from memory and the page. */
function NewKeyDialog({ created, onClose }: { created: CreatedApiKeyDto; onClose: () => void }) {
  const { t } = useTranslation();
  const [copy, setCopy] = useState<CopyState>(COPY_STATE.IDLE);

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(created.key);
      setCopy(COPY_STATE.DONE);
    } catch {
      // No secure context or permission denied: the key stays selectable in the dialog.
      setCopy(COPY_STATE.FAILED);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('account.keys.shownTitle')}</DialogTitle>
          <DialogDescription>{t('account.keys.shownWarning')}</DialogDescription>
        </DialogHeader>
        <code className="bg-muted block rounded-md p-3 font-mono text-sm break-all select-all">{created.key}</code>
        <div className="flex items-center gap-3" aria-live="polite">
          <Button
            variant="outline"
            onClick={() => {
              void copyKey();
            }}
          >
            {t('account.keys.copy')}
          </Button>
          {copy === COPY_STATE.DONE && <span className="text-sm">{t('account.keys.copied')}</span>}
          {copy === COPY_STATE.FAILED && <span className="text-destructive text-sm">{t('account.keys.copyFailed')}</span>}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KeyRow({
  apiKey,
  language,
  busy,
  onRevoke,
}: {
  apiKey: ApiKeyDto;
  language: string;
  busy: boolean;
  onRevoke: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableRow>
      <TableCell className="font-medium">{apiKey.name}</TableCell>
      <TableCell className="font-mono text-xs">{apiKey.prefix}</TableCell>
      <TableCell>{formatDate(apiKey.createdAt, language)}</TableCell>
      <TableCell>
        {apiKey.lastUsedAt === null ? t('account.keys.neverUsed') : formatDate(apiKey.lastUsedAt, language)}
      </TableCell>
      <TableCell>
        {apiKey.expiresAt === null ? t('account.keys.neverExpires') : formatDate(apiKey.expiresAt, language)}
      </TableCell>
      <TableCell className="text-right">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy} aria-label={t('account.keys.revokeNamed', { name: apiKey.name })}>
              {t('account.keys.revoke')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('account.keys.revokeTitle', { name: apiKey.name })}</AlertDialogTitle>
              <AlertDialogDescription>{t('account.keys.revokeBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  onRevoke(apiKey.id);
                }}
              >
                {t('account.keys.revoke')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

export function ApiKeysSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const config = useAuthConfig();
  const enabled = config.data?.data.apiKeysEnabled === true;
  const keys = useApiKeysList({ query: { enabled } });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKeyDto>();
  const revoke = useApiKeysRevoke({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getApiKeysListQueryKey() }),
    },
  });

  if (config.isPending) return <PageLoading />;
  if (config.isError) {
    return (
      <LoadError
        error={config.error}
        busy={config.isFetching}
        onRetry={() => {
          void config.refetch();
        }}
      />
    );
  }
  if (!enabled) {
    return <p className="text-muted-foreground text-sm">{t('account.keys.off')}</p>;
  }

  let list: ReactNode;
  if (keys.isPending) {
    list = <PageLoading />;
  } else if (keys.isError) {
    list = (
      <LoadError
        error={keys.error}
        busy={keys.isFetching}
        onRetry={() => {
          void keys.refetch();
        }}
      />
    );
  } else if (keys.data.data.length === 0) {
    list = <p className="text-muted-foreground text-sm">{t('account.keys.empty')}</p>;
  } else {
    list = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('account.keys.name')}</TableHead>
            <TableHead>{t('account.keys.prefix')}</TableHead>
            <TableHead>{t('account.keys.createdAt')}</TableHead>
            <TableHead>{t('account.keys.lastUsed')}</TableHead>
            <TableHead>{t('account.keys.expiresAt')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('account.keys.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.data.data.map((apiKey) => (
            <KeyRow
              key={apiKey.id}
              apiKey={apiKey}
              language={i18n.language}
              busy={revoke.isPending}
              onRevoke={(id) => {
                revoke.mutate({ id });
              }}
            />
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-4">
      {list}
      {revoke.isError && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorMessageKey(revoke.error))}</AlertDescription>
        </Alert>
      )}
      <Button
        onClick={() => {
          setCreating(true);
        }}
      >
        {t('account.keys.create')}
      </Button>
      {creating && (
        <CreateKeyDialog
          onClose={() => {
            setCreating(false);
          }}
          onCreated={(key) => {
            setCreating(false);
            setCreated(key);
          }}
        />
      )}
      {created !== undefined && (
        <NewKeyDialog
          created={created}
          onClose={() => {
            setCreated(undefined);
          }}
        />
      )}
    </div>
  );
}
```

`apps/web/src/pages/account-page.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { ApiKeysSection } from '@/features/account/api-keys-section';
import { PasswordForm } from '@/features/account/password-form';
import { useCurrentUser } from '@/features/auth/session';

export function AccountPage() {
  const { t } = useTranslation();
  const user = useCurrentUser();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">{t('account.title')}</h1>
      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('account.profile.title')}</h2>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('account.profile.name')}</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">{t('account.profile.email')}</dt>
            <dd>{user.email}</dd>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('account.password.title')}</h2>
          <CardDescription>{t('account.password.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <h2 className="font-semibold">{t('account.keys.title')}</h2>
          <CardDescription>{t('account.keys.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ApiKeysSection />
        </CardContent>
      </Card>
    </div>
  );
}
```

Route in `apps/web/src/app/router.tsx`: Import `AccountPage` (`@/pages/account-page`) und unter `children` des Layouts vor `{ path: '*', ... }` eintragen:

```tsx
          { path: 'settings/account', element: <AccountPage /> },
```

Navigation in `apps/web/src/components/layout/app-layout.tsx`: unter dem Start-Eintrag ein zweiter `SidebarMenuItem`:

```tsx
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/settings/account">{t('nav.account')}</NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
```

Texte. `de.json` (`nav` um `"account": "Konto"` ergänzen) und neuer Block:

```json
  "account": {
    "title": "Konto",
    "profile": { "title": "Profil", "name": "Name", "email": "E-Mail-Adresse" },
    "password": {
      "title": "Passwort ändern",
      "description": "Nach der Änderung bist du auf allen anderen Geräten abgemeldet.",
      "current": "Aktuelles Passwort",
      "next": "Neues Passwort",
      "repeat": "Neues Passwort wiederholen",
      "submit": "Passwort ändern",
      "submitting": "Wird geändert …",
      "done": "Dein Passwort ist geändert. Auf allen anderen Geräten bist du jetzt abgemeldet.",
      "error": {
        "mismatch": "Die beiden neuen Passwörter sind nicht gleich.",
        "rejected": "Das aktuelle Passwort stimmt nicht, oder das neue Passwort wird nicht akzeptiert."
      }
    },
    "keys": {
      "title": "API-Schlüssel",
      "description": "Mit einem Schlüssel greifen Skripte und andere Programme in deinem Namen auf den Server zu.",
      "off": "API-Schlüssel sind auf diesem Server ausgeschaltet.",
      "empty": "Du hast noch keine API-Schlüssel.",
      "name": "Name",
      "prefix": "Anfang",
      "createdAt": "Erstellt",
      "lastUsed": "Zuletzt benutzt",
      "expiresAt": "Läuft ab",
      "actions": "Aktionen",
      "neverUsed": "Nie benutzt",
      "neverExpires": "Läuft nie ab",
      "create": "Neuen Schlüssel erstellen",
      "createHint": "Gib dem Schlüssel einen Namen, an dem du ihn später erkennst.",
      "createSubmit": "Erstellen",
      "creating": "Wird erstellt …",
      "expiry": "Laufzeit",
      "expiryNever": "Unbegrenzt",
      "expiryDays": "{{count}} Tage",
      "shownTitle": "Dein neuer Schlüssel",
      "shownWarning": "Speichere den Schlüssel jetzt: Er wird nur jetzt angezeigt und lässt sich später nicht mehr abrufen.",
      "copy": "Kopieren",
      "copied": "Kopiert.",
      "copyFailed": "Kopieren ist nicht möglich. Markiere den Schlüssel und kopiere ihn von Hand.",
      "revoke": "Widerrufen",
      "revokeNamed": "{{name}} widerrufen",
      "revokeTitle": "Schlüssel „{{name}}“ widerrufen?",
      "revokeBody": "Programme, die diesen Schlüssel benutzen, verlieren sofort den Zugriff. Das lässt sich nicht rückgängig machen.",
      "error": { "nameRequired": "Bitte gib einen Namen ein." }
    }
  },
```

`en.json` (`nav.account`: `"Account"`):

```json
  "account": {
    "title": "Account",
    "profile": { "title": "Profile", "name": "Name", "email": "Email address" },
    "password": {
      "title": "Change password",
      "description": "After the change you are signed out on all other devices.",
      "current": "Current password",
      "next": "New password",
      "repeat": "Repeat new password",
      "submit": "Change password",
      "submitting": "Changing …",
      "done": "Your password is changed. You are now signed out on all other devices.",
      "error": {
        "mismatch": "The two new passwords are not the same.",
        "rejected": "The current password is wrong, or the new password is not accepted."
      }
    },
    "keys": {
      "title": "API keys",
      "description": "A key lets scripts and other programs reach the server on your behalf.",
      "off": "API keys are switched off on this server.",
      "empty": "You have no API keys yet.",
      "name": "Name",
      "prefix": "Start",
      "createdAt": "Created",
      "lastUsed": "Last used",
      "expiresAt": "Expires",
      "actions": "Actions",
      "neverUsed": "Never used",
      "neverExpires": "Never expires",
      "create": "Create new key",
      "createHint": "Give the key a name you will recognise later.",
      "createSubmit": "Create",
      "creating": "Creating …",
      "expiry": "Lifetime",
      "expiryNever": "Unlimited",
      "expiryDays": "{{count}} days",
      "shownTitle": "Your new key",
      "shownWarning": "Save the key now: it is shown only now and cannot be retrieved later.",
      "copy": "Copy",
      "copied": "Copied.",
      "copyFailed": "Copying is not possible. Select the key and copy it by hand.",
      "revoke": "Revoke",
      "revokeNamed": "Revoke {{name}}",
      "revokeTitle": "Revoke key “{{name}}”?",
      "revokeBody": "Programs that use this key lose access at once. This cannot be undone.",
      "error": { "nameRequired": "Please enter a name." }
    }
  },
```

- [x] **Step 3: Tests laufen lassen, grün sehen**

Run: `pnpm --filter @owui/web exec vitest run`
Expected: PASS. Stolpersteine:
(a) **Namen der shadcn-Bausteine**: `NativeSelect`/`NativeSelectOption` und die Dialog-Bausteine sind aus der shadcn-Doku übernommen, nicht gegen die erzeugten Dateien geprüft. Zuerst `grep -hn "^export\|^function" apps/web/src/components/ui/{native-select,dialog,alert-dialog,table,badge,field}.tsx` ausführen und bei Abweichungen die Importe und Elementnamen in den Tasks 4 und 5 anpassen.
(b) Der Test „erstellt einen Schlüssel“ erwartet `name: '  Neu  '` unverändert: der Server trimmt (`trimTransform`), das Formular schickt den Rohwert.
(c) Der Dialogtitel „Neuen Schlüssel erstellen“ ist zugleich die Beschriftung der Schaltfläche; die Tests wählen die Schaltfläche per `findByRole('button', …)` und den Dialog per `findByRole('dialog', …)`, das trennt sie.
(d) Im Kopieren-Test überschreibt `Object.defineProperty(navigator, 'clipboard', …)` die Zwischenablage, die `userEvent.setup()` installiert hat; das geht, weil beide Definitionen `configurable` sind. Der Test stellt sie nicht zurück, jede Testdatei läuft in einer eigenen Umgebung.
(e) Radix setzt beim offenen Dialog `aria-hidden` auf den Rest der Seite; `within(dialog)` ist deshalb Pflicht für Abfragen im Dialog.
(f) `/api/health/ready` ist in `stubAccount` nicht gestubbt; die Statuskarte der Startseite zeigt dann ihren Fehlerzustand (404), was die Navigationsprüfung nicht stört.

- [x] **Step 4: `pnpm check` und Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web
git commit -m "feat(web): add account page with password change and api key management" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Nutzerverwaltung für Admins (`/admin/users`)

**Files:**
- Create: `apps/web/src/features/admin/users-table.tsx`, `apps/web/src/features/admin/create-user-dialog.tsx`, `apps/web/src/features/admin/set-password-dialog.tsx`, `apps/web/src/features/admin/delete-user-dialog.tsx`, `apps/web/src/pages/admin-users-page.tsx`, `apps/web/src/pages/admin-users-page.spec.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/components/layout/app-layout.tsx`, `apps/web/src/i18n/locales/de.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `useUsersList`, `useUsersCreate`, `useUsersUpdate`, `useUsersSetPassword`, `useUsersRemove`, `getUsersListQueryKey` (Formen `mutate({ data })`, `mutate({ id, data })`, `mutate({ id })`), `UserDto`, `UserDtoRole`, `UpdateUserDto`, `useCurrentUser`, `SessionGate`/`GATE.ADMIN` (Task 3), `formatDate` (Task 4), `errorMessageKey`, `PageLoading`, `LoadError`, `PASSWORD_MIN_LENGTH`/`PASSWORD_MAX_LENGTH`.
- Produces: `UsersTable()`, `CreateUserDialog({ onClose })`, `SetPasswordDialog({ user, onClose })`, `DeleteUserDialog({ user, busy, onConfirm })`, `AdminUsersPage()`; Route `/admin/users` hinter `SessionGate allow={GATE.ADMIN}`; Navigationslink „Nutzer“ nur für Admins.

**Verhalten:**
- Spalten: Name, E-Mail-Adresse, Rolle (Auswahl je Zeile), Status (Aktiv, Wartet auf Freischaltung, Gesperrt), Erstellt, Aktionen. Aktionen je Zeile: „Freischalten“ (nur bei wartenden Konten, setzt die Rolle `user`), „Sperren“ oder „Entsperren“, „Passwort setzen“ (Dialog), „Löschen“ (Rückfrage).
- Die eigene Zeile hat **keine** Aktionen und keine Rollenauswahl, nur den Hinweis „Das bist du.“: Wer sich selbst sperrt, herabstuft oder löscht, sperrt sich aus; ein Passwort für das eigene Konto setzt man auf der Kontoseite. Die Regel „mindestens ein aktiver Admin“ setzt der Server durch (409), die Oberfläche zeigt dessen Antwort als verständlichen Satz.
- Ansichten: Laden, Fehler mit „Erneut versuchen“, Liste. Eine **leere** Liste kann es nicht geben, weil der angemeldete Admin selbst darin steht; deshalb gibt es keinen Leerzustand und keinen Test dafür.
- Solange eine Änderung läuft, sind alle Zeilenaktionen gesperrt (kein Doppel-Submit); die Liste wird danach neu geladen. Die Namen kommen aus Nutzereingaben und werden nur als Text gerendert.

- [x] **Step 1: Fehlschlagende Tests schreiben**

`apps/web/src/pages/admin-users-page.spec.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserDtoRole } from '@/api/generated/model';
import { sessionInfo, userDto } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { type Handler, json, noContent, problem, stubApi } from '@/test/stub-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ADMIN = userDto({ id: 'u-admin', name: 'Rita Root', email: 'rita@example.com', role: UserDtoRole.admin });
const BEN = userDto({ id: 'u-ben', name: 'Ben Beispiel', email: 'ben@example.com' });
const PIA = userDto({
  id: 'u-pia',
  name: 'Pia Wartend',
  email: 'pia@example.com',
  role: UserDtoRole.pending,
});
const LAST_ADMIN_MESSAGE = 'Es muss mindestens ein aktiver Administrator bleiben.';
const GENERIC_MESSAGE = 'Das hat nicht geklappt. Bitte versuche es erneut.';

function stubAdmin(handlers: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/auth/me': () => json(200, sessionInfo(ADMIN)),
    'GET /api/users': () => json(200, [ADMIN, BEN, PIA]),
    ...handlers,
  });
}

function callsTo(fetchMock: ReturnType<typeof stubApi>, method: string, path: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => String(input) === path && (init?.method ?? 'GET') === method
  );
}

async function openUsers() {
  renderApp('/admin/users');
  await screen.findByRole('heading', { name: 'Nutzerverwaltung' });
}

function rowOf(name: string) {
  return screen.findByRole('row', { name: new RegExp(name) });
}

describe('AdminUsersPage: access', () => {
  it('sends an ordinary user to the start page without asking for the list', async () => {
    const fetchMock = stubApi({
      'GET /api/auth/me': () => json(200, sessionInfo(BEN)),
      'GET /api/users': () => json(200, []),
    });

    renderApp('/admin/users');

    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nutzer' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', '/api/users')).toHaveLength(0);
  });

  it('shows the navigation link to admins, and it leads to the page', async () => {
    stubAdmin();
    const user = userEvent.setup();
    renderApp('/');

    await user.click(await screen.findByRole('link', { name: 'Nutzer' }));

    expect(await screen.findByRole('heading', { name: 'Nutzerverwaltung' })).toBeInTheDocument();
  });
});

describe('AdminUsersPage: list', () => {
  it('shows a loading state while the list is fetched', async () => {
    stubAdmin({ 'GET /api/users': () => new Promise<Response>(() => undefined) });

    await openUsers();

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('shows an error with a retry button and recovers', async () => {
    let healthy = false;
    stubAdmin({
      'GET /api/users': () => (healthy ? json(200, [ADMIN, BEN]) : problem(500, 'Internal Server Error')),
    });
    const user = userEvent.setup();
    await openUsers();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));

    expect(await rowOf('Ben Beispiel')).toBeInTheDocument();
  });

  it('shows role and status of every account, and marks the own row without actions', async () => {
    stubAdmin({
      'GET /api/users': () => json(200, [ADMIN, BEN, PIA, userDto({ id: 'u-gus', name: 'Gus Gesperrt', disabled: true })]),
    });
    await openUsers();

    const ben = within(await rowOf('Ben Beispiel'));
    expect(ben.getByText('Aktiv')).toBeInTheDocument();
    expect(ben.getByLabelText('Rolle von Ben Beispiel')).toHaveValue('user');
    expect(within(await rowOf('Pia Wartend')).getByText('Wartet auf Freischaltung')).toBeInTheDocument();
    expect(within(await rowOf('Gus Gesperrt')).getByText('Gesperrt')).toBeInTheDocument();
    const own = within(await rowOf('Rita Root'));
    expect(own.getByText('Das bist du.')).toBeInTheDocument();
    expect(own.queryAllByRole('button')).toHaveLength(0);
    expect(own.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders a name that looks like HTML as plain text', async () => {
    stubAdmin({
      'GET /api/users': () =>
        json(200, [ADMIN, userDto({ id: 'u-x', name: '<img src=x onerror=alert(1)>', email: 'x@example.com' })]),
    });

    await openUsers();

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('AdminUsersPage: change an account', () => {
  it('approves a waiting account with one click and refreshes the list', async () => {
    let users = [ADMIN, BEN, PIA];
    let sent: unknown;
    stubAdmin({
      'GET /api/users': () => json(200, users),
      'PATCH /api/users/u-pia': ({ body }) => {
        sent = body;
        const approved = { ...PIA, role: UserDtoRole.user };
        users = [ADMIN, BEN, approved];
        return json(200, approved);
      },
    });
    const user = userEvent.setup();
    await openUsers();

    await user.click(await screen.findByRole('button', { name: 'Pia Wartend freischalten' }));

    await waitFor(async () => {
      expect(within(await rowOf('Pia Wartend')).getByText('Aktiv')).toBeInTheDocument();
    });
    expect(sent).toEqual({ role: 'user' });
    expect(screen.queryByRole('button', { name: 'Pia Wartend freischalten' })).not.toBeInTheDocument();
  });

  it('sends one request on a double click and locks all row actions meanwhile', async () => {
    const fetchMock = stubAdmin({ 'PATCH /api/users/u-pia': () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await openUsers();

    await user.dblClick(await screen.findByRole('button', { name: 'Pia Wartend freischalten' }));

    expect(callsTo(fetchMock, 'PATCH', '/api/users/u-pia')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ben Beispiel sperren' })).toBeDisabled();
    expect(screen.getByLabelText('Rolle von Ben Beispiel')).toBeDisabled();
  });

  it('changes the role from the selection', async () => {
    let sent: unknown;
    stubAdmin({
      'PATCH /api/users/u-ben': ({ body }) => {
        sent = body;
        return json(200, { ...BEN, role: UserDtoRole.admin });
      },
    });
    const user = userEvent.setup();
    await openUsers();

    await user.selectOptions(await screen.findByLabelText('Rolle von Ben Beispiel'), 'admin');

    await waitFor(() => {
      expect(sent).toEqual({ role: 'admin' });
    });
  });

  it('disables and enables an account', async () => {
    const bodies: unknown[] = [];
    let ben = BEN;
    stubAdmin({
      'GET /api/users': () => json(200, [ADMIN, ben]),
      'PATCH /api/users/u-ben': ({ body }) => {
        bodies.push(body);
        ben = { ...ben, disabled: !ben.disabled };
        return json(200, ben);
      },
    });
    const user = userEvent.setup();
    await openUsers();

    await user.click(await screen.findByRole('button', { name: 'Ben Beispiel sperren' }));
    await user.click(await screen.findByRole('button', { name: 'Ben Beispiel entsperren' }));

    await screen.findByRole('button', { name: 'Ben Beispiel sperren' });
    expect(bodies).toEqual([{ disabled: true }, { disabled: false }]);
  });

  it('turns the 409 of the server into a clear sentence and keeps the list', async () => {
    stubAdmin({ 'PATCH /api/users/u-ben': () => problem(409, 'Conflict') });
    const user = userEvent.setup();
    await openUsers();

    await user.click(await screen.findByRole('button', { name: 'Ben Beispiel sperren' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(LAST_ADMIN_MESSAGE);
    expect(await rowOf('Ben Beispiel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ben Beispiel sperren' })).toBeEnabled();
  });
});

describe('AdminUsersPage: create an account', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Nutzer anlegen' }));
    return within(await screen.findByRole('dialog', { name: 'Nutzer anlegen' }));
  }

  async function fillCreate(
    dialog: ReturnType<typeof within>,
    user: ReturnType<typeof userEvent.setup>,
    input: { name?: string; email?: string; password?: string } = {}
  ) {
    const { name = 'Neo Neu', email = 'neo@example.com', password = 'a long start passphrase' } = input;
    await user.type(dialog.getByLabelText('Name'), name);
    await user.type(dialog.getByLabelText('E-Mail-Adresse'), email);
    await user.type(dialog.getByLabelText('Passwort'), password);
  }

  it('creates an account with the chosen role, closes the dialog and shows the new row', async () => {
    let users = [ADMIN, BEN];
    let sent: unknown;
    stubAdmin({
      'GET /api/users': () => json(200, users),
      'POST /api/users': ({ body }) => {
        sent = body;
        const created = userDto({ id: 'u-neo', name: 'Neo Neu', email: 'neo@example.com', role: UserDtoRole.admin });
        users = [ADMIN, BEN, created];
        return json(201, created);
      },
    });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user);
    await user.selectOptions(dialog.getByLabelText('Rolle'), 'admin');

    await user.click(dialog.getByRole('button', { name: 'Anlegen' }));

    expect(await rowOf('Neo Neu')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sent).toEqual({
      name: 'Neo Neu',
      email: 'neo@example.com',
      password: 'a long start passphrase',
      role: 'admin',
    });
  });

  it.each([
    ['a field is empty', { name: '' }, 'Bitte fülle alle Felder aus.'],
    ['the password is too short', { password: 'short' }, 'Das Passwort braucht mindestens 12 Zeichen.'],
    ['the password is too long', { password: 'x'.repeat(129) }, 'Das Passwort darf höchstens 128 Zeichen haben.'],
  ])('sends nothing when %s', async (_name, input, message) => {
    const fetchMock = stubAdmin();
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user, input);

    await user.click(dialog.getByRole('button', { name: 'Anlegen' }));

    expect(await dialog.findByText(message)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/users')).toHaveLength(0);
  });

  it('says so in the dialog when the email is taken, and keeps the dialog open', async () => {
    stubAdmin({ 'POST /api/users': () => problem(409, 'Conflict') });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user);

    await user.click(dialog.getByRole('button', { name: 'Anlegen' }));

    expect(await dialog.findByText('Diese E-Mail-Adresse ist schon registriert.')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Anlegen' })).toBeEnabled();
  });

  it('sends one request on a double click', async () => {
    const fetchMock = stubAdmin({ 'POST /api/users': () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user);

    await user.dblClick(dialog.getByRole('button', { name: 'Anlegen' }));

    expect(await dialog.findByRole('button', { name: 'Wird angelegt …' })).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', '/api/users')).toHaveLength(1);
  });

  it('starts empty every time it is opened', async () => {
    stubAdmin();
    const user = userEvent.setup();
    await openUsers();
    let dialog = await openCreate(user);
    await user.type(dialog.getByLabelText('Name'), 'Halb fertig');
    await user.click(dialog.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    dialog = await openCreate(user);

    expect(dialog.getByLabelText('Name')).toHaveValue('');
  });
});

describe('AdminUsersPage: set a password', () => {
  async function openPassword(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Passwort für Ben Beispiel setzen' }));
    return within(await screen.findByRole('dialog', { name: 'Passwort für Ben Beispiel setzen' }));
  }

  it('sets the password and closes the dialog', async () => {
    let sent: unknown;
    stubAdmin({
      'POST /api/users/u-ben/password': ({ body }) => {
        sent = body;
        return noContent();
      },
    });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openPassword(user);
    await user.type(dialog.getByLabelText('Neues Passwort'), 'a fresh long passphrase');

    await user.click(dialog.getByRole('button', { name: 'Passwort setzen' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(sent).toEqual({ password: 'a fresh long passphrase' });
  });

  it.each([
    ['empty', '', 'Bitte fülle alle Felder aus.'],
    ['too short', 'short', 'Das Passwort braucht mindestens 12 Zeichen.'],
    ['too long', 'x'.repeat(129), 'Das Passwort darf höchstens 128 Zeichen haben.'],
  ])('sends nothing when the password is %s', async (_name, password, message) => {
    const fetchMock = stubAdmin();
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openPassword(user);
    if (password !== '') await user.type(dialog.getByLabelText('Neues Passwort'), password);

    await user.click(dialog.getByRole('button', { name: 'Passwort setzen' }));

    expect(await dialog.findByText(message)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/users/u-ben/password')).toHaveLength(0);
  });

  it('says so and stays open when the server fails', async () => {
    stubAdmin({ 'POST /api/users/u-ben/password': () => problem(500, 'Internal Server Error') });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openPassword(user);
    await user.type(dialog.getByLabelText('Neues Passwort'), 'a fresh long passphrase');

    await user.click(dialog.getByRole('button', { name: 'Passwort setzen' }));

    expect(await dialog.findByText(GENERIC_MESSAGE)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Passwort setzen' })).toBeEnabled();
  });

  it('sends one request on a double click and locks the button meanwhile', async () => {
    const fetchMock = stubAdmin({ 'POST /api/users/u-ben/password': () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openPassword(user);
    await user.type(dialog.getByLabelText('Neues Passwort'), 'a fresh long passphrase');

    await user.dblClick(dialog.getByRole('button', { name: 'Passwort setzen' }));

    expect(await dialog.findByRole('button', { name: 'Wird gespeichert …' })).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', '/api/users/u-ben/password')).toHaveLength(1);
  });
});

describe('AdminUsersPage: delete an account', () => {
  it('asks first; cancelling sends nothing; confirming deletes once and refreshes', async () => {
    let users = [ADMIN, BEN];
    const fetchMock = stubAdmin({
      'GET /api/users': () => json(200, users),
      'DELETE /api/users/u-ben': () => {
        users = [ADMIN];
        return noContent();
      },
    });
    const user = userEvent.setup();
    await openUsers();

    await user.click(await screen.findByRole('button', { name: 'Ben Beispiel löschen' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' }));
    expect(callsTo(fetchMock, 'DELETE', '/api/users/u-ben')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Ben Beispiel löschen' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' }));

    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /Ben Beispiel/ })).not.toBeInTheDocument();
    });
    expect(callsTo(fetchMock, 'DELETE', '/api/users/u-ben')).toHaveLength(1);
  });

  it('keeps the account and explains why when the server refuses', async () => {
    stubAdmin({ 'DELETE /api/users/u-ben': () => problem(409, 'Conflict') });
    const user = userEvent.setup();
    await openUsers();
    await user.click(await screen.findByRole('button', { name: 'Ben Beispiel löschen' }));

    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(LAST_ADMIN_MESSAGE);
    expect(await rowOf('Ben Beispiel')).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @owui/web exec vitest run src/pages/admin-users-page.spec.tsx`
Expected: FAIL (Module und Route fehlen).

- [x] **Step 2: Dialoge, Tabelle und Seite schreiben**

`apps/web/src/features/admin/create-user-dialog.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { getUsersListQueryKey, useUsersCreate } from '@/api/generated/api';
import { UserDtoRole } from '@/api/generated/model';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/features/auth/password-policy';

import { parseRole, ROLE_LABEL } from './roles';

/** Mounted only while open, so every opening starts with empty fields. */
export function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const roleId = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserDtoRole>(UserDtoRole.user);
  const [formError, setFormError] = useState<string>();
  const create = useUsersCreate({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getUsersListQueryKey() });
        onClose();
      },
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
    if (name.trim() === '' || email.trim() === '' || password === '') {
      setFormError('auth.error.required');
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setFormError('auth.error.passwordShort');
      return;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      setFormError('auth.error.passwordLong');
      return;
    }
    setFormError(undefined);
    create.mutate({ data: { name, email, password, role } });
  }

  const errorKey =
    formError ??
    (create.isError ? errorMessageKey(create.error, { 400: 'auth.error.invalid', 409: 'auth.error.taken' }) : undefined);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('admin.users.create')}</DialogTitle>
            <DialogDescription>{t('admin.users.createHint')}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={nameId}>{t('admin.users.fields.name')}</FieldLabel>
              <Input
                id={nameId}
                autoComplete="off"
                maxLength={100}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={emailId}>{t('admin.users.fields.email')}</FieldLabel>
              <Input
                id={emailId}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={passwordId}>{t('admin.users.fields.password')}</FieldLabel>
              <Input
                id={passwordId}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
              <FieldDescription>{t('auth.signup.passwordHint')}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor={roleId}>{t('admin.users.fields.role')}</FieldLabel>
              <NativeSelect
                id={roleId}
                value={role}
                onChange={(event) => {
                  setRole(parseRole(event.target.value) ?? UserDtoRole.user);
                }}
              >
                {Object.values(UserDtoRole).map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {t(ROLE_LABEL[value])}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          {errorKey !== undefined && (
            <Alert variant="destructive">
              <AlertDescription>{t(errorKey)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t('admin.users.creating') : t('admin.users.createSubmit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/src/features/admin/roles.ts`:

```ts
import { UserDtoRole } from '@/api/generated/model';

/** The i18n key of each role; `satisfies` makes a new role in the contract a compile error here. */
export const ROLE_LABEL = {
  [UserDtoRole.pending]: 'admin.users.roles.pending',
  [UserDtoRole.user]: 'admin.users.roles.user',
  [UserDtoRole.admin]: 'admin.users.roles.admin',
} satisfies Record<UserDtoRole, string>;

/** Narrows the string of a select to a role without a cast. */
export function parseRole(value: string): UserDtoRole | undefined {
  return Object.values(UserDtoRole).find((role) => role === value);
}
```

`apps/web/src/features/admin/set-password-dialog.tsx`:

```tsx
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { useUsersSetPassword } from '@/api/generated/api';
import type { UserDto } from '@/api/generated/model';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/features/auth/password-policy';

/** Mounted only while open for one account. */
export function SetPasswordDialog({ user, onClose }: { user: UserDto; onClose: () => void }) {
  const { t } = useTranslation();
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string>();
  const setUserPassword = useUsersSetPassword({ mutation: { onSuccess: onClose } });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setUserPassword.isPending) return;
    if (password === '') {
      setFormError('auth.error.required');
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      setFormError('auth.error.passwordShort');
      return;
    }
    if (password.length > PASSWORD_MAX_LENGTH) {
      setFormError('auth.error.passwordLong');
      return;
    }
    setFormError(undefined);
    setUserPassword.mutate({ id: user.id, data: { password } });
  }

  const errorKey =
    formError ??
    (setUserPassword.isError
      ? errorMessageKey(setUserPassword.error, { 400: 'auth.error.invalid' })
      : undefined);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t('admin.users.password.title', { name: user.name })}</DialogTitle>
            <DialogDescription>{t('admin.users.password.description', { name: user.name })}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={passwordId}>{t('admin.users.password.label')}</FieldLabel>
            <Input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
            <FieldDescription>{t('auth.signup.passwordHint')}</FieldDescription>
          </Field>
          {errorKey !== undefined && (
            <Alert variant="destructive">
              <AlertDescription>{t(errorKey)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={setUserPassword.isPending}>
              {setUserPassword.isPending ? t('admin.users.password.submitting') : t('admin.users.password.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`apps/web/src/features/admin/delete-user-dialog.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import type { UserDto } from '@/api/generated/model';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export function DeleteUserDialog({
  user,
  busy,
  onConfirm,
}: {
  user: UserDto;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy} aria-label={t('admin.users.delete.named', { name: user.name })}>
          {t('admin.users.delete.action')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('admin.users.delete.title', { name: user.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('admin.users.delete.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t('admin.users.delete.action')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

`apps/web/src/features/admin/users-table.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import { getUsersListQueryKey, useUsersList, useUsersRemove, useUsersUpdate } from '@/api/generated/api';
import { type UpdateUserDto, type UserDto, UserDtoRole } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCurrentUser } from '@/features/auth/session';
import { formatDate } from '@/lib/format-date';

import { CreateUserDialog } from './create-user-dialog';
import { DeleteUserDialog } from './delete-user-dialog';
import { parseRole, ROLE_LABEL } from './roles';
import { SetPasswordDialog } from './set-password-dialog';

const USER_STATUS = { ACTIVE: 'active', PENDING: 'pending', DISABLED: 'disabled' } as const;
type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

function statusOf(user: UserDto): UserStatus {
  if (user.disabled) return USER_STATUS.DISABLED;
  return user.role === UserDtoRole.pending ? USER_STATUS.PENDING : USER_STATUS.ACTIVE;
}

const STATUS_VARIANT = {
  [USER_STATUS.ACTIVE]: 'secondary',
  [USER_STATUS.PENDING]: 'outline',
  [USER_STATUS.DISABLED]: 'destructive',
} as const satisfies Record<UserStatus, 'secondary' | 'outline' | 'destructive'>;

function UserRow({
  user,
  isSelf,
  busy,
  language,
  onChange,
  onRemove,
  onSetPassword,
}: {
  user: UserDto;
  isSelf: boolean;
  busy: boolean;
  language: string;
  onChange: (id: string, data: UpdateUserDto) => void;
  onRemove: (id: string) => void;
  onSetPassword: (user: UserDto) => void;
}) {
  const { t } = useTranslation();
  const status = statusOf(user);
  return (
    <TableRow>
      <TableCell className="font-medium">{user.name}</TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        {isSelf ? (
          t(ROLE_LABEL[user.role])
        ) : (
          <NativeSelect
            aria-label={t('admin.users.roleOf', { name: user.name })}
            value={user.role}
            disabled={busy}
            onChange={(event) => {
              const role = parseRole(event.target.value);
              if (role !== undefined) onChange(user.id, { role });
            }}
          >
            {Object.values(UserDtoRole).map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(ROLE_LABEL[value])}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[status]}>{t(`admin.users.status.${status}`)}</Badge>
      </TableCell>
      <TableCell>{formatDate(user.createdAt, language)}</TableCell>
      <TableCell>
        {isSelf ? (
          <span className="text-muted-foreground text-sm">{t('admin.users.you')}</span>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            {user.role === UserDtoRole.pending && !user.disabled && (
              <Button
                size="sm"
                disabled={busy}
                aria-label={t('admin.users.approveNamed', { name: user.name })}
                onClick={() => {
                  onChange(user.id, { role: UserDtoRole.user });
                }}
              >
                {t('admin.users.approve')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={t(user.disabled ? 'admin.users.enableNamed' : 'admin.users.disableNamed', { name: user.name })}
              onClick={() => {
                onChange(user.id, { disabled: !user.disabled });
              }}
            >
              {t(user.disabled ? 'admin.users.enable' : 'admin.users.disable')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={t('admin.users.password.named', { name: user.name })}
              onClick={() => {
                onSetPassword(user);
              }}
            >
              {t('admin.users.password.action')}
            </Button>
            <DeleteUserDialog
              user={user}
              busy={busy}
              onConfirm={() => {
                onRemove(user.id);
              }}
            />
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

export function UsersTable() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const self = useCurrentUser();
  const users = useUsersList();
  const [creating, setCreating] = useState(false);
  const [passwordFor, setPasswordFor] = useState<UserDto>();
  const refresh = () => queryClient.invalidateQueries({ queryKey: getUsersListQueryKey() });
  const update = useUsersUpdate({ mutation: { onSuccess: refresh } });
  const remove = useUsersRemove({ mutation: { onSuccess: refresh } });
  const busy = update.isPending || remove.isPending;

  function change(id: string, data: UpdateUserDto) {
    remove.reset();
    update.mutate({ id, data });
  }

  function removeUser(id: string) {
    update.reset();
    remove.mutate({ id });
  }

  // 409 on a change or a delete is the "at least one active admin" rule of the server.
  const failure: unknown = update.isError ? update.error : remove.error;
  const failed = update.isError || remove.isError;

  let body: ReactNode;
  if (users.isPending) {
    body = <PageLoading />;
  } else if (users.isError) {
    body = (
      <LoadError
        error={users.error}
        busy={users.isFetching}
        onRetry={() => {
          void users.refetch();
        }}
      />
    );
  } else {
    // The list is never empty: the signed-in admin is part of it, so there is no empty state.
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.users.columns.name')}</TableHead>
            <TableHead>{t('admin.users.columns.email')}</TableHead>
            <TableHead>{t('admin.users.columns.role')}</TableHead>
            <TableHead>{t('admin.users.columns.status')}</TableHead>
            <TableHead>{t('admin.users.columns.createdAt')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('admin.users.columns.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.data.data.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              isSelf={user.id === self.id}
              busy={busy}
              language={i18n.language}
              onChange={change}
              onRemove={removeUser}
              onSetPassword={setPasswordFor}
            />
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          {t('admin.users.create')}
        </Button>
      </div>
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorMessageKey(failure, { 409: 'admin.users.error.lastAdmin' }))}</AlertDescription>
        </Alert>
      )}
      {body}
      {creating && (
        <CreateUserDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
      {passwordFor !== undefined && (
        <SetPasswordDialog
          user={passwordFor}
          onClose={() => {
            setPasswordFor(undefined);
          }}
        />
      )}
    </div>
  );
}
```

`apps/web/src/pages/admin-users-page.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { UsersTable } from '@/features/admin/users-table';

export function AdminUsersPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('admin.users.description')}</p>
      </div>
      <UsersTable />
    </div>
  );
}
```

Route in `apps/web/src/app/router.tsx`: Imports `AdminUsersPage` (`@/pages/admin-users-page`); in `children` des Layouts vor `{ path: '*', … }` eintragen:

```tsx
          {
            element: <SessionGate allow={GATE.ADMIN} />,
            children: [{ path: 'admin/users', element: <AdminUsersPage /> }],
          },
```

Navigation in `apps/web/src/components/layout/app-layout.tsx`: Import `useCurrentUser` (`@/features/auth/session`) und `UserDtoRole` (`@/api/generated/model`); in `AppLayout` `const user = useCurrentUser();` ergänzen und nach dem Konto-Eintrag einsetzen:

```tsx
                {user.role === UserDtoRole.admin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <NavLink to="/admin/users">{t('nav.users')}</NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
```

Texte. `de.json` (`nav` um `"users": "Nutzer"` ergänzen) und neuer Block:

```json
  "admin": {
    "title": "Nutzerverwaltung",
    "users": {
      "description": "Hier legst du Konten an, schaltest sie frei und verwaltest ihre Rollen.",
      "fields": { "name": "Name", "email": "E-Mail-Adresse", "password": "Passwort", "role": "Rolle" },
      "columns": {
        "name": "Name",
        "email": "E-Mail-Adresse",
        "role": "Rolle",
        "status": "Status",
        "createdAt": "Erstellt",
        "actions": "Aktionen"
      },
      "roles": { "pending": "Wartend", "user": "Nutzer", "admin": "Administrator" },
      "status": { "active": "Aktiv", "pending": "Wartet auf Freischaltung", "disabled": "Gesperrt" },
      "roleOf": "Rolle von {{name}}",
      "you": "Das bist du.",
      "approve": "Freischalten",
      "approveNamed": "{{name}} freischalten",
      "disable": "Sperren",
      "disableNamed": "{{name}} sperren",
      "enable": "Entsperren",
      "enableNamed": "{{name}} entsperren",
      "create": "Nutzer anlegen",
      "createHint": "Das Konto kann sich sofort mit diesem Passwort anmelden.",
      "createSubmit": "Anlegen",
      "creating": "Wird angelegt …",
      "password": {
        "action": "Passwort setzen",
        "named": "Passwort für {{name}} setzen",
        "title": "Passwort für {{name}} setzen",
        "description": "{{name}} wird dadurch auf allen Geräten abgemeldet und muss sich mit dem neuen Passwort anmelden.",
        "label": "Neues Passwort",
        "submit": "Passwort setzen",
        "submitting": "Wird gespeichert …"
      },
      "delete": {
        "action": "Löschen",
        "named": "{{name}} löschen",
        "title": "Konto von {{name}} löschen?",
        "body": "Das Konto und alle zugehörigen Daten werden gelöscht. Das lässt sich nicht rückgängig machen."
      },
      "error": { "lastAdmin": "Es muss mindestens ein aktiver Administrator bleiben." }
    }
  },
```

`en.json` (`nav.users`: `"Users"`):

```json
  "admin": {
    "title": "User management",
    "users": {
      "description": "Create accounts here, approve them and manage their roles.",
      "fields": { "name": "Name", "email": "Email address", "password": "Password", "role": "Role" },
      "columns": {
        "name": "Name",
        "email": "Email address",
        "role": "Role",
        "status": "Status",
        "createdAt": "Created",
        "actions": "Actions"
      },
      "roles": { "pending": "Waiting", "user": "User", "admin": "Administrator" },
      "status": { "active": "Active", "pending": "Waiting for approval", "disabled": "Blocked" },
      "roleOf": "Role of {{name}}",
      "you": "That is you.",
      "approve": "Approve",
      "approveNamed": "Approve {{name}}",
      "disable": "Block",
      "disableNamed": "Block {{name}}",
      "enable": "Unblock",
      "enableNamed": "Unblock {{name}}",
      "create": "Create user",
      "createHint": "The account can sign in with this password right away.",
      "createSubmit": "Create",
      "creating": "Creating …",
      "password": {
        "action": "Set password",
        "named": "Set password for {{name}}",
        "title": "Set password for {{name}}",
        "description": "{{name}} is signed out on all devices and has to sign in with the new password.",
        "label": "New password",
        "submit": "Set password",
        "submitting": "Saving …"
      },
      "delete": {
        "action": "Delete",
        "named": "Delete {{name}}",
        "title": "Delete the account of {{name}}?",
        "body": "The account and all its data are deleted. This cannot be undone."
      },
      "error": { "lastAdmin": "At least one active administrator has to remain." }
    }
  },
```

- [x] **Step 3: Tests laufen lassen, grün sehen**

Run: `pnpm --filter @owui/web exec vitest run`
Expected: PASS. Stolpersteine:
(a) Zeilen im Test werden über den zugänglichen Namen der Tabellenzeile gefunden (`name: /Ben Beispiel/`); der Name setzt sich aus allen Zellen zusammen, ein Teilstring genügt, und die Namen der Testkonten sind so gewählt, dass keiner im anderen vorkommt.
(b) `t(`admin.users.status.${status}`)` ist ein dynamischer Schlüssel: `locales.spec.ts` vergleicht die Dateien miteinander, nicht die Aufrufe; die drei Schlüssel stehen in beiden Dateien.
(c) Nach `shadcn add` kann `Badge` weitere oder andere Varianten haben; `STATUS_VARIANT` nutzt nur `secondary`, `outline`, `destructive`, die es in allen Ständen gibt.

- [x] **Step 4: `pnpm check` und Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web
git commit -m "feat(web): add admin user management page" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Browserprobe, Docs und Beleg

**Files:**
- Modify: `docs/PLAN.md`, `docs/BACKLOG.md`, `docs/THREAT-MODEL.md`, `README.md` (nur falls dort Seiten oder Anmeldung beschrieben werden), `docs/superpowers/plans/2026-10-09-teilprojekt-1b-auth-web.md` (Häkchen)
- Create: `docs/dod/01-auth-web.md`

**Interfaces:**
- Consumes: alles aus Task 1 bis 5; Plan 1a umgesetzt; laufender Stack (`docker compose up -d --build --wait`).
- Produces: Beleg `docs/dod/01-auth-web.md`; aktualisierte Docs. Teilprojekt 1 ist damit abgeschlossen.

- [x] **Step 1: Vollständige Prüfung**

Run: `pnpm check && pnpm test && pnpm openapi && git diff --exit-code apps/api/openapi.json apps/web/src/api/generated`
Expected: alles grün, kein Unterschied im erzeugten Client. Die Anzahl der Web-Tests aus der Vitest-Ausgabe für den Beleg notieren.

Run: `pnpm db:up && pnpm test:db`
Expected: grün (die DB-Tests gehören zu Plan 1a, laufen hier als Gegenprobe, dass nichts am Backend kaputtgegangen ist).

- [x] **Step 2: Stack starten und im Browser prüfen**

Run: `docker compose up -d --build --wait`
Expected: alle Dienste `healthy`. Die Prüfung läuft gegen http://localhost:8080 (also hinter Caddy mit der echten CSP), nicht gegen den Vite-Entwicklungsserver. Browser-Werkzeuge laden: `ToolSearch` mit `select:mcp__chrome-devtools__navigate_page,mcp__chrome-devtools__take_snapshot,mcp__chrome-devtools__click,mcp__chrome-devtools__fill,mcp__chrome-devtools__list_console_messages,mcp__chrome-devtools__list_network_requests,mcp__chrome-devtools__get_network_request,mcp__chrome-devtools__resize_page,mcp__chrome-devtools__press_key,mcp__chrome-devtools__take_screenshot`. Die Datenbank ist frisch, das erste Konto wird Administrator, jedes weitere (Standard `DEFAULT_USER_ROLE=pending`) wartet.

Ablauf und erwartetes Ergebnis (jeden Punkt abhaken; bei jeder Seite danach `list_console_messages` ansehen):

| #   | Aktion                                                                                           | Erwartet                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `/` öffnen (nicht angemeldet)                                                                    | Weiterleitung auf `/login`, Titel „Konto erstellen“ mit dem Hinweis, dass das erste Konto Administrator wird; kein Umschalter                                  |
| 2   | Admin-Konto anlegen (Name, E-Mail, Passwort mit 12 Zeichen)                                      | Startseite, Seitenleiste mit Name und „Abmelden“, Links „Start“, „Konto“, „Nutzer“                                                                             |
| 3   | Netzwerk ansehen (`list_network_requests`, dann `get_network_request` auf `POST /api/auth/signup`) | Antwort setzt das Cookie `session` mit `HttpOnly` und `SameSite=Lax`; `GET /api/auth/me` danach 200                                                              |
| 4   | Neu laden (F5) auf `/admin/users`                                                                | Kurz Ladeansicht, dann die Nutzerliste mit der eigenen Zeile („Das bist du.“), kein Umweg über `/login`                                                        |
| 5   | `/settings/account`: Passwort mit falschem aktuellem Passwort ändern                             | Meldung „Das aktuelle Passwort stimmt nicht …“, Sitzung bleibt (Seite bleibt offen)                                                                            |
| 6   | Passwort richtig ändern                                                                          | Erfolgsmeldung, Felder leer; im Netzwerk trägt `POST /api/auth/password` den Header `X-CSRF-Token`                                                              |
| 7   | API-Schlüssel erstellen (30 Tage), Dialog ansehen, „Kopieren“, schließen                         | Schlüssel steht nur im Dialog; nach dem Schließen nirgends mehr auf der Seite (`take_snapshot` durchsuchen); Liste zeigt Name, Anfang, „Nie benutzt“              |
| 8   | Mit dem Schlüssel von außen: `curl -s -H "Authorization: Bearer <Schlüssel>" http://localhost:8080/api/auth/me` | 200 mit dem Admin; danach in der Oberfläche „Zuletzt benutzt“ mit Datum. Mit demselben Schlüssel `GET /api/users` liefert 403                                  |
| 9   | Schlüssel widerrufen (Rückfrage bestätigen), dann der `curl` aus 8                               | Zeile verschwindet, `curl` liefert 401                                                                                                                          |
| 10  | „Abmelden“                                                                                       | `/login`; Zurück-Taste führt nicht in die App, sondern wieder auf `/login`                                                                                      |
| 11  | „Noch kein Konto? Registrieren“, zweites Konto anlegen                                           | Wartebildschirm „Dein Konto wartet auf Freischaltung“; `/` und `/admin/users` leiten auf `/pending`; „Status prüfen“ ändert nichts                              |
| 12  | Abmelden, als Admin anmelden, `/admin/users`: „Freischalten“ beim zweiten Konto                  | Status wird „Aktiv“                                                                                                                                             |
| 13  | Abmelden, als zweites Konto anmelden                                                             | Startseite; kein Link „Nutzer“; `/admin/users` von Hand eingeben führt auf die Startseite                                                                       |
| 14  | Als Admin ein drittes Konto über „Nutzer anlegen“ erstellen, Passwort setzen, sperren, löschen   | Jede Aktion zeigt Rückfrage oder Dialog wie im Test; das gesperrte Konto kann sich nicht anmelden („E-Mail-Adresse oder Passwort stimmt nicht.“)                |
| 15  | Name `<img src=x onerror=alert(1)>` bei einem Konto anlegen                                      | Erscheint als Text in der Liste, kein Dialog, keine Konsolenmeldung                                                                                             |
| 16  | Dunkles Thema, Telefonbreite (`resize_page` auf 375 × 800), Tab-Taste durch das Anmeldeformular  | Alles lesbar, Tabelle scrollt waagerecht statt die Seite zu sprengen, Fokus sichtbar, Dialoge lassen sich mit Escape schließen                                    |
| 17  | Konsole über alle Schritte                                                                       | Keine Fehler, keine CSP-Verstöße („Refused to …“). Gibt es welche, die Ursache beheben (zum Beispiel ein Inline-Stil) und nicht die CSP lockern                  |

Danach: `docker compose down -v`.

Hinweis zum Werkzeug: Gibt es keinen Browser-MCP, die Punkte 1 bis 17 von Hand im Browser durchgehen und das Ergebnis im Beleg als „von Hand“ vermerken; ein Haken ohne Prüfung ist nicht erlaubt.

- [x] **Step 3: Gefundene Fehler beheben**

Jede Abweichung aus Step 2 bekommt zuerst einen Test, der sie zeigt (AGENTS.md, Abschnitt 4), dann die Korrektur, dann einen eigenen Commit `fix(web): …`. Danach den betroffenen Punkt in Step 2 erneut prüfen.

- [x] **Step 4: Docs aktualisieren**

- `docs/THREAT-MODEL.md`: Zeile ergänzen: Tampering/XSS, „Nutzer- oder Schlüsselname mit HTML in der Verwaltung“, Gegenmaßnahme „React escaped, kein `dangerouslySetInnerHTML`, Test mit `<img onerror>` in Nutzerliste und Schlüsselliste (1b)“. Die Zeile zu „Gestohlener Session-Cookie oder Key“ um „Klartext eines neuen Schlüssels nur im Speicher des Dialogs, nach dem Schließen verworfen (1b)“ ergänzen. „Stand“ auf „Teilprojekt 1“ setzen.
- `docs/BACKLOG.md`: Neue Zeilen: „Nutzerliste mit Suche und Seiten“ (heute lädt `GET /users` alle Konten; Filtern gehört später in SQL), „Eigenen Namen ändern und Profilbild“ (Open WebUI kann es, die Spec für Teilprojekt 1 nicht), „Sitzungsübersicht in der Oberfläche“ (Backend-Zeile aus 1a deckt die Route, nicht die Ansicht), „Browser-Test für Anmelden und Verwalten“ (Playwright; heute nur Komponententests plus Handprobe, passt zur bestehenden Zeile ‚Browser-Test für CSP‘, beide zusammenlegen).
- `docs/PLAN.md`: Teilprojekt 1 auf „erledigt, Plan: [1a](superpowers/plans/2026-10-09-teilprojekt-1a-auth-backend.md), [1b](superpowers/plans/2026-10-09-teilprojekt-1b-auth-web.md), Belege: [DoD 1a](dod/01-auth-backend.md), [DoD 1b](dod/01-auth-web.md)“ setzen; „Als Nächstes“: „1. Spec für Teilprojekt 2 (Modell-Anbindung) schreiben. 2. Plan für Stufe 2 des Agentic-Setups …“.
- `README.md`: Beschreibt der Abschnitt „Schnellstart“ den Aufruf der App, einen Satz ergänzen: „Beim ersten Start legt das erste Konto (Registrierung auf `/login`) den Administrator an; weitere Konten wartet der Administrator unter ‚Nutzer‘ frei (Standard).“ Gibt es dort schon eine Angabe zu `ADMIN_EMAIL`/`ADMIN_PASSWORD` (aus Plan 1a), diese nicht doppeln.

- [x] **Step 5: Beleg schreiben**

`docs/dod/01-auth-web.md` nach dem Muster von [DoD 00](../../dod/00-fundament.md), mit den echten Zahlen aus Step 1:

```markdown
### DoD: Teilprojekt 1b (Auth-Web)

- [x] Vertrag: Oberfläche nutzt nur den erzeugten Client; `pnpm openapi` ohne Abweichung
- [x] Tests: <Web-Zahl> Web grün; `pnpm check` grün; Wächter-Matrix (4 Wächter × 4 Zustände), 401 mitten in der Sitzung, Serverfehler auf `me`, Doppel-Submit in jedem Formular, HTML in Namen
- [x] Invarianten: Server entscheidet (Wächter nur Komfort); Cache wird bei Anmeldung und Abmeldung geleert; Klartext-Schlüssel nur im Dialog; keine Geheimnisse in Logs
- [x] UI: Zustände laden, Fehler mit Wiederholen, in Arbeit für jede Ansicht; „leer“ dort, wo es vorkommt (Schlüsselliste), sonst begründet nicht anwendbar (Nutzerliste enthält immer den Admin); deutsche Texte über i18n, Englisch mit gleichen Schlüsseln; im Browser über Caddy geprüft (Probe 1 bis 17 aus Plan 1b, Task 6), Konsole ohne CSP-Verstöße, hell/dunkel, Telefonbreite, Tastatur
- [x] Betrieb: `docker compose up` grün, Smoke-Test grün
- [x] Docs: PLAN, BACKLOG, THREAT-MODEL, README aktualisiert
- [ ] Offen: siehe docs/BACKLOG.md
```

Die spitze Klammer durch die gemessene Zahl ersetzen. Ist ein Punkt nicht erfüllt oder nicht geprüft, `- [ ]` lassen und den Grund dahinter schreiben.

- [x] **Step 6: Plan abhaken, Commit, Push, CI**

In diesem Plan alle erledigten Schritte mit `- [x]` markieren. In Plan 1a bleibt der Stand unverändert.

```bash
git add docs README.md
git commit -m "docs: record Teilprojekt 1b (browser check, threat model, backlog, DoD)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
gh run list --branch main --limit 1
```

Expected: Push ohne Ablehnung; die CI läuft. Bis sie grün ist, `gh run watch` nutzen; eine rote CI vor jeder weiteren Arbeit beheben. Danach den Nutzer in einem Satz auf `/clear` hinweisen.
