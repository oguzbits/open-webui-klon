# Teilprojekt 3: Chat und Streaming

Stand: 2026-10-10. Status: Entwurf, wartet auf Freigabe. Übergeordnet:
[Gesamt-Spec](2026-10-09-open-webui-nestjs-design.md), Abschnitt 4, Zeile 3.

## 1. Ziel und Rahmen

Ein angemeldeter Nutzer chattet mit einem Modell aus [Teilprojekt 2](2026-10-09-teilprojekt-2-modell-anbindung-design.md)
und sieht die Antwort live. Er kann sie stoppen, neu erzeugen oder eine eigene Nachricht bearbeiten, wählt pro Chat
System-Prompt und Parameter und findet seine Chats über eine Liste mit Titelsuche wieder.

**Entscheidungen aus der Klärung (2026-10-10):**

1. **Zuschnitt:** Kern jetzt (Chats, Nachrichten-Baum, Streaming, Abbruch, Regenerieren, Bearbeiten, System-Prompt,
   Parameter, Titel-Job, Markdown/Code, Chatliste). **Ordner und Tags sind ein eigener Nachtrag (3c)** mit eigener
   Spec und eigenem Plan.
2. **Protokoll:** Backend streamt per POST-SSE im AI-SDK-UI-Message-Format, das Frontend nutzt `useChat`
   (`@ai-sdk/react`). Damit ist die offene Frage der Gesamt-Spec (Abschnitt 9) entschieden; der Grund steht in
   einem neuen ADR.
3. **Abbruch:** Die Teilantwort wird als `aborted` gespeichert. Es gibt kein Wiederaufnehmen nach Reload
   (Resumable Streams stehen im [Backlog](../../BACKLOG.md)).
4. **Chat-Inhalt:** System-Prompt und Parameter (Temperatur, `topP`, maximale Antwortlänge) pro Chat. Kein
   Teilen, kein Export.

**Erfolg ist belegbar:**

- Gegen ein Mock-Modell: Nachricht senden → Tokens kommen als Stream → Chat und Nachrichten stehen in der DB.
- Abbruch (Client trennt) bricht die Modellanfrage ab; die Teilantwort steht mit Status `aborted` in der DB.
- Regenerieren und Bearbeiten erzeugen Geschwister im Baum; der Ast-Wechsel stellt jeden Verlauf wieder her.
- Nutzer A erreicht weder Chats noch Nachrichten von Nutzer B (404), auch nicht über eine fremde `parentId`.
- Nach der ersten Antwort bekommt der Chat per pg-boss-Job einen Titel; fällt der Job aus, bleibt der sichtbare
  Rückfalltitel.
- Keine Chat-Inhalte in Logs oder in der Job-Tabelle.
- `pnpm check`, `pnpm test`, `pnpm test:db` sind grün; `scripts/smoke.mjs` deckt Senden und Streamen ab; die
  Benutzerreise läuft im Browser ohne CSP-Meldung.

**Nicht im Umfang:** Ordner, Tags (3c); Quellenangaben, Dokumente, Upload (4); Tools, Tool-Schritte im Stream (5);
Websuche (7); eigene Modelle und Prompt-Bibliothek (11); Memory (12); Quoten, Kostenbudget, Mehr-Knoten-Betrieb,
Resumable Streams (6 bzw. Backlog); Anhänge und Bilder in Nachrichten; Teilen und Export; Token-genaue
Kontextkürzung.

## 2. Geprüfte Grundlagen (Regel 10)

Stand 2026-10-10, geprüft in den installierten Typen (`ai` 7.0.127), der npm-Registry und der Referenz auf
ai-sdk.dev. Nicht online abrufbar waren die `useChat`-Doku und `pgboss.io/api`; dort gilt der Stand der
Typdateien.

