# Teilprojekt 2: Modell-Anbindung

Stand: 2026-10-09. Status: zur Prüfung durch Oguz. Übergeordnet:
[Gesamt-Spec](2026-10-09-open-webui-nestjs-design.md), Abschnitt 4, Zeile 2.

## 1. Ziel und Rahmen

Admins hinterlegen Verbindungen zu Ollama oder zu einem OpenAI-kompatiblen Endpoint. Angemeldete Nutzer sehen,
welche Modelle es gibt und bei welchem Anbieter sie laufen. Das Backend kann für jedes Modell ein
AI-SDK-`LanguageModel` liefern; der Chat (Teilprojekt 3) nutzt es. Teilprojekt 2 erzeugt selbst keinen Text.

**Entscheidungen aus der Klärung (2026-10-09):**

1. **Keine Gruppensperre.** Jede Verbindung hat nur das Flag „aktiv" und gilt für alle angemeldeten Nutzer. Die
   Gesamt-Spec nennt „Admin kann Anbieter pro Gruppe sperren" als Datenschutzmaßnahme; Gruppen gehören aber zu
   Teilprojekt 9. Die Sperre steht im [Backlog](../../BACKLOG.md). Als Ersatz sieht jeder Nutzer, zu welchem
   Anbieter ein Modell gehört.
2. **Modellliste live.** Das Backend fragt die Verbindung ab und cacht die Antwort kurz im Speicher. Die DB
   spiegelt keine Modelle. Der Admin kann einzelne Modelle ausblenden.
3. **Private Hosts nur per Deployment.** Welche privaten Hosts eine Verbindung ansprechen darf, steht in der
   Env-Variable `PROVIDER_ALLOWED_HOSTS`, nicht in der Datenbank.
4. **Kein Generierungs-Endpoint.** Nur Verbindungen, „Verbindung testen", Modellliste und der interne Aufruf
   `ModelRegistryService.resolve()`.

**Erfolg ist belegbar:**

- Ein Admin legt gegen einen Fake-Anbieter (Ollama- und OpenAI-Format) eine Verbindung an, testet sie und sieht
  die Modelle; ein Nutzer sieht dieselben Modelle ohne ausgeblendete.
- Kein API-Key erscheint in einer Antwort, einem Log, einem Audit-Eintrag oder im Klartext in der DB.
- Ein Host, der nicht erlaubt ist, wird beim Speichern **und** bei jedem Abruf abgelehnt (auch nach DNS-Wechsel).
- Fällt eine Verbindung aus, erscheint sie mit Ursache in der Antwort, ohne die anderen zu blockieren.
- `pnpm check`, `pnpm test`, `pnpm test:db` sind grün; `scripts/smoke.mjs` deckt den Pfad ab.

**Nicht im Umfang:** Generierung und Streaming (3), Gruppensperre und ACL (9), Circuit Breaker, Quoten,
Kostenbudget (6), Sync-Job für Modelle, eigene Modelle und System-Prompts (11), Embedding-Modelle (4),
Ollama-spezifische Optionen wie `num_ctx` (Backlog), Rotation der Schlüssel als Job (Format ist vorbereitet).

## 2. Geprüfte Grundlagen (Regel 10)

Stand 2026-10-09, geprüft über npm-Registry, Paketquellen und Doku.

