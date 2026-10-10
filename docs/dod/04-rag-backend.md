### DoD: Teilprojekt 4a (RAG mit Hybrid-Suche, Backend)

- [x] Vertrag: DTOs in `knowledge.dto.ts` und `chats.dto.ts` (`collectionIds`, `MessageSourceDto`, `sources`); `pnpm openapi` erzeugt `apps/api/openapi.json` und `apps/web/src/api/generated/**` ohne Abweichung (`git status` danach sauber, geprüft nach dem letzten Code-Commit). Neue Routen: `/api/collections`, `/api/documents` samt Wiederholen und Löschen. Kein `userId` und kein `storageKey` in einer Antwort (Tests in `documents.db.spec.ts` und `collections.db.spec.ts`).
- [x] Tests: `pnpm test` grün (46 Dateien, 555 API-Tests und 35 Dateien, 400 Web-Tests, dazu die Hook-Tests), `pnpm test:db` grün (29 Dateien, 394 Tests), `pnpm check` grün (Typen, ESLint, Prettier, dependency-cruiser: 421 Module, kein Verstoß). Auth und Not-Found je Controller. Mutationsproben, jeweils rot gesehen:
  - Task 6 (Upload, 26): Nutzerfilter je Methode, `ON CONFLICT`, Quote, Aufräumen, Typprüfung, Größengrenze, Dateiname, `503`, Job-Daten.
  - Task 7 (Einlesen, 11 plus 5 im Korrekturdurchgang): Statusübergänge, Ersetzen der Chunks, Sperre in `store()`, Aufräumer, `RAG_MAX_CHUNKS`, Länge der Vektoren.
  - Task 8 (Suche, 13): Nutzerfilter, Sammlungsfilter, Modellfilter (`embedding_model_id`), Status `ready`, Zusammenführung (RRF), Grenzen.
  - Task 9 (Chat, 10 plus weitere): Besitzprüfung der Sammlungen, Escape im Prompt-Rahmen, `verifyCitations`, Nutzerfilter der Suche, Reihenfolge Suche/Speichern, Log-Inhalt, Freigabe des Stream-Platzes.
  - Korrekturdurchgang nach der Abschlussprüfung: jeder Test lief vor der Änderung rot (Leck in `pgboss.job.output` zuerst mit eigenem Text gesehen).
- [x] Invarianten ([AGENTS.md](../../AGENTS.md) Abschnitt 2):
  - 1 (SQL auf `userId`): jede Anweisung zu Sammlungen, Dokumenten, Chunks und Chat-Quellen trägt `user_id`; Ausnahme sind die Anweisungen des Einlese-Jobs, sie nutzen die vom Server vergebene Dokument-ID. Fremde IDs sind `404` (Tests, Mutationsproben Task 6, 8, 9).
  - 2 (Quellen): `verifyCitations` prüft die Quellen der Antwort gegen den an das Modell gesendeten Kontext (`knowledge-context.spec.ts`, `chat-knowledge.db.spec.ts`); Code und Links bleiben unangetastet.
  - 3 (Idempotenz): SHA-256 je Nutzer, Sperre und `ON CONFLICT DO NOTHING`; gleiche Datei gleichzeitig ergibt eine Zeile und einen Job (`documents.db.spec.ts`); das Einlesen ersetzt die Chunks in einer Transaktion (`ingestion.db.spec.ts`).
  - 4 (keine Inhalte in Logs): `ingestion.db.spec.ts` und `chat-knowledge-logs.db.spec.ts` mit Eindringling in Dateiname, Text und Frage. Nach der Abschlussprüfung auch die Job-Tabelle: Fehler des Jobs tragen nur den Namen (`pg-boss-job-queue.db.spec.ts`).
  - 5 (Modell-IDs und Limits aus der Konfiguration): `EMBEDDING_MODEL_ID` und die `RAG_*`-Variablen in `env.ts`, `.env.example` und `compose.yml`.
  - 6 (Env nur über `env.ts`): kein neuer Zugriff auf `process.env` außerhalb der erlaubten Einstiegspunkte (Prüfer und ESLint).
  - 7 und 7a: Einbettungen laufen über `providerFetch.createFetch` (`SafeFetchService`); Dokumenttext im Prompt steht in einem Rahmen mit maskiertem Markup und gilt als unvertraut; keine privilegierte Aktion aufgrund von Modellausgabe.
  - 9 (Migrationen): `migration:generate`, durch `knowledge-schema.db.spec.ts` gegen die Entities abgesichert, in `entities.ts` und `migrations/index.ts` eingetragen.
  - 10 (Verify before deciding): pgvector `halfvec` und `<=>`, pg-boss 12.36 (`findJobs`, Wiederholungsregel, Ablauf), AI SDK 7 `embedMany`, `unpdf` und `mammoth` gegen die installierten Typen oder Doku geprüft; Entscheidung A (kein ANN-Index, `halfvec` ohne feste Dimension) steht in der Spec.
