# Teilprojekt 0 (Fundament) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein frischer Klon startet mit `docker compose up` eine erreichbare App (NestJS-API + React-Frontend + Postgres/pgvector) mit grünem Health-Endpoint, abgesichertem HTTP-Rand, Observability-Grundgerüst, generiertem API-Client, Agentic-Setup (Stufe 1) und CI.

**Architecture:** pnpm-Monorepo mit `apps/api` (NestJS, TypeORM, Feature-Module) und `apps/web` (React + Vite + shadcn/ui). Die API erzeugt OpenAPI, daraus entsteht per Orval der typisierte Client. In Docker liefert Caddy das Frontend aus und leitet `/api` an die API weiter (eine Origin); CORS ist trotzdem konfigurierbar implementiert. Sicherheit (Helmet, CORS-Whitelist, Origin-Prüfung, Rate Limit, `SafeFetchService`, Problem Details) und Observability (pino, OpenTelemetry) sind von Anfang an Teil des Gerüsts.

**Tech Stack:** Node 24 (`.nvmrc`), pnpm, TypeScript ~6.0, NestJS 12, TypeORM 1.x, PostgreSQL + pgvector, Vitest (+ SWC) , Supertest, React 19, Vite, Tailwind 4, shadcn/ui, TanStack Query, react-i18next, Orval, OpenTelemetry, Caddy, GitHub Actions.

**Spec:** [docs/superpowers/specs/2026-10-09-open-webui-nestjs-design.md](../specs/2026-10-09-open-webui-nestjs-design.md) (Abschnitte 2, 3, 5 Stufe 1, 6.1, 6.2 Stufe A, 7, 8). Lies sie vor dem ersten Task.

**Nicht in diesem Plan** (bewusst, laut Spec): Auth/Sessions und CSRF-Token (Teilprojekt 1), pg-boss und `jobs`-Modul (erst Teilprojekt 3), Stop-Hook, Bash-Guard, DoD-Vorlage und Testregeln (Stufe 2, eigener Plan direkt danach), knip/jscpd (ab Teilprojekt 1), Hot-Reload-Container in `compose.dev.yml` (nur Postgres-Ports/Test-DB; siehe BACKLOG in Task 16), Deployment.

## Global Constraints

Gelten implizit für jeden Task.

- Monorepo mit **pnpm-Workspaces**, kein Turborepo/Nx. Pakete heißen `@owui/api` und `@owui/web`.
- **Node 24** in `.nvmrc`, `engines.node: ">=24"`. Lokal läuft Node 26.5: Corepack ist dort nicht mitgeliefert, also nicht auf Corepack verlassen.
- **TypeScript `~6.0`** (typescript-eslint erlaubt `<6.1.0`; npm-`latest` ist 7.x und darf nicht installiert werden).
- **NestJS** mit Feature-Modulen, **TypeORM** + PostgreSQL/pgvector, Migrationen per TypeORM-CLI, `synchronize` immer `false`. **Kein Redis, kein WebSocket, kein pg-boss** in diesem Plan.
- **Validierung:** DTOs mit `class-validator`, globale `ValidationPipe` mit `whitelist` + `forbidNonWhitelisted`. **API-Vertrag:** OpenAPI aus dem Backend, Client per Orval; keine handgeschriebenen Paralleltypen.
- **Lint/Format:** ESLint (Flat Config, `typescript-eslint`) + Prettier. **Tests:** Vitest (mit `unplugin-swc` für `apps/api`; Rückfall auf Jest nur für `apps/api`, falls SWC die Nest-Decorators nicht sauber verarbeitet, siehe Task 4), Supertest für HTTP-Tests.
- **Invarianten aus Spec 5 Stufe 1** gelten ab dem ersten Commit (Nutzerbegrenzung in SQL, keine Inhalte in Logs, Env nur über das Config-Modul, `SafeFetchService` für fremde URLs, Modellausgabe unvertraut, UI-Zustände, generierte Migrationen nie von Hand ändern, Verify-before-deciding, relative Markdown-Links).
- **Git:** direkt auf `main`, kleine Commits, Conventional Commits, `--no-verify` ist verboten (schlägt ein Hook fehl, wird die Ursache behoben). Jede Commit-Nachricht endet mit der Zeile `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (zweites `-m`).
- **Secrets:** `.env*` nie lesen, ausgeben oder committen (außer `.env.example`).
- **Sprache:** Code, Bezeichner und Code-Kommentare englisch; Dokumente deutsch; UI-Texte nur über i18n-Schlüssel, Standardsprache Deutsch ohne Fachbegriffe.
- **Versionen (am 2026-10-09 per `npm view` geprüft):** NestJS 12.1.x, `@nestjs/typeorm` 12.0, `@nestjs/config` 12.0, `@nestjs/swagger` 12.0, `@nestjs/terminus` 12.1, `@nestjs/throttler` 6.7, TypeORM 1.1, Vitest 5.0, Vite 8, React 19, Tailwind 4.3, Orval 8.4, ESLint 10, typescript-eslint 8.71, Prettier 3.9, Husky 9, lint-staged 17, dependency-cruiser 18.5, undici 8, ipaddr.js 2.5. **Die Codebeispiele sind aus NestJS-11-/Vitest-3-Erfahrung geschrieben.** Jeder Task nennt, wo gegen die aktuelle Doku zu prüfen ist; weicht eine API ab, folgt man der aktuellen Doku und behält das **getestete Verhalten** bei (Tests sind der Vertrag, nicht die Syntax).

## Review Focus

Eingabeklassen und Fehlerfälle, die die Spec nahelegt, aber nicht ausdrücklich nennt. Jede Zeile hat einen Test im genannten Task.

1. **Verschleierte IP-Schreibweisen und IPv4-in-IPv6 beim SSRF-Schutz** (`http://[::ffff:127.0.0.1]/`, `http://2130706433/`, `http://0x7f.1/`, `http://127.1/`, `http://localhost./`, `http://user:pw@host/`): müssen blockiert bzw. abgelehnt werden. → Task 9.
2. **Weiterleitung von öffentlicher auf private Adresse oder auf ein anderes Schema** (`302` nach `http://10.0.0.5/` oder `file:///etc/passwd`), Weiterleitungsschleife, `Content-Type` außerhalb der Allowlist, zu große oder hängende Antwort. → Task 9.
3. **Fehlermeldung beim ungültigen Start enthält keine Geheimnisse:** `DATABASE_URL` mit Passwort darf weder in der Env-Fehlermeldung noch im 500-Response auftauchen; leere Optional-Variablen (`OTEL_EXPORTER_OTLP_ENDPOINT=`) gelten als nicht gesetzt. → Task 4, 5.
4. **Manipulierte Anfragen am HTTP-Rand:** ungültige/überlange `x-request-id`, `Origin: null`, Origin nicht in der Liste (POST und Preflight), JSON-Body über dem Limit (413 als Problem Details, nicht als HTML). → Task 5, 6.
5. **Ausfall und Herunterfahren:** Readiness liefert 503, wenn die DB nicht antwortet oder der Prozess herunterfährt, während Liveness 200 bleibt; Health ist vom Rate Limit ausgenommen. → Task 8.
6. **localStorage nicht verfügbar** (Private Window, gesperrt): Theme-Umschalter funktioniert trotzdem. → Task 13.

## Datei-Struktur (Ergebnis dieses Plans)

```
.editorconfig  .gitignore  .gitleaks.toml  .nvmrc  .prettierrc.json  .prettierignore  .dockerignore
.env.example  package.json  pnpm-workspace.yaml  tsconfig.base.json  eslint.config.mjs  renovate.json
AGENTS.md  CLAUDE.md  README.md  compose.yml  compose.dev.yml
.claude/settings.json
.husky/pre-commit  .husky/pre-push
.github/workflows/ci.yml
config/dependency-cruiser.cjs
scripts/smoke.mjs  scripts/pin-actions.sh
docs/PLAN.md  docs/BACKLOG.md  docs/THREAT-MODEL.md  docs/adr/0001-tech-stack.md  docs/adr/0002-csp-style-src.md  docs/dod/00-fundament.md
apps/api/
  package.json  tsconfig.json  tsconfig.build.json  nest-cli.json  vitest.config.ts  vitest.db.config.ts  Dockerfile  openapi.json
  test/db-global-setup.ts
  src/main.ts  src/app.module.ts  src/app.factory.ts  src/instrumentation.ts  src/telemetry.ts
  src/config/env.ts  src/config/app-config.module.ts
  src/logging/logger.module.ts  src/logging/redact.ts  src/logging/request-id.ts
  src/common/common.module.ts  src/common/problem-details.filter.ts  src/common/validation.pipe.ts
  src/security/allowed-origins.ts  src/security/http-security.ts  src/security/origin-check.guard.ts  src/security/security.module.ts
  src/database/{entities.ts,data-source.ts,database.module.ts,migrate.ts,migrate-cli.ts,migrations/{index.ts,1791504000000-init-foundation.ts}}
  src/database/audit/{audit-log.entity.ts,audit.service.ts,audit.module.ts,audit-action.ts}
  src/health/{health.controller.ts,health.dto.ts,health.module.ts,lifecycle.service.ts}
  src/http/safe-fetch/{errors.ts,ip-policy.ts,safe-fetch.service.ts,safe-fetch.module.ts}
  src/openapi/{build-document.ts,generate.ts}
  src/testing/create-test-app.ts
apps/web/
  package.json  index.html  vite.config.ts  tsconfig.json  components.json  orval.config.ts  Caddyfile  Dockerfile
  src/main.tsx  src/index.css  src/test/setup.ts
  src/i18n/{index.ts,locales/de.json,locales/en.json}
  src/api/{fetcher.ts,trace.ts,generated/**}
  src/app/{providers.tsx,router.tsx}
  src/components/{ui/**,theme/theme-provider.tsx,theme/theme-toggle.tsx,layout/app-layout.tsx}
  src/features/health/{api-status.tsx,use-api-health.ts}
  src/pages/home-page.tsx
```

Test-Konventionen: `*.spec.ts` laufen ohne Datenbank (inklusive HTTP-Tests mit Supertest), `*.db.spec.ts` brauchen Postgres (`pnpm db:up`, `pnpm test:db`).

---

### Task 1: Workspace- und Tooling-Basis