| Thema                | Befund                                                                                                                                                                  | Sicherheit |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `ai`                 | 7.0.137, Peer `zod ^3.25.76 \|\| ^4.1.8`. Typ `LanguageModel` enthält `LanguageModelV4`.                                                                                | sicher     |
| OpenAI-kompatibel    | `@ai-sdk/openai-compatible` 3.0.67. `createOpenAICompatible({ name, baseURL, apiKey?, headers?, fetch? })`; `provider.languageModel(id)` liefert `LanguageModelV4`.      | sicher     |
| Eigener `fetch`      | `createOpenAICompatible` akzeptiert `fetch` (Doku: Middleware oder Test). Damit lässt sich jeder Anbieteraufruf durch unseren Dienst leiten (Regel 7).                    | sicher     |
| Ollama-Provider      | Es gibt keinen offiziellen. Community: `ollama-ai-provider-v2` 4.0.1 (Peer `ai ^7`), `ai-sdk-ollama` 4.4.0. **Entscheidung:** nicht nutzen, Ollama läuft über `/v1`.     | sicher     |
| Mocks                | `import { MockLanguageModelV4 } from 'ai/test'`; `simulateReadableStream` kommt aus `'ai'`. Kein `MockLanguageModelV2` in ai 7.                                          | sicher     |
| Ollama `/api/tags`   | `{ models: [{ name, model, modified_at, size, digest, details: { family, parameter_size, quantization_level, ... } }] }`                                                 | sicher     |
| OpenAI `/v1/models`  | `{ object: 'list', data: [{ id, object, created, owned_by }] }` (Ollama liefert dasselbe Format unter `/v1/models`)                                                       | sicher     |
| Node-/ESM-Verträglichkeit von `ai` 7 mit dem API-Build | Nicht geprüft. Der Plan prüft es als ersten Schritt (Installation, Typecheck, ein Import im Test).                                       | **unsicher** |

**Folge für Ollama:** Ollama wird für die Generierung über `createOpenAICompatible` mit `baseURL = <url>/v1`
angesprochen. Das spart ein Community-Paket und hat dieselbe `fetch`-Anbindung. Die Modellliste kommt weiter von
`/api/tags` (mehr Metadaten, zum Beispiel Größe). Preis: Ollama-eigene Optionen (Kontextlänge, `keep_alive`) sind
über `/v1` nicht erreichbar; das steht im Backlog.

## 3. Vergleich mit Open WebUI

Aus dem Gedächtnis, **in diesem Teilprojekt nicht gegen den Code geprüft**; als Anhaltspunkt, nicht als Vorgabe.

| Bereich           | Open WebUI (ungeprüft)                                              | Hier                                                                 |
| ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Verbindungen      | mehrere Ollama- und OpenAI-URLs mit Key in den Admin-Einstellungen  | gleich, als Tabelle `provider_connection`; Keys verschlüsselt         |
| Modellfilter      | Liste erlaubter Modelle je Verbindung                               | Ausblend-Liste je Verbindung (neue Modelle erscheinen von selbst)     |
| Zugriff auf Modelle | Gruppen und Rechte                                                | alle angemeldeten Nutzer (Entscheidung 1)                             |
| Netzwerk          | Server ruft die URL ohne Sperrliste auf                             | **abweichend:** Host-Prüfung und angeheftete IP (Abschnitt 6)         |

## 4. Datenmodell

Neue Entity `provider_connection` (Migration per `migration:generate`, Eintrag in `entities.ts` und
`migrations/index.ts`).

| Feld               | Typ          | Hinweis                                                                         |
| ------------------ | ------------ | ------------------------------------------------------------------------------- |
| `id`               | uuid         |                                                                                 |
| `name`             | text         | eindeutig (Unique-Index), 1 bis 80 Zeichen                                      |
| `type`             | text         | `PROVIDER_TYPE`: `ollama` oder `openai_compatible`; CHECK-Constraint            |
| `baseUrl`          | text         | ohne abschließenden `/`, ohne Zugangsdaten, `http` oder `https`                 |
| `apiKeyCiphertext` | text, null   | Format `v1.<keyId>.<iv>.<ciphertext+tag>` (Base64url)                           |
| `enabled`          | boolean      | Standard `true`                                                                 |
| `hiddenModelIds`   | text[]       | rohe Modell-IDs des Anbieters, Standard leer                                    |
| `createdAt`, `updatedAt` | timestamptz |                                                                             |

