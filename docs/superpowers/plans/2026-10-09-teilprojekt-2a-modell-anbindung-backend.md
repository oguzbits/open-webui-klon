# Teilprojekt 2a: Modell-Anbindung (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins hinterlegen Verbindungen zu Ollama oder einem OpenAI-kompatiblen Endpoint (Key verschlüsselt, Host geprüft); angemeldete Nutzer sehen die Modelle samt Anbieter; das Backend liefert für jede Modell-ID ein AI-SDK-`LanguageModel` (`ModelRegistryService.resolve()`), das der Chat in Teilprojekt 3 nutzt.

**Architecture:** Neues Feature-Modul `models` in `apps/api`. `ProviderConnectionsService` besitzt die Tabelle `provider_connection` (CRUD, AES-256-GCM über `SecretBox`, Host-Prüfung, Audit). `ModelRegistryService` fragt aktive Verbindungen über je einen `ProviderAdapter` ab (Ollama, OpenAI-kompatibel), cacht die Listen kurz im Speicher und liefert `resolve()`. Jeder ausgehende Aufruf läuft über den neuen `ProviderFetchService` neben dem `SafeFetchService`: eigene DNS-Auflösung, Adressprüfung bei **jedem** Aufruf, angeheftete IP, keine Weiterleitungen, Ursprung der Verbindung fest.

**Tech Stack:** NestJS 12, TypeORM 1.x (Postgres), `undici` (nur im Ordner `http/safe-fetch`), `ai` 7.x und `@ai-sdk/openai-compatible` 3.x, `zod` 4 (Antwortformate der Anbieter), Node `crypto` (AES-256-GCM), Vitest + Supertest.

**Spec:** [Teilprojekt 2](../specs/2026-10-09-teilprojekt-2-modell-anbindung-design.md). Rahmen: [Gesamt-Spec](../specs/2026-10-09-open-webui-nestjs-design.md). Die Oberfläche (Teilprojekt 2b) folgt in einem eigenen Plan.

## Global Constraints

- `pnpm`, nie `npm` oder `yarn`. Befehle aus `AGENTS.md`: `pnpm check`, `pnpm test`, `pnpm db:up`, `pnpm test:db`, `pnpm openapi`.
- Kein `any`, kein `@ts-ignore`, kein `as unknown as`, kein `export *`. Typen aus DTOs; Antworten von Anbietern werden mit `zod` geparst, nicht mit `as` behauptet.
- Steuernde Werte als `export const X = {...} as const` (`PROVIDER_TYPE`, `PROVIDER_ERROR`, `AUDIT_ACTION`) und überall importiert, auch in Tests.
- Env nur über `apps/api/src/config/env.ts`; kein `process.env` in neuem Code. `.env*` wird nie gelesen, ausgegeben oder committet; nur `.env.example` ist versioniert.
- **Invariante 7:** Jeder ausgehende HTTP-Abruf auf eine Anbieter-URL läuft über `ProviderFetchService` (`apps/api/src/http/safe-fetch`). Nur dieser Ordner darf `undici` importieren; die ESLint-Regel bleibt unverändert.
- Kein API-Key (Klartext oder Ciphertext) in einer Antwort, einem Log, einem Audit-Eintrag oder im Klartext in der DB. Logs tragen nur Verbindungs-ID, Typ, Status, Dauer, Zahl der Modelle; keine URLs mit Query, keine Anbieter-Antworttexte.
- Modell-ID nach außen: `<connectionId>:<rawModelId>`, beim Zerlegen am **ersten** `:` geteilt.
- Fehlerursachen aus dem Wörterbuch `PROVIDER_ERROR` (`timeout`, `unreachable`, `unauthorized`, `bad_response`, `blocked_host`), nie als leere Liste verschluckt.
- Migrationen werden mit `migration:generate` erzeugt und danach nie von Hand geändert. Neue Entities in `database/entities.ts`, Migrationen in `database/migrations/index.ts` eintragen.
- Abhängigkeiten: Versionen älter als sieben Tage (`minimumReleaseAge` in `pnpm-workspace.yaml`); die Sperre wird nie umgangen. Grund jeder Abhängigkeit in die Commit-Nachricht.
- Git: direkt auf `main`, ein Thema pro Commit, Conventional Commits, Imperativ. Hooks nie mit `--no-verify` umgehen. Jede Commit-Nachricht endet mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Nach einem Push: `gh run list --branch main --limit 1` prüfen, rote CI vor neuer Arbeit beheben.

## Review Focus

Eingabeklassen, die die Spec nicht ausdrücklich nennt und die im Alltag auftreten. Jede Zeile hat einen Test in der genannten Task.

1. **Modell-IDs mit Doppelpunkt** (`llama3:8b`, `hf.co/acme/model:Q4_K_M`) und kaputte IDs (leer, ohne Doppelpunkt, Nicht-UUID davor, nur `<uuid>:`): richtig zerlegt beziehungsweise 404, nie 500 (Task 4, 8, 10).
2. **Anbieter antwortet feindlich oder kaputt** (Weiterleitung, HTML statt JSON, riesiger Body mit und ohne `content-length`, Hänger, Verbindung verweigert, 401): jeweils genau eine Ursache aus `PROVIDER_ERROR`, die anderen Verbindungen laufen weiter (Task 5, 7, 8).
3. **Basis-URL in Varianten** (`HTTP://Host:11434/`, mit Pfad `/v1/`, mit `user:pass@`, mit `?token=`, mit `#`, ohne Schema): normalisiert beziehungsweise 422, nie gespeichert mit Zugangsdaten (Task 4, 9, 10).
4. **Zwei Admins legen gleichzeitig denselben Namen an:** genau ein `201`, der andere `409` (Task 9).
5. **API-Key mit Zeilenumbruch oder Leerzeichen am Ende** (Copy-and-paste): Leerzeichen am Rand werden entfernt, Steuerzeichen im Key ergeben `400`; nie ein 500 durch einen ungültigen Header (Task 10).

---

## Dateistruktur

```
apps/api/src/
  config/env.ts                         PROVIDER_KEY_ENCRYPTION_KEYS, PROVIDER_ALLOWED_HOSTS, MODEL_LIST_CACHE_TTL_MS,
                                        PROVIDER_REQUEST_TIMEOUT_MS
  http/safe-fetch/
    provider-error.ts                   PROVIDER_ERROR, ProviderError
    address-policy.ts                   parseAllowedHost, isAllowedHost, isProviderAddressAllowed, canonicalHost
    provider-fetch.service.ts           ProviderFetchService (createFetch, getJson, assertHostAllowed)
    safe-fetch.module.ts                + ProviderFetchService, Options aus der Konfiguration
  models/
    provider-type.ts                    PROVIDER_TYPE, ProviderType
    model-id.ts                         formatModelId, parseModelId
    base-url.ts                         normalizeBaseUrl, InvalidBaseUrlError
    secret-box.ts                       parseKeyring, encryptSecret, decryptSecret (rein), SecretBox (Dienst)
    provider-connection.entity.ts       ProviderConnection (Tabelle provider_connection)
    provider-adapter.ts                 ProviderAdapter, ProviderTarget, RawModel, PROVIDER_ADAPTERS
    ollama.adapter.ts                   OllamaAdapter
    openai-compatible.adapter.ts        OpenAiCompatibleAdapter
    model-list-cache.ts                 ModelListCache (im Speicher, TTL)
    provider-connections.service.ts     CRUD, Host-Prüfung, Verschlüsselung, Audit
    model-registry.service.ts           list, listForConnection, test, resolve
    provider-connections.dto.ts         DTOs der Admin-Routen
    models.dto.ts                       DTOs von GET /models
    provider-connections.controller.ts  /admin/provider-connections
    models.controller.ts                /models
    models.module.ts
  testing/
    fake-provider.ts                    HTTP-Server im Test (Ollama- und OpenAI-Format, Fehlermodi)
scripts/fake-provider.mjs               derselbe Fake für Handproben und die Browserprüfung in 2b
```

---

### Task 1: Abhängigkeiten und Verträglichkeit mit `ai` 7 (Regel 10)

Die Spec nennt `ai` 7.0.137 und `@ai-sdk/openai-compatible` 3.0.67. Beide sind am 2026-10-08/09 erschienen und jünger als die Karenzzeit von sieben Tagen (`minimumReleaseAge: 10080`). Geprüft am 2026-10-09 gegen die npm-Registry: neueste ausreichend alte Versionen sind `ai` 7.0.127 (2026-10-01), `@ai-sdk/openai-compatible` 3.0.62 (2026-09-30), `zod` 4.6.5 (2026-09-13). Mit genau diesen Versionen wurde der Vertrag unten von Hand geprüft (`languageModel(id).doGenerate` ruft den übergebenen `fetch` mit `…/chat/completions` und `Authorization: Bearer …` auf; ein dort geworfener Fehler erreicht den Aufrufer unverändert).

**Files:**
- Modify: `apps/api/package.json`, `pnpm-lock.yaml`
- Create: `apps/api/src/models/ai-sdk.contract.spec.ts`

**Interfaces:**
- Produces: die Pakete `ai`, `@ai-sdk/openai-compatible`, `zod` als Abhängigkeiten von `@owui/api`; ein Vertragstest, der die vom Plan genutzte AI-SDK-Oberfläche festhält (Versionswechsel werden dadurch rot, nicht still).

- [ ] **Step 1: Abhängigkeiten ergänzen**

```bash
pnpm --filter @owui/api add ai@^7.0.127 @ai-sdk/openai-compatible@^3.0.62 zod@^4.6.5
```

Expected: Installation gelingt. Meldet pnpm, eine Version sei zu jung (`minimumReleaseAge`) oder verstoße gegen `trustPolicy`, die Sperre **nicht** umgehen: die nächst ältere Version wählen und im Commit nennen. Meldet pnpm „ignored build scripts“ für eines der neuen Pakete, es **nicht** in `allowBuilds` aufnehmen, sondern in der Commit-Nachricht festhalten (keines der drei braucht Installationsskripte). Danach die aufgelösten Versionen notieren:

```bash
pnpm --filter @owui/api list ai @ai-sdk/openai-compatible zod --depth 0
```

- [ ] **Step 2: Vertragstest schreiben**

`apps/api/src/models/ai-sdk.contract.spec.ts`:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  model: unknown;
}

function chatCompletion(): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'llama3:8b',
      choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'ping' }] }];

describe('AI SDK contract the model registry builds on', () => {
  it('sends model id, key and request through the fetch we hand in', async () => {
    const calls: Call[] = [];
    const provider = createOpenAICompatible({
      name: 'connection-1',
      baseURL: 'http://models.test/v1',
      apiKey: 'sk-test',
      fetch: (input, init) => {
        const body: unknown = JSON.parse(String(init?.body));
        calls.push({
          url: String(input),
          method: init?.method,
          authorization: new Headers(init?.headers).get('authorization'),
          model: typeof body === 'object' && body !== null && 'model' in body ? body.model : undefined,
        });
        return Promise.resolve(chatCompletion());
      },
    });

    const model = provider.languageModel('llama3:8b');
    const asLanguageModel: LanguageModel = model;
    const result = await model.doGenerate({ prompt: PROMPT });

    expect(asLanguageModel).toBe(model);
    expect(model.provider).toBe('connection-1.chat');
    expect(model.modelId).toBe('llama3:8b');
    expect(calls).toEqual([
      {
        url: 'http://models.test/v1/chat/completions',
        method: 'POST',
        authorization: 'Bearer sk-test',
        model: 'llama3:8b',
      },
    ]);
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);
  });

  it('sends no Authorization header without a key', async () => {
    let authorization: string | null = 'unset';
    const provider = createOpenAICompatible({
      name: 'connection-2',
      baseURL: 'http://models.test/v1',
      fetch: (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization');
        return Promise.resolve(chatCompletion());
      },
    });

    await provider.languageModel('m').doGenerate({ prompt: PROMPT });

    expect(authorization).toBeNull();
  });

  it('lets an error thrown by our fetch reach the caller unchanged', async () => {
    class Blocked extends Error {
      readonly reason = 'blocked_host';
    }
    const provider = createOpenAICompatible({
      name: 'connection-3',
      baseURL: 'http://models.test/v1',
      fetch: () => Promise.reject(new Blocked('no')),
    });

    await expect(provider.languageModel('m').doGenerate({ prompt: PROMPT })).rejects.toBeInstanceOf(
      Blocked
    );
  });

  it('ships a v4 mock model for the chat tests of Teilprojekt 3', () => {
    const mock: LanguageModel = new MockLanguageModelV4();

    expect(typeof mock === 'string' ? mock : mock.specificationVersion).toBe('v4');
  });
});
```

- [ ] **Step 3: Test laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/models/ai-sdk.contract.spec.ts`
Expected: PASS (vier Tests). Schlägt ein Import mit einem ESM-/CJS-Fehler fehl, ist das der unsichere Punkt aus Spec Abschnitt 2: Fehlermeldung festhalten und den Nutzer informieren, nicht mit Umwegen (Dynamic Import, `createRequire`) weiterbauen.

- [ ] **Step 4: Build und Typprüfung**

Run: `pnpm --filter @owui/api build && pnpm --filter @owui/api typecheck`
Expected: beides ohne Fehler.

Zusätzlich beweisen, dass Node die Pakete aus dem Paket `@owui/api` als ESM laden kann:

```bash
pnpm --filter @owui/api exec node -e "Promise.all([import('ai'), import('@ai-sdk/openai-compatible')]).then(() => console.log('ESM imports ok'))"
```

Expected: `ESM imports ok`. (`tsconfig.build.json` schließt `*.spec.ts` und `src/testing` aus; der Vertragstest gehört nicht in die Auslieferung.)

- [ ] **Step 5: Audit der neuen Abhängigkeiten**

Run: `pnpm audit --prod --audit-level high`
Expected: keine neuen Funde durch `ai`, `@ai-sdk/*`, `zod`. Findet es etwas, den Fund im Commit nennen und den Nutzer informieren (die CI blockiert bei „high“).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/models/ai-sdk.contract.spec.ts
git commit -m "build(api): add ai, @ai-sdk/openai-compatible and zod" -m "ai provides LanguageModel and the v4 mock for the chat tests, @ai-sdk/openai-compatible talks to Ollama (/v1) and OpenAI-compatible endpoints, zod validates provider answers. Versions are the newest ones older than the 7-day release age (ai 7.0.137 and openai-compatible 3.0.67 from the spec are younger). The contract spec pins the SDK surface the model registry relies on." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Wörterbücher und Konfiguration

**Files:**
- Create: `apps/api/src/models/provider-type.ts`, `apps/api/src/http/safe-fetch/provider-error.ts`, `apps/api/src/http/safe-fetch/address-policy.ts`
- Modify: `apps/api/src/database/audit/audit-action.ts`, `apps/api/src/config/env.ts`, `apps/api/src/config/env.spec.ts`, `apps/api/src/testing/create-test-app.ts`, `apps/api/src/logging/redact.ts`, `apps/api/src/logging/redact.spec.ts`, `apps/api/package.json` (Skript `openapi`), `.env.example`, `compose.yml`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `PROVIDER_TYPE` (`OLLAMA: 'ollama'`, `OPENAI_COMPATIBLE: 'openai_compatible'`), `ProviderType`; `PROVIDER_ERROR` (`TIMEOUT: 'timeout'`, `UNREACHABLE: 'unreachable'`, `UNAUTHORIZED: 'unauthorized'`, `BAD_RESPONSE: 'bad_response'`, `BLOCKED_HOST: 'blocked_host'`), `ProviderErrorReason`, `ProviderError(reason, message)` mit `readonly reason`; `ALLOWED_HOST_PATTERN: RegExp`; erweiterte `AUDIT_ACTION` (`PROVIDER_CONNECTION_CREATED: 'provider_connection.created'`, `PROVIDER_CONNECTION_UPDATED: 'provider_connection.updated'`, `PROVIDER_CONNECTION_DELETED: 'provider_connection.deleted'`); `Env`-Felder `PROVIDER_KEY_ENCRYPTION_KEYS: string[]` (Pflicht), `PROVIDER_ALLOWED_HOSTS: string[]`, `MODEL_LIST_CACHE_TTL_MS: number`, `PROVIDER_REQUEST_TIMEOUT_MS: number`.

- [ ] **Step 1: Wörterbücher anlegen**

`apps/api/src/models/provider-type.ts`:

```ts
export const PROVIDER_TYPE = {
  OLLAMA: 'ollama',
  OPENAI_COMPATIBLE: 'openai_compatible',
} as const;

export type ProviderType = (typeof PROVIDER_TYPE)[keyof typeof PROVIDER_TYPE];
```

`apps/api/src/http/safe-fetch/provider-error.ts`:

```ts
export const PROVIDER_ERROR = {
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
  UNAUTHORIZED: 'unauthorized',
  BAD_RESPONSE: 'bad_response',
  BLOCKED_HOST: 'blocked_host',
} as const;

export type ProviderErrorReason = (typeof PROVIDER_ERROR)[keyof typeof PROVIDER_ERROR];

/** The message never contains a URL, a key or any text the provider sent. */
export class ProviderError extends Error {
  constructor(
    readonly reason: ProviderErrorReason,
    message: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
```

In `apps/api/src/database/audit/audit-action.ts` nach `API_KEY_REVOKED` ergänzen:

```ts
  PROVIDER_CONNECTION_CREATED: 'provider_connection.created',
  PROVIDER_CONNECTION_UPDATED: 'provider_connection.updated',
  PROVIDER_CONNECTION_DELETED: 'provider_connection.deleted',
```

`apps/api/src/http/safe-fetch/address-policy.ts` (hier nur das Muster, die Funktionen folgen in Task 4):

```ts
/** `host`, `host:port`, `[v6]` or `[v6]:port` (a path, wildcard or scheme is not an allow-list entry). */
export const ALLOWED_HOST_PATTERN = /^(\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)(:[0-9]{1,5})?$/;
```

- [ ] **Step 2: Fehlschlagende Env-Tests schreiben**

In `apps/api/src/config/env.spec.ts` steht ein Objekt `VALID` (Mindestkonfiguration). Dort `PROVIDER_KEY_ENCRYPTION_KEYS: KEY_ENTRY` ergänzen, mit einer Konstante vor `VALID`:

```ts
/** 32 zero bytes: a syntactically valid key for tests only. */
const KEY_ENTRY = `test:${Buffer.alloc(32).toString('base64')}`;
```

Am Dateiende anhängen:

```ts
describe('validateEnv: provider settings', () => {
  it('has safe defaults', () => {
    const env = validateEnv(VALID);

    expect(env.PROVIDER_KEY_ENCRYPTION_KEYS).toEqual([KEY_ENTRY]);
    expect(env.PROVIDER_ALLOWED_HOSTS).toEqual([]);
    expect(env.MODEL_LIST_CACHE_TTL_MS).toBe(30000);
    expect(env.PROVIDER_REQUEST_TIMEOUT_MS).toBe(10000);
  });

  it('requires an encryption key', () => {
    const without = Object.fromEntries(
      Object.entries(VALID).filter(([name]) => name !== 'PROVIDER_KEY_ENCRYPTION_KEYS')
    );

    expect(() => validateEnv(without)).toThrow(/PROVIDER_KEY_ENCRYPTION_KEYS/);
    expect(() => validateEnv({ ...VALID, PROVIDER_KEY_ENCRYPTION_KEYS: '' })).toThrow(
      /PROVIDER_KEY_ENCRYPTION_KEYS/
    );
  });

  it('accepts several keys, the first one encrypts', () => {
    const second = `old:${Buffer.alloc(32, 1).toString('base64')}`;

    const env = validateEnv({ ...VALID, PROVIDER_KEY_ENCRYPTION_KEYS: `${KEY_ENTRY}, ${second}` });

    expect(env.PROVIDER_KEY_ENCRYPTION_KEYS).toEqual([KEY_ENTRY, second]);
  });

  it.each([
    ['no key id', Buffer.alloc(32).toString('base64')],
    ['a key of 31 bytes', `k:${Buffer.alloc(31).toString('base64')}`],
    ['a key of 33 bytes', `k:${Buffer.alloc(33).toString('base64')}`],
    ['a key id with a dot', `a.b:${Buffer.alloc(32).toString('base64')}`],
    ['text instead of base64', 'k:not base64 at all, really not base64 at all!!'],
  ])('rejects %s without echoing it', (_name, entry) => {
    const attempt = () => validateEnv({ ...VALID, PROVIDER_KEY_ENCRYPTION_KEYS: entry });

    expect(attempt).toThrow(/PROVIDER_KEY_ENCRYPTION_KEYS/);
    expect(attempt).not.toThrow(new RegExp(entry.slice(0, 20).replace(/[+/]/g, '.')));
  });

  it('parses the allowed hosts as a list', () => {
    const env = validateEnv({
      ...VALID,
      PROVIDER_ALLOWED_HOSTS: 'host.docker.internal, ollama ,localhost:11434,[::1]:11434',
    });

    expect(env.PROVIDER_ALLOWED_HOSTS).toEqual([
      'host.docker.internal',
      'ollama',
      'localhost:11434',
      '[::1]:11434',
    ]);
  });

  it.each(['http://ollama', 'ollama/path', '*.example.com', 'ollama:99999x', 'a b'])(
    'rejects %s as an allowed host',
    (entry) => {
      expect(() => validateEnv({ ...VALID, PROVIDER_ALLOWED_HOSTS: entry })).toThrow(
        /PROVIDER_ALLOWED_HOSTS/
      );
    }
  );

  it('reads the cache time-to-live and the request timeout', () => {
    const env = validateEnv({
      ...VALID,
      MODEL_LIST_CACHE_TTL_MS: '0',
      PROVIDER_REQUEST_TIMEOUT_MS: '2500',
    });

    expect(env.MODEL_LIST_CACHE_TTL_MS).toBe(0);
    expect(env.PROVIDER_REQUEST_TIMEOUT_MS).toBe(2500);
    expect(() => validateEnv({ ...VALID, PROVIDER_REQUEST_TIMEOUT_MS: '0' })).toThrow(
      /PROVIDER_REQUEST_TIMEOUT_MS/
    );
  });
});
```

Hinweis: Ist `VALID` in der Datei anders benannt oder aufgebaut, an den Namen anpassen (`grep -n "VALID" apps/api/src/config/env.spec.ts | head`).

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/config/env.spec.ts`
Expected: FAIL (die neuen Felder gibt es nicht).

- [ ] **Step 4: Env erweitern**

In `apps/api/src/config/env.ts` Importe ergänzen: `ArrayMinSize` aus `class-validator` (alphabetisch einsortieren) und

```ts
import { ALLOWED_HOST_PATTERN } from '../http/safe-fetch/address-policy.js';
```

Unter `HTTP_URL_PATTERN` ergänzen:

```ts
// keyId:base64(32 bytes). The id has no dot (it sits between dots in the stored format).
const KEYRING_ENTRY_PATTERN = /^[A-Za-z0-9_-]{1,32}:[A-Za-z0-9+/]{43}=$/;
```

In der Klasse `Env` nach `ADMIN_NAME` einfügen:

```ts
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
```

`splitList` macht aus `''` eine leere Liste; `@ArrayMinSize(1)` lehnt sie ab.

- [ ] **Step 5: Test laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/config/env.spec.ts`
Expected: PASS.

- [ ] **Step 6: Bestehende Konfigurationen nachziehen**

Die Pflicht-Variable bricht jede Umgebung, die sie nicht setzt. Alle Stellen:

1. `apps/api/src/testing/create-test-app.ts`: in `BASE_TEST_ENV` ergänzen
   ```ts
     // 32 zero bytes: valid for tests, worthless as a secret.
     PROVIDER_KEY_ENCRYPTION_KEYS: `test:${Buffer.alloc(32).toString('base64')}`,
   ```
2. `apps/api/package.json`, Skript `openapi`: die Erzeugung lädt die Konfiguration, ohne Anbieter zu starten; den Platzhalter vor `node` setzen:
   ```json
   "openapi": "DATABASE_URL=postgresql://openapi:openapi@localhost:5432/openapi PROVIDER_KEY_ENCRYPTION_KEYS=openapi:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= node dist/openapi/generate.js"
   ```
   (`AAAA…=` sind 43 `A` und ein `=`: 32 Null-Bytes.)
3. `.env.example` am Ende anhängen:
   ```
   # Model providers. The key encrypts the API keys admins store for providers (AES-256-GCM).
   # THIS VALUE IS A PUBLIC DEVELOPMENT KEY: generate your own for anything real:
   #   node -e "console.log('prod1:' + require('crypto').randomBytes(32).toString('base64'))"
   # Newest key first; keep old keys behind it so stored values stay readable.
   PROVIDER_KEY_ENCRYPTION_KEYS=dev:ZGV2ZWxvcG1lbnQtb25seS1wdWJsaWMta2V5LTAwMDA=
   # Private hosts a provider connection may reach (comma-separated host or host:port). Public hosts need no entry.
   PROVIDER_ALLOWED_HOSTS=host.docker.internal,ollama
   MODEL_LIST_CACHE_TTL_MS=30000
   PROVIDER_REQUEST_TIMEOUT_MS=10000
   ```
   Den Entwicklungsschlüssel prüfen: `echo -n 'development-only-public-key-0000' | base64` muss `ZGV2ZWxvcG1lbnQtb25seS1wdWJsaWMta2V5LTAwMDA=` ergeben und 32 Byte lang sein (`echo -n 'development-only-public-key-0000' | wc -c` → 32). Weicht es ab, den Wert aus der Ausgabe übernehmen.
4. `compose.yml`, Dienst `api`, Abschnitt `environment` nach `ADMIN_NAME` ergänzen (kein Standardwert: ein bekannter Schlüssel darf nicht still in eine Produktivumgebung geraten):
   ```yaml
         PROVIDER_KEY_ENCRYPTION_KEYS: ${PROVIDER_KEY_ENCRYPTION_KEYS:?Set PROVIDER_KEY_ENCRYPTION_KEYS (see .env.example)}
         PROVIDER_ALLOWED_HOSTS: ${PROVIDER_ALLOWED_HOSTS:-}
         MODEL_LIST_CACHE_TTL_MS: ${MODEL_LIST_CACHE_TTL_MS:-30000}
         PROVIDER_REQUEST_TIMEOUT_MS: ${PROVIDER_REQUEST_TIMEOUT_MS:-10000}
   ```
5. `.github/workflows/ci.yml`, Job `compose-smoke`: Compose wertet die Datei bei jedem Aufruf aus (`up`, `logs`, `down`), also die Variable einmal auf Job-Ebene setzen (Wert nur für die CI, kein Geheimnis). Direkt unter `timeout-minutes: 25` einfügen:
   ```yaml
       env:
         PROVIDER_KEY_ENCRYPTION_KEYS: ci:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
   ```

- [ ] **Step 7: Redact-Pfade erweitern, mit Test**

In `apps/api/src/logging/redact.ts` die Liste ergänzen:

```ts
  '*.apiKeyCiphertext',
  '*.authorization',
  '*.headers.authorization',
```

In `apps/api/src/logging/redact.spec.ts` im vorhandenen Test das Objekt `user: { password: 'pw-secret' }` erweitern und die Prüfliste:

```ts
        user: { password: 'pw-secret' },
        connection: { apiKey: 'sk-provider-1', apiKeyCiphertext: 'v1.dev.iv.cipher-1' },
        outgoing: { authorization: 'Bearer sk-provider-2', headers: { authorization: 'Bearer sk-provider-3' } },
```

```ts
    for (const secret of [
      'token-abc', 'cookie-1', 'cookie-2', 'key-123', 'pw-secret',
      'sk-provider-1', 'cipher-1', 'sk-provider-2', 'sk-provider-3',
    ]) {
```

- [ ] **Step 8: Alles Bestehende prüfen**

