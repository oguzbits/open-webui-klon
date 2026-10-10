# Teilprojekt 4: Wissenssammlungen und Hybrid-Suche (RAG)

Stand: 2026-10-10. Status: Entwurf zur Prüfung. Übergeordnet: [Gesamt-Spec](2026-10-09-open-webui-nestjs-design.md),
Abschnitt 4, Zeile 4. Aufbauend auf [Teilprojekt 2](2026-10-09-teilprojekt-2-modell-anbindung-design.md) (Verbindungen)
und [Teilprojekt 3](2026-10-10-teilprojekt-3-chat-streaming-design.md) (Chat, Job-Queue).

## 1. Ziel und Rahmen

Ein angemeldeter Nutzer legt Wissenssammlungen an, lädt Dokumente hoch (PDF, DOCX, Markdown, Text) und wählt pro Chat
eine oder mehrere Sammlungen. Das Modell antwortet mit Auszügen daraus; jede Antwort zeigt ihre Quellen, und
ausgewiesen wird nur, was der Server tatsächlich an das Modell gesendet hat.

**Entscheidungen aus der Klärung (2026-10-10):**

1. **Zugang:** Wissenssammlungen, pro Chat auswählbar. Kein Direktanhang an einzelnen Nachrichten (Backlog).
2. **Embeddings:** ein Embedding-Modell einer vorhandenen Verbindung (Ollama oder OpenAI-kompatibel), ID aus der
   Konfiguration (Invariante 5). Kein lokales Modell im API-Container.
3. **Sichtbarkeit:** nur der Besitzer. Teilen kommt mit dem Workspace (Teilprojekt 11).
4. **Dateien:** PDF, DOCX, Markdown, TXT, ohne OCR.
5. **Qualität:** kleine Eval-Harness (von Hand, nicht in CI).

**Erfolg ist belegbar:**

- Upload → Job → `ready`; derselbe Inhalt desselben Nutzers wird nie ein zweites Mal geparst oder eingebettet.
- Die Suche liefert nur Chunks des Nutzers aus den gewählten Sammlungen; Nutzer B erreicht nichts von Nutzer A (404
  bei Sammlungen, Dokumenten und über eine fremde `collectionId` im Chat).
- Ein Chat mit Sammlungen sendet nummerierte Auszüge als Daten an das Modell; ungültige Zitate (`[n]` außerhalb der
  gesendeten Nummern) werden serverseitig verworfen.
- Fällt das Parsen aus (zu groß, zu viele Seiten, kaputt, Zeitüberschreitung), steht das Dokument auf `failed` mit
  Grundcode, der Server läuft weiter.
- Keine Dokument- oder Chat-Inhalte in Logs oder in der Job-Tabelle.
- `pnpm check`, `pnpm test`, `pnpm test:db` grün; `scripts/smoke.mjs` deckt Upload und Suche ab; die Benutzerreise läuft
  im Browser ohne CSP-Meldung; `pnpm eval:rag` liefert hit@k und MRR.

**Nicht im Umfang:** OCR, Bilder, Web-Loader, Teilen, Reranker, ANN-Index, Neu-Einbetten bei Modellwechsel,
Query-Umschreibung, Direktanhang an Nachrichten, Dokumentvorschau, Ordner innerhalb von Sammlungen.

## 2. Geprüfte Grundlagen (Regel 10)

Stand 2026-10-10, geprüft in den installierten Typen, im Quellcode und in der npm-Registry.