| Thema | Befund | Sicherheit |
| ----- | ------ | ---------- |
| `streamText` | `streamText({ model, messages, system, abortSignal, maxOutputTokens, temperature, topP, timeout, ... })`; Callbacks `onEnd` (Alias `onFinish`), `onAbort`, `onError`, `onChunk`. Fehler laufen im Stream, sie werden nicht geworfen. | sicher |
| UI-Stream | `result.toUIMessageStreamResponse(options)` liefert eine Web-`Response`; für Express/Nest `result.pipeUIMessageStreamToResponse(res, options)`. Optionen u. a. `originalMessages`, `messageMetadata`, `onError`, `onEnd`, `consumeSseStream`. | sicher |
| Abbruch | `onAbort`-Event: `{ callId, steps, reason? }`; `result.text` lehnt bei Abbruch ab. Text des **unterbrochenen** Steps ist nicht dokumentiert. | **unsicher** → Vertragstest in Plan 3a, Task 1; Rückfall: Text selbst über `onChunk` puffern |
| Nutzung | `usage` (`inputTokens`, `outputTokens`, `totalTokens`) als `PromiseLike`; `totalUsage` ist veraltet. | sicher |
| Historie | `convertToModelMessages(uiMessages)` ist `async`. Wir bauen den Verlauf aus der DB und übergeben ihn nicht vom Client. | sicher |
| Mocks | `MockLanguageModelV4` aus `ai/test`, `simulateReadableStream` aus `ai` (in `ai/test` als veraltet markiert); `doStreamCalls` zum Prüfen. | sicher |
| `useChat` | `@ai-sdk/react` 4.0.140 (Peer `react ^19.2.1` ok zu `^19.3.0`, Node ≥ 22). `status`: `submitted`, `streaming`, `ready`, `error`; `stop()`, `regenerate()`, `setMessages`. In `apps/web` noch nicht installiert. | sicher |
| Transport | `DefaultChatTransport` kommt aus `ai`: Optionen `api`, `credentials`, `headers` (Objekt oder Funktion), `fetch`, `prepareSendMessagesRequest`. Standard sendet **alle** Nachrichten; mit `prepareSendMessagesRequest` senden wir nur `{ text, parentId }`. Verhalten von `regenerate({ messageId })` nur aus den Typen abgeleitet. | **teilweise unsicher** → Komponententest und Browserprobe in Plan 3b |
| pg-boss | 12.37.1, Node ≥ 22.12, ESM, `pg ^8.23.1`. `new PgBoss(connectionString)`, `start()`, `createQueue(name)`, `send(name, data, { retryLimit, retryDelay, retryBackoff })`, `work(name, options, handler)` (Handler bekommt ein **Array** von Jobs), `stop({ graceful, timeout })`. Schema-Name `pgboss` (Option `schema`). | sicher |
| pg-boss und TypeORM-Pool | Es gibt keinen dokumentierten Adapter für einen bestehenden `pg.Pool`. **Entscheidung:** pg-boss bekommt eine eigene Verbindung über `DATABASE_URL`, kleine Poolgröße. | sicher |

Zu prüfen im Plan 3a vor dem Einsatz: Node-Version des Repos gegen `engines`, `streamText` mit `abortSignal` und
dem Mock-Modell (Teiltext, `onAbort`, `onError`, `usage`).

## 3. Vergleich mit Open WebUI

Aus dem Gedächtnis, **in diesem Teilprojekt nicht gegen den Code geprüft**; als Anhaltspunkt, nicht als Vorgabe.

| Bereich | Open WebUI (ungeprüft) | Hier |
| ------- | ---------------------- | ---- |
| Verlauf | Nachrichtenbaum als JSON im Chat-Datensatz | eigene Tabelle `message` mit `parentId`; Pfad per SQL, Zugriff pro Nutzer in SQL |
| Streaming | Socket.IO-Ereignisse und SSE | nur POST-SSE im AI-SDK-Format |
| Verlauf vom Client | Client schickt den Verlauf mit | **abweichend:** Server baut den Verlauf aus der DB, Client schickt nur die neue Nachricht |
| Titel | Hintergrundaufruf nach der Antwort | pg-boss-Job, wiederholbar, ohne Inhalte in der Job-Tabelle |

