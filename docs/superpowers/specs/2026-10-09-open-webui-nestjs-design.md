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
- **Qualitätsanspruch:** Das Projekt wird wie eine Enterprise-Lösung gebaut (Sicherheit, Beobachtbarkeit,
  Zuverlässigkeit, Tests, Lieferkette). Die Anforderungen stehen in Abschnitt 6 und sind auf die Teilprojekte verteilt.
- **Nicht-Ziele (YAGNI):** Microservices, GraphQL, CQRS, Plugin-Marktplatz, Kubernetes, Redis (bis horizontal
  skaliert wird), Datenmigration aus Open WebUI. Multi-Tenancy und Enterprise-Login gibt es nur als optionales
  Teilprojekt 9. **Deployment ist vorerst ausgeklammert.**

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
| Logging      | `nestjs-pino`, strukturiert, mit Request-ID und `redact` für sensible Felder                              | Betrieb und Fehlersuche                                        |
| Observability| **OpenTelemetry** (Traces, Metriken, Logs; OTLP-Export), Prometheus-Metriken; optionales Compose-Profil `observability` (Grafana, Tempo, Loki, Prometheus); Frontend-Fehler über Sentry-kompatiblen Dienst (GlitchTip) | Fehlersuche und Messbarkeit von Anfang an |
| Lasttests    | **k6** mit Fake-LLM-Provider (streamt Tokens mit einstellbarer Latenz)                                    | deterministisch, ohne echtes Modell                            |
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
| 0  | Fundament                  | Monorepo, `docker compose up` startet alles, Postgres+pgvector, Config-Validierung, Health, Vite + Tailwind + shadcn + Router + Layout mit Sidebar + Theme-Umschalter, OpenAPI-Client-Pipeline, Agentic-Setup (Abschnitt 5, Stufe 1), CI, Sicherheits-Basis und Observability-Grundgerüst (Abschnitt 6.2, Stufe A), ADRs und Threat Model |
| 1  | Auth + Nutzer/Rollen       | Signup/Login/Logout, Cookie-Session, Argon2, Rollen Admin/User, API-Keys, Nutzerverwaltung (Admin), erster Admin beim ersten Start                                                      |
| 2  | Modell-Anbindung           | Provider-Abstraktion (Ollama, OpenAI-kompatibel), Verbindungen im Admin-Bereich, Modellliste                                                                                             |
| 3  | Chat + Streaming           | Chats, Nachrichten, Ordner, Tags, SSE-Streaming, Abbruch, Regenerieren, Titelgenerierung (pg-boss-Job), Markdown/Code-Anzeige. Entscheidung dort: `useChat` aus `@ai-sdk/react` oder eigener Stream-Client |
| 4  | RAG                        | Upload (PDF, DOCX, Markdown, TXT), Chunking, Embeddings, pgvector-Suche, Wissenssammlungen, Quellenangaben im Chat, Ingestion als pg-boss-Job                                            |
| 5  | Tools                      | Eingebaute Tools (z. B. Rechner, URL-Abruf mit SSRF-Schutz) und MCP-Client, Tool-Calling-Schleife                                                                                        |
| 6  | Härtung                    | k6-Lasttests (Last, Stress, Spike, Soak) mit Fake-Provider, Chaos-/Resilienztests (DB weg, Anbieter hängt, Worker stirbt), Mutation-Testing für kritische Logik, WCAG-2.2-AA-Audit, Backup-/Restore-Übung, SBOM und Image-Signierung, Security-Review gegen Abschnitt 6.1 und OWASP ASVS L2 |
| 7  | Websuche (optional)        | Suchanbieter hinter Interface, Abruf nur über den `SafeFetchService`                                                                                                                      |
| 8  | Nutzer-Tools mit Sandbox   | Nutzercode in isoliertem Worker-Container ohne Netzwerk- und DB-Zugriff (nur nach Sicherheitsdesign)                                                                                     |
| 9  | Enterprise-Funktionen (optional) | OIDC/SSO (später SAML), MFA (TOTP, Passkeys), Gruppen-/ACL-Oberfläche, Workspaces, Quoten und Budgets, SCIM. Jeweils eigene Spec.                                                |
| 10 | Deployment (zurückgestellt)| Eigener Hetzner-Server empfohlen (der Server des notebooklm-klon hat 4 GB RAM und ist mit eigenen Diensten ausgelastet); Muster aus `notebooklm-klon/deploy` übernehmen. Wird nicht vor Teilprojekt 6 angefasst. |