| Thema | Befund | Sicherheit |
| ----- | ------ | ---------- |
| Embeddings im AI SDK | `embedMany({ model, values, maxParallelCalls, maxRetries, abortSignal })` → `{ embeddings, usage }`; teilt nach `maxEmbeddingsPerCall` selbst auf. `@ai-sdk/openai-compatible` 3.0.62: `createOpenAICompatible(...).embeddingModel(id)` (`textEmbeddingModel` veraltet), POST `{baseURL}/embeddings`. | aus Typen abgeleitet |
| Adapter heute | `ProviderAdapter` kennt nur `listModels` und `languageModel`; für Embeddings kommt `embeddingModel(target, id)` dazu, weiter über `providerFetch` (SafeFetch, Invariante 7). | sicher (Quellcode) |
| pgvector | 0.8.7 (Image in `compose.yml` und CI). `halfvec` ohne Dimension erlaubt; gemischte Dimensionen im Vergleich werfen einen Fehler; `<=>` ist Kosinus-Distanz; ohne Index exakte Suche. HNSW nur bis 4000 Dimensionen bei `halfvec`. | sicher (Quellcode `halfvec.c`, Doku) |
| TypeORM 1.1.1 | `vector` und `halfvec` im Postgres-Treiber; `tsvector` bekannt; erzeugte Spalten (`generatedType: 'STORED'`, `asExpression`) werden unterstützt. Verhalten von `migration:generate` bei `halfvec` ohne Länge und bei geänderten Ausdrücken **nicht per Lauf geprüft**. | aus Code abgeleitet; **offen** |
| PDF | `unpdf` 1.8.1 (MIT, ESM, Node ≥ 22, ohne Abhängigkeiten): `getDocumentProxy`, `extractText(pdf, { mergePages: false })` mit Seitentext und `totalPages`. Verworfen: `pdf-parse` (native Abhängigkeit). | sicher (Registry), API aus Typen |
| DOCX | `mammoth` 1.13.0 (BSD-2, CJS): `extractRawText({ buffer })`. | sicher (Registry), API aus Typen |
| Upload | `@nestjs/platform-express` bringt `multer` 2.4.0 mit; `FileInterceptor` mit `limits.fileSize` und `memoryStorage`. Kein Wechsel zu Fastify. | sicher |
| Magic Bytes | Eigene Prüfung statt `file-type`: PDF beginnt mit `%PDF-`, DOCX ist ZIP (`PK\x03\x04`) mit Eintrag `[Content_Types].xml` und `word/`, Text ist gültiges UTF-8 ohne NUL-Byte. | Entscheidung (YAGNI) |
| Parser-Isolation | `worker_threads` mit `resourceLimits.maxOldGenerationSizeMb`; Überschreitung meldet `ERR_WORKER_OUT_OF_MEMORY` (lokal belegt), `terminate()` für die Zeitgrenze. Die Worker-Datei muss als `.js` in `dist` liegen. | sicher (lokal), Build **offen** |

**Spike-Ergebnisse (Plan 4a, Task 1, 2026-10-10):**

- **(a) Migration:** `migration:generate` erzeugt gültiges SQL für `halfvec` ohne Länge (belegt). Eine gespeicherte erzeugte `tsvector`-Spalte (`generatedType: 'STORED'`) legt den Datenbanknamen in `typeorm_metadata` ab; in jeder Datenbank mit anderem Namen (Test: `owui_test`) meldet `migration:generate` danach dauerhaft einen Unterschied. Als Raw-SQL-Spalte scheitert der Schema-Vergleich, weil `typeorm_metadata` fehlt. Einen **GIN-Index** kann die Entity nicht ausdrücken (`IndexOptions` kennt kein `using`), und ein Raw-SQL-Index würde vom nächsten `migration:generate` gelöscht. Entscheidung: **weder gespeicherter Volltextvektor noch GIN-Index in 4a**; die Volltextsuche rechnet `to_tsvector('simple', content)` über die Chunks des Nutzers (Index `(user_id, document_id)`). Das genügt für die erwarteten Mengen; Spalte und GIN-Index stehen im Backlog, sobald eine Messung sie verlangt. Ein Test (`knowledge-schema.db.spec.ts`) belegt, dass die Migration und die Entities übereinstimmen.
- **(b) Embedding-Vertrag:** `createOpenAICompatible(...).embeddingModel(id)` schickt `POST {baseURL}/embeddings` mit `model` und `input` (Liste) über die übergebene `fetch`, Bearer-Schlüssel inklusive, und `embedMany` liefert die Vektoren in Eingabereihenfolge und `usage.tokens` (belegt in `models/embedding.contract.spec.ts`). Echtes Ollama bleibt offen bis zur Eval in Task 10.
- **(c) Worker:** Eine eigenständige `parse-worker.ts` (importiert nur Pakete) lädt unter Vitest direkt als `.ts` (Node-Typentfernung, Node ≥ 24 laut `engines`), und `nest build` legt `dist/knowledge/parse-worker.js` ab. Die Worker-URL wählt die Endung nach `import.meta.url`.
- **(d) Installationsskripte:** `pnpm add unpdf mammoth` löst keine blockierten Skripte aus; `allowBuilds` bleibt unverändert.