**Files:**
- Create: `.nvmrc`, `.gitignore`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`

**Interfaces:**
- Produces: Root-Skripte `lint`, `format`, `format:check`, `typecheck`, `check`, `test`; Workspace-Muster `apps/*`; `tsconfig.base.json` (von beiden Apps erweitert); ESLint-Basiskonfiguration (Task 3 ergänzt Regeln).

- [ ] **Step 1: Werkzeuge prüfen (nur lesen)**

```bash
node -v && pnpm -v && docker --version && docker compose version && git remote -v && gh auth status
```
Erwartet: Node ≥ 24, pnpm vorhanden, Docker Compose v2. `git remote -v` darf leer sein (dann läuft CI erst nach dem ersten Push; das ist in Task 15/16 vermerkt). Fehlt etwas, melde es dem Nutzer, bevor du weitermachst.

- [ ] **Step 2: Wurzeldateien anlegen**

`.nvmrc`:
```
24
```

`.gitignore`:
```
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
*.log
.DS_Store
.claude/settings.local.json
.claude/worktrees/
.claude/.cc-writes/
```

`.editorconfig`:
```
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true
```

`.prettierrc.json`:
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

`.prettierignore`:
```
node_modules
dist
coverage
pnpm-lock.yaml
apps/api/openapi.json
apps/web/src/api/generated
apps/web/src/components/ui
docs/superpowers
.claude/worktrees
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
# Supply-chain hardening: ignore versions younger than 7 days (minutes) and run install scripts
# only for explicitly approved packages. Extend onlyBuiltDependencies consciously, one package at a time.
minimumReleaseAge: 10080
onlyBuiltDependencies:
  - '@swc/core'
  - esbuild
```
Prüfe gegen die pnpm-Doku (`pnpm --help`, https://pnpm.io/settings), dass beide Schlüssel in deiner pnpm-Version so heißen; sonst Schlüssel anpassen, Verhalten beibehalten.

`package.json`:
```json
{
  "name": "open-webui-klon",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "pnpm --parallel --filter @owui/api --filter @owui/web dev",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "pnpm -r --if-present typecheck",
    "check": "pnpm typecheck && pnpm lint && pnpm format:check",
    "test": "pnpm -r --if-present test",
    "test:db": "pnpm --filter @owui/api test:db",
    "db:up": "docker compose -f compose.yml -f compose.dev.yml up -d --wait db",
    "db:down": "docker compose -f compose.yml -f compose.dev.yml down",
    "openapi": "pnpm --filter @owui/api build && pnpm --filter @owui/api openapi && pnpm --filter @owui/web api:generate"
  }
}
```
(`prepare: husky` und `lint-staged` kommen in Task 3; `depcruise` wird in Task 3 Teil von `check`.)

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```
(`module`/`moduleResolution` setzt jede App selbst; TypeScript 6 hat Auswahl und Deprecations dort geändert, siehe Task 4/12.)

`eslint.config.mjs`:
```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/web/src/api/generated/**',
      'apps/web/src/components/ui/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
    },
  },
  prettier
);
```

- [ ] **Step 3: Abhängigkeiten installieren und `packageManager` setzen**

```bash
pnpm pkg set packageManager="pnpm@$(pnpm -v)"
pnpm add -D -w typescript@~6.0 eslint @eslint/js typescript-eslint eslint-config-prettier prettier globals
```
Falls pnpm Installationsskripte ignoriert und eine Warnung ausgibt: nur freigeben, was wirklich nötig ist (`onlyBuiltDependencies`). Falls `minimumReleaseAge` eine Version blockiert: nimm die nächstältere passende, nicht die Karenzzeit abschalten.

- [ ] **Step 4: Prüfen**

Run: `pnpm lint && pnpm format:check && pnpm typecheck`
Expected: alle drei laufen ohne Fehler (es gibt noch keine Apps; `typecheck` läuft leer). Formatiere bei Bedarf mit `pnpm format`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: set up pnpm workspace with eslint, prettier and typescript base config" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Agentenregeln und Projektdokumente

**Files:**
- Create: `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`, `docs/PLAN.md`, `docs/BACKLOG.md`, `docs/THREAT-MODEL.md`, `docs/adr/0001-tech-stack.md`

**Interfaces:**
- Produces: die Regeln, auf die sich alle späteren Tasks und Teilprojekte beziehen (Layer, Invarianten, Befehle). Die Dateinamen der Einstiegspunkte, die `process.env` lesen dürfen, stehen in AGENTS.md Regel 6 und müssen zu Task 4, 7, 10, 11 passen.

- [ ] **Step 1: `AGENTS.md` schreiben**

````markdown
# Agentenregeln

Kanonische Regeln für jeden Coding-Agenten in diesem Repo. `CLAUDE.md` importiert nur diese Datei.
Projektkontext: [docs/PLAN.md](docs/PLAN.md). Spec:
[docs/superpowers/specs/2026-10-09-open-webui-nestjs-design.md](docs/superpowers/specs/2026-10-09-open-webui-nestjs-design.md).
Nutze `pnpm`, nie `npm` oder `yarn`.

## 1. Schichten (erzwungen durch `pnpm depcruise` und ESLint)

- **`apps/api`**: Feature-Module (`auth`, `users`, `chats`, ...). Controller sind dünn: Eingabe per DTO
  validieren, Nutzer aus der Session lesen, an einen Service delegieren, Antwort formen. Geschäftslogik
  steht in Services. DB, LLM-Anbieter, Dateispeicher und Job-Queue liegen hinter Injection-Tokens und
  sind in Tests per `overrideProvider` austauschbar.
- **`apps/web`**: Serverzustand nur über TanStack Query. Der API-Client ist **generiert**
  (`pnpm openapi`), nie von Hand geschrieben. `apps/web` importiert nie Laufzeitcode aus `apps/api`;
  `apps/api` importiert nie aus `apps/web`. Keine Zyklen.
- **SoC vor DRY.** Ähnlicher Code in zwei Features ist okay; extrahiert wird bei der dritten identischen
  Verwendung. Keine spekulativen Abstraktionen (YAGNI).
- Fail fast: DB- und Anbieterfehler werden geworfen. Kein stilles `catch`, keine Ersatzdaten in
  Produktionspfaden.
- Filtern, Suchen und Aggregieren passiert in PostgreSQL, nie durch Laden ganzer Tabellen in Node.
- Strenge Typen: kein `any`, kein `@ts-ignore`, kein `as unknown as`, kein `export *`. Typen kommen aus
  DTOs und dem generierten Client, keine handgeschriebenen Paralleltypen.
- Werte, die Logik steuern (Status, Rolle, Audit-Aktion), stehen als `export const X = {...} as const`
  in einem Wörterbuch und werden überall importiert, auch in Tests.

## 2. Invarianten

1. Jede Datenabfrage ist in SQL auf `userId` bzw. ACL begrenzt. Die Identität stammt aus der
   Server-Session, nie vom Client.
2. Quellenangaben im Chat werden serverseitig gegen den an das Modell gesendeten Kontext geprüft.
3. Ingestion ist idempotent (SHA-256 des Inhalts pro Nutzer, kein doppeltes Parsen oder Embedden).
4. Keine Dokument- oder Chat-Inhalte in Logs; nur IDs, Längen, Dauer, Token-Zahlen.
5. Modell-IDs und Limits nur aus der Konfiguration.
6. **Env nur über `apps/api/src/config/env.ts`.** Nur diese Einstiegspunkte reichen `process.env` an
   `validateEnv`/`loadEnv` weiter: `main.ts`, `instrumentation.ts`, `database/data-source.ts`,
   `database/migrate-cli.ts`, `openapi/generate.ts` und das DB-Test-Setup. `.env*` wird nie gelesen,
   ausgegeben oder committet; nur `.env.example` ist versioniert.
7. Jeder ausgehende HTTP-Abruf auf eine nutzer- oder modellbeeinflusste URL läuft über
   `SafeFetchService` (`apps/api/src/http/safe-fetch`). Direkter `fetch`, `axios`, `undici`, `got`,
   `http.request` dafür ist per ESLint verboten.
7a. Ausgabe von Sprachmodellen, Tool-Ergebnisse und abgerufene Dokumente sind unvertraute Eingaben:
    kein HTML-Rendering, keine privilegierte Aktion allein aufgrund von Modellausgabe.
8. Jede asynchrone UI-Ansicht kennt leer, laden, Fehler mit Retry und "in Arbeit" (Buttons gesperrt,
   kein Doppel-Submit).
9. Migrationen für Schemaänderungen werden **generiert** (`migration:generate`) und danach nie von Hand
   geändert. Reine SQL-Migrationen (Trigger, Erweiterungen) entstehen mit `migration:create`. Neue
   Entities und Migrationen werden in `database/entities.ts` bzw. `database/migrations/index.ts`
   eingetragen.
10. **Verify before deciding:** Versionen, Preise, Limits und Bibliotheks-APIs vor dem Einsatz in der
    aktuellen Doku prüfen; sagen, wo man unsicher ist.
11. Relative Markdown-Links, keine absoluten Rechnerpfade. Doku im selben Commit aktualisieren, wenn sich
    Architektur oder Vertrag ändern.
12. UI-Texte nur über i18n-Schlüssel (`apps/web/src/i18n`), Standardsprache Deutsch, ohne Fachbegriffe
    wie "RAG" oder "Embedding". shadcn-Bausteine und semantische Tokens, keine freien Palettenfarben.

## 3. Befehle

| Befehl                                                   | Zweck                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm check`                                             | Typecheck, ESLint, Prettier-Check, dependency-cruiser              |
| `pnpm test`                                              | Vitest ohne Datenbank (inklusive HTTP-Tests mit Supertest)         |
| `pnpm db:up` / `pnpm test:db`                            | Postgres für lokale DB-Tests starten / DB-Tests ausführen          |
| `pnpm openapi`                                           | OpenAPI erzeugen und Web-Client neu generieren                     |
| `pnpm --filter @owui/api migration:generate <Pfad/Name>` | Migration aus Entity-Änderungen erzeugen                           |
| `pnpm --filter @owui/api migration:create <Pfad/Name>`   | leere Migration für Raw-SQL                                        |
| `docker compose up --build`                              | gesamte App (Postgres, API, Web) auf http://localhost:8080         |
| `node scripts/smoke.mjs http://localhost:8080`           | Smoke-Test gegen die laufende App                                  |

## 4. Arbeitsweise

- **Vor dem Code:** Umfang, Nicht-Umfang und der Befehl, der den Erfolg beweist, in wenigen Zeilen
  festhalten. Vertrag (DTO/Schema) zuerst, kleinster Diff, der besteht. Bei Fehlern in Logik beginnt
  die Korrektur mit einem Test, der den Fehler zeigt.
- **Git:** direkt auf `main`, kleine Commits (ein Thema), Conventional Commits, Imperativ.
  Husky-Hooks (`pnpm check`, Tests) nie mit `--no-verify` umgehen. `.env*` nie stagen. Nach einem Push
  `gh run list --branch main --limit 1` prüfen und rote CI vor neuer Arbeit beheben.
- **Abhängigkeiten** dürfen ohne Rückfrage ergänzt werden: aktuelle Doku prüfen (Regel 10), Menge klein
  halten, Grund in die Commit-Nachricht. Neue Pakete mit Installationsskripten nur bewusst in
  `onlyBuiltDependencies` freigeben.
- **UI-Änderungen** werden im Browser angesehen (Konsole auf CSP-Verstöße prüfen), bevor sie als fertig
  gelten.
- Rückfragen an den Nutzer nur bei Umfang, Kosten, Datenschutz, Secrets oder nicht umkehrbaren Aktionen.
````

- [ ] **Step 2: `CLAUDE.md` und `.claude/settings.json`**

`CLAUDE.md`:
```
@AGENTS.md
```

`.claude/settings.json`:
```json
{
  "permissions": {
    "deny": [
      "Read(.env)",
      "Read(.env.*)",
      "Read(!.env.example)",
      "Edit(.env)",
      "Edit(.env.*)",
      "Edit(!.env.example)",
      "Edit(pnpm-lock.yaml)"
    ],
    "allow": [
      "Bash(pnpm add *)",
      "Bash(pnpm remove *)",
      "Bash(pnpm check)",
      "Bash(pnpm typecheck)",
      "Bash(pnpm lint)",
      "Bash(pnpm test)",
      "Bash(pnpm test:db)",
      "Bash(pnpm format*)",
      "Bash(pnpm openapi)",
      "Bash(pnpm db:*)",
      "Bash(pnpm exec vitest *)",
      "Bash(git status*)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git show*)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git push*)",
      "Bash(gh run *)"
    ],
    "ask": ["Edit(AGENTS.md)", "Edit(.claude/**)", "Bash(pnpm dlx *)"]
  }
}
```

- [ ] **Step 3: `docs/PLAN.md`, `docs/BACKLOG.md`**

`docs/PLAN.md`:
```markdown
# Plan und Stand

Ziel: Nachbau von Open WebUI mit NestJS-Backend und React-Frontend. Die Gesamt-Spec steht in
[docs/superpowers/specs/2026-10-09-open-webui-nestjs-design.md](superpowers/specs/2026-10-09-open-webui-nestjs-design.md).
Pläne je Teilprojekt liegen unter [docs/superpowers/plans/](superpowers/plans/).

| #   | Teilprojekt                | Stand                                                                                   |
| --- | -------------------------- | --------------------------------------------------------------------------------------- |
| 0   | Fundament                  | in Arbeit, Plan: [Teilprojekt 0](superpowers/plans/2026-10-09-teilprojekt-0-fundament.md) |
| 1   | Auth + Nutzer/Rollen       | offen                                                                                   |
| 2   | Modell-Anbindung           | offen                                                                                   |
| 3   | Chat + Streaming           | offen                                                                                   |
| 4   | RAG                        | offen                                                                                   |
| 5   | Tools                      | offen                                                                                   |
| 6   | Härtung                    | offen                                                                                   |
| 7-9 | Websuche, Nutzer-Tools, Enterprise-Funktionen | optional                                                             |
| 10  | Deployment                 | zurückgestellt                                                                          |

Architekturentscheidungen: [docs/adr/](adr/). Bedrohungsmodell: [docs/THREAT-MODEL.md](THREAT-MODEL.md).
Offenes und bewusst Verworfenes: [docs/BACKLOG.md](BACKLOG.md).
```

`docs/BACKLOG.md`:
```markdown
# Backlog

Hier steht, was offen ist oder bewusst nicht gebaut wird. Erledigtes steht in der Git-Historie.

## Offen

| Thema                                   | Notiz                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Stufe 2 des Agentic-Setups              | Stop-Hook, Bash-Guard (mit Tests), DoD-Vorlage, Testregeln; eigener Plan direkt nach Teilprojekt 0.       |
| `compose.dev.yml` mit Hot Reload        | Spec Abschnitt 7 sieht Container mit Hot Reload vor; Teilprojekt 0 liefert nur Postgres-Port und Test-DB. Entwicklung: `pnpm db:up`, dann `pnpm dev`. |
| OpenAPI-Breaking-Change-Prüfung         | `oasdiff` in der CI, sobald es einen ersten stabilen API-Stand gibt (Teilprojekt 1).                      |
| Parallele Migrationen                   | Der API-Container führt Migrationen beim Start aus; bei mehreren Instanzen braucht es eine Sperre.        |
| CSRF-Token                              | Kommt mit den Sessions in Teilprojekt 1; bis dahin schützt die Origin-Prüfung.                            |
| knip, jscpd, Magic-String-Audit         | ab Teilprojekt 1.                                                                                         |
| Strengere `style-src`                   | siehe [ADR 0002](adr/0002-csp-style-src.md).                                                              |
```

- [ ] **Step 4: `docs/THREAT-MODEL.md` und `docs/adr/0001-tech-stack.md`**

`docs/THREAT-MODEL.md`:
```markdown
# Bedrohungsmodell (STRIDE)

Stand: Teilprojekt 0. Wird in jedem Teilprojekt fortgeschrieben. Maßstab und Maßnahmenkatalog:
[Spec Abschnitt 6.1](superpowers/specs/2026-10-09-open-webui-nestjs-design.md).

## Werte

Nutzerkonten und Sessions, Chat-Inhalte, hochgeladene Dokumente und Embeddings, API-Keys der Nutzer,
Provider-Keys der Admins, die Verfügbarkeit der API und der Modell-Anbieter (Kosten).

## Akteure und Vertrauensgrenzen

| Akteur / Quelle                          | Vertrauen        | Grenze                                         |
| ---------------------------------------- | ---------------- | ---------------------------------------------- |
| Angemeldeter Nutzer                      | gering           | Browser -> Caddy -> API                        |
| Admin                                    | erhöht           | konfiguriert Anbieter und Hosts                |
| Sprachmodell-Ausgabe, Tool-Ergebnisse    | **unvertraut**   | API <-> Anbieter                               |
| Hochgeladene und abgerufene Dokumente    | **unvertraut**   | Upload, `SafeFetchService`                     |
| Externe Anbieter (Ollama, OpenAI-kompatibel) | teilvertraut | ausgehende Verbindungen der API                |
| Postgres                                 | vertraut         | internes Docker-Netz `backend`                 |

## Bedrohungen

| STRIDE                  | Bedrohung                                                  | Maßnahme (Teilprojekt)                                                                  |
| ----------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Spoofing                | Konto-Übernahme, Brute Force                               | Argon2id, Rate Limit, Session-Rotation (1); Rate Limit global (0)                        |
| Tampering               | Manipulierte Requests, Mass Assignment                     | ValidationPipe mit Whitelist (0); Origin-Prüfung für schreibende Requests (0)            |
| Tampering               | Audit-Einträge nachträglich ändern                         | Append-only-Trigger auf `audit_log` (0)                                                  |
| Repudiation             | Wer hat was geändert?                                      | Audit-Log mit Request-ID (0), Nutzung ab (1)                                             |
| Information disclosure  | IDOR, fremde Daten lesen                                   | Abfragen in SQL nach Besitzer/ACL begrenzt, Test pro Endpunkt (jedes)                    |
| Information disclosure  | Geheimnisse in Logs und Fehlern                            | `pino redact`, generische 500er, Env-Fehler ohne Werte (0)                               |
| Information disclosure  | Datenabfluss über Markdown-Bilder/-Links                   | Sanitizing, strenge `img-src` (3)                                                        |
| Denial of service       | Anfragenflut, große Bodies, teure LLM-Aufrufe              | Throttler, Body-Limit (0); Token-Quoten (1-4)                                            |
| Elevation of privilege  | SSRF auf interne Dienste und Cloud-Metadaten               | `SafeFetchService` mit IP-Sperrliste, Pinning, Redirect-Prüfung (0); Netzsegmentierung (0) |
| Elevation of privilege  | Prompt Injection führt zu privilegierter Aktion            | Tools mit geringsten Rechten und Bestätigung (5); Modellausgabe unvertraut (Invariante 7a) |
| Elevation of privilege  | Kompromittierte Abhängigkeit                               | Lockfile, Karenzzeit, Installationsskripte nur freigegeben, Renovate, Audit, Trivy (0)   |
```

`docs/adr/0001-tech-stack.md`:
```markdown
# ADR 0001: Technologie-Stack

Status: angenommen (2026-10-09)

## Kontext

Open WebUI wird als Lern- und Privatprojekt nachgebaut. Das Backend soll NestJS nach den Konventionen der
NestJS-Dokumentation sein; das Frontend wird neu in React + Vite gebaut. Der Stack soll einfach bleiben und
trotzdem Enterprise-Anforderungen erfüllen.

## Entscheidung

pnpm-Monorepo; NestJS mit TypeORM und PostgreSQL/pgvector; Cookie-Sessions; SSE statt WebSocket; pg-boss
statt Redis (ab Teilprojekt 3); Vercel AI SDK für Modellanbieter; DTOs mit class-validator, OpenAPI und
Orval-generierter Client; React, Vite, Tailwind, shadcn/ui, TanStack Query, react-i18next; ESLint + Prettier;
Vitest; OpenTelemetry; Caddy als Reverse Proxy im Web-Image.

## Folgen

- Weniger bewegliche Teile (kein Redis, kein WebSocket-Gateway).
- TypeORM ist Nest-nativ, hat aber schwächere Query-Typisierung als Prisma/Drizzle; Raw-SQL für Vektorsuche
  bleibt möglich.
- Gründe und Alternativen im Detail: [Spec Abschnitt 2](../superpowers/specs/2026-10-09-open-webui-nestjs-design.md).
```

- [ ] **Step 5: Prüfen und committen**

Run: `pnpm format && pnpm check`
Expected: PASS. (Prettier formatiert die Markdown-Tabellen um; das ist gewollt.)

```bash
git add -A
git commit -m "docs: add agent rules, project plan, backlog, threat model and ADR 0001" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Hooks, Architekturregeln und Secret-Scanning

**Files:**
- Create: `config/dependency-cruiser.cjs`, `.husky/pre-commit`, `.husky/pre-push`, `.gitleaks.toml`
- Modify: `package.json` (Skripte, `lint-staged`, `prepare`), `eslint.config.mjs` (Projektregeln), `AGENTS.md` unverändert

**Interfaces:**
- Consumes: Root-Skripte aus Task 1.
- Produces: `pnpm depcruise`, erweitertes `pnpm check`; ESLint-Regeln, die `no-restricted-*` für `apps/api` setzen (Ausnahme-Muster `apps/api/src/http/safe-fetch/**`); Husky-Hooks, die ab dem nächsten Commit laufen.

- [ ] **Step 1: Failing check zuerst, die ESLint-Regeln als Test**

Lege eine Wegwerf-Datei `apps/api/src/scratch-rules.ts` an (der Ordner `apps/api` existiert noch nicht; erstelle `apps/api/tsconfig.json` mit `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "module": "commonjs", "moduleResolution": "node10", "ignoreDeprecations": "6.0", "noEmit": true }, "include": ["src"] }` nur vorläufig, Task 4 ersetzt sie):

```ts
export * from './other';
const value = 1 as unknown as string;
const body = await fetch('https://example.com');
console.log(value, body);
```

Run: `pnpm lint`
Expected: FAIL (noch ohne Regeln meldet ESLint nur Typfehler/`no-console` nicht). Notiere die Ausgabe: Erst nach Step 2 muss `export *`, `as unknown as`, `fetch` und `console` jeweils gemeldet werden.

- [ ] **Step 2: ESLint-Projektregeln in `eslint.config.mjs` ergänzen**

Füge vor `prettier` diese Blöcke ein:

```js
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportAllDeclaration', message: 'No "export *": name every export.' },
        {
          selector: "TSAsExpression > TSAsExpression[typeAnnotation.type='TSUnknownKeyword']",
          message: 'No "as unknown as": fix the type instead.',
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'No dangerouslySetInnerHTML: model output and documents are untrusted.',
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Outgoing requests to user- or model-influenced URLs must use SafeFetchService.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: ['axios', 'node-fetch', 'got', 'undici', 'node:https', 'https'].map((name) => ({
            name,
            message: 'Use SafeFetchService (src/http/safe-fetch) for outgoing requests.',
          })),
          patterns: [],
        },
      ],
    },
  },
  {
    // The one place that is allowed to open outgoing connections.
    files: ['apps/api/src/http/safe-fetch/**/*.ts'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-globals': 'off' },
  },
```
`node:http` bleibt importierbar (z. B. `createServer` in Tests); gesperrt sind nur die Client-Funktionen:
```js
      'no-restricted-properties': [
        'error',
        ...['request', 'get'].flatMap((property) =>
          ['http', 'https'].map((object) => ({
            object,
            property,
            message: 'Use SafeFetchService for outgoing requests.',
          }))
        ),
      ],
```
Füge diese `no-restricted-properties`-Regel in den `apps/api`-Block (und in den Ausnahme-Block `'no-restricted-properties': 'off'`) ein.

- [ ] **Step 3: Regel-Test**

Run: `pnpm lint`
Expected: FAIL mit je einer Meldung für `export *`, `as unknown as`, `fetch` und `console`. Lösche danach `apps/api/src/scratch-rules.ts` und `apps/api/tsconfig.json` (bleiben nicht im Repo).

Run: `pnpm lint`
Expected: PASS.

- [ ] **Step 4: dependency-cruiser**

```bash
pnpm add -D -w dependency-cruiser
```

`config/dependency-cruiser.cjs`:
```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports hide layering mistakes.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'web-never-imports-api-runtime',
      severity: 'error',
      comment: 'The web app talks to the API only through the generated client.',
      from: { path: '^apps/web/src' },
      to: { path: '^apps/api', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'api-never-imports-web',
      severity: 'error',
      from: { path: '^apps/api/src' },
      to: { path: '^apps/web' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    exclude: { path: '(^|/)(dist|coverage|generated)/' },
  },
};
```
Passe in `package.json` an:
```json
"depcruise": "depcruise --config config/dependency-cruiser.cjs apps",
"check": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm depcruise"
```
Prüfe gegen die dependency-cruiser-Doku, dass TypeScript 6 unterstützt wird (`depcruise --info`); falls nicht, melde es und fixiere die letzte funktionierende Version.

- [ ] **Step 5: Regel-Test für dependency-cruiser**

Erzeuge `apps/api/src/a.ts` (`import './b'; export const a = 1;`) und `apps/api/src/b.ts` (`import './a'; export const b = 2;`), jeweils mit minimaler `apps/api/tsconfig.json` wie in Step 1.
Run: `pnpm depcruise`
Expected: FAIL mit `no-circular`. Danach beide Dateien samt tsconfig löschen.
Run: `pnpm depcruise`
Expected: PASS ("no dependency violations found").

- [ ] **Step 6: Husky, lint-staged, gitleaks**

```bash
pnpm add -D -w husky lint-staged
pnpm exec husky init
```
`husky init` legt `.husky/pre-commit` mit Beispielinhalt an; ersetze die Dateien:

`.husky/pre-commit`:
```sh
pnpm exec lint-staged
pnpm check
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git --staged --redact --config .gitleaks.toml
else
  echo "gitleaks not installed: skipped locally (CI runs it)"
fi
```

`.husky/pre-push`:
```sh
pnpm test
```

Prüfe die Syntax gegen `gitleaks --help` (ältere Versionen: `gitleaks protect --staged`). `package.json` ergänzen:
```json
"prepare": "husky",
"lint-staged": {
  "*.{ts,tsx,js,mjs,cjs}": ["eslint --fix --no-warn-ignored", "prettier --write"],
  "*.{json,md,yml,yaml,css,html}": ["prettier --write"]
}
```

`.gitleaks.toml`:
```toml
title = "open-webui-klon"

[extend]
useDefault = true

[allowlist]
description = "Documented, non-secret development defaults"
paths = ['''^\.env\.example$''']
```

- [ ] **Step 7: Prüfen und committen (der erste Commit mit Hooks)**

Run: `pnpm check`
Expected: PASS.

```bash
git add -A
git commit -m "chore: enforce layering and unsafe-code rules, add husky hooks and gitleaks config" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: der pre-commit-Hook läuft (lint-staged, `pnpm check`) und der Commit gelingt. Schlägt der Hook fehl, behebe die Ursache; nie `--no-verify`.

---

### Task 4: API-Gerüst und validierte Konfiguration

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/nest-cli.json`, `apps/api/vitest.config.ts`, `apps/api/src/config/env.ts`, `apps/api/src/config/app-config.module.ts`
- Test: `apps/api/src/config/env.spec.ts`

**Interfaces:**
- Produces:
  - `validateEnv(raw: Record<string, unknown>): Env`, `loadEnv(): Env` (liest `process.env`), Klasse `Env` mit den Feldern `NODE_ENV`, `PORT`, `DATABASE_URL`, `LOG_LEVEL`, `PUBLIC_ORIGIN`, `CORS_ORIGINS: string[]`, `TRUST_PROXY_HOPS`, `RATE_LIMIT_LIMIT`, `RATE_LIMIT_WINDOW_SECONDS`, `SHUTDOWN_DRAIN_MS`, `OTEL_EXPORTER_OTLP_ENDPOINT?: string`.
  - Wörterbücher `NODE_ENV`, `LOG_LEVEL`.
  - `AppConfigModule.forRoot(options?: { raw?: Record<string, unknown>; ignoreEnvFile?: boolean }): DynamicModule` (global; `ConfigService<Env, true>` ist injizierbar).

- [ ] **Step 1: Das aktuelle Nest-12-Gerüst ansehen (nur lesen, nichts übernehmen)**

In einem leeren Verzeichnis außerhalb des Repos (z. B. dem Scratchpad der Session):
```bash
pnpm dlx @nestjs/cli@latest new probe --package-manager pnpm --skip-git --skip-install
```
Lies dort `package.json` (Feld `type`, Skripte, Test-Runner), `tsconfig.json` (`module`, `moduleResolution`, `target`), `nest-cli.json` und `src/main.ts`. Dieser Plan nimmt **CommonJS** (`module: commonjs`) und **Imports ohne Dateiendung** an. Erzeugt Nest 12 ein ESM-Projekt (`"type": "module"`, `nodenext`), dann übernimm dessen `module`/`moduleResolution`-Einstellungen in `apps/api/tsconfig.json`, setze `"type": "module"` in `apps/api/package.json` und hänge allen relativen Imports `.js` an. Das Verhalten der Codebeispiele ändert sich dadurch nicht. Halte die Entscheidung in einem Satz in `docs/adr/0001-tech-stack.md` fest ("Modulsystem: ...").

- [ ] **Step 2: Paket und Konfiguration anlegen**

`apps/api/package.json`:
```json
{
  "name": "@owui/api",
  "version": "0.0.0",
  "private": true,
  "files": ["dist"],
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node --require ./dist/instrumentation.js dist/main.js",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:db": "vitest run --config vitest.db.config.ts",
    "migration:run": "node dist/database/migrate-cli.js",
    "migration:create": "typeorm migration:create",
    "migration:generate": "pnpm build && typeorm migration:generate -d dist/database/data-source.js",
    "openapi": "DATABASE_URL=postgresql://openapi:openapi@localhost:5432/openapi node dist/openapi/generate.js"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node10",
    "ignoreDeprecations": "6.0",
    "types": ["node"],
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "useDefineForClassFields": false,
    "noEmit": true
  },
  "include": ["src", "test", "vitest.config.ts", "vitest.db.config.ts"]
}
```
(`useDefineForClassFields: false` ist nötig, damit Dekoratoren und Klassenfeld-Initialisierer wie bei Nest üblich zusammenspielen. `types` ist explizit, weil TypeScript 6 keine `@types/*` mehr automatisch einbindet; prüfe das und die `ignoreDeprecations`-Zeile gegen `tsc --version` und die Release Notes.)

`apps/api/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src", "sourceMap": true },
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts", "src/testing"]
}
```

`apps/api/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.build.json",
    "plugins": ["@nestjs/swagger"]
  }
}
```

`apps/api/vitest.config.ts`:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['src/**/*.db.spec.ts'],
  },
});
```

- [ ] **Step 3: Abhängigkeiten installieren**

```bash
pnpm --filter @owui/api add @nestjs/common @nestjs/core @nestjs/platform-express @nestjs/config @nestjs/typeorm @nestjs/swagger @nestjs/terminus @nestjs/throttler typeorm pg reflect-metadata rxjs class-validator class-transformer nestjs-pino pino pino-http helmet ipaddr.js undici
pnpm --filter @owui/api add -D @nestjs/cli @nestjs/testing @swc/core unplugin-swc vitest supertest @types/supertest @types/express @types/node @types/pg typescript@~6.0
```

- [ ] **Step 4: Failing test schreiben**

`apps/api/src/config/env.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';

import { validateEnv } from './env';

const VALID = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://owui:secret@localhost:5432/owui',
};