**Verschlüsselung:** AES-256-GCM, zufälliger 12-Byte-IV pro Wert, `keyId` und Verbindungs-`id` als zusätzliche
authentifizierte Daten (ein Ciphertext lässt sich nicht in eine andere Zeile kopieren). Hauptschlüssel kommen
aus `PROVIDER_KEY_ENCRYPTION_KEYS` als Liste `keyId:base64(32 Byte)`. Der erste Eintrag verschlüsselt, alle
entschlüsseln. Rotation heißt: neuen Schlüssel an den Anfang stellen, alte Werte bleiben lesbar. Ein Job, der
alte Werte neu verschlüsselt, ist nicht Teil dieses Teilprojekts.

## 5. Schnittstellen

Alle Routen verlangen eine Session; `/admin/...` zusätzlich die Rolle `admin` und lehnt API-Keys ab (wie in
[Teilprojekt 1](2026-10-09-teilprojekt-1-auth-design.md)).

| Route                                             | Wer          | Zweck                                                                                       |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| `GET /models`                                     | `user`, `admin` | Modelle aktiver Verbindungen ohne ausgeblendete, plus `unavailableConnections`           |
| `GET /admin/provider-connections`                 | `admin`      | Verbindungen, `hasApiKey` statt Key                                                         |
| `POST /admin/provider-connections`                | `admin`      | anlegen                                                                                     |
| `PATCH /admin/provider-connections/:id`           | `admin`      | ändern; Key: Feld fehlt = unverändert, `null` = löschen, String = ersetzen                  |
| `DELETE /admin/provider-connections/:id`          | `admin`      | löschen                                                                                     |
| `POST /admin/provider-connections/:id/test`       | `admin`      | Modellliste abrufen; Antwort: `ok` und Anzahl, sonst Fehlerursache                          |
| `GET /admin/provider-connections/:id/models`      | `admin`      | alle Modelle der Verbindung inklusive ausgeblendeter (`hidden: boolean`)                    |

**Modell-ID nach außen:** `<connectionId>:<rawModelId>`. Beim Zerlegen wird am **ersten** `:` geteilt, denn
Ollama-IDs enthalten selbst `:` (`llama3:8b`). `connectionId` ist eine UUID und enthält keinen Doppelpunkt.

**`GET /models`, Antwort:**
`{ models: [{ id, name, connectionId, providerName, providerType }], unavailableConnections: [{ id, name, reason }] }`.
`reason` stammt aus dem Wörterbuch `PROVIDER_ERROR` (`timeout`, `unreachable`, `unauthorized`, `bad_response`,
`blocked_host`). Antworttexte des Anbieters werden nie weitergereicht.

**Fehler** (Problem Details): `404` unbekannte Verbindung oder Modell, `409` Name vergeben, `422` ungültige URL
oder nicht erlaubter Host, `502` beim Test, wenn der Anbieter nicht antwortet (mit `reason`).

## 6. Regeln und Komponenten

**Services (`apps/api/src/models`):**

- `ProviderConnectionsService`: CRUD, Host-Prüfung, Ver- und Entschlüsselung, Audit. Controller bleiben dünn.
- `ProviderAdapter` je Typ hinter dem Token `PROVIDER_ADAPTERS`: `listModels(connection)` und
  `languageModel(connection, rawModelId)`. `ollama`: Liste von `/api/tags`, Modell über `/v1`.
  `openai_compatible`: Liste von `/models` unter der Basis-URL, Modell über `createOpenAICompatible`.
- `ModelRegistryService`: `list()` fragt alle aktiven Verbindungen parallel ab (Timeout je Verbindung) und
  sammelt Fehler in `unavailableConnections`; `resolve(modelId)` prüft Verbindung aktiv, Modell nicht
  ausgeblendet, und gibt `{ model: LanguageModel, connection, rawModelId }` zurück. Cache im Speicher je
  Verbindung, TTL `MODEL_LIST_CACHE_TTL_MS`; Änderung oder Löschen einer Verbindung verwirft ihren Eintrag.
  Fehlschläge werden nicht gecacht.
- Verschlüsselung als eigener kleiner Dienst (`SecretBox`) mit reinen Funktionen, einzeln testbar.