## 3. Daten

Neue Entities, einzutragen in `database/entities.ts` (Regel 9). Werte, die Logik steuern, stehen in Wörterbüchern.

- **`Document`**: `id`, `userId`, `sha256` (eindeutig je `userId`), `filename`, `mimeType` (aus dem Wörterbuch der
  vier erlaubten Typen, vom Server bestimmt, nicht vom Client), `sizeBytes`, `status`
  (`DOCUMENT_STATUS`: `pending`, `processing`, `ready`, `failed`), `failureReason`
  (`DOCUMENT_FAILURE`: `too_large`, `too_many_pages`, `unreadable`, `timeout`, `no_text`, `embedding_failed`),
  `storageKey` (UUID), `pageCount`, Zeitstempel.
- **`Collection`**: `id`, `userId`, `name`, Zeitstempel. Name je Nutzer eindeutig.
- **`CollectionDocument`**: `collectionId`, `documentId`; Löschen einer Sammlung entfernt nur die Zuordnung.
  Ein Dokument ohne Zuordnung bleibt in der Dokumentenliste des Nutzers erhalten und kann gelöscht werden.
- **`Chunk`**: `id`, `documentId`, `userId` (denormalisiert für das SQL-Filtern), `ordinal`, `content`, `page`
  (nullable), `embedding` (`halfvec` ohne feste Dimension), `embeddingModelId`, (kein gespeicherter
  Volltextvektor: die Suche rechnet `to_tsvector('simple', content)` in der Abfrage, siehe Abschnitt 2). **Kein ANN-Index** (Entscheidung A): Die exakte Suche ist
  auf Nutzer und Sammlungen begrenzt; HNSW steht im Backlog, bis eine Messung ihn verlangt.
- **`Chat.collectionIds`** (`uuid[]`, Standard leer) und **`Message.sources`** (`jsonb`, nullable, Liste aus
  `{ n, documentId, filename, page, excerpt }`). Beide sind Änderungen an Entities aus Teilprojekt 3.
- Löschen eines Nutzers oder Dokuments entfernt Chunks (Fremdschlüssel mit `ON DELETE CASCADE`) und die Datei.

## 4. Ingestion

Ablauf (jeder Schritt idempotent):

1. **Upload** (`POST /documents`, multipart, ein Feld `file`, optional `collectionId`): Größe gegen
   `RAG_UPLOAD_MAX_BYTES` (Multer-Limit, 413), Magic Bytes gegen die vier Typen (415), Quote
   `RAG_MAX_DOCUMENTS_PER_USER` (409). SHA-256 über den Inhalt. Existiert `(userId, sha256)` schon, wird nur die
   Zuordnung angelegt und das vorhandene Dokument zurückgegeben; sonst Datei über den `FileStorage` ablegen
   (Dateiname = UUID), `Document` mit `pending` anlegen, Job `ingest-document` mit `{ documentId }` senden.
2. **Job** (pg-boss, Wiederholungen begrenzt): Status `processing`; die Datei lesen; **Parsen in einem
   `worker_thread`** mit `RAG_PARSE_MEMORY_MB` und `RAG_PARSE_TIMEOUT_MS`; Seitenlimit `RAG_MAX_PAGES`. Ergebnis:
   Text je Seite (PDF) oder je Datei.
3. **Chunking**: eigener rekursiver Zerleger (Absatz, Zeile, Satz, Zeichen) mit `RAG_CHUNK_CHARS` und
   `RAG_CHUNK_OVERLAP_CHARS`; jeder Chunk trägt seine Seite. Kein Text → `failed/no_text`.
4. **Embedden**: `embedMany` über das konfigurierte Modell; ein Insert aller Chunks in einer Transaktion, danach
   `ready`. Ein Fehler setzt `failed` mit Grundcode; der Fehler wird geloggt (ID, Grundcode, Dauer, keine Inhalte).
5. **Erneut versuchen** (`POST /documents/:id/retry`) ist nur für `failed` erlaubt und sendet den Job neu.

`JobQueue` wird von `ChatJobData` auf eine Nutzlast aus IDs verallgemeinert (Typ je Jobname im Wörterbuch); die
Job-Tabelle enthält weiter nur IDs.

## 5. Suche