Run: `pnpm --filter @owui/api exec vitest run && pnpm check`
Expected: PASS. Dann `pnpm openapi && git status --short`: `apps/api/openapi.json` bleibt unverändert (noch keine neuen Routen).

- [ ] **Step 9: Commit**

```bash
git add apps/api .env.example compose.yml .github/workflows/ci.yml
git commit -m "feat(api): add provider settings and dictionaries" -m "PROVIDER_KEY_ENCRYPTION_KEYS is required and has no default in compose, so a public development key can never reach production unnoticed. PROVIDER_ALLOWED_HOSTS lists the private hosts a connection may reach." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `SecretBox` (AES-256-GCM)

**Files:**
- Create: `apps/api/src/models/secret-box.ts`, `apps/api/src/models/secret-box.spec.ts`

**Interfaces:**
- Consumes: `Env.PROVIDER_KEY_ENCRYPTION_KEYS: string[]`.
- Produces:
  - `parseKeyring(entries: readonly string[]): Keyring` mit `interface Keyring { current: KeyringEntry; byId: ReadonlyMap<string, Buffer> }` und `interface KeyringEntry { keyId: string; key: Buffer }`; wirft bei doppelter `keyId` oder falscher Länge.
  - `encryptSecret(plaintext: string, keyring: Keyring, connectionId: string): string` → `v1.<keyId>.<iv>.<ciphertext+tag>` (Base64url).
  - `decryptSecret(stored: string, keyring: Keyring, connectionId: string): string`; wirft `SecretBoxError` mit `code` aus `SECRET_BOX_ERROR` (`MALFORMED: 'malformed'`, `UNKNOWN_KEY: 'unknown_key'`, `TAMPERED: 'tampered'`).
  - `@Injectable() class SecretBox { encrypt(plaintext: string, connectionId: string): string; decrypt(stored: string, connectionId: string): string }`, liest `PROVIDER_KEY_ENCRYPTION_KEYS` aus `ConfigService`.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`apps/api/src/models/secret-box.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  parseKeyring,
  SECRET_BOX_ERROR,
  SecretBoxError,
} from './secret-box.js';

const keyEntry = (id: string, fill: number) => `${id}:${Buffer.alloc(32, fill).toString('base64')}`;

const ring = parseKeyring([keyEntry('k1', 1)]);
const CONNECTION = randomUUID();

function failureOf(work: () => unknown): SecretBoxError {
  try {
    work();
  } catch (error) {
    if (error instanceof SecretBoxError) return error;
    throw error;
  }
  throw new Error('expected SecretBoxError');
}