describe('validateEnv', () => {
  it('applies defaults for optional values', () => {
    const env = validateEnv(VALID);

    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.PUBLIC_ORIGIN).toBe('http://localhost:8080');
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.TRUST_PROXY_HOPS).toBe(0);
    expect(env.RATE_LIMIT_LIMIT).toBe(100);
    expect(env.RATE_LIMIT_WINDOW_SECONDS).toBe(60);
    expect(env.SHUTDOWN_DRAIN_MS).toBe(5000);
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('converts numbers and splits the CORS origin list', () => {
    const env = validateEnv({
      ...VALID,
      PORT: '4000',
      CORS_ORIGINS: ' http://a.test , http://b.test:5173 ,',
    });

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test:5173']);
  });

  it.each(['*', 'http://a.test/path', 'a.test', 'http://a.test/'])(
    'rejects %s as a CORS origin',
    (origin) => {
      expect(() => validateEnv({ ...VALID, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
    }
  );

  it('treats an empty optional value as unset', () => {
    const env = validateEnv({ ...VALID, OTEL_EXPORTER_OTLP_ENDPOINT: '' });

    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
  });

  it('reports every problem at once and never echoes values', () => {
    const attempt = () =>
      validateEnv({ NODE_ENV: 'test', PORT: '99999', DATABASE_URL: 'mysql://root:hunter2@db/x' });

    expect(attempt).toThrow(/PORT/);
    expect(attempt).toThrow(/DATABASE_URL/);
    expect(attempt).not.toThrow(/hunter2/);
  });
});
```

- [ ] **Step 5: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api test`
Expected: FAIL ("Cannot find module './env'" oder ähnlich). Dies ist auch der erste Lauf von Vitest mit SWC und Dekoratoren: scheitert die Konfiguration selbst (nicht der Test), siehe Step 7.

- [ ] **Step 6: `env.ts` und `AppConfigModule` implementieren**

`apps/api/src/config/env.ts`:
```ts
import { plainToInstance, Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, Matches, Max, Min, validateSync } from 'class-validator';

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

  @Matches(POSTGRES_URL_PATTERN, { message: 'DATABASE_URL must be a postgres:// or postgresql:// URL' })
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
```

`apps/api/src/config/app-config.module.ts`:
```ts
import { type DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { loadEnv, validateEnv } from './env';

export interface AppConfigOptions {
  /** Configuration to validate instead of process.env (tests). */
  raw?: Record<string, unknown>;
  ignoreEnvFile?: boolean;
}

@Module({})
export class AppConfigModule {
  static forRoot(options: AppConfigOptions = {}): DynamicModule {
    return {
      module: AppConfigModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          ignoreEnvFile: options.ignoreEnvFile ?? false,
          envFilePath: ['.env', '../../.env'],
          // A load factory keeps the validated values out of process.env (no cross-test leakage).
          load: [() => ({ ...(options.raw ? validateEnv(options.raw) : loadEnv()) })],
        }),
      ],
    };
  }
}
```

- [ ] **Step 7: Test ausführen**

Run: `pnpm --filter @owui/api test`
Expected: PASS (5 Tests, davon 4 in `it.each`: insgesamt 8 Durchläufe).
Scheitert die Konfiguration (SWC erzeugt keine Dekorator-Metadaten, `@Type(() => Number)` greift nicht, `plainToInstance` liefert Strings), dann: erst `unplugin-swc`-Optionen gegen die aktuelle Nest-Vitest-Anleitung prüfen. Gelingt es nicht in einem vernünftigen Rahmen, **Rückfall nur für `apps/api`:** Jest mit `ts-jest` oder `@swc/jest` statt Vitest, die Testdateien bleiben gleich (`describe`/`it`/`expect`, `vi.fn` -> `jest.fn`), und die Entscheidung kommt als Satz in ADR 0001.

- [ ] **Step 8: Gesamtprüfung und Commit**

Run: `pnpm check`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): add NestJS package skeleton and validated environment configuration" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Logging, Problem Details und Validierung

**Files:**
- Create: `apps/api/src/logging/{redact.ts,request-id.ts,logger.module.ts}`, `apps/api/src/common/{problem-details.filter.ts,validation.pipe.ts,common.module.ts}`, `apps/api/src/app.factory.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/testing/create-test-app.ts`
- Test: `apps/api/src/logging/redact.spec.ts`, `apps/api/src/common/problem-details.filter.spec.ts`

**Interfaces:**
- Consumes: `AppConfigModule.forRoot`, `Env` (Task 4).
- Produces:
  - `REDACT_PATHS: string[]`, `REDACT_CENSOR`, `REQUEST_ID_HEADER = 'x-request-id'`, `generateRequestId(req, res): string`.
  - `AppLoggerModule`, `CommonModule` (registriert `ProblemDetailsFilter` als `APP_FILTER` und die globale `ValidationPipe` mit `whitelist` + `forbidNonWhitelisted` als `APP_PIPE`).
  - `ProblemDetails` Antwortform: `{ type: 'about:blank', title, status, detail, instance, requestId, errors? }` mit `Content-Type: application/problem+json`.
  - `API_PREFIX = 'api'`, `configureApp(app: NestExpressApplication): void` (Task 6 ergänzt HTTP-Sicherheit).
  - Testhelfer `createTestApp(options?: TestAppOptions): Promise<NestExpressApplication>` und `BASE_TEST_ENV` mit `TestAppOptions = { env?: Record<string,string>; imports?; controllers?; providers?; configure?: (b: TestingModuleBuilder) => TestingModuleBuilder }`.

- [ ] **Step 1: Tests und Testhelfer schreiben**

`apps/api/src/testing/create-test-app.ts`:
```ts
import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';

import { configureApp } from '../app.factory';
import { CommonModule } from '../common/common.module';
import { AppConfigModule } from '../config/app-config.module';
import { AppLoggerModule } from '../logging/logger.module';

export const BASE_TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  LOG_LEVEL: 'silent',
  PUBLIC_ORIGIN: 'http://app.test',
  CORS_ORIGINS: 'http://dev.test',
  SHUTDOWN_DRAIN_MS: '0',
};

export interface TestAppOptions {
  env?: Record<string, string>;
  imports?: ModuleMetadata['imports'];
  controllers?: ModuleMetadata['controllers'];
  providers?: ModuleMetadata['providers'];
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

/** Boots the same HTTP setup as main.ts, without a database. */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot({ raw: { ...BASE_TEST_ENV, ...options.env }, ignoreEnvFile: true }),
      AppLoggerModule,
      CommonModule,
      ...(options.imports ?? []),
    ],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  });
  if (options.configure) builder = options.configure(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}
```

`apps/api/src/logging/redact.spec.ts`:
```ts
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { REDACT_CENSOR, REDACT_PATHS } from './redact';

describe('REDACT_PATHS', () => {
  it('removes credentials from logged requests but keeps harmless fields', () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR } },
      {
        write: (line: string) => {
          lines.push(line);
        },
      }
    );

    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer token-abc',
            cookie: 'sid=cookie-1',
            'x-api-key': 'key-123',
            accept: 'text/plain',
          },
        },
        res: { headers: { 'set-cookie': 'sid=cookie-2' } },
        user: { password: 'pw-secret' },
      },
      'request'
    );

    const output = lines.join('');
    for (const secret of ['token-abc', 'cookie-1', 'cookie-2', 'key-123', 'pw-secret']) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('text/plain');
  });
});
```

`apps/api/src/common/problem-details.filter.spec.ts`:
```ts
import { Body, Controller, Get, HttpException, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IsString, MaxLength } from 'class-validator';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../testing/create-test-app';

class EchoDto {
  @IsString()
  @MaxLength(5)
  text!: string;
}

@Controller()
class ProbeController {
  @Post('echo')
  echo(@Body() dto: EchoDto): EchoDto {
    return dto;
  }

  @Get('boom')
  boom(): never {
    throw new Error('connection to postgresql://owui:hunter2@db failed');
  }

  @Get('teapot')
  teapot(): never {
    throw new HttpException('short and stout', 418);
  }
}

describe('HTTP error handling', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  async function start(): Promise<ReturnType<typeof request>> {
    app = await createTestApp({ controllers: [ProbeController] });
    return request(app.getHttpServer());
  }

  it('answers an unknown route with problem details and echoes the request id', async () => {
    const http = await start();

    const response = await http.get('/api/nope').expect(404);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body).toMatchObject({ status: 404, title: 'Not Found', instance: '/api/nope' });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('lists every validation problem and rejects unknown properties', async () => {
    const http = await start();

    const response = await http.post('/api/echo').send({ text: 'toolong', extra: 1 }).expect(400);

    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('text must be shorter'),
        expect.stringContaining('property extra should not exist'),
      ])
    );
  });

  it('hides internals of unexpected errors', async () => {
    const http = await start();

    const response = await http.get('/api/boom').expect(500);

    expect(response.body.detail).toBe('Internal server error');
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('keeps status and title of deliberate HTTP exceptions', async () => {
    const http = await start();

    const response = await http.get('/api/teapot').expect(418);

    expect(response.body).toMatchObject({ status: 418, detail: 'short and stout' });
  });

  it('answers an oversized JSON body with problem details, not HTML', async () => {
    const http = await start();

    const response = await http
      .post('/api/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ text: 'x'.repeat(200_000) }))
      .expect(413);

    expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(response.body.status).toBe(413);
  });

  it('keeps a well-formed request id and replaces a malformed one', async () => {
    const http = await start();

    const kept = await http.get('/api/nope').set('x-request-id', 'client-req-0001');
    const replaced = await http.get('/api/nope').set('x-request-id', 'bad id!');

    expect(kept.headers['x-request-id']).toBe('client-req-0001');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api test`
Expected: FAIL (fehlende Module `logger.module`, `common.module`, `app.factory`, `redact`).

- [ ] **Step 3: Implementieren**

`apps/api/src/logging/redact.ts`:
```ts
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.apiKey',
  '*.token',
];

export const REDACT_CENSOR = '[redacted]';
```

`apps/api/src/logging/request-id.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Anything else (too long, spaces, control characters) is replaced: the id ends up in logs and headers.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export function generateRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
```

`apps/api/src/logging/logger.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import type { Env } from '../config/env';
import { REDACT_CENSOR, REDACT_PATHS } from './redact';
import { generateRequestId } from './request-id';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: generateRequestId,
          redact: { paths: REDACT_PATHS, censor: REDACT_CENSOR },
          // Log method and path only: query strings can carry tokens.
          serializers: {
            req: (req: { id: string; method: string; url?: string }) => ({
              id: req.id,
              method: req.method,
              path: req.url?.split('?')[0],
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
        },
      }),
    }),
  ],
})
export class AppLoggerModule {}
```

`apps/api/src/common/validation.pipe.ts`:
```ts
import { ValidationPipe } from '@nestjs/common';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}
```

`apps/api/src/common/problem-details.filter.ts`:
```ts
import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { PinoLogger } from 'nestjs-pino';

export interface ProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  detail: string;
  instance: string;
  requestId: string;
  errors?: string[];
}

interface Description {
  status: number;
  detail: string;
  errors?: string[];
}

const GENERIC_SERVER_ERROR = 'Internal server error';

function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null || !('status' in exception)) {
    return undefined;
  }
  const { status } = exception;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ProblemDetailsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const { status, detail, errors } = this.describe(exception);

    if (status >= 500) {
      this.logger.error({ err: exception }, 'Unhandled exception');
    }

    const problem: ProblemDetails = {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Error',
      status,
      detail,
      instance: request.path,
      requestId: String(request.id),
      ...(errors ? { errors } : {}),
    };
    response.status(status).type('application/problem+json').send(JSON.stringify(problem));
  }

  private describe(exception: unknown): Description {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && 'message' in body) {
        const { message } = body;
        if (Array.isArray(message)) {
          return {
            status,
            detail: 'Request validation failed',
            errors: message.filter((item): item is string => typeof item === 'string'),
          };
        }
        if (typeof message === 'string') return { status, detail: message };
      }
      return { status, detail: exception.message };
    }
    // Errors from Express middleware (for example "payload too large") carry a 4xx status.
    const clientStatus = clientErrorStatus(exception);
    if (clientStatus !== undefined) {
      return { status: clientStatus, detail: STATUS_CODES[clientStatus] ?? 'Client error' };
    }
    return { status: 500, detail: GENERIC_SERVER_ERROR };
  }
}
```

`apps/api/src/common/common.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { ProblemDetailsFilter } from './problem-details.filter';
import { createValidationPipe } from './validation.pipe';

@Module({
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class CommonModule {}
```

`apps/api/src/app.factory.ts`:
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';

export const API_PREFIX = 'api';

/** HTTP-level setup shared by main.ts and the tests. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}
```

`apps/api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common';

import { CommonModule } from './common/common.module';
import { AppConfigModule } from './config/app-config.module';
import { AppLoggerModule } from './logging/logger.module';

@Module({ imports: [AppConfigModule.forRoot(), AppLoggerModule, CommonModule] })
export class AppModule {}
```

`apps/api/src/main.ts`:
```ts
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './app.factory';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'startup failed', error: error instanceof Error ? error.message : 'unknown' })}\n`
  );
  process.exit(1);
});
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @owui/api test`
Expected: PASS. Falls der Test "oversized JSON body" mit HTML oder ohne `problem+json` scheitert, weil Body-Parser-Fehler den Nest-Filter umgehen: registriere in `configureApp` vor allem anderen eine Express-Fehlerbehandlung (`app.use((error, request, response, next) => ...)`), die denselben Ablauf wie `ProblemDetailsFilter` nutzt (am besten den Filter-Code in eine Funktion `toProblem(exception, request)` auslagern, die beide verwenden). Das Verhalten (413 als `problem+json`) bleibt der Vertrag.

- [ ] **Step 5: Manueller Start**

```bash
pnpm --filter @owui/api build
DATABASE_URL=postgresql://x:x@localhost/x node apps/api/dist/main.js &
sleep 2 && curl -s -i localhost:3000/api/nope; kill %1
```
Expected: `404`, `content-type: application/problem+json`, ein `x-request-id`-Header.

- [ ] **Step 6: Prüfen und committen**

Run: `pnpm check && pnpm test`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): add structured logging, problem details errors and global validation" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: HTTP-Sicherheit (Helmet, CORS, Origin-Prüfung, Rate Limit)

**Files:**
- Create: `apps/api/src/security/{allowed-origins.ts,http-security.ts,origin-check.guard.ts,security.module.ts}`
- Modify: `apps/api/src/app.factory.ts`, `apps/api/src/app.module.ts`, `apps/api/src/testing/create-test-app.ts`
- Test: `apps/api/src/security/security.spec.ts`

**Interfaces:**
- Consumes: `Env` (`PUBLIC_ORIGIN`, `CORS_ORIGINS`, `TRUST_PROXY_HOPS`, `RATE_LIMIT_*`), `createTestApp`, `ProblemDetailsFilter` (Antwortform von Guard-Fehlern und 429).
- Produces: `allowedOrigins(env): string[]` (eindeutig, `PUBLIC_ORIGIN` zuerst), `applyHttpSecurity(app, env)`, `OriginCheckGuard` (global), `SecurityModule` (Throttler + Guards). Reihenfolge der globalen Guards: Throttler, dann Origin-Prüfung. `createTestApp` importiert ab jetzt `SecurityModule` fest.

- [ ] **Step 1: Failing tests schreiben**

`apps/api/src/security/security.spec.ts` (`createTestApp` bindet `SecurityModule` ein, siehe Step 3):
```ts
import { Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../testing/create-test-app';

@Controller()
class ProbeController {
  @Get('ping')
  ping(): { ok: true } {
    return { ok: true };
  }

  @Post('write')
  write(): { ok: true } {
    return { ok: true };
  }
}

describe('HTTP security', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  async function start(env: Record<string, string> = {}): Promise<ReturnType<typeof request>> {
    app = await createTestApp({
      controllers: [ProbeController],
      env: { RATE_LIMIT_LIMIT: '1000', ...env },
    });
    return request(app.getHttpServer());
  }

  describe('security headers', () => {
    it('sets a restrictive CSP, nosniff and hides the framework', async () => {
      const http = await start();

      const response = await http.get('/api/ping').expect(200);

      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('origin check for writing requests', () => {
    it('allows the public origin and the configured dev origin', async () => {
      const http = await start();

      await http.post('/api/write').set('Origin', 'http://app.test').expect(201);
      await http.post('/api/write').set('Origin', 'http://dev.test').expect(201);
    });

    it('allows requests without an Origin header (non-browser clients)', async () => {
      const http = await start();

      await http.post('/api/write').expect(201);
    });

    it.each(['http://evil.test', 'null', 'http://app.test.evil.test'])(
      'rejects a POST from origin %s with problem details',
      async (origin) => {
        const http = await start();

        const response = await http.post('/api/write').set('Origin', origin).expect(403);

        expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
      }
    );

    it('does not check safe methods', async () => {
      const http = await start();

      await http.get('/api/ping').set('Origin', 'http://evil.test').expect(200);
    });
  });

  describe('CORS', () => {
    it('answers a preflight from a listed origin with credentials allowed', async () => {
      const http = await start();

      const response = await http
        .options('/api/write')
        .set('Origin', 'http://dev.test')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBe('http://dev.test');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it.each(['http://evil.test', 'null'])(
      'sends no CORS headers to origin %s',
      async (origin) => {
        const http = await start();

        const response = await http
          .options('/api/write')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'POST');

        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      }
    );
  });

  describe('rate limit', () => {
    it('answers requests over the limit with 429 problem details', async () => {
      const http = await start({ RATE_LIMIT_LIMIT: '2', RATE_LIMIT_WINDOW_SECONDS: '60' });

      await http.get('/api/ping').expect(200);
      await http.get('/api/ping').expect(200);
      const response = await http.get('/api/ping').expect(429);

      expect(response.headers['content-type']).toMatch(/application\/problem\+json/);
      expect(response.body.status).toBe(429);
    });
  });
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `pnpm --filter @owui/api test security`
Expected: FAIL (CSP-Header, Origin-Prüfung und Rate Limit fehlen: 403/429/Header-Erwartungen schlagen fehl).

- [ ] **Step 3: Implementieren**

`apps/api/src/security/allowed-origins.ts`:
```ts
import type { Env } from '../config/env';

/** Origins that may call the API from a browser: the public one plus the configured extras. */
export function allowedOrigins(env: Pick<Env, 'PUBLIC_ORIGIN' | 'CORS_ORIGINS'>): string[] {
  return [...new Set([env.PUBLIC_ORIGIN, ...env.CORS_ORIGINS])];
}
```

`apps/api/src/security/http-security.ts`:
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import type { Env } from '../config/env';
import { allowedOrigins } from './allowed-origins';

export function applyHttpSecurity(
  app: NestExpressApplication,
  env: Pick<Env, 'PUBLIC_ORIGIN' | 'CORS_ORIGINS' | 'TRUST_PROXY_HOPS'>
): void {
  // Behind Caddy the client address comes from X-Forwarded-For; hops = number of trusted proxies.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  // The API only returns JSON: nothing may be loaded or framed from its responses.
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    })
  );
  // An explicit list (never "*" and never a reflected origin): cookies are sent along.
  app.enableCors({
    origin: allowedOrigins(env),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
}
```

`apps/api/src/security/origin-check.guard.ts`:
```ts
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import type { Env } from '../config/env';
import { allowedOrigins } from './allowed-origins';

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
```

`apps/api/src/security/security.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import type { Env } from '../config/env';
import { OriginCheckGuard } from './origin-check.guard';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl: config.get('RATE_LIMIT_WINDOW_SECONDS', { infer: true }) * 1000,
            limit: config.get('RATE_LIMIT_LIMIT', { infer: true }),
          },
        ],
      }),
    }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginCheckGuard },
  ],
})
export class SecurityModule {}
```
(Der Throttler zählt im Speicher; bei mehreren API-Instanzen braucht es später einen gemeinsamen Speicher (laut Spec erst bei horizontaler Skalierung). Die Option `throttlers` und die Einheit `ttl` in Millisekunden gelten für `@nestjs/throttler` ab v5; gegen die aktuelle Doku prüfen.)

`apps/api/src/app.factory.ts` ersetzen:
```ts
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

import type { Env } from './config/env';
import { applyHttpSecurity } from './security/http-security';

export const API_PREFIX = 'api';

/** HTTP-level setup shared by main.ts and the tests. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.setGlobalPrefix(API_PREFIX);
  applyHttpSecurity(app, {
    PUBLIC_ORIGIN: config.get('PUBLIC_ORIGIN', { infer: true }),
    CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
    TRUST_PROXY_HOPS: config.get('TRUST_PROXY_HOPS', { infer: true }),
  });
  app.enableShutdownHooks();
}
```
`apps/api/src/app.module.ts`: füge `SecurityModule` zu `imports` hinzu. `apps/api/src/testing/create-test-app.ts`: füge `SecurityModule` zu den festen `imports` hinzu (nach `CommonModule`).

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @owui/api test`
Expected: PASS (alle bisherigen und die neuen Tests).
Hinweis zu Preflight: Beantwortet Nest/cors den Preflight mit `204`, passt der Test. Antwortet es mit `200`, passe nur die Statuszahl an; die geprüften Header sind der Vertrag.

- [ ] **Step 5: Prüfen und committen**

Run: `pnpm check`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): add helmet, CORS allowlist, origin check and rate limiting" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Datenbank, Migrationen und Audit-Log

**Files:**
- Create: `compose.yml` (zunächst nur `db`), `compose.dev.yml`, `apps/api/vitest.db.config.ts`, `apps/api/test/db-global-setup.ts`
- Create: `apps/api/src/database/{data-source-options.ts,data-source.ts,entities.ts,database.module.ts,migrate.ts,migrate-cli.ts}`, `apps/api/src/database/migrations/{index.ts,1791504000000-init-foundation.ts}`, `apps/api/src/database/audit/{audit-action.ts,audit-log.entity.ts,audit.service.ts,audit.module.ts}`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/database/audit/audit.service.db.spec.ts`, `apps/api/src/database/migrate.db.spec.ts`

**Interfaces:**
- Consumes: `Env.DATABASE_URL`, `loadEnv`.
- Produces:
  - `buildDataSourceOptions(url: string): DataSourceOptions` (Entities aus `ENTITIES`, Migrationen aus `MIGRATIONS`, `synchronize: false`).
  - `runMigrations(dataSource: DataSource): Promise<string[]>` (Namen der ausgeführten Migrationen; schreibt bei `length > 0` einen Audit-Eintrag `system.migrated`).
  - `AUDIT_ACTION` (`{ SYSTEM_MIGRATED: 'system.migrated' }`), `AuditAction`, `AuditEvent = { actorId?: string; action: AuditAction; targetType?: string; targetId?: string; requestId?: string; metadata?: Record<string, unknown> }`, `AuditService.record(event: AuditEvent): Promise<void>`, `AuditModule`.
  - Tabelle `audit_log` (append-only per Trigger), Erweiterung `vector`.
  - Skripte `pnpm db:up`, `pnpm test:db`; Test-DB-URL `DATABASE_URL_TEST` (Standard `postgresql://owui:owui-dev-password@127.0.0.1:5433/owui_test`).

- [ ] **Step 1: Compose-Dateien für die lokale Datenbank**

Prüfe vorher, dass das Image existiert: `docker pull pgvector/pgvector:0.8.7-pg18` (dieselbe Version nutzt `../notebooklm-klon`; gibt es einen neueren Patch-Tag, nimm ihn nach Prüfung der Image-Doku).

`compose.yml`:
```yaml
name: open-webui-klon

services:
  db:
    image: pgvector/pgvector:0.8.7-pg18
    restart: unless-stopped
    environment:
      POSTGRES_USER: owui
      # Development default; production must set POSTGRES_PASSWORD (the database is not published).
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-owui-dev-password}
      POSTGRES_DB: owui
    volumes:
      # Postgres 18 images keep the data below /var/lib/postgresql.
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U owui -d owui']
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  pgdata:
```

`compose.dev.yml`:
```yaml
# Local development: publish the database on the loopback interface only.
services:
  db:
    ports:
      - '127.0.0.1:5433:5432'
```

Run: `pnpm db:up`
Expected: der Container wird `healthy`.

- [ ] **Step 2: Failing DB-Tests und Test-Setup schreiben**

`apps/api/vitest.db.config.ts`:
```ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.db.spec.ts'],
    globalSetup: ['test/db-global-setup.ts'],
    fileParallelism: false,
  },
});
```

`apps/api/test/db-global-setup.ts`:
```ts
import { Client } from 'pg';
import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from '../src/database/data-source-options';
import { runMigrations } from '../src/database/migrate';

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://owui:owui-dev-password@127.0.0.1:5433/owui_test';

export function testDatabaseUrl(): string {
  return process.env.DATABASE_URL_TEST ?? DEFAULT_TEST_DATABASE_URL;
}

/** Creates the test database if needed and rebuilds its schema from the migrations. */
export default async function setup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const name = url.pathname.slice(1);
  if (!name.endsWith('_test')) {
    // The schema is dropped below: never run this against a real database.
    throw new Error(`Refusing to reset database "${name}": test databases must end in "_test"`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = '/owui';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      await admin.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    }
  } finally {
    await admin.end();
  }

  const dataSource = new DataSource(buildDataSourceOptions(url.toString()));
  await dataSource.initialize();
  try {
    await dataSource.query('DROP SCHEMA public CASCADE');
    await dataSource.query('CREATE SCHEMA public');
    await runMigrations(dataSource);
  } finally {
    await dataSource.destroy();
  }
}
```

`apps/api/src/database/audit/audit.service.db.spec.ts`:
```ts
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../../test/db-global-setup';
import { buildDataSourceOptions } from '../data-source-options';
import { AUDIT_ACTION } from './audit-action';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';

describe('audit log (database)', () => {
  let dataSource: DataSource;
  let service: AuditService;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
    service = new AuditService(dataSource.getRepository(AuditLog));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('stores an event with its context', async () => {
    const requestId = randomUUID();
    const actorId = randomUUID();

    await service.record({
      actorId,
      action: AUDIT_ACTION.SYSTEM_MIGRATED,
      targetType: 'schema',
      targetId: 'public',
      requestId,
      metadata: { reason: 'test' },
    });

    const rows = await dataSource.getRepository(AuditLog).findBy({ requestId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId,
      action: 'system.migrated',
      targetType: 'schema',
      targetId: 'public',
      metadata: { reason: 'test' },
    });
    expect(rows[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it.each([
    ['UPDATE', "UPDATE audit_log SET action = 'tampered'"],
    ['DELETE', 'DELETE FROM audit_log'],
    ['TRUNCATE', 'TRUNCATE audit_log'],
  ])('refuses %s because the log is append-only', async (_name, statement) => {
    await expect(dataSource.query(statement)).rejects.toThrow(/append-only/);
  });

  it('has the pgvector extension and computes distances', async () => {
    const rows = await dataSource.query<{ distance: number }[]>(
      "SELECT ('[1,2,3]'::vector <-> '[1,2,4]'::vector) AS distance"
    );

    expect(rows[0]?.distance).toBe(1);
  });
});
```

`apps/api/src/database/migrate.db.spec.ts`:
```ts
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup';
import { AUDIT_ACTION } from './audit/audit-action';
import { AuditLog } from './audit/audit-log.entity';
import { buildDataSourceOptions } from './data-source-options';
import { runMigrations } from './migrate';

describe('runMigrations (database)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl()));
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('is idempotent: a second run applies nothing', async () => {
    expect(await runMigrations(dataSource)).toEqual([]);
  });

  it('recorded the first run in the audit log', async () => {
    const rows = await dataSource
      .getRepository(AuditLog)
      .findBy({ action: AUDIT_ACTION.SYSTEM_MIGRATED });

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.metadata).toMatchObject({ migrations: expect.any(Array) });
  });
});
```

- [ ] **Step 3: Fehlschlag prüfen**

Run: `pnpm test:db`
Expected: FAIL (Module `data-source-options`, `migrate`, `audit-log.entity` fehlen).

- [ ] **Step 4: Implementieren**

`apps/api/src/database/audit/audit-action.ts`:
```ts
export const AUDIT_ACTION = {
  SYSTEM_MIGRATED: 'system.migrated',
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];
```

`apps/api/src/database/audit/audit-log.entity.ts`:
```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Append-only (enforced by triggers in the database). Never store document or chat content here. */
@Entity({ name: 'audit_log' })
@Index('audit_log_occurred_at_idx', ['occurredAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ type: 'text' })
  action!: string;

  @Column({ name: 'target_type', type: 'text', nullable: true })
  targetType!: string | null;

  @Column({ name: 'target_id', type: 'text', nullable: true })
  targetId!: string | null;

  @Column({ name: 'request_id', type: 'text', nullable: true })
  requestId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;
}
```

`apps/api/src/database/audit/audit.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { AuditAction } from './audit-action';
import { AuditLog } from './audit-log.entity';

export interface AuditEvent {
  actorId?: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repository: Repository<AuditLog>) {}

  async record(event: AuditEvent): Promise<void> {
    await this.repository.insert({
      actorId: event.actorId ?? null,
      action: event.action,
      targetType: event.targetType ?? null,
      targetId: event.targetId ?? null,
      requestId: event.requestId ?? null,
      metadata: event.metadata ?? {},
    });
  }
}
```

`apps/api/src/database/audit/audit.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

`apps/api/src/database/entities.ts`:
```ts
import { AuditLog } from './audit/audit-log.entity';

export const ENTITIES = [AuditLog];
```

`apps/api/src/database/migrations/1791504000000-init-foundation.ts` (handgeschriebene SQL-Migration; AGENTS.md Regel 9 erlaubt das für Trigger, die TypeORM nicht erzeugt):
```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitFoundation1791504000000 implements MigrationInterface {
  name = 'InitFoundation1791504000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS vector');
    await queryRunner.query(`
      CREATE TABLE audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        occurred_at timestamptz NOT NULL DEFAULT now(),
        actor_id uuid,
        action text NOT NULL,
        target_type text,
        target_id text,
        request_id text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await queryRunner.query('CREATE INDEX audit_log_occurred_at_idx ON audit_log (occurred_at)');
    await queryRunner.query(`
      CREATE FUNCTION audit_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'audit_log is append-only';
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_log_no_update_delete
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_append_only()
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_log_no_truncate
      BEFORE TRUNCATE ON audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER audit_log_no_truncate ON audit_log');
    await queryRunner.query('DROP TRIGGER audit_log_no_update_delete ON audit_log');
    await queryRunner.query('DROP TABLE audit_log');
    await queryRunner.query('DROP FUNCTION audit_log_append_only()');
  }
}
```

`apps/api/src/database/migrations/index.ts`:
```ts
import { InitFoundation1791504000000 } from './1791504000000-init-foundation';

export const MIGRATIONS = [InitFoundation1791504000000];
```

`apps/api/src/database/data-source-options.ts`:
```ts
import type { DataSourceOptions } from 'typeorm';

import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

export function buildDataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false,
    migrationsRun: false,
    logging: ['error', 'warn'],
  };
}
```

`apps/api/src/database/data-source.ts` (nur für die TypeORM-CLI):
```ts
import { DataSource } from 'typeorm';

