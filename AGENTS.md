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

| Befehl                                                   | Zweck                                                      |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm check`                                             | Typecheck, ESLint, Prettier-Check, dependency-cruiser      |
| `pnpm test`                                              | Vitest ohne Datenbank (inklusive HTTP-Tests mit Supertest) |
| `pnpm test:hooks`                                        | Tests der Hooks in `.claude/hooks` (Teil von `pnpm test`)  |
| `pnpm db:up` / `pnpm test:db`                            | Postgres für lokale DB-Tests starten / DB-Tests ausführen  |
| `pnpm openapi`                                           | OpenAPI erzeugen und Web-Client neu generieren             |
| `pnpm --filter @owui/api migration:generate <Pfad/Name>` | Migration aus Entity-Änderungen erzeugen                   |
| `pnpm --filter @owui/api migration:create <Pfad/Name>`   | leere Migration für Raw-SQL                                |
| `docker compose up --build`                              | gesamte App (Postgres, API, Web) auf http://localhost:8080 |
| `node scripts/smoke.mjs http://localhost:8080`           | Smoke-Test gegen die laufende App                          |

## 4. Arbeitsweise

- **Vor dem Code:** Umfang, Nicht-Umfang und der Befehl, der den Erfolg beweist, in wenigen Zeilen
  festhalten. Vertrag (DTO/Schema) zuerst, kleinster Diff, der besteht. Bei Fehlern in Logik beginnt
  die Korrektur mit einem Test, der den Fehler zeigt.
- **Git:** direkt auf `main`, kleine Commits (ein Thema), Conventional Commits, Imperativ.
  Husky-Hooks (`pnpm check`, Tests) nie mit `--no-verify` umgehen. `.env*` nie stagen. Nach einem Push
  `gh run list --branch main --limit 1` prüfen und rote CI vor neuer Arbeit beheben.
- **Testregeln:** Verhalten prüfen, nicht Markup oder Implementierung. Ein Verhalten steht in einem Test auf der
  untersten möglichen Ebene (Unit vor HTTP vor DB vor Browser). Jeder Test muss durch Mutation sterben
  können: Sicherheitsregeln (Nutzerbegrenzung, Rechte, Host-Prüfung) werden einmal abgeschaltet, um rote Tests
  zu sehen. Auth- und Not-Found-Tests bleiben pro Controller. Keine echten LLM- oder Netzwerkaufrufe in Tests.
- **Hooks in `.claude/hooks`** (mit eigenen Tests): Der Bash-Guard blockiert Force-Push, `--no-verify`, das
  Abschalten von Husky und Zugriffe auf Secret-Dateien; er prüft auch Heredoc-Text, also Dateiinhalte mit den
  Werkzeugen Write/Edit schreiben. Der Stop-Hook lässt dich erst fertig melden, wenn `pnpm check` für den
  aktuellen Stand grün ist (blockiert höchstens einmal pro Zug). Beide sind ein Sicherheitsnetz, kein Ersatz
  für Sorgfalt.
- **Abschluss je Plan:** DoD-Beleg unter `docs/dod/` nach der [Vorlage](docs/dod/TEMPLATE.md), im selben Commit
  wie die Docs-Änderungen.
- **Abhängigkeiten** dürfen ohne Rückfrage ergänzt werden: aktuelle Doku prüfen (Regel 10), Menge klein
  halten, Grund in die Commit-Nachricht. Neue Pakete mit Installationsskripten nur bewusst in
  `onlyBuiltDependencies` freigeben.
- **UI-Änderungen** werden im Browser angesehen (Konsole auf CSP-Verstöße prüfen), bevor sie als fertig
  gelten.
- Rückfragen an den Nutzer nur bei Umfang, Kosten, Datenschutz, Secrets oder nicht umkehrbaren Aktionen.
