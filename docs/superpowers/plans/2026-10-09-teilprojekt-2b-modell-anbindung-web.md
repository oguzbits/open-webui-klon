# Teilprojekt 2b: Modell-Anbindung (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins verbinden Modellanbieter (Ollama, OpenAI-kompatibel) in einer Verwaltungsseite; alle Nutzer sehen auf einer Seite, welche Modelle verfügbar sind und welche Anbieter gerade nicht antworten.

**Architecture:** Alles läuft über den aus Plan 2a erzeugten Orval-Client und TanStack Query. Der Fetcher lernt das Problem-Detail-Feld `reason`, ein Wörterbuch macht daraus verständliche Texte. Der Hook `useModels()` kapselt `GET /models` und wird vom Chat (Teilprojekt 3) wiederverwendet. Die Verwaltungsseite folgt dem Muster der Nutzerverwaltung (Tabelle, Dialoge, gesperrte Schaltflächen während einer Anfrage). Der API-Schlüssel steht nie im DOM, außer als Eingabe, solange der Admin ihn tippt.

**Tech Stack:** React 19, React Router 8, TanStack Query 5, Orval-Client, shadcn/ui (`radix-nova`), i18next, Vitest + Testing Library.

**Spec:** [Teilprojekt 2](../specs/2026-10-09-teilprojekt-2-modell-anbindung-design.md), Abschnitt 5 (Schnittstellen) und 7 (Web). Voraussetzung: Plan [2a](2026-10-09-teilprojekt-2a-modell-anbindung-backend.md) ist umgesetzt, der Client mit Verbindungs- und Modellrouten ist erzeugt und committet, und `scripts/fake-provider.mjs` existiert.

## Global Constraints

- `pnpm`, nie `npm` oder `yarn`. Befehle aus `AGENTS.md`: `pnpm check`, `pnpm test`, `pnpm openapi`.
- Serverzustand nur über TanStack Query und den **generierten** Client; keine handgeschriebenen API-Typen oder Fetch-Aufrufe in Features. `apps/web` importiert nie Laufzeitcode aus `apps/api`. Der erzeugte Client wird nie von Hand geändert.
- Kein `any`, kein `@ts-ignore`, kein `as unknown as`, kein `export *`. Steuernde Werte (Verbindungsstatus, Schlüsselmodus, Fehlergrund) als `as const`-Wörterbuch, überall importiert, auch in Tests. Aufzählungen des Servers (Typ, Fehlergrund) kommen aus dem generierten Client.
- UI-Texte nur über i18n-Schlüssel (`apps/web/src/i18n/locales/de.json` und `en.json`, gleiche Schlüssel, geprüft von `locales.spec.ts`). Standardsprache Deutsch. Texte sagen „Anbieter“, nie „Provider“; keine Fachbegriffe wie „RAG“, „Embedding“, „CSRF“, „SSRF“.
- shadcn-Bausteine und semantische Tokens (`text-destructive`, `text-muted-foreground`), keine freien Palettenfarben. Kein Checkbox- oder Switch-Baustein vorhanden: Ein- und Ausblenden läuft über Schaltflächen.
- Jede asynchrone Ansicht kennt leer (oder „nicht anwendbar“, begründet), laden (`role="status"`), Fehler mit „Erneut versuchen“ und „in Arbeit“ (Schaltflächen gesperrt, kein Doppel-Submit).
- Nutzereingaben, Anbieter- und Modellnamen werden nie als HTML gerendert (Invariante 7a); React escaped, `dangerouslySetInnerHTML` ist verboten.
- Der Schlüssel eines Anbieters wird nie angezeigt, nie vorbefüllt, nie geloggt und nach dem Schließen des Dialogs verworfen.
- Git: direkt auf `main`, ein Thema pro Commit, Conventional Commits, Imperativ. Hooks nie mit `--no-verify` umgehen. `.env*` nie lesen, ausgeben oder stagen. Jede Commit-Nachricht endet mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- UI-Änderungen werden im Browser angesehen (Konsole auf CSP-Verstöße prüfen), bevor sie als fertig gelten.
- Nach einem Push: `gh run list --branch main --limit 1` prüfen, rote CI vor neuer Arbeit beheben.

## Review Focus

Eingaben und Zustände, die die Spec nicht ausdrücklich nennt und die im Alltag auftreten. Jede Zeile hat einen Test in der genannten Task.

1. **Name mit HTML** (`<img src=x onerror=alert(1)>`) bei Anbieter oder Modell: erscheint als Text, nie als Element (Task 3, 4, 6).
2. **Schlüssel mit Leerzeichen oder falscher Schlüssel**: Der Server antwortet 400 oder die Prüfung zeigt `unauthorized`; der Dialog bleibt offen, die Eingaben bleiben stehen, es steht eine verständliche Meldung da (Task 5).
3. **Anbieter fällt aus, während die Seite offen ist**: `/models` nennt ihn mit Grund, die übrigen Modelle bleiben sichtbar; fällt die Gesundheitsabfrage in der Verwaltung selbst aus, bleibt die Tabelle benutzbar (Task 3, 4).
4. **Doppelklick** auf Verbinden, Testen, Aktivieren, Löschen und Ein-/Ausblenden: genau eine Anfrage, alle Aktionen der Zeile gesperrt (Task 4, 5, 6).
5. **Modell-IDs mit `:` und Reste in der Ausblendliste** (`llama3:8b`; ein gespeicherter Eintrag, den der Anbieter nicht mehr meldet): Ein- und Ausblenden sendet immer die **vollständige** Liste und behält fremde Einträge (Task 6). Ein Test ohne Änderungen (Bearbeiten, nichts ändern, Speichern) sendet keine Anfrage (Task 5).

---

## Dateistruktur

```
apps/web/src/
  api/
    fetcher.ts                          (ändern) ApiError.reason aus dem Problem-Detail-Feld "reason"
    fetcher.spec.ts                     (ändern)
  test/
    stub-api.ts                         (ändern) problem(..., extra) für Zusatzfelder
    fixtures.ts                         (ändern) providerConnectionDto, modelDto, modelList, adminModel
  features/connections/
    provider-reason.ts                  REASON_KEY, reasonKey, testFailureKey
    provider-reason.spec.ts
    connection-status.ts                CONNECTION_STATUS, connectionStatus, visibleModelCount, unreachableReason
    connection-status.spec.ts
    connection-form.ts                  KEY_MODE, buildPatch
    connection-form.spec.ts
    connections-table.tsx               ConnectionsTable (Liste, Aktivieren, Löschen)
    delete-connection-dialog.tsx        DeleteConnectionDialog
    connection-dialog.tsx               ConnectionDialog (Anlegen, Bearbeiten, Testen)
    connection-models-dialog.tsx        ConnectionModelsDialog (Modelle ein- und ausblenden)
  features/models/
    use-models.ts                       useModels (wiederverwendet vom Chat)
    models-list.tsx                     ModelsList
  pages/
    models-page.tsx (+ spec)            /models für alle Mitglieder
    admin-connections-page.tsx (+ spec) /admin/connections für Admins
  app/router.tsx                        (ändern) zwei Routen
  components/layout/app-layout.tsx      (ändern) zwei Navigationspunkte
  i18n/locales/de.json, en.json         (ändern) Blöcke "models" und "connections", nav
docs/dod/02-modell-anbindung-web.md     Beleg
```

---

### Task 1: Fetcher kennt den Grund eines Anbieterfehlers

**Files:**
- Modify: `apps/web/src/api/fetcher.ts`, `apps/web/src/api/fetcher.spec.ts`, `apps/web/src/test/stub-api.ts`

**Interfaces:**
- Consumes: bestehende `ApiError`, `apiFetch`, `stringField` aus `fetcher.ts`; `problem()` aus `stub-api.ts`.
- Produces: `ApiError.reason?: string` (fünftes Konstruktorargument, das Zusatzfeld `reason` der Problem-Details-Antwort, zum Beispiel beim `502` des Verbindungstests); `problem(status, title, detail?, extra?)` mit `extra: Record<string, string>` für Tests.

- [x] **Step 1: Prüfen, dass Plan 2a umgesetzt ist**

Run: `grep -c "provider-connections" apps/api/openapi.json && grep -n "export const use\(ProviderConnections\|ModelsList\)" apps/web/src/api/generated/api.ts`
Expected: eine Zahl größer 0 und die Hooks `useProviderConnectionsList`, `useProviderConnectionsCreate`, `useProviderConnectionsUpdate`, `useProviderConnectionsRemove`, `useProviderConnectionsTest`, `useProviderConnectionsModels`, `useModelsList`. Fehlt etwas, ist Plan 2a nicht fertig: dort Task 12 ausführen, nicht hier nachbauen.

Danach die Namen der erzeugten Aufzählungen ausgeben:

Run: `grep -rn "export const \(UnavailableConnectionDtoReason\|ProviderConnectionDtoType\|CreateProviderConnectionDtoType\|ModelDtoProviderType\)" apps/web/src/api/generated/model | head`
Expected: vier Treffer. **Weichen die Namen ab, die abweichenden Namen in diesem ganzen Plan verwenden** (Suchen und Ersetzen in den Dateien dieses Plans, bevor man sie anlegt). Dieser Plan nutzt `UnavailableConnectionDtoReason` (Werte `timeout`, `unreachable`, `unauthorized`, `bad_response`, `blocked_host`), `ProviderConnectionDtoType` und `CreateProviderConnectionDtoType` (Werte `ollama`, `openai_compatible`) und `ModelDtoProviderType`.

Run: `pnpm openapi && git diff --exit-code apps/api/openapi.json apps/web/src/api/generated`
Expected: kein Unterschied (der Client ist aktuell).

- [x] **Step 2: Failing tests schreiben**

In `apps/web/src/api/fetcher.spec.ts` am Ende der Datei, innerhalb von `describe('apiFetch', …)` vor der schließenden `});`, einfügen:

```ts
  it('keeps the reason a model provider failed with', async () => {
    stubFetch(
      502,
      '{"title":"Bad Gateway","detail":"The provider did not answer","reason":"unauthorized"}',
      'application/problem+json'
    );

    await expect(
      apiFetch('/api/admin/provider-connections/c1/test', { method: 'POST' })
    ).rejects.toMatchObject({ name: 'ApiError', status: 502, reason: 'unauthorized' });
  });

  it('has no reason when the answer carries none', async () => {
    stubFetch(500, '{"title":"Internal Server Error"}', 'application/problem+json');

    const error = await apiFetch('/api/health/ready').catch((caught: unknown) => caught);

    if (!(error instanceof ApiError)) throw new Error('expected an ApiError');
    expect(error.reason).toBeUndefined();
  });
```

Den Import `import { apiFetch } from './fetcher';` in derselben Datei ersetzen durch `import { ApiError, apiFetch } from './fetcher';`.

- [x] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/api/fetcher.spec.ts`
Expected: FAIL im ersten neuen Test (`reason` fehlt am Fehler); der zweite besteht bereits oder scheitert nur an der Typprüfung. Beides ist der erwartete Ausgangszustand.

- [x] **Step 4: Implementieren**

In `apps/web/src/api/fetcher.ts` die Klasse ersetzen:

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
    readonly requestId?: string,
    /** Why a model provider failed (the 502 of the connection test): one value of the server's PROVIDER_ERROR. */
    readonly reason?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

und im `throw new ApiError(` den Aufruf um das fünfte Argument ergänzen:

```ts
    throw new ApiError(
      response.status,
      stringField(body, 'title') ?? `Request failed (${response.status})`,
      stringField(body, 'detail'),
      stringField(body, 'requestId'),
      stringField(body, 'reason')
    );
```

In `apps/web/src/test/stub-api.ts` die Funktion `problem` ersetzen:

```ts
export function problem(
  status: number,
  title: string,
  detail?: string,
  extra: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ title, detail, status, ...extra }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}
```

- [x] **Step 5: Tests laufen lassen, Commit**

Run: `pnpm --filter @owui/web exec vitest run src/api/fetcher.spec.ts && pnpm check`
Expected: PASS, `pnpm check` grün.

```bash
git add apps/web/src/api/fetcher.ts apps/web/src/api/fetcher.spec.ts apps/web/src/test/stub-api.ts
git commit -m "feat(web): keep the reason of a failed provider call on ApiError" -m "The server adds the extension member reason to its 502 problem details; the connection test shows a sentence per reason." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Texte und Fehlergrund-Wörterbuch

**Files:**
- Create: `apps/web/src/features/connections/provider-reason.ts`, `apps/web/src/features/connections/provider-reason.spec.ts`
- Modify: `apps/web/src/i18n/locales/de.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `UnavailableConnectionDtoReason` (generiert); `ApiError` (Task 1); `errorMessageKey` aus `api/error-message.ts`.
- Produces: `reasonKey(reason: string | undefined): string` (i18n-Schlüssel, unbekannt oder fehlend ergibt `connections.reason.unknown`); `testFailureKey(error: unknown): string` (bei `ApiError` mit Status 502 der Schlüssel zum Grund, sonst `errorMessageKey`); alle i18n-Schlüssel der Blöcke `models` und `connections` sowie `nav.models` und `nav.connections`, die Tasks 3 bis 6 benutzen.

- [x] **Step 1: Failing test schreiben**

`apps/web/src/features/connections/provider-reason.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/fetcher';
import { UnavailableConnectionDtoReason } from '@/api/generated/model';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';

import { reasonKey, testFailureKey } from './provider-reason';

function textAt(tree: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (typeof node !== 'object' || node === null || !(part in node)) return undefined;
    return (node as Record<string, unknown>)[part];
  }, tree);
}

describe('reasonKey', () => {
  it.each(Object.values(UnavailableConnectionDtoReason))(
    'gives %s a text in German and English',
    (reason) => {
      const key = reasonKey(reason);
      expect(key).not.toBe('connections.reason.unknown');
      expect(typeof textAt(de, key)).toBe('string');
      expect(typeof textAt(en, key)).toBe('string');
    }
  );

  it('falls back to a neutral sentence for a reason it does not know', () => {
    expect(reasonKey('something_new')).toBe('connections.reason.unknown');
    expect(reasonKey(undefined)).toBe('connections.reason.unknown');
    expect(typeof textAt(de, 'connections.reason.unknown')).toBe('string');
  });
});

describe('testFailureKey', () => {
  it('names the reason of a 502 from the provider', () => {
    const error = new ApiError(502, 'Bad Gateway', undefined, undefined, 'unauthorized');
    expect(testFailureKey(error)).toBe(reasonKey('unauthorized'));
  });

  it('uses the neutral sentence for a 502 without reason', () => {
    expect(testFailureKey(new ApiError(502, 'Bad Gateway'))).toBe('connections.reason.unknown');
  });

  it('leaves every other failure to the shared messages', () => {
    expect(testFailureKey(new ApiError(404, 'Not Found'))).toBe('error.notFound');
    expect(testFailureKey(new ApiError(500, 'Boom'))).toBe('error.generic');
    expect(testFailureKey(new TypeError('Failed to fetch'))).toBe('error.network');
  });
});
```

Wenn `resolveJsonModule` die JSON-Dateien mit `import de from …` bereits in `locales.spec.ts` lädt, funktioniert der Import hier genauso.

- [x] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/features/connections/provider-reason.spec.ts`
Expected: FAIL (`./provider-reason` fehlt).

- [x] **Step 3: Wörterbuch schreiben**

`apps/web/src/features/connections/provider-reason.ts`:

```ts
import { errorMessageKey } from '@/api/error-message';
import { ApiError } from '@/api/fetcher';
import { UnavailableConnectionDtoReason } from '@/api/generated/model';

/** One sentence per reason the server names; `satisfies` makes a new server-side reason a compile error here. */
const REASON_KEY = {
  [UnavailableConnectionDtoReason.timeout]: 'connections.reason.timeout',
  [UnavailableConnectionDtoReason.unreachable]: 'connections.reason.unreachable',
  [UnavailableConnectionDtoReason.unauthorized]: 'connections.reason.unauthorized',
  [UnavailableConnectionDtoReason.bad_response]: 'connections.reason.bad_response',
  [UnavailableConnectionDtoReason.blocked_host]: 'connections.reason.blocked_host',
} as const satisfies Record<UnavailableConnectionDtoReason, string>;

const UNKNOWN_REASON_KEY = 'connections.reason.unknown';

/** The i18n key for a reason; a reason this version does not know (a newer server) gets a neutral sentence. */
export function reasonKey(reason: string | undefined): string {
  for (const known of Object.values(UnavailableConnectionDtoReason)) {
    if (known === reason) return REASON_KEY[known];
  }
  return UNKNOWN_REASON_KEY;
}

/** The sentence for a failed connection test: the 502 carries the reason, everything else is a shared message. */
export function testFailureKey(error: unknown): string {
  if (error instanceof ApiError && error.status === 502) return reasonKey(error.reason);
  return errorMessageKey(error);
}
```

- [x] **Step 4: Texte eintragen (Deutsch)**

In `apps/web/src/i18n/locales/de.json` im Block `nav` nach `"users": "Nutzer",` einfügen:

```json
    "models": "Modelle",
    "connections": "Modell-Anbindungen",
```

Und vor dem Top-Level-Block `"home": {` (der Anker `"home": {` kommt nur dort vor; `nav.home` ist ein String) die beiden Blöcke einfügen:

```json
  "models": {
    "title": "Verfügbare Modelle",
    "description": "Diese Modelle kannst du verwenden.",
    "columns": {
      "name": "Modell",
      "provider": "Anbieter"
    },
    "empty": "Noch sind keine Modelle verfügbar. Ein Administrator muss zuerst einen Anbieter verbinden.",
    "refresh": "Aktualisieren",
    "refreshing": "Wird aktualisiert …",
    "unavailable": {
      "title": "Nicht alle Anbieter antworten",
      "item": "{{name}}: {{reason}}"
    }
  },
  "connections": {
    "title": "Modell-Anbindungen",
    "description": "Hier verbindest du Anbieter, deren Modelle alle Nutzer verwenden können.",
    "create": "Anbieter verbinden",
    "empty": "Es ist noch kein Anbieter verbunden.",
    "healthUnknown": "Ob die Anbieter antworten, konnte nicht geprüft werden.",
    "columns": {
      "name": "Name",
      "type": "Art",
      "address": "Adresse",
      "status": "Zustand",
      "models": "Sichtbare Modelle",
      "actions": "Aktionen"
    },
    "type": {
      "ollama": "Ollama",
      "openai_compatible": "OpenAI-kompatibel"
    },
    "status": {
      "active": "Aktiv",
      "disabled": "Deaktiviert",
      "unreachable": "Nicht erreichbar",
      "unknown": "Unbekannt"
    },
    "noModels": "–",
    "edit": "Bearbeiten",
    "editNamed": "{{name}} bearbeiten",
    "models": "Modelle",
    "modelsNamed": "Modelle von {{name}} verwalten",
    "enable": "Aktivieren",
    "enableNamed": "{{name}} aktivieren",
    "disable": "Deaktivieren",
    "disableNamed": "{{name}} deaktivieren",
    "delete": {
      "action": "Löschen",
      "named": "{{name}} löschen",
      "title": "Anbieter „{{name}}“ löschen?",
      "body": "Die Anbindung und der gespeicherte Schlüssel werden gelöscht. Die Modelle dieses Anbieters stehen danach niemandem mehr zur Verfügung."
    },
    "form": {
      "createTitle": "Anbieter verbinden",
      "createHint": "Du kannst die Verbindung testen, sobald sie gespeichert ist.",
      "createSubmit": "Verbinden",
      "creating": "Wird verbunden …",
      "editTitle": "Anbieter bearbeiten",
      "editHint": "Die Art lässt sich nicht ändern. Lege dafür einen neuen Anbieter an.",
      "save": "Speichern",
      "saving": "Wird gespeichert …",
      "name": "Name",
      "type": "Art",
      "address": "Adresse",
      "addressHint": {
        "ollama": "Zum Beispiel http://localhost:11434",
        "openai_compatible": "Zum Beispiel https://api.example.com/v1"
      },
      "key": "Schlüssel (optional)",
      "newKey": "Neuer Schlüssel",
      "keyStored": "Ein Schlüssel ist hinterlegt. Er wird aus Sicherheitsgründen nicht angezeigt.",
      "keyReplace": "Ersetzen",
      "keyReplaceCancel": "Ersetzen abbrechen",
      "keyRemove": "Entfernen",
      "keyWillRemove": "Der Schlüssel wird beim Speichern entfernt.",
      "keyUndo": "Rückgängig"
    },
    "test": {
      "action": "Verbindung testen",
      "running": "Wird getestet …",
      "dirty": "Speichere zuerst deine Änderungen, um die neuen Angaben zu testen.",
      "ok_one": "Die Verbindung funktioniert. Es wurde ein Modell gefunden.",
      "ok_other": "Die Verbindung funktioniert. Es wurden {{count}} Modelle gefunden."
    },
    "modelsDialog": {
      "title": "Modelle von {{name}}",
      "description": "Ausgeblendete Modelle sehen Nutzer nicht.",
      "empty": "Dieser Anbieter meldet keine Modelle.",
      "hidden": "Ausgeblendet",
      "hide": "Ausblenden",
      "hideNamed": "{{model}} ausblenden",
      "show": "Einblenden",
      "showNamed": "{{model}} einblenden"
    },
    "error": {
      "nameRequired": "Bitte gib einen Namen ein.",
      "addressRequired": "Bitte gib die Adresse ein.",
      "keyRequired": "Gib den neuen Schlüssel ein oder brich das Ersetzen ab.",
      "nameTaken": "Dieser Name ist schon vergeben.",
      "addressRejected": "Diese Adresse wird nicht akzeptiert. Sie muss mit http:// oder https:// beginnen und darf weder Zugangsdaten noch Parameter enthalten. Private Adressen muss ein Administrator des Servers freigeben.",
      "invalid": "Bitte prüfe deine Angaben. Der Schlüssel darf keine Leerzeichen enthalten."
    },
    "reason": {
      "timeout": "Der Anbieter antwortet nicht rechtzeitig.",
      "unreachable": "Der Anbieter ist nicht erreichbar. Prüfe die Adresse und ob er läuft.",
      "unauthorized": "Der Anbieter lehnt den Schlüssel ab oder verlangt einen.",
      "bad_response": "Die Antwort des Anbieters ist unbrauchbar. Prüfe Adresse und Art.",
      "blocked_host": "Diese Adresse ist nicht erlaubt. Ein Administrator des Servers muss sie freigeben.",
      "unknown": "Der Anbieter antwortet nicht wie erwartet."
    }
  },
```

- [x] **Step 5: Texte eintragen (Englisch)**

In `apps/web/src/i18n/locales/en.json` im Block `nav` nach `"users": "Users",` einfügen:

```json
    "models": "Models",
    "connections": "Model connections",
```

Und vor dem Top-Level-Block `"home": {`:

```json
  "models": {
    "title": "Available models",
    "description": "You can use these models.",
    "columns": {
      "name": "Model",
      "provider": "Provider"
    },
    "empty": "No models are available yet. An administrator has to connect a provider first.",
    "refresh": "Refresh",
    "refreshing": "Refreshing …",
    "unavailable": {
      "title": "Not every provider is answering",
      "item": "{{name}}: {{reason}}"
    }
  },
  "connections": {
    "title": "Model connections",
    "description": "Connect the providers whose models every user can use.",
    "create": "Connect a provider",
    "empty": "No provider is connected yet.",
    "healthUnknown": "Whether the providers are answering could not be checked.",
    "columns": {
      "name": "Name",
      "type": "Kind",
      "address": "Address",
      "status": "State",
      "models": "Visible models",
      "actions": "Actions"
    },
    "type": {
      "ollama": "Ollama",
      "openai_compatible": "OpenAI-compatible"
    },
    "status": {
      "active": "Active",
      "disabled": "Disabled",
      "unreachable": "Unreachable",
      "unknown": "Unknown"
    },
    "noModels": "–",
    "edit": "Edit",
    "editNamed": "Edit {{name}}",
    "models": "Models",
    "modelsNamed": "Manage the models of {{name}}",
    "enable": "Enable",
    "enableNamed": "Enable {{name}}",
    "disable": "Disable",
    "disableNamed": "Disable {{name}}",
    "delete": {
      "action": "Delete",
      "named": "Delete {{name}}",
      "title": "Delete the provider “{{name}}”?",
      "body": "The connection and its stored key are deleted. The models of this provider are then unavailable to everyone."
    },
    "form": {
      "createTitle": "Connect a provider",
      "createHint": "You can test the connection once it is saved.",
      "createSubmit": "Connect",
      "creating": "Connecting …",
      "editTitle": "Edit provider",
      "editHint": "The kind cannot be changed. Create a new provider for that.",
      "save": "Save",
      "saving": "Saving …",
      "name": "Name",
      "type": "Kind",
      "address": "Address",
      "addressHint": {
        "ollama": "For example http://localhost:11434",
        "openai_compatible": "For example https://api.example.com/v1"
      },
      "key": "Key (optional)",
      "newKey": "New key",
      "keyStored": "A key is stored. For security it is not shown.",
      "keyReplace": "Replace",
      "keyReplaceCancel": "Cancel replacing",
      "keyRemove": "Remove",
      "keyWillRemove": "The key will be removed when you save.",
      "keyUndo": "Undo"
    },
    "test": {
      "action": "Test connection",
      "running": "Testing …",
      "dirty": "Save your changes first to test the new details.",
      "ok_one": "The connection works. One model was found.",
      "ok_other": "The connection works. {{count}} models were found."
    },
    "modelsDialog": {
      "title": "Models of {{name}}",
      "description": "Users do not see hidden models.",
      "empty": "This provider reports no models.",
      "hidden": "Hidden",
      "hide": "Hide",
      "hideNamed": "Hide {{model}}",
      "show": "Show",
      "showNamed": "Show {{model}}"
    },
    "error": {
      "nameRequired": "Please enter a name.",
      "addressRequired": "Please enter the address.",
      "keyRequired": "Enter the new key or cancel replacing it.",
      "nameTaken": "This name is already taken.",
      "addressRejected": "This address is not accepted. It must start with http:// or https:// and must not contain credentials or parameters. A server administrator has to allow private addresses.",
      "invalid": "Please check your details. The key must not contain spaces."
    },
    "reason": {
      "timeout": "The provider does not answer in time.",
      "unreachable": "The provider cannot be reached. Check the address and whether it is running.",
      "unauthorized": "The provider rejects the key or requires one.",
      "bad_response": "The provider's answer is unusable. Check the address and kind.",
      "blocked_host": "This address is not allowed. A server administrator has to allow it.",
      "unknown": "The provider does not answer as expected."
    }
  },
```

- [x] **Step 6: Tests laufen lassen, Commit**

Run: `pnpm --filter @owui/web exec vitest run src/features/connections/provider-reason.spec.ts src/i18n && pnpm check`
Expected: PASS (inklusive `locales.spec.ts`: gleiche Schlüssel, keine leeren Texte), `pnpm check` grün. Meldet Prettier die JSON-Dateien, `pnpm exec prettier --write apps/web/src/i18n/locales/*.json` und erneut prüfen.

```bash
git add apps/web/src/features/connections apps/web/src/i18n
git commit -m "feat(web): add the texts and the reason dictionary for model connections" -m "One sentence per failure reason of a provider; an unknown reason (newer server) gets a neutral sentence instead of a raw code." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Seite „Verfügbare Modelle“ und `useModels()`

**Files:**
- Create: `apps/web/src/features/models/use-models.ts`, `apps/web/src/features/models/models-list.tsx`, `apps/web/src/pages/models-page.tsx`, `apps/web/src/pages/models-page.spec.tsx`
- Modify: `apps/web/src/test/fixtures.ts`, `apps/web/src/test/stub-api.ts`, `apps/web/src/pages/admin-users-page.spec.tsx`, `apps/web/src/app/router.tsx`, `apps/web/src/components/layout/app-layout.tsx`

**Interfaces:**
- Consumes: `useModelsList` (generiert); `ApiError` (Task 1); `reasonKey` (Task 2); `LoadError`, `PageLoading`; die i18n-Blöcke `models` und `nav` (Task 2).
- Produces: `useModels()` liefert das TanStack-Ergebnis mit entpackten Daten `ModelListDto` (`{ models, unavailableConnections }`); `ModelsList`; Route `/models` für alle Mitglieder; Navigationspunkt „Modelle“. Test-Helfer: `providerConnectionDto(overrides?)`, `modelDto(overrides?)`, `modelList(models?, unavailable?)`, `adminModel(overrides?)` in `fixtures.ts`; `callsTo(fetchMock, method, path)` in `stub-api.ts`.

- [x] **Step 1: Test-Helfer ergänzen**

In `apps/web/src/test/stub-api.ts` am Ende anfügen (dritte Verwendung in den Specs: jetzt gemeinsam statt kopiert):

```ts
/** The requests a test made to one route, to count them (double submit) and to read their bodies. */
export function callsTo(fetchMock: ReturnType<typeof stubApi>, method: string, path: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => input === path && (init?.method ?? 'GET') === method
  );
}
```

In `apps/web/src/pages/admin-users-page.spec.tsx` die lokale Kopie entfernen und den Import anpassen: die Funktion

```ts
function callsTo(fetchMock: ReturnType<typeof stubApi>, method: string, path: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => input === path && (init?.method ?? 'GET') === method
  );
}

```

löschen und die Zeile `import { type Handler, json, noContent, problem, stubApi } from '@/test/stub-api';` ersetzen durch `import { callsTo, type Handler, json, noContent, problem, stubApi } from '@/test/stub-api';`. Meldet ESLint die Reihenfolge der Namen, `pnpm exec eslint --fix` auf diese Datei anwenden.

In `apps/web/src/test/fixtures.ts` die Importe am Dateianfang ersetzen durch

```ts
import {
  type AdminModelDto,
  type AuthConfigDto,
  type ModelDto,
  ModelDtoProviderType,
  type ModelListDto,
  type ProviderConnectionDto,
  ProviderConnectionDtoType,
  type SessionInfoDto,
  type UnavailableConnectionDto,
  type UserDto,
  UserDtoRole,
} from '@/api/generated/model';
```

und am Ende der Datei anfügen:

```ts
export function providerConnectionDto(
  overrides: Partial<ProviderConnectionDto> = {}
): ProviderConnectionDto {
  return {
    id: 'c-local',
    name: 'Lokal',
    type: ProviderConnectionDtoType.ollama,
    baseUrl: 'http://localhost:11434',
    hasApiKey: false,
    enabled: true,
    hiddenModelIds: [],
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

export function modelDto(overrides: Partial<ModelDto> = {}): ModelDto {
  return {
    id: 'c-local:llama3:8b',
    name: 'llama3:8b',
    connectionId: 'c-local',
    providerName: 'Lokal',
    providerType: ModelDtoProviderType.ollama,
    ...overrides,
  };
}

export function modelList(
  models: ModelDto[] = [modelDto()],
  unavailableConnections: UnavailableConnectionDto[] = []
): ModelListDto {
  return { models, unavailableConnections };
}

export function adminModel(overrides: Partial<AdminModelDto> = {}): AdminModelDto {
  return { rawModelId: 'llama3:8b', name: 'llama3:8b', hidden: false, ...overrides };
}
```

- [x] **Step 2: Failing test schreiben**

`apps/web/src/pages/models-page.spec.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UnavailableConnectionDtoReason } from '@/api/generated/model';
import { modelDto, modelList, sessionInfo, userDto } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { callsTo, type Handler, json, problem, stubApi } from '@/test/stub-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const BEN = userDto({ id: 'u-ben', name: 'Ben Beispiel' });
const LLAMA = modelDto({ id: 'c-local:llama3:8b', name: 'llama3:8b', providerName: 'Lokal' });
const GPT = modelDto({
  id: 'c-cloud:gpt-x',
  name: 'gpt-x',
  connectionId: 'c-cloud',
  providerName: 'Cloud',
});

function stubMember(handlers: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/auth/me': () => json(200, sessionInfo(BEN)),
    'GET /api/models': () => json(200, modelList([LLAMA, GPT])),
    ...handlers,
  });
}