import { loadEnv } from '../config/env';
import { buildDataSourceOptions } from './data-source-options';

export default new DataSource(buildDataSourceOptions(loadEnv().DATABASE_URL));
```

`apps/api/src/database/migrate.ts`:
```ts
import type { DataSource } from 'typeorm';

import { AUDIT_ACTION } from './audit/audit-action';
import { AuditLog } from './audit/audit-log.entity';

/** Applies pending migrations and records them in the audit log. Returns the applied names. */
export async function runMigrations(dataSource: DataSource): Promise<string[]> {
  const applied = await dataSource.runMigrations();
  const names = applied.map((migration) => migration.name);
  if (names.length > 0) {
    await dataSource.getRepository(AuditLog).insert({
      action: AUDIT_ACTION.SYSTEM_MIGRATED,
      metadata: { migrations: names },
    });
  }
  return names;
}
```

`apps/api/src/database/migrate-cli.ts`:
```ts
import { DataSource } from 'typeorm';

import { loadEnv } from '../config/env';
import { buildDataSourceOptions } from './data-source-options';
import { runMigrations } from './migrate';

async function main(): Promise<void> {
  const dataSource = new DataSource(buildDataSourceOptions(loadEnv().DATABASE_URL));
  await dataSource.initialize();
  try {
    const names = await runMigrations(dataSource);
    process.stdout.write(
      `${JSON.stringify({ level: 'info', msg: 'migrations applied', count: names.length, names })}\n`
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ level: 'fatal', msg: 'migration failed', error: error instanceof Error ? error.message : 'unknown' })}\n`
  );
  process.exit(1);
});
```

`apps/api/src/database/database.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { Env } from '../config/env';
import { buildDataSourceOptions } from './data-source-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        ...buildDataSourceOptions(config.get('DATABASE_URL', { infer: true })),
        // Fail fast with a clear error instead of hanging for half a minute.
        retryAttempts: 3,
        retryDelay: 1000,
      }),
    }),
  ],
})
export class DatabaseModule {}
```
`apps/api/src/app.module.ts`: füge `DatabaseModule` und `AuditModule` zu `imports` hinzu.

- [ ] **Step 5: DB-Tests ausführen**

Run: `pnpm test:db`
Expected: PASS (Setup legt `owui_test` an und migriert; 6 Tests in `audit.service.db.spec.ts`, 2 in `migrate.db.spec.ts`). Ist die Datenbank nicht erreichbar, läuft `pnpm db:up` nicht; prüfe `docker compose ps`.

- [ ] **Step 6: Entity und Migration stimmen überein (Drift-Prüfung)**

Die handgeschriebene Migration muss genau das Schema der Entity erzeugen. Prüfe das mit der CLI gegen die Test-DB:
```bash
pnpm --filter @owui/api build
DATABASE_URL=postgresql://owui:owui-dev-password@127.0.0.1:5433/owui_test \
  pnpm --filter @owui/api exec typeorm migration:generate -d dist/database/data-source.js --check src/database/migrations/drift-check
```
Expected: "No changes in database schema were found" (Exit-Code 0). Meldet TypeORM Unterschiede (z. B. Indexname, Default), passe die Entity oder die Migration an, bis sie übereinstimmen; lege **keine** Drift-Migration an. Prüfe die Option `--check` gegen `typeorm migration:generate --help` der installierten Version.

- [ ] **Step 7: Prüfen und committen**

Run: `pnpm check && pnpm test`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): add TypeORM setup, initial migration with pgvector and append-only audit log" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Health-Endpunkte und kontrolliertes Herunterfahren

**Files:**
- Create: `apps/api/src/health/{health.dto.ts,health.controller.ts,lifecycle.service.ts,health.module.ts}`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/health/health.spec.ts`

**Interfaces:**
- Consumes: `createTestApp` (mit `SecurityModule`), `TypeOrmHealthIndicator` aus `@nestjs/terminus`, `Env.SHUTDOWN_DRAIN_MS`.
- Produces: `GET /api/health/live` -> `200 { status: 'ok' }` (immer, solange der Prozess lebt); `GET /api/health/ready` -> `200 { status: 'ok' }` oder `503` (Problem Details), wenn die DB nicht antwortet oder der Prozess herunterfährt; beide ausgenommen vom Rate Limit. `LifecycleService` mit `isShuttingDown(): boolean`, `onModuleDestroy()`, `beforeApplicationShutdown()` (wartet `SHUTDOWN_DRAIN_MS`). `HealthStatusDto { status: string }`. Operations-IDs (für Orval, Task 11): `healthLive`, `healthReady`.

- [ ] **Step 1: Failing tests schreiben**

`apps/api/src/health/health.spec.ts`:
```ts
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestApp } from '../testing/create-test-app';
import { HealthModule } from './health.module';
import { LifecycleService } from './lifecycle.service';

const databaseUp = { pingCheck: (key: string) => Promise.resolve({ [key]: { status: 'up' } }) };
const databaseDown = { pingCheck: (key: string) => Promise.resolve({ [key]: { status: 'down' } }) };

describe('health', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    vi.useRealTimers();
    await app.close();
  });

  async function start(
    database: typeof databaseUp,
    env: Record<string, string> = {}
  ): Promise<ReturnType<typeof request>> {
    app = await createTestApp({
      imports: [HealthModule],
      env,
      configure: (builder) => builder.overrideProvider(TypeOrmHealthIndicator).useValue(database),
    });
    return request(app.getHttpServer());
  }

  it('reports liveness without touching the database', async () => {
    const http = await start(databaseDown);

    const response = await http.get('/api/health/live').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('is ready when the database answers', async () => {
    const http = await start(databaseUp);

    const response = await http.get('/api/health/ready').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('is not ready when the database does not answer, while liveness stays green', async () => {
    const http = await start(databaseDown);

    const ready = await http.get('/api/health/ready').expect(503);
    await http.get('/api/health/live').expect(200);

    expect(ready.headers['content-type']).toMatch(/application\/problem\+json/);
  });

  it('turns not ready as soon as shutdown begins, while liveness stays green', async () => {
    const http = await start(databaseUp);

    app.get(LifecycleService).onModuleDestroy();

    await http.get('/api/health/ready').expect(503);
    await http.get('/api/health/live').expect(200);
  });

  it('is exempt from the rate limit', async () => {
    const http = await start(databaseUp, { RATE_LIMIT_LIMIT: '2' });

    for (let i = 0; i < 6; i += 1) {
      await http.get('/api/health/live').expect(200);
    }
  });
});

describe('LifecycleService drain period', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the configured drain time before the server closes', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [LifecycleService, { provide: ConfigService, useValue: { get: () => 5000 } }],
    }).compile();
    const lifecycle = moduleRef.get(LifecycleService);
    vi.useFakeTimers();
    const finished = vi.fn();

    const pending = lifecycle.beforeApplicationShutdown().then(finished);
    await vi.advanceTimersByTimeAsync(4999);
    expect(finished).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(finished).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `pnpm --filter @owui/api test health`
Expected: FAIL (`./health.module` fehlt).

- [ ] **Step 3: Implementieren**

`apps/api/src/health/health.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';

export class HealthStatusDto {
  @ApiProperty({ example: 'ok' })
  status!: string;
}
```

`apps/api/src/health/lifecycle.service.ts`:
```ts
import {
  type BeforeApplicationShutdown,
  Injectable,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env';

/**
 * Nest calls onModuleDestroy first, then beforeApplicationShutdown, then closes the HTTP server.
 * Readiness turns red immediately; the pause gives the proxy time to stop sending new requests.
 */
@Injectable()
export class LifecycleService implements OnModuleDestroy, BeforeApplicationShutdown {
  private shuttingDown = false;

  constructor(private readonly config: ConfigService<Env, true>) {}

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
  }

  async beforeApplicationShutdown(): Promise<void> {
    const drainMs = this.config.get('SHUTDOWN_DRAIN_MS', { infer: true });
    if (drainMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, drainMs);
      });
    }
  }
}
```

`apps/api/src/health/health.controller.ts`:
```ts
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';

import { HealthStatusDto } from './health.dto';
import { LifecycleService } from './lifecycle.service';

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
    private readonly lifecycle: LifecycleService
  ) {}

  @Get('live')
  @ApiOkResponse({ type: HealthStatusDto })
  live(): HealthStatusDto {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOkResponse({ type: HealthStatusDto })
  @ApiServiceUnavailableResponse({ description: 'Database unreachable or shutting down' })
  async ready(): Promise<HealthStatusDto> {
    if (this.lifecycle.isShuttingDown()) {
      throw new ServiceUnavailableException('Shutting down');
    }
    await this.health.check([() => this.database.pingCheck('database', { timeout: 1500 })]);
    return { status: 'ok' };
  }
}
```

`apps/api/src/health/health.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { LifecycleService } from './lifecycle.service';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [LifecycleService],
})
export class HealthModule {}
```
`apps/api/src/app.module.ts`: füge `HealthModule` zu `imports` hinzu. Prüfe gegen die aktuelle Terminus-Doku, dass `pingCheck(key, { timeout })` und das Verhalten "Indikator liefert `status: 'down'` -> `check` wirft `ServiceUnavailableException`" so gelten; sonst Stub und Aufruf anpassen, nicht das getestete Verhalten. Ein Terminus-Fehler hat eine eigene Antwortform; der `ProblemDetailsFilter` fängt ihn als `HttpException` ab und liefert Problem Details mit Status 503.

- [ ] **Step 4: Tests und Smoke gegen die echte Datenbank**

Run: `pnpm --filter @owui/api test`
Expected: PASS.

```bash
pnpm db:up && pnpm --filter @owui/api build
DATABASE_URL=postgresql://owui:owui-dev-password@127.0.0.1:5433/owui node apps/api/dist/main.js &
sleep 3 && curl -s localhost:3000/api/health/ready; echo; kill -TERM %1
```
Expected: `{"status":"ok"}`; beim `SIGTERM` fährt der Prozess nach der Drain-Zeit (5 s) sauber herunter.

- [ ] **Step 5: Prüfen und committen**

Run: `pnpm check`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): add liveness and readiness endpoints with graceful shutdown drain" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: SafeFetchService (SSRF-Schutz)

**Files:**
- Create: `apps/api/src/http/safe-fetch/{errors.ts,ip-policy.ts,safe-fetch.service.ts,safe-fetch.module.ts}`
- Test: `apps/api/src/http/safe-fetch/ip-policy.spec.ts`, `apps/api/src/http/safe-fetch/safe-fetch.service.spec.ts`