## 4. Datenmodell

Neue Entities `chat` und `message` (Migration per `migration:generate`, Einträge in `entities.ts` und
`migrations/index.ts`). Wörterbücher als `export const X = {...} as const`:
`MESSAGE_ROLE` (`user`, `assistant`), `MESSAGE_STATUS` (`complete`, `aborted`, `error`),
`CHAT_TITLE_SOURCE` (`fallback`, `generated`, `user`).

**`chat`**

| Feld | Typ | Hinweis |
| ---- | --- | ------- |
| `id` | uuid | |
| `userId` | uuid | FK auf `user`, `ON DELETE CASCADE`; jede Abfrage filtert darauf |
| `title` | text, null | `null` bis zur ersten Nachricht, danach 1 bis 200 Zeichen |
| `titleSource` | text | `CHAT_TITLE_SOURCE`, CHECK-Constraint; schützt eine Umbenennung des Nutzers vor dem Job |
| `modelId` | text | volle Modell-ID aus Teilprojekt 2 (`<connectionId>:<rawModelId>`) |
| `systemPrompt` | text, null | höchstens `CHAT_SYSTEM_PROMPT_MAX_LENGTH` Zeichen |
| `params` | jsonb | `{ temperature?, topP?, maxOutputTokens? }`, Grenzen im DTO und serverseitig begrenzt |
| `activeLeafId` | uuid, null | Blatt des angezeigten Asts; FK auf `message`, `ON DELETE SET NULL` |
| `createdAt`, `updatedAt` | timestamptz | `updatedAt` steuert die Sortierung der Liste |

Index `(userId, updatedAt DESC, id DESC)` für die Liste (Keyset-Paginierung).

**`message`**

| Feld | Typ | Hinweis |
| ---- | --- | ------- |
| `id` | uuid | |
| `chatId` | uuid | FK auf `chat`, `ON DELETE CASCADE` |
| `parentId` | uuid, null | FK auf `message`, `ON DELETE CASCADE`; `null` = Wurzel (mehrere Wurzeln erlaubt) |
| `role` | text | `MESSAGE_ROLE`, CHECK |
| `parts` | jsonb | AI-SDK-`UIMessage`-Teile; in diesem Teilprojekt nur `text` |
| `status` | text | `MESSAGE_STATUS`, CHECK; Nutzernachrichten sind `complete` |
| `errorReason` | text, null | grobe Ursache aus dem Wörterbuch (`PROVIDER_ERROR`-Wert oder `internal`), nie Anbietertext |
| `modelId` | text, null | Modell, das diese Antwort erzeugt hat |
| `inputTokens`, `outputTokens` | int, null | aus `usage`, falls vorhanden |
| `createdAt` | timestamptz | Reihenfolge der Geschwister |

Index `(chatId, parentId)`. **Baumregeln** (im Service erzwungen und per Test belegt): `parentId` gehört zum
selben Chat; eine Nutzernachricht hängt an `null` oder an einer Antwort; eine Antwort hängt an einer
Nutzernachricht.

## 5. Schnittstellen

Alle Routen verlangen eine Session und sind in SQL auf `userId` der Session begrenzt; ein fremder oder
unbekannter Chat ist immer `404`. Die Routen stehen im Modul `chats`.

