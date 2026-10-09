# Open-WebUI-Nachbau mit NestJS: Gesamt-Spec

Stand: 2026-10-09. Status: von Oguz in der Brainstorming-Runde abgestimmt, zur Prüfung.

## 1. Ziel und Rahmen

Ein Lern- und Privatprojekt, das die Kernfunktionen von [Open WebUI](https://github.com/open-webui/open-webui)
nachbaut: Chat mit lokalen und entfernten Sprachmodellen, Wissensbasis (RAG), Nutzerverwaltung und Tools.

- **Backend:** NestJS, nach den Konventionen der NestJS-Dokumentation.
- **Frontend:** neu in React + Vite mit shadcn/ui, nicht das Svelte-Original. Die API muss nicht
  kompatibel zu Open WebUI sein.
- **Lizenz:** Lernprojekt und privater Einsatz. Es wird kein Code des Originals kopiert; Struktur und
  Funktionsumfang dienen nur als Vorlage.
- **Nicht-Ziele (YAGNI):** Microservices, GraphQL, CQRS, Multi-Tenancy, Plugin-Marktplatz, Kubernetes,
  Datenmigration aus Open WebUI, OpenTelemetry. **Deployment ist vorerst ausgeklammert.**

## 2. Technische Entscheidungen

| Bereich      | Entscheidung                                                                                              | Grund                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Repo         | Monorepo mit pnpm-Workspaces: `apps/api`, `apps/web`; kein Turborepo/Nx                                    | einfach, genug für zwei Apps                                   |
| Laufzeit     | Node.js, Version in `.nvmrc` festgeschrieben                                                              | reproduzierbar                                                 |
| Backend      | NestJS (aktuell 12.x), Feature-Module                                                                     | Wunsch des Nutzers                                             |
| Datenbank    | PostgreSQL mit pgvector, **TypeORM** (`@nestjs/typeorm`), Migrationen per `migration:generate`            | Nest-nativ; TypeORM 1.x unterstützt `vector`/`halfvec` in Postgres (Changelog geprüft am 2026-10-09) |
| Jobs         | **pg-boss** in einem eigenen Nest-Modul gekapselt, **kein Redis** im MVP                                  | Jobs transaktional mit den Daten, eine Abhängigkeit weniger    |
| Streaming    | **SSE** (`@Sse()` bzw. Stream-Response) für Chat und Benachrichtigungen; kein WebSocket                   | einfacher, reicht für den Umfang                               |
| Auth         | Cookie-Session (httpOnly, in Postgres gespeichert), eigener Guard; API-Keys als Bearer                    | sofort widerrufbar, kein Token im JS                           |
| LLM-Schicht  | **Vercel AI SDK** (Streaming, Tool-Calling, mehrere Anbieter, Embeddings)                                 | Wunsch des Nutzers; weniger eigener Anbietercode               |
| Validierung  | DTOs mit `class-validator` + `ValidationPipe`, `@nestjs/swagger` mit CLI-Plugin                           | NestJS-Standard                                                |
| API-Vertrag  | OpenAPI aus dem Backend, daraus mit Orval ein typisierter Client + TanStack-Query-Hooks fürs Frontend      | eine Quelle der Wahrheit, keine handgeschriebenen Paralleltypen |
| Frontend     | React, Vite, React Router, Tailwind, **shadcn/ui**, TanStack Query, react-hook-form + zod (nur Formulare) | Standardstack, shadcn-Quellcode ist anpassbar                   |
| Berechtigung | Besitzer und „mit allen teilen" im MVP; Gruppen-/ACL-Tabellen im Schema vorbereitet, ohne UI; CASL später | Migrationen vermeiden, Umfang klein halten                     |
| Dateispeicher| Interface mit lokalem Volume als erste Implementierung                                                    | S3 später möglich                                              |
| Lint/Format  | **ESLint** (Flat Config, `typescript-eslint`) + **Prettier** (`eslint-config-prettier`)                    | Wunsch des Nutzers                                             |
| Tests        | Vitest für API (mit SWC) und Web; Supertest für E2E gegen echte Postgres-Test-DB; Playwright für den Hauptpfad | ein Test-Runner |
| Logging      | `nestjs-pino`, strukturiert, mit Request-ID                                                               | Betrieb und Fehlersuche                                        |
| i18n         | react-i18next, Standardsprache Deutsch, Texte nur über Schlüssel                                          | später erweiterbar                                             |

**Zu prüfen vor dem Festschreiben in Teilprojekt 0** (Regel „Verify before deciding", keine Annahmen aus dem Gedächtnis):
aktuelle Versionen und APIs von NestJS, TypeORM, pg-boss, Vercel AI SDK (Mock-Modelle aus `ai/test`),
Ollama-Provider für das AI SDK; ob Vitest mit SWC die Nest-Decorators sauber verarbeitet (sonst Jest für `apps/api`).

## 3. Architektur

```
Browser ── HTTP + SSE ──> web (Caddy: statische Dateien, /api -> api)
                           └── api (NestJS) ──> Postgres (+ pgvector, pg-boss-Schema)
                                    └── LLM-Anbieter (Ollama, OpenAI-kompatibel) über das AI SDK
```

- **Zwei Images:** `web` (Caddy mit gebautem Vite-Frontend und Reverse Proxy auf `/api`, `flush_interval -1`,
  keine Kompression für `/api`, damit SSE ungepuffert ankommt) und `api`. In Produktion gibt es dadurch nur
  eine Origin. CORS ist trotzdem implementiert und wird über eine Origin-Whitelist aus der Konfiguration
  gesteuert (`credentials: true`, kein `*`); in der Entwicklung läuft Vite auf eigenem Port.
- **Feature-Module in `apps/api/src`:** `auth`, `users`, `models` (Provider/Verbindungen), `chats`,
  `knowledge` (RAG), `tools`, `jobs`, `storage`, `config`, `common` (Filter, Interceptors, Decorators wie
  `@CurrentUser()` und `@Roles()`).
- **Schichten:** Controller sind dünn (Eingabe validieren, Nutzer aus Session, an Service delegieren).
  Geschäftslogik steht in Services. DB, LLM-Anbieter, Dateispeicher und Job-Queue liegen hinter
  Injection-Tokens und sind in Tests per `overrideProvider` austauschbar.
- **Querschnitt:** globaler `ExceptionFilter` (Problem Details nach RFC 9457), `ClassSerializerInterceptor`,
  `@nestjs/config` mit Validierungsschema, `@nestjs/terminus` (Health), `@nestjs/throttler` (im Speicher),
  Helmet, `@nestjs/event-emitter` für interne Ereignisse (z. B. „Nachricht fertig" -> Titel-Job).
- **Datenmodell (Grobskizze):** `user`, `session`, `api_key`, `group`, `acl_entry`, `provider_connection`
  (API-Keys verschlüsselt, AES-GCM), `chat`, `message` (Baumstruktur für Regenerieren), `folder`, `tag`,
  `knowledge_collection`, `file`, `chunk` (mit `vector`-Spalte), `tool`, `usage_event` (Tokens pro Nutzer/Modell).
  Das genaue Schema entsteht je Teilprojekt in dessen eigener Spec.

## 4. Teilprojekte und Reihenfolge

Jedes Teilprojekt bekommt eigene Spec, eigenen Plan und eigene Umsetzung in vertikalen Scheiben
(Datenbank -> API -> UI). Nach jedem Teilprojekt läuft etwas Benutzbares.

| #  | Teilprojekt                | Inhalt                                                                                                                                                                                   |
| -- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0  | Fundament                  | Monorepo, `docker compose up` startet alles, Postgres+pgvector, Config-Validierung, Health, Vite + Tailwind + shadcn + Router + Layout mit Sidebar + Theme-Umschalter, OpenAPI-Client-Pipeline, Agentic-Setup (Abschnitt 5, Stufe 1), CI |
| 1  | Auth + Nutzer/Rollen       | Signup/Login/Logout, Cookie-Session, Argon2, Rollen Admin/User, API-Keys, Nutzerverwaltung (Admin), erster Admin beim ersten Start                                                      |
| 2  | Modell-Anbindung           | Provider-Abstraktion (Ollama, OpenAI-kompatibel), Verbindungen im Admin-Bereich, Modellliste                                                                                             |
| 3  | Chat + Streaming           | Chats, Nachrichten, Ordner, Tags, SSE-Streaming, Abbruch, Regenerieren, Titelgenerierung (pg-boss-Job), Markdown/Code-Anzeige. Entscheidung dort: `useChat` aus `@ai-sdk/react` oder eigener Stream-Client |
| 4  | RAG                        | Upload (PDF, DOCX, Markdown, TXT), Chunking, Embeddings, pgvector-Suche, Wissenssammlungen, Quellenangaben im Chat, Ingestion als pg-boss-Job                                            |
| 5  | Tools                      | Eingebaute Tools (z. B. Rechner, URL-Abruf mit SSRF-Schutz) und MCP-Client, Tool-Calling-Schleife                                                                                        |
| 6  | Websuche (optional)        | Suchanbieter hinter Interface                                                                                                                                                            |
| 7  | Nutzer-Tools mit Sandbox   | Nutzercode in isoliertem Worker-Container ohne Netzwerk- und DB-Zugriff (nur nach Sicherheitsdesign)                                                                                     |
| 8  | Deployment (zurückgestellt)| Eigener Hetzner-Server empfohlen (der Server des notebooklm-klon hat 4 GB RAM und ist mit eigenen Diensten ausgelastet); Muster aus `notebooklm-klon/deploy` übernehmen. Wird nicht vor Teilprojekt 5 angefasst. |

Offen bis zur jeweiligen Spec: OCR, Bilder und Web-Loader für RAG; OIDC/OAuth-Login; E2E mit Playwright
über den Hauptpfad hinaus; Gruppen-/ACL-Oberfläche.

## 5. Agentic-Software-Engineering-Setup

Vorlage ist das Setup in `../notebooklm-klon` (AGENTS.md, Hooks, Husky, CI), angepasst an NestJS und die
globalen Arbeitsregeln des Nutzers.

### Stufe 1: Teil von Teilprojekt 0

- **`AGENTS.md`** als einzige Quelle für Agentenregeln; `CLAUDE.md` enthält nur `@AGENTS.md`.
- **Schichten per Werkzeug erzwungen:** dependency-cruiser (keine Zyklen; `apps/web` importiert nie
  Runtime-Code aus `apps/api`) und ESLint-Regeln (kein `any`, kein `@ts-ignore`, kein `export *`).
- **Produkt-Invarianten** als nummerierte Regeln in AGENTS.md:
  1. Jede Datenabfrage ist in SQL auf `userId` (bzw. ACL) begrenzt; Identität kommt aus der Session, nie vom Client.
  2. Quellenangaben im Chat werden serverseitig gegen den an das Modell gesendeten Kontext geprüft.
  3. Ingestion ist idempotent (SHA-256 des Inhalts pro Nutzer, kein doppeltes Parsen/Embedden).
  4. Keine Dokument- oder Chat-Inhalte in Logs; nur IDs, Längen, Dauer, Token-Zahlen.
  5. Modell-IDs und Limits nur aus der Konfiguration.
  6. Umgebungsvariablen nur über das validierte Config-Modul; `.env*` wird nie gelesen, ausgegeben oder committet (außer `.env.example`).
  7. SSRF-Schutz für jeden URL-Abruf (nur http/https, DNS-Auflösung, keine privaten Adressen, Prüfung nach jeder Weiterleitung, Limits für Zeit und Größe).
  8. Jede asynchrone UI-Ansicht kennt leer, laden, Fehler mit Retry und „in Arbeit".
  9. Migrationen werden generiert, generierte Migrationen nie von Hand geändert.
  10. „Verify before deciding": Versionen, Preise, Limits und Bibliotheks-APIs vor dem Einsatz in der aktuellen Doku prüfen.
  11. Relative Markdown-Links, keine absoluten Rechnerpfade; Doku im selben Commit aktualisieren, wenn sich Architektur oder Vertrag ändern.
- **Keine echten LLM-Aufrufe in Tests.** Mock-Modelle des AI SDK; echte Aufrufe nur in einem eigenen
  `eval:live`-Skript (ab Teilprojekt 4).
- **`.claude/settings.json`:** deny-Regeln für Lesen/Bearbeiten von `.env*` (außer `.env.example`) und
  `pnpm-lock.yaml`; allow-Liste für die Standardbefehle (`pnpm check`, `pnpm test`, `git status/diff/log/add/commit/push`);
  `ask` für Änderungen an AGENTS.md und `.claude/**`.
- **Husky + lint-staged:** pre-commit führt lint-staged und `pnpm check` aus, pre-push `pnpm test`.
  `--no-verify` ist verboten; ein fehlschlagender Hook wird durch Beheben der Ursache gelöst.
- **`pnpm check`:** Typecheck, ESLint, Prettier-Check, dependency-cruiser.
- **CI (GitHub Actions):** Format, Check, Tests, DB-Tests mit pgvector-Service, Build, `pnpm audit`, Semgrep.
- **`docs/BACKLOG.md`** (zunächst leer) für Offenes und bewusst Verworfenes; `docs/PLAN.md` verweist auf diese Spec.
- **Git-Workflow:** direkt auf `main`, kleine Commits, `git revert` statt Branch-Wechsel; Conventional Commits.
  (Weicht bewusst vom Feature-Branch-Workflow des notebooklm-klon ab.)

### Stufe 2: direkt nach dem Fundament

- **Stop-Hook:** der Agent darf erst fertig melden, wenn `pnpm check` grün ist; blockiert höchstens einmal,
  merkt sich ein bestandenes Ergebnis per Hash der geänderten Codedateien.
- **Bash-Guard-Hook** (mit eigenen Tests): blockiert Force-Push, `--no-verify` und Zugriffe auf Secret-Dateien.
- **Definition-of-Done-Beleg** am Ende jedes Features: Vertrag, Tests und `pnpm check` grün, Invarianten,
  UI-Zustände (im Browser geprüft), Doku, offene Punkte.
- **Pre-Flight vor dem Code:** Umfang, Nicht-Umfang, Befehl, der den Erfolg beweist.
- **Testregeln:** Verhalten statt Markup prüfen; ein Verhalten in einem Test auf der untersten möglichen
  Ebene; ein Test muss durch Mutation sterben können; Auth- und Not-Found-Tests bleiben pro Controller.

### Stufe 3: später oder bei Bedarf

- knip und jscpd (ab Teilprojekt 1), Magic-String-Audit, Eval-Harness für die RAG-Qualität (ab Teilprojekt 4)
  mit Berichten unter `reports/`, Ordner `spikes/` für Machbarkeitstests mit echten APIs.

## 6. Lokale Entwicklung und Start

- **Ein Befehl:** `docker compose up` startet Postgres+pgvector, führt Migrationen aus, startet `api` und `web`
  und legt beim ersten Start einen Admin an. Healthchecks mit `depends_on: condition: service_healthy`.
- **Defaults:** `.env.example` mit funktionierenden Entwicklungswerten; Compose nutzt sie, wenn keine `.env`
  existiert. Das Session-Secret erzeugt die API beim ersten Start selbst, falls keines gesetzt ist.
- **LLM-Zugang:** Optionales Compose-Profil `ollama`. Alternativ ein vorhandenes Ollama auf dem Host
  (`host.docker.internal`) oder ein OpenAI-kompatibler Endpoint, der in der UI eingetragen wird.
- **Entwicklung:** `compose.dev.yml` mit Hot Reload für API und Vite; alternativ nur Postgres per Compose und
  der Rest mit `pnpm dev`.

## 7. Erfolgskriterien

- Teilprojekt 0: `docker compose up` auf einem frischen Klon liefert eine erreichbare App mit grünem
  Health-Endpoint; `pnpm check` und `pnpm test` sind grün; CI läuft auf `main` grün.
- Je Teilprojekt: die in dessen Spec genannte Benutzerreise funktioniert im Browser, die Tests laufen ohne
  echte LLM-Aufrufe, die Definition-of-Done ist belegt.

## 8. Risiken

- **Umfang:** Open WebUI ist groß. Gegenmittel: Teilprojekte mit klaren Grenzen, YAGNI-Streichliste in Abschnitt 1.
- **Sandbox für Nutzercode (Teilprojekt 7):** sicherheitskritisch und aufwendig. Gegenmittel: erst eingebaute
  Tools und MCP, Nutzercode erst nach eigenem Sicherheitsdesign.
- **Streaming-Protokoll:** Die Kopplung von Backend-SSE und `useChat` ist zu entscheiden (Teilprojekt 3).
- **Tool-Kompatibilität (Vitest+SWC mit Nest-Decorators):** in Teilprojekt 0 verifizieren, Rückfall auf Jest für `apps/api`.
- **Ressourcen für späteres Deployment:** siehe Teilprojekt 8; nichts davon blockiert die Entwicklung.