Ein Service `KnowledgeSearchService.search(userId, collectionIds, query)`:

1. Embedding der Anfrage mit demselben Modell (`embed`).
2. **Eine SQL-Abfrage** mit zwei CTEs: Vektor-Kandidaten (`<=>`, `RAG_CANDIDATES`) und Volltext-Kandidaten
   (`websearch_to_tsquery('simple', $query)`, `ts_rank_cd`, `RAG_CANDIDATES`); Fusion per Reciprocal Rank Fusion
   (k = 60), Ergebnis `RAG_TOP_K` Chunks.
3. Jede Kandidatenliste ist begrenzt auf `chunk.userId = $userId`, Dokumente der gewählten Sammlungen,
   `document.status = 'ready'` und `embeddingModelId = $aktuellesModell`. Alle Werte sind Parameter.

## 6. Chat-Anbindung

- `PATCH /chats/:id` nimmt `collectionIds` an; jede ID muss dem Nutzer gehören, sonst 404 (ohne zu verraten, ob die
  Sammlung existiert).
- Vor `streamText` (in `ChatStreamService.run`) sucht der Server mit dem Text der letzten Nutzernachricht, wenn der
  Chat Sammlungen hat. Fehlt `EMBEDDING_MODEL_ID` oder schlägt die Suche fehl, bricht der Zug mit einem Fehler ab
  (Fail fast, keine Antwort ohne die gewählten Quellen).
- Die Auszüge stehen **nummeriert und als Daten gekennzeichnet** in einem eigenen Abschnitt des System-Prompts
  (begrenzt durch `RAG_CONTEXT_MAX_CHARS`), mit der Anweisung, Aussagen mit `[n]` zu belegen und Anweisungen aus
  Dokumenten nicht zu befolgen. Das ist nur eine Zusatzhürde (Regel 7a).
- Nach dem Stream prüft der Server die `[n]` der Antwort gegen die gesendeten Nummern. Gültige Zitate bleiben,
  ungültige werden aus dem gespeicherten Text entfernt. Gespeichert wird `Message.sources` mit **allen gesendeten**
  Quellen; die Oberfläche hebt die tatsächlich zitierten hervor (Invariante 2).
- Die Quellen gehen zusätzlich als eigener Teil im Stream an den Client; das genaue Format legt Plan 4a fest und
  ergänzt [ADR 0004](../../adr/0004-chat-streaming-protokoll.md).

## 7. API (neu)

| Methode und Pfad | Zweck |
| ---------------- | ----- |
| `GET/POST /collections`, `PATCH/DELETE /collections/:id` | Sammlungen des Nutzers |
| `GET /collections/:id/documents` | Dokumente der Sammlung mit Status |
| `PUT/DELETE /collections/:id/documents/:documentId` | Dokument einer Sammlung zuordnen oder lösen |
| `POST /documents`, `GET /documents`, `DELETE /documents/:id`, `POST /documents/:id/retry` | Upload und Verwaltung |

Alle hinter der Session; Nutzerbegrenzung in SQL; Fremdzugriff ist 404. DTOs mit `whitelist` und
`forbidNonWhitelisted`; der generierte Client entsteht per `pnpm openapi`.

## 8. Konfiguration (alle über `config/env.ts`)

`EMBEDDING_MODEL_ID` (optional; ohne sie sind Upload, Sammlungen und Suche mit klarer Meldung nicht nutzbar),
`RAG_UPLOAD_MAX_BYTES` (20 MB), `RAG_MAX_DOCUMENTS_PER_USER` (200), `RAG_MAX_PAGES` (300),
`RAG_PARSE_TIMEOUT_MS` (60000), `RAG_PARSE_MEMORY_MB` (512), `RAG_CHUNK_CHARS` (1000),
`RAG_CHUNK_OVERLAP_CHARS` (150), `RAG_CANDIDATES` (30), `RAG_TOP_K` (6), `RAG_CONTEXT_MAX_CHARS` (12000).
Das Volume für Dateien (`FILE_STORAGE_PATH`) ist in `compose.yml` ein benanntes Volume.

## 9. Web (Plan 4b)

- Seite „Wissenssammlungen“: Liste, Anlegen, Umbenennen, Löschen; je Sammlung die Dokumentenliste mit Status
  (Polling über TanStack Query, solange etwas `pending` oder `processing` ist), Upload, Löschen, „Erneut versuchen“.