| Route | Zweck |
| ----- | ----- |
| `GET /chats?q=&cursor=&limit=` | Chatliste, neueste zuerst, Titelsuche per `ILIKE` mit maskierten Platzhaltern (`%`, `_`, `\`), Keyset-Cursor. Antwort: `{ items: [{ id, title, modelId, updatedAt }], nextCursor }` |
| `POST /chats` | Chat anlegen: `{ modelId, systemPrompt?, params? }`; die Modell-ID muss über `ModelRegistryService.resolve()` auflösbar sein |
| `GET /chats/:id` | Chat mit **allen** Nachrichten (flach, mit `parentId`) und `activeLeafId` |
| `PATCH /chats/:id` | `title` (setzt `titleSource` auf `user`), `modelId`, `systemPrompt`, `params`, `activeMessageId` |
| `DELETE /chats/:id` | Chat samt Nachrichten löschen |
| `POST /chats/:id/stream` | Nachricht senden und Antwort streamen: `{ parentId: uuid \| null, text }`. Bearbeiten ist dasselbe mit der `parentId` der bearbeiteten Nachricht |
| `POST /chats/:id/messages/:messageId/regenerate` | neuer Antwort-Ast zu einer vorhandenen Antwort (`messageId` muss eine Antwort dieses Chats sein) |

**Ast-Wechsel:** `PATCH` mit `activeMessageId` setzt `activeLeafId` auf das **neueste Blatt unterhalb** dieser
Nachricht (rekursive Abfrage in SQL). Der Client rechnet nicht selbst.

**Fehler** (Problem Details): `404` Chat, Nachricht oder Modell unbekannt, `409` Chat hat die Höchstzahl an
Nachrichten, `422` ungültige Eingabe, Text oder Kontext zu lang, `429` zu viele gleichzeitige Streams oder
Rate Limit. Beginnt der Stream erst, wenn die Prüfungen bestanden sind, sind das normale JSON-Fehler; Fehler
**im** Stream gehen als grober Fehler-Teil durch den Stream.

## 6. Streaming-Ablauf und Regeln

`POST /chats/:id/stream`:

1. Chat per `id` **und** `userId` laden; ein Stream-Platz pro Nutzer wird belegt (`429`, wenn
   `CHAT_MAX_CONCURRENT_STREAMS` erreicht ist; Zähler im Prozess, ausreichend für einen Knoten, Mehr-Knoten steht
   im Backlog). Der Platz wird in jedem Fall freigegeben (`finally`).
2. Modell über `ModelRegistryService.resolve(chat.modelId)` auflösen (`404`, wenn nicht mehr verfügbar).
3. In **einer Transaktion**: `parentId` prüfen (Baumregeln, gleicher Chat), Nutzernachricht speichern,
   `activeLeafId` und `updatedAt` setzen; bei der allerersten Nachricht den Rückfalltitel (erste 60 Zeichen,
   `titleSource = fallback`) setzen.
4. Verlauf aus der DB bauen: Pfad von der Wurzel bis zur neuen Nachricht (rekursive Abfrage), nur Nachrichten mit
   Status `complete` und `aborted`; auf `CHAT_CONTEXT_MAX_CHARS` Zeichen von hinten gekürzt, wobei die neue
   Nachricht immer bleibt (`422`, wenn sie allein zu lang ist). Zeichen statt Token ist bewusst (YAGNI, steht im
   Backlog).
5. `streamText` mit `system` (System-Prompt), `messages`, den Parametern **begrenzt** auf die Konfiguration
   (`maxOutputTokens` höchstens `CHAT_MAX_OUTPUT_TOKENS`) und `abortSignal` aus dem Schließen der Verbindung
   **und** `AbortSignal.timeout(CHAT_STREAM_MAX_DURATION_MS)`.
6. Antwort als UI-Message-Stream. Über die Metadaten des ersten Teils kennt der Client die Server-IDs der
   Nutzernachricht und der Antwort (die Antwort-ID wird vorab erzeugt), damit er die nächste `parentId` senden
   kann. Fehler im Stream gehen über `onError` als **grobe, feste Meldung** zum Client, nie als Anbietertext.
7. Am Ende wird die Antwort **genau einmal** gespeichert, und zwar in der Transaktion mit `activeLeafId`:
   `complete` bei Ende, `aborted` bei Abbruch (Teiltext, auch leer), `error` bei Fehler (Teiltext und
   `errorReason`). Token-Zahlen kommen aus `usage`, falls vorhanden. Der Stream wird auch bei getrenntem Client
   zu Ende gelesen (`consumeStream`), damit Speichern und Freigeben nie ausbleiben.
8. Nach `complete` wird das Ereignis `chat.message.completed` über `@nestjs/event-emitter` ausgelöst (Abschnitt 7).

**Regenerieren** nutzt dieselben Schritte 1, 2, 4 bis 8, ohne neue Nutzernachricht: der Verlauf endet bei der
Nutzernachricht, die Elternteil der alten Antwort ist.

**Logs:** nur `chatId`, `messageId`, Rolle, Längen, Dauer, Status, Token-Zahlen, `connectionId`. Nie Text,
System-Prompt oder Titel (Invariante 4). Ein Test prüft das mit einem Eindringling im Nachrichtentext.

**Unvertraute Ausgabe (Invariante 7a):** Modellausgabe wird als Text gespeichert und im Web nur als Markdown ohne
rohes HTML dargestellt (Abschnitt 8). Es gibt in diesem Teilprojekt keine privilegierte Aktion aufgrund von
Modellausgabe.

**Konfiguration** (`apps/api/src/config/env.ts`, Beispielwerte in `.env.example`):

| Variable | Standard | Bedeutung |
| -------- | -------- | --------- |
| `CHAT_MAX_CONCURRENT_STREAMS` | 2 | gleichzeitige Streams pro Nutzer |
| `CHAT_STREAM_MAX_DURATION_MS` | 300000 | Obergrenze je Stream |
| `CHAT_MESSAGE_MAX_LENGTH` | 20000 | Zeichen je Nutzernachricht |
| `CHAT_SYSTEM_PROMPT_MAX_LENGTH` | 4000 | Zeichen des System-Prompts |
| `CHAT_CONTEXT_MAX_CHARS` | 60000 | Zeichen des gesendeten Verlaufs |
| `CHAT_MAX_OUTPUT_TOKENS` | 4096 | Obergrenze der Antwortlänge |
| `CHAT_MAX_MESSAGES_PER_CHAT` | 1000 | Schutz vor unbegrenztem Wachstum |
| `CHAT_STREAM_RATE_LIMIT` | 30 je Minute | enges Rate Limit auf den Stream-Routen |

Modell-IDs stehen nie in der Konfiguration oder im Code; sie kommen aus der Verbindung des Nutzers (Invariante 5).

## 7. Titel-Job (`jobs`-Modul)

- Neues Modul `jobs` kapselt pg-boss hinter einem Injection-Token `JOB_QUEUE` (`send`, `work`); Tests tauschen es
  per `overrideProvider` gegen eine Fake-Warteschlange im Speicher. Start in `onApplicationBootstrap`, Stop mit
  `stop({ graceful: true })` im Shutdown. Eigene Verbindung über `DATABASE_URL`, kleiner Pool.
- Das Ereignis `chat.message.completed` stellt `chat.generate-title` mit **nur** `{ chatId }` in die Queue, aber
  nur wenn `titleSource = fallback` und es die erste fertige Antwort ist. `retryLimit: 2` mit Backoff.
  Inhalte stehen nie in der Job-Tabelle.
- Der Worker lädt erste Nutzernachricht und erste Antwort (gekürzt), ruft `generateText` mit dem Modell des Chats
  (`maxOutputTokens` klein, Anweisung: kurzer Titel, nur Text) und bereinigt die Ausgabe: erste Zeile, Anführungs-
  und Markdownzeichen weg, höchstens 80 Zeichen. Ist das Ergebnis leer, wird geworfen (pg-boss wiederholt).
- Gespeichert wird per `UPDATE ... WHERE id = $1 AND "titleSource" = 'fallback'`. Eine Umbenennung des Nutzers
  gewinnt damit immer, auch wenn der Job später fertig wird.
- Scheitert der Job nach allen Wiederholungen, bleibt der **Rückfalltitel**. Das ist eine dokumentierte,
  sichtbare Standardeinstellung des Produkts (der Titel ist erkennbar der Anfang der Nachricht) und kein stilles
  Schlucken: der Fehler wird mit `chatId` und Ursache geloggt und steht im pg-boss-Status.
- Der erzeugte Titel ist unvertraut (kann Injection enthalten) und wird überall nur als Text angezeigt.

## 8. Web (`apps/web`)

- Neue Feature-Gruppe `features/chats`, Seiten `/chats` (leerer Zustand, neuer Chat) und `/chats/:id`; die
  Chatliste mit Suche steht in der Seitenleiste.
- **Server-Zustand** (Chatliste, Chat mit Nachrichten, `PATCH`, `DELETE`) über TanStack Query und den generierten
  Client (`pnpm openapi`). **Eine bewusste Ausnahme:** der Stream-Aufruf geht über den `useChat`-Transport und
  nicht über den generierten Client, weil `apiFetch` die Antwort puffert. Die Typen des Bodys kommen aus dem
  generierten Client.
- **Transport:** `DefaultChatTransport` mit `credentials: 'include'`, Header `X-CSRF-Token` (aus `session-state`),
  `traceparent`, und `prepareSendMessagesRequest`, das nur `{ text, parentId }` sendet. Eine `401`-Antwort ruft
  `notifyUnauthorized()` wie `apiFetch`.
- **Ansicht:** Nachrichtenliste des aktiven Asts; Eingabe mit Senden und Stop; pro Nachricht Regenerieren
  (Antworten), Bearbeiten (Nutzer) und der Ast-Umschalter „‹ 2/3 ›" bei Geschwistern; Modellauswahl über
  `useModels()` (aus Teilprojekt 2); Einstellungen für System-Prompt und Parameter; Hinweis am Modell, bei
  welchem Anbieter der Chat läuft (Datenschutz-Zeile der Gesamt-Spec). Abgebrochene und fehlerhafte Antworten
  tragen einen sichtbaren Hinweis.
- **Markdown:** `react-markdown` mit `remark-gfm`, Code-Hervorhebung, Kopieren-Knopf. **Kein rohes HTML.** Links nur
  `http`, `https`, `mailto`, mit `rel="noopener noreferrer"`. **Bilder aus Markdown werden nicht geladen**
  (sonst könnte eine Prompt Injection Daten über eine Bild-URL ausleiten); sie erscheinen als Link-Text.
  Bibliotheken und ihre Optionen werden im Plan 3b gegen die aktuelle Doku geprüft.
- **Zustände** (Invariante 8): Chatliste und Chatansicht kennen leer, laden, Fehler mit Retry; Senden, Regenerieren
  und Löschen sind während der Anfrage gesperrt (kein Doppel-Submit); `useChat`-`status` steuert die Knöpfe.
- Texte nur über i18n-Schlüssel (Deutsch), ohne Fachbegriffe; semantische Tokens, keine Palettenfarben.

## 9. Sicherheit und Bedrohungsmodell

Ergänzungen für [THREAT-MODEL.md](../../THREAT-MODEL.md) im selben Commit wie die Umsetzung:

| Risiko | Maßnahme |
| ------ | -------- |
| Zugriff auf fremde Chats (IDOR) | jede Abfrage in SQL mit `userId`; fremde `parentId` und fremde `messageId` sind `404` |
| Daten-Ausleitung über Markdown (Bilder, Links) | Bilder nicht laden, Links nur mit festen Schemata |
| Übermäßiger Verbrauch | Limits für Stream-Dauer, Antwortlänge, Nachrichtenlänge, Kontext, Nachrichtenzahl, gleichzeitige Streams, Rate Limit |
| Hängende Streams / Ressourcenleck | `abortSignal` aus Verbindung und Timeout, `finally` gibt den Platz frei, `consumeStream` |
| Inhalte in Logs oder Job-Tabelle | nur IDs und Zahlen; Job trägt nur `chatId`; Log-Test |
| Fehlertext des Anbieters beim Nutzer | grobe, feste Fehlermeldung im Stream; `errorReason` aus dem Wörterbuch |
| Prompt Injection im Titel | Titel wird bereinigt gekürzt und nur als Text angezeigt |
| Umbenennung wird überschrieben | bedingtes `UPDATE` auf `titleSource` |

## 10. Tests

Keine echten LLM-Aufrufe: `MockLanguageModelV4` mit `simulateReadableStream` über `overrideProvider` für
`ModelRegistryService`. Die Fake-Warteschlange ersetzt pg-boss in allen Tests außer einem eigenen Integrationstest.

- **Unit:** Baumregeln und Verlaufsaufbau (Pfad, Kürzung, neue Nachricht bleibt), Titelbereinigung (Tabelle),
  Cursor, `ILIKE`-Maskierung, Parameterbegrenzung, Stream-Platzzähler.
- **HTTP (Supertest, ohne DB):** `401` ohne Session, `404` für fremden Chat, `422` bei zu langem Text und bei
  ungültigen Parametern, `429` bei Platzlimit, Streamformat (Teile, Metadaten mit IDs), grober Fehler im Stream,
  Fehlertext des Anbieters taucht nicht auf.
- **Abbruch:** Client trennt mitten im Stream → Modell-`abortSignal` ist gesetzt, Antwort mit Status `aborted`
  und Teiltext gespeichert, Platz frei. Stream-Timeout ebenso.
- **DB-Tests:** Migration, CHECK-Constraints, Kaskaden (Nutzer → Chat → Nachricht), Index-Nutzung der Liste,
  Keyset-Paginierung, rekursive Abfrage für Pfad und neuestes Blatt, Transaktion (Nutzernachricht ohne Antwort
  bleibt konsistent), **Nutzer A sieht nie Daten von Nutzer B** (Chats, Nachrichten, Suche).
- **Titel:** Job setzt Titel bei `fallback`, überschreibt keinen Nutzertitel, Wiederholung bei leerem Ergebnis,
  Rückfalltitel nach Scheitern, Job-Daten enthalten nur `chatId`. Ein Integrationstest startet echtes pg-boss
  gegen die Test-DB.
- **Log-Test:** Nachricht, System-Prompt und Titel erscheinen in keiner Logzeile.
- **Web:** Zustände (leer, laden, Fehler mit Retry, in Arbeit), Transport sendet nur `{ text, parentId }` samt
  CSRF-Header, Stop-Knopf, Ast-Umschalter, Markdown ohne HTML, ohne Bilder, Linkschemata. Danach Sicht im Browser
  mit einem Mock-Anbieter und Konsole auf CSP-Meldungen prüfen.
- **Mutation:** Wer den `userId`-Filter, die Parent-Prüfung, die Platzfreigabe oder das Bild-Verbot entfernt, sieht
  rote Tests.
- Optional und manuell, nicht in der CI: Handprobe gegen ein echtes Ollama.

## 11. Aufteilung in Pläne

1. **3a Backend:** Abhängigkeiten (`pg-boss`; zuerst Vertragstest für `streamText` mit Abbruch gegen den Mock),
   Env, `jobs`-Modul, Entities und Migration, Chat- und Nachrichten-Service, Controller, Streaming,
   Regenerieren, Titel-Job, Tests, Smoke-Test.
2. **3b Web:** Client neu erzeugen, `@ai-sdk/react`, Markdown-Bausteine, Seiten, Transport, i18n,
   Browser-Prüfung.

Jeder Plan endet mit Beleg unter `docs/dod/` nach dem Muster von [DoD 00](../../dod/00-fundament.md). Im selben
Commit wie die Umsetzung werden aktualisiert: [PLAN.md](../../PLAN.md), [BACKLOG.md](../../BACKLOG.md),
[THREAT-MODEL.md](../../THREAT-MODEL.md), die offene Frage in Abschnitt 9 der Gesamt-Spec und ein neuer ADR zum
Streaming-Protokoll.

## 12. Backlog-Einträge aus diesem Entwurf

Resumable Streams; Ordner und Tags (3c); tokengenaue Kontextkürzung und Zusammenfassung langer Verläufe;
Stream-Platzzähler über mehrere Knoten; Volltextsuche in Nachrichten (nur der Titel ist durchsuchbar);
Titel-Modell getrennt vom Chat-Modell; Audit-Einträge für das Löschen von Chats.
