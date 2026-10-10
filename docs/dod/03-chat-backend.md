### DoD: Teilprojekt 3a (Chat und Streaming, Backend)

- [x] Vertrag: DTOs in `chats.dto.ts`; `pnpm openapi` erzeugt `apps/api/openapi.json` und `apps/web/src/api/generated/**` mit den Chat-Routen (`/api/chats`, `/api/chats/{id}`, `/api/chats/{id}/stream`, `/api/chats/{id}/messages/{messageId}/regenerate`) und DTOs (`ChatDetailDto`, `ChatListDto`, `ChatSummaryDto`, `MessageDto`, `CreateChatDto`, `UpdateChatDto`, `StreamChatDto`); `git diff --stat` zeigte nur Zeilen, die dazukamen. Kein `userId` in einer Antwort (Test in `chats.db.spec.ts`).
- [x] Tests: `pnpm test` grün (36 Dateien, 474 API-Tests und 19 Dateien, 218 Web-Tests, dazu die Hook-Tests), `pnpm test:db` grün (22 Dateien, 267 Tests), `pnpm check` grün (Typen, ESLint, Prettier, dependency-cruiser ohne Verstoß). Auth und Not-Found je Controller (`chats.controller.spec.ts`, `chats.db.spec.ts`). Mutationsproben, jeweils rot gesehen:
  - Task 4: Kürzung des Verlaufs (`kept.shift`) abgeschaltet; die Probe aus dem Plan blieb grün, darum ein zusätzlicher Test (siehe Ledger-Urteil).
  - Task 5: Nutzerfilter in `getOwned` entfernt, Cursor `<` zu `<=`.
  - Task 6: Nutzerfilter in `loadPath` und `saveAssistant`, Rollenprüfung (je mehrere Tests rot).
  - Task 7: Abbruch-Signal, Freigabe des Stream-Platzes, Fehler-Teil, Leerlesen des zweiten Zweigs (jeweils rot).
  - Task 8: Schutz `AND title_source = …` im `UPDATE` (nur der zusätzliche Test „Umbenennung während der Modellanfrage" wird rot, der Test aus dem Plan blieb grün), Prüfung `!== 1` bei der Planung (Unit- und DB-Test rot).
  - Task 9: Titel ins Log geschrieben, der Log-Test wird rot.
- [x] Invarianten ([AGENTS.md](../../AGENTS.md) Abschnitt 2):
  - 1 (SQL auf `userId`): jede Abfrage in `chats.service.ts` und `message-tree.service.ts` trägt `userId`; fremde Chats, Nachrichten und `parentId` sind `404` (Tests, Mutationsproben Task 5 und 6).
  - 2 (Quellen): in diesem Teilprojekt gibt es keine Quellenangaben (Teilprojekt 4).
  - 4 (keine Inhalte in Logs): `chat-logs.db.spec.ts` mit Eindringling in Nachricht, System-Prompt, Antwort und Titel; Handprobe: 0 Treffer in den API-Logs.
  - 5 (Modell-IDs und Limits aus der Konfiguration): sieben `CHAT_*`-Variablen in `env.ts`, `.env.example` und `compose.yml`; Modell-IDs kommen aus der Verbindung des Nutzers.
  - 6 (Env nur über `env.ts`): pg-boss bekommt `DATABASE_URL` über `ConfigService`, kein neuer Zugriff auf `process.env`.
  - 7 und 7a (unvertraute Ausgabe): Anbietertext erreicht den Nutzer nie (fester Fehler-Teil `stream_failed`, `errorReason` aus dem Wörterbuch); Titel werden bereinigt und als Text gespeichert; keine privilegierte Aktion aufgrund von Modellausgabe. Der Titel-Job nutzt den vom Chat gewählten Anbieter über `ModelRegistryService` (dort `SafeFetchService`).
  - 9 (Migrationen): `1791625546492-add-chats.ts` mit `migration:generate` erzeugt (nur Leerraum durch Prettier geändert), in `entities.ts` und `migrations/index.ts` eingetragen.
  - 10 (Verify before deciding): `ai` 7.0.127 und pg-boss 12.36.0 gegen die installierten Typen und per Vertragstest (`ai-stream.contract.spec.ts`) geprüft; die Abweichungen von der Spec stehen in der Spec (Abschnitte 2, 6, 7).
- [x] Abhängigkeiten: neu nur `pg-boss` 12.36.0 (Node ≥ 22.12, im Repo Node 24); `pnpm audit --prod`: keine bekannten Schwachstellen (2026-10-10).
- [x] UI: nicht betroffen (Plan 3b).
- [x] Betrieb: `docker compose -p owui-probe up --build -d` mit frischer Datenbank, `node scripts/smoke.mjs http://localhost:8080` grün (inklusive der neuen Prüfungen „chat list needs a session" und „chat stream needs a session").
- [x] Docs: PLAN, BACKLOG, THREAT-MODEL, Spec 3 (Abschnitte 2, 6, 7, Status), Gesamt-Spec (offene Frage zum Streaming-Protokoll), README, [ADR 0004](../adr/0004-chat-streaming-protokoll.md) aktualisiert.
- [ ] Offen: Web (Plan 3b), siehe [BACKLOG](../BACKLOG.md).

Handprobe über Caddy (`http://localhost:8080`, Fake-Anbieter `scripts/fake-provider.mjs` auf dem Host, Anmeldung als Admin, Verbindung angelegt `201`):

1. `POST /api/chats` → `201`, Chat-ID.
2. `POST /api/chats/<id>/stream`: Status `200`, sechs Chunks, Ankunft nach 17, 25, 227, 429, 440 und 455 ms: sie kommen zeitlich versetzt an, Caddy puffert nicht.
3. Verbindung nach dem dritten Chunk getrennt: nach 1,5 s zeigt `GET /api/chats/<id>` die Antwort mit Status `aborted` und dem Teiltext „Hallo aus dem ".
4. Nach einer vollständigen Antwort wechselt der Titel auf den erzeugten (`titleSource: generated`, 27 Zeichen, Log `applied: true`).
5. Drei parallele Streams desselben Nutzers: `200`, `200`, `429`.
6. `docker compose -p owui-probe logs api`: 93 Zeilen, 0 Treffer auf die Probe-Nachricht und 0 auf den Antworttext; die Chat-Zeilen tragen nur IDs, Längen und Dauer.
7. `docker compose -p owui-probe down -v`: Container, Netze und Volume entfernt.

Die Probe fand keine Abweichung; deshalb gibt es keinen eigenen Fehlerbehebungs-Commit. Der Fake-Anbieter bekam vorher einstellbare Chunks und einen Abstand zwischen ihnen (Standard unverändert), damit das Streaming sichtbar ist.

Nicht oder nur teilweise geprüft:

- Verhalten bei einem echten Anbieter (Ollama, OpenAI-kompatibel): alles gegen `MockLanguageModelV4` und den Fake-Anbieter; das Titel-Modell ist das Chat-Modell.
- Wiederholung des Titel-Jobs nach einem Fehler: der echte pg-boss-Test (`pg-boss-job-queue.db.spec.ts`) belegt Zustellung und Wiederholung mit 1 s Verzögerung; der Ablauf „Modell scheitert, zweiter Versuch gelingt" ist nur mit der Fake-Warteschlange getestet.
- Mehrere API-Instanzen: Stream-Platzzähler und Rate Limit gelten je Prozess (Backlog).
- Zwei in den Läufen gesehene, nicht wieder aufgetretene Fehlschläge (`chat-stream.db.spec.ts` zweimal direkt nach Mutationsläufen, `users.db.spec.ts` einmal im Gesamtlauf); in etwa 60 weiteren Läufen nicht reproduzierbar, siehe Ledger-Notiz und Abschlussprüfung.

Aufräumen: das Compose-Projekt `owui-probe` samt Volume `owui-probe_pgdata` und der Fake-Anbieter-Prozess sind entfernt; Wegwerf-Schlüssel und Admin-Passwort der Probe standen nur in der Shell und in einer gelöschten Datei im Scratchpad.