describe('SecretBox: format and round trip', () => {
  it('round-trips a secret and stores it as v1.<keyId>.<iv>.<ciphertext>', () => {
    const stored = encryptSecret('sk-provider-secret', ring, CONNECTION);

    expect(stored).toMatch(/^v1\.k1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
    expect(stored).not.toContain('sk-provider-secret');
    expect(decryptSecret(stored, ring, CONNECTION)).toBe('sk-provider-secret');
  });

  it('uses a fresh IV every time', () => {
    expect(encryptSecret('same', ring, CONNECTION)).not.toBe(encryptSecret('same', ring, CONNECTION));
  });

  it('handles empty-looking and non-ASCII secrets', () => {
    for (const secret of ['x', 'ключ-密钥-🔑', 'a'.repeat(4096)]) {
      expect(decryptSecret(encryptSecret(secret, ring, CONNECTION), ring, CONNECTION)).toBe(secret);
    }
  });
});

describe('SecretBox: tampering and copying', () => {
  it('rejects a changed ciphertext, IV or key id', () => {
    const [version, keyId, iv, data] = encryptSecret('secret', ring, CONNECTION).split('.');
    const flip = (text = '') => `${text[0] === 'A' ? 'B' : 'A'}${text.slice(1)}`;

    for (const forged of [
      [version, keyId, iv, flip(data)],
      [version, keyId, flip(iv), data],
    ]) {
      expect(failureOf(() => decryptSecret(forged.join('.'), ring, CONNECTION)).code).toBe(
        SECRET_BOX_ERROR.TAMPERED
      );
    }
  });

  it('rejects a ciphertext copied into another connection', () => {
    const stored = encryptSecret('secret', ring, CONNECTION);

    expect(failureOf(() => decryptSecret(stored, ring, randomUUID())).code).toBe(
      SECRET_BOX_ERROR.TAMPERED
    );
  });

  it('rejects a key id that is not in the key ring', () => {
    const stored = encryptSecret('secret', ring, CONNECTION);
    const other = parseKeyring([keyEntry('k2', 2)]);

    expect(failureOf(() => decryptSecret(stored, other, CONNECTION)).code).toBe(
      SECRET_BOX_ERROR.UNKNOWN_KEY
    );
  });

  it('treats a key id swapped inside the stored value as tampering, not as another key', () => {
    const both = parseKeyring([keyEntry('k1', 1), keyEntry('k2', 2)]);
    const [version, , iv, data] = encryptSecret('secret', both, CONNECTION).split('.');

    expect(failureOf(() => decryptSecret([version, 'k2', iv, data].join('.'), both, CONNECTION)).code).toBe(
      SECRET_BOX_ERROR.TAMPERED
    );
  });

  it.each(['', 'plain text', 'v1.k1.iv', 'v2.k1.AAAAAAAAAAAAAAAA.AAAA', 'v1.k1..AAAA', 'v1.k1.AAAAAAAAAAAAAAAA.'])(
    'rejects the malformed value %j',
    (stored) => {
      expect(failureOf(() => decryptSecret(stored, ring, CONNECTION)).code).toBe(
        SECRET_BOX_ERROR.MALFORMED
      );
    }
  );

  it('never puts the secret or the stored value into an error message', () => {
    const stored = encryptSecret('sk-provider-secret', ring, CONNECTION);
    const error = failureOf(() => decryptSecret(stored, ring, randomUUID()));

    expect(error.message).not.toContain('sk-provider-secret');
    expect(error.message).not.toContain(stored);
  });
});

describe('SecretBox: key rotation', () => {
  it('encrypts with the first key and still reads values of older keys', () => {
    const old = parseKeyring([keyEntry('old', 1)]);
    const rotated = parseKeyring([keyEntry('new', 2), keyEntry('old', 1)]);
    const legacy = encryptSecret('secret', old, CONNECTION);

    expect(decryptSecret(legacy, rotated, CONNECTION)).toBe('secret');
    expect(encryptSecret('secret', rotated, CONNECTION)).toMatch(/^v1\.new\./);
  });
});

describe('parseKeyring', () => {
  it('rejects a duplicate key id and a key of the wrong length', () => {
    expect(() => parseKeyring([keyEntry('k', 1), keyEntry('k', 2)])).toThrow(/duplicate/i);
    expect(() => parseKeyring([`k:${Buffer.alloc(16).toString('base64')}`])).toThrow(/32 bytes/);
  });

  it('rejects an empty list', () => {
    expect(() => parseKeyring([])).toThrow(/at least one/i);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/models/secret-box.spec.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implementieren**

`apps/api/src/models/secret-box.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export const SECRET_BOX_ERROR = {
  MALFORMED: 'malformed',
  UNKNOWN_KEY: 'unknown_key',
  TAMPERED: 'tampered',
} as const;

export type SecretBoxErrorCode = (typeof SECRET_BOX_ERROR)[keyof typeof SECRET_BOX_ERROR];

/** The message names the problem, never the secret or the stored value. */
export class SecretBoxError extends Error {
  constructor(
    readonly code: SecretBoxErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

export interface KeyringEntry {
  keyId: string;
  key: Buffer;
}

export interface Keyring {
  /** Encrypts new values. */
  current: KeyringEntry;
  /** Decrypts every value, including those of older keys. */
  byId: ReadonlyMap<string, Buffer>;
}

/** Entries are `keyId:base64(32 bytes)`; the first one is the current key. */
export function parseKeyring(entries: readonly string[]): Keyring {
  const byId = new Map<string, Buffer>();
  let current: KeyringEntry | undefined;
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    const keyId = entry.slice(0, separator);
    const key = Buffer.from(entry.slice(separator + 1), 'base64');
    if (separator <= 0 || key.length !== KEY_BYTES) {
      throw new Error('Encryption keys must look like keyId:base64 and hold 32 bytes');
    }
    if (byId.has(keyId)) throw new Error(`Duplicate encryption key id "${keyId}"`);
    byId.set(keyId, key);
    current ??= { keyId, key };
  }
  if (current === undefined) throw new Error('At least one encryption key is required');
  return { current, byId };
}

/** Binds the ciphertext to its key and its row: a copy in another connection fails the tag check. */
function additionalData(keyId: string, connectionId: string): Buffer {
  return Buffer.from(`${VERSION}:${keyId}:${connectionId}`, 'utf8');
}

export function encryptSecret(plaintext: string, keyring: Keyring, connectionId: string): string {
  const { keyId, key } = keyring.current;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(additionalData(keyId, connectionId));
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return [VERSION, keyId, iv.toString('base64url'), sealed.toString('base64url')].join('.');
}

export function decryptSecret(stored: string, keyring: Keyring, connectionId: string): string {
  const [version, keyId, ivText, sealedText, ...rest] = stored.split('.');
  if (
    version !== VERSION ||
    keyId === undefined ||
    ivText === undefined ||
    sealedText === undefined ||
    rest.length > 0
  ) {
    throw new SecretBoxError(SECRET_BOX_ERROR.MALFORMED, 'Stored secret has an unknown format');
  }
  const key = keyring.byId.get(keyId);
  if (key === undefined) {
    throw new SecretBoxError(SECRET_BOX_ERROR.UNKNOWN_KEY, 'No encryption key for the stored secret');
  }
  const iv = Buffer.from(ivText, 'base64url');
  const sealed = Buffer.from(sealedText, 'base64url');
  if (iv.length !== IV_BYTES || sealed.length <= TAG_BYTES) {
    throw new SecretBoxError(SECRET_BOX_ERROR.MALFORMED, 'Stored secret has an unknown format');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(additionalData(keyId, connectionId));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(sealed.subarray(0, sealed.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // The library error carries no secret, but it also says nothing a caller could act on.
    throw new SecretBoxError(SECRET_BOX_ERROR.TAMPERED, 'Stored secret failed verification');
  }
}

@Injectable()
export class SecretBox {
  private readonly keyring: Keyring;

  constructor(config: ConfigService<Env, true>) {
    // Fails at start-up when the configured keys are unusable (duplicate ids), not at the first request.
    this.keyring = parseKeyring(config.get('PROVIDER_KEY_ENCRYPTION_KEYS', { infer: true }));
  }

  encrypt(plaintext: string, connectionId: string): string {
    return encryptSecret(plaintext, this.keyring, connectionId);
  }

  decrypt(stored: string, connectionId: string): string {
    return decryptSecret(stored, this.keyring, connectionId);
  }
}
```

- [ ] **Step 4: Test laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/models/secret-box.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/models/secret-box.ts apps/api/src/models/secret-box.spec.ts
git commit -m "feat(api): add SecretBox for provider keys (AES-256-GCM)" -m "Random IV per value, key id and connection id as authenticated data, key ring with the newest key first for rotation." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Mutation prüfen**

In `secret-box.ts` die beiden Zeilen `…setAAD(additionalData(keyId, connectionId));` auskommentieren und `pnpm --filter @owui/api exec vitest run src/models/secret-box.spec.ts` laufen lassen.
Expected: „rejects a ciphertext copied into another connection“ wird rot. Danach mit `git checkout -- apps/api/src/models/secret-box.ts` zurücksetzen und den Test erneut grün sehen. Kein Commit.

---

### Task 4: Reine Bausteine: Adressrichtlinie, Modell-ID, Basis-URL

**Files:**
- Modify: `apps/api/src/http/safe-fetch/address-policy.ts`
- Create: `apps/api/src/http/safe-fetch/address-policy.spec.ts`, `apps/api/src/models/model-id.ts`, `apps/api/src/models/model-id.spec.ts`, `apps/api/src/models/base-url.ts`, `apps/api/src/models/base-url.spec.ts`

**Interfaces:**
- Produces:
  - `interface AllowedHost { hostname: string; port: number | undefined }`; `canonicalHost(host: string): string`; `parseAllowedHost(entry: string): AllowedHost`; `isAllowedHost(allowed: readonly AllowedHost[], hostname: string, port: number): boolean`; `effectivePort(url: URL): number`; `isProviderAddressAllowed(address: string, hostIsAllowed: boolean): boolean`.
  - `formatModelId(connectionId: string, rawModelId: string): string`; `parseModelId(id: string): { connectionId: string; rawModelId: string } | undefined` (`undefined` für jede ungültige ID).
  - `normalizeBaseUrl(raw: string): string` (wirft `InvalidBaseUrlError` mit `problem` aus `BASE_URL_PROBLEM`: `INVALID`, `SCHEME`, `CREDENTIALS`, `QUERY`).

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`apps/api/src/http/safe-fetch/address-policy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_HOST_PATTERN,
  canonicalHost,
  effectivePort,
  isAllowedHost,
  isProviderAddressAllowed,
  parseAllowedHost,
} from './address-policy.js';

describe('isProviderAddressAllowed', () => {
  it.each([
    ['93.184.216.34', false, true],
    ['2606:2800:220:1:248:1893:25c8:1946', false, true],
    ['10.0.0.5', false, false],
    ['172.16.0.1', false, false],
    ['192.168.1.10', false, false],
    ['127.0.0.1', false, false],
    ['100.64.0.1', false, false],
    ['::1', false, false],
    ['fd00::1', false, false],
    ['::ffff:127.0.0.1', false, false],
    ['::ffff:10.0.0.5', false, false],
    ['10.0.0.5', true, true],
    ['192.168.1.10', true, true],
    ['127.0.0.1', true, true],
    ['::1', true, true],
    ['fd00::1', true, true],
    ['::ffff:10.0.0.5', true, true],
  ])('address %s, host on the list: %s -> %s', (address, listed, expected) => {
    expect(isProviderAddressAllowed(address, listed)).toBe(expected);
  });

  it.each([
    '169.254.169.254',
    '169.254.0.1',
    '::ffff:169.254.169.254',
    'fe80::1',
    '0.0.0.0',
    '0.1.2.3',
    '::',
    '224.0.0.1',
    'ff02::1',
    '255.255.255.255',
  ])('never allows %s, not even for a host on the list', (address) => {
    expect(isProviderAddressAllowed(address, true)).toBe(false);
    expect(isProviderAddressAllowed(address, false)).toBe(false);
  });

  it.each(['', 'not-an-ip', '999.1.1.1', '1.2.3'])('refuses the non-address %j', (address) => {
    expect(isProviderAddressAllowed(address, true)).toBe(false);
  });
});

describe('allowed hosts', () => {
  const allowed = ['ollama', 'Host.Docker.Internal', 'localhost:11434', '[::1]:11434', '10.0.0.7'].map(
    parseAllowedHost
  );

  it('matches a host without port on every port, case-insensitively', () => {
    expect(isAllowedHost(allowed, 'ollama', 11434)).toBe(true);
    expect(isAllowedHost(allowed, 'ollama', 80)).toBe(true);
    expect(isAllowedHost(allowed, 'host.docker.internal', 8000)).toBe(true);
    expect(isAllowedHost(allowed, 'OLLAMA', 1)).toBe(true);
  });

  it('matches host:port only on that port', () => {
    expect(isAllowedHost(allowed, 'localhost', 11434)).toBe(true);
    expect(isAllowedHost(allowed, 'localhost', 11435)).toBe(false);
  });

  it('compares IP literals in one canonical spelling', () => {
    expect(isAllowedHost(allowed, '::1', 11434)).toBe(true);
    expect(isAllowedHost(allowed, '[::1]', 11434)).toBe(true);
    expect(isAllowedHost(allowed, '0:0:0:0:0:0:0:1', 11434)).toBe(true);
    expect(isAllowedHost(allowed, '10.0.0.7', 1234)).toBe(true);
  });

  it('does not match a name that merely contains an entry', () => {
    expect(isAllowedHost(allowed, 'ollama.evil.test', 11434)).toBe(false);
    expect(isAllowedHost(allowed, 'evil-ollama', 11434)).toBe(false);
    expect(isAllowedHost([], 'ollama', 11434)).toBe(false);
  });

  it('picks the effective port of a URL', () => {
    expect(effectivePort(new URL('http://a.test'))).toBe(80);
    expect(effectivePort(new URL('https://a.test'))).toBe(443);
    expect(effectivePort(new URL('http://a.test:8080'))).toBe(8080);
    expect(effectivePort(new URL('http://a.test:80'))).toBe(80);
  });

  it('canonicalizes hosts', () => {
    expect(canonicalHost('Example.COM')).toBe('example.com');
    expect(canonicalHost('[::1]')).toBe('0:0:0:0:0:0:0:1');
  });

  it.each(['ollama', 'ollama:11434', '[::1]', '[::1]:11434', 'a.b-c.d:1', '10.0.0.1:65535'])(
    'accepts %s as an entry',
    (entry) => {
      expect(ALLOWED_HOST_PATTERN.test(entry)).toBe(true);
    }
  );

  it.each(['', 'http://ollama', 'ollama/path', '*.example.com', 'a b', 'ollama:0', 'ollama:65536', '-ollama', 'ollama:'])(
    'rejects %j as an entry',
    (entry) => {
      expect(ALLOWED_HOST_PATTERN.test(entry)).toBe(false);
    }
  );
});
```

`apps/api/src/models/model-id.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { formatModelId, parseModelId } from './model-id.js';

const CONNECTION = randomUUID();

describe('model ids', () => {
  it.each(['gpt-4o', 'llama3:8b', 'hf.co/acme/model:Q4_K_M', 'mistral:7b-instruct-v0.3-q4_0', 'a:b:c'])(
    'round-trips %s (split at the first colon only)',
    (raw) => {
      const id = formatModelId(CONNECTION, raw);

      expect(id).toBe(`${CONNECTION}:${raw}`);
      expect(parseModelId(id)).toEqual({ connectionId: CONNECTION, rawModelId: raw });
    }
  );

  it.each([
    ['empty', ''],
    ['no colon', CONNECTION],
    ['nothing after the colon', `${CONNECTION}:`],
    ['no connection', ':llama3'],
    ['connection is not a uuid', 'prod:llama3'],
    ['uuid with trailing text', `${CONNECTION}x:llama3`],
    ['control character', `${CONNECTION}:llama\n3`],
    ['too long', `${CONNECTION}:${'a'.repeat(600)}`],
  ])('rejects an id with %s', (_name, id) => {
    expect(parseModelId(id)).toBeUndefined();
  });

  it('accepts an upper-case connection id', () => {
    expect(parseModelId(`${CONNECTION.toUpperCase()}:m`)?.rawModelId).toBe('m');
  });
});
```

`apps/api/src/models/base-url.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { BASE_URL_PROBLEM, InvalidBaseUrlError, normalizeBaseUrl } from './base-url.js';

function problemOf(raw: string): string | undefined {
  try {
    normalizeBaseUrl(raw);
  } catch (error) {
    if (error instanceof InvalidBaseUrlError) return error.problem;
    throw error;
  }
  return undefined;
}

describe('normalizeBaseUrl', () => {
  it.each([
    ['http://localhost:11434', 'http://localhost:11434'],
    ['http://localhost:11434/', 'http://localhost:11434'],
    ['HTTP://Ollama.Local:11434//', 'http://ollama.local:11434'],
    ['  https://api.example.com/v1/  ', 'https://api.example.com/v1'],
    ['https://api.example.com/v1', 'https://api.example.com/v1'],
    ['https://api.example.com:443/v1', 'https://api.example.com/v1'],
    ['http://[::1]:11434/', 'http://[::1]:11434'],
    ['http://10.0.0.5/api?', 'http://10.0.0.5/api'],
  ])('turns %j into %j', (raw, expected) => {
    expect(normalizeBaseUrl(raw)).toBe(expected);
  });

  it.each([
    ['', BASE_URL_PROBLEM.INVALID],
    ['   ', BASE_URL_PROBLEM.INVALID],
    ['not a url', BASE_URL_PROBLEM.INVALID],
    ['//host/v1', BASE_URL_PROBLEM.INVALID],
    ['localhost:11434', BASE_URL_PROBLEM.SCHEME],
    ['ftp://host', BASE_URL_PROBLEM.SCHEME],
    ['file:///etc/passwd', BASE_URL_PROBLEM.SCHEME],
    ['javascript:alert(1)', BASE_URL_PROBLEM.SCHEME],
    ['http://user:pass@host', BASE_URL_PROBLEM.CREDENTIALS],
    ['http://user@host', BASE_URL_PROBLEM.CREDENTIALS],
    ['https://host/v1?token=abc', BASE_URL_PROBLEM.QUERY],
    ['https://host/v1#frag', BASE_URL_PROBLEM.QUERY],
  ])('rejects %j (%s)', (raw, problem) => {
    expect(problemOf(raw)).toBe(problem);
  });

  it('never repeats the rejected input in the message', () => {
    expect(() => normalizeBaseUrl('http://user:hunter2@host')).not.toThrow(/hunter2/);
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/http/safe-fetch/address-policy.spec.ts src/models/model-id.spec.ts src/models/base-url.spec.ts`
Expected: FAIL (Funktionen fehlen).

- [ ] **Step 3: Implementieren**

`apps/api/src/http/safe-fetch/address-policy.ts` ersetzen durch:

```ts
import ipaddr from 'ipaddr.js';

const PORT = '(6553[0-5]|655[0-2][0-9]|65[0-4][0-9]{2}|6[0-4][0-9]{3}|[1-5][0-9]{4}|[1-9][0-9]{0,3})';

/** `host`, `host:port`, `[v6]` or `[v6]:port` (a path, wildcard or scheme is not an allow-list entry). */
export const ALLOWED_HOST_PATTERN = new RegExp(
  `^(\\[[0-9a-fA-F:.]+\\]|[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)(:${PORT})?$`
);

export interface AllowedHost {
  hostname: string;
  /** Without a port the entry matches every port. */
  port: number | undefined;
}

/** Lower-case; IP literals in one spelling, so "::1" and "0:0:0:0:0:0:0:1" compare equal. */
export function canonicalHost(host: string): string {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  return ipaddr.isValid(bare) ? ipaddr.parse(bare).toNormalizedString() : bare;
}

/** Entries are validated by ALLOWED_HOST_PATTERN in env.ts before they get here. */
export function parseAllowedHost(entry: string): AllowedHost {
  const match = /^(\[[^\]]+\]|[^:]+)(?::([0-9]+))?$/.exec(entry.trim());
  const host = match?.[1];
  if (host === undefined) throw new Error('Not a host or host:port entry');
  const port = match?.[2];
  return { hostname: canonicalHost(host), port: port === undefined ? undefined : Number(port) };
}

export function isAllowedHost(
  allowed: readonly AllowedHost[],
  hostname: string,
  port: number
): boolean {
  const host = canonicalHost(hostname);
  return allowed.some((entry) => entry.hostname === host && (entry.port === undefined || entry.port === port));
}

/** WHATWG URL drops default ports, so `url.port` is empty for http://host and https://host. */
export function effectivePort(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/** Never reachable for a provider, even when the admin listed the host: metadata, link-local, wildcard, multicast. */
const NEVER_ALLOWED_RANGES = new Set(['linkLocal', 'unspecified', 'broadcast', 'multicast']);

/**
 * Judges one resolved address. A host the admin put on PROVIDER_ALLOWED_HOSTS may be private or loopback; every
 * other host must resolve to public addresses only. IPv4-mapped IPv6 addresses count as the IPv4 address inside.
 */
export function isProviderAddressAllowed(address: string, hostIsAllowed: boolean): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  const effective =
    parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      ? (parsed as ipaddr.IPv6).toIPv4Address()
      : parsed;
  const range = effective.range();
  if (NEVER_ALLOWED_RANGES.has(range)) return false;
  return hostIsAllowed || range === 'unicast';
}
```

`apps/api/src/models/model-id.ts`:

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const RAW_MODEL_ID_MAX_LENGTH = 512;

export interface ParsedModelId {
  connectionId: string;
  rawModelId: string;
}

/** The id the outside world sees: `<connectionId>:<rawModelId>`. */
export function formatModelId(connectionId: string, rawModelId: string): string {
  return `${connectionId}:${rawModelId}`;
}

/**
 * Splits at the FIRST colon: the connection id is a UUID and has none, while raw ids do (`llama3:8b`).
 * Returns undefined for anything that is not such an id; callers answer 404.
 */
export function parseModelId(id: string): ParsedModelId | undefined {
  const separator = id.indexOf(':');
  if (separator <= 0) return undefined;
  const connectionId = id.slice(0, separator);
  const rawModelId = id.slice(separator + 1);
  if (!UUID.test(connectionId)) return undefined;
  if (rawModelId === '' || rawModelId.length > RAW_MODEL_ID_MAX_LENGTH) return undefined;
  if (CONTROL_CHARACTERS.test(rawModelId)) return undefined;
  return { connectionId, rawModelId };
}
```

`apps/api/src/models/base-url.ts`:

```ts
export const BASE_URL_PROBLEM = {
  INVALID: 'invalid',
  SCHEME: 'scheme',
  CREDENTIALS: 'credentials',
  QUERY: 'query',
} as const;

export type BaseUrlProblem = (typeof BASE_URL_PROBLEM)[keyof typeof BASE_URL_PROBLEM];

/** The message never contains the rejected input (it may carry credentials). */
export class InvalidBaseUrlError extends Error {
  constructor(
    readonly problem: BaseUrlProblem,
    message: string
  ) {
    super(message);
    this.name = 'InvalidBaseUrlError';
  }
}

/** http(s) only, no credentials, no query or fragment; scheme and host lower-case, no trailing slash. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new InvalidBaseUrlError(BASE_URL_PROBLEM.INVALID, 'The address is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidBaseUrlError(BASE_URL_PROBLEM.SCHEME, 'The address must start with http:// or https://');
  }
  if (url.username !== '' || url.password !== '') {
    throw new InvalidBaseUrlError(BASE_URL_PROBLEM.CREDENTIALS, 'The address must not contain credentials');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new InvalidBaseUrlError(BASE_URL_PROBLEM.QUERY, 'The address must not contain a query or fragment');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/http/safe-fetch/address-policy.spec.ts src/models/model-id.spec.ts src/models/base-url.spec.ts src/config/env.spec.ts`
Expected: PASS (`env.spec.ts` prüft das jetzt strengere Port-Muster mit; `ollama:0` und `ollama:65536` fehlen dort, sind aber hier abgedeckt).

Prüfen, ob `ipaddr.parse(...).range()` für `0.1.2.3` wirklich `unspecified` ist (ipaddr.js: `0.0.0.0/8`) und für `100.64.0.1` `carrierGradeNat`; ist ein erwarteter Wert in der Tabelle falsch, den **Test** nach dem tatsächlichen Verhalten von ipaddr.js nur dann ändern, wenn die Richtung (erlaubt/verboten) gleich bleibt; sonst die Richtlinie anpassen.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/http/safe-fetch apps/api/src/models/model-id.ts apps/api/src/models/model-id.spec.ts apps/api/src/models/base-url.ts apps/api/src/models/base-url.spec.ts
git commit -m "feat(api): add address policy, model id and base URL helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Fake-Anbieter und `ProviderFetchService`

**Files:**
- Create: `apps/api/src/testing/fake-provider.ts`, `apps/api/src/http/safe-fetch/provider-fetch.service.ts`, `apps/api/src/http/safe-fetch/provider-fetch.service.spec.ts`
- Modify: `apps/api/src/http/safe-fetch/safe-fetch.module.ts`, `eslint.config.mjs`

**Interfaces:**
- Consumes: `AllowedHost`, `canonicalHost`, `effectivePort`, `isAllowedHost`, `isProviderAddressAllowed`, `parseAllowedHost` (Task 4); `ProviderError`, `PROVIDER_ERROR` (Task 2); Env `PROVIDER_REQUEST_TIMEOUT_MS`, `PROVIDER_ALLOWED_HOSTS` (Task 2).
- Produces:
  - `PROVIDER_FETCH_OPTIONS` (Symbol), `interface ProviderFetchOptions { timeoutMs: number; maxJsonBytes: number; allowedHosts: readonly AllowedHost[]; lookup: (hostname: string) => Promise<LookupAddress[]> }`, `PROVIDER_FETCH_DEFAULTS` (`maxJsonBytes` 1 MiB, echtes DNS-`lookup`), `type ProviderFetch = typeof globalThis.fetch`.
  - `ProviderFetchService`: `createFetch(baseUrl: string): ProviderFetch`; `getJson(baseUrl: string, path: string, apiKey: string | undefined): Promise<unknown>`; `assertHostAllowed(baseUrl: string): Promise<void>`. Alle werfen `ProviderError`.
  - `FakeProvider` (Test-Hilfe): `static start(): Promise<FakeProvider>`, Felder `url`, `port`, `requests: FakeRequest[]`, `mode: FakeMode`, `models: string[]`, `requiredKey: string | undefined`, `redirectTo: string`, `close(): Promise<void>`; `FAKE_MODE`.

- [ ] **Step 1: ESLint-Ausnahme für den Fake-Server**

Der Fake ist ein HTTP-**Server**, die Regel verbietet aber jeden Import von `node:http` in `apps/api/src`. In `eslint.config.mjs` den Block „The one place that is allowed to open outgoing connections“ erweitern:

```js
  {
    // The one place that is allowed to open outgoing connections, and the fake provider test server.
    files: ['apps/api/src/http/safe-fetch/**/*.ts', 'apps/api/src/testing/fake-provider.ts'],
```

- [ ] **Step 2: Fake-Anbieter schreiben**

`apps/api/src/testing/fake-provider.ts` (keine Aufzählungen und keine Parameter-Properties: `scripts/fake-provider.mjs` lädt die Datei später direkt mit Nodes Typ-Entfernung):

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export const FAKE_MODE = {
  OK: 'ok',
  UNAUTHORIZED: 'unauthorized',
  SERVER_ERROR: 'server_error',
  REDIRECT: 'redirect',
  HANG: 'hang',
  HTML: 'html',
  GARBAGE: 'garbage',
  WRONG_SHAPE: 'wrong_shape',
  OVERSIZED: 'oversized',
  OVERSIZED_STREAM: 'oversized_stream',
} as const;

export type FakeMode = (typeof FAKE_MODE)[keyof typeof FAKE_MODE];

export interface FakeRequest {
  method: string;
  path: string;
  host: string | undefined;
  authorization: string | undefined;
  body: string;
}

const OVERSIZED_BYTES = 4096;

function completion(model: string): string {
  return JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion',
    created: 1,
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function chunk(model: string, delta: object, finish: string | null): string {
  const payload = {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * A model provider for tests and hand checks: Ollama (`/api/tags`) and OpenAI format (`/v1/models`,
 * `/v1/chat/completions`, also as a stream). `mode` switches every answer to one kind of failure.
 */
export class FakeProvider {
  mode: FakeMode = FAKE_MODE.OK;
  models: string[] = ['llama3:8b', 'mistral:7b'];
  requiredKey: string | undefined = undefined;
  redirectTo = 'http://127.0.0.1:1/elsewhere';
  readonly requests: FakeRequest[] = [];
  readonly url: string;
  readonly port: number;
  private readonly server: Server;

  private constructor(server: Server, port: number) {
    this.server = server;
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
  }

  static async start(port = 0, host = '127.0.0.1'): Promise<FakeProvider> {
    let instance: FakeProvider | undefined;
    const server = createServer((request, response) => {
      instance?.handle(request, response);
    });
    await new Promise<void>((resolve) => {
      server.listen(port, host, resolve);
    });
    instance = new FakeProvider(server, (server.address() as AddressInfo).port);
    return instance;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.closeAllConnections();
      this.server.close(() => {
        resolve();
      });
    });
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on('data', (piece: Buffer) => chunks.push(piece));
    request.on('end', () => {
      const path = (request.url ?? '/').split('?')[0] ?? '/';
      const body = Buffer.concat(chunks).toString('utf8');
      this.requests.push({
        method: request.method ?? 'GET',
        path,
        host: request.headers.host,
        authorization: request.headers.authorization,
        body,
      });
      this.answer(request.method ?? 'GET', path, request.headers.authorization, body, response);
    });
  }

  private answer(
    method: string,
    path: string,
    authorization: string | undefined,
    body: string,
    response: ServerResponse
  ): void {
    const json = (status: number, payload: string, extra: Record<string, string> = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...extra });
      response.end(payload);
    };

    if (this.mode === FAKE_MODE.HANG) return;
    if (this.mode === FAKE_MODE.REDIRECT) {
      response.writeHead(302, { location: this.redirectTo });
      response.end();
      return;
    }
    if (this.mode === FAKE_MODE.HTML) {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><body>Sign in to continue</body></html>');
      return;
    }
    if (this.mode === FAKE_MODE.GARBAGE) return json(200, '{not json');
    if (this.mode === FAKE_MODE.WRONG_SHAPE) return json(200, '{"unexpected":true}');
    if (this.mode === FAKE_MODE.OVERSIZED) return json(200, `[${'1,'.repeat(OVERSIZED_BYTES / 2)}1]`);
    if (this.mode === FAKE_MODE.OVERSIZED_STREAM) {
      // No content-length: Node answers chunked, so only counting bytes can catch it.
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('[');
      for (let sent = 0; sent < OVERSIZED_BYTES * 2; sent += 512) response.write('1,'.repeat(256));
      response.end('1]');
      return;
    }
    if (this.mode === FAKE_MODE.SERVER_ERROR) return json(500, '{"error":"boom"}');
    if (
      this.mode === FAKE_MODE.UNAUTHORIZED ||
      (this.requiredKey !== undefined && authorization !== `Bearer ${this.requiredKey}`)
    ) {
      return json(401, '{"error":"invalid key"}');
    }

    if (method === 'GET' && path === '/api/tags') {
      const models = this.models.map((name) => ({
        name,
        model: name,
        modified_at: '2026-01-01T00:00:00Z',
        size: 1,
        digest: 'sha256:fake',
        details: { family: 'fake', parameter_size: '8B', quantization_level: 'Q4_0' },
      }));
      return json(200, JSON.stringify({ models }));
    }
    if (method === 'GET' && path === '/v1/models') {
      const data = this.models.map((id) => ({ id, object: 'model', created: 1, owned_by: 'fake' }));
      return json(200, JSON.stringify({ object: 'list', data }));
    }
    if (method === 'POST' && path === '/v1/chat/completions') {
      const parsed: unknown = JSON.parse(body);
      const requested = typeof parsed === 'object' && parsed !== null ? parsed : {};
      const model = 'model' in requested && typeof requested.model === 'string' ? requested.model : 'fake';
      if ('stream' in requested && requested.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(chunk(model, { role: 'assistant', content: 'pong' }, null));
        response.write(chunk(model, {}, 'stop'));
        response.end('data: [DONE]\n\n');
        return;
      }
      return json(200, completion(model));
    }
    return json(404, '{"error":"not found"}');
  }
}
```

- [ ] **Step 3: Fehlschlagende Tests schreiben**

`apps/api/src/http/safe-fetch/provider-fetch.service.spec.ts`:

```ts
import type { LookupAddress } from 'node:dns';
import { afterEach, describe, expect, it } from 'vitest';

import { FAKE_MODE, FakeProvider } from '../../testing/fake-provider.js';
import { parseAllowedHost } from './address-policy.js';
import { PROVIDER_ERROR, ProviderError, type ProviderErrorReason } from './provider-error.js';
import {
  PROVIDER_FETCH_DEFAULTS,
  ProviderFetchService,
  type ProviderFetchOptions,
} from './provider-fetch.service.js';

const providers: FakeProvider[] = [];

async function startProvider(): Promise<FakeProvider> {
  const provider = await FakeProvider.start();
  providers.push(provider);
  return provider;
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

function addresses(...list: string[]): LookupAddress[] {
  return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

function fakeLookup(table: Record<string, string[]>): ProviderFetchOptions['lookup'] {
  return (hostname) => {
    const found = table[hostname];
    return found === undefined ? Promise.reject(new Error('ENOTFOUND')) : Promise.resolve(addresses(...found));
  };
}

/** Test servers listen on loopback, so the tests list exactly that host. */
function service(overrides: Partial<ProviderFetchOptions> = {}): ProviderFetchService {
  return new ProviderFetchService({
    ...PROVIDER_FETCH_DEFAULTS,
    timeoutMs: 1000,
    maxJsonBytes: 1024,
    allowedHosts: ['127.0.0.1', 'models.test'].map(parseAllowedHost),
    lookup: fakeLookup({ 'models.test': ['127.0.0.1'] }),
    ...overrides,
  });
}

async function reasonOf(promise: Promise<unknown>): Promise<ProviderErrorReason | 'resolved'> {
  const outcome = await promise.then(
    () => undefined,
    (error: unknown) => error
  );
  if (outcome === undefined) return 'resolved';
  if (!(outcome instanceof ProviderError)) throw outcome;
  return outcome.reason;
}

describe('ProviderFetchService: reading a list', () => {
  it('returns the parsed JSON of an allowed host', async () => {
    const provider = await startProvider();

    const json = await service().getJson(provider.url, '/api/tags', undefined);

    expect(json).toMatchObject({ models: [{ name: 'llama3:8b' }, { name: 'mistral:7b' }] });
  });

  it('sends the key as a Bearer token, and no header without a key', async () => {
    const provider = await startProvider();
    provider.requiredKey = 'sk-secret';

    await service().getJson(provider.url, '/v1/models', 'sk-secret');
    expect(provider.requests.at(-1)?.authorization).toBe('Bearer sk-secret');

    expect(await reasonOf(service().getJson(provider.url, '/v1/models', undefined))).toBe(
      PROVIDER_ERROR.UNAUTHORIZED
    );
    expect(await reasonOf(service().getJson(provider.url, '/v1/models', 'sk-wrong'))).toBe(
      PROVIDER_ERROR.UNAUTHORIZED
    );
  });
});

describe('ProviderFetchService: which hosts may be reached', () => {
  it('refuses a loopback host that is not on the list, without connecting', async () => {
    const provider = await startProvider();

    const reason = await reasonOf(service({ allowedHosts: [] }).getJson(provider.url, '/api/tags', undefined));

    expect(reason).toBe(PROVIDER_ERROR.BLOCKED_HOST);
    expect(provider.requests).toHaveLength(0);
  });

  it('lets a listed host:port through only on that port', async () => {
    const provider = await startProvider();
    const wrongPort = [parseAllowedHost(`127.0.0.1:${provider.port + 1}`)];
    const rightPort = [parseAllowedHost(`127.0.0.1:${provider.port}`)];

    expect(await reasonOf(service({ allowedHosts: wrongPort }).getJson(provider.url, '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.BLOCKED_HOST
    );
    expect(await reasonOf(service({ allowedHosts: rightPort }).getJson(provider.url, '/api/tags', undefined))).toBe(
      'resolved'
    );
  });

  it.each(['169.254.169.254', '[fe80::1]', '0.0.0.0', '[::ffff:169.254.169.254]'])(
    'never reaches %s, even when it is on the list',
    async (host) => {
      const listed = service({ allowedHosts: [parseAllowedHost(host)] });

      expect(await reasonOf(listed.getJson(`http://${host}`, '/latest/meta-data', undefined))).toBe(
        PROVIDER_ERROR.BLOCKED_HOST
      );
    }
  );

  it('checks every address a name resolves to', async () => {
    const mixed = service({
      allowedHosts: [],
      lookup: fakeLookup({ 'mixed.test': ['93.184.216.34', '10.0.0.5'] }),
    });

    expect(await reasonOf(mixed.getJson('http://mixed.test', '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.BLOCKED_HOST
    );
  });

  it('checks again on every call, not only when the connection was saved', async () => {
    const provider = await startProvider();
    const answers = [['127.0.0.1'], ['169.254.169.254']];
    const rebinding = service({
      lookup: () => Promise.resolve(addresses(...(answers.shift() ?? []))),
    });
    const base = `http://models.test:${provider.port}`;

    expect(await reasonOf(rebinding.getJson(base, '/api/tags', undefined))).toBe('resolved');
    expect(await reasonOf(rebinding.getJson(base, '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.BLOCKED_HOST
    );
    expect(provider.requests).toHaveLength(1);
  });

  it('resolves the name once per call and connects to the address it validated', async () => {
    const provider = await startProvider();
    let lookups = 0;
    const counting = service({
      lookup: (hostname) => {
        lookups += 1;
        return fakeLookup({ 'models.test': ['127.0.0.1'] })(hostname);
      },
    });

    await counting.getJson(`http://models.test:${provider.port}`, '/api/tags', undefined);

    expect(lookups).toBe(1);
    expect(provider.requests[0]?.host).toBe(`models.test:${provider.port}`);
  });

  it('assertHostAllowed accepts a good host and refuses a bad or unknown one', async () => {
    const provider = await startProvider();

    await expect(service().assertHostAllowed(provider.url)).resolves.toBeUndefined();
    expect(await reasonOf(service({ allowedHosts: [] }).assertHostAllowed(provider.url))).toBe(
      PROVIDER_ERROR.BLOCKED_HOST
    );
    expect(await reasonOf(service().assertHostAllowed('http://unknown.test'))).toBe(
      PROVIDER_ERROR.UNREACHABLE
    );
  });
});

describe('ProviderFetchService: redirects and origin', () => {
  it('treats a redirect as an error and never follows it (the key stays with the connection host)', async () => {
    const provider = await startProvider();
    const elsewhere = await startProvider();
    provider.mode = FAKE_MODE.REDIRECT;
    provider.redirectTo = `${elsewhere.url}/api/tags`;

    const reason = await reasonOf(service().getJson(provider.url, '/api/tags', 'sk-secret'));

    expect(reason).toBe(PROVIDER_ERROR.BAD_RESPONSE);
    expect(elsewhere.requests).toHaveLength(0);
  });

  it('refuses a target on another origin than the connection', async () => {
    const provider = await startProvider();
    const fetchForConnection = service().createFetch(provider.url);

    for (const target of [
      'http://127.0.0.1:1/x',
      `https://127.0.0.1:${provider.port}/x`,
      'http://models.test/x',
    ]) {
      expect(await reasonOf(fetchForConnection(target))).toBe(PROVIDER_ERROR.BLOCKED_HOST);
    }
    expect(provider.requests).toHaveLength(0);
  });

  it('accepts URLs only, not Request objects', async () => {
    const provider = await startProvider();
    const fetchForConnection = service().createFetch(provider.url);

    await expect(fetchForConnection(new Request(`${provider.url}/api/tags`))).rejects.toThrow(TypeError);
  });
});

describe('ProviderFetchService: answers it does not trust', () => {
  it.each([
    [FAKE_MODE.UNAUTHORIZED, PROVIDER_ERROR.UNAUTHORIZED],
    [FAKE_MODE.SERVER_ERROR, PROVIDER_ERROR.BAD_RESPONSE],
    [FAKE_MODE.HTML, PROVIDER_ERROR.BAD_RESPONSE],
    [FAKE_MODE.GARBAGE, PROVIDER_ERROR.BAD_RESPONSE],
    [FAKE_MODE.OVERSIZED, PROVIDER_ERROR.BAD_RESPONSE],
    [FAKE_MODE.OVERSIZED_STREAM, PROVIDER_ERROR.BAD_RESPONSE],
  ])('maps the provider mode %s to %s', async (mode, expected) => {
    const provider = await startProvider();
    provider.mode = mode;

    expect(await reasonOf(service().getJson(provider.url, '/api/tags', undefined))).toBe(expected);
  });

  it('gives up on a provider that never answers', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.HANG;
    const started = Date.now();

    const reason = await reasonOf(service({ timeoutMs: 300 }).getJson(provider.url, '/api/tags', undefined));

    expect(reason).toBe(PROVIDER_ERROR.TIMEOUT);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('reports a closed port as unreachable', async () => {
    const provider = await startProvider();
    await provider.close();

    expect(await reasonOf(service().getJson(provider.url, '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.UNREACHABLE
    );
  });

  it('reports a name that does not resolve as unreachable', async () => {
    const nowhere = service({ lookup: fakeLookup({}) });

    expect(await reasonOf(nowhere.getJson('http://nowhere.test', '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.UNREACHABLE
    );
    const empty = service({ lookup: () => Promise.resolve([]) });
    expect(await reasonOf(empty.getJson('http://empty.test', '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.UNREACHABLE
    );
  });

  it('never puts the key or the URL into an error message', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.UNAUTHORIZED;

    const error = await service()
      .getJson(`${provider.url}`, '/api/tags?secret=1', 'sk-secret')
      .then(
        () => undefined,
        (reason: unknown) => reason
      );

    expect(String((error as Error).message)).not.toMatch(/sk-secret|127\.0\.0\.1|secret=1/);
  });
});

describe('ProviderFetchService: streams for the chat', () => {
  it('passes a streamed answer through unchanged', async () => {
    const provider = await startProvider();
    const fetchForConnection = service().createFetch(provider.url);

    const response = await fetchForConnection(`${provider.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'llama3:8b', stream: true }),
    });
    const text = await response.text();

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('"content":"pong"');
    expect(text).toContain('data: [DONE]');
  });

  it('returns a non-streamed answer with its status', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.SERVER_ERROR;
    const fetchForConnection = service().createFetch(provider.url);

    const response = await fetchForConnection(`${provider.url}/v1/chat/completions`, { method: 'POST', body: '{}' });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'boom' });
  });
});
```

Der Test „never puts the key…“ nutzt `as Error`; das ist erlaubt (kein `as unknown as`), nimmt aber `error instanceof Error` vorweg. Besser, falls ESLint meckert: `expect(error).toBeInstanceOf(Error)` davor und dann `(error instanceof Error ? error.message : '')`.

- [ ] **Step 4: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/http/safe-fetch/provider-fetch.service.spec.ts`
Expected: FAIL (Modul `provider-fetch.service.js` fehlt).

- [ ] **Step 5: Implementieren**

`apps/api/src/http/safe-fetch/provider-fetch.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import ipaddr from 'ipaddr.js';
import { promises as dns, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from 'undici';

import {
  type AllowedHost,
  canonicalHost,
  effectivePort,
  isAllowedHost,
  isProviderAddressAllowed,
} from './address-policy.js';
import { PROVIDER_ERROR, ProviderError } from './provider-error.js';

export const PROVIDER_FETCH_OPTIONS = Symbol('PROVIDER_FETCH_OPTIONS');

export interface ProviderFetchOptions {
  /** Connect, first byte and gap between chunks; also the total budget of a list request. */
  timeoutMs: number;
  maxJsonBytes: number;
  allowedHosts: readonly AllowedHost[];
  lookup: (hostname: string) => Promise<LookupAddress[]>;
}

export const PROVIDER_FETCH_DEFAULTS = {
  maxJsonBytes: 1024 * 1024,
  lookup: (hostname: string) => dns.lookup(hostname, { all: true, verbatim: true }),
} satisfies Partial<ProviderFetchOptions>;

/** What `createOpenAICompatible({ fetch })` expects. */
export type ProviderFetch = typeof globalThis.fetch;

interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

const TIMEOUT_CODES = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'ETIMEDOUT',
]);

/** Makes the socket connect to the address we validated instead of resolving the name again. */
function pinnedLookup({ address, family }: PinnedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

/** undici wraps the real reason in `cause` ("fetch failed" -> ECONNREFUSED). */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    chain.push(current);
    current = 'cause' in current ? current.cause : undefined;
  }
  return chain;
}

function codeOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

/** A ProviderError stays, timeouts become TIMEOUT, a cancelled call stays as it is, everything else is UNREACHABLE. */
function providerFailure(error: unknown): unknown {
  if (error instanceof ProviderError) return error;
  const chain = causeChain(error);
  if (
    chain.some(
      (item) =>
        (item instanceof Error && item.name === 'TimeoutError') || TIMEOUT_CODES.has(codeOf(item))
    )
  ) {
    return new ProviderError(PROVIDER_ERROR.TIMEOUT, 'The provider did not answer in time');
  }
  if (chain.some((item) => item instanceof Error && item.name === 'AbortError')) return error;
  return new ProviderError(PROVIDER_ERROR.UNREACHABLE, 'The provider is not reachable');
}

/**
 * Hands the connection (one pinned agent per call) back once the body is read, cancelled or failed.
 * Streams are not buffered: the chat reads them chunk by chunk.
 */
function releaseAgentWithBody(upstream: UndiciResponse, agent: Agent): Response {
  const headers = Array.from(upstream.headers.entries());
  const init = { status: upstream.status, statusText: upstream.statusText, headers };
  if (upstream.body === null) {
    void agent.close();
    return new Response(null, init);
  }
  const reader = upstream.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          controller.close();
          await agent.close();
        } else {
          controller.enqueue(next.value);
        }
      } catch (error) {
        controller.error(error);
        await agent.destroy();
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await agent.destroy();
      }
    },
  });
  return new Response(body, init);
}

/**
 * The only way the API talks to a model provider (AGENTS.md rule 7). Per call: own DNS resolution, every resolved
 * address must pass the provider policy (private hosts only when listed in PROVIDER_ALLOWED_HOSTS; metadata and
 * link-local never), then the socket is pinned to that address. The target must have the origin of the connection,
 * and a redirect is an error, so a key never travels to another host.
 */
@Injectable()
export class ProviderFetchService {
  constructor(@Inject(PROVIDER_FETCH_OPTIONS) private readonly options: ProviderFetchOptions) {}

  /** Save-time check of a connection URL. Every later call checks again. */
  async assertHostAllowed(baseUrl: string): Promise<void> {
    await this.resolveAllowed(new URL(baseUrl));
  }

  /** A fetch that only reaches the origin of `baseUrl`; streams pass through. */
  createFetch(baseUrl: string): ProviderFetch {
    const origin = new URL(baseUrl).origin;
    const { timeoutMs } = this.options;
    return async (input, init) => {
      if (typeof input !== 'string' && !(input instanceof URL)) {
        throw new TypeError('The provider fetch accepts URLs only, not Request objects');
      }
      const target = new URL(input);
      if (target.origin !== origin) {
        throw new ProviderError(
          PROVIDER_ERROR.BLOCKED_HOST,
          'The target is not the host of the connection'
        );
      }
      const pinned = await this.resolveAllowed(target);
      const agent = new Agent({
        connect: { lookup: pinnedLookup(pinned), timeout: timeoutMs },
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });
      let upstream: UndiciResponse;
      try {
        upstream = await undiciFetch(target, { ...init, redirect: 'manual', dispatcher: agent });
      } catch (error) {
        await agent.destroy();
        throw providerFailure(error);
      }
      if ((upstream.status >= 300 && upstream.status < 400) || upstream.type === 'opaqueredirect') {
        await agent.destroy();
        throw new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answered with a redirect');
      }
      return releaseAgentWithBody(upstream, agent);
    };
  }

  /** GET `baseUrl + path` as JSON with a size limit, for the model lists. */
  async getJson(baseUrl: string, path: string, apiKey: string | undefined): Promise<unknown> {
    const { timeoutMs, maxJsonBytes } = this.options;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`;

    const response = await this.createFetch(baseUrl)(`${baseUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const rejection = this.rejectionFor(response);
    if (rejection !== undefined) {
      await response.body?.cancel();
      throw rejection;
    }
    const text = await this.readLimited(response, maxJsonBytes);
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      throw new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answer is not JSON');
    }
  }

  private rejectionFor(response: Response): ProviderError | undefined {
    if (response.status === 401 || response.status === 403) {
      return new ProviderError(PROVIDER_ERROR.UNAUTHORIZED, 'The provider refused the key');
    }
    if (!response.ok) {
      return new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answered with an error');
    }
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      return new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answer is not JSON');
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > this.options.maxJsonBytes) {
      return new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answer is too large');
    }
    return undefined;
  }

  private async readLimited(response: Response, maxBytes: number): Promise<string> {
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answer is empty');
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The provider answer is too large');
        }
        chunks.push(next.value);
      }
    } catch (error) {
      throw providerFailure(error);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  private async resolveAllowed(target: URL): Promise<PinnedAddress> {
    // WHATWG URL already turned 2130706433, 0x7f.1 and [::ffff:127.0.0.1] into canonical IP literals.
    const host = canonicalHost(target.hostname);
    const hostIsAllowed = isAllowedHost(this.options.allowedHosts, host, effectivePort(target));
    let addresses: LookupAddress[];
    if (ipaddr.isValid(host)) {
      addresses = [{ address: host, family: host.includes(':') ? 6 : 4 }];
    } else {
      try {
        addresses = await this.options.lookup(host);
      } catch {
        throw new ProviderError(PROVIDER_ERROR.UNREACHABLE, 'The host cannot be resolved');
      }
    }
    const first = addresses[0];
    if (first === undefined) {
      throw new ProviderError(PROVIDER_ERROR.UNREACHABLE, 'The host cannot be resolved');
    }
    // Every address must pass: the resolver may return a public and a private one.
    if (!addresses.every(({ address }) => isProviderAddressAllowed(address, hostIsAllowed))) {
      throw new ProviderError(PROVIDER_ERROR.BLOCKED_HOST, 'The host is not allowed');
    }
    return { address: first.address, family: first.family === 6 ? 6 : 4 };
  }
}
```

Hinweise:

- `canonicalHost` schreibt IPv6-Adressen in die ausgeschriebene Form (`0:0:0:0:0:0:0:1`); `net.connect` akzeptiert sie. Für IPv4-Literale bleibt der Punkt-Text.
- Meldet `tsc` Typkonflikte zwischen `RequestInit` (global) und dem `RequestInit` von `undici` in `undiciFetch(target, {...})`, die Felder einzeln übergeben (`method`, `headers`, `body`, `signal`) und, wenn nötig, `import type { RequestInit as UndiciRequestInit } from 'undici'` verwenden. **Nie** mit `as unknown as` umgehen.
- Antworten `undiciFetch` mit `redirect: 'manual'` für 3xx einen undurchsichtigen Redirect (`type === 'opaqueredirect'`, `status` 0) statt 3xx, fängt die zweite Bedingung ab; der Test „treats a redirect as an error“ beweist es.

`apps/api/src/http/safe-fetch/safe-fetch.module.ts` ersetzen durch:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env.js';
import { parseAllowedHost } from './address-policy.js';
import {
  PROVIDER_FETCH_DEFAULTS,
  PROVIDER_FETCH_OPTIONS,
  type ProviderFetchOptions,
  ProviderFetchService,
} from './provider-fetch.service.js';
import { SAFE_FETCH_DEFAULTS, SAFE_FETCH_OPTIONS, SafeFetchService } from './safe-fetch.service.js';

@Module({
  providers: [
    { provide: SAFE_FETCH_OPTIONS, useValue: SAFE_FETCH_DEFAULTS },
    SafeFetchService,
    {
      provide: PROVIDER_FETCH_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): ProviderFetchOptions => ({
        ...PROVIDER_FETCH_DEFAULTS,
        timeoutMs: config.get('PROVIDER_REQUEST_TIMEOUT_MS', { infer: true }),
        allowedHosts: config.get('PROVIDER_ALLOWED_HOSTS', { infer: true }).map(parseAllowedHost),
      }),
    },
    ProviderFetchService,
  ],
  exports: [SafeFetchService, ProviderFetchService],
})
export class SafeFetchModule {}
```

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/http/safe-fetch`
Expected: PASS. Hängt ein Test (Agent nicht geschlossen), `--reporter=verbose` und `closeAllConnections` im Fake prüfen; ein hängender Test ist ein Fehler im Dienst (Agent wird nicht freigegeben), kein Grund für größere Timeouts.

- [ ] **Step 7: Prüfen, Commit**

Run: `pnpm check`
Expected: PASS (Typen, ESLint inklusive der Import-Sperre für `undici`, Prettier, dependency-cruiser).

```bash
git add apps/api/src/testing/fake-provider.ts apps/api/src/http/safe-fetch eslint.config.mjs
git commit -m "feat(api): add ProviderFetchService for model provider calls" -m "Own DNS resolution and address check on every call, socket pinned to the checked address, origin of the connection fixed, redirects are errors, JSON lists with size limit and timeout, streams pass through. Private hosts only via PROVIDER_ALLOWED_HOSTS; metadata and link-local never. The fake provider is a test server, so its folder joins the http import exemption." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Mutation prüfen (Spec Abschnitt 8)**

Nacheinander, jeweils mit `git checkout -- apps/api/src/http/safe-fetch/provider-fetch.service.ts` zurücksetzen:

1. In `resolveAllowed` die Bedingung `!addresses.every(...)` durch `false` ersetzen. Expected: mindestens „refuses a loopback host that is not on the list“, „never reaches …“, „checks every address…“, „checks again on every call“ werden rot.
2. In `createFetch` den Vergleich `target.origin !== origin` durch `false` ersetzen. Expected: „refuses a target on another origin“ wird rot.
3. `redirect: 'manual'` durch `redirect: 'follow'` ersetzen. Expected: „treats a redirect as an error“ wird rot.

Alle drei Mutationen rot gesehen und zurückgesetzt, danach `pnpm --filter @owui/api exec vitest run src/http/safe-fetch` wieder grün. Kein Commit.

---

### Task 6: Entity und Migration `provider_connection`

**Files:**
- Create: `apps/api/src/models/provider-connection.entity.ts`, `apps/api/src/models/provider-connection.schema.db.spec.ts`, `apps/api/src/database/migrations/<timestamp>-add-provider-connections.ts` (generiert)
- Modify: `apps/api/src/database/entities.ts`, `apps/api/src/database/migrations/index.ts`, `apps/api/src/testing/db-fixtures.ts`

**Interfaces:**
- Consumes: `PROVIDER_TYPE`, `ProviderType` (Task 2).
- Produces: `ProviderConnection` mit `id: string`, `name: string`, `type: ProviderType`, `baseUrl: string`, `apiKeyCiphertext: string | null`, `enabled: boolean`, `hiddenModelIds: string[]`, `createdAt: Date`, `updatedAt: Date`; Tabelle `provider_connection`; `resetProviderTables(dataSource: DataSource): Promise<void>`.

- [ ] **Step 1: Entity schreiben**

`apps/api/src/models/provider-connection.entity.ts`:

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

import { PROVIDER_TYPE, type ProviderType } from './provider-type.js';

const TYPE_VALUES = Object.values(PROVIDER_TYPE)
  .map((type) => `'${type}'`)
  .join(', ');

/**
 * A connection to a model provider. The id is chosen by the service (not by the database) because it is part of
 * the authenticated data of the encrypted key. `apiKeyCiphertext` never leaves the service.
 */
@Entity({ name: 'provider_connection' })
@Index('provider_connection_name_idx', ['name'], { unique: true })
@Check('provider_connection_type_check', `type IN (${TYPE_VALUES})`)
export class ProviderConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  type!: ProviderType;

  @Column({ name: 'base_url', type: 'text' })
  baseUrl!: string;

  @Column({ name: 'api_key_ciphertext', type: 'text', nullable: true })
  apiKeyCiphertext!: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /** Raw model ids of the provider that the admin hides from users. */
  @Column({ name: 'hidden_model_ids', type: 'text', array: true, default: () => "'{}'" })
  hiddenModelIds!: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

- [ ] **Step 2: Entity eintragen**

`apps/api/src/database/entities.ts`:

```ts
import { ApiKey } from '../auth/api-key.entity.js';
import { Session } from '../auth/session.entity.js';
import { ProviderConnection } from '../models/provider-connection.entity.js';
import { User } from '../users/user.entity.js';
import { AuditLog } from './audit/audit-log.entity.js';

export const ENTITIES = [AuditLog, User, Session, ApiKey, ProviderConnection];
```

- [ ] **Step 3: Migration generieren**

```bash
pnpm db:up
export DATABASE_URL=postgresql://owui:owui-dev-password@127.0.0.1:5433/owui
export PROVIDER_KEY_ENCRYPTION_KEYS=dev:ZGV2ZWxvcG1lbnQtb25seS1wdWJsaWMta2V5LTAwMDA=
pnpm --filter @owui/api build
pnpm --filter @owui/api migration:run
pnpm --filter @owui/api migration:generate src/database/migrations/add-provider-connections
```

(Beides sind die Entwicklungswerte aus `.env.example`, keine Geheimnisse.) Die erzeugte Datei prüfen: Sie darf nur `provider_connection`, den eindeutigen Index `provider_connection_name_idx` und die CHECK-Bedingung `provider_connection_type_check` anlegen, mit `gen_random_uuid()` und `DEFAULT '{}'` für `hidden_model_ids`. Berührt sie andere Tabellen, ist die Ursache zu klären, die Datei **nicht von Hand zu ändern** (Invariante 9); nur Prettier darf sie formatieren. In `apps/api/src/database/migrations/index.ts` eintragen (Namen und Zeitstempel aus der Datei):

```ts
import { InitFoundation1791504000000 } from './1791504000000-init-foundation.js';
import { AddAuth1791564847792 } from './1791564847792-add-auth.js';
import { AddProviderConnections<Zeitstempel> } from './<Zeitstempel>-add-provider-connections.js';

export const MIGRATIONS = [
  InitFoundation1791504000000,
  AddAuth1791564847792,
  AddProviderConnections<Zeitstempel>,
];
```

- [ ] **Step 4: Test-Hilfe und Schema-Test schreiben**

An `apps/api/src/testing/db-fixtures.ts` anhängen (Import `DataSource` ist als Typ schon da):

```ts
export async function resetProviderTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE provider_connection');
}
```

`apps/api/src/models/provider-connection.schema.db.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { resetProviderTables } from '../testing/db-fixtures.js';
import { ProviderConnection } from './provider-connection.entity.js';
import { PROVIDER_TYPE } from './provider-type.js';

describe('provider_connection schema (database)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetProviderTables(dataSource);
  });

  function insert(overrides: Partial<ProviderConnection> = {}) {
    return dataSource.getRepository(ProviderConnection).insert({
      name: 'Lokales Ollama',
      type: PROVIDER_TYPE.OLLAMA,
      baseUrl: 'http://ollama:11434',
      ...overrides,
    });
  }

  it('stores a connection with defaults: enabled, no key, nothing hidden', async () => {
    await insert();

    const row = await dataSource.getRepository(ProviderConnection).findOneByOrFail({ name: 'Lokales Ollama' });
    expect(row.enabled).toBe(true);
    expect(row.apiKeyCiphertext).toBeNull();
    expect(row.hiddenModelIds).toEqual([]);
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('keeps an id chosen by the service', async () => {
    const id = randomUUID();

    await insert({ id });

    expect(await dataSource.getRepository(ProviderConnection).existsBy({ id })).toBe(true);
  });

  it('stores raw model ids that contain colons and slashes', async () => {
    await insert({ hiddenModelIds: ['llama3:8b', 'hf.co/acme/model:Q4_K_M'] });

    const row = await dataSource.getRepository(ProviderConnection).findOneByOrFail({ name: 'Lokales Ollama' });
    expect(row.hiddenModelIds).toEqual(['llama3:8b', 'hf.co/acme/model:Q4_K_M']);
  });

  it('refuses a second connection with the same name', async () => {
    await insert();

    await expect(insert({ baseUrl: 'http://other:11434' })).rejects.toThrow(
      /provider_connection_name_idx|duplicate key/
    );
  });

  it('refuses an unknown type', async () => {
    await expect(
      dataSource.query(
        "INSERT INTO provider_connection (name, type, base_url) VALUES ('x', 'anthropic', 'http://x')"
      )
    ).rejects.toThrow(/provider_connection_type_check/);
  });
});
```

- [ ] **Step 5: DB-Tests laufen lassen**

Run: `pnpm db:up && pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts`
Expected: PASS, auch die bestehenden DB-Tests (das Schema wird aus allen Migrationen neu aufgebaut). Zusätzlich darf `pnpm --filter @owui/api migration:generate src/database/migrations/check-drift` **keine** Änderungen finden („No changes in database schema were found“); eine dabei entstandene Datei löschen.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/models/provider-connection.entity.ts apps/api/src/models/provider-connection.schema.db.spec.ts apps/api/src/database apps/api/src/testing/db-fixtures.ts
git commit -m "feat(api): add the provider_connection table" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Anbieter-Adapter (Ollama, OpenAI-kompatibel)

**Files:**
- Create: `apps/api/src/models/provider-adapter.ts`, `apps/api/src/models/ollama.adapter.ts`, `apps/api/src/models/ollama.adapter.spec.ts`, `apps/api/src/models/openai-compatible.adapter.ts`, `apps/api/src/models/openai-compatible.adapter.spec.ts`

**Interfaces:**
- Consumes: `ProviderFetchService.getJson(baseUrl, path, apiKey)` und `.createFetch(baseUrl)` (Task 5); `ProviderError`, `PROVIDER_ERROR` (Task 2); `PROVIDER_TYPE`, `ProviderType` (Task 2); `FakeProvider`, `FAKE_MODE` (Task 5).
- Produces:
  - `interface ProviderTarget { connectionId: string; baseUrl: string; apiKey: string | undefined }` (Basis-URL normalisiert, Key im Klartext, nur im Speicher).
  - `interface RawModel { id: string; name: string }` (`id` ist die rohe ID des Anbieters).
  - `interface ProviderAdapter { readonly type: ProviderType; listModels(target: ProviderTarget): Promise<RawModel[]>; languageModel(target: ProviderTarget, rawModelId: string): LanguageModel }`.
  - `PROVIDER_ADAPTERS` (Symbol), `OllamaAdapter`, `OpenAiCompatibleAdapter` (beide `@Injectable()`, Konstruktor `(providerFetch: ProviderFetchService)`).
  - `listModels` wirft nur `ProviderError` (`BAD_RESPONSE` bei unerwartetem Format); `languageModel` ist synchron und macht keinen Netzaufruf.

- [ ] **Step 1: Schnittstelle schreiben**

`apps/api/src/models/provider-adapter.ts`:

```ts
import type { LanguageModel } from 'ai';

import type { ProviderType } from './provider-type.js';

/** Everything an adapter needs to reach one connection. The key is plain text and lives in memory only. */
export interface ProviderTarget {
  connectionId: string;
  /** Normalized: no trailing slash, no credentials. */
  baseUrl: string;
  apiKey: string | undefined;
}

export interface RawModel {
  /** The provider's own id, for example `llama3:8b`. */
  id: string;
  name: string;
}

export interface ProviderAdapter {
  readonly type: ProviderType;
  /** Throws ProviderError; an unexpected answer format is BAD_RESPONSE. */
  listModels(target: ProviderTarget): Promise<RawModel[]>;
  /** No network call: the returned model calls the provider when it is used. */
  languageModel(target: ProviderTarget, rawModelId: string): LanguageModel;
}

export const PROVIDER_ADAPTERS = Symbol('PROVIDER_ADAPTERS');
```

- [ ] **Step 2: Fehlschlagende Tests schreiben**

`apps/api/src/models/ollama.adapter.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { parseAllowedHost } from '../http/safe-fetch/address-policy.js';
import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import {
  PROVIDER_FETCH_DEFAULTS,
  ProviderFetchService,
} from '../http/safe-fetch/provider-fetch.service.js';
import { FAKE_MODE, FakeProvider } from '../testing/fake-provider.js';
import { OllamaAdapter } from './ollama.adapter.js';
import type { ProviderTarget } from './provider-adapter.js';

const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'ping' }] }];
const providers: FakeProvider[] = [];

async function startProvider(): Promise<FakeProvider> {
  const provider = await FakeProvider.start();
  providers.push(provider);
  return provider;
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

function adapter(allowedHosts: string[] = ['127.0.0.1']): OllamaAdapter {
  return new OllamaAdapter(
    new ProviderFetchService({
      ...PROVIDER_FETCH_DEFAULTS,
      timeoutMs: 1000,
      allowedHosts: allowedHosts.map(parseAllowedHost),
    })
  );
}

function targetFor(provider: FakeProvider, apiKey?: string): ProviderTarget {
  return { connectionId: randomUUID(), baseUrl: provider.url, apiKey };
}

async function failureOf(work: Promise<unknown>): Promise<ProviderError> {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!(outcome instanceof ProviderError)) throw new Error('expected a ProviderError');
  return outcome;
}

describe('OllamaAdapter: model list', () => {
  it('reads the names from /api/tags', async () => {
    const provider = await startProvider();

    const models = await adapter().listModels(targetFor(provider));

    expect(models).toEqual([
      { id: 'llama3:8b', name: 'llama3:8b' },
      { id: 'mistral:7b', name: 'mistral:7b' },
    ]);
    expect(provider.requests.map((request) => request.path)).toEqual(['/api/tags']);
  });

  it('sends the key as a Bearer token when there is one', async () => {
    const provider = await startProvider();
    provider.requiredKey = 'sk-secret';

    await adapter().listModels(targetFor(provider, 'sk-secret'));

    expect(provider.requests[0]?.authorization).toBe('Bearer sk-secret');
    expect((await failureOf(adapter().listModels(targetFor(provider)))).reason).toBe(
      PROVIDER_ERROR.UNAUTHORIZED
    );
  });

  it('turns an answer in the wrong format into BAD_RESPONSE without echoing it', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.WRONG_SHAPE;

    const error = await failureOf(adapter().listModels(targetFor(provider)));

    expect(error.reason).toBe(PROVIDER_ERROR.BAD_RESPONSE);
    expect(error.message).not.toContain('unexpected');
  });

  it('lets the reason of a failed call through', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.SERVER_ERROR;

    expect((await failureOf(adapter().listModels(targetFor(provider)))).reason).toBe(
      PROVIDER_ERROR.BAD_RESPONSE
    );
  });
});

describe('OllamaAdapter: language model', () => {
  it('talks to /v1/chat/completions of the same host with the raw model id and the key', async () => {
    const provider = await startProvider();
    const target = targetFor(provider, 'sk-secret');

    const model = adapter().languageModel(target, 'llama3:8b');
    await model.doGenerate({ prompt: PROMPT });

    expect(model.modelId).toBe('llama3:8b');
    expect(model.provider).toBe(`${target.connectionId}.chat`);
    const request = provider.requests[0];
    expect(request?.path).toBe('/v1/chat/completions');
    expect(request?.authorization).toBe('Bearer sk-secret');
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({ model: 'llama3:8b' });
  });

  it('streams', async () => {
    const provider = await startProvider();
    const model = adapter().languageModel(targetFor(provider), 'llama3:8b');

    const { stream } = await model.doStream({ prompt: PROMPT });
    const parts: unknown[] = [];
    for await (const part of stream) parts.push(part);

    expect(JSON.stringify(parts)).toContain('pong');
    expect(parts).toContainEqual(expect.objectContaining({ type: 'text-delta' }));
  });

  it('refuses a host that is not allowed, without a request', async () => {
    const provider = await startProvider();
    const model = adapter([]).languageModel(targetFor(provider), 'llama3:8b');

    const error = await failureOf(model.doGenerate({ prompt: PROMPT }));

    expect(error.reason).toBe(PROVIDER_ERROR.BLOCKED_HOST);
    expect(provider.requests).toHaveLength(0);
  });
});
```

`apps/api/src/models/openai-compatible.adapter.spec.ts` (gleicher Aufbau; die Basis-URL enthält `/v1`, die Liste kommt von `/models` darunter):

```ts
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { parseAllowedHost } from '../http/safe-fetch/address-policy.js';
import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import {
  PROVIDER_FETCH_DEFAULTS,
  ProviderFetchService,
} from '../http/safe-fetch/provider-fetch.service.js';
import { FAKE_MODE, FakeProvider } from '../testing/fake-provider.js';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter.js';
import type { ProviderTarget } from './provider-adapter.js';

const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'ping' }] }];
const providers: FakeProvider[] = [];

async function startProvider(): Promise<FakeProvider> {
  const provider = await FakeProvider.start();
  providers.push(provider);
  return provider;
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

function adapter(allowedHosts: string[] = ['127.0.0.1']): OpenAiCompatibleAdapter {
  return new OpenAiCompatibleAdapter(
    new ProviderFetchService({
      ...PROVIDER_FETCH_DEFAULTS,
      timeoutMs: 1000,
      allowedHosts: allowedHosts.map(parseAllowedHost),
    })
  );
}

function targetFor(provider: FakeProvider, apiKey?: string): ProviderTarget {
  return { connectionId: randomUUID(), baseUrl: `${provider.url}/v1`, apiKey };
}

async function failureOf(work: Promise<unknown>): Promise<ProviderError> {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!(outcome instanceof ProviderError)) throw new Error('expected a ProviderError');
  return outcome;
}

describe('OpenAiCompatibleAdapter: model list', () => {
  it('reads the ids from /models below the base URL', async () => {
    const provider = await startProvider();

    const models = await adapter().listModels(targetFor(provider));

    expect(models).toEqual([
      { id: 'llama3:8b', name: 'llama3:8b' },
      { id: 'mistral:7b', name: 'mistral:7b' },
    ]);
    expect(provider.requests.map((request) => request.path)).toEqual(['/v1/models']);
  });

  it('sends the key as a Bearer token and reports a refused key as UNAUTHORIZED', async () => {
    const provider = await startProvider();
    provider.requiredKey = 'sk-secret';

    await adapter().listModels(targetFor(provider, 'sk-secret'));

    expect(provider.requests[0]?.authorization).toBe('Bearer sk-secret');
    expect((await failureOf(adapter().listModels(targetFor(provider, 'sk-wrong')))).reason).toBe(
      PROVIDER_ERROR.UNAUTHORIZED
    );
  });

  it('turns an answer in the wrong format into BAD_RESPONSE', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.WRONG_SHAPE;

    expect((await failureOf(adapter().listModels(targetFor(provider)))).reason).toBe(
      PROVIDER_ERROR.BAD_RESPONSE
    );
  });

  it('turns an HTML login page into BAD_RESPONSE', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.HTML;

    expect((await failureOf(adapter().listModels(targetFor(provider)))).reason).toBe(
      PROVIDER_ERROR.BAD_RESPONSE
    );
  });
});

describe('OpenAiCompatibleAdapter: language model', () => {
  it('calls {base}/chat/completions with the raw model id and the key', async () => {
    const provider = await startProvider();
    const target = targetFor(provider, 'sk-secret');

    const model = adapter().languageModel(target, 'gpt-4o');
    await model.doGenerate({ prompt: PROMPT });

    expect(model.modelId).toBe('gpt-4o');
    expect(model.provider).toBe(`${target.connectionId}.chat`);
    const request = provider.requests[0];
    expect(request?.path).toBe('/v1/chat/completions');
    expect(request?.authorization).toBe('Bearer sk-secret');
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({ model: 'gpt-4o' });
  });

  it('sends no Authorization header without a key', async () => {
    const provider = await startProvider();

    await adapter().languageModel(targetFor(provider), 'gpt-4o').doGenerate({ prompt: PROMPT });

    expect(provider.requests[0]?.authorization).toBeUndefined();
  });

  it('refuses a host that is not allowed, without a request', async () => {
    const provider = await startProvider();
    const model = adapter([]).languageModel(targetFor(provider), 'gpt-4o');

    const error = await failureOf(model.doGenerate({ prompt: PROMPT }));

    expect(error.reason).toBe(PROVIDER_ERROR.BLOCKED_HOST);
    expect(provider.requests).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/models/ollama.adapter.spec.ts src/models/openai-compatible.adapter.spec.ts`
Expected: FAIL (Module fehlen).

- [ ] **Step 4: Implementieren**

`apps/api/src/models/ollama.adapter.ts`:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Injectable } from '@nestjs/common';
import type { LanguageModel } from 'ai';
import { z } from 'zod';

import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { ProviderFetchService } from '../http/safe-fetch/provider-fetch.service.js';
import type { ProviderAdapter, ProviderTarget, RawModel } from './provider-adapter.js';
import { PROVIDER_TYPE } from './provider-type.js';

const TagsAnswer = z.object({ models: z.array(z.object({ name: z.string().min(1) })) });

/** Ollama: the list comes from /api/tags (more metadata), generation goes through its OpenAI-compatible /v1. */
@Injectable()
export class OllamaAdapter implements ProviderAdapter {
  readonly type = PROVIDER_TYPE.OLLAMA;

  constructor(private readonly providerFetch: ProviderFetchService) {}

  async listModels(target: ProviderTarget): Promise<RawModel[]> {
    const json = await this.providerFetch.getJson(target.baseUrl, '/api/tags', target.apiKey);
    const parsed = TagsAnswer.safeParse(json);
    if (!parsed.success) {
      // The issues would echo parts of the answer; the message stays fixed.
      throw new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The model list has an unexpected format');
    }
    return parsed.data.models.map(({ name }) => ({ id: name, name }));
  }

  languageModel(target: ProviderTarget, rawModelId: string): LanguageModel {
    return createOpenAICompatible({
      name: target.connectionId,
      baseURL: `${target.baseUrl}/v1`,
      apiKey: target.apiKey,
      fetch: this.providerFetch.createFetch(target.baseUrl),
    }).languageModel(rawModelId);
  }
}
```

`apps/api/src/models/openai-compatible.adapter.ts`:

```ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Injectable } from '@nestjs/common';
import type { LanguageModel } from 'ai';
import { z } from 'zod';

import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { ProviderFetchService } from '../http/safe-fetch/provider-fetch.service.js';
import type { ProviderAdapter, ProviderTarget, RawModel } from './provider-adapter.js';
import { PROVIDER_TYPE } from './provider-type.js';

const ModelsAnswer = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });

/** Any endpoint that speaks the OpenAI format; the base URL already contains the version path (`…/v1`). */
@Injectable()
export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly type = PROVIDER_TYPE.OPENAI_COMPATIBLE;

  constructor(private readonly providerFetch: ProviderFetchService) {}

  async listModels(target: ProviderTarget): Promise<RawModel[]> {
    const json = await this.providerFetch.getJson(target.baseUrl, '/models', target.apiKey);
    const parsed = ModelsAnswer.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(PROVIDER_ERROR.BAD_RESPONSE, 'The model list has an unexpected format');
    }
    return parsed.data.data.map(({ id }) => ({ id, name: id }));
  }

  languageModel(target: ProviderTarget, rawModelId: string): LanguageModel {
    return createOpenAICompatible({
      name: target.connectionId,
      baseURL: target.baseUrl,
      apiKey: target.apiKey,
      fetch: this.providerFetch.createFetch(target.baseUrl),
    }).languageModel(rawModelId);
  }
}
```

Hinweise:

- `createFetch(baseUrl)` bindet den Ursprung von `baseUrl`; die URLs, die das SDK daraus bildet (`{baseUrl}/v1/chat/completions`), haben denselben Ursprung. Ein Anbieter, der in der Modellliste oder in einer Antwort eine andere URL nennt, wird nie angesprochen.
- `PROVIDER_ERROR.BAD_RESPONSE`-Texte bleiben fest; der Inhalt der Antwort (Zod-Issues) gelangt nie in eine Meldung oder ein Log.
- Zeigt `tsc` einen Typfehler bei `name: target.connectionId` oder `fetch`, die Signatur in der installierten Version von `@ai-sdk/openai-compatible` lesen (der Vertragstest aus Task 1 nutzt dieselben Felder) und **nicht** mit einem Cast umgehen.

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/models/ollama.adapter.spec.ts src/models/openai-compatible.adapter.spec.ts`
Expected: PASS. Weichen die Namen der Stream-Teile in `ai` 7 vom Test („text-delta“) ab, den Test mit der gedruckten Teileliste (`console.log(parts)` kurz einfügen und wieder entfernen) anpassen; die Aussage bleibt: der Stream des Anbieters kommt unverändert durch unseren `fetch` und enthält „pong“.

- [ ] **Step 6: Build und ESM-Import prüfen**

`ai` 7 und das Anbieter-Paket sind ESM; der Nest-Build muss sie wie vorgesehen laden (Regel 10, „unsicher“ in der Spec).

```bash
pnpm --filter @owui/api build
pnpm --filter @owui/api exec node -e "Promise.all([import('./dist/models/ollama.adapter.js'), import('./dist/models/openai-compatible.adapter.js')]).then(([a, b]) => console.log(Object.keys(a), Object.keys(b)))"
```

Expected: `[ 'OllamaAdapter' ] [ 'OpenAiCompatibleAdapter' ]` ohne Fehler (`ERR_REQUIRE_ESM`, `ERR_MODULE_NOT_FOUND` wären ein Befund für Task 1, nicht hier zu umgehen).

- [ ] **Step 7: Prüfen, Commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add apps/api/src/models/provider-adapter.ts apps/api/src/models/ollama.adapter.ts apps/api/src/models/ollama.adapter.spec.ts apps/api/src/models/openai-compatible.adapter.ts apps/api/src/models/openai-compatible.adapter.spec.ts
git commit -m "feat(api): add Ollama and OpenAI-compatible provider adapters" -m "Lists are parsed with zod; generation goes through createOpenAICompatible with the origin-bound provider fetch." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Modell-Cache und `ModelRegistryService`

**Files:**
- Create: `apps/api/src/testing/provider-fixtures.ts`, `apps/api/src/models/models.dto.ts`, `apps/api/src/models/model-list-cache.ts`, `apps/api/src/models/model-list-cache.spec.ts`, `apps/api/src/models/model-registry.service.ts`, `apps/api/src/models/model-registry.service.spec.ts`

Der `ModelRegistryService` hängt von `ProviderConnectionsService` ab (Task 9). Damit Task 8 für sich testbar bleibt, wird der Dienst hier gegen eine kleine Klassenhülle mit den vier benötigten Methoden geschrieben; Task 9 liefert die echte Klasse mit genau diesen Signaturen. Die Hülle liegt in `provider-connections.service.ts`, das in Task 9 vervollständigt wird.

**Interfaces:**
- Consumes: `ProviderAdapter`, `ProviderTarget`, `RawModel`, `PROVIDER_ADAPTERS` (Task 7); `formatModelId`, `parseModelId` (Task 4); `ProviderConnection` (Task 6); `ProviderError`, `PROVIDER_ERROR` (Task 2); Env `MODEL_LIST_CACHE_TTL_MS` (Task 2).
- Produces:
  - `ProviderConnectionsService` (Rumpf, in Task 9 gefüllt) mit `listEnabled(): Promise<ProviderConnection[]>`, `get(id: string): Promise<ProviderConnection>` (wirft 404), `findEnabled(id: string): Promise<ProviderConnection | null>`, `targetOf(connection: ProviderConnection): ProviderTarget`.
  - `ModelListCache`: `get(connectionId: string, now?: number): RawModel[] | undefined`; `ticket(connectionId: string): number`; `set(connectionId: string, models: RawModel[], ticket: number, now?: number): void`; `invalidate(connectionId: string): void`.
  - `ModelRegistryService`: `list(): Promise<ModelListDto>`; `listForConnection(connectionId: string): Promise<AdminModelListDto>`; `test(connectionId: string): Promise<ConnectionTestDto>`; `resolve(modelId: string): Promise<ResolvedModel>`.
  - `interface ResolvedModel { model: LanguageModel; connection: { id: string; name: string; type: ProviderType }; rawModelId: string }`.
  - DTOs in `models.dto.ts`: `ModelDto { id, name, connectionId, providerName, providerType }`, `UnavailableConnectionDto { id, name, reason }`, `ModelListDto { models, unavailableConnections }`, `AdminModelDto { rawModelId, name, hidden }`, `AdminModelListDto { models }`, `ConnectionTestDto { ok, modelCount }`.
  - Test-Hilfen in `testing/provider-fixtures.ts`: `TEST_KEY_RING: string[]`, `configOf(values): ConfigService<Env, true>`, `silentLogger(): PinoLogger`, `capturingLogger(): { logger: PinoLogger; output(): string }`.

- [ ] **Step 1: Test-Hilfen und DTOs schreiben**

`apps/api/src/testing/provider-fixtures.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../config/env.js';
import { REDACT_CENSOR, REDACT_PATHS } from '../logging/redact.js';

/** A valid key ring for tests (never used outside them). */
export const TEST_KEY_RING = [`test:${Buffer.alloc(32, 9).toString('base64')}`];

export function configOf(values: Partial<Record<keyof Env, unknown>>): ConfigService<Env, true> {
  return new ConfigService<Env, true>(values);
}

export function silentLogger(): PinoLogger {
  return new PinoLogger({ pinoHttp: { level: 'silent' } });
}

/** Same redaction as the app logger, but the lines stay in memory so a test can search them. */
export function capturingLogger(): { logger: PinoLogger; output: () => string } {
  const lines: string[] = [];
  const logger = new PinoLogger({
    pinoHttp: [
      { level: 'trace', redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } },
      {
        write: (line: string) => {
          lines.push(line);
        },
      },
    ],
  });
  return { logger, output: () => lines.join('') };
}
```

Passt der Konstruktor von `PinoLogger` in der installierten Version von `nestjs-pino` nicht (Typen in `node_modules/nestjs-pino` lesen), nur diese Datei anpassen.

`apps/api/src/models/models.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

import { PROVIDER_ERROR, type ProviderErrorReason } from '../http/safe-fetch/provider-error.js';
import { PROVIDER_TYPE, type ProviderType } from './provider-type.js';

export class ModelDto {
  /** `<connectionId>:<rawModelId>`; the chat sends this id back. */
  id!: string;
  name!: string;
  connectionId!: string;
  providerName!: string;
  @ApiProperty({ enum: Object.values(PROVIDER_TYPE) })
  providerType!: ProviderType;
}

export class UnavailableConnectionDto {
  id!: string;
  name!: string;
  @ApiProperty({ enum: Object.values(PROVIDER_ERROR) })
  reason!: ProviderErrorReason;
}

export class ModelListDto {
  @ApiProperty({ type: [ModelDto] })
  models!: ModelDto[];
  @ApiProperty({ type: [UnavailableConnectionDto] })
  unavailableConnections!: UnavailableConnectionDto[];
}

export class AdminModelDto {
  /** The provider's own id; `hiddenModelIds` of a connection holds these. */
  rawModelId!: string;
  name!: string;
  hidden!: boolean;
}

export class AdminModelListDto {
  @ApiProperty({ type: [AdminModelDto] })
  models!: AdminModelDto[];
}

export class ConnectionTestDto {
  ok!: boolean;
  modelCount!: number;
}
```

- [ ] **Step 2: Rumpf von `ProviderConnectionsService` anlegen**

Damit die Registry kompiliert und Nest sie injizieren kann, legt dieser Schritt die Klasse mit ihren vier Lese-Methoden an; Task 9 ergänzt Schreiben, Prüfung und Audit.

`apps/api/src/models/provider-connections.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { ProviderConnection } from './provider-connection.entity.js';
import type { ProviderTarget } from './provider-adapter.js';
import { SecretBox } from './secret-box.js';

@Injectable()
export class ProviderConnectionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly secretBox: SecretBox
  ) {}

  listEnabled(): Promise<ProviderConnection[]> {
    return this.dataSource
      .getRepository(ProviderConnection)
      .find({ where: { enabled: true }, order: { name: 'ASC' } });
  }

  async get(id: string): Promise<ProviderConnection> {
    const found = await this.dataSource.getRepository(ProviderConnection).findOneBy({ id });
    if (found === null) throw new NotFoundException('Connection not found');
    return found;
  }

  findEnabled(id: string): Promise<ProviderConnection | null> {
    return this.dataSource.getRepository(ProviderConnection).findOneBy({ id, enabled: true });
  }

  /** Decrypts the key. The result lives for one call and is never logged or returned. */
  targetOf(connection: ProviderConnection): ProviderTarget {
    return {
      connectionId: connection.id,
      baseUrl: connection.baseUrl,
      apiKey:
        connection.apiKeyCiphertext === null
          ? undefined
          : this.secretBox.decrypt(connection.apiKeyCiphertext, connection.id),
    };
  }
}
```

- [ ] **Step 3: Fehlschlagende Tests schreiben**

`apps/api/src/models/model-list-cache.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { configOf } from '../testing/provider-fixtures.js';
import { ModelListCache } from './model-list-cache.js';

const MODELS = [{ id: 'llama3:8b', name: 'llama3:8b' }];

function cache(ttlMs = 1000): ModelListCache {
  return new ModelListCache(configOf({ MODEL_LIST_CACHE_TTL_MS: ttlMs }));
}

describe('ModelListCache', () => {
  it('returns a list until its time to live is over', () => {
    const id = randomUUID();
    const lists = cache(1000);

    lists.set(id, MODELS, lists.ticket(id), 10_000);

    expect(lists.get(id, 10_999)).toEqual(MODELS);
    expect(lists.get(id, 11_000)).toBeUndefined();
  });

  it('keeps connections apart', () => {
    const [a, b] = [randomUUID(), randomUUID()];
    const lists = cache();

    lists.set(a, MODELS, lists.ticket(a), 0);

    expect(lists.get(b, 1)).toBeUndefined();
    expect(lists.get(a, 1)).toEqual(MODELS);
  });

  it('forgets a list on invalidate', () => {
    const id = randomUUID();
    const lists = cache();
    lists.set(id, MODELS, lists.ticket(id), 0);

    lists.invalidate(id);

    expect(lists.get(id, 1)).toBeUndefined();
  });

  it('drops an answer that was requested before an invalidation', () => {
    const id = randomUUID();
    const lists = cache();
    const ticket = lists.ticket(id);

    lists.invalidate(id);
    lists.set(id, MODELS, ticket, 0);

    expect(lists.get(id, 1)).toBeUndefined();
  });

  it('does not cache at all with a time to live of 0', () => {
    const id = randomUUID();
    const lists = cache(0);

    lists.set(id, MODELS, lists.ticket(id), 0);

    expect(lists.get(id, 0)).toBeUndefined();
  });
});
```

`apps/api/src/models/model-registry.service.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';

import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { configOf, silentLogger } from '../testing/provider-fixtures.js';
import { formatModelId } from './model-id.js';
import { ModelListCache } from './model-list-cache.js';
import { ModelRegistryService } from './model-registry.service.js';
import { ProviderConnection } from './provider-connection.entity.js';
import { ProviderConnectionsService } from './provider-connections.service.js';
import {
  PROVIDER_ADAPTERS,
  type ProviderAdapter,
  type ProviderTarget,
  type RawModel,
} from './provider-adapter.js';
import { PROVIDER_TYPE, type ProviderType } from './provider-type.js';

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return Object.assign(new ProviderConnection(), {
    id: randomUUID(),
    name: 'Lokales Ollama',
    type: PROVIDER_TYPE.OLLAMA,
    baseUrl: 'http://ollama:11434',
    apiKeyCiphertext: null,
    enabled: true,
    hiddenModelIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

function raw(...ids: string[]): RawModel[] {
  return ids.map((id) => ({ id, name: id }));
}

class FakeAdapter implements ProviderAdapter {
  listCalls = 0;
  readonly built: { target: ProviderTarget; rawModelId: string }[] = [];
  readonly answers = new Map<string, RawModel[] | Error>();
  gate: Promise<void> | undefined;
  readonly model: LanguageModel = new MockLanguageModelV4();

  constructor(readonly type: ProviderType) {}

  async listModels(target: ProviderTarget): Promise<RawModel[]> {
    this.listCalls += 1;
    await this.gate;
    const answer = this.answers.get(target.connectionId) ?? [];
    if (answer instanceof Error) throw answer;
    return answer;
  }

  languageModel(target: ProviderTarget, rawModelId: string): LanguageModel {
    this.built.push({ target, rawModelId });
    return this.model;
  }
}

async function setup(ttlMs = 30_000) {
  const state = { connections: [] as ProviderConnection[] };
  const ollama = new FakeAdapter(PROVIDER_TYPE.OLLAMA);
  const openai = new FakeAdapter(PROVIDER_TYPE.OPENAI_COMPATIBLE);
  const cache = new ModelListCache(configOf({ MODEL_LIST_CACHE_TTL_MS: ttlMs }));
  const connections = {
    listEnabled: () => Promise.resolve(state.connections.filter((item) => item.enabled)),
    get: (id: string) => {
      const found = state.connections.find((item) => item.id === id);
      return found === undefined
        ? Promise.reject(new NotFoundException('Connection not found'))
        : Promise.resolve(found);
    },
    findEnabled: (id: string) =>
      Promise.resolve(state.connections.find((item) => item.id === id && item.enabled) ?? null),
    targetOf: (item: ProviderConnection): ProviderTarget => ({
      connectionId: item.id,
      baseUrl: item.baseUrl,
      apiKey: undefined,
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      ModelRegistryService,
      { provide: ProviderConnectionsService, useValue: connections },
      { provide: PROVIDER_ADAPTERS, useValue: [ollama, openai] },
      { provide: ModelListCache, useValue: cache },
      { provide: PinoLogger, useValue: silentLogger() },
    ],
  }).compile();
  return { registry: moduleRef.get(ModelRegistryService), state, ollama, openai, cache };
}

describe('ModelRegistryService.list', () => {
  it('merges the models of all active connections, sorted, with their provider', async () => {
    const { registry, state, ollama, openai } = await setup();
    const local = connection({ name: 'Lokal' });
    const cloud = connection({ name: 'Cloud', type: PROVIDER_TYPE.OPENAI_COMPATIBLE });
    state.connections.push(local, cloud);
    ollama.answers.set(local.id, raw('mistral:7b', 'llama3:8b'));
    openai.answers.set(cloud.id, raw('gpt-4o'));

    const result = await registry.list();

    expect(result.unavailableConnections).toEqual([]);
    expect(result.models).toEqual([
      {
        id: formatModelId(cloud.id, 'gpt-4o'),
        name: 'gpt-4o',
        connectionId: cloud.id,
        providerName: 'Cloud',
        providerType: PROVIDER_TYPE.OPENAI_COMPATIBLE,
      },
      {
        id: formatModelId(local.id, 'llama3:8b'),
        name: 'llama3:8b',
        connectionId: local.id,
        providerName: 'Lokal',
        providerType: PROVIDER_TYPE.OLLAMA,
      },
      {
        id: formatModelId(local.id, 'mistral:7b'),
        name: 'mistral:7b',
        connectionId: local.id,
        providerName: 'Lokal',
        providerType: PROVIDER_TYPE.OLLAMA,
      },
    ]);
  });

  it('leaves out hidden models, duplicates and ids that cannot be addressed', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection({ hiddenModelIds: ['mistral:7b'] });
    state.connections.push(local);
    ollama.answers.set(
      local.id,
      raw('llama3:8b', 'llama3:8b', 'mistral:7b', 'bad\nid', 'x'.repeat(600), 'hf.co/acme/m:Q4')
    );

    const names = (await registry.list()).models.map((model) => model.name);

    expect(names).toEqual(['hf.co/acme/m:Q4', 'llama3:8b']);
  });

  it('reports a failing connection with its reason and still lists the others', async () => {
    const { registry, state, ollama, openai } = await setup();
    const down = connection({ name: 'Down' });
    const fine = connection({ name: 'Fine', type: PROVIDER_TYPE.OPENAI_COMPATIBLE });
    state.connections.push(down, fine);
    ollama.answers.set(down.id, new ProviderError(PROVIDER_ERROR.TIMEOUT, 'slow'));
    openai.answers.set(fine.id, raw('gpt-4o'));

    const result = await registry.list();

    expect(result.unavailableConnections).toEqual([
      { id: down.id, name: 'Down', reason: PROVIDER_ERROR.TIMEOUT },
    ]);
    expect(result.models.map((model) => model.name)).toEqual(['gpt-4o']);
  });

  it('does not hide a programming error behind "unavailable"', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, new TypeError('boom'));

    await expect(registry.list()).rejects.toThrow(TypeError);
  });

  it('asks all connections at the same time', async () => {
    const { registry, state, ollama } = await setup();
    state.connections.push(connection({ name: 'A' }), connection({ name: 'B' }));
    let release: () => void = () => undefined;
    ollama.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = registry.list();
    await expect.poll(() => ollama.listCalls).toBe(2);
    release();

    expect((await pending).models).toEqual([]);
  });
});

describe('ModelRegistryService: cache', () => {
  it('answers the second list from memory', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, raw('llama3:8b'));

    await registry.list();
    await registry.list();

    expect(ollama.listCalls).toBe(1);
  });

  it('asks the provider again after an invalidation', async () => {
    const { registry, state, ollama, cache } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, raw('llama3:8b'));
    await registry.list();

    cache.invalidate(local.id);
    await registry.list();

    expect(ollama.listCalls).toBe(2);
  });

  it('does not cache a failure', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, new ProviderError(PROVIDER_ERROR.UNREACHABLE, 'down'));
    await registry.list();

    ollama.answers.set(local.id, raw('llama3:8b'));
    const result = await registry.list();

    expect(result.models).toHaveLength(1);
    expect(ollama.listCalls).toBe(2);
  });

  it('shows a changed hide list at once, because the stored list is filtered on every read', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, raw('llama3:8b', 'mistral:7b'));
    await registry.list();

    local.hiddenModelIds = ['llama3:8b'];

    expect((await registry.list()).models.map((model) => model.name)).toEqual(['mistral:7b']);
    expect(ollama.listCalls).toBe(1);
  });
});

describe('ModelRegistryService: admin views', () => {
  it('lists all models of a connection with the hidden flag, also for a disabled connection', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection({ enabled: false, hiddenModelIds: ['mistral:7b'] });
    state.connections.push(local);
    ollama.answers.set(local.id, raw('llama3:8b', 'mistral:7b'));

    const result = await registry.listForConnection(local.id);

    expect(result.models).toEqual([
      { rawModelId: 'llama3:8b', name: 'llama3:8b', hidden: false },
      { rawModelId: 'mistral:7b', name: 'mistral:7b', hidden: true },
    ]);
  });

  it('lets the reason of a failed list through (the controller answers 502)', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, new ProviderError(PROVIDER_ERROR.UNAUTHORIZED, 'no'));

    await expect(registry.listForConnection(local.id)).rejects.toMatchObject({
      reason: PROVIDER_ERROR.UNAUTHORIZED,
    });
  });

  it('answers 404 for an unknown connection', async () => {
    const { registry } = await setup();

    await expect(registry.listForConnection(randomUUID())).rejects.toThrow(NotFoundException);
    await expect(registry.test(randomUUID())).rejects.toThrow(NotFoundException);
  });

  it('test() asks the provider even when a list is cached, and counts all models', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection({ hiddenModelIds: ['mistral:7b'] });
    state.connections.push(local);
    ollama.answers.set(local.id, raw('llama3:8b', 'mistral:7b'));
    await registry.listForConnection(local.id);

    const result = await registry.test(local.id);

    expect(result).toEqual({ ok: true, modelCount: 2 });
    expect(ollama.listCalls).toBe(2);
  });

  it('test() throws the reason of a failure', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection();
    state.connections.push(local);
    ollama.answers.set(local.id, new ProviderError(PROVIDER_ERROR.BLOCKED_HOST, 'no'));

    await expect(registry.test(local.id)).rejects.toMatchObject({
      reason: PROVIDER_ERROR.BLOCKED_HOST,
    });
  });
});

describe('ModelRegistryService.resolve', () => {
  it('returns the adapter model for the raw id, split at the first colon', async () => {
    const { registry, state, ollama } = await setup();
    const local = connection({ name: 'Lokal' });
    state.connections.push(local);

    const resolved = await registry.resolve(formatModelId(local.id, 'llama3:8b'));

    expect(resolved.model).toBe(ollama.model);
    expect(resolved.rawModelId).toBe('llama3:8b');
    expect(resolved.connection).toEqual({
      id: local.id,
      name: 'Lokal',
      type: PROVIDER_TYPE.OLLAMA,
    });
    expect(ollama.built).toEqual([
      {
        target: { connectionId: local.id, baseUrl: local.baseUrl, apiKey: undefined },
        rawModelId: 'llama3:8b',
      },
    ]);
  });

  it('picks the adapter of the connection type and needs no call to the provider', async () => {
    const { registry, state, ollama, openai } = await setup();
    const cloud = connection({ type: PROVIDER_TYPE.OPENAI_COMPATIBLE });
    state.connections.push(cloud);

    await registry.resolve(formatModelId(cloud.id, 'gpt-4o'));

    expect(openai.built).toHaveLength(1);
    expect(ollama.built).toHaveLength(0);
    expect(openai.listCalls + ollama.listCalls).toBe(0);
  });

  it('refuses a hidden model, a disabled or unknown connection with 404', async () => {
    const { registry, state } = await setup();
    const hidden = connection({ hiddenModelIds: ['mistral:7b'] });
    const off = connection({ enabled: false });
    state.connections.push(hidden, off);

    for (const id of [
      formatModelId(hidden.id, 'mistral:7b'),
      formatModelId(off.id, 'llama3:8b'),
      formatModelId(randomUUID(), 'llama3:8b'),
    ]) {
      await expect(registry.resolve(id)).rejects.toThrow(NotFoundException);
    }
  });

  it.each([
    ['empty', ''],
    ['no colon', randomUUID()],
    ['nothing after the colon', `${randomUUID()}:`],
    ['no connection', ':llama3'],
    ['not a uuid', 'prod:llama3'],
    ['control character', `${randomUUID()}:a\nb`],
  ])('answers 404, never 500, for a broken id (%s)', async (_name, id) => {
    const { registry } = await setup();

    await expect(registry.resolve(id)).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 4: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/models/model-list-cache.spec.ts src/models/model-registry.service.spec.ts`
Expected: FAIL (`model-list-cache.js`, `model-registry.service.js` fehlen).

- [ ] **Step 5: Implementieren**

`apps/api/src/models/model-list-cache.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import type { RawModel } from './provider-adapter.js';

interface Entry {
  models: RawModel[];
  expiresAt: number;
}

/**
 * Short-lived model lists per connection, in memory. Only successes are stored. `ticket()` is taken before a
 * request to the provider; an answer that arrives after `invalidate()` carries an old ticket and is dropped, so
 * a list fetched with the old URL or key does not outlive an edit.
 */
@Injectable()
export class ModelListCache {
  private readonly ttlMs: number;
  private readonly entries = new Map<string, Entry>();
  private readonly generations = new Map<string, number>();

  constructor(config: ConfigService<Env, true>) {
    this.ttlMs = config.get('MODEL_LIST_CACHE_TTL_MS', { infer: true });
  }

  get(connectionId: string, now = Date.now()): RawModel[] | undefined {
    const entry = this.entries.get(connectionId);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(connectionId);
      return undefined;
    }
    return entry.models;
  }

  ticket(connectionId: string): number {
    return this.generations.get(connectionId) ?? 0;
  }

  set(connectionId: string, models: RawModel[], ticket: number, now = Date.now()): void {
    if (this.ttlMs <= 0 || ticket !== this.ticket(connectionId)) return;
    this.entries.set(connectionId, { models, expiresAt: now + this.ttlMs });
  }

  invalidate(connectionId: string): void {
    this.entries.delete(connectionId);
    this.generations.set(connectionId, this.ticket(connectionId) + 1);
  }
}
```

`apps/api/src/models/model-registry.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { LanguageModel } from 'ai';
import { PinoLogger } from 'nestjs-pino';

import { ProviderError, type ProviderErrorReason } from '../http/safe-fetch/provider-error.js';
import { formatModelId, parseModelId } from './model-id.js';
import { ModelListCache } from './model-list-cache.js';
import {
  AdminModelListDto,
  ConnectionTestDto,
  type ModelDto,
  ModelListDto,
  type UnavailableConnectionDto,
} from './models.dto.js';
import {
  PROVIDER_ADAPTERS,
  type ProviderAdapter,
  type RawModel,
} from './provider-adapter.js';
import type { ProviderConnection } from './provider-connection.entity.js';
import { ProviderConnectionsService } from './provider-connections.service.js';
import type { ProviderType } from './provider-type.js';

export interface ResolvedModel {
  model: LanguageModel;
  connection: { id: string; name: string; type: ProviderType };
  rawModelId: string;
}

type Attempt =
  | { connection: ProviderConnection; models: RawModel[] }
  | { connection: ProviderConnection; reason: ProviderErrorReason };

/** Unusable ids (control characters, too long) and duplicates are dropped; the rest can be addressed again. */
function addressable(connectionId: string, models: RawModel[]): RawModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    if (parseModelId(formatModelId(connectionId, model.id)) === undefined) return false;
    seen.add(model.id);
    return true;
  });
}

@Injectable()
export class ModelRegistryService {
  constructor(
    private readonly connections: ProviderConnectionsService,
    @Inject(PROVIDER_ADAPTERS) private readonly adapters: readonly ProviderAdapter[],
    private readonly cache: ModelListCache,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ModelRegistryService.name);
  }

  /**
   * All models of the active connections, without hidden ones. A connection that fails is named with its reason
   * in `unavailableConnections`; the others are not held up. Anything that is not a ProviderError (a bug, an
   * unreadable key) is thrown, not turned into "unavailable".
   */
  async list(): Promise<ModelListDto> {
    const enabled = await this.connections.listEnabled();
    const attempts = await Promise.all(enabled.map((connection) => this.attempt(connection)));

    const models: ModelDto[] = [];
    const unavailableConnections: UnavailableConnectionDto[] = [];
    for (const attempt of attempts) {
      const { connection } = attempt;
      if ('reason' in attempt) {
        unavailableConnections.push({
          id: connection.id,
          name: connection.name,
          reason: attempt.reason,
        });
        continue;
      }
      for (const model of attempt.models) {
        if (connection.hiddenModelIds.includes(model.id)) continue;
        models.push({
          id: formatModelId(connection.id, model.id),
          name: model.name,
          connectionId: connection.id,
          providerName: connection.name,
          providerType: connection.type,
        });
      }
    }
    models.sort(
      (a, b) => a.providerName.localeCompare(b.providerName) || a.name.localeCompare(b.name)
    );
    return { models, unavailableConnections };
  }

  /** Admin: every model of one connection, hidden ones flagged. Works for a disabled connection, too. */
  async listForConnection(connectionId: string): Promise<AdminModelListDto> {
    const connection = await this.connections.get(connectionId);
    const models = await this.fetchModels(connection, false);
    return {
      models: models.map((model) => ({
        rawModelId: model.id,
        name: model.name,
        hidden: connection.hiddenModelIds.includes(model.id),
      })),
    };
  }

  /** Admin: asks the provider now (never from the cache); a failure is thrown with its reason. */
  async test(connectionId: string): Promise<ConnectionTestDto> {
    const connection = await this.connections.get(connectionId);
    const models = await this.fetchModels(connection, true);
    return { ok: true, modelCount: models.length };
  }

  /**
   * The AI SDK model for an id from `list()`. Checks only what the registry owns: the connection is active and
   * the model is not hidden. It makes no call to the provider; a model the provider does not know fails when it
   * is used. Every refusal is the same 404 so the answer does not tell which part was wrong.
   */
  async resolve(modelId: string): Promise<ResolvedModel> {
    const parsed = parseModelId(modelId);
    if (parsed === undefined) throw new NotFoundException('Model not found');
    const connection = await this.connections.findEnabled(parsed.connectionId);
    if (connection === null || connection.hiddenModelIds.includes(parsed.rawModelId)) {
      throw new NotFoundException('Model not found');
    }
    const model = this.adapterFor(connection.type).languageModel(
      this.connections.targetOf(connection),
      parsed.rawModelId
    );
    return {
      model,
      connection: { id: connection.id, name: connection.name, type: connection.type },
      rawModelId: parsed.rawModelId,
    };
  }

  private async attempt(connection: ProviderConnection): Promise<Attempt> {
    try {
      return { connection, models: await this.fetchModels(connection, false) };
    } catch (error) {
      if (error instanceof ProviderError) return { connection, reason: error.reason };
      throw error;
    }
  }

  private async fetchModels(connection: ProviderConnection, fresh: boolean): Promise<RawModel[]> {
    if (!fresh) {
      const cached = this.cache.get(connection.id);
      if (cached !== undefined) return cached;
    }
    const ticket = this.cache.ticket(connection.id);
    const adapter = this.adapterFor(connection.type);
    const target = this.connections.targetOf(connection);
    const started = Date.now();
    try {
      const models = addressable(connection.id, await adapter.listModels(target));
      this.cache.set(connection.id, models, ticket);
      this.logger.info(
        {
          connectionId: connection.id,
          type: connection.type,
          models: models.length,
          durationMs: Date.now() - started,
        },
        'Model list fetched'
      );
      return models;
    } catch (error) {
      if (error instanceof ProviderError) {
        this.logger.warn(
          {
            connectionId: connection.id,
            type: connection.type,
            reason: error.reason,
            durationMs: Date.now() - started,
          },
          'Model list failed'
        );
      }
      throw error;
    }
  }

  private adapterFor(type: ProviderType): ProviderAdapter {
    const adapter = this.adapters.find((candidate) => candidate.type === type);
    if (adapter === undefined) throw new Error(`No adapter for the provider type "${type}"`);
    return adapter;
  }
}
```

Hinweise:

- Der Cache speichert die ungefilterte Liste; „ausgeblendet“ wird bei jedem Lesen aus der Verbindung angewandt. Darum wirkt eine geänderte Ausblend-Liste sofort, auch wenn der Cache nicht verworfen würde (der Test „shows a changed hide list at once“ hält das fest).
- `AdminModelListDto`, `ConnectionTestDto` und `ModelListDto` werden als Werte importiert, weil sie hier nur als Typen dienen; ESLint (`consistent-type-imports`) verlangt dann `import type`. Das beim Lint-Lauf entsprechend korrigieren, die Aussage bleibt.

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/models`
Expected: PASS (inklusive der Tests aus Task 3, 4 und 7).

- [ ] **Step 7: Prüfen, Commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add apps/api/src/testing/provider-fixtures.ts apps/api/src/models/models.dto.ts apps/api/src/models/model-list-cache.ts apps/api/src/models/model-list-cache.spec.ts apps/api/src/models/model-registry.service.ts apps/api/src/models/model-registry.service.spec.ts apps/api/src/models/provider-connections.service.ts
git commit -m "feat(api): add the model registry with a short-lived list cache" -m "list() asks all active connections in parallel and names failures with their reason; resolve() returns the AI SDK model for the chat. The cache drops answers that arrive after an invalidation." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Mutation prüfen**

Nacheinander mit `git checkout -- <Datei>` zurücksetzen:

1. In `model-registry.service.ts` die Zeile `if (connection.hiddenModelIds.includes(model.id)) continue;` entfernen. Expected: „leaves out hidden models…“ und „shows a changed hide list…“ werden rot.
2. In `resolve()` die Bedingung `connection.hiddenModelIds.includes(parsed.rawModelId)` entfernen. Expected: „refuses a hidden model…“ wird rot.
3. In `model-list-cache.ts` den Vergleich `ticket !== this.ticket(connectionId)` entfernen. Expected: „drops an answer that was requested before an invalidation“ wird rot.

Danach `pnpm --filter @owui/api exec vitest run src/models` wieder grün. Kein Commit.

---

### Task 9: `ProviderConnectionsService` (Anlegen, Ändern, Löschen, Audit)

**Files:**
- Modify: `apps/api/src/models/provider-connections.service.ts`
- Create: `apps/api/src/models/provider-connections.service.db.spec.ts`

**Interfaces:**
- Consumes: `SecretBox.encrypt/decrypt` (Task 3); `normalizeBaseUrl`, `InvalidBaseUrlError` (Task 4); `ProviderFetchService.assertHostAllowed` (Task 5); `ProviderConnection` (Task 6); `ModelListCache.invalidate` (Task 8); `AuditService.record`, `AUDIT_ACTION.PROVIDER_CONNECTION_*` (Task 2); `PROVIDER_TYPE`.
- Produces: zusätzlich zu den vier Lese-Methoden aus Task 8:
  - `interface NewConnection { name: string; type: ProviderType; baseUrl: string; apiKey?: string; enabled?: boolean }`.
  - `interface ConnectionPatch { name?: string; baseUrl?: string; apiKey?: string | null; enabled?: boolean; hiddenModelIds?: string[] }` (`apiKey`: fehlt = unverändert, `null` = löschen, String = ersetzen; der Typ ist nicht änderbar).
  - `list(): Promise<ProviderConnection[]>` (nach Name), `create(actorId: string, input: NewConnection): Promise<ProviderConnection>`, `update(actorId: string, id: string, patch: ConnectionPatch): Promise<ProviderConnection>`, `remove(actorId: string, id: string): Promise<void>`.
  - Fehler: `422` (`UnprocessableEntityException`) für ungültige URL oder gesperrten Host, `409` (`ConflictException`) für vergebenen Namen, `404` (`NotFoundException`) für unbekannte ID.
  - Konstruktor: `(dataSource: DataSource, secretBox: SecretBox, providerFetch: ProviderFetchService, cache: ModelListCache, audit: AuditService)`.

- [ ] **Step 1: Fehlschlagende Tests schreiben**

`apps/api/src/models/provider-connections.service.db.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditLog } from '../database/audit/audit-log.entity.js';
import { AuditService } from '../database/audit/audit.service.js';
import { parseAllowedHost } from '../http/safe-fetch/address-policy.js';
import {
  PROVIDER_FETCH_DEFAULTS,
  ProviderFetchService,
} from '../http/safe-fetch/provider-fetch.service.js';
import { resetProviderTables } from '../testing/db-fixtures.js';
import { configOf, TEST_KEY_RING } from '../testing/provider-fixtures.js';
import { ModelListCache } from './model-list-cache.js';
import { ProviderConnection } from './provider-connection.entity.js';
import { ProviderConnectionsService } from './provider-connections.service.js';
import { PROVIDER_TYPE } from './provider-type.js';
import { SECRET_BOX_ERROR, SecretBox, SecretBoxError } from './secret-box.js';