**Ausgehende Aufrufe (Invariante 7).** Der vorhandene `SafeFetchService` kann nur GET, ohne Header, mit
gepufferter Antwort und Content-Type-Liste; für Anbieter reicht das nicht (Bearer-Key, später POST und Stream).
Darum kommt in `apps/api/src/http/safe-fetch` ein zweiter Dienst, `ProviderFetchService`, der eine
`fetch`-kompatible Funktion je Verbindung liefert. Sie wird an `createOpenAICompatible` übergeben und von den
Adaptern für die Listen genutzt. Eigenschaften:

- Nur `http`/`https`, keine Zugangsdaten in der URL, **Ursprung muss dem der Verbindung entsprechen** (kein
  Wechsel auf einen anderen Host).
- Eigene DNS-Auflösung, **jede** aufgelöste Adresse wird geprüft, Verbindung an die geprüfte IP angeheftet
  (kein zweites Auflösen), bei jedem Aufruf, nicht nur beim Speichern.
- Adressrichtlinie: Host steht auf `PROVIDER_ALLOWED_HOSTS` (Host oder Host:Port) → private Adressen und
  Loopback erlaubt; sonst nur öffentliche Adressen (bestehende `isPublicAddress`). Immer gesperrt, auch für
  Hosts auf der Liste: Link-Local inkl. Cloud-Metadaten `169.254.0.0/16`, `fe80::/10`, unspezifizierte und
  Multicast-Adressen.
- **Keine Weiterleitungen:** Antwort 3xx ist ein Fehler (`bad_response`). So kann kein Key an einen anderen Host
  gehen.
- Timeouts (`PROVIDER_REQUEST_TIMEOUT_MS`), Größenlimit für nicht gestreamte Antworten (Modellliste),
  Content-Type `application/json` für Listen. Streams werden unverändert durchgereicht; Limits dafür gehören in
  Teilprojekt 3.
- Der Dienst ist der einzige Ort in `src`, der `undici` für Anbieter nutzt (ESLint-Regel bleibt).

**Weitere Regeln:**

- Fail fast: Fehler werden als `PROVIDER_ERROR` ausgegeben, nie als leere Liste. `unavailableConnections` ist
  die sichtbare Antwort, kein stilles `catch`.
- Logs: nur Verbindungs-ID, Typ, Status, Dauer, Anzahl Modelle. Keine URLs mit Query, keine Keys, keine
  Anbieter-Antworttexte. `pino redact` für `apiKey`, `apiKeyCiphertext` und `authorization`.
- Audit-Aktionen im Wörterbuch `AUDIT_ACTION`: `PROVIDER_CONNECTION_CREATED`, `_UPDATED`, `_DELETED`. Metadaten:
  ID, Name, Namen der geänderten Felder; nie Key oder Ciphertext.
- `POST .../test` bekommt ein enges Rate Limit (Admin kann sonst Portscans über Fehlerursachen betreiben, die
  Ursachen sind deshalb grob).
- Env (`apps/api/src/config/env.ts`, mit Beispielwerten in `.env.example`):
  `PROVIDER_KEY_ENCRYPTION_KEYS` (Pflicht; Entwicklungswert in `.env.example` klar als solcher markiert),
  `PROVIDER_ALLOWED_HOSTS` (Standard leer; Entwicklungsbeispiel `host.docker.internal,ollama`),
  `MODEL_LIST_CACHE_TTL_MS` (Standard 30000), `PROVIDER_REQUEST_TIMEOUT_MS` (Standard 10000).
- Abhängigkeiten (Grund in der Commit-Nachricht): `ai` 7.x (Typen, Mock im Test, ab Teilprojekt 3 genutzt) und
  `@ai-sdk/openai-compatible` 3.x; `zod` als Peer, falls nicht vorhanden.

## 7. Web (`apps/web`)