Offen bis zur jeweiligen Spec: OCR, Bilder und Web-Loader für RAG; Playwright über den Hauptpfad hinaus.

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
  7. Jeder ausgehende HTTP-Abruf auf eine nutzer- oder modellbeeinflusste URL läuft über den `SafeFetchService` (Abschnitt 6.1, SSRF); direkter `fetch`/`axios`-Aufruf dafür ist per ESLint verboten.
  7a. Ausgabe von Sprachmodellen, Tool-Ergebnisse und abgerufene Dokumente sind unvertrauenswürdige Eingaben (Abschnitt 6.1, Prompt Injection): kein HTML-Rendering, keine privilegierte Aktion allein aufgrund von Modellausgabe.
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

## 6. Sicherheits- und Qualitätsanforderungen

Maßstab: OWASP ASVS Level 2, OWASP API Security Top 10 und OWASP Top 10 für LLM-Anwendungen. Ein Threat Model
(STRIDE, `docs/THREAT-MODEL.md`) entsteht in Teilprojekt 0 und wird je Teilprojekt fortgeschrieben.
Architekturentscheidungen stehen als ADRs unter `docs/adr/`.

### 6.1 Bedrohungskatalog

| Bedrohung | Maßnahme | Ab |
| --- | --- | --- |
| **SSRF** über URL-Tool, Web-Loader, MCP-/Provider-URLs, Bild-Abruf | Ein einziger `SafeFetchService`: nur `http`/`https`; DNS selbst auflösen und die IP gegen eine Sperrliste prüfen (Loopback, RFC 1918, Link-Local inkl. Cloud-Metadaten `169.254.0.0/16`, CGNAT, IPv6-ULA/Link-Local, IPv4-in-IPv6); **mit der geprüften IP verbinden** (kein zweites Auflösen, schützt vor DNS-Rebinding); jede Weiterleitung neu prüfen (Maximalzahl); Timeouts, Größenlimit, Content-Type-Allowlist; keine Zugangsdaten weiterreichen. Zweite Schicht: eigenes Docker-Netz ohne Zugriff der API auf interne Dienste außer Postgres. **Ausnahme Provider-Verbindungen:** Ollama liegt legitim in privaten Netzen, darum dürfen nur Admins Verbindungen anlegen, gegen eine explizite Liste vertrauenswürdiger Hosts; Nutzer-ausgelöste Abrufe nutzen immer die strenge Sperrliste. | 0 (Dienst), 2, 5 |
| **Prompt Injection** (direkt und indirekt über Dokumente, Webseiten, Tool-Ergebnisse) | Lässt sich nicht vollständig verhindern, darum Schadensbegrenzung: (1) Modellausgabe und abgerufener Inhalt sind unvertrauenswürdig; (2) Tools nach dem Prinzip der geringsten Rechte, pro Chat per Allowlist freigeschaltet; (3) Tools mit Seiteneffekten oder Netzwerkzugriff brauchen eine **Bestätigung durch den Nutzer**; (4) kein Tool darf in derselben Runde private Daten lesen und frei nach außen senden (private Daten + unvertrauter Inhalt + Ausgangskanal = Datenabfluss); (5) abgerufener Inhalt wird als Daten markiert und vom System-Prompt getrennt (nur eine Zusatzhürde, kein Schutz allein); (6) Zitate werden serverseitig gegen den gesendeten Kontext geprüft; (7) Systemprompts enthalten keine Geheimnisse. | 3, 4, 5 |
| **Datenabfluss über Rendering** (Markdown-Bilder/Links mit Nutzdaten in der URL) | `react-markdown` ohne rohes HTML, `rehype-sanitize`, strenge `img-src`, kein automatisches Nachladen externer Bilder (optional über einen filternden Proxy), Links mit `rel="noopener noreferrer"`. HTML-Artefakte, falls je gewünscht: nur in einem `sandbox`-Iframe auf eigener Origin. | 3 |
| **Vergiftete RAG-Dokumente** | Chunks tragen Herkunft und Besitzer; Suche immer in SQL auf Nutzer/ACL begrenzt; Inhalte gelten als unvertraut (siehe Prompt Injection). | 4 |
| **MCP-/Tool-Missbrauch** (Tool Poisoning, bösartige Beschreibungen) | MCP-Server nur durch Admins registriert (Allowlist), zunächst nur Remote-HTTP, **kein stdio** (Codeausführung); Tool-Definitionen werden gepinnt und bei Änderung neu bestätigt; Ergebnisse unvertraut. | 5 |
| **Übermäßiger Verbrauch / DoS** | Token-, Kontext- und Antwortlängen-Limits, gleichzeitige Streams pro Nutzer begrenzt, Rate Limits, Request- und Upload-Größen, Timeouts, SSE-Verbindungslimits, Quoten pro Nutzer, Kostenbudget pro Anbieter. | 1–4 |
| **Datei-Upload** (Zip-Bomben, Pfadtraversal, bösartige PDFs, Polyglots) | Serverseitig erzeugte Dateinamen, Magic-Byte-Prüfung, Entpack- und Seitenlimits, **Parsing im Worker mit Speicher- und Zeitlimit**, Downloads mit `Content-Disposition: attachment` und `nosniff`, optional ClamAV. | 4 |
| **BOLA/IDOR, Broken Function Level Auth** | Jede Abfrage nach Besitzer/ACL gefiltert (Invariante 1); pro Endpunkt ein Test „Nutzer B kann Objekt von Nutzer A nicht lesen, ändern, löschen". | jedes |
| **Mass Assignment / Operator-Injection** | `whitelist` + `forbidNonWhitelisted` in der `ValidationPipe`; nie Request-Body direkt als TypeORM-`where`; Raw-SQL (pgvector) nur mit Parametern. | jedes |
| **Konto-Übernahme** | Argon2id, Rate Limit pro Konto und IP, einheitliche Antworten und Zeiten gegen Nutzer-Enumeration, Session-Rotation beim Login, Reset-Tokens gehasht und kurzlebig, API-Keys nur gehasht gespeichert und einmal angezeigt, Vergleich in konstanter Zeit, Open-Redirect-Prüfung beim `next`-Parameter, Leak-Prüfung neuer Passwörter. | 1 |
| **XSS/CSRF/Clickjacking** | Strenge CSP ohne `unsafe-inline` für Skripte, Trusted Types, `SameSite`, Origin-Prüfung plus CSRF-Token bei schreibenden Requests, `frame-ancestors 'none'`, CORS ohne Origin-Spiegelung. | 0, 1 |
| **Geheimnisse und Fehlerausgaben** | Provider-Keys verschlüsselt (AES-GCM, Schlüsselrotation vorgesehen), keine Stacktraces in Produktionsantworten, `pino redact`, Secret-Scanning (gitleaks) in Hook und CI. | 0 |
| **Lieferkette** | Gesperrte Lockfile, Karenzzeit für frische Paketversionen, Install-Skripte nur für freigegebene Pakete, Actions per SHA festgenagelt, `pnpm audit`/OSV, Lizenzprüfung, SBOM (CycloneDX), signierte Images (cosign). | 0, 6 |
| **Container** | Nicht-Root, Read-only-Dateisystem, Capabilities entfernt, Trivy-Scan in der CI, Ressourcenlimits. | 0 |
| **Datenschutz gegenüber Anbietern** | Nutzer sieht, an welchen Anbieter ein Chat geht; Admin kann Anbieter pro Gruppe sperren; Inhalte erscheinen nicht in Logs. | 2 |