const ACTOR = randomUUID();
const SECRET = 'sk-very-secret-value';

/** Names the tests use: allowed.test -> a public-looking address on the list, blocked.test -> metadata. */
const ADDRESSES: Record<string, string> = {
  'allowed.test': '10.0.0.5',
  'blocked.test': '169.254.169.254',
  'public.test': '93.184.216.34',
};

describe('ProviderConnectionsService (database)', () => {
  let dataSource: DataSource;
  let service: ProviderConnectionsService;
  let secretBox: SecretBox;
  let cache: ModelListCache;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
    secretBox = new SecretBox(configOf({ PROVIDER_KEY_ENCRYPTION_KEYS: TEST_KEY_RING }));
    cache = new ModelListCache(configOf({ MODEL_LIST_CACHE_TTL_MS: 60_000 }));
    const providerFetch = new ProviderFetchService({
      ...PROVIDER_FETCH_DEFAULTS,
      timeoutMs: 1000,
      allowedHosts: [parseAllowedHost('allowed.test')],
      lookup: (hostname) => {
        const address = ADDRESSES[hostname];
        return address === undefined
          ? Promise.reject(new Error('ENOTFOUND'))
          : Promise.resolve([{ address, family: 4 }]);
      },
    });
    service = new ProviderConnectionsService(
      dataSource,
      secretBox,
      providerFetch,
      cache,
      new AuditService(dataSource.getRepository(AuditLog))
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await resetProviderTables(dataSource);
  });

  const input = (overrides: Partial<Parameters<ProviderConnectionsService['create']>[1]> = {}) => ({
    name: 'Lokales Ollama',
    type: PROVIDER_TYPE.OLLAMA,
    baseUrl: 'http://allowed.test:11434',
    ...overrides,
  });

  async function auditOf(targetId: string): Promise<AuditLog[]> {
    return dataSource.getRepository(AuditLog).find({ where: { targetId }, order: { occurredAt: 'ASC' } });
  }

  async function stored(id: string): Promise<ProviderConnection> {
    return dataSource.getRepository(ProviderConnection).findOneByOrFail({ id });
  }

  describe('create', () => {
    it('stores the normalized URL, encrypts the key and audits without the key', async () => {
      const created = await service.create(
        ACTOR,
        input({ baseUrl: 'HTTP://Allowed.test:11434//', apiKey: SECRET })
      );

      const row = await stored(created.id);
      expect(row.baseUrl).toBe('http://allowed.test:11434');
      expect(row.enabled).toBe(true);
      expect(row.apiKeyCiphertext).toMatch(/^v1\./);
      expect(row.apiKeyCiphertext).not.toContain(SECRET);
      expect(secretBox.decrypt(row.apiKeyCiphertext ?? '', row.id)).toBe(SECRET);

      const [entry] = await auditOf(created.id);
      expect(entry).toMatchObject({
        actorId: ACTOR,
        action: AUDIT_ACTION.PROVIDER_CONNECTION_CREATED,
        targetType: 'provider_connection',
        metadata: { name: 'Lokales Ollama', type: PROVIDER_TYPE.OLLAMA },
      });
      expect(JSON.stringify(entry)).not.toContain(SECRET);
      expect(JSON.stringify(entry)).not.toContain('v1.');
    });

    it('stores no ciphertext when there is no key', async () => {
      const created = await service.create(ACTOR, input());

      expect((await stored(created.id)).apiKeyCiphertext).toBeNull();
    });

    it.each([
      'http://user:pass@allowed.test',
      'http://allowed.test/v1?token=abc',
      'ftp://allowed.test',
      'allowed.test:11434',
      'not a url',
      '',
    ])('refuses the URL %j with 422 and stores nothing', async (baseUrl) => {
      await expect(service.create(ACTOR, input({ baseUrl, apiKey: SECRET }))).rejects.toThrow(
        UnprocessableEntityException
      );

      expect(await dataSource.getRepository(ProviderConnection).count()).toBe(0);
    });

    it('refuses a blocked host with 422, even if it is on no list', async () => {
      for (const baseUrl of ['http://blocked.test', 'http://169.254.169.254', 'http://10.0.0.9', 'http://public.test/']) {
        const attempt = service.create(ACTOR, input({ baseUrl, name: baseUrl }));
        if (baseUrl === 'http://public.test/') {
          await expect(attempt).resolves.toBeDefined();
        } else {
          await expect(attempt).rejects.toThrow(UnprocessableEntityException);
        }
      }
      expect(await dataSource.getRepository(ProviderConnection).count()).toBe(1);
    });

    it('saves a name that does not resolve yet (a container that is still starting)', async () => {
      const created = await service.create(ACTOR, input({ baseUrl: 'http://not-yet.test:11434' }));

      expect((await stored(created.id)).baseUrl).toBe('http://not-yet.test:11434');
    });

    it('answers 409 for a name that is taken', async () => {
      await service.create(ACTOR, input());

      await expect(service.create(ACTOR, input({ baseUrl: 'http://public.test' }))).rejects.toThrow(
        ConflictException
      );
    });

    it('lets exactly one of two parallel creations with the same name win', async () => {
      const results = await Promise.allSettled([
        service.create(ACTOR, input()),
        service.create(ACTOR, input()),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictException);
      expect(await dataSource.getRepository(ProviderConnection).count()).toBe(1);
    });
  });

  describe('update', () => {
    it('leaves the key alone when the field is missing, replaces it with a string, removes it with null', async () => {
      const created = await service.create(ACTOR, input({ apiKey: SECRET }));
      const before = (await stored(created.id)).apiKeyCiphertext;

      await service.update(ACTOR, created.id, { name: 'Umbenannt' });
      expect((await stored(created.id)).apiKeyCiphertext).toBe(before);

      await service.update(ACTOR, created.id, { apiKey: 'sk-new' });
      const replaced = (await stored(created.id)).apiKeyCiphertext;
      expect(replaced).not.toBe(before);
      expect(secretBox.decrypt(replaced ?? '', created.id)).toBe('sk-new');

      await service.update(ACTOR, created.id, { apiKey: null });
      expect((await stored(created.id)).apiKeyCiphertext).toBeNull();
    });

    it('changes the fields it is given and normalizes the URL', async () => {
      const created = await service.create(ACTOR, input());

      const updated = await service.update(ACTOR, created.id, {
        baseUrl: 'https://public.test/v1/',
        enabled: false,
        hiddenModelIds: ['llama3:8b', 'llama3:8b', 'hf.co/acme/m:Q4'],
      });

      expect(updated).toMatchObject({
        baseUrl: 'https://public.test/v1',
        enabled: false,
        hiddenModelIds: ['llama3:8b', 'hf.co/acme/m:Q4'],
      });
      expect(await stored(created.id)).toMatchObject({ enabled: false, name: 'Lokales Ollama' });
    });

    it('checks the host of a new URL', async () => {
      const created = await service.create(ACTOR, input());

      await expect(
        service.update(ACTOR, created.id, { baseUrl: 'http://blocked.test' })
      ).rejects.toThrow(UnprocessableEntityException);
      await expect(
        service.update(ACTOR, created.id, { baseUrl: 'http://u:p@public.test' })
      ).rejects.toThrow(UnprocessableEntityException);
      expect((await stored(created.id)).baseUrl).toBe('http://allowed.test:11434');
    });

    it('answers 409 when renaming to a taken name, but may keep its own name', async () => {
      await service.create(ACTOR, input({ name: 'A' }));
      const b = await service.create(ACTOR, input({ name: 'B' }));

      await expect(service.update(ACTOR, b.id, { name: 'A' })).rejects.toThrow(ConflictException);
      await expect(service.update(ACTOR, b.id, { name: 'B' })).resolves.toBeDefined();
    });

    it('answers 404 for an unknown connection', async () => {
      await expect(service.update(ACTOR, randomUUID(), { enabled: false })).rejects.toThrow(
        NotFoundException
      );
    });

    it('audits the names of the changed fields only, never values', async () => {
      const created = await service.create(ACTOR, input());

      await service.update(ACTOR, created.id, { apiKey: SECRET, enabled: false, name: 'Neu' });

      const updated = (await auditOf(created.id)).find(
        (entry) => entry.action === AUDIT_ACTION.PROVIDER_CONNECTION_UPDATED
      );
      expect(updated?.metadata).toEqual({ name: 'Neu', changed: ['name', 'enabled', 'apiKey'] });
      expect(JSON.stringify(updated)).not.toContain(SECRET);
    });

    it('writes no audit entry when nothing changed', async () => {
      const created = await service.create(ACTOR, input());

      await service.update(ACTOR, created.id, { name: 'Lokales Ollama', enabled: true });

      expect(await auditOf(created.id)).toHaveLength(1);
    });

    it('discards the cached model list of the connection', async () => {
      const created = await service.create(ACTOR, input());
      cache.set(created.id, [{ id: 'm', name: 'm' }], cache.ticket(created.id));
      expect(cache.get(created.id)).toBeDefined();

      await service.update(ACTOR, created.id, { enabled: false });

      expect(cache.get(created.id)).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('deletes the connection, discards its cache and audits it', async () => {
      const created = await service.create(ACTOR, input({ apiKey: SECRET }));
      cache.set(created.id, [{ id: 'm', name: 'm' }], cache.ticket(created.id));

      await service.remove(ACTOR, created.id);

      expect(await dataSource.getRepository(ProviderConnection).existsBy({ id: created.id })).toBe(false);
      expect(cache.get(created.id)).toBeUndefined();
      const entries = await auditOf(created.id);
      expect(entries.at(-1)).toMatchObject({
        action: AUDIT_ACTION.PROVIDER_CONNECTION_DELETED,
        metadata: { name: 'Lokales Ollama' },
      });
    });

    it('answers 404 for an unknown connection', async () => {
      await expect(service.remove(ACTOR, randomUUID())).rejects.toThrow(NotFoundException);
    });
  });

  describe('reading', () => {
    it('lists by name, finds only enabled connections as enabled', async () => {
      const b = await service.create(ACTOR, input({ name: 'B' }));
      const a = await service.create(ACTOR, input({ name: 'A', enabled: false }));

      expect((await service.list()).map((item) => item.name)).toEqual(['A', 'B']);
      expect((await service.listEnabled()).map((item) => item.name)).toEqual(['B']);
      expect(await service.findEnabled(a.id)).toBeNull();
      expect((await service.findEnabled(b.id))?.id).toBe(b.id);
      await expect(service.get(randomUUID())).rejects.toThrow(NotFoundException);
    });

    it('targetOf decrypts the key for the call and gives undefined without one', async () => {
      const withKey = await service.create(ACTOR, input({ name: 'K', apiKey: SECRET }));
      const without = await service.create(ACTOR, input({ name: 'N' }));

      expect(service.targetOf(await stored(withKey.id))).toEqual({
        connectionId: withKey.id,
        baseUrl: 'http://allowed.test:11434',
        apiKey: SECRET,
      });
      expect(service.targetOf(await stored(without.id)).apiKey).toBeUndefined();
    });

    it('does not decrypt a ciphertext that was copied into another row', async () => {
      const a = await service.create(ACTOR, input({ name: 'A', apiKey: SECRET }));
      const b = await service.create(ACTOR, input({ name: 'B' }));
      const copied = Object.assign(await stored(b.id), {
        apiKeyCiphertext: (await stored(a.id)).apiKeyCiphertext,
      });

      let code: string | undefined;
      try {
        service.targetOf(copied);
      } catch (error) {
        code = error instanceof SecretBoxError ? error.code : undefined;
      }

      expect(code).toBe(SECRET_BOX_ERROR.TAMPERED);
    });
  });
});
```

Der Test „refuses a blocked host…“ mischt Erwartungen in einer Schleife; `http://10.0.0.9` ist gesperrt, weil nur `allowed.test` auf der Liste steht, `http://public.test/` ist erlaubt (öffentliche Adresse). Lässt sich das übersichtlicher in zwei `it`-Blöcke trennen, ist das gewollt: erst `it.each` für die drei gesperrten URLs, dann ein Test für die öffentliche.

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm db:up && pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/models/provider-connections.service.db.spec.ts`
Expected: FAIL (`create`, `update`, `remove`, `list` fehlen; Konstruktor hat andere Parameter).

- [ ] **Step 3: Implementieren**

`apps/api/src/models/provider-connections.service.ts` ersetzen durch:

```ts
import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { AUDIT_ACTION } from '../database/audit/audit-action.js';
import { AuditService } from '../database/audit/audit.service.js';
import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { ProviderFetchService } from '../http/safe-fetch/provider-fetch.service.js';
import { InvalidBaseUrlError, normalizeBaseUrl } from './base-url.js';
import { ModelListCache } from './model-list-cache.js';
import type { ProviderTarget } from './provider-adapter.js';
import { ProviderConnection } from './provider-connection.entity.js';
import type { ProviderType } from './provider-type.js';
import { SecretBox } from './secret-box.js';

/** One advisory lock serializes writes that depend on the names of the other connections. */
const CONNECTIONS_LOCK_KEY = 7102;

export interface NewConnection {
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
}

/** `apiKey`: missing = unchanged, `null` = remove, a string = replace. The type cannot be changed. */
export interface ConnectionPatch {
  name?: string;
  baseUrl?: string;
  apiKey?: string | null;
  enabled?: boolean;
  hiddenModelIds?: string[];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

@Injectable()
export class ProviderConnectionsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly secretBox: SecretBox,
    private readonly providerFetch: ProviderFetchService,
    private readonly cache: ModelListCache,
    private readonly audit: AuditService
  ) {}

  list(): Promise<ProviderConnection[]> {
    return this.dataSource.getRepository(ProviderConnection).find({ order: { name: 'ASC' } });
  }

  listEnabled(): Promise<ProviderConnection[]> {
    return this.dataSource
      .getRepository(ProviderConnection)
      .find({ where: { enabled: true }, order: { name: 'ASC' } });
  }

  async get(id: string): Promise<ProviderConnection> {
    const found = await this.dataSource.getRepository(ProviderConnection).findOneBy({ id });
    if (found === null) throw new NotFoundException('Connection not found');
    return found;
  }

  findEnabled(id: string): Promise<ProviderConnection | null> {
    return this.dataSource.getRepository(ProviderConnection).findOneBy({ id, enabled: true });
  }

  /** Decrypts the key. The result lives for one call and is never logged or returned. */
  targetOf(connection: ProviderConnection): ProviderTarget {
    return {
      connectionId: connection.id,
      baseUrl: connection.baseUrl,
      apiKey:
        connection.apiKeyCiphertext === null
          ? undefined
          : this.secretBox.decrypt(connection.apiKeyCiphertext, connection.id),
    };
  }

  async create(actorId: string, input: NewConnection): Promise<ProviderConnection> {
    // The host check resolves DNS: do it before the lock so a slow resolver does not block other admins.
    const baseUrl = await this.checkedBaseUrl(input.baseUrl);
    // The id is chosen here: it is part of the authenticated data of the encrypted key.
    const id = randomUUID();
    const created = await this.withLock(async (manager) => {
      await this.assertNameFree(manager, input.name);
      return manager.save(
        manager.create(ProviderConnection, {
          id,
          name: input.name,
          type: input.type,
          baseUrl,
          apiKeyCiphertext:
            input.apiKey === undefined ? null : this.secretBox.encrypt(input.apiKey, id),
          enabled: input.enabled ?? true,
          hiddenModelIds: [],
        })
      );
    });
    await this.audit.record({
      actorId,
      action: AUDIT_ACTION.PROVIDER_CONNECTION_CREATED,
      targetType: 'provider_connection',
      targetId: created.id,
      metadata: { name: created.name, type: created.type },
    });
    return created;
  }

  async update(actorId: string, id: string, patch: ConnectionPatch): Promise<ProviderConnection> {
    const baseUrl = patch.baseUrl === undefined ? undefined : await this.checkedBaseUrl(patch.baseUrl);
    const { saved, changed } = await this.withLock(async (manager) => {
      const found = await manager.findOneBy(ProviderConnection, { id });
      if (found === null) throw new NotFoundException('Connection not found');
      const changed: string[] = [];

      if (patch.name !== undefined && patch.name !== found.name) {
        await this.assertNameFree(manager, patch.name);
        found.name = patch.name;
        changed.push('name');
      }
      if (baseUrl !== undefined && baseUrl !== found.baseUrl) {
        found.baseUrl = baseUrl;
        changed.push('baseUrl');
      }
      if (patch.enabled !== undefined && patch.enabled !== found.enabled) {
        found.enabled = patch.enabled;
        changed.push('enabled');
      }
      if (patch.hiddenModelIds !== undefined) {
        const hidden = [...new Set(patch.hiddenModelIds)];
        if (!sameList(hidden, found.hiddenModelIds)) {
          found.hiddenModelIds = hidden;
          changed.push('hiddenModelIds');
        }
      }
      if (patch.apiKey !== undefined) {
        const next = patch.apiKey === null ? null : this.secretBox.encrypt(patch.apiKey, id);
        if (next !== found.apiKeyCiphertext) {
          found.apiKeyCiphertext = next;
          changed.push('apiKey');
        }
      }
      return { saved: changed.length > 0 ? await manager.save(found) : found, changed };
    });

    if (changed.length > 0) {
      this.cache.invalidate(id);
      await this.audit.record({
        actorId,
        action: AUDIT_ACTION.PROVIDER_CONNECTION_UPDATED,
        targetType: 'provider_connection',
        targetId: id,
        metadata: { name: saved.name, changed },
      });
    }
    return saved;
  }

  async remove(actorId: string, id: string): Promise<void> {
    const name = await this.withLock(async (manager) => {
      const found = await manager.findOneBy(ProviderConnection, { id });
      if (found === null) throw new NotFoundException('Connection not found');
      await manager.delete(ProviderConnection, { id });
      return found.name;
    });
    this.cache.invalidate(id);
    await this.audit.record({
      actorId,
      action: AUDIT_ACTION.PROVIDER_CONNECTION_DELETED,
      targetType: 'provider_connection',
      targetId: id,
      metadata: { name },
    });
  }

  /**
   * Normalizes the URL and refuses a host that may never be reached. A name that does not resolve yet is
   * saved: the container may still be starting, and every call checks the address again anyway.
   */
  private async checkedBaseUrl(raw: string): Promise<string> {
    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(raw);
    } catch (error) {
      if (error instanceof InvalidBaseUrlError) throw new UnprocessableEntityException(error.message);
      throw error;
    }
    try {
      await this.providerFetch.assertHostAllowed(baseUrl);
    } catch (error) {
      if (error instanceof ProviderError && error.reason === PROVIDER_ERROR.BLOCKED_HOST) {
        throw new UnprocessableEntityException('This host is not allowed for model providers');
      }
      if (!(error instanceof ProviderError && error.reason === PROVIDER_ERROR.UNREACHABLE)) {
        throw error;
      }
    }
    return baseUrl;
  }

  private withLock<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [CONNECTIONS_LOCK_KEY]);
      return work(manager);
    });
  }

  private async assertNameFree(manager: EntityManager, name: string): Promise<void> {
    if (await manager.existsBy(ProviderConnection, { name })) {
      throw new ConflictException('A connection with this name already exists');
    }
  }
}
```

Hinweise:

- Der Rumpf aus Task 8 wird vollständig ersetzt; seine vier Lese-Methoden stehen unverändert wieder da, `list()` ist neu.
- Das Sperren mit `pg_advisory_xact_lock` und die Vorabprüfung sind die Antwort auf „zwei Admins legen gleichzeitig denselben Namen an“; der eindeutige Index (Task 6) bleibt das Netz darunter.
- `assertNameFree` beim Umbenennen läuft nur, wenn sich der Name ändert; damit bleibt der eigene Name erlaubt.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/models`
Expected: PASS. Dann `pnpm --filter @owui/api exec vitest run src/models` (ohne DB, Registry-Spec): weiter PASS.