- Chat-Einstellungen: Auswahl der Sammlungen.
- Antwort: Quellen-Chips unter der Nachricht mit Dokumentname, Seite und Ausschnitt; zitierte Quellen hervorgehoben.
- Jede Ansicht kennt leer, laden, Fehler mit Retry und in Arbeit (Invariante 8); Texte nur über i18n, ohne
  „RAG“ oder „Embedding“ (Invariante 12). Quellenausschnitte werden als Text gerendert (Regel 7a).

## 10. Sicherheit

Aus dem [Threat Model](../../THREAT-MODEL.md) greifen: **Datei-Upload** (serverseitige Dateinamen, Magic Bytes,
Größen- und Seitenlimit, Parsen im Worker mit Speicher- und Zeitlimit; Downloads gibt es in diesem Teilprojekt
nicht), **vergiftete Dokumente und Prompt Injection** (Chunks tragen Besitzer und Herkunft, Suche in SQL begrenzt,
Inhalte als Daten markiert, kein HTML-Rendering, keine privilegierte Aktion aus Dokumentinhalt), **BOLA** (je Endpunkt
ein Test „Nutzer B erreicht Objekt von Nutzer A nicht“) und **Verbrauch** (Quoten, Limits). ClamAV bleibt im
Backlog.

## 11. Tests (unterste mögliche Ebene; je Schutz die Mutation, die ihn rot macht)

| Verhalten | Ebene | Mutation, die rot werden muss |
| --------- | ----- | ----------------------------- |
| Magic-Byte-Prüfung je Typ, falsche Endung/falscher Inhalt abgelehnt | Unit | Prüfung auf „immer gültig“ |
| Chunking: Größe, Überlappung, Seitenzuordnung | Unit | Überlappung 0, Seite verwerfen |
| RRF-Fusion und Zitat-Prüfung (`[n]` außerhalb entfernt) | Unit | Prüfung abschalten |
| Hash-Idempotenz: zweiter Upload erzeugt keinen Job und keine Chunks | HTTP + DB | Hash-Prüfung entfernen |
| Suche: nur eigener `userId`, nur gewählte Sammlungen, nur `ready`, nur aktuelles Modell | DB | je eine Bedingung aus dem SQL streichen |
| Fremdzugriff auf Sammlung, Dokument, `collectionIds` im Chat → 404 | HTTP | `userId` aus dem Filter nehmen |
| Parser: Zeit- und Speichergrenze liefern `failed/timeout` bzw. `unreadable`, Prozess bleibt | Integration (Worker) | Limit entfernen |
| Chat mit Sammlungen sendet nummerierte Auszüge als Daten; Fehler der Suche bricht den Zug ab | HTTP (Mock-Modell, Fake-Embedding) | Abbruch durch Ersatzdaten ersetzen |
| Keine Inhalte in Logs und Job-Tabelle | DB/Unit | Inhalt ins Log schreiben |
| Web: Statuspolling, Upload-Fehler, Auswahl, Quellen-Chips, alle Ansichtszustände | Komponenten + E2E-Probe | – |
| Eval-Harness: hit@k und MRR auf Fixtures (von Hand, echtes Modell) | Skript | – |

Keine echten Modell- oder Netzwerkaufrufe in Tests: Fake-Embeddings sind deterministisch (Hash des Textes auf
einen kleinen Vektor).

## 12. Zuschnitt

- **Plan 4a (Backend):** Entities und Migrationen, `FileStorage`, Upload, Job und Parser-Worker, Chunking,
  Embedding-Adapter, Suche, Chat-Anbindung mit Quellen, Eval-Harness, Smoke-Test, DoD.
- **Plan 4b (Web):** Seite Sammlungen, Upload und Status, Chat-Auswahl, Quellen-Chips, E2E-Probe, DoD.
- Format von Plan 4a: Verträge und Testfälle statt Volltext-Code (Versuch laut Notiz zum Planformat; Messwerte
  je Task im Ledger).

## 13. Backlog-Kandidaten aus dieser Spec

HNSW-Index nach Messung; Neu-Einbetten bei Modellwechsel; Direktanhang an Nachrichten; OCR, Bilder, Web-Loader;
Reranker; Query-Umschreibung; ClamAV; Teilen über den Workspace.