async function openModels() {
  renderApp('/models');
  await screen.findByRole('heading', { name: 'Verfügbare Modelle' });
}

function rowOf(name: string) {
  return screen.findByRole('row', { name: new RegExp(name) });
}

describe('ModelsPage', () => {
  it('lists every model with its provider', async () => {
    stubMember();

    await openModels();

    expect(within(await rowOf('llama3:8b')).getByText('Lokal')).toBeInTheDocument();
    expect(within(await rowOf('gpt-x')).getByText('Cloud')).toBeInTheDocument();
  });

  it('is reachable from the navigation for every member, without the admin link', async () => {
    stubMember();
    const user = userEvent.setup();
    renderApp('/');

    await user.click(await screen.findByRole('link', { name: 'Modelle' }));

    expect(await screen.findByRole('heading', { name: 'Verfügbare Modelle' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Modell-Anbindungen' })).not.toBeInTheDocument();
  });

  it('renders model and provider names that look like HTML as plain text', async () => {
    stubMember({
      'GET /api/models': () =>
        json(
          200,
          modelList([
            modelDto({
              id: 'c-x:evil',
              name: '<img src=x onerror=alert(1)>',
              providerName: '<script>alert(2)</script>',
            }),
          ])
        ),
    });

    await openModels();

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('<script>alert(2)</script>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });

  it('names a provider that does not answer and still lists the other models', async () => {
    stubMember({
      'GET /api/models': () =>
        json(
          200,
          modelList(
            [LLAMA],
            [{ id: 'c-down', name: 'Server B', reason: UnavailableConnectionDtoReason.timeout }]
          )
        ),
    });

    await openModels();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nicht alle Anbieter antworten'
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Server B: Der Anbieter antwortet nicht rechtzeitig.'
    );
    expect(await rowOf('llama3:8b')).toBeInTheDocument();
  });

  it('shows the notice and the empty text together when every provider is down', async () => {
    stubMember({
      'GET /api/models': () =>
        json(
          200,
          modelList(
            [],
            [{ id: 'c-down', name: 'Server B', reason: UnavailableConnectionDtoReason.unreachable }]
          )
        ),
    });

    await openModels();

    expect(await screen.findByRole('alert')).toHaveTextContent('Server B');
    expect(screen.getByText(/Noch sind keine Modelle verfügbar/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('tells that no model is available yet', async () => {
    stubMember({ 'GET /api/models': () => json(200, modelList([])) });

    await openModels();

    expect(await screen.findByText(/Noch sind keine Modelle verfügbar/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a loading state while the list is fetched', async () => {
    stubMember({ 'GET /api/models': () => new Promise<Response>(() => undefined) });

    await openModels();

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('shows an error with a retry button and recovers', async () => {
    let healthy = false;
    stubMember({
      'GET /api/models': () =>
        healthy ? json(200, modelList([LLAMA])) : problem(500, 'Internal Server Error'),
    });
    const user = userEvent.setup();
    await openModels();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));

    expect(await rowOf('llama3:8b')).toBeInTheDocument();
  });

  it('refreshes on request, keeps the list meanwhile and sends one request on a double click', async () => {
    let calls = 0;
    const fetchMock = stubMember({
      'GET /api/models': () => {
        calls += 1;
        return calls === 1
          ? json(200, modelList([LLAMA]))
          : new Promise<Response>(() => undefined);
      },
    });
    const user = userEvent.setup();
    await openModels();

    await user.dblClick(await screen.findByRole('button', { name: 'Aktualisieren' }));

    expect(await screen.findByRole('button', { name: 'Wird aktualisiert …' })).toBeDisabled();
    expect(callsTo(fetchMock, 'GET', '/api/models')).toHaveLength(2);
    expect(await rowOf('llama3:8b')).toBeInTheDocument();
  });
});
```

- [x] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/pages/models-page.spec.tsx`
Expected: FAIL (Seite und Route fehlen; die Überschrift „Verfügbare Modelle“ wird nicht gefunden).

- [x] **Step 4: Implementieren**

`apps/web/src/features/models/use-models.ts`:

```ts
import { ApiError } from '@/api/fetcher';
import { useModelsList } from '@/api/generated/api';

/**
 * The models the signed-in user may use, plus the connections that did not answer. The result carries the
 * unwrapped list (`data.models`, `data.unavailableConnections`). Chat (Teilprojekt 3) reuses this hook.
 */
export function useModels() {
  return useModelsList({
    query: {
      select: (response) => {
        // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
        if (response.status !== 200) throw new ApiError(response.status, 'Unexpected answer');
        return response.data;
      },
    },
  });
}
```

Meldet ESLint (`no-unnecessary-condition`), dass die Bedingung immer falsch ist, weil der erzeugte Typ nur den Status 200 kennt, das `if` samt `ApiError`-Import entfernen und `return response.data;` stehen lassen (der Fetcher wirft jeden Status außerhalb von 2xx).

`apps/web/src/features/models/models-list.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { reasonKey } from '@/features/connections/provider-reason';

import { useModels } from './use-models';

export function ModelsList() {
  const { t } = useTranslation();
  const models = useModels();

  if (models.isPending) return <PageLoading />;
  if (models.isError) {
    return (
      <LoadError
        error={models.error}
        busy={models.isFetching}
        onRetry={() => {
          void models.refetch();
        }}
      />
    );
  }

  const { models: available, unavailableConnections } = models.data;
  return (
    <div className="space-y-4">
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={models.isFetching}
          onClick={() => {
            void models.refetch();
          }}
        >
          {models.isFetching ? t('models.refreshing') : t('models.refresh')}
        </Button>
      </div>
      {unavailableConnections.length > 0 && (
        <Alert>
          <AlertTitle>{t('models.unavailable.title')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {unavailableConnections.map((connection) => (
                <li key={connection.id}>
                  {t('models.unavailable.item', {
                    name: connection.name,
                    reason: t(reasonKey(connection.reason)),
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {available.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('models.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('models.columns.name')}</TableHead>
              <TableHead>{t('models.columns.provider')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {available.map((model) => (
              <TableRow key={model.id}>
                <TableCell className="font-medium">{model.name}</TableCell>
                <TableCell>{model.providerName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

`apps/web/src/pages/models-page.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { ModelsList } from '@/features/models/models-list';

export function ModelsPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('models.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('models.description')}</p>
      </div>
      <ModelsList />
    </div>
  );
}
```

`apps/web/src/app/router.tsx`: den Import `import { LoginPage } from '@/pages/login-page';` um eine Zeile ergänzen,

```tsx
import { LoginPage } from '@/pages/login-page';
import { ModelsPage } from '@/pages/models-page';
```

und in den Mitglieder-Routen nach der Konto-Route einfügen:

```tsx
          { path: 'settings/account', element: <AccountPage /> },
          { path: 'models', element: <ModelsPage /> },
```

`apps/web/src/components/layout/app-layout.tsx`: den Konto-Menüpunkt ersetzen durch Modelle plus Konto:

```tsx
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/models">{t('nav.models')}</NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/settings/account">{t('nav.account')}</NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
```

- [x] **Step 5: Tests laufen lassen, Commit**

Run: `pnpm --filter @owui/web exec vitest run && pnpm check`
Expected: PASS (alle Web-Tests, auch die bestehenden Router- und Nutzer-Specs), `pnpm check` grün.

```bash
git add apps/web/src
git commit -m "feat(web): add the page with the available models" -m "useModels() wraps GET /models and is meant to be reused by the chat; providers that do not answer are named with the reason while the other models stay listed." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verwaltungsseite „Modell-Anbindungen“ (Liste, Aktivieren, Löschen)

**Files:**
- Create: `apps/web/src/features/connections/connection-status.ts`, `apps/web/src/features/connections/connection-status.spec.ts`, `apps/web/src/features/connections/connections-table.tsx`, `apps/web/src/features/connections/delete-connection-dialog.tsx`, `apps/web/src/pages/admin-connections-page.tsx`, `apps/web/src/pages/admin-connections-page.spec.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/components/layout/app-layout.tsx`

**Interfaces:**
- Consumes: `useProviderConnectionsList`, `useProviderConnectionsUpdate`, `useProviderConnectionsRemove`, `getProviderConnectionsListQueryKey`, `getModelsListQueryKey` (generiert); `useModels` (Task 3); `reasonKey` (Task 2); Test-Helfer aus Task 3.
- Produces: `CONNECTION_STATUS` (`ACTIVE: 'active'`, `DISABLED: 'disabled'`, `UNREACHABLE: 'unreachable'`, `UNKNOWN: 'unknown'`), `ConnectionStatus`; `connectionStatus(connection, health)`, `unreachableReason(connection, health)`, `visibleModelCount(connection, health)` mit `health: ModelListDto | undefined`; `ConnectionsTable`; `DeleteConnectionDialog({ connection, busy, onConfirm })`; Route `/admin/connections` (nur Admin); Navigationspunkt „Modell-Anbindungen“. Tasks 5 und 6 ergänzen `ConnectionsTable` um Anlegen, Bearbeiten und Modelle.

- [x] **Step 1: Failing test für die Zustandslogik schreiben**

`apps/web/src/features/connections/connection-status.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { UnavailableConnectionDtoReason } from '@/api/generated/model';
import { modelDto, modelList, providerConnectionDto } from '@/test/fixtures';

import {
  CONNECTION_STATUS,
  connectionStatus,
  unreachableReason,
  visibleModelCount,
} from './connection-status';

const LOCAL = providerConnectionDto({ id: 'c-local' });
const HEALTHY = modelList([
  modelDto({ id: 'c-local:a', connectionId: 'c-local' }),
  modelDto({ id: 'c-local:b', connectionId: 'c-local' }),
  modelDto({ id: 'c-other:c', connectionId: 'c-other' }),
]);
const DOWN = modelList(
  [],
  [{ id: 'c-local', name: 'Lokal', reason: UnavailableConnectionDtoReason.timeout }]
);

describe('connectionStatus', () => {
  it('is disabled for a disabled connection, whatever the server says', () => {
    const off = providerConnectionDto({ id: 'c-local', enabled: false });
    expect(connectionStatus(off, HEALTHY)).toBe(CONNECTION_STATUS.DISABLED);
    expect(connectionStatus(off, undefined)).toBe(CONNECTION_STATUS.DISABLED);
    expect(connectionStatus(off, DOWN)).toBe(CONNECTION_STATUS.DISABLED);
  });

  it('is active when the model list names no problem for it', () => {
    expect(connectionStatus(LOCAL, HEALTHY)).toBe(CONNECTION_STATUS.ACTIVE);
  });

  it('is unreachable when the model list names it as unavailable', () => {
    expect(connectionStatus(LOCAL, DOWN)).toBe(CONNECTION_STATUS.UNREACHABLE);
  });

  it('is unknown while the health of the providers is not known', () => {
    expect(connectionStatus(LOCAL, undefined)).toBe(CONNECTION_STATUS.UNKNOWN);
  });
});

describe('unreachableReason', () => {
  it('gives the reason only for an enabled, unreachable connection', () => {
    expect(unreachableReason(LOCAL, DOWN)).toBe(UnavailableConnectionDtoReason.timeout);
    expect(unreachableReason(LOCAL, HEALTHY)).toBeUndefined();
    expect(unreachableReason(LOCAL, undefined)).toBeUndefined();
    expect(
      unreachableReason(providerConnectionDto({ id: 'c-local', enabled: false }), DOWN)
    ).toBeUndefined();
  });
});

describe('visibleModelCount', () => {
  it('counts only the models of this connection', () => {
    expect(visibleModelCount(LOCAL, HEALTHY)).toBe(2);
  });

  it('counts zero for an active connection without visible models', () => {
    expect(visibleModelCount(LOCAL, modelList([]))).toBe(0);
  });

  it('has no count when the connection is not active or its health is unknown', () => {
    expect(visibleModelCount(LOCAL, DOWN)).toBeUndefined();
    expect(visibleModelCount(LOCAL, undefined)).toBeUndefined();
    expect(
      visibleModelCount(providerConnectionDto({ id: 'c-local', enabled: false }), HEALTHY)
    ).toBeUndefined();
  });
});
```

- [x] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/features/connections/connection-status.spec.ts`
Expected: FAIL (`./connection-status` fehlt).

- [x] **Step 3: Zustandslogik implementieren**

`apps/web/src/features/connections/connection-status.ts`:

```ts
import type {
  ModelListDto,
  ProviderConnectionDto,
  UnavailableConnectionDtoReason,
} from '@/api/generated/model';

export const CONNECTION_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
  UNREACHABLE: 'unreachable',
  UNKNOWN: 'unknown',
} as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

/**
 * The server's own model list says which connections did not answer, so the admin page needs no extra route.
 * `health` is undefined while that list is loading or failed.
 */
export function unreachableReason(
  connection: ProviderConnectionDto,
  health: ModelListDto | undefined
): UnavailableConnectionDtoReason | undefined {
  if (!connection.enabled || health === undefined) return undefined;
  return health.unavailableConnections.find((entry) => entry.id === connection.id)?.reason;
}

export function connectionStatus(
  connection: ProviderConnectionDto,
  health: ModelListDto | undefined
): ConnectionStatus {
  if (!connection.enabled) return CONNECTION_STATUS.DISABLED;
  if (health === undefined) return CONNECTION_STATUS.UNKNOWN;
  return unreachableReason(connection, health) === undefined
    ? CONNECTION_STATUS.ACTIVE
    : CONNECTION_STATUS.UNREACHABLE;
}

/** Visible (not hidden) models of an active connection; undefined when there is nothing to count. */
export function visibleModelCount(
  connection: ProviderConnectionDto,
  health: ModelListDto | undefined
): number | undefined {
  if (health === undefined) return undefined;
  if (connectionStatus(connection, health) !== CONNECTION_STATUS.ACTIVE) return undefined;
  return health.models.filter((model) => model.connectionId === connection.id).length;
}
```

Run: `pnpm --filter @owui/web exec vitest run src/features/connections/connection-status.spec.ts`
Expected: PASS.

- [x] **Step 4: Failing test für die Seite schreiben**

`apps/web/src/pages/admin-connections-page.spec.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProviderConnectionDtoType,
  UnavailableConnectionDtoReason,
  UserDtoRole,
} from '@/api/generated/model';
import { modelDto, modelList, providerConnectionDto, sessionInfo, userDto } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { callsTo, type Handler, json, noContent, problem, stubApi } from '@/test/stub-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ADMIN = userDto({
  id: 'u-admin',
  name: 'Rita Root',
  email: 'rita@example.com',
  role: UserDtoRole.admin,
});
const BEN = userDto({ id: 'u-ben', name: 'Ben Beispiel' });
const LOCAL = providerConnectionDto({ id: 'c-local', name: 'Lokal' });
const CLOUD = providerConnectionDto({
  id: 'c-cloud',
  name: 'Cloud',
  type: ProviderConnectionDtoType.openai_compatible,
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
});
const OFF = providerConnectionDto({ id: 'c-off', name: 'Abgeschaltet', enabled: false });
const LIST = '/api/admin/provider-connections';

const TWO_MODELS = modelList([
  modelDto({ id: 'c-local:a', name: 'a', connectionId: 'c-local' }),
  modelDto({ id: 'c-local:b', name: 'b', connectionId: 'c-local' }),
]);

function stubAdmin(handlers: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/auth/me': () => json(200, sessionInfo(ADMIN)),
    [`GET ${LIST}`]: () => json(200, [LOCAL, CLOUD]),
    'GET /api/models': () => json(200, TWO_MODELS),
    ...handlers,
  });
}

async function openConnections() {
  renderApp('/admin/connections');
  await screen.findByRole('heading', { name: 'Modell-Anbindungen' });
}

function rowOf(name: string) {
  return screen.findByRole('row', { name: new RegExp(name) });
}

describe('AdminConnectionsPage: access', () => {
  it('sends an ordinary user to the start page without asking for the list', async () => {
    const fetchMock = stubApi({
      'GET /api/auth/me': () => json(200, sessionInfo(BEN)),
      [`GET ${LIST}`]: () => json(200, []),
    });

    renderApp('/admin/connections');

    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Modell-Anbindungen' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', LIST)).toHaveLength(0);
  });

  it('shows the navigation link to admins, and it leads to the page', async () => {
    stubAdmin();
    const user = userEvent.setup();
    renderApp('/');

    await user.click(await screen.findByRole('link', { name: 'Modell-Anbindungen' }));

    expect(await screen.findByRole('heading', { name: 'Modell-Anbindungen' })).toBeInTheDocument();
  });
});

describe('AdminConnectionsPage: list', () => {
  it('shows kind, address, state and the number of visible models of every connection', async () => {
    stubAdmin({
      [`GET ${LIST}`]: () => json(200, [LOCAL, CLOUD, OFF]),
      'GET /api/models': () =>
        json(200, {
          ...TWO_MODELS,
          unavailableConnections: [
            { id: 'c-cloud', name: 'Cloud', reason: UnavailableConnectionDtoReason.unauthorized },
          ],
        }),
    });

    await openConnections();

    const local = within(await rowOf('Lokal'));
    expect(local.getByText('Ollama')).toBeInTheDocument();
    expect(local.getByText('http://localhost:11434')).toBeInTheDocument();
    expect(local.getByText('Aktiv')).toBeInTheDocument();
    expect(local.getByText('2')).toBeInTheDocument();
    const cloud = within(await rowOf('Cloud'));
    expect(cloud.getByText('OpenAI-kompatibel')).toBeInTheDocument();
    expect(cloud.getByText('Nicht erreichbar')).toBeInTheDocument();
    expect(
      cloud.getByText('Der Anbieter lehnt den Schlüssel ab oder verlangt einen.')
    ).toBeInTheDocument();
    expect(cloud.getByText('–')).toBeInTheDocument();
    expect(within(await rowOf('Abgeschaltet')).getByText('Deaktiviert')).toBeInTheDocument();
  });

  it('renders a connection name that looks like HTML as plain text', async () => {
    stubAdmin({
      [`GET ${LIST}`]: () =>
        json(200, [providerConnectionDto({ id: 'c-x', name: '<img src=x onerror=alert(1)>' })]),
    });

    await openConnections();

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('tells that no provider is connected yet', async () => {
    stubAdmin({ [`GET ${LIST}`]: () => json(200, []) });

    await openConnections();

    expect(await screen.findByText('Es ist noch kein Anbieter verbunden.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a loading state while the list is fetched', async () => {
    stubAdmin({ [`GET ${LIST}`]: () => new Promise<Response>(() => undefined) });

    await openConnections();

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('shows an error with a retry button and recovers', async () => {
    let healthy = false;
    stubAdmin({
      [`GET ${LIST}`]: () =>
        healthy ? json(200, [LOCAL]) : problem(500, 'Internal Server Error'),
    });
    const user = userEvent.setup();
    await openConnections();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));

    expect(await rowOf('Lokal')).toBeInTheDocument();
  });

  it('keeps the table usable when the health of the providers cannot be read', async () => {
    let healthy = false;
    stubAdmin({
      'GET /api/models': () => (healthy ? json(200, TWO_MODELS) : problem(500, 'Boom')),
    });
    const user = userEvent.setup();
    await openConnections();

    const local = within(await rowOf('Lokal'));
    expect(local.getByText('Unbekannt')).toBeInTheDocument();
    expect(local.getByRole('button', { name: 'Lokal deaktivieren' })).toBeEnabled();
    const hint = await screen.findByRole('alert');
    expect(hint).toHaveTextContent('Ob die Anbieter antworten, konnte nicht geprüft werden.');
    healthy = true;
    await user.click(within(hint).getByRole('button', { name: 'Erneut versuchen' }));

    expect(await within(await rowOf('Lokal')).findByText('Aktiv')).toBeInTheDocument();
  });
});

describe('AdminConnectionsPage: enable and disable', () => {
  it('disables a connection and refreshes the list and the model list', async () => {
    let connections = [LOCAL, CLOUD];
    let sent: unknown;
    const fetchMock = stubAdmin({
      [`GET ${LIST}`]: () => json(200, connections),
      [`PATCH ${LIST}/c-local`]: ({ body }) => {
        sent = body;
        connections = [{ ...LOCAL, enabled: false }, CLOUD];
        return json(200, connections[0]);
      },
    });
    const user = userEvent.setup();
    await openConnections();

    await user.click(await screen.findByRole('button', { name: 'Lokal deaktivieren' }));

    await waitFor(async () => {
      expect(within(await rowOf('Lokal')).getByText('Deaktiviert')).toBeInTheDocument();
    });
    expect(sent).toEqual({ enabled: false });
    expect(screen.getByRole('button', { name: 'Lokal aktivieren' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', '/api/models').length).toBeGreaterThanOrEqual(2);
  });

  it('sends one request on a double click and locks all row actions meanwhile', async () => {
    const fetchMock = stubAdmin({
      [`PATCH ${LIST}/c-local`]: () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    await openConnections();

    await user.dblClick(await screen.findByRole('button', { name: 'Lokal deaktivieren' }));

    expect(callsTo(fetchMock, 'PATCH', `${LIST}/c-local`)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cloud deaktivieren' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Lokal löschen' })).toBeDisabled();
  });

  it('turns a 404 into a clear sentence and keeps the list', async () => {
    stubAdmin({ [`PATCH ${LIST}/c-local`]: () => problem(404, 'Not Found') });
    const user = userEvent.setup();
    await openConnections();

    await user.click(await screen.findByRole('button', { name: 'Lokal deaktivieren' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Das gibt es nicht (mehr).');
    expect(await rowOf('Lokal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lokal deaktivieren' })).toBeEnabled();
  });
});

describe('AdminConnectionsPage: delete', () => {
  it('asks first, deletes after the confirmation and removes the row', async () => {
    let connections = [LOCAL, CLOUD];
    const fetchMock = stubAdmin({
      [`GET ${LIST}`]: () => json(200, connections),
      [`DELETE ${LIST}/c-local`]: () => {
        connections = [CLOUD];
        return noContent();
      },
    });
    const user = userEvent.setup();
    await openConnections();

    await user.click(await screen.findByRole('button', { name: 'Lokal löschen' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText('Anbieter „Lokal“ löschen?')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'DELETE', `${LIST}/c-local`)).toHaveLength(0);
    await user.click(dialog.getByRole('button', { name: 'Löschen' }));

    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /Lokal/ })).not.toBeInTheDocument();
    });
    expect(callsTo(fetchMock, 'DELETE', `${LIST}/c-local`)).toHaveLength(1);
    expect(await rowOf('Cloud')).toBeInTheDocument();
  });

  it('deletes nothing when the question is cancelled', async () => {
    const fetchMock = stubAdmin();
    const user = userEvent.setup();
    await openConnections();

    await user.click(await screen.findByRole('button', { name: 'Lokal löschen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' })
    );

    expect(callsTo(fetchMock, 'DELETE', `${LIST}/c-local`)).toHaveLength(0);
    expect(await rowOf('Lokal')).toBeInTheDocument();
  });
});
```

- [x] **Step 5: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/pages/admin-connections-page.spec.tsx`
Expected: FAIL (Seite und Route fehlen).

- [x] **Step 6: Implementieren**

`apps/web/src/features/connections/delete-connection-dialog.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import type { ProviderConnectionDto } from '@/api/generated/model';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export function DeleteConnectionDialog({
  connection,
  busy,
  onConfirm,
}: {
  connection: ProviderConnectionDto;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          aria-label={t('connections.delete.named', { name: connection.name })}
        >
          {t('connections.delete.action')}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('connections.delete.title', { name: connection.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('connections.delete.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t('connections.delete.action')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

`apps/web/src/features/connections/connections-table.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import {
  getModelsListQueryKey,
  getProviderConnectionsListQueryKey,
  useProviderConnectionsList,
  useProviderConnectionsRemove,
  useProviderConnectionsUpdate,
} from '@/api/generated/api';
import type { ModelListDto, ProviderConnectionDto } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useModels } from '@/features/models/use-models';

import {
  CONNECTION_STATUS,
  type ConnectionStatus,
  connectionStatus,
  unreachableReason,
  visibleModelCount,
} from './connection-status';
import { DeleteConnectionDialog } from './delete-connection-dialog';
import { reasonKey } from './provider-reason';

const STATUS_VARIANT = {
  [CONNECTION_STATUS.ACTIVE]: 'secondary',
  [CONNECTION_STATUS.DISABLED]: 'outline',
  [CONNECTION_STATUS.UNREACHABLE]: 'destructive',
  [CONNECTION_STATUS.UNKNOWN]: 'outline',
} as const satisfies Record<ConnectionStatus, 'secondary' | 'outline' | 'destructive'>;

function ConnectionRow({
  connection,
  health,
  busy,
  onToggle,
  onRemove,
}: {
  connection: ProviderConnectionDto;
  health: ModelListDto | undefined;
  busy: boolean;
  onToggle: (connection: ProviderConnectionDto) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const status = connectionStatus(connection, health);
  const reason = unreachableReason(connection, health);
  const count = visibleModelCount(connection, health);
  return (
    <TableRow>
      <TableCell className="font-medium">{connection.name}</TableCell>
      <TableCell>{t(`connections.type.${connection.type}`)}</TableCell>
      <TableCell className="max-w-64 truncate" title={connection.baseUrl}>
        {connection.baseUrl}
      </TableCell>
      <TableCell>
        <div className="space-y-1">
          <Badge variant={STATUS_VARIANT[status]}>{t(`connections.status.${status}`)}</Badge>
          {reason !== undefined && (
            <p className="text-muted-foreground text-xs">{t(reasonKey(reason))}</p>
          )}
        </div>
      </TableCell>
      <TableCell>{count ?? t('connections.noModels')}</TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={t(
              connection.enabled ? 'connections.disableNamed' : 'connections.enableNamed',
              { name: connection.name }
            )}
            onClick={() => {
              onToggle(connection);
            }}
          >
            {t(connection.enabled ? 'connections.disable' : 'connections.enable')}
          </Button>
          <DeleteConnectionDialog
            connection={connection}
            busy={busy}
            onConfirm={() => {
              onRemove(connection.id);
            }}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

export function ConnectionsTable() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const connections = useProviderConnectionsList();
  const models = useModels();
  // A change to a connection changes what users see, so the model list is fetched again as well.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getProviderConnectionsListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getModelsListQueryKey() }),
    ]);
  const update = useProviderConnectionsUpdate({ mutation: { onSuccess: refresh } });
  const remove = useProviderConnectionsRemove({ mutation: { onSuccess: refresh } });
  const busy = update.isPending || remove.isPending;
  const health = models.isSuccess ? models.data : undefined;

  function toggle(connection: ProviderConnectionDto) {
    remove.reset();
    update.mutate({ id: connection.id, data: { enabled: !connection.enabled } });
  }

  function removeConnection(id: string) {
    update.reset();
    remove.mutate({ id });
  }

  const failure: unknown = update.isError ? update.error : remove.error;
  const failed = update.isError || remove.isError;

  let body: ReactNode;
  if (connections.isPending) {
    body = <PageLoading />;
  } else if (connections.isError || connections.data.status !== 200) {
    // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
    body = (
      <LoadError
        error={connections.error}
        busy={connections.isFetching}
        onRetry={() => {
          void connections.refetch();
        }}
      />
    );
  } else if (connections.data.data.length === 0) {
    body = <p className="text-muted-foreground text-sm">{t('connections.empty')}</p>;
  } else {
    body = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('connections.columns.name')}</TableHead>
            <TableHead>{t('connections.columns.type')}</TableHead>
            <TableHead>{t('connections.columns.address')}</TableHead>
            <TableHead>{t('connections.columns.status')}</TableHead>
            <TableHead>{t('connections.columns.models')}</TableHead>
            <TableHead>
              <span className="sr-only">{t('connections.columns.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {connections.data.data.map((connection) => (
            <ConnectionRow
              key={connection.id}
              connection={connection}
              health={health}
              busy={busy}
              onToggle={toggle}
              onRemove={removeConnection}
            />
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <div className="space-y-4">
      {failed && (
        <Alert variant="destructive">
          <AlertDescription>{t(errorMessageKey(failure))}</AlertDescription>
        </Alert>
      )}
      {models.isError && (
        <Alert>
          <AlertDescription className="space-y-3">
            <p>{t('connections.healthUnknown')}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={models.isFetching}
              onClick={() => {
                void models.refetch();
              }}
            >
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {body}
    </div>
  );
}
```

`apps/web/src/pages/admin-connections-page.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { ConnectionsTable } from '@/features/connections/connections-table';

export function AdminConnectionsPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('connections.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('connections.description')}</p>
      </div>
      <ConnectionsTable />
    </div>
  );
}
```

`apps/web/src/app/router.tsx`: Import ergänzen (alphabetisch vor `AdminUsersPage`),

```tsx
import { AdminConnectionsPage } from '@/pages/admin-connections-page';
import { AdminUsersPage } from '@/pages/admin-users-page';
```

und die Admin-Routen ersetzen:

```tsx
            children: [
              { path: 'admin/users', element: <AdminUsersPage /> },
              { path: 'admin/connections', element: <AdminConnectionsPage /> },
            ],
```

`apps/web/src/components/layout/app-layout.tsx`: den Admin-Block ersetzen durch

```tsx
                {user.role === UserDtoRole.admin && (
                  <>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/admin/users">{t('nav.users')}</NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink to="/admin/connections">{t('nav.connections')}</NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </>
                )}
```

- [x] **Step 7: Tests laufen lassen, Commit**

Run: `pnpm --filter @owui/web exec vitest run && pnpm check`
Expected: PASS, `pnpm check` grün. Schlägt ein Test mit „Found multiple elements“ fehl (zum Beispiel `getByText('2')`), den Test auf die Zeile einengen (`within(row)`), nicht die Oberfläche ändern.

```bash
git add apps/web/src
git commit -m "feat(web): add the admin page that lists model connections" -m "Shows kind, address, state (active, disabled, unreachable, unknown) and the visible model count from the server's own model list; enabling, disabling and deleting lock every row action while a request runs." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Anbieter verbinden, bearbeiten und testen

**Files:**
- Create: `apps/web/src/features/connections/connection-form.ts`, `apps/web/src/features/connections/connection-form.spec.ts`, `apps/web/src/features/connections/connection-dialog.tsx`
- Modify: `apps/web/src/features/connections/connections-table.tsx`, `apps/web/src/pages/admin-connections-page.spec.tsx`

**Interfaces:**
- Consumes: `useProviderConnectionsCreate`, `useProviderConnectionsUpdate`, `useProviderConnectionsTest`, `getProviderConnectionsListQueryKey`, `getProviderConnectionsModelsQueryKey`, `getModelsListQueryKey` (generiert); `CreateProviderConnectionDtoType`, `ProviderConnectionDto`, `UpdateProviderConnectionDto` (generiert); `testFailureKey` (Task 2); `errorMessageKey`; die Tabelle aus Task 4.
- Produces: `KEY_MODE` (`KEEP: 'keep'`, `REPLACE: 'replace'`, `REMOVE: 'remove'`), `KeyMode`, `ConnectionForm { name, baseUrl, keyMode, newKey }`, `buildPatch(connection, form): UpdateProviderConnectionDto` (nur geänderte Felder; `apiKey: null` entfernt den Schlüssel, ein String ersetzt ihn, fehlend lässt ihn); `ConnectionDialog({ connection?, onClose })` (ohne `connection` legt er an); in der Tabelle die Schaltflächen „Anbieter verbinden“ und „Bearbeiten“.

- [x] **Step 1: Failing test für `buildPatch` schreiben**

`apps/web/src/features/connections/connection-form.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { providerConnectionDto } from '@/test/fixtures';

import { buildPatch, type ConnectionForm, KEY_MODE } from './connection-form';

const STORED = providerConnectionDto({
  name: 'Cloud',
  baseUrl: 'https://api.example.com/v1',
  hasApiKey: true,
});
const UNCHANGED: ConnectionForm = {
  name: 'Cloud',
  baseUrl: 'https://api.example.com/v1',
  keyMode: KEY_MODE.KEEP,
  newKey: '',
};

describe('buildPatch', () => {
  it('is empty when nothing changed', () => {
    expect(buildPatch(STORED, UNCHANGED)).toEqual({});
  });

  it('ignores spaces around unchanged values', () => {
    expect(buildPatch(STORED, { ...UNCHANGED, name: '  Cloud ', baseUrl: ' https://api.example.com/v1 ' })).toEqual({});
  });

  it('sends only the fields that changed', () => {
    expect(buildPatch(STORED, { ...UNCHANGED, name: 'Cloud 2' })).toEqual({ name: 'Cloud 2' });
    expect(buildPatch(STORED, { ...UNCHANGED, baseUrl: 'https://other.example.com' })).toEqual({
      baseUrl: 'https://other.example.com',
    });
  });

  it('replaces the key with the trimmed new one', () => {
    expect(
      buildPatch(STORED, { ...UNCHANGED, keyMode: KEY_MODE.REPLACE, newKey: ' sk-new ' })
    ).toEqual({ apiKey: 'sk-new' });
  });

  it('leaves the key alone when replacing without typing anything', () => {
    expect(buildPatch(STORED, { ...UNCHANGED, keyMode: KEY_MODE.REPLACE, newKey: '  ' })).toEqual({});
  });

  it('removes the key with null', () => {
    expect(buildPatch(STORED, { ...UNCHANGED, keyMode: KEY_MODE.REMOVE })).toEqual({ apiKey: null });
  });

  it('ignores text typed earlier while the key is kept', () => {
    expect(buildPatch(STORED, { ...UNCHANGED, newKey: 'sk-stale' })).toEqual({});
  });
});
```

- [x] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/features/connections/connection-form.spec.ts`
Expected: FAIL (`./connection-form` fehlt).

- [x] **Step 3: `buildPatch` implementieren**

`apps/web/src/features/connections/connection-form.ts`:

```ts
import type { ProviderConnectionDto, UpdateProviderConnectionDto } from '@/api/generated/model';

/** What happens to the stored key when the form is saved. */
export const KEY_MODE = { KEEP: 'keep', REPLACE: 'replace', REMOVE: 'remove' } as const;
export type KeyMode = (typeof KEY_MODE)[keyof typeof KEY_MODE];

export interface ConnectionForm {
  name: string;
  baseUrl: string;
  keyMode: KeyMode;
  newKey: string;
}

/**
 * The PATCH body for an edit: only what changed. The key follows the contract of the server: a missing field
 * keeps it, `null` removes it, a string replaces it.
 */
export function buildPatch(
  connection: ProviderConnectionDto,
  form: ConnectionForm
): UpdateProviderConnectionDto {
  const patch: UpdateProviderConnectionDto = {};
  const name = form.name.trim();
  const baseUrl = form.baseUrl.trim();
  const key = form.newKey.trim();
  if (name !== connection.name) patch.name = name;
  if (baseUrl !== connection.baseUrl) patch.baseUrl = baseUrl;
  if (form.keyMode === KEY_MODE.REMOVE) {
    patch.apiKey = null;
  } else if (form.keyMode === KEY_MODE.REPLACE && key !== '') {
    patch.apiKey = key;
  }
  return patch;
}
```

Run: `pnpm --filter @owui/web exec vitest run src/features/connections/connection-form.spec.ts && pnpm exec prettier --write apps/web/src/features/connections/connection-form.spec.ts`
Expected: PASS (Prettier bricht die langen Zeilen im Test um).

- [x] **Step 4: Failing tests für den Dialog schreiben**

In `apps/web/src/pages/admin-connections-page.spec.tsx` den Import aus `@testing-library/react` um `type BoundFunctions` und `type queries` erweitern:

```tsx
import { type BoundFunctions, type queries, screen, waitFor, within } from '@testing-library/react';
```

und am Ende der Datei anfügen:

```tsx
type User = ReturnType<typeof userEvent.setup>;

describe('AdminConnectionsPage: connect a provider', () => {
  async function openCreate(user: User) {
    await user.click(await screen.findByRole('button', { name: 'Anbieter verbinden' }));
    return within(await screen.findByRole('dialog', { name: 'Anbieter verbinden' }));
  }

  async function fillCreate(
    dialog: BoundFunctions<typeof queries>,
    user: User,
    input: { name?: string; address?: string; key?: string } = {}
  ) {
    const { name = 'Mein Ollama', address = 'http://localhost:11434', key } = input;
    // user.type refuses an empty string, and "field left empty" is one of the cases.
    if (name !== '') await user.type(dialog.getByLabelText('Name'), name);
    if (address !== '') await user.type(dialog.getByLabelText('Adresse'), address);
    if (key !== undefined) await user.type(dialog.getByLabelText('Schlüssel (optional)'), key);
  }

  it('connects a provider with a key, closes the dialog and shows the new row', async () => {
    let connections = [LOCAL];
    let sent: unknown;
    stubAdmin({
      [`GET ${LIST}`]: () => json(200, connections),
      [`POST ${LIST}`]: ({ body }) => {
        sent = body;
        const created = providerConnectionDto({
          id: 'c-new',
          name: 'Mein Ollama',
          hasApiKey: true,
        });
        connections = [LOCAL, created];
        return json(201, created);
      },
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user, { key: 'sk-demo' });

    await user.click(dialog.getByRole('button', { name: 'Verbinden' }));

    expect(await rowOf('Mein Ollama')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(sent).toEqual({
      name: 'Mein Ollama',
      type: 'ollama',
      baseUrl: 'http://localhost:11434',
      apiKey: 'sk-demo',
      enabled: true,
    });
  });

  it('leaves the key out when none is typed', async () => {
    let sent: unknown;
    stubAdmin({
      [`POST ${LIST}`]: ({ body }) => {
        sent = body;
        return json(201, providerConnectionDto({ id: 'c-new', name: 'Mein Ollama' }));
      },
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user);

    await user.click(dialog.getByRole('button', { name: 'Verbinden' }));

    await waitFor(() => {
      expect(sent).toEqual({
        name: 'Mein Ollama',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        enabled: true,
      });
    });
  });

  it('offers both kinds and shows an address example for the chosen one', async () => {
    let sent: unknown;
    stubAdmin({
      [`POST ${LIST}`]: ({ body }) => {
        sent = body;
        return json(201, CLOUD);
      },
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCreate(user);
    expect(dialog.getByText('Zum Beispiel http://localhost:11434')).toBeInTheDocument();

    await user.selectOptions(dialog.getByLabelText('Art'), 'openai_compatible');
    expect(dialog.getByText('Zum Beispiel https://api.example.com/v1')).toBeInTheDocument();
    await fillCreate(dialog, user, { name: 'Cloud', address: 'https://api.example.com/v1' });
    await user.click(dialog.getByRole('button', { name: 'Verbinden' }));

    await waitFor(() => {
      expect(sent).toMatchObject({ type: 'openai_compatible' });
    });
  });

  it('asks for the missing name or address without sending anything', async () => {
    const fetchMock = stubAdmin();
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCreate(user);

    await fillCreate(dialog, user, { name: '' });
    await user.click(dialog.getByRole('button', { name: 'Verbinden' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Bitte gib einen Namen ein.');

    await user.type(dialog.getByLabelText('Name'), 'X');
    await user.clear(dialog.getByLabelText('Adresse'));
    await user.click(dialog.getByRole('button', { name: 'Verbinden' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Bitte gib die Adresse ein.');
    expect(callsTo(fetchMock, 'POST', LIST)).toHaveLength(0);
  });

  it.each([
    [409, 'Dieser Name ist schon vergeben.'],
    [422, 'Diese Adresse wird nicht akzeptiert.'],
    [400, 'Der Schlüssel darf keine Leerzeichen enthalten.'],
  ])('shows a clear sentence for %i and keeps the dialog and the typed values', async (status, text) => {
    stubAdmin({ [`POST ${LIST}`]: () => problem(status, 'Rejected') });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user, { key: 'sk-has a space' });

    await user.click(dialog.getByRole('button', { name: 'Verbinden' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(text);
    expect(dialog.getByLabelText('Name')).toHaveValue('Mein Ollama');
    expect(dialog.getByLabelText('Adresse')).toHaveValue('http://localhost:11434');
    expect(dialog.getByLabelText('Schlüssel (optional)')).toHaveValue('sk-has a space');
    expect(dialog.getByRole('button', { name: 'Verbinden' })).toBeEnabled();
  });

  it('sends one request on a double click and locks the button meanwhile', async () => {
    const fetchMock = stubAdmin({
      [`POST ${LIST}`]: () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user);

    await user.dblClick(dialog.getByRole('button', { name: 'Verbinden' }));

    expect(callsTo(fetchMock, 'POST', LIST)).toHaveLength(1);
    expect(dialog.getByRole('button', { name: 'Wird verbunden …' })).toBeDisabled();
  });

  it('offers no test before the provider is saved and starts empty every time', async () => {
    stubAdmin();
    const user = userEvent.setup();
    await openConnections();
    let dialog = await openCreate(user);
    expect(dialog.queryByRole('button', { name: 'Verbindung testen' })).not.toBeInTheDocument();
    expect(
      dialog.getByText('Du kannst die Verbindung testen, sobald sie gespeichert ist.')
    ).toBeInTheDocument();
    await fillCreate(dialog, user, { key: 'sk-secret' });
    await user.click(dialog.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByDisplayValue('sk-secret')).not.toBeInTheDocument();

    dialog = await openCreate(user);

    expect(dialog.getByLabelText('Name')).toHaveValue('');
    expect(dialog.getByLabelText('Schlüssel (optional)')).toHaveValue('');
    expect(screen.queryByDisplayValue('sk-secret')).not.toBeInTheDocument();
  });
});

describe('AdminConnectionsPage: edit a provider', () => {
  async function openEdit(user: User, name: 'Lokal' | 'Cloud') {
    await user.click(await screen.findByRole('button', { name: `${name} bearbeiten` }));
    return within(await screen.findByRole('dialog', { name: 'Anbieter bearbeiten' }));
  }

  it('shows the current values and never the stored key', async () => {
    stubAdmin();
    const user = userEvent.setup();
    await openConnections();

    const dialog = await openEdit(user, 'Cloud');

    expect(dialog.getByLabelText('Name')).toHaveValue('Cloud');
    expect(dialog.getByLabelText('Adresse')).toHaveValue('https://api.example.com/v1');
    expect(
      dialog.getByText('Ein Schlüssel ist hinterlegt. Er wird aus Sicherheitsgründen nicht angezeigt.')
    ).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(dialog.queryByLabelText('Art')).not.toBeInTheDocument();
    expect(dialog.getByText('OpenAI-kompatibel')).toBeInTheDocument();
  });

  it('sends only the changed field and refreshes the list', async () => {
    let cloud = CLOUD;
    let sent: unknown;
    stubAdmin({
      [`GET ${LIST}`]: () => json(200, [LOCAL, cloud]),
      [`PATCH ${LIST}/c-cloud`]: ({ body }) => {
        sent = body;
        cloud = { ...CLOUD, name: 'Cloud 2' };
        return json(200, cloud);
      },
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openEdit(user, 'Cloud');

    await user.type(dialog.getByLabelText('Name'), ' 2');
    await user.click(dialog.getByRole('button', { name: 'Speichern' }));

    expect(await rowOf('Cloud 2')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(sent).toEqual({ name: 'Cloud 2' });
  });

  it('closes without a request when nothing was changed', async () => {
    const fetchMock = stubAdmin();
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openEdit(user, 'Cloud');

    await user.click(dialog.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(callsTo(fetchMock, 'PATCH', `${LIST}/c-cloud`)).toHaveLength(0);
  });

  it('replaces the key through an empty field that is never prefilled', async () => {
    let sent: unknown;
    stubAdmin({
      [`PATCH ${LIST}/c-cloud`]: ({ body }) => {
        sent = body;
        return json(200, CLOUD);
      },
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openEdit(user, 'Cloud');

    await user.click(dialog.getByRole('button', { name: 'Ersetzen' }));
    const field = dialog.getByLabelText('Neuer Schlüssel');
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('type', 'password');
    await user.type(field, 'sk-new');
    await user.click(dialog.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(sent).toEqual({ apiKey: 'sk-new' });
    });
  });

  it('asks for the new key instead of sending an empty replacement', async () => {
    const fetchMock = stubAdmin();
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openEdit(user, 'Cloud');

    await user.click(dialog.getByRole('button', { name: 'Ersetzen' }));
    await user.click(dialog.getByRole('button', { name: 'Speichern' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Gib den neuen Schlüssel ein oder brich das Ersetzen ab.'
    );
    expect(callsTo(fetchMock, 'PATCH', `${LIST}/c-cloud`)).toHaveLength(0);
  });

  it('drops what was typed when replacing is cancelled', async () => {
    const fetchMock = stubAdmin();
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openEdit(user, 'Cloud');

    await user.click(dialog.getByRole('button', { name: 'Ersetzen' }));
    await user.type(dialog.getByLabelText('Neuer Schlüssel'), 'sk-typed');
    await user.click(dialog.getByRole('button', { name: 'Ersetzen abbrechen' }));

    expect(screen.queryByDisplayValue('sk-typed')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Ersetzen' }));
    expect(dialog.getByLabelText('Neuer Schlüssel')).toHaveValue('');
    await user.click(dialog.getByRole('button', { name: 'Ersetzen abbrechen' }));
    await user.click(dialog.getByRole('button', { name: 'Speichern' }));
    expect(callsTo(fetchMock, 'PATCH', `${LIST}/c-cloud`)).toHaveLength(0);
  });

  it('removes the key with null, and the removal can be undone', async () => {
    let sent: unknown;
    stubAdmin({
      [`PATCH ${LIST}/c-cloud`]: ({ body }) => {
        sent = body;
        return json(200, { ...CLOUD, hasApiKey: false });
      },
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openEdit(user, 'Cloud');

    await user.click(dialog.getByRole('button', { name: 'Entfernen' }));
    expect(dialog.getByText('Der Schlüssel wird beim Speichern entfernt.')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Rückgängig' }));
    expect(
      dialog.getByText('Ein Schlüssel ist hinterlegt. Er wird aus Sicherheitsgründen nicht angezeigt.')
    ).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Entfernen' }));
    await user.click(dialog.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(sent).toEqual({ apiKey: null });
    });
  });

  it('offers a plain key field for a provider without a stored key', async () => {
    let sent: unknown;
    stubAdmin({
      [`PATCH ${LIST}/c-local`]: ({ body }) => {
        sent = body;
        return json(200, { ...LOCAL, hasApiKey: true });
      },
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openEdit(user, 'Lokal');

    expect(dialog.queryByRole('button', { name: 'Ersetzen' })).not.toBeInTheDocument();
    await user.type(dialog.getByLabelText('Schlüssel (optional)'), 'sk-first');
    await user.click(dialog.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(sent).toEqual({ apiKey: 'sk-first' });
    });
  });

  it('turns the 404 of a provider deleted meanwhile into a clear sentence and keeps the dialog', async () => {
    stubAdmin({ [`PATCH ${LIST}/c-cloud`]: () => problem(404, 'Not Found') });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openEdit(user, 'Cloud');

    await user.type(dialog.getByLabelText('Name'), ' 2');
    await user.click(dialog.getByRole('button', { name: 'Speichern' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent('Das gibt es nicht (mehr).');
    expect(dialog.getByRole('button', { name: 'Speichern' })).toBeEnabled();
  });

  it('sends one request on a double click on save', async () => {
    const fetchMock = stubAdmin({
      [`PATCH ${LIST}/c-cloud`]: () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openEdit(user, 'Cloud');

    await user.type(dialog.getByLabelText('Name'), ' 2');
    await user.dblClick(dialog.getByRole('button', { name: 'Speichern' }));

    expect(callsTo(fetchMock, 'PATCH', `${LIST}/c-cloud`)).toHaveLength(1);
    expect(dialog.getByRole('button', { name: 'Wird gespeichert …' })).toBeDisabled();
  });
});

describe('AdminConnectionsPage: test the connection', () => {
  const TEST = `${LIST}/c-cloud/test`;

  async function openCloud(user: User) {
    await user.click(await screen.findByRole('button', { name: 'Cloud bearbeiten' }));
    return within(await screen.findByRole('dialog', { name: 'Anbieter bearbeiten' }));
  }

  it('shows how many models the provider reported', async () => {
    stubAdmin({ [`POST ${TEST}`]: () => json(200, { ok: true, modelCount: 3 }) });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCloud(user);

    await user.click(dialog.getByRole('button', { name: 'Verbindung testen' }));

    expect(await dialog.findByRole('status')).toHaveTextContent(
      'Die Verbindung funktioniert. Es wurden 3 Modelle gefunden.'
    );
  });

  it('uses the singular for one model', async () => {
    stubAdmin({ [`POST ${TEST}`]: () => json(200, { ok: true, modelCount: 1 }) });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCloud(user);

    await user.click(dialog.getByRole('button', { name: 'Verbindung testen' }));

    expect(await dialog.findByRole('status')).toHaveTextContent(
      'Die Verbindung funktioniert. Es wurde ein Modell gefunden.'
    );
  });

  it.each([
    ['unauthorized', 'Der Anbieter lehnt den Schlüssel ab oder verlangt einen.'],
    ['timeout', 'Der Anbieter antwortet nicht rechtzeitig.'],
    ['blocked_host', 'Diese Adresse ist nicht erlaubt.'],
    ['something_new', 'Der Anbieter antwortet nicht wie erwartet.'],
  ])('names the reason %s of a failed test', async (reason, text) => {
    stubAdmin({
      [`POST ${TEST}`]: () => problem(502, 'Bad Gateway', undefined, { reason }),
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCloud(user);

    await user.click(dialog.getByRole('button', { name: 'Verbindung testen' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent(text);
  });

  it('uses the shared message for a failure that is not a provider answer', async () => {
    stubAdmin({ [`POST ${TEST}`]: () => problem(404, 'Not Found') });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCloud(user);

    await user.click(dialog.getByRole('button', { name: 'Verbindung testen' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent('Das gibt es nicht (mehr).');
  });

  it('sends one request on a double click and locks the button while it runs', async () => {
    const fetchMock = stubAdmin({ [`POST ${TEST}`]: () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCloud(user);

    await user.dblClick(dialog.getByRole('button', { name: 'Verbindung testen' }));

    expect(callsTo(fetchMock, 'POST', TEST)).toHaveLength(1);
    expect(dialog.getByRole('button', { name: 'Wird getestet …' })).toBeDisabled();
  });

  it('tests only what is saved: unsaved changes lock the test and hide an old result', async () => {
    stubAdmin({ [`POST ${TEST}`]: () => json(200, { ok: true, modelCount: 2 }) });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openCloud(user);
    await user.click(dialog.getByRole('button', { name: 'Verbindung testen' }));
    expect(await dialog.findByRole('status')).toBeInTheDocument();

    await user.type(dialog.getByLabelText('Name'), 'x');

    expect(dialog.getByRole('button', { name: 'Verbindung testen' })).toBeDisabled();
    expect(
      dialog.getByText('Speichere zuerst deine Änderungen, um die neuen Angaben zu testen.')
    ).toBeInTheDocument();
    expect(dialog.queryByRole('status')).not.toBeInTheDocument();
    await user.type(dialog.getByLabelText('Name'), '{Backspace}');
    expect(dialog.getByRole('button', { name: 'Verbindung testen' })).toBeEnabled();
  });
});
```

- [x] **Step 5: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/pages/admin-connections-page.spec.tsx`
Expected: FAIL in den neuen Blöcken (keine Schaltflächen „Anbieter verbinden“ und „Bearbeiten“); die Tests aus Task 4 bleiben grün.

- [x] **Step 6: Dialog implementieren**

`apps/web/src/features/connections/connection-dialog.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import {
  getModelsListQueryKey,
  getProviderConnectionsListQueryKey,
  getProviderConnectionsModelsQueryKey,
  useProviderConnectionsCreate,
  useProviderConnectionsTest,
  useProviderConnectionsUpdate,
} from '@/api/generated/api';
import { CreateProviderConnectionDtoType, type ProviderConnectionDto } from '@/api/generated/model';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

import { buildPatch, KEY_MODE, type KeyMode } from './connection-form';
import { testFailureKey } from './provider-reason';

/** Narrows the string of a select to a kind without a cast. */
function parseType(value: string): CreateProviderConnectionDtoType | undefined {
  return Object.values(CreateProviderConnectionDtoType).find((known) => known === value);
}

/**
 * Creates a connection, or edits `connection`. Mounted only while open, so every opening starts from the stored
 * values and an empty key field; the key typed here lives in this component's state and nowhere else.
 */
export function ConnectionDialog({
  connection,
  onClose,
}: {
  connection?: ProviderConnectionDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const nameId = useId();
  const typeId = useId();
  const addressId = useId();
  const keyId = useId();
  const hasStoredKey = connection?.hasApiKey === true;
  const [name, setName] = useState(connection?.name ?? '');
  const [type, setType] = useState<CreateProviderConnectionDtoType>(
    CreateProviderConnectionDtoType.ollama
  );
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '');
  const [keyMode, setKeyMode] = useState<KeyMode>(hasStoredKey ? KEY_MODE.KEEP : KEY_MODE.REPLACE);
  const [newKey, setNewKey] = useState('');
  const [formError, setFormError] = useState<string>();

  // What users see depends on the connection, so lists are fetched again before the dialog closes.
  async function refreshAndClose() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getProviderConnectionsListQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getModelsListQueryKey() }),
      ...(connection === undefined
        ? []
        : [
            queryClient.invalidateQueries({
              queryKey: getProviderConnectionsModelsQueryKey(connection.id),
            }),
          ]),
    ]);
    onClose();
  }
  const create = useProviderConnectionsCreate({ mutation: { onSuccess: refreshAndClose } });
  const update = useProviderConnectionsUpdate({ mutation: { onSuccess: refreshAndClose } });
  const test = useProviderConnectionsTest();

  const pending = create.isPending || update.isPending;
  const patch =
    connection === undefined ? {} : buildPatch(connection, { name, baseUrl, keyMode, newKey });
  const dirty = Object.keys(patch).length > 0;
  const kind = connection?.type ?? type;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (name.trim() === '') {
      setFormError('connections.error.nameRequired');
      return;
    }
    if (baseUrl.trim() === '') {
      setFormError('connections.error.addressRequired');
      return;
    }
    if (hasStoredKey && keyMode === KEY_MODE.REPLACE && newKey.trim() === '') {
      setFormError('connections.error.keyRequired');
      return;
    }
    setFormError(undefined);
    if (connection === undefined) {
      const key = newKey.trim();
      create.mutate({
        data: {
          name: name.trim(),
          type,
          baseUrl: baseUrl.trim(),
          enabled: true,
          ...(key === '' ? {} : { apiKey: key }),
        },
      });
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    update.mutate({ id: connection.id, data: patch });
  }

  const saveFailed = create.isError || update.isError;
  const saveFailure: unknown = create.isError ? create.error : update.error;
  const errorKey =
    formError ??
    (saveFailed
      ? errorMessageKey(saveFailure, {
          400: 'connections.error.invalid',
          409: 'connections.error.nameTaken',
          422: 'connections.error.addressRejected',
        })
      : undefined);

  const tested = test.data?.status === 200 ? test.data.data : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {t(connection === undefined ? 'connections.form.createTitle' : 'connections.form.editTitle')}
            </DialogTitle>
            <DialogDescription>
              {t(connection === undefined ? 'connections.form.createHint' : 'connections.form.editHint')}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={nameId}>{t('connections.form.name')}</FieldLabel>
              <Input
                id={nameId}
                autoComplete="off"
                maxLength={80}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </Field>
            <Field>
              {connection === undefined ? (
                <>
                  <FieldLabel htmlFor={typeId}>{t('connections.form.type')}</FieldLabel>
                  <NativeSelect
                    id={typeId}
                    value={type}
                    onChange={(event) => {
                      setType(
                        parseType(event.target.value) ?? CreateProviderConnectionDtoType.ollama
                      );
                    }}
                  >
                    {Object.values(CreateProviderConnectionDtoType).map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {t(`connections.type.${value}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </>
              ) : (
                <>
                  {/* The kind of a saved provider is read-only, so there is no control to label. */}
                  <span className="text-sm font-medium">{t('connections.form.type')}</span>
                  <p className="text-sm">{t(`connections.type.${connection.type}`)}</p>
                </>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor={addressId}>{t('connections.form.address')}</FieldLabel>
              <Input
                id={addressId}
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                value={baseUrl}
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                }}
              />
              <FieldDescription>{t(`connections.form.addressHint.${kind}`)}</FieldDescription>
            </Field>
            {keyMode === KEY_MODE.REPLACE ? (
              <Field>
                <FieldLabel htmlFor={keyId}>
                  {t(hasStoredKey ? 'connections.form.newKey' : 'connections.form.key')}
                </FieldLabel>
                <Input
                  id={keyId}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={newKey}
                  onChange={(event) => {
                    setNewKey(event.target.value);
                  }}
                />
                {hasStoredKey && (
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setNewKey('');
                        setKeyMode(KEY_MODE.KEEP);
                      }}
                    >
                      {t('connections.form.keyReplaceCancel')}
                    </Button>
                  </div>
                )}
              </Field>
            ) : (
              <Field>
                <p className="text-sm">
                  {t(
                    keyMode === KEY_MODE.REMOVE
                      ? 'connections.form.keyWillRemove'
                      : 'connections.form.keyStored'
                  )}
                </p>
                <div className="flex gap-2">
                  {keyMode === KEY_MODE.KEEP ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setKeyMode(KEY_MODE.REPLACE);
                        }}
                      >
                        {t('connections.form.keyReplace')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setKeyMode(KEY_MODE.REMOVE);
                        }}
                      >
                        {t('connections.form.keyRemove')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setKeyMode(KEY_MODE.KEEP);
                      }}
                    >
                      {t('connections.form.keyUndo')}
                    </Button>
                  )}
                </div>
              </Field>
            )}
          </FieldGroup>
          {connection !== undefined && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                disabled={test.isPending || dirty || pending}
                onClick={() => {
                  test.mutate({ id: connection.id });
                }}
              >
                {test.isPending ? t('connections.test.running') : t('connections.test.action')}
              </Button>
              {dirty && (
                <p className="text-muted-foreground text-sm">{t('connections.test.dirty')}</p>
              )}
              {!dirty && tested !== undefined && (
                <p role="status" className="text-sm">
                  {t('connections.test.ok', { count: tested.modelCount })}
                </p>
              )}
              {!dirty && test.isError && (
                <Alert variant="destructive">
                  <AlertDescription>{t(testFailureKey(test.error))}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
          {errorKey !== undefined && (
            <Alert variant="destructive">
              <AlertDescription>{t(errorKey)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {connection === undefined
                ? t(pending ? 'connections.form.creating' : 'connections.form.createSubmit')
                : t(pending ? 'connections.form.saving' : 'connections.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

Hinweis: Das Dialog-Fragment `{t(connection === undefined ? … )}` bricht Prettier beim Formatieren um; `pnpm exec prettier --write` auf die Datei genügt.

- [x] **Step 7: Dialog in die Tabelle einhängen**

In `apps/web/src/features/connections/connections-table.tsx` fünf Änderungen:

1. Import von React ersetzen:

```tsx
import { type ReactNode, useState } from 'react';
```

(die bisherige Zeile `import type { ReactNode } from 'react';` ersetzen)

2. Vor dem Import der Zustandsfunktionen den Dialog importieren: die Zeilen

```tsx
import {
  CONNECTION_STATUS,
```

ersetzen durch

```tsx
import { ConnectionDialog } from './connection-dialog';
import {
  CONNECTION_STATUS,
```

3. Die Zeile bekommt ein neues Argument `onEdit`. Den Kopf von `ConnectionRow` ersetzen (von `function ConnectionRow({` bis einschließlich `}) {` vor `const { t }`):

```tsx
function ConnectionRow({
  connection,
  health,
  busy,
  onEdit,
  onToggle,
  onRemove,
}: {
  connection: ProviderConnectionDto;
  health: ModelListDto | undefined;
  busy: boolean;
  onEdit: (id: string) => void;
  onToggle: (connection: ProviderConnectionDto) => void;
  onRemove: (id: string) => void;
}) {
```

und in der Aktionszeile vor der ersten Schaltfläche („deaktivieren/aktivieren“) die Bearbeiten-Schaltfläche einfügen. Die Zeilen

```tsx
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={t(
              connection.enabled ? 'connections.disableNamed' : 'connections.enableNamed',
```

ersetzen durch

```tsx
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={t('connections.editNamed', { name: connection.name })}
            onClick={() => {
              onEdit(connection.id);
            }}
          >
            {t('connections.edit')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={t(
              connection.enabled ? 'connections.disableNamed' : 'connections.enableNamed',
```

4. In `ConnectionsTable` nach `const models = useModels();` den Zustand und die Suche des bearbeiteten Anbieters einfügen:

```tsx
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  // Looked up in the current list: an edit of a provider that was deleted meanwhile simply closes.
  const editing =
    connections.data?.status === 200
      ? connections.data.data.find((connection) => connection.id === editingId)
      : undefined;
```

und den Aufruf der Zeile um `onEdit={setEditingId}` ergänzen: die Zeile `onToggle={toggle}` ersetzen durch

```tsx
              onEdit={setEditingId}
              onToggle={toggle}
```

5. Im Rückgabewert die Schaltfläche und die Dialoge ergänzen. Die Zeilen

```tsx
    <div className="space-y-4">
      {failed && (
```

ersetzen durch

```tsx
    <div className="space-y-4">
      <div>
        <Button
          onClick={() => {
            setCreating(true);
          }}
        >
          {t('connections.create')}
        </Button>
      </div>
      {failed && (
```

und vor dem schließenden `</div>` des Rückgabewerts (nach `{body}`) einfügen:

```tsx
      {creating && (
        <ConnectionDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
      {editing !== undefined && (
        <ConnectionDialog
          connection={editing}
          onClose={() => {
            setEditingId(undefined);
          }}
        />
      )}
```

- [x] **Step 8: Tests laufen lassen, Commit**

Run: `pnpm exec prettier --write apps/web/src/features/connections apps/web/src/pages && pnpm --filter @owui/web exec vitest run && pnpm check`
Expected: PASS, `pnpm check` grün. Schlägt `it.each`-Titel mit `%i` in ESLint an, den Titel unverändert lassen und nur die gemeldete Regel an der Stelle lösen, nicht abschalten.

```bash
git add apps/web/src
git commit -m "feat(web): connect, edit and test a model provider" -m "The key is never shown or prefilled: a stored key offers replace and remove, a typed key lives only in the open dialog. The edit sends only changed fields (null removes the key), and the test runs only against what is saved." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Modelle eines Anbieters ein- und ausblenden

**Files:**
- Create: `apps/web/src/features/connections/connection-models-dialog.tsx`
- Modify: `apps/web/src/features/connections/connections-table.tsx`, `apps/web/src/pages/admin-connections-page.spec.tsx`

**Interfaces:**
- Consumes: `useProviderConnectionsModels`, `useProviderConnectionsUpdate`, die drei Schlüssel-Funktionen (generiert); `AdminModelDto` (generiert); `adminModel` (Task 3); Tabelle aus Task 5.
- Produces: `ConnectionModelsDialog({ connection, onClose })` (jeder Umschalter sendet `{ hiddenModelIds }` mit der **vollständigen** Liste, abgeleitet aus der gespeicherten Liste der Verbindung, damit Einträge, die der Anbieter nicht mehr meldet, erhalten bleiben); in der Tabelle die Schaltfläche „Modelle“.

- [x] **Step 1: Failing tests schreiben**

In `apps/web/src/pages/admin-connections-page.spec.tsx` den Import aus den Fixtures um `adminModel` erweitern (`import { adminModel, modelDto, modelList, providerConnectionDto, sessionInfo, userDto } from '@/test/fixtures';`) und am Ende der Datei anfügen:

```tsx
describe('AdminConnectionsPage: show and hide models', () => {
  const MODELS = `${LIST}/c-local/models`;
  const ALL = {
    models: [
      adminModel({ rawModelId: 'llama3:8b', name: 'llama3:8b' }),
      adminModel({ rawModelId: 'qwen2', name: 'Qwen 2' }),
      adminModel({ rawModelId: 'secret', name: 'Intern', hidden: true }),
    ],
  };

  async function openModels(user: User) {
    await user.click(await screen.findByRole('button', { name: 'Modelle von Lokal verwalten' }));
    return within(await screen.findByRole('dialog', { name: 'Modelle von Lokal' }));
  }

  it('lists every model of the provider, hidden ones marked', async () => {
    stubAdmin({
      [`GET ${LIST}`]: () => json(200, [{ ...LOCAL, hiddenModelIds: ['secret'] }, CLOUD]),
      [`GET ${MODELS}`]: () => json(200, ALL),
    });
    const user = userEvent.setup();
    await openConnections();

    const dialog = await openModels(user);

    expect(await dialog.findByText('llama3:8b')).toBeInTheDocument();
    expect(dialog.getByText('Qwen 2')).toBeInTheDocument();
    expect(dialog.getByText('Ausgeblendet')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Intern einblenden' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'llama3:8b ausblenden' })).toBeInTheDocument();
  });

  it('renders model names that look like HTML as plain text', async () => {
    stubAdmin({
      [`GET ${MODELS}`]: () =>
        json(200, {
          models: [adminModel({ rawModelId: 'evil', name: '<img src=x onerror=alert(1)>' })],
        }),
    });
    const user = userEvent.setup();
    await openConnections();

    const dialog = await openModels(user);

    expect(await dialog.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('sends the complete list, keeps entries the provider no longer reports, and refreshes', async () => {
    let local = { ...LOCAL, hiddenModelIds: ['secret', 'gone-model'] };
    let models = ALL.models;
    const bodies: unknown[] = [];
    stubAdmin({
      [`GET ${LIST}`]: () => json(200, [local, CLOUD]),
      [`GET ${MODELS}`]: () => json(200, { models }),
      [`PATCH ${LIST}/c-local`]: ({ body }) => {
        bodies.push(body);
        local = { ...local, hiddenModelIds: ['secret', 'gone-model', 'llama3:8b'] };
        models = models.map((model) =>
          model.rawModelId === 'llama3:8b' ? { ...model, hidden: true } : model
        );
        return json(200, local);
      },
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openModels(user);

    await user.click(await dialog.findByRole('button', { name: 'llama3:8b ausblenden' }));

    expect(await dialog.findByRole('button', { name: 'llama3:8b einblenden' })).toBeInTheDocument();
    expect(bodies).toEqual([{ hiddenModelIds: ['secret', 'gone-model', 'llama3:8b'] }]);
  });

  it('shows a hidden model again by removing only its id', async () => {
    const bodies: unknown[] = [];
    stubAdmin({
      [`GET ${LIST}`]: () => json(200, [{ ...LOCAL, hiddenModelIds: ['secret', 'gone-model'] }, CLOUD]),
      [`GET ${MODELS}`]: () => json(200, ALL),
      [`PATCH ${LIST}/c-local`]: ({ body }) => {
        bodies.push(body);
        return json(200, LOCAL);
      },
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openModels(user);

    await user.click(await dialog.findByRole('button', { name: 'Intern einblenden' }));

    await waitFor(() => {
      expect(bodies).toEqual([{ hiddenModelIds: ['gone-model'] }]);
    });
  });

  it('sends one request on a double click and locks every model button meanwhile', async () => {
    const fetchMock = stubAdmin({
      [`GET ${MODELS}`]: () => json(200, ALL),
      [`PATCH ${LIST}/c-local`]: () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openModels(user);

    await user.dblClick(await dialog.findByRole('button', { name: 'llama3:8b ausblenden' }));

    expect(callsTo(fetchMock, 'PATCH', `${LIST}/c-local`)).toHaveLength(1);
    expect(dialog.getByRole('button', { name: 'Qwen 2 ausblenden' })).toBeDisabled();
  });

  it('shows a failed change as a sentence and keeps the list', async () => {
    stubAdmin({
      [`GET ${MODELS}`]: () => json(200, ALL),
      [`PATCH ${LIST}/c-local`]: () => problem(404, 'Not Found'),
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openModels(user);

    await user.click(await dialog.findByRole('button', { name: 'Qwen 2 ausblenden' }));

    expect(await dialog.findByRole('alert')).toHaveTextContent('Das gibt es nicht (mehr).');
    expect(dialog.getByRole('button', { name: 'Qwen 2 ausblenden' })).toBeEnabled();
  });

  it('tells that a provider reports no models', async () => {
    stubAdmin({ [`GET ${MODELS}`]: () => json(200, { models: [] }) });
    const user = userEvent.setup();
    await openConnections();

    const dialog = await openModels(user);

    expect(await dialog.findByText('Dieser Anbieter meldet keine Modelle.')).toBeInTheDocument();
  });

  it('shows a loading state, then an error with a retry button that recovers', async () => {
    let healthy = false;
    stubAdmin({
      [`GET ${MODELS}`]: () => (healthy ? json(200, ALL) : problem(502, 'Bad Gateway')),
    });
    const user = userEvent.setup();
    await openConnections();
    const dialog = await openModels(user);

    const alert = await dialog.findByRole('alert');
    expect(alert).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));

    expect(await dialog.findByText('Qwen 2')).toBeInTheDocument();
  });

  it('shows a loading state while the models are fetched', async () => {
    stubAdmin({ [`GET ${MODELS}`]: () => new Promise<Response>(() => undefined) });
    const user = userEvent.setup();
    await openConnections();

    const dialog = await openModels(user);

    expect(await dialog.findByRole('status')).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/pages/admin-connections-page.spec.tsx`
Expected: FAIL im neuen Block (keine Schaltfläche „Modelle von Lokal verwalten“).

- [x] **Step 3: Dialog implementieren**

`apps/web/src/features/connections/connection-models-dialog.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import {
  getModelsListQueryKey,
  getProviderConnectionsListQueryKey,
  getProviderConnectionsModelsQueryKey,
  useProviderConnectionsModels,
  useProviderConnectionsUpdate,
} from '@/api/generated/api';
import type { AdminModelDto, ProviderConnectionDto } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ConnectionModelsDialog({
  connection,
  onClose,
}: {
  connection: ProviderConnectionDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const models = useProviderConnectionsModels(connection.id);
  // The mutation stays pending until the lists are fetched again, so the buttons stay locked until the
  // stored list the next click is derived from is current.
  const update = useProviderConnectionsUpdate({
    mutation: {
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: getProviderConnectionsListQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getModelsListQueryKey() }),
          queryClient.invalidateQueries({
            queryKey: getProviderConnectionsModelsQueryKey(connection.id),
          }),
        ]),
    },
  });

  /**
   * The server replaces the stored list with the one we send, so the new list starts from the stored one
   * (not from what the provider reports now): an id the provider no longer reports stays hidden.
   */
  function toggle(model: AdminModelDto) {
    const hiddenModelIds = model.hidden
      ? connection.hiddenModelIds.filter((id) => id !== model.rawModelId)
      : [...new Set([...connection.hiddenModelIds, model.rawModelId])];
    update.mutate({ id: connection.id, data: { hiddenModelIds } });
  }

  let body: ReactNode;
  if (models.isPending) {
    body = <PageLoading />;
  } else if (models.isError || models.data.status !== 200) {
    // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
    body = (
      <LoadError
        error={models.error}
        busy={models.isFetching}
        onRetry={() => {
          void models.refetch();
        }}
      />
    );
  } else if (models.data.data.models.length === 0) {
    body = <p className="text-muted-foreground text-sm">{t('connections.modelsDialog.empty')}</p>;
  } else {
    body = (
      <ul className="max-h-[60vh] divide-y overflow-y-auto">
        {models.data.data.models.map((model) => (
          <li key={model.rawModelId} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{model.name}</p>
              {model.name !== model.rawModelId && (
                <p className="text-muted-foreground truncate text-xs">{model.rawModelId}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {model.hidden && (
                <Badge variant="outline">{t('connections.modelsDialog.hidden')}</Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={update.isPending}
                aria-label={t(
                  model.hidden
                    ? 'connections.modelsDialog.showNamed'
                    : 'connections.modelsDialog.hideNamed',
                  { model: model.name }
                )}
                onClick={() => {
                  toggle(model);
                }}
              >
                {t(model.hidden ? 'connections.modelsDialog.show' : 'connections.modelsDialog.hide')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('connections.modelsDialog.title', { name: connection.name })}</DialogTitle>
          <DialogDescription>{t('connections.modelsDialog.description')}</DialogDescription>
        </DialogHeader>
        {body}
        {update.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t(errorMessageKey(update.error))}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Hinweis zum Test „Erneut versuchen“: Die Fehleransicht (`LoadError`) und der Fehlerkasten der Änderung sind beide `role="alert"`; im Test tritt immer nur einer auf.

- [x] **Step 4: Dialog in die Tabelle einhängen**

In `apps/web/src/features/connections/connections-table.tsx`:

1. Import ergänzen, direkt nach dem Import von `ConnectionDialog`:

```tsx
import { ConnectionModelsDialog } from './connection-models-dialog';
```

2. `ConnectionRow` bekommt `onManageModels`: in der Parameterliste `onEdit,` ersetzen durch `onEdit,\n  onManageModels,` und im Typ `onEdit: (id: string) => void;` ersetzen durch

```tsx
  onEdit: (id: string) => void;
  onManageModels: (id: string) => void;
```

3. Nach der Bearbeiten-Schaltfläche, vor der Schaltfläche „deaktivieren/aktivieren“, die Schaltfläche „Modelle“ einfügen. Die Zeilen

```tsx
            {t('connections.edit')}
          </Button>
```

ersetzen durch

```tsx
            {t('connections.edit')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={t('connections.modelsNamed', { name: connection.name })}
            onClick={() => {
              onManageModels(connection.id);
            }}
          >
            {t('connections.models')}
          </Button>
```

4. In `ConnectionsTable` den Zustand ergänzen (nach `const [editingId, …]`):

```tsx
  const [modelsForId, setModelsForId] = useState<string>();
```

die Suche erweitern: die Zeilen

```tsx
  const editing =
    connections.data?.status === 200
      ? connections.data.data.find((connection) => connection.id === editingId)
      : undefined;
```

ersetzen durch

```tsx
  const loaded = connections.data?.status === 200 ? connections.data.data : [];
  const editing = loaded.find((connection) => connection.id === editingId);
  // Always the current record: the hidden list sent by the dialog must be the stored one.
  const managingModels = loaded.find((connection) => connection.id === modelsForId);
```

den Aufruf der Zeile um `onManageModels={setModelsForId}` ergänzen (nach `onEdit={setEditingId}`), und nach dem Bearbeiten-Dialog im Rückgabewert einfügen:

```tsx
      {managingModels !== undefined && (
        <ConnectionModelsDialog
          connection={managingModels}
          onClose={() => {
            setModelsForId(undefined);
          }}
        />
      )}
```

- [x] **Step 5: Tests laufen lassen, Commit**

Run: `pnpm exec prettier --write apps/web/src/features/connections apps/web/src/pages && pnpm --filter @owui/web exec vitest run && pnpm check`
Expected: PASS, `pnpm check` grün.

```bash
git add apps/web/src
git commit -m "feat(web): show and hide the models of a provider" -m "Every click sends the complete hidden list derived from the stored one, so ids the provider no longer reports stay hidden; the buttons stay locked until the lists are fetched again." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Browserprobe, Docs und Beleg

**Files:**
- Create: `docs/dod/02-modell-anbindung-web.md`
- Modify: `docs/PLAN.md`, `docs/BACKLOG.md`, `docs/THREAT-MODEL.md`, `docs/superpowers/specs/2026-10-09-teilprojekt-2-modell-anbindung-design.md` (Status), `README.md` (nur falls dort Seiten beschrieben werden), `docs/superpowers/plans/2026-10-09-teilprojekt-2b-modell-anbindung-web.md` (Häkchen)

**Interfaces:**
- Consumes: alles aus Task 1 bis 6; Plan 2a umgesetzt (`scripts/fake-provider.mjs`, laufende Routen); Docker.
- Produces: Beleg `docs/dod/02-modell-anbindung-web.md`; aktualisierte Docs. Teilprojekt 2 ist damit abgeschlossen.

- [x] **Step 1: Vollständige Prüfung**

Run: `pnpm check && pnpm test && pnpm openapi && git diff --exit-code apps/api/openapi.json apps/web/src/api/generated`
Expected: alles grün, kein Unterschied im erzeugten Client. Die Anzahl der Web-Tests aus der Vitest-Ausgabe für den Beleg notieren.

Run: `pnpm db:up && pnpm test:db`
Expected: grün (die DB-Tests gehören zu Plan 2a, laufen hier als Gegenprobe, dass nichts am Backend kaputtgegangen ist).

Run: `git grep -n "dangerouslySetInnerHTML" apps/web/src; git grep -n -w "Provider" apps/web/src/i18n/locales/de.json`
Expected: keine Treffer. Steht „Provider“ in einem deutschen Text, durch „Anbieter“ ersetzen (im Englischen ist „provider“ erlaubt).

- [x] **Step 2: Stack starten und im Browser prüfen**

```bash
node scripts/fake-provider.mjs 11500 ok sk-demo &
PROVIDER_KEY_ENCRYPTION_KEYS="k1:$(openssl rand -base64 32)" PROVIDER_ALLOWED_HOSTS=host.docker.internal docker compose up -d --build --wait
```

Expected: alle Dienste `healthy`. Der Schlüsselring ist ein Wegwerfwert nur für diese Probe (Umgebungsvariable der Shell, keine Datei); `.env` wird nicht gelesen. Die Prüfung läuft gegen http://localhost:8080 (also hinter Caddy mit der echten CSP), nicht gegen den Vite-Entwicklungsserver. Ist `host.docker.internal` auf dem Rechner nicht auflösbar (Linux), in `compose.yml` des API-Dienstes `extra_hosts: ["host.docker.internal:host-gateway"]` nur für die Probe lokal ergänzen und **nicht committen**.

Browser-Werkzeuge laden: `ToolSearch` mit `select:mcp__chrome-devtools__navigate_page,mcp__chrome-devtools__take_snapshot,mcp__chrome-devtools__click,mcp__chrome-devtools__fill,mcp__chrome-devtools__list_console_messages,mcp__chrome-devtools__list_network_requests,mcp__chrome-devtools__get_network_request,mcp__chrome-devtools__resize_page,mcp__chrome-devtools__press_key,mcp__chrome-devtools__take_screenshot,mcp__chrome-devtools__evaluate_script`. Die Datenbank ist frisch, das erste Konto wird Administrator.

Ablauf und erwartetes Ergebnis (jeden Punkt abhaken; bei jeder Seite danach `list_console_messages` ansehen):

| #   | Aktion                                                                                                                        | Erwartet                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Registrieren (erstes Konto, wird Admin), Seitenleiste ansehen                                                                 | Links „Start“, „Modelle“, „Konto“, „Nutzer“, „Modell-Anbindungen“                                                                                                                                |
| 2   | `/models` und `/admin/connections` öffnen                                                                                     | „Noch sind keine Modelle verfügbar …“ bzw. „Es ist noch kein Anbieter verbunden.“; kein leeres Rahmenbild, Schaltfläche „Anbieter verbinden“ sichtbar                                             |
| 3   | „Anbieter verbinden“: Name `Probe`, Art Ollama, Adresse `http://host.docker.internal:11500`, Schlüssel `sk-demo`, „Verbinden“ | Dialog schließt, Zeile „Probe“ mit „Aktiv“ und 2 sichtbaren Modellen                                                                                                                             |
| 4   | Netzwerk: `get_network_request` auf `POST /api/admin/provider-connections` und auf `GET /api/admin/provider-connections`     | Anfrage trägt den Schlüssel, **keine Antwort** enthält `sk-demo`; die Liste zeigt nur `hasApiKey: true`; die Anfrage trägt den Header `X-CSRF-Token`                                             |
| 5   | `take_snapshot` und `evaluate_script` (`document.body.innerHTML.includes('sk-demo')`)                                         | Der Schlüssel steht nirgends mehr auf der Seite (`false`)                                                                                                                                        |
| 6   | „Probe bearbeiten“ öffnen                                                                                                     | Text „Ein Schlüssel ist hinterlegt …“, **kein** Eingabefeld für den Schlüssel (`document.querySelector('input[type=password]')` ist `null`), Art als Text, kein Auswahlfeld                      |
| 7   | „Verbindung testen“                                                                                                           | „Die Verbindung funktioniert. Es wurden 2 Modelle gefunden.“; während der Anfrage ist die Schaltfläche gesperrt („Wird getestet …“)                                                              |
| 8   | „Ersetzen“, Schlüssel `sk-wrong`, „Speichern“; erneut öffnen, „Verbindung testen“                                             | Test meldet „Der Anbieter lehnt den Schlüssel ab oder verlangt einen.“; in der Liste „Nicht erreichbar“ mit demselben Grund; `/models` nennt „Probe“ unter „Nicht alle Anbieter antworten“           |
| 9   | Schlüssel zurück auf `sk-demo` ersetzen, testen                                                                               | Test grün, Liste wieder „Aktiv“, `/models` ohne Hinweis                                                                                                                                          |
| 10  | „Entfernen“, „Rückgängig“, wieder „Entfernen“, „Speichern“, testen; danach Schlüssel `sk-demo` neu eintragen                  | Nach „Entfernen“ lehnt der Fake ab (Hinweis wie in 8); „Rückgängig“ stellt den Text „Ein Schlüssel ist hinterlegt …“ wieder her; zuletzt wieder „Aktiv“                                          |
| 11  | Adresse auf `http://169.254.169.254` ändern, „Speichern“                                                                      | Meldung „Diese Adresse wird nicht akzeptiert …“, Dialog bleibt offen, Eingaben stehen noch; nach „Abbrechen“ bleibt die alte Adresse                                                              |
| 12  | Zweiten Anbieter mit Name `<img src=x onerror=alert(1)>` verbinden (Adresse wie in 3, Schlüssel `sk-demo`)                    | Der Name erscheint als Text in der Liste und auf `/models`, kein Dialog („alert“), keine Konsolenmeldung; danach den Anbieter löschen (Rückfrage, dann Zeile weg)                                  |
| 13  | „Modelle von Probe verwalten“: ein Modell ausblenden                                                                          | Eintrag trägt „Ausgeblendet“, alle Modell-Schaltflächen sind während der Anfrage gesperrt; Liste zeigt „1“ sichtbares Modell; `/models` zeigt ein Modell weniger. Wieder einblenden: „2“            |
| 14  | „Probe deaktivieren“, `/models` ansehen, „Probe aktivieren“                                                                   | „Deaktiviert“ und „–“ bei den Modellen; `/models` leer; nach dem Aktivieren wieder 2 Modelle                                                                                                      |
| 15  | Fake beenden (`kill %1`), auf `/models` „Aktualisieren“ (bei Bedarf bis zum Ablauf von `MODEL_LIST_CACHE_TTL_MS` warten)      | „Nicht alle Anbieter antworten“ mit „Probe: Der Anbieter ist nicht erreichbar …“; in der Verwaltung „Nicht erreichbar“. Fake neu starten, „Aktualisieren“: Hinweis weg                              |
| 16  | Abmelden; zweites Konto registrieren, als Admin freischalten, als zweites Konto anmelden                                      | „Modelle“ sichtbar, **kein** „Modell-Anbindungen“; `/admin/connections` von Hand führt auf die Startseite; `/models` zeigt die Modelle ohne Bearbeiten-Schaltflächen                               |
| 17  | Dunkles Thema, Telefonbreite (`resize_page` auf 375 × 800), Tab-Taste durch Dialog „Anbieter verbinden“, Escape               | Alles lesbar, Tabelle scrollt waagerecht statt die Seite zu sprengen, Fokus sichtbar und im Dialog gefangen, Escape schließt                                                                      |
| 18  | Konsole über alle Schritte                                                                                                    | Keine Fehler, keine CSP-Verstöße („Refused to …“). Gibt es welche, die Ursache beheben (zum Beispiel ein Inline-Stil) und nicht die CSP lockern                                                   |

Danach: `docker compose down -v` und `kill %1` (falls der Fake noch läuft).

Hinweis zum Werkzeug: Gibt es keinen Browser-MCP, die Punkte 1 bis 18 von Hand im Browser durchgehen und das Ergebnis im Beleg als „von Hand“ vermerken; ein Haken ohne Prüfung ist nicht erlaubt. Chrome protokolliert erwartete 4xx/5xx-Antworten (422 beim Speichern, 502 beim Test) als „Failed to load resource“; das ist kein Fehler der Oberfläche, soll aber im Beleg stehen.

- [x] **Step 3: Gefundene Fehler beheben**

Jede Abweichung aus Step 2 bekommt zuerst einen Test, der sie zeigt (AGENTS.md, Abschnitt 4), dann die Korrektur, dann einen eigenen Commit `fix(web): …`. Danach den betroffenen Punkt in Step 2 erneut prüfen. Liegt die Ursache im Backend (zum Beispiel eine falsche Antwortform), ist das ein Fehler aus Plan 2a: dort mit Test beheben und im Beleg erwähnen, nicht in der Oberfläche umgehen.

- [x] **Step 4: Docs aktualisieren**

- `docs/THREAT-MODEL.md`: „Stand“ auf „Teilprojekt 2“ setzen. Zeilen ergänzen (unter den vorhandenen Zeilen derselben STRIDE-Kategorie): *Information Disclosure*, „Schlüssel eines Anbieters im Browser“, Maßnahme „Antworten tragen nur `hasApiKey`; das Feld ist nie vorbefüllt; ein getippter Schlüssel lebt nur im Zustand des offenen Dialogs und wird beim Schließen verworfen; Tests und Handprobe prüfen, dass er danach nirgends im DOM steht (2b)“. *Tampering/XSS*, „Anbieter- und Modellname mit HTML (Modellnamen stammen vom Anbieter und sind unvertraut)“, Maßnahme „React escaped, kein `dangerouslySetInnerHTML`, Tests mit `<img onerror>` in Verbindungsliste, Modellliste und Modelldialog, Handprobe im Browser (2b)“. *Elevation of Privilege*, „Verwaltungsseite für Nicht-Admins“, Maßnahme „Router-Wächter nur Komfort; der Server entscheidet (`/admin/...` verlangt Rolle `admin`, 2a); Test: Nutzer sieht weder Link noch Liste und die Liste wird nicht angefragt (2b)“.
- `docs/BACKLOG.md`: Neue Zeilen: „Verbindung mit ungespeicherten Angaben testen“ (heute testet die Oberfläche nur die gespeicherte Verbindung und sperrt den Test bei Änderungen); „Modellliste: Suche, Gruppierung, Anzeigenamen“ (heute eine Tabelle; eigene Anzeigenamen und Aliase gehören zu Teilprojekt 11, Workspace); „Schließen-Schaltfläche der Dialoge ist englisch“ (der generierte shadcn-Dialog trägt ein verstecktes „Close“; in `dialog.tsx` über i18n ersetzen, betrifft alle Dialoge); „`@nestjs/observe` prüfen“ (Observability-Agent der NestJS-Maintainer, Stand 2026-10-09 Version 0.3.7 und erst seit 2026-08-21 auf npm; Teilprojekt 0 deckt Traces und Metriken mit OpenTelemetry ab, siehe `apps/api/src/telemetry.ts`; erneut ansehen, wenn Teilprojekt 4 eine Job-Queue einführt, und nur dann übernehmen, wenn es BullMQ-Metriken liefert, die OpenTelemetry nicht liefert). In der bestehenden Zeile „Browser-Test für CSP, Anmelden und Verwalten“ die Seiten „Modelle“ und „Modell-Anbindungen“ ergänzen. Die Hinweise des Browsers zu Formularfeldern ohne `id`/`name` (Handprobe, falls aufgetreten) in die bestehende Zeile „Formularhinweise des Browsers“ aufnehmen.
- `docs/PLAN.md`: Teilprojekt 2 auf „erledigt: [Spec](superpowers/specs/2026-10-09-teilprojekt-2-modell-anbindung-design.md), Plan [2a](superpowers/plans/2026-10-09-teilprojekt-2a-modell-anbindung-backend.md), [2b](superpowers/plans/2026-10-09-teilprojekt-2b-modell-anbindung-web.md), Belege: [DoD 2a](dod/02-modell-anbindung-backend.md), [DoD 2b](dod/02-modell-anbindung-web.md)“ setzen; „Als Nächstes“: „1. Spec für Teilprojekt 3 (Chat und Streaming) schreiben. 2. Plan für Stufe 2 des Agentic-Setups (Stop-Hook, Bash-Guard mit Tests, DoD-Vorlage, Testregeln).“
- `docs/superpowers/specs/2026-10-09-teilprojekt-2-modell-anbindung-design.md`: Statuszeile (`Status: zur Prüfung durch Oguz.`) auf `Status: umgesetzt (Pläne 2a und 2b).` setzen, falls Plan 2a sie nicht schon geändert hat.
- `README.md`: Beschreibt der Abschnitt „Schnellstart“ oder „Konfiguration“ die Seiten der App, einen Satz ergänzen: „Unter ‚Modell-Anbindungen‘ verbindet ein Administrator Ollama oder einen OpenAI-kompatiblen Anbieter; private Adressen (zum Beispiel `ollama`) müssen vorher über `PROVIDER_ALLOWED_HOSTS` freigegeben sein.“ Steht das schon dort (aus Plan 2a), nicht doppeln.

- [x] **Step 5: Beleg schreiben**

`docs/dod/02-modell-anbindung-web.md` nach dem Muster von [DoD 1b](../../dod/01-auth-web.md), mit den echten Zahlen aus Step 1 und den echten Ergebnissen aus Step 2:

```markdown
### DoD: Teilprojekt 2b (Modell-Anbindung, Web)

- [x] Vertrag: Oberfläche nutzt nur den erzeugten Client; `pnpm openapi` ohne Abweichung
- [x] Tests: <Web-Zahl> Web grün; `pnpm check` grün; Zustände jeder Ansicht, Schlüsselfeld (nie vorbefüllt, Ersetzen, Entfernen, Rückgängig), Test-Schaltfläche (Grund je Fehlerart, gesperrt während der Anfrage und bei ungespeicherten Änderungen), Doppelklick in jedem Formular, HTML in Namen, vollständige Ausblendliste inklusive fremder Einträge
- [x] Invarianten: Schlüssel nur als Eingabe im offenen Dialog, nach dem Schließen nicht mehr im DOM (Handprobe, Punkt 5); keine Antwort trägt den Schlüssel (Punkt 4); Server entscheidet über Rechte (Wächter nur Komfort); Anbieter- und Modellnamen werden nicht als HTML gerendert
- [x] UI: Zustände laden, Fehler mit Wiederholen, in Arbeit für jede Ansicht; „leer“ für Modellliste, Verbindungsliste und Modelldialog; deutsche Texte über i18n („Anbieter“ statt „Provider“), Englisch mit gleichen Schlüsseln; im Browser über Caddy mit der echten CSP geprüft (Probe 1 bis 18 aus Plan 2b, Task 7, <Werkzeug oder „von Hand“>), hell/dunkel, Telefonbreite 375 × 800, Tastatur, Escape; Konsole ohne CSP-Verstöße
- [x] Betrieb: `docker compose up` grün mit `scripts/fake-provider.mjs` als Anbieter
- [x] Docs: PLAN, BACKLOG, THREAT-MODEL, Spec-Status<, README> aktualisiert
- [x] Offen: siehe docs/BACKLOG.md
```

Die spitzen Klammern durch die gemessenen Werte ersetzen (`<, README>` nur, wenn die README geändert wurde). Ist ein Punkt nicht erfüllt oder nicht geprüft, `- [ ]` lassen und den Grund dahinter schreiben. Darunter einen Absatz „Handprobe:“ mit den Fehlern, die Step 2 gefunden hat (jeweils mit Verweis auf den Fix-Commit), oder dem Satz „Die Probe fand keine Abweichung.“

- [x] **Step 6: Plan abhaken, Commit, Push, CI**

Die Kästchen der tatsächlich ausgeführten Steps in diesem Plan abhaken (nur die, die gelaufen sind). Dann:

Run: `pnpm check`
Expected: grün (Prettier formatiert die Markdown-Tabellen über lint-staged; bei Abweichung `pnpm exec prettier --write docs README.md`).

```bash
git add docs README.md
git commit -m "docs: record Teilprojekt 2b (browser check, threat model, backlog, DoD)" -m "Teilprojekt 2 is complete: the admin page for model connections and the page with the available models are checked in the browser behind the real CSP." -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
gh run list --branch main --limit 1
```

Expected: die CI läuft an; rote CI vor neuer Arbeit beheben (AGENTS.md, Abschnitt 4). Ist die Aufgabe abgeschlossen und der Kontext groß, den Nutzer in einem Satz auf `/clear` hinweisen.