**Interfaces:**
- Produces:
  - `SAFE_FETCH_ERROR` (Wörterbuch der Codes: `INVALID_URL`, `BLOCKED_SCHEME`, `CREDENTIALS_IN_URL`, `BLOCKED_ADDRESS`, `DNS_FAILED`, `BAD_REDIRECT`, `TOO_MANY_REDIRECTS`, `CONTENT_TYPE_NOT_ALLOWED`, `RESPONSE_TOO_LARGE`, `TIMEOUT`, `UPSTREAM_ERROR`), `SafeFetchErrorCode`, `class SafeFetchError extends Error { readonly code: SafeFetchErrorCode }`.
  - `isPublicAddress(address: string): boolean`.
  - `SafeFetchOptions { maxRedirects; maxBytes; timeoutMs; allowedContentTypes: readonly string[]; isAllowedAddress(address: string): boolean; lookup(hostname: string): Promise<LookupAddress[]> }`, `SAFE_FETCH_DEFAULTS: SafeFetchOptions`, `SAFE_FETCH_OPTIONS` (Injection-Token).
  - `SafeFetchResponse { url: string; status: number; contentType: string; body: Buffer }`, `SafeFetchService.fetch(rawUrl: string): Promise<SafeFetchResponse>`, `SafeFetchModule` (exportiert den Service).
- Dies ist der **einzige** Ort, an dem die API fremde URLs abruft (AGENTS.md Regel 7, ESLint-Ausnahme für `apps/api/src/http/safe-fetch/**` aus Task 3). Im Teilprojekt 0 hat der Service noch keinen Aufrufer; er ist die geprüfte Grundlage für Teilprojekt 4 (URL-Import), 5 (Tools) und 7 (Websuche).

- [ ] **Step 1: Failing tests schreiben**

`apps/api/src/http/safe-fetch/ip-policy.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';

import { isPublicAddress } from './ip-policy';

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8',
    '93.184.216.34',
    '2606:4700:4700::1111',
    '2a00:1450:4001:81b::200e',
  ])('allows the public address %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback range', '127.255.255.254'],
    ['unspecified', '0.0.0.0'],
    ['private 10/8', '10.0.0.5'],
    ['private 172.16/12', '172.16.0.1'],
    ['private 192.168/16', '192.168.1.1'],
    ['cloud metadata (link-local)', '169.254.169.254'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['multicast', '224.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['documentation range', '203.0.113.7'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 unique local', 'fc00::1'],
    ['IPv6 documentation', '2001:db8::1'],
    ['IPv4-mapped loopback (dotted)', '::ffff:127.0.0.1'],
    ['IPv4-mapped loopback (hex)', '::ffff:7f00:1'],
    ['IPv4-mapped private', '::ffff:10.0.0.5'],
    ['NAT64 with loopback', '64:ff9b::7f00:1'],
    ['6to4', '2002:7f00:1::1'],
    ['not an address', 'example.com'],
    ['empty', ''],
  ])('blocks %s (%s)', (_name, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
```

`apps/api/src/http/safe-fetch/safe-fetch.service.spec.ts`:
```ts
import type { LookupAddress } from 'node:dns';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SAFE_FETCH_ERROR, SafeFetchError, type SafeFetchErrorCode } from './errors';
import {
  SAFE_FETCH_DEFAULTS,
  SafeFetchService,
  type SafeFetchOptions,
} from './safe-fetch.service';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Server[] = [];

async function serve(handler: Handler): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** Test servers listen on loopback, so the tests allow exactly that address. */
function loopbackService(overrides: Partial<SafeFetchOptions> = {}): SafeFetchService {
  return new SafeFetchService({
    ...SAFE_FETCH_DEFAULTS,
    isAllowedAddress: (address) => address === '127.0.0.1',
    timeoutMs: 2000,
    ...overrides,
  });
}

function fakeLookup(table: Record<string, string[]>): SafeFetchOptions['lookup'] {
  return (hostname) =>
    Promise.resolve(
      (table[hostname] ?? []).map(
        (address): LookupAddress => ({ address, family: address.includes(':') ? 6 : 4 })
      )
    );
}

async function expectFailure(promise: Promise<unknown>, code: SafeFetchErrorCode): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(SafeFetchError);
  expect(error).toMatchObject({ code });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => {
            resolve();
          });
        })
    )
  );
});

describe('SafeFetchService: what may be requested', () => {
  it('returns status, final URL, content type and body of an allowed target', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('hello');
    });

    const result = await loopbackService().fetch(`${base}/page`);

    expect(result).toMatchObject({ status: 200, contentType: 'text/plain', url: `${base}/page` });
    expect(result.body.toString('utf8')).toBe('hello');
  });

  it.each(['ftp://example.com/file', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi'])(
    'rejects the scheme of %s',
    async (url) => {
      await expectFailure(loopbackService().fetch(url), SAFE_FETCH_ERROR.BLOCKED_SCHEME);
    }
  );

  it('rejects credentials inside the URL', async () => {
    await expectFailure(
      loopbackService().fetch('http://user:pw@example.com/'),
      SAFE_FETCH_ERROR.CREDENTIALS_IN_URL
    );
  });

  it.each(['', 'not a url', 'http://'])('rejects the malformed URL %j', async (url) => {
    await expectFailure(loopbackService().fetch(url), SAFE_FETCH_ERROR.INVALID_URL);
  });

  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://127.1/',
    'http://0/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://localhost/',
    'http://localhost./',
  ])('blocks %s with the default policy', async (url) => {
    await expectFailure(new SafeFetchService(SAFE_FETCH_DEFAULTS).fetch(url), SAFE_FETCH_ERROR.BLOCKED_ADDRESS);
  });

  it('blocks a hostname that resolves to a private address', async () => {
    const service = loopbackService({ lookup: fakeLookup({ 'internal.test': ['10.0.0.5'] }) });

    await expectFailure(service.fetch('http://internal.test/'), SAFE_FETCH_ERROR.BLOCKED_ADDRESS);
  });

  it('blocks a hostname when only one of several addresses is private', async () => {
    const service = loopbackService({
      lookup: fakeLookup({ 'mixed.test': ['127.0.0.1', '10.0.0.5'] }),
    });

    await expectFailure(service.fetch('http://mixed.test/'), SAFE_FETCH_ERROR.BLOCKED_ADDRESS);
  });

  it('reports a hostname that does not resolve', async () => {
    const service = loopbackService({ lookup: fakeLookup({}) });

    await expectFailure(service.fetch('http://nowhere.test/'), SAFE_FETCH_ERROR.DNS_FAILED);
  });

  it('connects to the validated address and resolves the name only once (no DNS rebinding)', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('pinned');
    });
    const { port } = new URL(base);
    const lookup = vi.fn(fakeLookup({ 'pinned.test': ['127.0.0.1'] }));

    // "pinned.test" does not exist in real DNS: the request can only succeed through the validated address.
    const result = await loopbackService({ lookup }).fetch(`http://pinned.test:${port}/`);

    expect(result.body.toString('utf8')).toBe('pinned');
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe('SafeFetchService: redirects', () => {
  const redirecting: Handler = (request, response) => {
    const target: Record<string, string> = {
      '/start': '/final',
      '/to-private': 'http://10.0.0.5/secret',
      '/to-file': 'file:///etc/passwd',
      '/loop': '/loop',
    };
    const location = target[request.url ?? ''];
    if (location !== undefined) {
      response.writeHead(302, { location });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('done');
  };

  it('follows a relative redirect and reports the final URL', async () => {
    const base = await serve(redirecting);

    const result = await loopbackService().fetch(`${base}/start`);

    expect(result.url).toBe(`${base}/final`);
    expect(result.body.toString('utf8')).toBe('done');
  });

  it('validates the redirect target again: a private address is blocked', async () => {
    const base = await serve(redirecting);

    await expectFailure(
      loopbackService().fetch(`${base}/to-private`),
      SAFE_FETCH_ERROR.BLOCKED_ADDRESS
    );
  });

  it('validates the redirect target again: a different scheme is blocked', async () => {
    const base = await serve(redirecting);

    await expectFailure(loopbackService().fetch(`${base}/to-file`), SAFE_FETCH_ERROR.BLOCKED_SCHEME);
  });

  it('stops a redirect loop after the configured number of hops', async () => {
    const base = await serve(redirecting);

    await expectFailure(
      loopbackService({ maxRedirects: 3 }).fetch(`${base}/loop`),
      SAFE_FETCH_ERROR.TOO_MANY_REDIRECTS
    );
  });
});

describe('SafeFetchService: response limits', () => {
  it('sends accept-encoding identity so no compressed bomb is delivered', async () => {
    const base = await serve((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(String(request.headers['accept-encoding']));
    });

    const result = await loopbackService().fetch(base);

    expect(result.body.toString('utf8')).toBe('identity');
  });

  it('rejects a content type outside the allowlist', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end('binary');
    });

    await expectFailure(loopbackService().fetch(base), SAFE_FETCH_ERROR.CONTENT_TYPE_NOT_ALLOWED);
  });

  it('accepts an allowed content type with parameters and different case', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'Text/HTML; charset=UTF-8' });
      response.end('<p>ok</p>');
    });

    const result = await loopbackService().fetch(base);

    expect(result.contentType).toBe('text/html');
  });

  it('rejects a declared size above the limit without reading the body', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '1000000' });
      response.flushHeaders();
    });

    await expectFailure(
      loopbackService({ maxBytes: 1000 }).fetch(base),
      SAFE_FETCH_ERROR.RESPONSE_TOO_LARGE
    );
  });

  it('aborts a streamed body that grows past the limit without declaring a size', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('x'.repeat(600));
      response.write('x'.repeat(600));
      response.end();
    });

    await expectFailure(
      loopbackService({ maxBytes: 1000 }).fetch(base),
      SAFE_FETCH_ERROR.RESPONSE_TOO_LARGE
    );
  });

  it('gives up on a server that never answers', async () => {
    const base = await serve(() => {
      // never responds
    });

    await expectFailure(loopbackService({ timeoutMs: 300 }).fetch(base), SAFE_FETCH_ERROR.TIMEOUT);
  });

  it('gives up on a server that stops in the middle of the body', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('partial');
    });

    await expectFailure(loopbackService({ timeoutMs: 300 }).fetch(base), SAFE_FETCH_ERROR.TIMEOUT);
  });
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `pnpm --filter @owui/api test safe-fetch`
Expected: FAIL (Module `./ip-policy`, `./errors`, `./safe-fetch.service` fehlen).

- [ ] **Step 3: Implementieren**

`apps/api/src/http/safe-fetch/errors.ts`:
```ts
export const SAFE_FETCH_ERROR = {
  INVALID_URL: 'INVALID_URL',
  BLOCKED_SCHEME: 'BLOCKED_SCHEME',
  CREDENTIALS_IN_URL: 'CREDENTIALS_IN_URL',
  BLOCKED_ADDRESS: 'BLOCKED_ADDRESS',
  DNS_FAILED: 'DNS_FAILED',
  BAD_REDIRECT: 'BAD_REDIRECT',
  TOO_MANY_REDIRECTS: 'TOO_MANY_REDIRECTS',
  CONTENT_TYPE_NOT_ALLOWED: 'CONTENT_TYPE_NOT_ALLOWED',
  RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE',
  TIMEOUT: 'TIMEOUT',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
} as const;

export type SafeFetchErrorCode = (typeof SAFE_FETCH_ERROR)[keyof typeof SAFE_FETCH_ERROR];

/** The message never contains the full URL (query strings can carry tokens). */
export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}
```

`apps/api/src/http/safe-fetch/ip-policy.ts`:
```ts
import ipaddr from 'ipaddr.js';

/**
 * Allow-list by construction: only globally routable unicast addresses pass. Loopback, private,
 * link-local (cloud metadata), carrier-grade NAT, multicast, documentation, 6to4/NAT64/Teredo and
 * every other special range are reported by ipaddr.js under a name other than "unicast".
 * IPv4-mapped IPv6 addresses (::ffff:127.0.0.1) are judged by the IPv4 address inside.
 */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  const effective =
    parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      ? (parsed as ipaddr.IPv6).toIPv4Address()
      : parsed;
  return effective.range() === 'unicast';
}
```
Prüfe gegen die ipaddr.js-2.x-Doku, dass `range()` die oben getesteten Bereiche nicht als `unicast` meldet (insbesondere `2002::/16`, `64:ff9b::/96`, `203.0.113.0/24`, `100.64.0.0/10`). Meldet die installierte Version einen Bereich als `unicast`, ergänze für genau diesen Bereich eine explizite Sperre (`ipaddr.subnetMatch` mit einer eigenen Liste), statt den Test zu lockern.

`apps/api/src/http/safe-fetch/safe-fetch.service.ts`:
```ts
import { Inject, Injectable } from '@nestjs/common';
import { promises as dns, type LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent, request } from 'undici';

import { SAFE_FETCH_ERROR, SafeFetchError } from './errors';
import { isPublicAddress } from './ip-policy';

export const SAFE_FETCH_OPTIONS = Symbol('SAFE_FETCH_OPTIONS');

export interface SafeFetchOptions {
  maxRedirects: number;
  maxBytes: number;
  /** Total budget for the whole call including redirects. */
  timeoutMs: number;
  allowedContentTypes: readonly string[];
  isAllowedAddress: (address: string) => boolean;
  lookup: (hostname: string) => Promise<LookupAddress[]>;
}

export const SAFE_FETCH_DEFAULTS: SafeFetchOptions = {
  maxRedirects: 3,
  maxBytes: 5 * 1024 * 1024,
  timeoutMs: 10_000,
  allowedContentTypes: ['text/html', 'text/plain', 'application/json'],
  isAllowedAddress: isPublicAddress,
  lookup: (hostname) => dns.lookup(hostname, { all: true, verbatim: true }),
};

export interface SafeFetchResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

type Hop =
  | { kind: 'redirect'; location: string }
  | { kind: 'done'; response: Omit<SafeFetchResponse, 'url'> };

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = 'open-webui-klon-fetch/1.0';

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError(SAFE_FETCH_ERROR.INVALID_URL, 'Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError(SAFE_FETCH_ERROR.BLOCKED_SCHEME, `Scheme ${url.protocol} is not allowed`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeFetchError(SAFE_FETCH_ERROR.CREDENTIALS_IN_URL, 'Credentials in URLs are not allowed');
  }
  return url;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

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

function toSafeFetchError(error: unknown): SafeFetchError {
  if (error instanceof SafeFetchError) return error;
  const name = error instanceof Error ? error.name : '';
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  const timedOut =
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_ABORTED'].includes(
      code
    );
  return timedOut
    ? new SafeFetchError(SAFE_FETCH_ERROR.TIMEOUT, 'Request timed out')
    : new SafeFetchError(SAFE_FETCH_ERROR.UPSTREAM_ERROR, 'Request failed');
}

/**
 * The only way the API fetches URLs it did not choose itself (URL import, tools, web search).
 * Per hop: scheme check, own DNS resolution, every resolved address must pass the policy, then the
 * connection is pinned to that validated address. Redirects are followed manually and validated again.
 */
@Injectable()
export class SafeFetchService {
  constructor(@Inject(SAFE_FETCH_OPTIONS) private readonly options: SafeFetchOptions) {}

  async fetch(rawUrl: string): Promise<SafeFetchResponse> {
    const signal = AbortSignal.timeout(this.options.timeoutMs);
    try {
      let target = parseHttpUrl(rawUrl);
      for (let redirects = 0; ; redirects += 1) {
        const pinned = await this.resolveAllowed(target);
        const hop = await this.requestOnce(target, pinned, signal);
        if (hop.kind === 'done') return { url: target.toString(), ...hop.response };
        if (redirects >= this.options.maxRedirects) {
          throw new SafeFetchError(SAFE_FETCH_ERROR.TOO_MANY_REDIRECTS, 'Too many redirects');
        }
        target = this.nextTarget(target, hop.location);
      }
    } catch (error) {
      throw toSafeFetchError(error);
    }
  }

  private nextTarget(current: URL, location: string): URL {
    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new SafeFetchError(SAFE_FETCH_ERROR.BAD_REDIRECT, 'Invalid redirect target');
    }
    return parseHttpUrl(next);
  }

  private async resolveAllowed(target: URL): Promise<PinnedAddress> {
    // WHATWG URL already turned 2130706433, 0x7f.1, 127.1 and [::ffff:127.0.0.1] into canonical IP literals.
    const host = target.hostname.replace(/^\[|\]$/g, '');
    let addresses: LookupAddress[];
    if (ipaddr.isValid(host)) {
      addresses = [{ address: host, family: host.includes(':') ? 6 : 4 }];
    } else {
      try {
        addresses = await this.options.lookup(host);
      } catch {
        throw new SafeFetchError(SAFE_FETCH_ERROR.DNS_FAILED, `Cannot resolve ${host}`);
      }
    }
    const first = addresses[0];
    if (first === undefined) {
      throw new SafeFetchError(SAFE_FETCH_ERROR.DNS_FAILED, `Cannot resolve ${host}`);
    }
    // Every address must pass: the resolver may return a public and a private one.
    if (!addresses.every(({ address }) => this.options.isAllowedAddress(address))) {
      throw new SafeFetchError(SAFE_FETCH_ERROR.BLOCKED_ADDRESS, `Address of ${host} is not allowed`);
    }
    return { address: first.address, family: first.family === 6 ? 6 : 4 };
  }

  private async requestOnce(target: URL, pinned: PinnedAddress, signal: AbortSignal): Promise<Hop> {
    const { timeoutMs, maxBytes, allowedContentTypes } = this.options;
    const agent = new Agent({ connect: { lookup: pinnedLookup(pinned) } });
    try {
      const response = await request(target, {
        dispatcher: agent,
        method: 'GET',
        signal,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
        headers: { 'accept-encoding': 'identity', 'user-agent': USER_AGENT },
      });

      const location = firstHeader(response.headers.location);
      if (REDIRECT_STATUS.has(response.statusCode) && location !== undefined) {
        response.body.destroy();
        return { kind: 'redirect', location };
      }

      const contentType = (firstHeader(response.headers['content-type']) ?? '')
        .split(';')[0]
        ?.trim()
        .toLowerCase() ?? '';
      if (!allowedContentTypes.includes(contentType)) {
        throw new SafeFetchError(
          SAFE_FETCH_ERROR.CONTENT_TYPE_NOT_ALLOWED,
          `Content type ${contentType || '(none)'} is not allowed`
        );
      }
      const declared = Number(firstHeader(response.headers['content-length']));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new SafeFetchError(SAFE_FETCH_ERROR.RESPONSE_TOO_LARGE, 'Response is too large');
      }

      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          throw new SafeFetchError(SAFE_FETCH_ERROR.RESPONSE_TOO_LARGE, 'Response is too large');
        }
        chunks.push(Buffer.from(chunk));
      }
      return {
        kind: 'done',
        response: { status: response.statusCode, contentType, body: Buffer.concat(chunks) },
      };
    } finally {
      await agent.destroy();
    }
  }
}
```
Prüfe gegen die undici-8-Doku: `request(url, { dispatcher, signal, headersTimeout, bodyTimeout })`, `new Agent({ connect: { lookup } })` und dass `connect.lookup` an `net.connect`/`tls.connect` durchgereicht wird (`servername` für SNI bleibt der Hostname). Weicht ein Optionsname ab, folge der Doku; das Verhalten (Verbindung nur zur geprüften Adresse, Weiterleitungen manuell, Gesamt-Timeout, Größenlimit) bleibt der Vertrag. Der Test "connects to the validated address" scheitert, wenn die Verbindung die Adresse erneut auflöst.

`apps/api/src/http/safe-fetch/safe-fetch.module.ts`:
```ts
import { Module } from '@nestjs/common';

import { SAFE_FETCH_DEFAULTS, SAFE_FETCH_OPTIONS, SafeFetchService } from './safe-fetch.service';

@Module({
  providers: [{ provide: SAFE_FETCH_OPTIONS, useValue: SAFE_FETCH_DEFAULTS }, SafeFetchService],
  exports: [SafeFetchService],
})
export class SafeFetchModule {}
```

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @owui/api test safe-fetch`
Expected: PASS. Typische Abweichungen:
- Ein "Hängt"-Test dauert länger als 5 s oder bricht mit `UPSTREAM_ERROR` statt `TIMEOUT`: gib den Namen/Code des tatsächlich geworfenen Fehlers kurz aus und ergänze ihn in `toSafeFetchError` (nicht den Test ändern).
- `http://localhost./` wird durch den Resolver nicht aufgelöst (`DNS_FAILED` statt `BLOCKED_ADDRESS`): entferne den abschließenden Punkt vor der Auflösung (`host.replace(/\.$/, '')`), denn der Vertrag ist "blockiert".

- [ ] **Step 5: Mutationsprüfung der Sicherheitsentscheidungen (von Hand)**

Ändere nacheinander (und stelle danach wieder her): `every` → `some` in `resolveAllowed`; `redirects >= max` → `redirects > max + 5`; entferne in `pinnedLookup` die Adresse (leite an `dns.lookup` weiter). Jeder dieser Eingriffe muss mindestens einen Test rot färben. Bleibt einer grün, fehlt ein Test; ergänze ihn.

- [ ] **Step 6: Prüfen und committen**

Run: `pnpm check && pnpm test`
Expected: PASS (ESLint erlaubt `undici`/`node:http` hier wegen der Ausnahme aus Task 3).