- [ ] **Step 5: Prüfen, Commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add apps/api/src/models/provider-connections.service.ts apps/api/src/models/provider-connections.service.db.spec.ts
git commit -m "feat(api): add ProviderConnectionsService" -m "Create, update and delete with a host check (422), advisory lock against parallel names (409), key encryption bound to the connection id, cache invalidation and audit entries without values." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Mutation prüfen**

Nacheinander, jeweils mit `git checkout -- apps/api/src/models/provider-connections.service.ts` zurücksetzen:

1. In `checkedBaseUrl` den Aufruf `await this.providerFetch.assertHostAllowed(baseUrl);` entfernen. Expected: „refuses a blocked host with 422“ und „checks the host of a new URL“ werden rot.
2. In `withLock` die Zeile mit `pg_advisory_xact_lock` entfernen. Expected: „lets exactly one of two parallel creations…“ wird rot (zwei Anläufe nötig, falls der Wettlauf einmal zufällig gewinnt; der Test steht dann trotzdem im Verdacht, zu schwach zu sein, und wird verstärkt, indem er `Promise.allSettled` über fünf parallele Aufrufe bildet).
3. In `update` `this.cache.invalidate(id);` entfernen. Expected: „discards the cached model list of the connection“ wird rot.

Danach DB-Tests wieder grün. Kein Commit.