- [x] Abhängigkeiten: `unpdf` und `mammoth` für die Texte aus PDF und DOCX, Grund in den Commit-Nachrichten. `pnpm audit --prod`: eine mittlere Meldung (`sprintf-js` über `mammoth>argparse`, keine behobene Version vorhanden); die Bibliothek lädt `argparse` nicht, nur das Kommandozeilenprogramm von `mammoth` nutzt es, und die CI bricht erst ab `high` ab (siehe [BACKLOG](../BACKLOG.md)).
- [x] UI: nicht betroffen (Plan 4b).
- [x] Betrieb: `docker compose -p owui-probe up --build -d` und `node scripts/smoke.mjs http://localhost:8080` grün, mit `SMOKE_*` auch die Prüfungen Hochladen → `ready` → Quellen im Start-Teil des Streams (Fake-Anbieter auf dem Host). Die Probe lief vor dem Korrekturdurchgang der Abschlussprüfung; dessen Änderungen sind durch die Testläufe oben belegt, nicht durch eine zweite Compose-Probe.
- [x] Docs: PLAN, BACKLOG, THREAT-MODEL, Spec-Status, [ADR 0004](../adr/0004-chat-streaming-protokoll.md) (Quellen im Stream) und die README der Auswertung aktualisiert.
- [ ] Offen: siehe [BACKLOG](../BACKLOG.md), darunter die kleinen Funde der Abschlussprüfung und der Aufgabenprüfungen. Web ist Plan 4b.

Abschlussprüfung des ganzen Zweigs durch einen unabhängigen Prüfer (stärkstes Modell): keine kritischen Funde, drei wichtige, alle behoben (Test zuerst rot, Commit `f80a1c9` und der folgende Commit zum Dateispeicher-Modul):

1. Der Aufräumer markierte Dokumente als fehlgeschlagen, deren Job nur in der Warteschlange stand (Jobs laufen einzeln, ein Stapel großer Dokumente wurde älter als 30 Minuten). Jetzt werden nur Dokumente ohne wartenden oder laufenden Job aufgeräumt (`JobQueue.hasLiveJob`).
2. pg-boss legte Fehler des Jobs samt Eigenschaften in `pgboss.job.output` ab; Fehler von Anbieter und Treiber tragen Anfragetexte (Dokument- und Chat-Text). Der Job-Wrapper gibt nur noch den Namen weiter.
3. Beim Löschen eines Nutzers blieben dessen Dateien auf der Platte. `UsersService.remove` entfernt sie nach dem Löschen (Fehler werden mit der Dokument-ID geloggt und brechen nichts ab).

Eine Folge von Punkt 3 fand der Lauf von `pnpm openapi`: Importierte `UsersModule` das ganze `KnowledgeModule`, wanderte die Reihenfolge der Routen in `openapi.json` und im erzeugten Client (Diff von über 2000 Zeilen). Deshalb gibt es ein kleines `FileStorageModule`, das beide nutzen; danach ist der Diff leer.

Handprobe über Caddy (Compose-Projekt `owui-probe`, Fake-Anbieter und Fake-Einbettung auf dem Host): Hochladen, Status `ready`, Frage im Chat mit Sammlung, Quellen im Start-Teil des Streams, Smoke-Test grün. Die Probe fand eine Abweichung: Mein Import `./fake-embedding.js` aus Task 4 brach `scripts/fake-provider.mjs` unter Node (Typen entfernen braucht `.ts`). Behoben mit `.ts`-Import und `rewriteRelativeImportExtensions` in `apps/api/tsconfig.json`.

Auswertung (`pnpm eval:rag`, von Hand, nicht in der CI): 9 Fragen über 4 erfundene Dokumente, mit der Fake-Einbettung (Hash, ohne Bedeutung) hit@1 56 %, hit@6 100 %, MRR 0,722. Das ist ein Funktionsbeleg der Auswertung, **keine Qualitätszahl**.

Nicht oder nur teilweise geprüft:

- Qualität der Suche mit einem echten Einbettungsmodell: auf diesem Rechner läuft kein Ollama, die Zahlen oben stammen von der Fake-Einbettung.
- Kein Browser: die Oberfläche kommt in Plan 4b.
- Qualität der Textauszüge von `unpdf` und `mammoth` mit echten, großen Dateien; Speicher des Parser-Workers außerhalb des V8-Heaps (ArrayBuffer) ist nicht gemessen.
- Suche ohne HNSW- und GIN-Index bei sehr vielen Chunks (Entscheidung A, im Backlog).
- Der Korrekturdurchgang nach der Abschlussprüfung hat keine zweite Compose-Probe bekommen.

Aufräumen: Compose-Projekt `owui-probe` samt Volumes entfernt, Wegwerf-Nutzer der Auswertung gelöscht (die Auswertung räumt sich selbst auf).