```bash
git add -A
git commit -m "feat(api): add SafeFetchService with SSRF protection and pinned connections" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: OpenTelemetry

**Files:**
- Create: `apps/api/src/telemetry.ts`, `apps/api/src/instrumentation.ts`
- Test: `apps/api/src/telemetry.spec.ts`
- Modify: `docs/BACKLOG.md`

**Interfaces:**
- Consumes: `loadEnv().OTEL_EXPORTER_OTLP_ENDPOINT` (leer = ausgeschaltet).
- Produces: `createTelemetrySdk(endpoint: string | undefined): NodeSDK | undefined` (`undefined`, wenn kein Endpoint gesetzt ist). `instrumentation.ts` startet das SDK, **bevor** `main.js` geladen wird (Skript `start` in `apps/api/package.json`: `node --require ./dist/instrumentation.js dist/main.js`, steht schon in Task 4). Traces enthalten HTTP-, Express-, Postgres-Spans; die HTTP-Instrumentierung liefert Anfragezahl, Fehler und Dauer (RED) als Metriken; pino-Logzeilen bekommen `trace_id`/`span_id`.

- [ ] **Step 1: Failing test schreiben**

`apps/api/src/telemetry.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';

import { createTelemetrySdk } from './telemetry';

describe('createTelemetrySdk', () => {
  it('is switched off when no endpoint is configured', () => {
    expect(createTelemetrySdk(undefined)).toBeUndefined();
  });

  it('builds an SDK when an endpoint is configured', () => {
    expect(createTelemetrySdk('http://localhost:4318')).toBeDefined();
  });
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `pnpm --filter @owui/api test telemetry`
Expected: FAIL (`./telemetry` fehlt).

- [ ] **Step 3: Abhängigkeiten installieren und implementieren**

```bash
pnpm --filter @owui/api add @opentelemetry/sdk-node @opentelemetry/sdk-metrics @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/instrumentation-http @opentelemetry/instrumentation-express @opentelemetry/instrumentation-pg @opentelemetry/instrumentation-pino
```
Prüfe mit `pnpm --filter @owui/api list --depth 0`, dass alle Pakete in zueinander passenden Versionen installiert sind (SDK 2.x/Instrumentierungen 0.2xx/0.3xx; Versionen nicht mischen, sonst folgt den Peer-Warnungen von pnpm).

`apps/api/src/telemetry.ts`:
```ts
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export const SERVICE_NAME = 'owui-api';

/** Returns undefined when no OTLP endpoint is configured: telemetry is then completely off. */
export function createTelemetrySdk(endpoint: string | undefined): NodeSDK | undefined {
  if (endpoint === undefined) return undefined;
  const base = endpoint.replace(/\/$/, '');
  return new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    // The HTTP instrumentation records request count, errors and duration (RED) as metrics.
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [
      new HttpInstrumentation({
        // Health probes would fill every trace backend with noise.
        ignoreIncomingRequestHook: (request) => request.url?.startsWith('/api/health/') ?? false,
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation(),
      new PinoInstrumentation(),
    ],
  });
}
```

`apps/api/src/instrumentation.ts`:
```ts
import { loadEnv } from './config/env';
import { createTelemetrySdk } from './telemetry';

// Loaded with `node --require` before main.js so the libraries are patched before first use.
const sdk = createTelemetrySdk(loadEnv().OTEL_EXPORTER_OTLP_ENDPOINT);
if (sdk !== undefined) {
  sdk.start();
  process.once('SIGTERM', () => {
    void sdk.shutdown();
  });
}
```
Ist das Projekt ESM (Task 4, Step 1), lade stattdessen mit `node --import ./dist/instrumentation.js dist/main.js`, und passe das Skript `start` an. Prüfe Namen und Optionen (`resourceFromAttributes`, `ignoreIncomingRequestHook`, `ATTR_SERVICE_NAME`) gegen die installierten Versionen.

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @owui/api test telemetry`
Expected: PASS.

- [ ] **Step 5: Manuelle Prüfung gegen einen echten Kollektor (nur Verhalten, keine Dauerinfrastruktur)**

```bash
docker run -d --rm --name otel-probe -p 3001:3000 -p 4318:4318 grafana/otel-lgtm
pnpm db:up && pnpm --filter @owui/api build
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 DATABASE_URL=postgresql://owui:owui-dev-password@127.0.0.1:5433/owui \
  node --require ./apps/api/dist/instrumentation.js apps/api/dist/main.js &
sleep 3 && curl -s localhost:3000/api/nope >/dev/null; curl -s localhost:3000/api/health/ready >/dev/null
```
Öffne `http://localhost:3001` (Grafana, Explore, Datenquelle Tempo, Suche nach `service.name = owui-api`). Erwartet: ein Trace für `/api/nope`, **kein** Trace für `/api/health/ready`. Räume auf: `kill %1; docker stop otel-probe`. Gelingt der Trace nicht, prüfe zuerst die Ladereihenfolge (`--require` vor `main.js`) und `OTEL_LOG_LEVEL=debug`.

- [ ] **Step 6: BACKLOG ergänzen und committen**

Füge in `docs/BACKLOG.md` unter "Offen" hinzu: "Logs per OTLP exportieren (im Fundament: Traces und Metriken; Logzeilen tragen `trace_id`); Telemetrie im Dev-Modus (`nest start --watch` lädt die Instrumentierung nicht)".

Run: `pnpm check && pnpm test`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): add opt-in OpenTelemetry tracing" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: OpenAPI-Dokument erzeugen

**Files:**
- Create: `apps/api/src/openapi/{build-document.ts,generate.ts}`, `apps/api/openapi.json` (erzeugt)
- Test: `apps/api/src/openapi/build-document.spec.ts`

**Interfaces:**
- Consumes: `createTestApp`, `HealthModule`, `AppModule`, `API_PREFIX`.
- Produces: `buildOpenApiDocument(app: INestApplication): OpenAPIObject` (Operations-IDs `<controller ohne "Controller", erste Stelle klein><Methode mit großem Anfang>`, z. B. `healthLive`); Skript `pnpm --filter @owui/api openapi` schreibt `apps/api/openapi.json` (stabil formatiert, ohne laufende Datenbank). Es gibt **keine** Swagger-UI (kleinere Angriffsfläche); das Dokument ist nur die Quelle für Orval.

- [ ] **Step 1: Failing test schreiben**

`apps/api/src/openapi/build-document.spec.ts`:
```ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { TypeOrmHealthIndicator } from '@nestjs/terminus';
import { afterEach, describe, expect, it } from 'vitest';

import { HealthModule } from '../health/health.module';
import { createTestApp } from '../testing/create-test-app';
import { buildOpenApiDocument } from './build-document';

describe('buildOpenApiDocument', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  it('describes the health endpoints with stable operation ids', async () => {
    app = await createTestApp({
      imports: [HealthModule],
      configure: (builder) =>
        builder.overrideProvider(TypeOrmHealthIndicator).useValue({ pingCheck: () => ({}) }),
    });

    const document = buildOpenApiDocument(app);

    expect(document.paths['/api/health/live']?.get?.operationId).toBe('healthLive');
    expect(document.paths['/api/health/ready']?.get?.operationId).toBe('healthReady');
    expect(document.paths['/api/health/ready']?.get?.responses).toHaveProperty('503');
    expect(document.components?.schemas).toHaveProperty('HealthStatusDto');
  });
});
```

- [ ] **Step 2: Fehlschlag prüfen**

Run: `pnpm --filter @owui/api test openapi`
Expected: FAIL (`./build-document` fehlt).

- [ ] **Step 3: Implementieren**

`apps/api/src/openapi/build-document.ts`:
```ts
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function upperFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Orval derives hook and function names from the operation id: keep it short and stable. */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Open WebUI Klon API')
    .setVersion('0.0.0')
    .build();
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) =>
      `${lowerFirst(controllerKey.replace(/Controller$/, ''))}${upperFirst(methodKey)}`,
  });
}
```

`apps/api/src/openapi/generate.ts`:
```ts
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { API_PREFIX } from '../app.factory';
import { AppModule } from '../app.module';
import { buildOpenApiDocument } from './build-document';

const OUTPUT = resolve(__dirname, '../../openapi.json');

async function generate(): Promise<void> {
  // preview: the module graph is scanned but no provider is created, so no database connection opens.
  const app = await NestFactory.create(AppModule, {
    preview: true,
    abortOnError: false,
    logger: false,
  });
  app.setGlobalPrefix(API_PREFIX);
  const document = buildOpenApiDocument(app);
  writeFileSync(OUTPUT, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

generate().catch((error: unknown) => {
  process.stderr.write(
    `openapi generation failed: ${error instanceof Error ? error.message : 'unknown'}\n`
  );
  process.exit(1);
});
```
Funktioniert `preview: true` mit der installierten Nest-Version nicht (Controller fehlen im Dokument oder die Konfiguration wird doch ausgewertet), nutze den Rückfall: `pnpm db:up`, `NestFactory.create(AppModule, { logger: false })` ohne `preview`, `await app.init()`, Dokument bauen, `app.close()`, und das Skript `openapi` in `apps/api/package.json` zeigt dann auf `DATABASE_URL=postgresql://owui:owui-dev-password@127.0.0.1:5433/owui`. Vermerke die Wahl in ADR 0001. `__dirname` setzt CommonJS voraus; bei ESM nimm `import.meta.dirname`.

- [ ] **Step 4: Tests ausführen und Dokument erzeugen**

Run: `pnpm --filter @owui/api test openapi`
Expected: PASS.

Run: `pnpm --filter @owui/api build && pnpm --filter @owui/api openapi && git diff --stat -- apps/api/openapi.json`
Expected: `apps/api/openapi.json` existiert und enthält `healthLive`, `healthReady`, das Schema `HealthStatusDto`; ein zweiter Lauf ändert die Datei nicht (`git diff` leer, nachdem sie einmal hinzugefügt wurde).

- [ ] **Step 5: Prüfen und committen**

Run: `pnpm check && pnpm test`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): generate openapi.json from the controllers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Web-Gerüst (Vite, Tailwind, shadcn/ui, i18n, Vitest)

**Files:**
- Create: `apps/web/package.json`, `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/main.tsx` (Platzhalter, Task 13 ersetzt ihn), `apps/web/src/i18n/{index.ts,locales/de.json,locales/en.json}`, `apps/web/src/test/setup.ts`
- Create (von `shadcn` erzeugt): `apps/web/components.json`, `apps/web/src/index.css`, `apps/web/src/lib/utils.ts`, `apps/web/src/components/ui/**`
- Modify: `eslint.config.mjs`, `.prettierignore`
- Test: `apps/web/src/i18n/locales.spec.ts`

**Interfaces:**
- Produces: Alias `@/` -> `apps/web/src/`; `i18n` (Standardsprache `de`, Fallback `de`), Dictionary `LANGUAGE`; Übersetzungsschlüssel (siehe Step 4); shadcn-Komponenten `button`, `sidebar` (mit `sheet`, `tooltip`, `input`, `separator`, `skeleton`), `alert`; Test-Setup mit `matchMedia`-Stub, jest-dom und automatischem `cleanup`; Dev-Server auf Port 5173 mit Proxy `/api` -> `http://localhost:3000` (gleiche Origin wie in Docker, kein CORS im Alltag nötig).

- [ ] **Step 1: Aktuelle Anleitungen lesen**

Lies https://ui.shadcn.com/docs/installation/vite und `pnpm dlx shadcn@4.21.4 --help` (die CLI wird auf diese Version gepinnt, weil sie Code in dein Repo schreibt). Prüfe, ob die Vite-Anleitung für Vite 8 und Tailwind 4 andere Schritte nennt als dieser Plan (zum Beispiel zusätzliche Pfad-Aliase), und folge im Zweifel der Anleitung. Die Ziele bleiben: Alias `@`, Tailwind über `@tailwindcss/vite`, Komponenten unter `src/components/ui`.

- [ ] **Step 2: Paket anlegen**

`apps/web/package.json`:
```json
{
  "name": "@owui/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "api:generate": "orval"
  }
}
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Open-WebUI-Klon</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
(Kein Inline-Skript: die CSP in Task 14 erlaubt Skripte nur von der eigenen Origin.)

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "paths": { "@/*": ["./src/*"] },
    "noEmit": true,
    "allowImportingTsExtensions": true
  },
  "include": ["src", "vite.config.ts", "orval.config.ts"]
}
```
(Prüfe `paths` ohne `baseUrl` gegen TypeScript 6; setzt die CLI oder TypeScript `baseUrl` voraus, folge der Fehlermeldung.)

`apps/web/vite.config.ts`:
```ts
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // Same origin as in Docker (Caddy): the browser talks to one host, CORS is not involved.
    proxy: { '/api': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    css: false,
  },
});
```

- [ ] **Step 3: Abhängigkeiten installieren**

```bash
pnpm --filter @owui/web add react react-dom react-router @tanstack/react-query i18next react-i18next lucide-react
pnpm --filter @owui/web add -D vite @vitejs/plugin-react tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @types/react @types/react-dom orval typescript@~6.0
pnpm add -D -w eslint-plugin-react-hooks eslint-plugin-jsx-a11y
```
`class-variance-authority`, `clsx`, `tailwind-merge` und die Radix-Pakete installiert die shadcn-CLI selbst; prüfe danach in `apps/web/package.json`, dass sie unter `dependencies` stehen.

- [ ] **Step 4: Failing test für die Sprachdateien schreiben**

`apps/web/src/i18n/locales.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';

import de from './locales/de.json';
import en from './locales/en.json';

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix === '' ? key : `${prefix}.${key}`)
  );
}

function texts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(texts);
}

describe('locales', () => {
  it('define the same keys in German and English', () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(de).sort());
  });

  it('contain no empty texts', () => {
    for (const text of [...texts(de), ...texts(en)]) {
      expect(text.trim()).not.toBe('');
    }
  });
});
```
Run: `pnpm --filter @owui/web test`
Expected: FAIL (die JSON-Dateien fehlen; außerdem fehlt `src/test/setup.ts`, siehe unten: lege zuerst beides an, dann ist der Fehlschlag der "Cannot find module"-Fehler).

- [ ] **Step 5: Sprachdateien, i18n und Test-Setup anlegen**

`apps/web/src/i18n/locales/de.json`:
```json
{
  "app": { "name": "Open-WebUI-Klon", "skipToContent": "Zum Inhalt springen" },
  "nav": { "home": "Start", "toggle": "Seitenleiste ein- oder ausblenden" },
  "theme": {
    "toggle": "Darstellung wechseln (aktuell: {{current}})",
    "light": "Hell",
    "dark": "Dunkel",
    "system": "Wie das Gerät"
  },
  "status": {
    "title": "Verbindung zum Server",
    "checking": "Die Verbindung wird geprüft …",
    "ok": "Der Server ist erreichbar.",
    "error": "Der Server antwortet gerade nicht.",
    "retry": "Erneut versuchen"
  },
  "home": {
    "title": "Willkommen",
    "intro": "Hier entsteht dein persönlicher Chat-Assistent."
  },
  "notFound": {
    "title": "Seite nicht gefunden",
    "body": "Diese Adresse gibt es nicht.",
    "back": "Zur Startseite"
  }
}
```

`apps/web/src/i18n/locales/en.json`:
```json
{
  "app": { "name": "Open WebUI Clone", "skipToContent": "Skip to content" },
  "nav": { "home": "Home", "toggle": "Show or hide the sidebar" },
  "theme": {
    "toggle": "Change appearance (current: {{current}})",
    "light": "Light",
    "dark": "Dark",
    "system": "Like the device"
  },
  "status": {
    "title": "Connection to the server",
    "checking": "Checking the connection …",
    "ok": "The server is reachable.",
    "error": "The server is not answering right now.",
    "retry": "Try again"
  },
  "home": {
    "title": "Welcome",
    "intro": "Your personal chat assistant will live here."
  },
  "notFound": {
    "title": "Page not found",
    "body": "This address does not exist.",
    "back": "Back to the start page"
  }
}
```

`apps/web/src/i18n/index.ts`:
```ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import de from './locales/de.json';
import en from './locales/en.json';

export const LANGUAGE = { GERMAN: 'de', ENGLISH: 'en' } as const;

void i18n.use(initReactI18next).init({
  resources: { de: { translation: de }, en: { translation: en } },
  lng: LANGUAGE.GERMAN,
  fallbackLng: LANGUAGE.GERMAN,
  // React escapes output itself.
  interpolation: { escapeValue: false },
});

export default i18n;
```

`apps/web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import '@/i18n';

// jsdom has no matchMedia; the theme provider and the sidebar need it.
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

afterEach(() => {
  cleanup();
});
```
(`window.matchMedia = vi.fn()...` kann in strengen TS-Einstellungen eine Typmeldung geben; dann `vi.stubGlobal('matchMedia', ...)` verwenden.)

`apps/web/src/main.tsx` (Platzhalter):
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import i18n from './i18n';
import './index.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Root element is missing');

createRoot(container).render(
  <StrictMode>
    <h1>{i18n.t('app.name')}</h1>
  </StrictMode>
);
```

- [ ] **Step 6: shadcn initialisieren und Komponenten hinzufügen**

```bash
cd apps/web
pnpm dlx shadcn@4.21.4 init
pnpm dlx shadcn@4.21.4 add button sidebar skeleton alert
cd ../..
```
Wahl bei `init`: Basisfarbe `neutral`, CSS-Variablen ja, Alias `@/components`, `@/lib/utils`, `@/components/ui`, `@/hooks`. Prüfe, dass `src/index.css` mit `@import "tailwindcss"` beginnt und die Farb-Tokens (Light und `.dark`) enthält. Erzeugt die CLI Dateien außerhalb von `src/components/ui` (zum Beispiel `src/hooks/use-mobile.ts`), nimm sie in dieselben Ignore-Listen auf wie `components/ui`: `eslint.config.mjs` (`ignores`) und `.prettierignore`. Von der CLI erzeugter Code wird nicht von Hand gepflegt, sondern bei Bedarf neu erzeugt.

- [ ] **Step 7: ESLint für das Frontend ergänzen**

In `eslint.config.mjs` die Imports `import reactHooks from 'eslint-plugin-react-hooks';` und `import jsxA11y from 'eslint-plugin-jsx-a11y';` ergänzen und vor `prettier` einfügen:
```js
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, jsxA11y.flatConfigs.recommended],
    languageOptions: { globals: globals.browser },
  },
```
Prüfe die Namen (`configs.flat.recommended`, `flatConfigs.recommended`) in der Doku der installierten Plugin-Versionen und passe sie an.

- [ ] **Step 8: Tests und Prüfung**

Run: `pnpm --filter @owui/web test && pnpm --filter @owui/web build && pnpm check`
Expected: PASS (2 Tests; der Build erzeugt `apps/web/dist`). `pnpm --filter @owui/web dev` zeigt im Browser unter http://localhost:5173 die Überschrift.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(web): add Vite, Tailwind, shadcn/ui and i18n scaffold" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Frontend-Grundlage (Layout, Theme, API-Client, Statusanzeige)

**Files:**
- Create: `apps/web/orval.config.ts`, `apps/web/src/api/{trace.ts,fetcher.ts,generated/**}`, `apps/web/src/components/theme/{theme-provider.tsx,theme-toggle.tsx}`, `apps/web/src/components/layout/app-layout.tsx`, `apps/web/src/features/health/{use-api-health.ts,api-status.tsx}`, `apps/web/src/pages/{home-page.tsx,not-found-page.tsx}`, `apps/web/src/app/{providers.tsx,router.tsx}`, `apps/web/src/test/render-app.tsx`
- Modify: `apps/web/src/main.tsx`
- Test: `apps/web/src/api/{trace.spec.ts,fetcher.spec.ts}`, `apps/web/src/components/theme/theme.spec.tsx`, `apps/web/src/features/health/api-status.spec.tsx`, `apps/web/src/app/router.spec.tsx`

**Interfaces:**
- Consumes: `apps/api/openapi.json` (Task 11), shadcn-Komponenten und i18n-Schlüssel (Task 12).
- Produces:
  - `createTraceparent(): string` (W3C `00-<32 hex>-<16 hex>-01`).
  - `apiFetch<T>(url: string, options?: RequestInit): Promise<T>` (Orval-Mutator; sendet Cookies und `traceparent`; liefert `{ data, status, headers }`; wirft `ApiError` bei Status außerhalb 2xx), `class ApiError extends Error { status: number; requestId?: string; detail?: string }`.
  - Generierte Hooks `useHealthLive`, `useHealthReady` (Orval, `react-query` + `fetch`), `useApiHealth()` (Wrapper mit `retry: false`, Aktualisierung alle 30 s).
  - `THEME`, `Theme`, `THEME_STORAGE_KEY`, `ThemeProvider`, `useTheme()`, `ThemeToggle`; `AppLayout`; `routes: RouteObject[]`, `createAppRouter()`; `AppProviders({ children, queryClient? })`, `createQueryClient()`; Testhelfer `renderApp(path?: string)`.

- [ ] **Step 1: Failing tests für Trace-Header und Fetcher schreiben**

`apps/web/src/api/trace.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';

import { createTraceparent } from './trace';

describe('createTraceparent', () => {
  it('produces a valid W3C traceparent header value', () => {
    expect(createTraceparent()).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('produces a new value on every call', () => {
    expect(createTraceparent()).not.toBe(createTraceparent());
  });
});
```

`apps/web/src/api/fetcher.spec.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from './fetcher';

function stubFetch(status: number, body: string, contentType: string) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': contentType } }))
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('sends cookies and a traceparent header and returns data, status and headers', async () => {
    const fetchMock = stubFetch(200, '{"status":"ok"}', 'application/json');

    const result = await apiFetch<{ data: unknown; status: number; headers: Headers }>(
      '/api/health/live',
      { method: 'GET' }
    );

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(result).toMatchObject({ data: { status: 'ok' }, status: 200 });
  });

  it('turns a problem details response into an ApiError with the request id', async () => {
    stubFetch(
      503,
      '{"title":"Service Unavailable","detail":"Shutting down","requestId":"req-12345678"}',
      'application/problem+json'
    );

    await expect(apiFetch('/api/health/ready')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      detail: 'Shutting down',
      requestId: 'req-12345678',
    });
  });

  it('turns a non-JSON error page (for example from a proxy) into an ApiError', async () => {
    stubFetch(502, '<html>Bad Gateway</html>', 'text/html');

    await expect(apiFetch('/api/health/ready')).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
    });
  });
});
```
Run: `pnpm --filter @owui/web test api/`
Expected: FAIL (`./trace`, `./fetcher` fehlen).

- [ ] **Step 2: Trace und Fetcher implementieren**

`apps/web/src/api/trace.ts`:
```ts
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** W3C Trace Context: the API continues this trace, so a click can be followed into the backend. */
export function createTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}
```

`apps/web/src/api/fetcher.ts`:
```ts
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