### 6.2 Qualitätsanforderungen nach Stufen

- **Stufe A, von Anfang an (Teilprojekt 0/1):** Sicherheits-Header und CSP, CSRF-Schutz, Validierungs-Whitelist,
  Rate Limiting, Secret-Scanning, Container-Härtung, `SafeFetchService`, OpenTelemetry-Grundgerüst
  (Traces, RED-Metriken, `traceparent` vom Browser), Liveness/Readiness getrennt, Graceful Shutdown (laufende
  SSE-Streams und Jobs sauber beenden), Timeouts für alle ausgehenden Aufrufe, Audit-Log-Tabelle, ADRs, Threat Model.
- **Stufe B, je Teilprojekt:** IDOR-/Autorisierungstests pro Endpunkt, die zutreffenden Zeilen aus 6.1, Metriken
  der Funktion (u. a. Tokens, Time-to-first-token, Fehlerrate je Anbieter, Queue-Rückstand und Dead Letter), idempotente
  Jobs, Retries mit Backoff, Circuit Breaker für LLM-Anbieter, Cursor-Pagination, OpenAPI-Breaking-Change-Prüfung
  (`oasdiff`) in der CI, DSGVO-Funktionen (Export und Löschung des Kontos), Zero-Downtime-Migrationen (Expand/Contract).