---

### Task 10: DTOs, Controller, Modul und Fehlerantwort `502` mit `reason`

**Files:**
- Create: `apps/api/src/testing/fake-auth.ts`, `apps/api/src/models/provider-connections.dto.ts`, `apps/api/src/models/provider-connections.controller.ts`, `apps/api/src/models/models.controller.ts`, `apps/api/src/models/models.module.ts`, `apps/api/src/models/models-routes.spec.ts`
- Modify: `apps/api/src/common/problem-details.filter.ts`, `apps/api/src/common/problem-details.filter.spec.ts`

**Interfaces:**
- Consumes: `ProviderConnectionsService` (Task 9), `ModelRegistryService` und `models.dto.ts` (Task 8), `SecretBox` (Task 3), `ModelListCache` (Task 8), Adapter (Task 7), `SafeFetchModule` mit `ProviderFetchService` (Task 5), `AuditModule`, `AuthGuard`, `Roles`, `CurrentUser`.
- Produces:
  - Routen (alle mit Präfix `/api`): `GET/POST /admin/provider-connections`, `PATCH/DELETE /admin/provider-connections/:id`, `POST /admin/provider-connections/:id/test` (200, `@Throttle` 10 je Minute), `GET /admin/provider-connections/:id/models`, `GET /models`.
  - `ProviderConnectionDto { id, name, type, baseUrl, hasApiKey, enabled, hiddenModelIds, createdAt, updatedAt }`, `toProviderConnectionDto(connection)`, `CreateProviderConnectionDto`, `UpdateProviderConnectionDto`.
  - `ModelsModule` (exportiert `ModelRegistryService`).
  - `ProblemDetails.reason?: ProviderErrorReason`; jede `ProviderError`, die einen Controller verlässt, wird zu `502` mit `reason`.
  - Test-Hilfe `fakeAuth()`: `{ providers: Provider[]; session(role): Record<string, string>; key(role): Record<string, string> }` (Header eines angemeldeten Browsers beziehungsweise eines API-Keys; Rollen `admin`, `user`, `pending` für Sessions, `admin` und `user` für Keys).

- [ ] **Step 1: Test für die Fehlerantwort schreiben**

An `apps/api/src/common/problem-details.filter.spec.ts` drei Änderungen:

1. Imports ergänzen:

```ts
import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
```

2. In `ProbeController` eine Route ergänzen (nach `teapot`):

```ts
  @Get('provider')
  provider(): never {
    throw new ProviderError(
      PROVIDER_ERROR.UNREACHABLE,
      'connect ECONNREFUSED 10.0.0.5:11434 with key sk-abc'
    );
  }
```

3. Im `describe('HTTP error handling', …)` einen Test ergänzen:

```ts
  it('answers a failed provider call with 502 and the reason, never with its message', async () => {
    const http = await start();

    const response = await http.get('/api/provider').expect(502);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toMatchObject({
      status: 502,
      title: 'Bad Gateway',
      reason: PROVIDER_ERROR.UNREACHABLE,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5|sk-abc|ECONNREFUSED/);
  });

  it('adds no reason to other errors', async () => {
    const http = await start();

    const response = await http.get('/api/boom').expect(500);

    expect(response.body).not.toHaveProperty('reason');
  });
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/common/problem-details.filter.spec.ts`
Expected: FAIL (`ProviderError` wird heute zu `500`).

- [ ] **Step 3: Filter erweitern**

In `apps/api/src/common/problem-details.filter.ts`:

Import ergänzen:

```ts
import { ProviderError, type ProviderErrorReason } from '../http/safe-fetch/provider-error.js';
```

`ProblemDetails` und `Description` um das Feld erweitern:

```ts
export interface ProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  errors?: string[];
  /** Set for 502 when a model provider could not be used. */
  reason?: ProviderErrorReason;
}

interface Description {
  status: number;
  detail: string;
  errors?: string[];
  reason?: ProviderErrorReason;
}
```

In `catch` die Beschreibung auslesen, für `ProviderError` kein „Unhandled“-Fehlerlog schreiben und `reason` in die Antwort übernehmen:

```ts
    const { status, detail, errors, reason } = this.describe(exception);

    if (reason !== undefined) {
      this.logger.warn({ reason }, 'Model provider call failed');
    } else if (status >= 500) {
      this.logger.error({ err: exception }, 'Unhandled exception');
    }

    const problem: ProblemDetails = {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Error',
      status,
      detail,
      // originalUrl keeps the global prefix; request.path is relative to the router mount.
      instance: request.originalUrl.split('?')[0] ?? request.path,
      requestId: typeof request.id === 'string' ? request.id : '',
      ...(errors ? { errors } : {}),
      ...(reason ? { reason } : {}),
    };
```

Am Anfang von `describe(exception)` ergänzen:

```ts
    if (exception instanceof ProviderError) {
      // Fixed text: the message of the error may name hosts or echo parts of the provider answer.
      return { status: 502, detail: 'The model provider could not be used', reason: exception.reason };
    }
```

- [ ] **Step 4: Test laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/common`
Expected: PASS.

- [ ] **Step 5: Test-Hilfe für die Anmeldung schreiben**

Dritte Verwendung desselben Aufbaus (nach `auth.guard.spec.ts` und den beiden Routen-Specs dieses Tasks), darum wird er jetzt gemeinsam genutzt. `apps/api/src/testing/fake-auth.ts`:

```ts
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
```

Weicht ein Feldname der Entities `Session` oder `ApiKey` ab (siehe `auth.guard.spec.ts`, dort stehen dieselben Felder), die Hilfe daran angleichen. `auth.guard.spec.ts` bleibt unverändert (SoC vor DRY für bestehende Tests).

- [ ] **Step 6: Fehlschlagende Routen-Tests schreiben**

`apps/api/src/models/models-routes.spec.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { createTestApp } from '../testing/create-test-app.js';
import { fakeAuth } from '../testing/fake-auth.js';
import { USER_ROLE } from '../users/user-role.js';
import { ModelRegistryService } from './model-registry.service.js';
import { ModelsController } from './models.controller.js';
import { ProviderConnection } from './provider-connection.entity.js';
import { ProviderConnectionsController } from './provider-connections.controller.js';
import { ProviderConnectionsService } from './provider-connections.service.js';
import { PROVIDER_TYPE } from './provider-type.js';

const ID = randomUUID();
const CIPHERTEXT = 'v1.test.AAAAAAAAAAAAAAAA.ciphertext-that-must-not-leave';

function makeConnection(): ProviderConnection {
  return Object.assign(new ProviderConnection(), {
    id: ID,
    name: 'Lokales Ollama',
    type: PROVIDER_TYPE.OLLAMA,
    baseUrl: 'http://ollama:11434',
    apiKeyCiphertext: CIPHERTEXT,
    enabled: true,
    hiddenModelIds: ['mistral:7b'],
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
  });
}

class FakeConnections {
  readonly calls: { method: string; args: unknown[] }[] = [];
  readonly entity = makeConnection();
  failure: Error | undefined;

  list() {
    return this.record('list', [], [this.entity]);
  }
  create(actorId: string, input: unknown) {
    return this.record('create', [actorId, input], this.entity);
  }
  update(actorId: string, id: string, patch: unknown) {
    return this.record('update', [actorId, id, patch], this.entity);
  }
  remove(actorId: string, id: string) {
    return this.record('remove', [actorId, id], undefined);
  }

  private record<T>(method: string, args: unknown[], result: T): Promise<T> {
    this.calls.push({ method, args });
    return this.failure === undefined ? Promise.resolve(result) : Promise.reject(this.failure);
  }
}

class FakeRegistry {
  failure: Error | undefined;

  list() {
    return Promise.resolve({
      models: [
        {
          id: `${ID}:llama3:8b`,
          name: 'llama3:8b',
          connectionId: ID,
          providerName: 'Lokales Ollama',
          providerType: PROVIDER_TYPE.OLLAMA,
        },
      ],
      unavailableConnections: [],
    });
  }
  listForConnection(_id: string) {
    return this.answer({ models: [{ rawModelId: 'llama3:8b', name: 'llama3:8b', hidden: false }] });
  }
  test(_id: string) {
    return this.answer({ ok: true, modelCount: 2 });
  }

  private answer<T>(result: T): Promise<T> {
    return this.failure === undefined ? Promise.resolve(result) : Promise.reject(this.failure);
  }
}

const VALID_CREATE = {
  name: 'Lokales Ollama',
  type: PROVIDER_TYPE.OLLAMA,
  baseUrl: 'http://ollama:11434',
};

const ADMIN_ROUTES = [
  ['get', '/api/admin/provider-connections'],
  ['post', '/api/admin/provider-connections'],
  ['patch', `/api/admin/provider-connections/${ID}`],
  ['delete', `/api/admin/provider-connections/${ID}`],
  ['post', `/api/admin/provider-connections/${ID}/test`],
  ['get', `/api/admin/provider-connections/${ID}/models`],
] as const;

describe('model routes', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  async function start() {
    const auth = fakeAuth();
    const connections = new FakeConnections();
    const registry = new FakeRegistry();
    app = await createTestApp({
      controllers: [ProviderConnectionsController, ModelsController],
      providers: [
        ...auth.providers,
        { provide: ProviderConnectionsService, useValue: connections },
        { provide: ModelRegistryService, useValue: registry },
      ],
      env: { RATE_LIMIT_LIMIT: '1000', ENABLE_API_KEYS: 'true' },
    });
    return { http: request(app.getHttpServer()), auth, connections, registry };
  }

  describe('access to the admin routes', () => {
    it.each(ADMIN_ROUTES)('%s %s refuses anonymous callers with 401', async (method, url) => {
      const { http, connections } = await start();

      await http[method](url).expect(401);

      expect(connections.calls).toEqual([]);
    });

    it.each(ADMIN_ROUTES)('%s %s refuses a normal user with 403', async (method, url) => {
      const { http, auth, connections } = await start();

      await http[method](url).set(auth.session(USER_ROLE.USER)).expect(403);

      expect(connections.calls).toEqual([]);
    });

    it.each(ADMIN_ROUTES)('%s %s refuses a pending account with 403', async (method, url) => {
      const { http, auth, connections } = await start();

      await http[method](url).set(auth.session(USER_ROLE.PENDING)).expect(403);

      expect(connections.calls).toEqual([]);
    });

    it.each(ADMIN_ROUTES)('%s %s refuses an admin API key with 403', async (method, url) => {
      const { http, auth, connections } = await start();

      await http[method](url).set(auth.key(USER_ROLE.ADMIN)).expect(403);

      expect(connections.calls).toEqual([]);
    });
  });

  describe('what an answer contains', () => {
    it('shows hasApiKey instead of the key or its ciphertext, in every answer', async () => {
      const { http, auth } = await start();
      const admin = auth.session(USER_ROLE.ADMIN);

      const list = await http.get('/api/admin/provider-connections').set(admin).expect(200);
      const created = await http
        .post('/api/admin/provider-connections')
        .set(admin)
        .send({ ...VALID_CREATE, apiKey: 'sk-live-secret' })
        .expect(201);
      const updated = await http
        .patch(`/api/admin/provider-connections/${ID}`)
        .set(admin)
        .send({ enabled: true })
        .expect(200);

      for (const response of [list, created, updated]) {
        const text = JSON.stringify(response.body);
        expect(text).not.toContain(CIPHERTEXT);
        expect(text).not.toContain('sk-live-secret');
        expect(text).not.toContain('apiKey');
      }
      expect(list.body).toEqual([
        {
          id: ID,
          name: 'Lokales Ollama',
          type: PROVIDER_TYPE.OLLAMA,
          baseUrl: 'http://ollama:11434',
          hasApiKey: true,
          enabled: true,
          hiddenModelIds: ['mistral:7b'],
          createdAt: '2026-10-09T10:00:00.000Z',
          updatedAt: '2026-10-09T10:00:00.000Z',
        },
      ]);
    });
  });

  describe('creating', () => {
    it('trims name, URL and key before the service sees them', async () => {
      const { http, auth, connections } = await start();

      await http
        .post('/api/admin/provider-connections')
        .set(auth.session(USER_ROLE.ADMIN))
        .send({ name: '  Lokales Ollama \n', type: PROVIDER_TYPE.OLLAMA, baseUrl: ' http://ollama:11434\n', apiKey: '  sk-abc\n' })
        .expect(201);

      expect(connections.calls[0]?.args[1]).toEqual({
        name: 'Lokales Ollama',
        type: PROVIDER_TYPE.OLLAMA,
        baseUrl: 'http://ollama:11434',
        apiKey: 'sk-abc',
      });
    });

    it.each([
      ['an api key with a line break inside', { apiKey: 'sk-a\nbc' }],
      ['an api key with a space inside', { apiKey: 'sk-a bc' }],
      ['an api key with a control character', { apiKey: 'sk-a\u0000bc' }],
      ['an empty api key', { apiKey: '' }],
      ['an api key of only spaces', { apiKey: '   ' }],
      ['a null api key', { apiKey: null }],
      ['an api key that is too long', { apiKey: 'k'.repeat(513) }],
      ['an unknown field', { extra: 1 }],
      ['an unknown type', { type: 'anthropic' }],
      ['an empty name', { name: '   ' }],
      ['a name of 81 characters', { name: 'n'.repeat(81) }],
      ['a missing URL', { baseUrl: undefined }],
      ['a URL of 2049 characters', { baseUrl: `http://${'a'.repeat(2042)}` }],
      ['a number as enabled', { enabled: 1 }],
    ])('refuses %s with 400 and never calls the service', async (_name, change) => {
      const { http, auth, connections } = await start();

      const response = await http
        .post('/api/admin/provider-connections')
        .set(auth.session(USER_ROLE.ADMIN))
        .send({ ...VALID_CREATE, ...change })
        .expect(400);

      expect(response.headers['content-type']).toMatch(/problem\+json/);
      expect(connections.calls).toEqual([]);
    });
  });

  describe('changing', () => {
    it('passes the key as missing, null or string, as the client sent it', async () => {
      const { http, auth, connections } = await start();
      const admin = auth.session(USER_ROLE.ADMIN);
      const url = `/api/admin/provider-connections/${ID}`;

      await http.patch(url).set(admin).send({ name: 'Neu' }).expect(200);
      await http.patch(url).set(admin).send({ apiKey: null }).expect(200);
      await http.patch(url).set(admin).send({ apiKey: '  sk-new \n' }).expect(200);

      expect(connections.calls.map((call) => call.args[2])).toEqual([
        { name: 'Neu' },
        { apiKey: null },
        { apiKey: 'sk-new' },
      ]);
    });

    it.each([
      ['a type change', { type: PROVIDER_TYPE.OPENAI_COMPATIBLE }],
      ['an api key with a line break inside', { apiKey: 'sk-a\nbc' }],
      ['an empty api key (use null to remove it)', { apiKey: '' }],
      ['hidden models that are not a list', { hiddenModelIds: 'llama3:8b' }],
      ['an empty entry in the hidden models', { hiddenModelIds: [''] }],
      ['more than 1000 hidden models', { hiddenModelIds: Array.from({ length: 1001 }, (_v, i) => `m${i}`) }],
    ])('refuses %s with 400', async (_name, patch) => {
      const { http, auth, connections } = await start();

      await http
        .patch(`/api/admin/provider-connections/${ID}`)
        .set(auth.session(USER_ROLE.ADMIN))
        .send(patch)
        .expect(400);

      expect(connections.calls).toEqual([]);
    });

    it('refuses an id that is not a uuid with 400', async () => {
      const { http, auth } = await start();

      await http
        .patch('/api/admin/provider-connections/not-a-uuid')
        .set(auth.session(USER_ROLE.ADMIN))
        .send({ enabled: false })
        .expect(400);
    });

    it('answers 204 when deleting and passes a 404 of the service on', async () => {
      const { http, auth, connections } = await start();
      const admin = auth.session(USER_ROLE.ADMIN);

      await http.delete(`/api/admin/provider-connections/${ID}`).set(admin).expect(204);
      connections.failure = new NotFoundException('Connection not found');
      await http.delete(`/api/admin/provider-connections/${ID}`).set(admin).expect(404);
    });
  });

  describe('testing a connection', () => {
    it('answers 200 with ok and the number of models', async () => {
      const { http, auth } = await start();

      const response = await http
        .post(`/api/admin/provider-connections/${ID}/test`)
        .set(auth.session(USER_ROLE.ADMIN))
        .expect(200);

      expect(response.body).toEqual({ ok: true, modelCount: 2 });
    });

    it.each(Object.values(PROVIDER_ERROR))('answers 502 with the reason %s', async (reason) => {
      const { http, auth, registry } = await start();
      registry.failure = new ProviderError(reason, 'connect ECONNREFUSED 10.0.0.5:11434 sk-abc');

      const response = await http
        .post(`/api/admin/provider-connections/${ID}/test`)
        .set(auth.session(USER_ROLE.ADMIN))
        .expect(502);

      expect(response.headers['content-type']).toMatch(/problem\+json/);
      expect(response.body).toMatchObject({ status: 502, reason });
      expect(JSON.stringify(response.body)).not.toMatch(/10\.0\.0\.5|sk-abc/);
    });

    it('also answers 502 with the reason when listing the models of a connection fails', async () => {
      const { http, auth, registry } = await start();
      registry.failure = new ProviderError(PROVIDER_ERROR.TIMEOUT, 'slow');

      const response = await http
        .get(`/api/admin/provider-connections/${ID}/models`)
        .set(auth.session(USER_ROLE.ADMIN))
        .expect(502);

      expect(response.body.reason).toBe(PROVIDER_ERROR.TIMEOUT);
    });

    it('allows 10 tests a minute and then answers 429, without touching other routes', async () => {
      const { http, auth } = await start();
      const admin = auth.session(USER_ROLE.ADMIN);
      const test = () => http.post(`/api/admin/provider-connections/${ID}/test`).set(admin);

      for (let call = 0; call < 10; call += 1) await test().expect(200);
      await test().expect(429);

      await http.get('/api/admin/provider-connections').set(admin).expect(200);
    });
  });

  describe('GET /models', () => {
    it('refuses anonymous callers and pending accounts', async () => {
      const { http, auth } = await start();

      await http.get('/api/models').expect(401);
      await http.get('/api/models').set(auth.session(USER_ROLE.PENDING)).expect(403);
    });

    it.each([
      ['a user session', (auth: ReturnType<typeof fakeAuth>) => auth.session(USER_ROLE.USER)],
      ['an admin session', (auth: ReturnType<typeof fakeAuth>) => auth.session(USER_ROLE.ADMIN)],
      ['a user API key', (auth: ReturnType<typeof fakeAuth>) => auth.key(USER_ROLE.USER)],
    ])('returns the model list for %s', async (_name, headers) => {
      const { http, auth } = await start();

      const response = await http.get('/api/models').set(headers(auth)).expect(200);

      expect(response.body).toEqual({
        models: [
          {
            id: `${ID}:llama3:8b`,
            name: 'llama3:8b',
            connectionId: ID,
            providerName: 'Lokales Ollama',
            providerType: PROVIDER_TYPE.OLLAMA,
          },
        ],
        unavailableConnections: [],
      });
    });
  });
});
```

- [ ] **Step 7: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/models/models-routes.spec.ts`
Expected: FAIL (Controller und DTOs fehlen).

- [ ] **Step 8: DTOs schreiben**

`apps/api/src/models/provider-connections.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import type { ProviderConnection } from './provider-connection.entity.js';
import { PROVIDER_TYPE, type ProviderType } from './provider-type.js';

const TYPES = Object.values(PROVIDER_TYPE);

/** Printable ASCII without spaces: a pasted key with a line break or trailing text cannot become a broken header. */
const API_KEY_PATTERN = /^[\x21-\x7e]{1,512}$/;
const API_KEY_MESSAGE = 'apiKey must be 1 to 512 printable characters without spaces';

function trim({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ProviderConnectionDto {
  id!: string;
  name!: string;
  @ApiProperty({ enum: TYPES })
  type!: ProviderType;
  baseUrl!: string;
  /** The key itself is never returned. */
  hasApiKey!: boolean;
  enabled!: boolean;
  /** Raw model ids of the provider that users do not see. */
  hiddenModelIds!: string[];
  createdAt!: string;
  updatedAt!: string;
}

export function toProviderConnectionDto(connection: ProviderConnection): ProviderConnectionDto {
  return {
    id: connection.id,
    name: connection.name,
    type: connection.type,
    baseUrl: connection.baseUrl,
    hasApiKey: connection.apiKeyCiphertext !== null,
    enabled: connection.enabled,
    hiddenModelIds: connection.hiddenModelIds,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

export class CreateProviderConnectionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: TYPES })
  @IsIn(TYPES)
  type!: ProviderType;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  baseUrl!: string;

  /** Leave it out for a provider without a key; an empty or null value is refused. */
  @ApiPropertyOptional()
  @ValidateIf((_dto, value: unknown) => value !== undefined)
  @Transform(trim)
  @Matches(API_KEY_PATTERN, { message: API_KEY_MESSAGE })
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateProviderConnectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  baseUrl?: string;

  /** Missing: keep the key. `null`: remove it. A string: replace it. */
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trim)
  @Matches(API_KEY_PATTERN, { message: API_KEY_MESSAGE })
  apiKey?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /** The complete list of hidden raw model ids; it replaces the stored list. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(512, { each: true })
  hiddenModelIds?: string[];
}
```

- [ ] **Step 9: Controller und Modul schreiben**

`apps/api/src/models/provider-connections.controller.ts`:

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
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser, Roles } from '../auth/decorators.js';
import type { User } from '../users/user.entity.js';
import { USER_ROLE } from '../users/user-role.js';
import { ModelRegistryService } from './model-registry.service.js';
import { AdminModelListDto, ConnectionTestDto } from './models.dto.js';
import {
  CreateProviderConnectionDto,
  ProviderConnectionDto,
  toProviderConnectionDto,
  UpdateProviderConnectionDto,
} from './provider-connections.dto.js';
import { ProviderConnectionsService } from './provider-connections.service.js';

/** A test is a request to a host the admin chose: keep the rate low (error reasons are coarse on purpose). */
const TEST_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** Admin only; the guard also keeps API keys out of every route that asks for the admin role. */
@ApiTags('provider-connections')
@Roles(USER_ROLE.ADMIN)
@Controller('admin/provider-connections')
export class ProviderConnectionsController {
  constructor(
    private readonly connections: ProviderConnectionsService,
    private readonly registry: ModelRegistryService
  ) {}

  @Get()
  @ApiOkResponse({ type: ProviderConnectionDto, isArray: true })
  async list(): Promise<ProviderConnectionDto[]> {
    return (await this.connections.list()).map(toProviderConnectionDto);
  }

  @Post()
  @ApiCreatedResponse({ type: ProviderConnectionDto })
  @ApiConflictResponse({ description: 'The name is taken' })
  @ApiUnprocessableEntityResponse({ description: 'The URL is invalid or the host is not allowed' })
  async create(
    @CurrentUser() actor: User,
    @Body() dto: CreateProviderConnectionDto
  ): Promise<ProviderConnectionDto> {
    return toProviderConnectionDto(await this.connections.create(actor.id, dto));
  }