/**
 * Orval mutator. The server answers errors as RFC 9457 problem details; anything else
 * (a proxy's HTML page) still becomes an ApiError with the status code.
 */
export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('traceparent', createTraceparent());

  const response = await fetch(url, { ...options, headers, credentials: 'include' });
  const text = await response.text();
  const body: unknown = text === '' ? undefined : parseJson(text);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      stringField(body, 'title') ?? `Request failed (${response.status})`,
      stringField(body, 'detail'),
      stringField(body, 'requestId')
    );
  }
  return { data: body, status: response.status, headers: response.headers } as T;
}
```

Run: `pnpm --filter @owui/web test api/`
Expected: PASS (5 Tests).

- [ ] **Step 3: Orval konfigurieren und den Client erzeugen**

`apps/web/orval.config.ts`:
```ts
import { defineConfig } from 'orval';

export default defineConfig({
  api: {
    input: '../api/openapi.json',
    output: {
      mode: 'single',
      target: 'src/api/generated/api.ts',
      schemas: 'src/api/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: { mutator: { path: 'src/api/fetcher.ts', name: 'apiFetch' } },
    },
  },
});
```
Prüfe die Optionsnamen gegen die Orval-8-Doku (https://orval.dev), insbesondere `client: 'react-query'` mit `httpClient: 'fetch'` und die Form des Mutators für den Fetch-Client (Signatur `(url, options) => Promise<T>`).

Run: `pnpm --filter @owui/web api:generate && pnpm --filter @owui/web typecheck`
Expected: `src/api/generated/api.ts` exportiert `useHealthLive` und `useHealthReady`, `src/api/generated/model/` enthält `HealthStatusDto`, und der Typecheck läuft. Heißen die Hooks anders, passe die Imports in Step 6 an (die Operations-IDs aus Task 11 bestimmen die Namen). Meldet der Typecheck, dass der Mutator nicht zur Signatur passt, richte `apiFetch` nach der Doku aus, **ohne** das Verhalten aus Step 1 zu ändern (die Tests sind der Vertrag).

- [ ] **Step 4: Failing test für den Theme-Umschalter schreiben (Review Focus 6)**

`apps/web/src/components/theme/theme.spec.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY, ThemeProvider } from './theme-provider';
import { ThemeToggle } from './theme-toggle';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
}

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('theme toggle', () => {
  it('cycles system, light, dark and sets the dark class only for dark', async () => {
    const user = userEvent.setup();
    renderToggle();
    const button = screen.getByRole('button', { name: /Darstellung wechseln/ });

    await user.click(button); // system -> light
    expect(document.documentElement).not.toHaveClass('dark');
    await user.click(button); // light -> dark
    expect(document.documentElement).toHaveClass('dark');
    await user.click(button); // dark -> system
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('remembers the choice and restores it on the next visit', async () => {
    const user = userEvent.setup();
    const first = renderToggle();
    const button = screen.getByRole('button', { name: /Darstellung wechseln/ });
    await user.click(button);
    await user.click(button); // dark
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    first.unmount();
    document.documentElement.classList.remove('dark');

    renderToggle();

    expect(document.documentElement).toHaveClass('dark');
  });

  it('keeps working when the browser blocks storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const user = userEvent.setup();
    renderToggle();
    const button = screen.getByRole('button', { name: /Darstellung wechseln/ });

    await user.click(button);
    await user.click(button);

    expect(document.documentElement).toHaveClass('dark');
  });
});
```
Run: `pnpm --filter @owui/web test theme`
Expected: FAIL (Module fehlen).

- [ ] **Step 5: Theme implementieren**

`apps/web/src/components/theme/theme-provider.tsx`:
```tsx
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export const THEME = { LIGHT: 'light', DARK: 'dark', SYSTEM: 'system' } as const;
export type Theme = (typeof THEME)[keyof typeof THEME];
export const THEME_STORAGE_KEY = 'owui-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function isTheme(value: unknown): value is Theme {
  return Object.values<unknown>(THEME).includes(value);
}

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : THEME.SYSTEM;
  } catch {
    // Storage can be blocked (private window, site data blocked): the default applies.
    return THEME.SYSTEM;
  }
}

function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The choice then only lasts for this visit.
  }
}

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const apply = () => {
      const dark = theme === THEME.DARK || (theme === THEME.SYSTEM && media.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next);
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === undefined) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
```

`apps/web/src/components/theme/theme-toggle.tsx`:
```tsx
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { THEME, type Theme, useTheme } from './theme-provider';

const NEXT: Record<Theme, Theme> = {
  [THEME.SYSTEM]: THEME.LIGHT,
  [THEME.LIGHT]: THEME.DARK,
  [THEME.DARK]: THEME.SYSTEM,
};

const ICON = { [THEME.SYSTEM]: Monitor, [THEME.LIGHT]: Sun, [THEME.DARK]: Moon };

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const Icon = ICON[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        setTheme(NEXT[theme]);
      }}
      aria-label={t('theme.toggle', { current: t(`theme.${theme}`) })}
    >
      <Icon aria-hidden />
    </Button>
  );
}
```
(React 19 erlaubt `<ThemeContext value=...>` ohne `.Provider`.)

Run: `pnpm --filter @owui/web test theme`
Expected: PASS (3 Tests).

- [ ] **Step 6: Failing tests für Statusanzeige und Routing schreiben**

`apps/web/src/test/render-app.tsx`:
```tsx
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { AppProviders, createQueryClient } from '@/app/providers';
import { routes } from '@/app/router';

export function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <AppProviders queryClient={createQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
```

`apps/web/src/features/health/api-status.spec.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiStatus } from './api-status';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderStatus() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiStatus />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiStatus', () => {
  it('shows a loading state first and then the success message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(200, { status: 'ok' }))));

    renderStatus();

    expect(screen.getByRole('status')).toHaveTextContent('Die Verbindung wird geprüft');
    expect(await screen.findByText('Der Server ist erreichbar.')).toBeInTheDocument();
  });

  it('shows an error with a retry button, disables it while retrying and recovers', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => Promise.resolve(json(503, { title: 'Service Unavailable' })))
      .mockImplementation(() => Promise.resolve(json(200, { status: 'ok' })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderStatus();

    expect(await screen.findByText('Der Server antwortet gerade nicht.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByText('Der Server ist erreichbar.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

`apps/web/src/app/router.spec.tsx`:
```tsx
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderApp } from '@/test/render-app';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubHealthy() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response('{"status":"ok"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
  );
}

describe('app routing and layout', () => {
  it('renders the home page inside a main landmark with navigation and theme toggle', async () => {
    stubHealthy();

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

  it('answers an unknown address with a friendly page and a way back', () => {
    stubHealthy();

    renderApp('/gibt-es-nicht');

    expect(screen.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Startseite' })).toHaveAttribute('href', '/');
  });
});
```
Run: `pnpm --filter @owui/web test`
Expected: FAIL (Module `api-status`, `providers`, `router` fehlen).

- [ ] **Step 7: Statusanzeige, Layout, Seiten, Router und Einstieg implementieren**

`apps/web/src/features/health/use-api-health.ts`:
```ts
import { useHealthReady } from '@/api/generated/api';

/** One place for the polling policy: no automatic retries (the retry button is the retry), refresh every 30 s. */
export function useApiHealth() {
  return useHealthReady({ query: { retry: false, refetchInterval: 30_000 } });
}
```

`apps/web/src/features/health/api-status.tsx`:
```tsx
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useApiHealth } from './use-api-health';

export function ApiStatus() {
  const { t } = useTranslation();
  const health = useApiHealth();

  if (health.isPending) {
    return (
      <div role="status">
        <Skeleton className="h-16 w-full" />
        <span className="sr-only">{t('status.checking')}</span>
      </div>
    );
  }

  if (health.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('status.title')}</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>{t('status.error')}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={health.isFetching}
            onClick={() => {
              void health.refetch();
            }}
          >
            {t('status.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert>
      <AlertTitle>{t('status.title')}</AlertTitle>
      <AlertDescription>{t('status.ok')}</AlertDescription>
    </Alert>
  );
}
```
(Es gibt hier bewusst keinen "leer"-Zustand: die Ansicht zeigt genau einen Wert und keine Liste. Das gehört in den DoD-Beleg in Task 16.)

`apps/web/src/pages/home-page.tsx`:
```tsx
import { useTranslation } from 'react-i18next';

import { ApiStatus } from '@/features/health/api-status';

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
      <p className="text-muted-foreground">{t('home.intro')}</p>
      <ApiStatus />
    </div>
  );
}
```

`apps/web/src/pages/not-found-page.tsx`:
```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
      <p className="text-muted-foreground">{t('notFound.body')}</p>
      <Link className="underline underline-offset-4" to="/">
        {t('notFound.back')}
      </Link>
    </div>
  );
}
```

`apps/web/src/components/layout/app-layout.tsx`:
```tsx
import { PanelLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';

import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from '@/components/ui/sidebar';

// The generated SidebarTrigger has an English hidden label; this one is translated.
function SidebarToggle() {
  const { t } = useTranslation();
  const { toggleSidebar } = useSidebar();
  return (
    <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label={t('nav.toggle')}>
      <PanelLeft aria-hidden />
    </Button>
  );
}

export function AppLayout() {
  const { t } = useTranslation();
  return (
    <SidebarProvider>
      <a
        href="#content"
        className="bg-background sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2"
      >
        {t('app.skipToContent')}
      </a>
      <Sidebar>
        <SidebarHeader>
          <span className="px-2 font-semibold">{t('app.name')}</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/" end>
                      {t('nav.home')}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      {/* SidebarInset renders the main landmark. */}
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarToggle />
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <div id="content" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
```
(`asChild` gilt für die Radix-Variante der generierten Komponenten; nutzt die erzeugte Sidebar eine andere Zusammensetzung, folge deren Signatur. Im Router-Test ist die Navigation ein `link` namens "Start".)

`apps/web/src/app/router.tsx`:
```tsx
import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppLayout } from '@/components/layout/app-layout';
import { HomePage } from '@/pages/home-page';
import { NotFoundPage } from '@/pages/not-found-page';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
```

`apps/web/src/app/providers.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ThemeProvider } from '@/components/theme/theme-provider';

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });
}

const appQueryClient = createQueryClient();

export function AppProviders({
  children,
  queryClient = appQueryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
```

`apps/web/src/main.tsx` ersetzen:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { AppProviders } from '@/app/providers';
import { createAppRouter } from '@/app/router';

import '@/i18n';
import './index.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Root element is missing');

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={createAppRouter()} />
    </AppProviders>
  </StrictMode>
);
```

Run: `pnpm --filter @owui/web test`
Expected: PASS (alle Web-Tests). Typische Abweichung: der Test "unbekannte Adresse" findet die Überschrift nicht, weil `path: '*'` unter dem Layout nicht greift. Dann den Fallback als eigene Route auf Wurzelebene mit `AppLayout` als Element führen; das Verhalten (freundliche Seite mit Link zurück) bleibt der Vertrag.

- [ ] **Step 8: Im Browser prüfen (AGENTS.md: UI-Änderungen werden im Browser angesehen)**

```bash
pnpm db:up && pnpm --filter @owui/api build
DATABASE_URL=postgresql://owui:owui-dev-password@127.0.0.1:5433/owui CORS_ORIGINS=http://localhost:5173 \
  node apps/api/dist/main.js &
pnpm --filter @owui/web dev &
```
Öffne http://localhost:5173 (chrome-devtools-MCP oder Playwright) und prüfe: (1) die Überschrift "Willkommen" und die grüne Statusmeldung erscheinen, (2) die Netzwerkanfrage `GET /api/health/ready` hat Status 200 und den Request-Header `traceparent`, (3) der Theme-Knopf wechselt Hell, Dunkel, Wie das Gerät, und die Seite bleibt in beiden Farbschemata lesbar (Screenshot), (4) in der Konsole gibt es keine Fehler, (5) bei Phonebreite (375 px) ist die Seitenleiste eingeklappt und per Knopf bedienbar, (6) Tab erreicht zuerst den Link "Zum Inhalt springen". Stoppe API und Dev-Server danach (`kill %1 %2`). Auffälligkeiten behebst du vor dem Commit (bei rein optischen Fehlern ohne neuen Test).

- [ ] **Step 9: Prüfen und committen**

Run: `pnpm check && pnpm test`
Expected: PASS.

```bash
git add -A
git commit -m "feat(web): add layout, theme toggle, typed API client and server status view" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Container, Compose und Smoke-Test

**Files:**
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/Caddyfile`, `.dockerignore`, `.env.example`, `scripts/smoke.mjs`, `docs/adr/0002-csp-style-src.md`
- Modify: `compose.yml` (ersetzt die Fassung aus Task 7), `compose.dev.yml`, `docs/BACKLOG.md`

**Interfaces:**
- Consumes: `apps/api/dist` (Build), `apps/web/dist` (Build), Migrations-CLI `dist/database/migrate-cli.js` (Task 7), Instrumentierung `dist/instrumentation.js` (Task 10), Health-Endpunkte (Task 8).
- Produces:
  - `docker compose up --build` startet `db` (nur Netz `backend`), `api` (Netze `backend` und `frontend`) und `web` (Caddy, Port `127.0.0.1:8080`). Der API-Container führt beim Start die Migrationen aus und danach den Server.
  - Profile: `ollama` (Dienst `ollama`, noch ohne Verbraucher; ab Teilprojekt 2), `observability` (Dienst `lgtm` = Grafana/Tempo/Loki/Prometheus, UI auf `127.0.0.1:3001`).
  - `node scripts/smoke.mjs` (Umgebungsvariable `BASE_URL`, Standard `http://127.0.0.1:8080`) prüft den laufenden Stack und beendet sich mit Exit-Code 1, wenn eine Erwartung nicht stimmt.
  - Der Ordner `docker/postgres-init/` entfällt: `apps/api/test/db-global-setup.ts` legt die Test-Datenbank selbst an.

- [ ] **Step 1: Basis-Images, Digests und Tags prüfen**

```bash
docker pull node:24-bookworm-slim && docker pull caddy:2-alpine && docker pull pgvector/pgvector:0.8.7-pg18
docker buildx imagetools inspect node:24-bookworm-slim | head -3
docker buildx imagetools inspect caddy:2-alpine | head -3
```
Die Dockerfiles unten nennen die Images zunächst mit Tag. **Pinne sie am Ende dieses Tasks auf den Digest** (`FROM node:24-bookworm-slim@sha256:...`, Digest aus der Ausgabe von `imagetools inspect`); Renovate hält die Digests danach aktuell. Gleiches gilt für `pgvector/pgvector`, `ollama/ollama` und `grafana/otel-lgtm` in `compose.yml`: nimm für `ollama` und `lgtm` einen konkreten aktuellen Versions-Tag aus Docker Hub (kein `latest`).

- [ ] **Step 2: API-Image**

`.dockerignore`:
```
.git
.github
.claude
**/node_modules
**/dist
**/coverage
.env
.env.*
!.env.example
docs
```

`apps/api/Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /repo
# The "packageManager" field in package.json pins the pnpm version; Node 24 ships Corepack.
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @owui/api...
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @owui/api build
# Production dependencies plus the "files" entries (dist) in one self-contained folder.
RUN pnpm --filter @owui/api deploy --prod --legacy /out

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/ ./
USER node
EXPOSE 3000
# Apply pending migrations, then start the server (PID 1 is node, so SIGTERM reaches the app).
CMD ["sh", "-c", "node dist/database/migrate-cli.js && exec node --require ./dist/instrumentation.js dist/main.js"]
```
Prüfe `pnpm deploy` gegen die Doku deiner pnpm-Version (`--legacy` ist ab pnpm 10 nötig, wenn `inject-workspace-packages` nicht gesetzt ist; ohne Workspace-Abhängigkeiten zwischen den Apps entfällt das Problem). Ist das Projekt ESM, lade die Instrumentierung mit `--import` statt `--require`.

- [ ] **Step 3: Web-Image mit Caddy**

`apps/web/Caddyfile`:
```
{
	admin off
	auto_https off
}

:8080 {
	@static not path /api/*
	encode @static zstd gzip

	# The API answers with its own headers (strict CSP "default-src 'none'" and so on): pass them through.
	handle /api/* {
		reverse_proxy api:3000 {
			# SSE: send every chunk immediately.
			flush_interval -1
		}
	}

	handle {
		root * /srv
		header {
			Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
			X-Content-Type-Options nosniff
			Referrer-Policy strict-origin-when-cross-origin
			Permissions-Policy "camera=(), microphone=(), geolocation=()"
			-Server
		}
		header /assets/* Cache-Control "public, max-age=31536000, immutable"
		try_files {path} /index.html
		file_server
	}
}
```
(HSTS gehört in den Deployment-Plan, weil es TLS voraussetzt; siehe BACKLOG.)

`apps/web/Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @owui/web...
COPY tsconfig.base.json ./
COPY apps/web apps/web
# The generated API client is committed, so the build does not need the API.
RUN pnpm --filter @owui/web build

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
USER 65532:65532
EXPOSE 8080
```
Die Web-Anwendung importiert `apps/api/openapi.json` nur zur Generierung (Orval), nicht beim Build; fehlt eine Datei im Build-Kontext, ist das ein Fehler im Dockerfile, nicht in der App.

- [ ] **Step 4: Compose-Dateien**

`compose.yml` (ersetzt die Fassung aus Task 7):
```yaml
name: open-webui-klon

x-hardening: &hardening
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  pids_limit: 256

services:
  db:
    image: pgvector/pgvector:0.8.7-pg18
    restart: unless-stopped
    <<: *hardening
    # The entrypoint starts as root, fixes ownership and then drops to the postgres user.
    cap_add: [CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID]
    environment:
      POSTGRES_USER: owui
      # Development default; production must set POSTGRES_PASSWORD (the database is not published).
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-owui-dev-password}
      POSTGRES_DB: owui
    volumes:
      # Postgres 18 images keep the data below /var/lib/postgresql.
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U owui -d owui']
      interval: 5s
      timeout: 3s
      retries: 20
    networks: [backend]

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    <<: *hardening
    read_only: true
    tmpfs: [/tmp]
    depends_on:
      db:
        condition: service_healthy
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://owui:${POSTGRES_PASSWORD:-owui-dev-password}@db:5432/owui
      PUBLIC_ORIGIN: ${PUBLIC_ORIGIN:-http://localhost:8080}
      # One proxy (Caddy) in front: trust exactly one X-Forwarded-For hop.
      TRUST_PROXY_HOPS: '1'
      LOG_LEVEL: ${LOG_LEVEL:-info}
      OTEL_EXPORTER_OTLP_ENDPOINT: ${OTEL_EXPORTER_OTLP_ENDPOINT:-}
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:3000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
      interval: 10s
      timeout: 4s
      retries: 12
      start_period: 15s
    networks: [backend, frontend]

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    restart: unless-stopped
    <<: *hardening
    read_only: true
    tmpfs: [/data, /config, /tmp]
    depends_on:
      api:
        condition: service_healthy
    ports:
      - '127.0.0.1:8080:8080'
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://127.0.0.1:8080/']
      interval: 10s
      timeout: 3s
      retries: 6
    networks: [frontend]

  ollama:
    profiles: [ollama]
    image: ollama/ollama:0.40.2
    restart: unless-stopped
    volumes:
      - ollama:/root/.ollama
    networks: [frontend]

  lgtm:
    profiles: [observability]
    image: grafana/otel-lgtm:0.36.0
    restart: unless-stopped
    ports:
      - '127.0.0.1:3001:3000'
    networks: [frontend]

networks:
  # The database cannot reach the internet and is not reachable from the web container.
  backend:
    internal: true
  frontend:

volumes:
  pgdata:
  ollama:
```
Die Tags `ollama/ollama:0.40.2` und `grafana/otel-lgtm:0.36.0` waren am 2026-10-09 die neuesten Versionen auf Docker Hub; bestätige sie mit `docker buildx imagetools inspect <image>:<tag>` und nimm bei Bedarf die dann aktuelle Version (kein `latest`). Läuft `db` mit `cap_drop: ALL` + den fünf Capabilities nicht an (Logs zeigen `Operation not permitted`), ergänze genau die fehlende Capability und notiere sie als Kommentar mit Grund.

`compose.dev.yml`:
```yaml
# Local development: publish the database on the loopback interface only.
# The test database "owui_test" is created by apps/api/test/db-global-setup.ts.
services:
  db:
    ports:
      - '127.0.0.1:5433:5432'
```
Der Dienst `db` hängt im internen Netz `backend`; veröffentlichte Ports funktionieren trotzdem (Host-Port-Weiterleitung). Prüfe das mit `pnpm db:up && pnpm test:db`; funktioniert es nicht, hänge `db` in `compose.dev.yml` zusätzlich an das Netz `frontend` (nur in der Dev-Datei).

`.env.example`:
```
# Copy to .env. Everything below has a development default; nothing here is a secret.
# Used by `docker compose` (substitution) and by the API when started on the host (pnpm dev).

POSTGRES_PASSWORD=owui-dev-password
PUBLIC_ORIGIN=http://localhost:8080
LOG_LEVEL=info

# API started on the host (pnpm dev): database published by compose.dev.yml on port 5433.
DATABASE_URL=postgresql://owui:owui-dev-password@127.0.0.1:5433/owui
# Vite dev server origin (browser -> API without the Caddy proxy).
CORS_ORIGINS=http://localhost:5173

# Tracing is off while empty. With `docker compose --profile observability up`: http://lgtm:4318
OTEL_EXPORTER_OTLP_ENDPOINT=
```

- [ ] **Step 5: Smoke-Test schreiben**

`scripts/smoke.mjs`:
```js
// Checks a running stack from the outside. Usage: node scripts/smoke.mjs  (BASE_URL optional)
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:8080';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 90_000);

const failures = [];

function check(name, condition) {
  if (condition) {
    console.log(`ok   ${name}`);
  } else {
    console.log(`FAIL ${name}`);
    failures.push(name);
  }
}

async function waitUntilReady() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/health/ready`);
      if (response.ok) return;
    } catch {
      // not reachable yet
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Stack not ready after ${TIMEOUT_MS} ms: ${BASE_URL}/api/health/ready`);
}

await waitUntilReady();

const ready = await fetch(`${BASE_URL}/api/health/ready`);
check('readiness answers 200 with status ok', ready.status === 200 && (await ready.json()).status === 'ok');

const page = await fetch(`${BASE_URL}/`);
const html = await page.text();
const pageCsp = page.headers.get('content-security-policy') ?? '';
check('start page is HTML with the React root', page.status === 200 && html.includes('id="root"'));
check("page CSP restricts scripts to 'self'", pageCsp.includes("script-src 'self'"));
check('page CSP does not allow inline scripts', !/script-src[^;]*unsafe-inline/.test(pageCsp));
check('page sends nosniff', page.headers.get('x-content-type-options') === 'nosniff');
check('proxy does not announce its version', !page.headers.has('server'));

const deepLink = await fetch(`${BASE_URL}/some/deep/link`);
check('unknown front-end path falls back to the app', deepLink.status === 200 && (await deepLink.text()).includes('id="root"'));

const live = await fetch(`${BASE_URL}/api/health/live`);
check("API keeps its own CSP (default-src 'none')", (live.headers.get('content-security-policy') ?? '').includes("default-src 'none'"));

const missing = await fetch(`${BASE_URL}/api/does-not-exist`);
check(
  'unknown API path answers problem details with a request id',
  missing.status === 404 &&
    (missing.headers.get('content-type') ?? '').includes('application/problem+json') &&
    Boolean(missing.headers.get('x-request-id'))
);

const preflight = await fetch(`${BASE_URL}/api/health/live`, {
  method: 'OPTIONS',
  headers: { origin: 'http://evil.test', 'access-control-request-method': 'GET' },
});
check('CORS: a foreign origin gets no allow header', !preflight.headers.has('access-control-allow-origin'));

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke test passed');
```

- [ ] **Step 6: Stack bauen, starten, prüfen**

```bash
docker compose build
docker compose up -d --wait
node scripts/smoke.mjs
```
Expected: alle Dienste `healthy`, der Smoke-Test endet mit `smoke test passed`. Schlägt etwas fehl, behebe die Ursache in Dockerfile, Caddyfile oder Compose-Datei (Logs: `docker compose logs api web db`).

Härtung prüfen (Ausgabe lesen, nicht nur Exit-Code):
```bash
docker compose exec api id
docker compose exec api sh -c 'touch /app/probe 2>&1 || true'
docker compose exec -T api sh -c 'ls /app; ps -o user,pid,comm -e'
docker network inspect open-webui-klon_backend --format '{{.Internal}}'
docker compose logs api | head -20
```
Expected: `uid=1000(node)`, `touch` meldet "Read-only file system", das Netz `backend` ist `true`, die Logs zeigen `migrations applied` und danach JSON-Logzeilen von pino. Prüfe außerdem, dass der Port der Datenbank nicht auf dem Host lauscht (`docker compose ps` zeigt für `db` keinen veröffentlichten Port, wenn nur `compose.yml` benutzt wird).

Graceful Shutdown: `time docker compose stop api` darf nicht in die Docker-Frist von 10 s laufen (das Herunterfahren dauert wegen `SHUTDOWN_DRAIN_MS` rund 5 s) und der Exit-Code muss 0 sein: `docker compose ps -a api --format '{{.ExitCode}}'`.

- [ ] **Step 7: CSP im Browser prüfen und ADR schreiben**

Öffne http://localhost:8080 (chrome-devtools-MCP) und lies die Konsole: es darf **keine** CSP-Verletzung auftauchen (`Refused to apply inline style`, `Refused to load`). Sidebar und Theme-Knopf müssen funktionieren. Treten Verletzungen durch `<style>`-Elemente auf (manche Radix-Komponenten setzen sie), entscheide, ob die Komponente ersetzt wird oder `style-src` gelockert werden muss, und halte das Ergebnis fest.

`docs/adr/0002-csp-style-src.md`:
```markdown
# ADR 0002: CSP erlaubt Inline-Stile nur als Attribut

## Kontext
Die Oberfläche (shadcn/ui, Radix) setzt Layout-Werte wie `--sidebar-width` als `style`-Attribut. Eine CSP mit
`style-src 'self'` blockiert das; `style-src 'unsafe-inline'` würde zusätzlich eingeschleuste `<style>`-Blöcke
erlauben.

## Entscheidung
`style-src 'self'; style-src-attr 'unsafe-inline'`. Skripte bleiben auf `'self'` beschränkt (kein
`'unsafe-inline'` und kein `eval`). `<style>`-Elemente sind blockiert, `style`-Attribute erlaubt.

## Folgen
- Ein Angreifer mit HTML-Injection kann Aussehen verändern (zum Beispiel Inhalte überdecken), aber keine
  Skripte ausführen.
- Eine neue Komponente, die `<style>`-Elemente einfügt, fällt in den Smoke- und Browser-Prüfungen durch und wird
  ersetzt oder bewusst per Nonce gelöst.
```

- [ ] **Step 8: Images pinnen, BACKLOG ergänzen, aufräumen, committen**

Ersetze die `FROM`-Zeilen und die Images in `compose.yml` durch Tag **und** Digest (aus Step 1). Ergänze in `docs/BACKLOG.md` unter "Offen": "HSTS und TLS (Deployment-Plan)", "Hot-Reload-Container in `compose.dev.yml`", "Problem Details als Schema in OpenAPI deklarieren (aktuell liest der Fetcher die Felder defensiv)", "Theme-Flackern beim ersten Laden (kein Inline-Skript wegen CSP; Alternative: Cookie)", "Rate-Limit-Speicher teilen, sobald mehr als eine API-Instanz läuft".

```bash
docker compose down
pnpm check
git add -A
git commit -m "feat: add container images, hardened compose stack and smoke test" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Expected: `pnpm check` PASS, der Commit gelingt. (Der Datenbank-Datenträger `pgdata` bleibt erhalten; `docker compose down -v` löscht ihn.)

---

### Task 15: Continuous Integration und Abhängigkeitspflege

**Files:**
- Create: `.github/workflows/ci.yml`, `scripts/pin-actions.sh`, `renovate.json`

**Interfaces:**
- Consumes: alle Befehle aus den vorigen Tasks (`pnpm check`, `pnpm test`, `pnpm test:db`, `pnpm openapi`, `docker compose`, `scripts/smoke.mjs`).
- Produces: Workflow `CI` mit den Jobs `quality`, `test`, `test-db`, `build`, `compose-smoke` (inklusive Trivy-Scan der gebauten Images), `semgrep`, `gitleaks`; alle Actions per Commit-SHA gepinnt; `renovate.json` (Konfiguration, die Renovate-GitHub-App muss der Nutzer selbst installieren).

- [ ] **Step 1: Workflow schreiben (zunächst mit Versions-Tags)**

Prüfe die aktuellen Major-Versionen der Actions mit `gh release list -R <owner>/<repo> --limit 3` (`actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `aquasecurity/trivy-action`, `gitleaks/gitleaks-action`) und setze sie unten ein.

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --audit-level high
      - run: pnpm check
      - name: Generated API files are up to date
        run: |
          pnpm openapi
          git diff --exit-code -- apps/api/openapi.json apps/web/src/api/generated

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  test-db:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: pgvector/pgvector:0.8.7-pg18
        env:
          POSTGRES_USER: owui
          POSTGRES_PASSWORD: owui-dev-password
          POSTGRES_DB: owui
        ports:
          - 5433:5432
        options: >-
          --health-cmd "pg_isready -U owui -d owui"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 20
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:db

  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @owui/api build
      - run: pnpm --filter @owui/web build

  compose-smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
      - name: Start the stack exactly as a user would
        run: docker compose up -d --build --wait
      - run: node scripts/smoke.mjs
      - name: Scan the built images
        run: |
          for image in $(docker compose config --images | grep -E 'open-webui-klon-(api|web)'); do
            echo "::group::trivy $image"
            docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
              aquasec/trivy:latest image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "$image"
            echo "::endgroup::"
          done
      - if: failure()
        run: docker compose logs --no-color
      - if: always()
        run: docker compose down -v

  semgrep:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    container:
      image: semgrep/semgrep:latest
    steps:
      - uses: actions/checkout@v5
      - run: semgrep scan --config p/typescript --config p/owasp-top-ten --error --metrics=off

  gitleaks:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