- **Stufe C, Teilprojekt 6 (Härtung):** k6, Chaos-Tests, Mutation-Testing (Stryker), WCAG-2.2-AA mit axe, Backup mit
  Point-in-Time-Recovery und Restore-Probe, SBOM/Signierung, Security-Review.
- **Stufe D, Teilprojekt 9 (optional):** siehe Teilprojektliste.

**k6-Hinweis:** Das LLM ist gemockt (Fake-Provider), sonst wird das Modell statt der API gemessen. Ob k6 SSE
nativ liest oder die Erweiterung `xk6-sse` nötig ist, ist vor Teilprojekt 6 gegen die aktuelle Version zu prüfen.

## 7. Lokale Entwicklung und Start

- **Ein Befehl:** `docker compose up` startet Postgres+pgvector, führt Migrationen aus, startet `api` und `web`
  und legt beim ersten Start einen Admin an. Healthchecks mit `depends_on: condition: service_healthy`.
- **Defaults:** `.env.example` mit funktionierenden Entwicklungswerten; Compose nutzt sie, wenn keine `.env`
  existiert. Ein Session-Secret ist nicht nötig: Session-Tokens sind zufällig und liegen nur als Hash in der DB ([Teilprojekt 1](2026-10-09-teilprojekt-1-auth-design.md)).
- **LLM-Zugang:** Optionales Compose-Profil `ollama`. Alternativ ein vorhandenes Ollama auf dem Host
  (`host.docker.internal`) oder ein OpenAI-kompatibler Endpoint, der in der UI eingetragen wird.
- **Entwicklung:** `compose.dev.yml` mit Hot Reload für API und Vite; alternativ nur Postgres per Compose und
  der Rest mit `pnpm dev`.

## 8. Erfolgskriterien

- Teilprojekt 0: `docker compose up` auf einem frischen Klon liefert eine erreichbare App mit grünem
  Health-Endpoint; `pnpm check` und `pnpm test` sind grün; CI läuft auf `main` grün.
- Je Teilprojekt: die in dessen Spec genannte Benutzerreise funktioniert im Browser, die Tests laufen ohne
  echte LLM-Aufrufe, die Definition-of-Done ist belegt.

## 9. Risiken

- **Umfang:** Open WebUI ist groß, und der Qualitätsanspruch erhöht den Aufwand je Teilprojekt. Gegenmittel:
  Teilprojekte mit klaren Grenzen, YAGNI-Streichliste in Abschnitt 1, Anforderungen nach Stufen (6.2).
- **Prompt Injection ist nicht vollständig lösbar.** Gegenmittel: Schadensbegrenzung nach 6.1 (geringste Rechte,
  Bestätigung, keine Kombination aus privaten Daten und Ausgangskanal), nicht Erkennung allein.
- **Sandbox für Nutzercode (Teilprojekt 8):** sicherheitskritisch und aufwendig. Gegenmittel: erst eingebaute
  Tools und MCP, Nutzercode erst nach eigenem Sicherheitsdesign.
- **Streaming-Protokoll:** Die Kopplung von Backend-SSE und `useChat` ist zu entscheiden (Teilprojekt 3).
- **Tool-Kompatibilität (Vitest+SWC mit Nest-Decorators):** in Teilprojekt 0 verifizieren, Rückfall auf Jest für `apps/api`.
- **Ressourcen für späteres Deployment:** siehe Teilprojekt 10; nichts davon blockiert die Entwicklung.