  @Patch(':id')
  @ApiOkResponse({ type: ProviderConnectionDto })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'The name is taken' })
  @ApiUnprocessableEntityResponse({ description: 'The URL is invalid or the host is not allowed' })
  async update(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderConnectionDto
  ): Promise<ProviderConnectionDto> {
    return toProviderConnectionDto(await this.connections.update(actor.id, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  async remove(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.connections.remove(actor.id, id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @Throttle(TEST_THROTTLE)
  @ApiOkResponse({ type: ConnectionTestDto })
  @ApiNotFoundResponse()
  @ApiBadGatewayResponse({ description: 'The provider did not answer; the body names the reason' })
  test(@Param('id', ParseUUIDPipe) id: string): Promise<ConnectionTestDto> {
    return this.registry.test(id);
  }

  @Get(':id/models')
  @ApiOkResponse({ type: AdminModelListDto })
  @ApiNotFoundResponse()
  @ApiBadGatewayResponse({ description: 'The provider did not answer; the body names the reason' })
  models(@Param('id', ParseUUIDPipe) id: string): Promise<AdminModelListDto> {
    return this.registry.listForConnection(id);
  }
}
```

`apps/api/src/models/models.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { ModelRegistryService } from './model-registry.service.js';
import { ModelListDto } from './models.dto.js';

/** Every signed-in user (not "pending"); the global guard closes the route for everybody else. */
@ApiTags('models')
@Controller('models')
export class ModelsController {
  constructor(private readonly registry: ModelRegistryService) {}

  @Get()
  @ApiOkResponse({ type: ModelListDto })
  list(): Promise<ModelListDto> {
    return this.registry.list();
  }
}
```

`apps/api/src/models/models.module.ts`:

```ts
import { Module } from '@nestjs/common';

import { AuditModule } from '../database/audit/audit.module.js';
import { SafeFetchModule } from '../http/safe-fetch/safe-fetch.module.js';
import { ModelListCache } from './model-list-cache.js';
import { ModelRegistryService } from './model-registry.service.js';
import { ModelsController } from './models.controller.js';
import { OllamaAdapter } from './ollama.adapter.js';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter.js';
import { PROVIDER_ADAPTERS, type ProviderAdapter } from './provider-adapter.js';
import { ProviderConnectionsController } from './provider-connections.controller.js';
import { ProviderConnectionsService } from './provider-connections.service.js';
import { SecretBox } from './secret-box.js';

@Module({
  imports: [AuditModule, SafeFetchModule],
  controllers: [ProviderConnectionsController, ModelsController],
  providers: [
    SecretBox,
    ModelListCache,
    ProviderConnectionsService,
    OllamaAdapter,
    OpenAiCompatibleAdapter,
    {
      provide: PROVIDER_ADAPTERS,
      inject: [OllamaAdapter, OpenAiCompatibleAdapter],
      useFactory: (ollama: OllamaAdapter, openai: OpenAiCompatibleAdapter): ProviderAdapter[] => [
        ollama,
        openai,
      ],
    },
    ModelRegistryService,
  ],
  exports: [ModelRegistryService],
})
export class ModelsModule {}
```

- [ ] **Step 10: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/models/models-routes.spec.ts src/common`
Expected: PASS. Schlägt ein Validierungstest fehl, weil `null` bei `apiKey` im Create durchkommt, prüfen, ob `@ValidateIf` vor `@Matches` steht und die Bedingung `value !== undefined` lautet (`null` muss geprüft werden und an `Matches` scheitern).

- [ ] **Step 11: Prüfen, Commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add apps/api/src/testing/fake-auth.ts apps/api/src/models/provider-connections.dto.ts apps/api/src/models/provider-connections.controller.ts apps/api/src/models/models.controller.ts apps/api/src/models/models.module.ts apps/api/src/models/models-routes.spec.ts apps/api/src/common
git commit -m "feat(api): add the provider connection and model routes" -m "Admin routes under /admin/provider-connections, GET /models for every signed-in user. The key is write-only (hasApiKey in answers), checked against a printable-ASCII pattern so a pasted line break cannot become a broken header. A ProviderError becomes 502 problem details with a reason; the test route is rate limited." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 12: Mutation prüfen**

Nacheinander, jeweils mit `git checkout -- <Datei>` zurücksetzen:

1. In `provider-connections.controller.ts` `@Roles(USER_ROLE.ADMIN)` entfernen. Expected: die 403-Tests für Nutzer, `pending` und Admin-Key werden rot.
2. `@Throttle(TEST_THROTTLE)` entfernen. Expected: „allows 10 tests a minute…“ wird rot.
3. In `provider-connections.dto.ts` bei `CreateProviderConnectionDto.apiKey` die Zeile `@Matches(...)` entfernen. Expected: die Key-Fälle („line break inside“, „space inside“, „null api key“ …) werden rot.
4. In `toProviderConnectionDto` `hasApiKey: ...` durch `apiKeyCiphertext: connection.apiKeyCiphertext` ersetzen (und im Typ ergänzen). Expected: „shows hasApiKey instead of the key or its ciphertext“ wird rot.

Danach `pnpm --filter @owui/api exec vitest run src/models src/common` wieder grün. Kein Commit.

---

### Task 11: Verdrahtung und Ende-zu-Ende-Test mit Datenbank

**Files:**
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/app.module.spec.ts`, `apps/api/src/testing/create-db-test-app.ts`
- Create: `apps/api/src/models/models.db.spec.ts`

**Interfaces:**
- Consumes: alles aus Tasks 1 bis 10; `FakeProvider`, `FAKE_MODE` (Task 5); `capturingLogger` (Task 8); `signupUser`, `loginUser`, `authed` (bestehende Test-Hilfen); `ApiKeyService.create(userId, name)`.
- Produces: `ModelsModule` in `AppModule`; `createDbTestApp(url, env, options)` startet `ModelsModule`, leert `provider_connection` und kennt `options.configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder`; Standard-Env `PROVIDER_ALLOWED_HOSTS: '127.0.0.1'` in diesem Helfer.

- [ ] **Step 1: Modul eintragen**

`apps/api/src/app.module.ts`: Import `import { ModelsModule } from './models/models.module.js';` ergänzen und `ModelsModule` hinter `AuthModule` in `imports` eintragen:

```ts
    UsersModule,
    AuthModule,
    ModelsModule,
    HealthModule,
```

An `apps/api/src/app.module.spec.ts` einen Test ergänzen (Import `ModelsModule` aus `./models/models.module.js`):

```ts
  it('imports the model module', () => {
    const imports: unknown[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule);

    expect(imports).toContain(ModelsModule);
  });
```

- [ ] **Step 2: Test-App erweitern**

`apps/api/src/testing/create-db-test-app.ts` vollständig ersetzen durch:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { configureApp } from '../app.factory.js';
import { AuthModule } from '../auth/auth.module.js';
import { CommonModule } from '../common/common.module.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { AuditModule } from '../database/audit/audit.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { HealthModule } from '../health/health.module.js';
import { AppLoggerModule } from '../logging/logger.module.js';
import { ModelsModule } from '../models/models.module.js';
import { SecurityModule } from '../security/security.module.js';
import { UsersModule } from '../users/users.module.js';
import { BASE_TEST_ENV } from './create-test-app.js';
import { resetAuthTables, resetProviderTables } from './db-fixtures.js';

export interface DbTestAppOptions {
  /** Empty the user and connection tables before the app starts (default). Turn off to test start-up against existing data. */
  resetUsers?: boolean;
  /** Swap providers (for example the logger) before the app is built. */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/** The real modules against the test database. Limits are lifted so a test only hits the one it is about. */
export async function createDbTestApp(
  databaseUrl: string,
  env: Record<string, string> = {},
  options: DbTestAppOptions = {}
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot({
        raw: {
          ...BASE_TEST_ENV,
          DATABASE_URL: databaseUrl,
          RATE_LIMIT_LIMIT: '100000',
          LOGIN_MAX_ATTEMPTS: '1000',
          // The fake providers of the tests listen on loopback.
          PROVIDER_ALLOWED_HOSTS: '127.0.0.1',
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
      ModelsModule,
      HealthModule,
    ],
  });
  if (options.configure) builder = options.configure(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  if (options.resetUsers !== false) {
    const dataSource = app.get(DataSource);
    await resetAuthTables(dataSource);
    await resetProviderTables(dataSource);
  }
  await app.init();
  return app;
}
```

- [ ] **Step 3: Fehlschlagenden Ende-zu-Ende-Test schreiben**

`apps/api/src/models/models.db.spec.ts`:

```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ApiKeyService } from '../auth/api-key.service.js';
import { PROVIDER_ERROR } from '../http/safe-fetch/provider-error.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { FAKE_MODE, FakeProvider } from '../testing/fake-provider.js';
import {
  authed,
  type Http,
  type Login,
  loginUser,
  signupUser,
  TEST_PASSWORD,
} from '../testing/http-session.js';
import { capturingLogger } from '../testing/provider-fixtures.js';
import { USER_ROLE } from '../users/user-role.js';
import { ModelRegistryService } from './model-registry.service.js';
import { PROVIDER_TYPE } from './provider-type.js';

const SECRET = 'sk-e2e-secret-value-123';
const NEW_SECRET = 'sk-e2e-replaced-value-456';
const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'ping' }] }];

describe('model connections end to end (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let admin: Login;
  let ben: Login;
  let provider: FakeProvider;
  let logs: ReturnType<typeof capturingLogger>;
  const others: FakeProvider[] = [];

  afterEach(async () => {
    await app.close();
    await Promise.all([provider, ...others.splice(0)].map((fake) => fake.close()));
  });

  /** The first account is the admin; Ben is promoted to a normal user. */
  async function start(): Promise<void> {
    provider = await FakeProvider.start();
    logs = capturingLogger();
    app = await createDbTestApp(
      testDatabaseUrl(),
      { ENABLE_API_KEYS: 'true' },
      { configure: (builder) => builder.overrideProvider(PinoLogger).useValue(logs.logger) }
    );
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    admin = await signupUser(http, { email: 'admin@example.com' });
    const pending = await signupUser(http, { email: 'ben@example.com' });
    await authed(http, admin)
      .patch(`/api/users/${pending.user.id}`)
      .send({ role: USER_ROLE.USER })
      .expect(200);
    ben = await loginUser(http, 'ben@example.com', TEST_PASSWORD);
  }

  async function connect(body: Record<string, unknown> = {}, target = provider) {
    const response = await authed(http, admin)
      .post('/api/admin/provider-connections')
      .send({ name: 'Lokal', type: PROVIDER_TYPE.OLLAMA, baseUrl: target.url, apiKey: SECRET, ...body })
      .expect(201);
    return response.body as { id: string; name: string; hasApiKey: boolean };
  }

  function modelNames(body: { models: { name: string }[] }): string[] {
    return body.models.map((model) => model.name);
  }

  describe('the key', () => {
    it('is stored encrypted and appears in no answer, audit entry or log line', async () => {
      await start();
      provider.requiredKey = SECRET;

      const created = await connect();
      const list = await authed(http, admin).get('/api/admin/provider-connections').expect(200);
      await authed(http, admin).post(`/api/admin/provider-connections/${created.id}/test`).expect(200);
      await authed(http, admin)
        .patch(`/api/admin/provider-connections/${created.id}`)
        .send({ name: 'Umbenannt' })
        .expect(200);
      await authed(http, ben).get('/api/models').expect(200);

      expect(created.hasApiKey).toBe(true);
      expect(JSON.stringify(created)).not.toContain(SECRET);
      expect(JSON.stringify(list.body)).not.toContain(SECRET);
      const [row] = await dataSource.query<{ api_key_ciphertext: string }[]>(
        'SELECT api_key_ciphertext FROM provider_connection WHERE id = $1',
        [created.id]
      );
      expect(row?.api_key_ciphertext).toMatch(/^v1\./);
      expect(row?.api_key_ciphertext).not.toContain(SECRET);
      const audit = await dataSource.query<object[]>('SELECT * FROM audit_log WHERE target_id = $1', [
        created.id,
      ]);
      expect(audit).toHaveLength(2);
      expect(JSON.stringify(audit)).not.toContain(SECRET);
      expect(logs.output()).toContain('Model list fetched');
      expect(logs.output()).not.toContain(SECRET);
    });

    it('is sent to the provider as a Bearer token, until it is replaced or removed', async () => {
      await start();
      provider.requiredKey = SECRET;
      const created = await connect();
      const url = `/api/admin/provider-connections/${created.id}`;

      await authed(http, admin).post(`${url}/test`).expect(200);
      expect(provider.requests.at(-1)?.authorization).toBe(`Bearer ${SECRET}`);

      await authed(http, admin).patch(url).send({ name: 'Umbenannt' }).expect(200);
      await authed(http, admin).post(`${url}/test`).expect(200);

      const removed = await authed(http, admin).patch(url).send({ apiKey: null }).expect(200);
      expect(removed.body.hasApiKey).toBe(false);
      const refused = await authed(http, admin).post(`${url}/test`).expect(502);
      expect(refused.body.reason).toBe(PROVIDER_ERROR.UNAUTHORIZED);

      provider.requiredKey = NEW_SECRET;
      const replaced = await authed(http, admin).patch(url).send({ apiKey: NEW_SECRET }).expect(200);
      expect(replaced.body.hasApiKey).toBe(true);
      await authed(http, admin).post(`${url}/test`).expect(200);

      expect(logs.output()).not.toContain(SECRET);
      expect(logs.output()).not.toContain(NEW_SECRET);
    });
  });

  describe('models', () => {
    it('lets an admin test and see every model, and a user see them without the hidden ones', async () => {
      await start();
      const created = await connect({ apiKey: undefined });
      const url = `/api/admin/provider-connections/${created.id}`;

      const test = await authed(http, admin).post(`${url}/test`).expect(200);
      expect(test.body).toEqual({ ok: true, modelCount: 2 });

      await authed(http, admin).patch(url).send({ hiddenModelIds: ['mistral:7b'] }).expect(200);

      const forAdmin = await authed(http, admin).get(`${url}/models`).expect(200);
      expect(forAdmin.body.models).toEqual([
        { rawModelId: 'llama3:8b', name: 'llama3:8b', hidden: false },
        { rawModelId: 'mistral:7b', name: 'mistral:7b', hidden: true },
      ]);
      const forBen = await authed(http, ben).get('/api/models').expect(200);
      expect(forBen.body).toEqual({
        models: [
          {
            id: `${created.id}:llama3:8b`,
            name: 'llama3:8b',
            connectionId: created.id,
            providerName: 'Lokal',
            providerType: PROVIDER_TYPE.OLLAMA,
          },
        ],
        unavailableConnections: [],
      });
    });

    it('keeps the list in memory and drops it after an edit', async () => {
      await start();
      const created = await connect({ apiKey: undefined });
      const tagRequests = () => provider.requests.filter((item) => item.path === '/api/tags').length;

      await authed(http, ben).get('/api/models').expect(200);
      await authed(http, ben).get('/api/models').expect(200);
      expect(tagRequests()).toBe(1);

      provider.models = ['llama3:8b', 'new-model'];
      const cached = await authed(http, ben).get('/api/models').expect(200);
      expect(modelNames(cached.body)).toEqual(['llama3:8b', 'mistral:7b']);

      await authed(http, admin)
        .patch(`/api/admin/provider-connections/${created.id}`)
        .send({ name: 'Umbenannt' })
        .expect(200);
      const fresh = await authed(http, ben).get('/api/models').expect(200);
      expect(modelNames(fresh.body)).toEqual(['llama3:8b', 'new-model']);
      expect(tagRequests()).toBe(2);
    });

    it('names a failing connection and still lists the models of the others', async () => {
      await start();
      const broken = await FakeProvider.start();
      others.push(broken);
      broken.mode = FAKE_MODE.UNAUTHORIZED;
      await connect({ apiKey: undefined });
      const down = await connect({ name: 'Kaputt', apiKey: undefined }, broken);

      const response = await authed(http, ben).get('/api/models').expect(200);

      expect(modelNames(response.body)).toEqual(['llama3:8b', 'mistral:7b']);
      expect(response.body.unavailableConnections).toEqual([
        { id: down.id, name: 'Kaputt', reason: PROVIDER_ERROR.UNAUTHORIZED },
      ]);
    });

    it('does not list a disabled connection, and a deleted one is gone', async () => {
      await start();
      const created = await connect({ apiKey: undefined });
      const url = `/api/admin/provider-connections/${created.id}`;

      await authed(http, admin).patch(url).send({ enabled: false }).expect(200);
      expect((await authed(http, ben).get('/api/models').expect(200)).body.models).toEqual([]);

      await authed(http, admin).delete(url).expect(204);
      expect((await authed(http, admin).get('/api/admin/provider-connections')).body).toEqual([]);
      await authed(http, admin).post(`${url}/test`).expect(404);
    });

    it('gives the chat a model that reaches the provider with the stored key', async () => {
      await start();
      provider.requiredKey = SECRET;
      const created = await connect();

      const { model, rawModelId } = await app
        .get(ModelRegistryService)
        .resolve(`${created.id}:llama3:8b`);
      if (typeof model === 'string') throw new Error('expected a model object');
      await model.doGenerate({ prompt: PROMPT });

      expect(rawModelId).toBe('llama3:8b');
      expect(provider.requests.at(-1)).toMatchObject({
        path: '/v1/chat/completions',
        authorization: `Bearer ${SECRET}`,
      });
    });
  });

  describe('names and hosts', () => {
    it('answers 409 for a taken name, and lets exactly one of two parallel requests win', async () => {
      await start();
      await connect({ apiKey: undefined });

      await authed(http, admin)
        .post('/api/admin/provider-connections')
        .send({ name: 'Lokal', type: PROVIDER_TYPE.OLLAMA, baseUrl: provider.url })
        .expect(409);

      const statuses = (
        await Promise.all(
          [1, 2].map(() =>
            authed(http, admin)
              .post('/api/admin/provider-connections')
              .send({ name: 'Parallel', type: PROVIDER_TYPE.OLLAMA, baseUrl: provider.url })
          )
        )
      )
        .map((response) => response.status)
        .sort();
      expect(statuses).toEqual([201, 409]);
    });

    it.each([
      'http://169.254.169.254',
      'http://[fe80::1]:11434',
      'http://10.0.0.9:11434',
      'http://user:secret@127.0.0.1:11434',
      'http://127.0.0.1:11434/?token=abc',
      'ftp://127.0.0.1',
      'not a url',
    ])('refuses %s with 422 and stores nothing', async (baseUrl) => {
      await start();

      const response = await authed(http, admin)
        .post('/api/admin/provider-connections')
        .send({ name: 'Boese', type: PROVIDER_TYPE.OLLAMA, baseUrl, apiKey: SECRET })
        .expect(422);

      expect(JSON.stringify(response.body)).not.toContain(SECRET);
      expect(JSON.stringify(response.body)).not.toContain('secret@');
      expect((await authed(http, admin).get('/api/admin/provider-connections')).body).toEqual([]);
    });

    it('refuses a new address for a saved connection, too', async () => {
      await start();
      const created = await connect({ apiKey: undefined });

      await authed(http, admin)
        .patch(`/api/admin/provider-connections/${created.id}`)
        .send({ baseUrl: 'http://169.254.169.254' })
        .expect(422);
    });
  });

  describe('access', () => {
    it('keeps users, pending accounts and API keys out of the admin routes', async () => {
      await start();
      const { key } = await app.get(ApiKeyService).create(admin.user.id, 'ci');
      const pending = await signupUser(http, { email: 'pending@example.com' });

      await http.get('/api/admin/provider-connections').expect(401);
      await authed(http, ben).get('/api/admin/provider-connections').expect(403);
      await authed(http, pending).get('/api/admin/provider-connections').expect(403);
      await http.get('/api/admin/provider-connections').set('Authorization', `Bearer ${key}`).expect(403);
    });

    it('lets a user read the models with a session or an API key, but not a pending account', async () => {
      await start();
      const { key } = await app.get(ApiKeyService).create(ben.user.id, 'ci');
      const pending = await signupUser(http, { email: 'pending@example.com' });

      await http.get('/api/models').expect(401);
      await authed(http, pending).get('/api/models').expect(403);
      await authed(http, ben).get('/api/models').expect(200);
      await http.get('/api/models').set('Authorization', `Bearer ${key}`).expect(200);
    });
  });
});
```

Zur Zeile `connect({ apiKey: undefined })`: `JSON.stringify` lässt `undefined` weg, der Aufruf legt die Verbindung also ohne Key an.

- [ ] **Step 4: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm db:up && pnpm --filter @owui/api exec vitest run --config vitest.db.config.ts src/models/models.db.spec.ts`
Expected: FAIL. Bevor Step 1 und 2 stehen, fehlt `ModelsModule` in der Test-App; mit beiden Schritten sollte der Test bereits grün sein, weil die Bausteine aus Tasks 1 bis 10 stehen. Ist er grün, jede Aussage einzeln über die Mutationen in Step 6 beweisen; ist er rot, ist das ein Befund in einer früheren Task und dort zu beheben, nicht im Test zu umgehen.

- [ ] **Step 5: Alle Tests laufen lassen**

```bash
pnpm test
pnpm test:db
pnpm check
```

Expected: PASS. Zählen und notieren (Zahl der API-, DB-Tests) für den Beleg in Task 12.

- [ ] **Step 6: Mutation prüfen (Spec Abschnitt 8)**

Nacheinander, jeweils mit `git checkout -- <Datei>` zurücksetzen:

1. In `provider-fetch.service.ts` in `resolveAllowed` die Bedingung `!addresses.every(...)` durch `false` ersetzen. Expected: die `422`-Fälle für `169.254.169.254`, `[fe80::1]` und `10.0.0.9` in diesem Spec sowie die Host-Tests aus Task 5 werden rot. Bleibt etwas grün, ist die Host-Prüfung dort nicht getestet.
2. In `provider-connections.service.ts` `checkedBaseUrl` im `update`-Pfad überspringen (`baseUrl` direkt aus `patch.baseUrl` nehmen). Expected: „refuses a new address for a saved connection, too“ wird rot.
3. In `provider-fetch.service.ts` in `createFetch` den Ursprungsvergleich entfernen. Expected: „refuses a target on another origin“ (Task 5) wird rot.

Danach alles wieder grün. Kein Commit.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/app.module.ts apps/api/src/app.module.spec.ts apps/api/src/testing/create-db-test-app.ts apps/api/src/models/models.db.spec.ts
git commit -m "feat(api): wire the model module and test the whole path against a database" -m "End-to-end spec with fake providers: key encrypted and never in answers, audit or logs; partial outage; cache and invalidation; blocked hosts; name conflicts; access by role and API key." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Vertrag, Smoke-Test, Fake-Anbieter für Handproben, Docs und Beleg

**Files:**
- Create: `scripts/fake-provider.mjs`, `docs/dod/02-modell-anbindung-backend.md`
- Modify: `scripts/smoke.mjs`, `apps/api/openapi.json` (erzeugt), `apps/web/src/api/generated/**` (erzeugt), `docs/PLAN.md`, `docs/BACKLOG.md`, `docs/THREAT-MODEL.md`, `docs/superpowers/specs/2026-10-09-teilprojekt-2-modell-anbindung-design.md`

**Interfaces:**
- Consumes: alles aus Tasks 1 bis 11.
- Produces: erzeugter OpenAPI-Vertrag und Web-Client (Plan 2b baut darauf auf); `node scripts/fake-provider.mjs [port] [mode] [key]`; Smoke-Prüfungen für `/api/models` und `/api/admin/provider-connections`.

- [ ] **Step 1: Vertrag erzeugen**

```bash
pnpm openapi
git status --short apps/api/openapi.json apps/web/src/api/generated
grep -n '"operationId": "\(providerConnections\|models\)' apps/api/openapi.json
```

Expected: `openapi.json` und der Client ändern sich. Die Operationen heißen (Schema `controllerName` ohne `Controller` plus Methode):

```
providerConnectionsList, providerConnectionsCreate, providerConnectionsUpdate, providerConnectionsRemove,
providerConnectionsTest, providerConnectionsModels, modelsList
```

Das ergibt im Web-Client die Hooks `useProviderConnectionsList`, `useProviderConnectionsCreate`, `useProviderConnectionsUpdate`, `useProviderConnectionsRemove`, `useProviderConnectionsTest`, `useProviderConnectionsModels`, `useModelsList` und die Typen `ProviderConnectionDto`, `CreateProviderConnectionDto`, `UpdateProviderConnectionDto`, `ModelListDto`, `ModelDto`, `UnavailableConnectionDto`, `AdminModelListDto`, `AdminModelDto`, `ConnectionTestDto`. **Die tatsächlich erzeugten Namen ausgeben** (`grep -n "export const use\(ProviderConnections\|ModelsList\)" apps/web/src/api/generated/api.ts`) und in den Beleg (Step 7) schreiben; Plan 2b nennt die Namen aus dieser Ausgabe.

Prüfen, dass im Schema stehen: `apiKey` im `UpdateProviderConnectionDto` als `string` mit `nullable: true`; `reason` und `providerType` als Enum; `hasApiKey` im `ProviderConnectionDto`; kein Feld `apiKeyCiphertext` irgendwo (`grep -c apiKeyCiphertext apps/api/openapi.json` ist `0`).

```bash
pnpm --filter @owui/web typecheck
```

Expected: PASS (der Client ist additiv).

- [ ] **Step 2: Smoke-Test erweitern**

In `scripts/smoke.mjs` vor dem Block `if (failures.length > 0)` ergänzen:

```js
const anonymousModels = await fetch(`${BASE_URL}/api/models`);
check('anonymous /models answers 401', anonymousModels.status === 401);

const anonymousConnections = await fetch(`${BASE_URL}/api/admin/provider-connections`);
check(
  'anonymous /admin/provider-connections answers 401 problem details',
  anonymousConnections.status === 401 &&
    (anonymousConnections.headers.get('content-type') ?? '').includes('application/problem+json')
);
```

Der Smoke-Test hat keinen angemeldeten Nutzer; der angemeldete Pfad ist durch `models.db.spec.ts` (Fake-Anbieter) und die Handprobe in Step 6 belegt.

- [ ] **Step 3: Fake-Anbieter für Handproben**

`scripts/fake-provider.mjs`:

```js
// A model provider for hand checks and the browser check of Teilprojekt 2b (Ollama and OpenAI format).
// Usage: node scripts/fake-provider.mjs [port=11500] [mode=ok] [key]
//   mode: ok | unauthorized | server_error | redirect | hang | html | garbage | wrong_shape | oversized
//   key:  require "Authorization: Bearer <key>"
// Listens on all interfaces so a container can reach it as host.docker.internal.
import { FAKE_MODE, FakeProvider } from '../apps/api/src/testing/fake-provider.ts';

const [port = '11500', mode = FAKE_MODE.OK, key] = process.argv.slice(2);
if (!Object.values(FAKE_MODE).includes(mode)) {
  console.error(`Unknown mode "${mode}". Use one of: ${Object.values(FAKE_MODE).join(', ')}`);
  process.exit(1);
}

const provider = await FakeProvider.start(Number(port), '0.0.0.0');
provider.mode = mode;
provider.requiredKey = key;
console.log(`fake provider on port ${provider.port}, mode ${mode}${key ? ', key required' : ''}`);

process.on('SIGINT', async () => {
  await provider.close();
  process.exit(0);
});
```

Prüfen (Node 26 entfernt Typen selbst, `.nvmrc` nennt 24):

```bash
node scripts/fake-provider.mjs 11500 ok sk-demo &
curl -s -H "Authorization: Bearer sk-demo" http://127.0.0.1:11500/api/tags
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:11500/api/tags
kill %1
```

Expected: JSON mit zwei Modellen, dann `401`. Meldet Node einen Fehler wegen der TypeScript-Syntax (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), steht in `fake-provider.ts` ein Konstrukt, das Typen-Entfernung nicht kann (Aufzählung, Parameter-Property, Namespace): in der Datei ersetzen, nicht das Skript umgehen.

- [ ] **Step 4: Spec berichtigen (Regel 10)**

In `docs/superpowers/specs/2026-10-09-teilprojekt-2-modell-anbindung-design.md`, Abschnitt 2, drei Änderungen:

1. Zeile `ai`: `7.0.137` ersetzen durch `7.0.137 (zur Zeit der Spec; der Plan nutzt ^7.0.127, weil 7.0.137 jünger als die sieben Tage Karenzzeit war)`.
2. Zeile `OpenAI-kompatibel`: `3.0.67` ersetzen durch `3.0.67 (Plan: ^3.0.62, gleicher Grund)`.
3. Zeile „Node-/ESM-Verträglichkeit …“: Spalte Befund durch `Geprüft in Plan 2a, Task 1 (Vertragstest) und Task 7 (Import aus dem Nest-Build): verträglich.` und Spalte Sicherheit durch `sicher` ersetzen. **Nur, wenn beide Schritte tatsächlich grün waren**; sonst den Befund ehrlich eintragen.

- [ ] **Step 5: Docs fortschreiben**

`docs/PLAN.md`, Zeile 2 der Tabelle: Stand ersetzen durch

```
Backend gebaut (Plan [2a](superpowers/plans/2026-10-09-teilprojekt-2a-modell-anbindung-backend.md), Beleg [DoD 2a](dod/02-modell-anbindung-backend.md)); Web: Plan [2b](superpowers/plans/2026-10-09-teilprojekt-2b-modell-anbindung-web.md), Spec: [Spec](superpowers/specs/2026-10-09-teilprojekt-2-modell-anbindung-design.md)
```

und unter „Als Nächstes“ Punkt 1 ersetzen durch „Plan 2b (Web) ausführen.“.

`docs/BACKLOG.md`, in der Tabelle „Offen“ drei Zeilen ergänzen (Spaltenbreite von Prettier ordnen lassen):

| Thema | Notiz |
| --- | --- |
| Defekter Schlüssel blockiert die Modellliste | Ein Ciphertext, den kein Schlüssel im Ring entschlüsselt (Schlüssel aus `PROVIDER_KEY_ENCRYPTION_KEYS` entfernt), ergibt `500` für `GET /models`, weil nur `ProviderError` als „nicht erreichbar“ gilt (Fail fast). Prüfen, ob eine solche Verbindung mit eigener Ursache in `unavailableConnections` erscheinen soll. |
| Gleichzeitige Modelllisten-Abrufe | Bei kaltem Cache stellen parallele `GET /models` je Verbindung mehrere Anfragen an den Anbieter (kein Single-Flight). Erst angehen, wenn Anbieter dadurch Last sehen. |
| Rate Limit der Test-Route je Admin | `@Throttle` zählt je IP, nicht je Admin; hinter einem Proxy ohne `TRUST_PROXY_HOPS` teilen sich alle Admins ein Kontingent. |

`docs/THREAT-MODEL.md`: Kopfzeile „Stand: Teilprojekt 1.“ ersetzen durch „Stand: Teilprojekt 2a.“ und in der Tabelle „Bedrohungen“ vier Zeilen im selben Format ergänzen:

| STRIDE | Bedrohung | Maßnahme (Teilprojekt) |
| --- | --- | --- |
| Elevation of privilege | SSRF über die Anbieter-URL einer Verbindung (Metadaten, interne Dienste, DNS-Rebinding, Weiterleitung) | `ProviderFetchService`: eigene Auflösung und Adressprüfung bei jedem Aufruf, angeheftete IP, feste Herkunft der Verbindung, Weiterleitungen sind Fehler; private Hosts nur über `PROVIDER_ALLOWED_HOSTS`, Link-Local und Metadaten nie (2a) |
| Information disclosure | Provider-Key in Antwort, Log, Audit oder Datenbank | Key nur schreibbar (`hasApiKey`), AES-256-GCM mit Verbindungs-ID als zusätzlichen Daten, `pino redact`, Audit nur mit Feldnamen; Tests suchen den Key in Antworten, Audit und Logs (2a) |
| Information disclosure | Port- und Dienstscan über Fehlerursachen der Test-Route | Ursachen sind grob (`PROVIDER_ERROR`), nie Antworttexte; Rate Limit 10 je Minute; nur Admins (2a) |
| Tampering | Abgesicherter Key wird in eine andere Zeile kopiert oder verändert | GCM-Tag und Verbindungs-ID als zusätzliche Daten: Kopie und Manipulation schlagen beim Entschlüsseln fehl (2a) |

(Die Zeile „Elevation of privilege / SSRF“ aus Teilprojekt 0 bleibt stehen; sie gilt für Nutzer-URLs.)

- [ ] **Step 6: Handprobe gegen den Compose-Stack**

```bash
node scripts/fake-provider.mjs 11500 ok sk-demo &
PROVIDER_ALLOWED_HOSTS=host.docker.internal docker compose up -d --build --wait
node scripts/smoke.mjs http://localhost:8080
```

Dann im Stack mit `curl` (Cookie-Datei, CSRF-Token wie in der Handprobe von DoD 1a): als erster Nutzer anmelden (wird Admin), `POST /api/admin/provider-connections` mit `{"name":"Probe","type":"ollama","baseUrl":"http://host.docker.internal:11500","apiKey":"sk-demo"}`, `POST …/test` (Erwartung `200`), `GET /api/models` (zwei Modelle), `POST` mit `baseUrl: "http://169.254.169.254"` (Erwartung `422`). Ist `host.docker.internal` auf dem Rechner nicht auflösbar (Linux), in `compose.yml` des API-Dienstes `extra_hosts: ["host.docker.internal:host-gateway"]` nur für die Probe lokal ergänzen und **nicht committen**. Danach `docker compose down` und den Fake mit `kill %1` beenden. Was nicht ausgeführt werden konnte, im Beleg als „nicht geprüft“ nennen.

- [ ] **Step 7: Beleg schreiben**

`docs/dod/02-modell-anbindung-backend.md` im Muster von [DoD 1a](../dod/01-auth-backend.md), mit den **tatsächlichen** Zahlen und Ergebnissen aus Step 1 bis 6 (keine Platzhalter stehen lassen):

```markdown
### DoD: Teilprojekt 2a (Modell-Anbindung, Backend)

- [ ] Vertrag: OpenAPI enthält Verbindungs- und Modellrouten, Orval-Client erzeugt (Namen: <aus Step 1>), CI-Drift-Prüfung grün, kein `apiKeyCiphertext` im Schema
- [ ] Tests: <n> API, <n> DB grün; `pnpm check` grün; Mutationen gesehen: Host-Prüfung aus, Ursprungsvergleich entfernt, Weiterleitung folgen, Rolle entfernt, Throttle entfernt, Key-Muster entfernt, Cache-Invalidierung entfernt (jeweils rote Tests)
- [ ] Invarianten: Key nie in Antwort, Log, Audit oder im Klartext in der DB; jeder Anbieteraufruf über `ProviderFetchService`; Host-Prüfung beim Speichern und bei jedem Aufruf; Migration generiert; Modell-IDs mit `:` getrennt am ersten
- [ ] Abhängigkeiten: `ai` <Version>, `@ai-sdk/openai-compatible` <Version>, `zod` <Version> (Karenzzeit eingehalten); ESM-Import aus dem Build geprüft; `pnpm audit --prod` ohne hohe Funde
- [ ] Betrieb: `docker compose up` grün, Smoke-Test inklusive `/models` und `/admin/provider-connections`, Handprobe mit `scripts/fake-provider.mjs` (<Ergebnis oder „nicht geprüft“>)
- [ ] Docs: PLAN, BACKLOG, THREAT-MODEL, Spec (Abschnitt 2) aktualisiert
- [ ] Offen: Web (Teilprojekt 2b)
```

Kästchen nur abhaken, wenn der Befehl dazu gelaufen ist.

- [ ] **Step 8: Gesamtprüfung und Commit**

```bash
pnpm check
pnpm test
pnpm test:db
```

Expected: PASS. Danach:

```bash
git add scripts docs apps/api/openapi.json apps/web/src/api/generated
git commit -m "docs(api): record Teilprojekt 2a (contract, smoke test, threat model, DoD)" -m "OpenAPI and the web client are regenerated; the smoke test covers the new routes for anonymous callers; scripts/fake-provider.mjs serves hand checks and the browser check of 2b." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
gh run list --branch main --limit 1
```

Expected: die CI läuft an; rote CI vor neuer Arbeit beheben (AGENTS.md, Abschnitt 4).

- [ ] **Step 9: Hinweis auf `/clear`**

Ist Plan 2a ausgeführt und der Kontext groß, den Nutzer in einem Satz auf `/clear` hinweisen; Plan 2b startet mit `pnpm openapi`-Ausgabe aus Step 1 und braucht keinen Kontext aus dieser Sitzung.