Der Trivy-Aufruf nutzt das offizielle Image per `docker run`, damit keine zusätzliche Action nötig ist; pinne `aquasec/trivy` und `semgrep/semgrep` im selben Schritt auf eine feste Version bzw. einen Digest (`docker buildx imagetools inspect aquasec/trivy:latest`), kein `latest` im Commit. Die Image-Namen aus `docker compose config --images` prüfst du lokal: `docker compose config --images` muss `open-webui-klon-api` und `open-webui-klon-web` enthalten, sonst passe das `grep` an.

- [ ] **Step 2: Skript zum Pinnen der Actions**

`scripts/pin-actions.sh`:
```bash
#!/usr/bin/env bash
# Replaces `uses: owner/repo@tag` with `uses: owner/repo@<commit sha> # tag` in all workflow files.
# Needs the GitHub CLI (`gh`) with network access. Safe to run repeatedly.
set -euo pipefail

for file in .github/workflows/*.yml; do
  grep -oE 'uses: [^ ]+@[^ #]+' "$file" | sort -u | while read -r _ ref; do
    path="${ref%@*}"
    tag="${ref#*@}"
    if [[ "$tag" =~ ^[0-9a-f]{40}$ ]]; then continue; fi
    repo="$(echo "$path" | cut -d/ -f1-2)"
    sha="$(gh api "repos/${repo}/commits/${tag}" --jq .sha)"
    sed -i.bak "s|uses: ${path}@${tag}\$|uses: ${path}@${sha} # ${tag}|" "$file"
    rm -f "${file}.bak"
    echo "pinned ${path}@${tag} -> ${sha}"
  done
done
```

Run:
```bash
chmod +x scripts/pin-actions.sh && ./scripts/pin-actions.sh && grep -n "uses:" .github/workflows/ci.yml
```
Expected: jede `uses:`-Zeile endet mit `@<40 Zeichen> # <tag>`. Schlägt `gh api` fehl (kein Login), melde das dem Nutzer; ohne gepinnte SHAs wird `ci.yml` **nicht** committet.

- [ ] **Step 3: Renovate**

`renovate.json`:
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:best-practices"],
  "minimumReleaseAge": "7 days",
  "lockFileMaintenance": { "enabled": true, "schedule": ["before 6am on monday"] },
  "vulnerabilityAlerts": { "labels": ["security"] },
  "packageRules": [
    {
      "matchDepTypes": ["devDependencies"],
      "matchUpdateTypes": ["minor", "patch"],
      "groupName": "dev dependencies"
    }
  ]
}
```
(`config:best-practices` pinnt Docker-Images und GitHub Actions auf Digests und hält sie aktuell.) Prüfe die Datei mit `pnpm dlx renovate-config-validator renovate.json`.

- [ ] **Step 4: Lokale Vorprüfung**

```bash
pnpm dlx @action-validator/cli .github/workflows/ci.yml   # Syntax; Alternative: actionlint
pnpm check
```
Expected: PASS. Ohne Validator-Werkzeug reicht `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest` (Version pinnen, falls die Zeile in ein Skript wandert).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "ci: add GitHub Actions pipeline with pinned actions, image scan and renovate config" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Die Pipeline läuft erst nach dem ersten Push auf einen GitHub-Remote (Task 16).

---

### Task 16: Abschlussprüfung, README und Beleg

**Files:**
- Create: `README.md`, `docs/dod/00-fundament.md`
- Modify: `docs/PLAN.md`, `docs/BACKLOG.md`

**Interfaces:**
- Consumes: alles aus den Tasks 1–15.
- Produces: eine dokumentierte, von einem frischen Klon aus reproduzierbare Inbetriebnahme; Beleg, dass die Erfolgskriterien aus Spec 8 für das Fundament erfüllt sind.

- [ ] **Step 1: README schreiben (deutsch, kurz)**

`README.md` mit diesen Abschnitten (Inhalt vollständig ausformulieren, keine Platzhalter):
1. **Was das ist**: Lernprojekt, Nachbau von Open WebUI mit NestJS-Backend und React-Frontend; Stand: Fundament (Teilprojekt 0), Link auf [die Spec](docs/superpowers/specs/2026-10-09-open-webui-nestjs-design.md) und [docs/PLAN.md](docs/PLAN.md).
2. **Schnellstart**: Voraussetzung Docker; `docker compose up --build`; Adresse http://localhost:8080; Stoppen mit `docker compose down` (Daten bleiben), vollständig löschen mit `docker compose down -v`.
3. **Entwickeln**: Node 24 und pnpm; `pnpm install`, `cp .env.example .env`, `pnpm db:up`, `pnpm dev` (API auf :3000, Web auf :5173); Tests (`pnpm test`, `pnpm test:db`), Prüfung (`pnpm check`), API-Client neu erzeugen (`pnpm openapi`).
4. **Beobachtbarkeit**: `OTEL_EXPORTER_OTLP_ENDPOINT=http://lgtm:4318 docker compose --profile observability up --build`, dann Grafana auf http://localhost:3001 (Explore, Tempo, `service.name = owui-api`).
5. **Sicherheit in Kürze**: eine Origin über Caddy, CSP, CORS-Whitelist, Origin-Prüfung, Rate Limit, `SafeFetchService`, Audit-Log, gehärtete Container; Verweis auf [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).
6. **Weitere Dokumente**: AGENTS.md, ADRs, BACKLOG.

- [ ] **Step 2: Gesamtprüfung im Arbeitsverzeichnis**

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm db:up && pnpm test:db
pnpm openapi && git status --porcelain apps/api/openapi.json apps/web/src/api/generated
```
Expected: alles grün; `git status` meldet keine Änderungen an den generierten Dateien. Notiere die Testzahlen (API, Web, DB) für den Beleg. Schlägt etwas fehl, beheben, bevor es weitergeht.

- [ ] **Step 3: Frischer Klon, ein Befehl**

Committe zuerst den Stand (`git add -A && git commit -m "docs: add README"`), dann in einem leeren Verzeichnis im Scratchpad der Session:
```bash
git clone "$(git rev-parse --show-toplevel)" fresh-clone && cd fresh-clone
docker compose up -d --build --wait
node scripts/smoke.mjs
docker compose down -v
```
Expected: `smoke test passed`. Das ist das Erfolgskriterium "frischer Klon, ein Befehl" aus Spec 8. Räume das Klon-Verzeichnis danach auf. Bricht es ab, weil etwas nur lokal vorhanden war (ungetrackte Datei, `.env`), behebe die Ursache im Repository.

- [ ] **Step 4: Browser-Abnahme des Docker-Stacks**

`docker compose up -d --wait` im Repository, dann http://localhost:8080 im Browser (chrome-devtools-MCP): Statusmeldung grün, Theme-Wechsel, keine Konsolenfehler und keine CSP-Verletzung, Netzwerkanfrage `/api/health/ready` mit `traceparent`. Mit `--profile observability` und `OTEL_EXPORTER_OTLP_ENDPOINT=http://lgtm:4318` einmal starten und in Grafana (Tempo) den Trace dieser Anfrage finden; er zeigt Express- und HTTP-Spans, und die Log-Zeile des Requests (`docker compose logs api`) enthält `trace_id`. Danach `docker compose --profile observability down`.

- [ ] **Step 5: Beleg und Pläne aktualisieren**

`docs/dod/00-fundament.md`:
```markdown
### DoD: Teilprojekt 0 (Fundament)

- [x] Vertrag: OpenAPI aus dem Backend, Orval-Client eingecheckt, CI prüft Abweichungen
- [x] Tests: <API-Zahl> API, <DB-Zahl> DB, <Web-Zahl> Web grün; `pnpm check` grün; kein echter Netzwerkzugriff außer lokalen Testservern
- [x] Invarianten: Env nur über `config/env.ts`; keine Inhalte in Logs (Redaction getestet); `SafeFetchService` getestet (SSRF-Tabelle, Weiterleitungen, Größe, Zeit); Audit-Log append-only (Trigger getestet)
- [x] UI: Zustände laden, Fehler mit Wiederholen, Erfolg; "leer" nicht anwendbar (kein Listenbild); deutsche Texte über i18n; im Browser geprüft (hell/dunkel, Telefonbreite, Tastatur)
- [x] Betrieb: `docker compose up` auf frischem Klon grün (Smoke-Test), Container als Nicht-Root mit schreibgeschütztem Dateisystem, Datenbank nur im internen Netz, geordnetes Herunterfahren
- [x] Docs: README, PLAN, BACKLOG, ADR 0001/0002, THREAT-MODEL aktualisiert
- [ ] Offen: siehe docs/BACKLOG.md (Stufe 2 Agentic-Setup, Deployment, HSTS, Logs per OTLP)
```
Trage die gemessenen Zahlen aus Step 2 ein (keine spitzen Klammern im Commit).

`docs/PLAN.md`: setze Teilprojekt 0 auf "erledigt", nenne als Nächstes (1) den Plan für Stufe 2 des Agentic-Setups (Stop-Hook, Bash-Guard, DoD-Vorlage, Testregeln) und (2) Brainstorming und Spec für Teilprojekt 1 (Auth). `docs/BACKLOG.md`: Punkte, die beim Umsetzen entstanden sind, ergänzen; erledigte streichen.

- [ ] **Step 6: Push und CI beobachten**

```bash
git remote -v
```
Existiert ein Remote `origin`: `git push`, dann `gh run list --branch main --limit 1` und bis zum Ende beobachten (`gh run watch`). Ein roter Lauf wird behoben, bevor etwas Neues beginnt (Ursache lesen mit `gh run view --log-failed`). Existiert **kein** Remote: nichts anlegen, sondern dem Nutzer melden, dass die CI erst nach dem Anlegen eines GitHub-Repositories läuft (das ist eine externe Aktion und braucht seine Entscheidung). Weise ihn außerdem darauf hin, die Renovate-GitHub-App für das Repository zu installieren.

- [ ] **Step 7: Abschluss-Commit**

```bash
git add -A
git commit -m "docs: record definition-of-done receipt for the foundation and update plan and backlog" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
Weise den Nutzer danach in einem Satz auf `/clear` hin: Alle Entscheidungen stehen in Spec, Plan, ADRs und BACKLOG.