- **Admin-Seite „Modell-Anbindungen"** (nur Admin): Liste mit Name, Typ, Status (aktiv, deaktiviert, nicht
  erreichbar), Anzahl Modelle; Dialog zum Anlegen und Bearbeiten; Key nie sichtbar, nur „hinterlegt" mit
  „ersetzen" und „entfernen"; „Verbindung testen" mit Ergebnis im Dialog; Modellauswahl je Verbindung zum
  Ein- und Ausblenden.
- **Seite „Verfügbare Modelle"** für alle Nutzer: `useModels()` (TanStack Query, generierter Client), zeigt
  Modell und Anbieter und nennt nicht erreichbare Verbindungen. Der Chat (Teilprojekt 3) übernimmt den Hook.
- Jede Ansicht kennt leer, laden, Fehler mit Retry und „in Arbeit" (Buttons gesperrt). Texte nur über i18n,
  Deutsch; „Anbieter" statt „Provider". Keine freien Palettenfarben.
- Der Client wird mit `pnpm openapi` erzeugt, nie von Hand.

## 8. Tests

Keine echten LLM-Aufrufe. Ein **Fake-Anbieter** (kleiner HTTP-Server im Test) liefert `/api/tags` und
`/v1/models`, auch Fehler (401, 500, 3xx, Hänger, zu große oder falsch typisierte Antwort).

- **Unit:** `SecretBox` (Round-trip, Manipulation, falscher `keyId`, kopierter Ciphertext in andere Zeile,
  Rotation), Adressrichtlinie (Tabelle erlaubt/verboten inkl. IPv4-in-IPv6 und Metadaten), Modell-ID
  (`llama3:8b`, ungültige IDs), Allowlist-Parser in `env.ts`.
- **Adapter/Fetch:** gegen den Fake-Anbieter über echtes HTTP: Listenformate beider Typen, Bearer-Key kommt an,
  Weiterleitung wird abgelehnt, Ursprungswechsel wird abgelehnt, angeheftete IP trotz wechselndem DNS-Ergebnis,
  Timeout. `resolve()` liefert ein `LanguageModel` mit der richtigen Anbieter-ID und Basis-URL (Generierung selbst
  bleibt Teilprojekt 3; dort ersetzt `MockLanguageModelV4` das Modell).
- **HTTP (Supertest, ohne DB über `overrideProvider`):** 401 ohne Session, 403 für `user` auf `/admin/...`,
  403 für Admin-Route per API-Key, `pending` kommt nicht durch; **Key steht in keiner Antwort**; Patch-Semantik
  des Keys; `unavailableConnections` bei Teilausfall; Cache und Invalidierung; ausgeblendete Modelle fehlen für
  Nutzer, erscheinen für Admin.
- **DB-Tests:** Migration, Unique auf Name, CHECK auf `type`, Ciphertext in der DB ist kein Klartext, Audit
  ohne Key.
- **Log-Test:** Ein Lauf mit Key im Request erzeugt keine Logzeile, die den Key enthält.
- **Web:** Zustände jeder Ansicht, Key-Feld-Verhalten, Test-Button gesperrt während der Anfrage. Danach Sicht im
  Browser und Konsole auf CSP-Meldungen prüfen.
- **Mutation:** Wer die Host-Prüfung abschaltet oder den Ursprungsvergleich entfernt, sieht rote Tests.
- Optional und manuell, nicht in der CI: Handprobe gegen ein echtes Ollama.

## 9. Aufteilung in Pläne

1. **2a Backend:** Abhängigkeiten (zuerst `ai`-7-Verträglichkeit prüfen), Env, `SecretBox`,
   `ProviderFetchService`, Entity und Migration, Adapter, Services, Controller, Audit, Tests, Smoke-Test.
2. **2b Web:** Client neu erzeugen, beide Seiten, i18n, Browser-Prüfung.

Jeder Plan endet mit Beleg unter `docs/dod/` nach dem Muster von [DoD 00](../../dod/00-fundament.md). Dazu im
selben Commit: [PLAN.md](../../PLAN.md), [BACKLOG.md](../../BACKLOG.md) und die Datenschutz-Zeile in der
Gesamt-Spec (Gruppensperre).
