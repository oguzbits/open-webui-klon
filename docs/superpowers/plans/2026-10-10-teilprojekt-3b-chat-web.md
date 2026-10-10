# Teilprojekt 3b: Chat und Streaming (Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein angemeldeter Nutzer chattet im Browser mit einem Modell: er startet einen Chat, sieht die Antwort live, stoppt sie, erzeugt sie neu, bearbeitet eigene Nachrichten (Äste mit Umschalter „‹ 2/3 ›“), stellt Anweisung und Parameter pro Chat ein und findet seine Chats über eine Liste mit Titelsuche in der Seitenleiste wieder.

**Architecture:** Serverzustand (Chatliste, Chat mit allen Nachrichten, Ändern, Löschen) läuft über TanStack Query und den erzeugten Orval-Client. Eine bewusste Ausnahme ist der Stream: `useChat` (`@ai-sdk/react`) spricht über einen `DefaultChatTransport` mit eigener `fetch`-Funktion (Cookie, CSRF-Token, `traceparent`, 401-Behandlung, Fehler als `ApiError`), weil `apiFetch` die Antwort puffert. Der Transport sendet nur `{ parentId, text }`; der Server besitzt den Verlauf. Die Wahrheit über den Baum liegt in der Datenbank: nach jedem Ende eines Streams wird der Chat neu geladen und der angezeigte Ast aus `activeLeafId` abgeleitet. Markdown wird mit `react-markdown` ohne rohes HTML und ohne Bilder dargestellt.

**Tech Stack:** React 19, React Router 8, TanStack Query 5, Orval-Client, `ai` 7 und `@ai-sdk/react` 4, `react-markdown` 10 mit `remark-gfm` und `rehype-highlight`, shadcn/ui (`radix-nova`), i18next, Vitest + Testing Library.

**Spec:** [Teilprojekt 3](../specs/2026-10-10-teilprojekt-3-chat-streaming-design.md), Abschnitt 8 (Web), dazu 5 (Schnittstellen) und 6 (Streaming-Ablauf). Voraussetzung: Plan [3a](2026-10-10-teilprojekt-3a-chat-backend.md) ist umgesetzt; der erzeugte Client enthält die Chat-Routen (`useChatsList`, `useChatsCreate`, `useChatsDetail`, `useChatsUpdate`, `useChatsRemove`, Funktion `chatsList`). Entscheidung zur Lücke „Antworten mit Status `error`“ (Backlog): sie bleiben im Verlauf sichtbar, tragen den Hinweis „fehlgeschlagen, wird dem Modell nicht mitgeschickt“ und lassen sich neu erzeugen.

## Global Constraints

- `pnpm`, nie `npm` oder `yarn`. Befehle aus `AGENTS.md`: `pnpm check`, `pnpm test`, `pnpm openapi`.
- Serverzustand nur über TanStack Query und den **generierten** Client; keine handgeschriebenen API-Typen. Einzige Ausnahme: der Stream-Aufruf über den `useChat`-Transport (Body-Typ `StreamChatDto` kommt aus dem Client). `apps/web` importiert nie Laufzeitcode aus `apps/api`. Der erzeugte Client wird nie von Hand geändert.
- Kein `any`, kein `@ts-ignore`, kein `as unknown as`, kein `export *`. Steuernde Werte (Parameter-Namen, Kopierzustand, Fehlertext des Streams) als `as const`-Wörterbuch, überall importiert, auch in Tests. Aufzählungen des Servers (Rolle, Status, Titelquelle) kommen aus dem generierten Client.
- UI-Texte nur über i18n-Schlüssel (`de.json` und `en.json`, gleiche Schlüssel, geprüft von `locales.spec.ts`). Standardsprache Deutsch. Keine Fachbegriffe wie „RAG“, „Embedding“, „Prompt“ (stattdessen „Anweisung“), „Provider“ (stattdessen „Anbieter“).
- shadcn-Bausteine und semantische Tokens (`text-destructive`, `text-muted-foreground`, `bg-muted`), keine freien Palettenfarben.
- Jede asynchrone Ansicht kennt leer, laden (`role="status"`), Fehler mit „Erneut versuchen“ und „in Arbeit“ (Schaltflächen gesperrt, kein Doppel-Submit).
- Unvertraute Ausgabe (Invariante 7a): Antworten des Modells, Titel (auch vom Modell erzeugte), Modell- und Anbieternamen werden nie als HTML gerendert. `dangerouslySetInnerHTML` ist per ESLint verboten. Markdown: kein rohes HTML, Links nur `http`, `https`, `mailto` mit `rel="noopener noreferrer"`, **Bilder werden nie geladen** (sie erscheinen als Link-Text).
- Keine Chat-Inhalte in `console`, Logs oder Telemetrie.
- Git: direkt auf `main`, ein Thema pro Commit, Conventional Commits, Imperativ. Hooks nie mit `--no-verify` umgehen. `.env*` nie lesen, ausgeben oder stagen. Jede Commit-Nachricht endet mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Neue Abhängigkeiten dürfen ohne Rückfrage ergänzt werden (Regel 10: Version und API gegen die installierten Typen geprüft, Stand 2026-10-10): `ai`, `@ai-sdk/react`, `react-markdown`, `remark-gfm`, `rehype-highlight`. Grund steht in der Commit-Nachricht.
- UI-Änderungen werden im Browser angesehen (Konsole auf CSP-Verstöße prüfen), bevor sie als fertig gelten (Task 11).
- Nach einem Push: `gh run list --branch main --limit 1` prüfen, rote CI vor neuer Arbeit beheben.

## Review Focus

Eingaben und Zustände, die die Spec nicht ausdrücklich nennt und die im Alltag auftreten. Jede Zeile hat einen Test in der genannten Task.

1. **Antwort mit bösem Markdown** (`![x](http://evil.test/p.png)`, `<script>`, `[x](javascript:alert(1))`, relative Links): kein `<img>`, kein `<script>`, kein klickbarer `javascript:`-Link, der Text bleibt lesbar (Task 4, Handprobe in Task 11).
2. **Titel oder Nachricht mit HTML** (`<img src=x onerror=alert(1)>`) in Chatliste, Überschrift und Nachrichtenblase: erscheint als Text (Task 5, 7, 8).
3. **Die Anfrage scheitert, bevor ein Stream beginnt** (429, 422, Netz): keine Geisternachricht im Verlauf, der getippte Text steht wieder im Eingabefeld (bei einer Bearbeitung wieder im Bearbeiten-Feld), eine verständliche Meldung steht da (Task 9).
4. **Stopp mitten im Stream**: die Teilantwort bleibt sichtbar und verschwindet nicht durch ein zu frühes Neuladen, das die noch nicht gespeicherte Antwort nicht kennt; danach lädt der Chat neu (Task 9, Handprobe).
5. **Doppelaktionen** (zweimal Enter, Regenerieren oder Bearbeiten oder Ast-Wechsel während die Antwort läuft, zweimal Löschen): genau eine Anfrage, die übrigen Aktionen sind gesperrt (Task 5, 7, 8).
6. **Modell nicht mehr verfügbar** (Anbieter ausgefallen oder entfernt): der Chat bleibt lesbar, die Auswahl zeigt die gespeicherte ID statt zu springen, die Anbieter-Zeile warnt (Task 9).
7. **Langer Code und lange Wörter**: scrollen innerhalb des Codeblocks bzw. brechen um, nie die ganze Seite (Task 4, Handprobe).

---

## Dateistruktur

```
apps/api/src/
  chats/chat-params.ts                  (ändern) @ApiPropertyOptional mit Grenzen: ChatParams erscheint typisiert im Client
  openapi/build-document.spec.ts        (ändern) Test dazu
apps/api/openapi.json, apps/web/src/api/generated/**   (neu erzeugt, nie von Hand)
apps/web/src/
  api/fetcher.ts                        (ändern) readApiError: gescheiterte Antwort -> ApiError
  api/fetcher.spec.ts                   (ändern)
  test/
    sse.ts                              (neu) answerChunks, sseResponse, openSse (Stream-Antworten für Tests, auch Abbruch und Netzfehler)
    stub-api.ts                         (ändern) signal, Standard-Antwort für GET /api/chats
    fixtures.ts                         (ändern) chatTime, textParts, messageDto, chatDetailDto, chatSummaryDto, chatList
    render-app.tsx                      (ändern) optionaler Router-State
    setup.ts                            (ändern) scrollIntoView-Stub
  hooks/use-debounced-value.ts (+ spec)
  hooks/use-latest.ts                   Ref mit dem Wert des letzten Renders (für Rückrufe von useChat)
  components/ui/textarea.tsx            (shadcn)
  features/chats/
    message-tree.ts (+ spec)            activePath, branchesOf, toUiMessage, messageText, serverMessageId
    chat-errors.ts (+ spec)             STREAM_ERROR_TEXT, isStreamFailure, chatErrorKey
    chat-transport.ts (+ spec)          chatFetch, createChatTransport
    chat-navigation.ts (+ spec)         firstMessageState, readFirstMessage (Router-State)
    use-chat-detail.ts                  useChatDetail
    use-chat-list.ts                    useChatList (Cursor-Seiten, Suche)
    use-title-polling.ts (+ spec)       fragt nach dem erzeugten Titel
    chat-list.tsx, delete-chat-dialog.tsx (+ chat-list.spec.tsx)
    chat-params-form.ts (+ spec)        PARAM_NAME, PARAM_LIMITS, draftFromParams, paramsFromDraft
    chat-settings-dialog.tsx (+ spec)   ChatSettings, ChatSettingsDialog
    model-picker.tsx                    ModelPicker
    composer.tsx (+ spec)               Composer
    branch-switcher.tsx                 BranchSwitcher
    message-item.tsx (+ spec)           MessageItem
    chat-view.tsx                       ChatView, ChatSession (useChat)
    new-chat.tsx                        NewChat
    markdown/
      safe-href.ts (+ spec)             safeHref, safeUrlTransform
      node-text.ts                      nodeText
      code-block.tsx                    CodeBlock (Kopieren-Knopf)
      markdown-content.tsx (+ spec)     MarkdownContent
  pages/
    chat-page.tsx, chat-page.spec.tsx   /chats/:id
    new-chat-page.tsx, new-chat-page.spec.tsx   /chats
    home-page.tsx                       (ändern) Link „Chat starten“
  app/router.tsx                        (ändern) zwei Routen
  components/layout/app-layout.tsx      (ändern) Chatliste in der Seitenleiste
  i18n/locales/de.json, en.json         (ändern) Block "chats", "home.startChat"
  index.css                             (ändern) Farben der Code-Hervorhebung
scripts/fake-provider.mjs               (ändern) Antwort per FAKE_DELTAS einstellbar (Handprobe)
docs/dod/03-chat-web.md                 Beleg
```

---

### Task 1: ChatParams steht typisiert im Client

Der erzeugte Client kennt `ChatParams` heute nur als `{ [key: string]: unknown }`, weil die Klasse keine Swagger-Angaben trägt. Ohne diese Task müsste die Oberfläche einen Paralleltyp von Hand schreiben (verboten). Kleinste Änderung: die drei Felder im OpenAPI-Schema deklarieren, Client neu erzeugen.

**Files:**
- Modify: `apps/api/src/chats/chat-params.ts`, `apps/api/src/openapi/build-document.spec.ts`
- Regenerate: `apps/api/openapi.json`, `apps/web/src/api/generated/**`

**Interfaces:**
- Consumes: bestehende `ChatParams`-Klasse (Validierung unverändert).
- Produces: `ChatParams` im Client als `{ temperature?: number; topP?: number; maxOutputTokens?: number }`; spätere Tasks (6, 9, 10) nutzen genau diesen Typ.

- [ ] **Step 1: Prüfen, dass Plan 3a umgesetzt ist**

Run: `grep -n "export const use\(ChatsList\|ChatsCreate\|ChatsDetail\|ChatsUpdate\|ChatsRemove\)\|export const chatsList " apps/web/src/api/generated/api.ts | head`
Expected: Treffer für `useChatsCreate`, `useChatsUpdate`, `useChatsRemove`, `chatsList`; `useChatsList` und `useChatsDetail` sind als `export function` definiert (nicht im Treffer, aber vorhanden: `grep -c "export function useChats\(List\|Detail\)" apps/web/src/api/generated/api.ts` ergibt 8). Fehlt etwas, ist Plan 3a nicht fertig: nicht hier nachbauen.

Run: `grep -n "export const \(MessageDtoRole\|MessageDtoStatus\|MessagePartDtoType\|ChatDetailDtoTitleSource\) " -r apps/web/src/api/generated/model | cut -d: -f1,3`
Expected: vier Treffer. **Weichen die Namen ab, die abweichenden Namen in diesem ganzen Plan verwenden.**

Run: `pnpm openapi && git diff --exit-code apps/api/openapi.json apps/web/src/api/generated`
Expected: kein Unterschied (der Client ist aktuell).

- [ ] **Step 2: Failing test schreiben**

In `apps/api/src/openapi/build-document.spec.ts` die Imports ergänzen (alphabetisch passend zu den vorhandenen):

```ts
import { ChatStreamService } from '../chats/chat-stream.service.js';
import { ChatsController } from '../chats/chats.controller.js';
import { ChatsService } from '../chats/chats.service.js';
```

und am Ende von `describe('buildOpenApiDocument', …)`, vor der schließenden `});`, einfügen:

```ts
  it('declares the sampling settings of a chat with the limits the server enforces', async () => {
    // The services stay empty: only the contract is read.
    app = await createTestApp({
      controllers: [ChatsController],
      providers: [
        { provide: ChatsService, useValue: {} },
        { provide: ChatStreamService, useValue: {} },
      ],
    });

    const document = buildOpenApiDocument(app);

    expect(document.components?.schemas?.['ChatParams']).toMatchObject({
      properties: {
        temperature: { type: 'number', minimum: 0, maximum: 2 },
        topP: { type: 'number', minimum: 0, maximum: 1 },
        maxOutputTokens: { type: 'integer', minimum: 1, maximum: 100000 },
      },
    });
  });
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/openapi/build-document.spec.ts`
Expected: FAIL im neuen Test (das Schema hat keine `properties`). Scheitert er schon beim Aufbau der Test-App (fehlender Provider, den `ChatsController` oder ein globaler Guard braucht), den fehlenden Provider wie bei den Auth-Controllern im Test darüber als `{ provide: X, useValue: {} }` ergänzen.

- [ ] **Step 4: Implementieren**

In `apps/api/src/chats/chat-params.ts` den Import und die Felder ersetzen:

```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** Sampling settings of one chat. The server clamps `maxOutputTokens` to its own limit when it streams. */
export class ChatParams {
  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  topP?: number;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, maximum: 100000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxOutputTokens?: number;
}

export interface MessagePart {
  type: 'text';
  text: string;
}
```

- [ ] **Step 5: Test, Client neu erzeugen, prüfen**

Run: `pnpm --filter @owui/api exec vitest run src/openapi/build-document.spec.ts`
Expected: PASS.

Run: `pnpm openapi && git diff --stat && grep -n "temperature\|topP\|maxOutputTokens" apps/web/src/api/generated/model/chatParams.ts`
Expected: geändert sind `apps/api/openapi.json`, `apps/web/src/api/generated/model/chatParams.ts` (und gegebenenfalls Dateien, die `ChatParams` einbetten); nur Zeilen kamen dazu bzw. `ChatParams` hat jetzt die drei optionalen Felder.

Run: `pnpm check`
Expected: grün.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/chats/chat-params.ts apps/api/src/openapi/build-document.spec.ts apps/api/openapi.json apps/web/src/api/generated
git commit -m "feat(chats): declare chat parameters in the OpenAPI schema

The generated client typed ChatParams as an open record. The web form needs the
three fields and their limits without a hand-written parallel type."
```

---

### Task 2: Nachrichtenbaum und Fehlertexte (reine Logik)

Der Server schickt alle Nachrichten flach mit `parentId` und `activeLeafId`. Diese Task macht daraus den angezeigten Ast, die Geschwister („‹ 2/3 ›“) und die Umwandlung in `UIMessage`. Dazu die Fehlertexte und der i18n-Block des ganzen Plans.

**Files:**
- Create: `apps/web/src/features/chats/message-tree.ts`, `message-tree.spec.ts`, `chat-errors.ts`, `chat-errors.spec.ts`
- Modify: `apps/web/src/test/fixtures.ts`, `apps/web/src/i18n/locales/de.json`, `apps/web/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: generierte Typen `ChatDetailDto`, `MessageDto`; `ApiError`, `errorMessageKey`.
- Produces:
  - `activePath(chat: Pick<ChatDetailDto, 'messages' | 'activeLeafId'>): MessageDto[]` (wirft bei fehlendem Elternteil oder Zyklus)
  - `interface Branch { index: number; count: number; previousId: string | null; nextId: string | null }` und `branchesOf(messages: MessageDto[]): Map<string, Branch>`
  - `toUiMessage(message: MessageDto): UIMessage`, `messageText(message: Pick<UIMessage, 'parts'>): string`, `serverMessageId(message: UIMessage): string`
  - `STREAM_ERROR_TEXT = 'stream_failed'`, `isStreamFailure(error: unknown): boolean`, `chatErrorKey(error: unknown): string`
  - Fixtures: `chatTime(second: number): string`, `textParts(text)`, `messageDto(overrides?)`, `chatDetailDto(overrides?)`, `chatSummaryDto(overrides?)`, `chatList(items?, nextCursor?)`

- [ ] **Step 1: Fixtures ergänzen**

In `apps/web/src/test/fixtures.ts` den Import-Block erweitern (die vorhandenen Namen bleiben):

```ts
import {
  type AdminModelDto,
  type AuthConfigDto,
  type ChatDetailDto,
  ChatDetailDtoTitleSource,
  type ChatListDto,
  type ChatSummaryDto,
  type MessageDto,
  MessageDtoRole,
  MessageDtoStatus,
  type MessagePartDto,
  MessagePartDtoType,
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
/** A moment of the test conversation: `chatTime(3)` is always after `chatTime(2)`, so sibling order is explicit. */
export function chatTime(second: number): string {
  return `2026-10-10T09:00:${String(second).padStart(2, '0')}.000Z`;
}

export function textParts(text: string): MessagePartDto[] {
  return [{ type: MessagePartDtoType.text, text }];
}

export function messageDto(overrides: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 'm-1',
    parentId: null,
    role: MessageDtoRole.user,
    parts: textParts('Hallo'),
    status: MessageDtoStatus.complete,
    errorReason: null,
    modelId: null,
    createdAt: chatTime(0),
    ...overrides,
  };
}

export function chatDetailDto(overrides: Partial<ChatDetailDto> = {}): ChatDetailDto {
  return {
    id: 'c-1',
    title: 'Erster Chat',
    titleSource: ChatDetailDtoTitleSource.generated,
    modelId: 'c-local:llama3:8b',
    systemPrompt: null,
    params: {},
    activeLeafId: null,
    messages: [],
    createdAt: chatTime(0),
    updatedAt: chatTime(0),
    ...overrides,
  };
}

export function chatSummaryDto(overrides: Partial<ChatSummaryDto> = {}): ChatSummaryDto {
  return {
    id: 'c-1',
    title: 'Erster Chat',
    modelId: 'c-local:llama3:8b',
    updatedAt: chatTime(0),
    ...overrides,
  };
}

export function chatList(
  items: ChatSummaryDto[] = [chatSummaryDto()],
  nextCursor: string | null = null
): ChatListDto {
  return { items, nextCursor };
}
```

- [ ] **Step 2: Failing tests schreiben**

`apps/web/src/features/chats/message-tree.spec.ts`:

```ts
import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { MessageDtoRole } from '@/api/generated/model';
import { chatTime, messageDto, textParts } from '@/test/fixtures';

import {
  activePath,
  branchesOf,
  messageText,
  serverMessageId,
  toUiMessage,
} from './message-tree';

const U1 = messageDto({ id: 'u1', parentId: null, createdAt: chatTime(0) });
const A1 = messageDto({
  id: 'a1',
  parentId: 'u1',
  role: MessageDtoRole.assistant,
  createdAt: chatTime(1),
});
const U2 = messageDto({ id: 'u2', parentId: 'a1', createdAt: chatTime(2) });
const A2 = messageDto({
  id: 'a2',
  parentId: 'u2',
  role: MessageDtoRole.assistant,
  createdAt: chatTime(3),
});
// A regenerated answer to u1 and an edited first question: siblings in the tree.
const A1B = messageDto({
  id: 'a1b',
  parentId: 'u1',
  role: MessageDtoRole.assistant,
  createdAt: chatTime(4),
});
const U1E = messageDto({ id: 'u1e', parentId: null, createdAt: chatTime(5) });
const ALL = [U1, A1, U2, A2, A1B, U1E];

function ids(messages: { id: string }[]): string[] {
  return messages.map((message) => message.id);
}

describe('activePath', () => {
  it('walks from the active leaf up to the first message and returns it in order', () => {
    expect(ids(activePath({ messages: ALL, activeLeafId: 'a2' }))).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('follows the other branch when the leaf lies there', () => {
    expect(ids(activePath({ messages: ALL, activeLeafId: 'a1b' }))).toEqual(['u1', 'a1b']);
    expect(ids(activePath({ messages: ALL, activeLeafId: 'u1e' }))).toEqual(['u1e']);
  });

  it('is empty without an active leaf', () => {
    expect(activePath({ messages: [], activeLeafId: null })).toEqual([]);
  });

  it('fails on a tree whose parent is missing instead of showing half a chat', () => {
    const orphan = messageDto({ id: 'x', parentId: 'gone' });

    expect(() => activePath({ messages: [orphan], activeLeafId: 'x' })).toThrow(/missing parent/);
  });

  it('fails on a cycle instead of looping forever', () => {
    const a = messageDto({ id: 'a', parentId: 'b' });
    const b = messageDto({ id: 'b', parentId: 'a' });

    expect(() => activePath({ messages: [a, b], activeLeafId: 'a' })).toThrow(/cycle/);
  });
});

describe('branchesOf', () => {
  const branches = branchesOf(ALL);

  it('numbers the answers that share one question, oldest first', () => {
    expect(branches.get('a1')).toEqual({ index: 0, count: 2, previousId: null, nextId: 'a1b' });
    expect(branches.get('a1b')).toEqual({ index: 1, count: 2, previousId: 'a1', nextId: null });
  });

  it('treats the first messages of a chat as siblings of each other', () => {
    expect(branches.get('u1')).toEqual({ index: 0, count: 2, previousId: null, nextId: 'u1e' });
    expect(branches.get('u1e')?.index).toBe(1);
  });

  it('gives a message without siblings a single position', () => {
    expect(branches.get('u2')).toEqual({ index: 0, count: 1, previousId: null, nextId: null });
  });

  it('orders by creation time and falls back to the id for equal times', () => {
    const x = messageDto({ id: 'b', parentId: 'p', createdAt: chatTime(7) });
    const y = messageDto({ id: 'a', parentId: 'p', createdAt: chatTime(7) });

    const result = branchesOf([x, y]);

    expect(result.get('a')?.index).toBe(0);
    expect(result.get('b')?.index).toBe(1);
  });
});

describe('message conversion', () => {
  it('turns a stored message into a finished UI message', () => {
    const message = messageDto({ id: 'a1', role: MessageDtoRole.assistant, parts: textParts('Hi') });

    expect(toUiMessage(message)).toEqual({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hi', state: 'done' }],
    });
  });

  it('joins the text parts and ignores parts that are not text', () => {
    const message: Pick<UIMessage, 'parts'> = {
      parts: [
        { type: 'text', text: 'Hallo ' },
        { type: 'step-start' },
        { type: 'text', text: 'Welt' },
      ],
    };

    expect(messageText(message)).toBe('Hallo Welt');
  });
});

describe('serverMessageId', () => {
  it('takes the id the server announced in the metadata of a streamed answer', () => {
    const streamed: UIMessage = {
      id: 'local-1',
      role: 'assistant',
      parts: [],
      metadata: { userMessageId: 'u-srv', assistantMessageId: 'a-srv' },
    };

    expect(serverMessageId(streamed)).toBe('a-srv');
  });

  it('uses the own id for a loaded answer, a user message and unusable metadata', () => {
    expect(serverMessageId({ id: 'a1', role: 'assistant', parts: [] })).toBe('a1');
    expect(
      serverMessageId({
        id: 'u1',
        role: 'user',
        parts: [],
        metadata: { assistantMessageId: 'ignored' },
      })
    ).toBe('u1');
    expect(
      serverMessageId({ id: 'a2', role: 'assistant', parts: [], metadata: { assistantMessageId: 7 } })
    ).toBe('a2');
  });
});
```

`apps/web/src/features/chats/chat-errors.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/fetcher';

import { chatErrorKey, isStreamFailure, STREAM_ERROR_TEXT } from './chat-errors';

describe('isStreamFailure', () => {
  it('recognises the fixed error text the server sends inside a stream', () => {
    expect(isStreamFailure(new Error(STREAM_ERROR_TEXT))).toBe(true);
  });

  it('does not take other errors or a failed request for a stream failure', () => {
    expect(isStreamFailure(new Error('boom'))).toBe(false);
    expect(isStreamFailure(new ApiError(500, STREAM_ERROR_TEXT))).toBe(false);
    expect(isStreamFailure(STREAM_ERROR_TEXT)).toBe(false);
  });
});

describe('chatErrorKey', () => {
  it.each([
    [new Error(STREAM_ERROR_TEXT), 'chats.error.streamFailed'],
    [new ApiError(404, 'Not Found'), 'chats.error.gone'],
    [new ApiError(422, 'Unprocessable'), 'chats.error.tooLong'],
    [new ApiError(429, 'Too Many Requests'), 'chats.error.tooManyStreams'],
    [new ApiError(403, 'Forbidden'), 'error.forbidden'],
    [new ApiError(500, 'Internal'), 'error.generic'],
    [new TypeError('Failed to fetch'), 'error.network'],
  ])('maps %s to %s', (error, key) => {
    expect(chatErrorKey(error)).toBe(key);
  });
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/features/chats`
Expected: FAIL (Module `./message-tree` und `./chat-errors` fehlen).

- [ ] **Step 4: Implementieren**

`apps/web/src/features/chats/message-tree.ts`:

```ts
import type { UIMessage } from 'ai';

import type { ChatDetailDto, MessageDto } from '@/api/generated/model';

/** The server keeps the tree consistent (foreign keys, tree rules); a broken one is an error, not a smaller chat. */
export function activePath(chat: Pick<ChatDetailDto, 'messages' | 'activeLeafId'>): MessageDto[] {
  if (chat.activeLeafId === null) return [];
  const byId = new Map(chat.messages.map((message) => [message.id, message]));
  const path: MessageDto[] = [];
  const seen = new Set<string>();
  let current: string | null = chat.activeLeafId;
  while (current !== null) {
    if (seen.has(current)) throw new Error('The message tree has a cycle');
    seen.add(current);
    const message = byId.get(current);
    if (message === undefined) throw new Error('The message tree has a missing parent');
    path.push(message);
    current = message.parentId;
  }
  return path.reverse();
}

export interface Branch {
  index: number;
  count: number;
  previousId: string | null;
  nextId: string | null;
}

function bySiblingOrder(a: MessageDto, b: MessageDto): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * Where each message stands among the messages that share its parent: regenerated answers under one question,
 * edited questions under one answer, edited first messages of a chat. Computed once per loaded chat.
 */
export function branchesOf(messages: MessageDto[]): Map<string, Branch> {
  const groups = new Map<string | null, MessageDto[]>();
  for (const message of messages) {
    const group = groups.get(message.parentId);
    if (group === undefined) groups.set(message.parentId, [message]);
    else group.push(message);
  }
  const branches = new Map<string, Branch>();
  for (const group of groups.values()) {
    group.sort(bySiblingOrder);
    group.forEach((message, index) => {
      branches.set(message.id, {
        index,
        count: group.length,
        previousId: group[index - 1]?.id ?? null,
        nextId: group[index + 1]?.id ?? null,
      });
    });
  }
  return branches;
}

export function toUiMessage(message: MessageDto): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.parts.map((part) => ({
      type: 'text' as const,
      text: part.text,
      state: 'done' as const,
    })),
  };
}

export function messageText(message: Pick<UIMessage, 'parts'>): string {
  return message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
}

/**
 * A streamed answer carries the id the server stored it under in its metadata (first part of the stream); its own id
 * is a local one until the chat is reloaded. Every other message already has the server's id.
 */
export function serverMessageId(message: UIMessage): string {
  const metadata: unknown = message.metadata;
  if (
    message.role === 'assistant' &&
    typeof metadata === 'object' &&
    metadata !== null &&
    'assistantMessageId' in metadata &&
    typeof metadata.assistantMessageId === 'string'
  ) {
    return metadata.assistantMessageId;
  }
  return message.id;
}
```

`apps/web/src/features/chats/chat-errors.ts`:

```ts
import { errorMessageKey } from '@/api/error-message';
import { ApiError } from '@/api/fetcher';

/**
 * The only error text the server sends inside a stream (`STREAM_ERROR_TEXT` in the API's chat-dictionaries.ts): never
 * the provider's own words. The two values are one contract; the browser check in Task 11 covers the pair.
 */
export const STREAM_ERROR_TEXT = 'stream_failed';

/** An error that came through an open stream (the answer is stored with status `error`), not a failed request. */
export function isStreamFailure(error: unknown): boolean {
  return (
    error instanceof Error && !(error instanceof ApiError) && error.message === STREAM_ERROR_TEXT
  );
}

/** The i18n key for whatever went wrong while sending, regenerating or changing a chat. */
export function chatErrorKey(error: unknown): string {
  if (isStreamFailure(error)) return 'chats.error.streamFailed';
  return errorMessageKey(error, {
    404: 'chats.error.gone',
    422: 'chats.error.tooLong',
    429: 'chats.error.tooManyStreams',
  });
}
```

- [ ] **Step 5: i18n-Block anlegen**

In `apps/web/src/i18n/locales/de.json` am Ende des obersten Objekts (nach dem letzten vorhandenen Block, Komma davor nicht vergessen) einfügen; im vorhandenen Block `"home"` den Schlüssel `"startChat": "Chat starten"` ergänzen (steht der Block `home` nicht als Objekt da, dort anlegen: `"home": { …, "startChat": "Chat starten" }`):

```json
  "chats": {
    "untitled": "Neuer Chat",
    "messages": "Nachrichten",
    "list": {
      "title": "Chats",
      "new": "Neuer Chat",
      "search": "Chats durchsuchen",
      "empty": "Du hast noch keine Chats.",
      "noMatches": "Keine Chats gefunden.",
      "more": "Mehr laden",
      "loadingMore": "Wird geladen …",
      "delete": {
        "named": "Chat „{{title}}“ löschen",
        "title": "Chat „{{title}}“ löschen?",
        "body": "Der Chat mit allen Nachrichten wird gelöscht. Das lässt sich nicht rückgängig machen.",
        "action": "Löschen",
        "failed": "Das Löschen hat nicht geklappt."
      }
    },
    "new": {
      "title": "Neuer Chat",
      "intro": "Wähle ein Modell und schreibe deine erste Nachricht.",
      "noModels": "Es ist noch kein Modell verfügbar. Ein Administrator muss zuerst einen Anbieter verbinden.",
      "noModelsReachable": "Im Moment ist kein Modell erreichbar.",
      "toModels": "Zu den Modellen",
      "creating": "Der Chat wird angelegt …"
    },
    "model": {
      "label": "Modell",
      "provider": "Dieser Chat läuft bei: {{provider}}",
      "unavailable": "Das Modell dieses Chats ist gerade nicht verfügbar.",
      "loading": "Die Modelle werden geladen …"
    },
    "composer": {
      "label": "Nachricht",
      "placeholder": "Schreibe eine Nachricht …",
      "hint": "Die Eingabetaste sendet, Umschalt plus Eingabetaste macht eine neue Zeile.",
      "send": "Senden",
      "stop": "Stoppen"
    },
    "message": {
      "user": "Du",
      "assistant": "Modell",
      "pending": "Die Antwort wird erzeugt …",
      "empty": "Die Antwort ist leer.",
      "aborted": "Die Antwort wurde abgebrochen.",
      "failed": "Die Antwort ist fehlgeschlagen und wird dem Modell nicht mitgeschickt.",
      "regenerate": "Neu erzeugen",
      "edit": "Bearbeiten",
      "editLabel": "Nachricht bearbeiten",
      "editSend": "Als neue Version senden",
      "editCancel": "Abbrechen"
    },
    "branch": {
      "label": "Version wechseln",
      "previous": "Vorherige Version",
      "next": "Nächste Version",
      "position": "Version {{index}} von {{count}}"
    },
    "settings": {
      "open": "Einstellungen",
      "title": "Chat-Einstellungen",
      "description": "Diese Einstellungen gelten für die nächsten Antworten dieses Chats.",
      "prompt": "Anweisung für das Modell",
      "promptHint": "Zum Beispiel: Antworte kurz und auf Deutsch.",
      "temperature": "Kreativität (Temperatur, 0 bis 2)",
      "topP": "Auswahlbreite (Top-P, 0 bis 1)",
      "maxOutputTokens": "Maximale Antwortlänge (in Token, 1 bis 100000)",
      "paramsHint": "Leere Felder nutzen den Standard des Modells.",
      "invalid": "Bitte prüfe die markierten Felder.",
      "save": "Speichern",
      "saving": "Wird gespeichert …",
      "tooLong": "Die Anweisung ist zu lang."
    },
    "code": {
      "copy": "Kopieren",
      "copied": "Kopiert.",
      "copyFailed": "Kopieren ist nicht möglich."
    },
    "error": {
      "streamFailed": "Die Antwort wurde unterbrochen. Sie steht mit einem Hinweis im Verlauf.",
      "gone": "Der Chat oder das Modell ist nicht mehr verfügbar.",
      "tooLong": "Die Nachricht ist zu lang.",
      "tooManyStreams": "Es laufen schon zu viele Antworten gleichzeitig. Bitte warte einen Moment."
    }
  }
```

In `apps/web/src/i18n/locales/en.json` dieselben Schlüssel mit englischen Texten (im Block `home` zusätzlich `"startChat": "Start a chat"`):

```json
  "chats": {
    "untitled": "New chat",
    "messages": "Messages",
    "list": {
      "title": "Chats",
      "new": "New chat",
      "search": "Search chats",
      "empty": "You have no chats yet.",
      "noMatches": "No chats found.",
      "more": "Load more",
      "loadingMore": "Loading …",
      "delete": {
        "named": "Delete chat “{{title}}”",
        "title": "Delete chat “{{title}}”?",
        "body": "The chat and all its messages will be deleted. This cannot be undone.",
        "action": "Delete",
        "failed": "Deleting did not work."
      }
    },
    "new": {
      "title": "New chat",
      "intro": "Pick a model and write your first message.",
      "noModels": "No model is available yet. An administrator has to connect a provider first.",
      "noModelsReachable": "No model is reachable right now.",
      "toModels": "Go to the models",
      "creating": "Creating the chat …"
    },
    "model": {
      "label": "Model",
      "provider": "This chat runs at: {{provider}}",
      "unavailable": "The model of this chat is not available right now.",
      "loading": "Loading the models …"
    },
    "composer": {
      "label": "Message",
      "placeholder": "Write a message …",
      "hint": "Enter sends, Shift plus Enter starts a new line.",
      "send": "Send",
      "stop": "Stop"
    },
    "message": {
      "user": "You",
      "assistant": "Model",
      "pending": "The answer is being generated …",
      "empty": "The answer is empty.",
      "aborted": "The answer was stopped.",
      "failed": "The answer failed and is not sent to the model.",
      "regenerate": "Regenerate",
      "edit": "Edit",
      "editLabel": "Edit message",
      "editSend": "Send as new version",
      "editCancel": "Cancel"
    },
    "branch": {
      "label": "Switch version",
      "previous": "Previous version",
      "next": "Next version",
      "position": "Version {{index}} of {{count}}"
    },
    "settings": {
      "open": "Settings",
      "title": "Chat settings",
      "description": "These settings apply to the next answers of this chat.",
      "prompt": "Instruction for the model",
      "promptHint": "For example: Answer briefly and in German.",
      "temperature": "Creativity (temperature, 0 to 2)",
      "topP": "Selection range (top-p, 0 to 1)",
      "maxOutputTokens": "Maximum answer length (in tokens, 1 to 100000)",
      "paramsHint": "Empty fields use the model's default.",
      "invalid": "Please check the marked fields.",
      "save": "Save",
      "saving": "Saving …",
      "tooLong": "The instruction is too long."
    },
    "code": {
      "copy": "Copy",
      "copied": "Copied.",
      "copyFailed": "Copying is not possible."
    },
    "error": {
      "streamFailed": "The answer was interrupted. It is in the history with a note.",
      "gone": "The chat or the model is no longer available.",
      "tooLong": "The message is too long.",
      "tooManyStreams": "Too many answers are running at the same time. Please wait a moment."
    }
  }
```

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @owui/web exec vitest run src/features/chats src/i18n`
Expected: PASS (inklusive `locales.spec.ts`: gleiche Schlüssel, keine leeren Texte).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/chats apps/web/src/test/fixtures.ts apps/web/src/i18n
git commit -m "feat(web): derive the active branch and error texts of a chat

The server sends the whole message tree flat. activePath, branchesOf and the
UIMessage conversion turn it into the shown branch with its siblings; a broken
tree fails instead of showing half a chat. The chats i18n block lands here."
```

---

### Task 3: Transport des Streams

`useChat` bekommt einen `DefaultChatTransport`, der nur `{ parentId, text }` sendet, Regenerieren auf die eigene Route abbildet und die Sitzungsregeln von `apiFetch` einhält (Cookie, CSRF-Token, `traceparent`, 401, Fehler als `ApiError`). Das Verhalten von `regenerate({ messageId })` war in der Spec nur aus den Typen abgeleitet; der Test hier und die Komponententests in Task 9 belegen es.

**Files:**
- Modify: `apps/web/package.json` (per `pnpm add`), `apps/web/src/api/fetcher.ts`, `apps/web/src/api/fetcher.spec.ts`, `apps/web/src/test/stub-api.ts`, `apps/web/src/test/setup.ts`
- Create: `apps/web/src/features/chats/chat-transport.ts`, `chat-transport.spec.ts`, `apps/web/src/test/sse.ts`

**Interfaces:**
- Consumes: `messageText`, `serverMessageId` (Task 2); `csrfHeaderFor`, `notifyUnauthorized`, `createTraceparent`; `StreamChatDto`.
- Produces:
  - `readApiError(response: Response): Promise<ApiError>` in `fetcher.ts`
  - `chatFetch(input, init?): Promise<Response>` und `createChatTransport(chatId: string): DefaultChatTransport<UIMessage>`
  - Test-Helfer: `answerChunks(text, ids)`, `sseResponse(chunks)`, `openSse(signal?)` mit `send(chunk)` und `end()`; `StubRequest.signal`; Standard-Antwort `GET /api/chats` (leere Liste) in `stubApi`

- [ ] **Step 1: Abhängigkeiten holen und prüfen (Regel 10)**

Run: `pnpm --filter @owui/web add ai@^7.0.127 @ai-sdk/react@^4.0.140`
Expected: beide in `apps/web/package.json` unter `dependencies`; `ai` passt zum Bereich in `apps/api/package.json` (ein Exemplar im Lockfile: `pnpm why ai --filter @owui/web` zeigt eine Version). Meldet pnpm fehlende Peer-Abhängigkeiten (`zod`), die automatisch installierten Peers akzeptieren, keine zusätzlichen Pakete von Hand ergänzen.

Run: `pnpm audit --prod`
Expected: keine bekannten Schwachstellen. Meldet er etwas für die neuen Pakete, in der Commit-Nachricht und im DoD nennen, nicht still übergehen.

Run: `grep -n "\"react\"" apps/web/package.json && pnpm --filter @owui/web exec node -e "console.log(require('@ai-sdk/react/package.json').peerDependencies)"`
Expected: React `^19.3.0` liegt im Bereich `^19.2.1` des Peers.

- [ ] **Step 2: Test-Helfer anlegen**

`apps/web/src/test/sse.ts`:

```ts
const encoder = new TextEncoder();

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'x-vercel-ai-ui-message-stream': 'v1',
};

type Chunk = Record<string, unknown>;

function frame(chunk: Chunk): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
}

const DONE = encoder.encode('data: [DONE]\n\n');

/** What the server streams for one finished text answer (UI message stream, first part carries the ids). */
export function answerChunks(
  text: string,
  ids: { userMessageId: string; assistantMessageId: string }
): Chunk[] {
  return [
    { type: 'start', messageId: 'local-answer', messageMetadata: ids },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: text },
    { type: 'text-end', id: 't1' },
    { type: 'finish' },
  ];
}

/** A complete answer that is already there. */
export function sseResponse(chunks: Chunk[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(frame(chunk));
      controller.enqueue(DONE);
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: SSE_HEADERS });
}

/**
 * An answer the test feeds piece by piece, to look at the screen while it streams. When the request is aborted
 * (pass the request's `signal`), the stream fails like a real aborted response.
 */
export function openSse(signal?: AbortSignal) {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
  });
  signal?.addEventListener('abort', () => {
    controller?.error(new DOMException('The operation was aborted.', 'AbortError'));
  });
  return {
    response: new Response(body, { status: 200, headers: SSE_HEADERS }),
    send(chunk: Chunk) {
      controller?.enqueue(frame(chunk));
    },
    end() {
      controller?.enqueue(DONE);
      controller?.close();
    },
    /** The connection breaks in the middle of the answer (a network error, no abort). */
    fail() {
      controller?.error(new TypeError('network error'));
    },
  };
}
```

In `apps/web/src/test/stub-api.ts`: `StubRequest` und die Antwortsuche erweitern. Das Interface ersetzen:

```ts
export interface StubRequest {
  method: string;
  url: URL;
  body: unknown;
  headers: Headers;
  /** Fires when the app aborts the request (stop button, navigation). */
  signal: AbortSignal | undefined;
}
```

Direkt unter `problem(...)` einfügen:

```ts
/** Every signed-in page shows the chat list in its sidebar: a test that does not care gets an empty one. */
const DEFAULT_HANDLERS: Record<string, Handler> = {
  'GET /api/chats': () => json(200, { items: [], nextCursor: null }),
};
```

und in `stubApi` die Handler-Suche und den Aufruf ersetzen:

```ts
    const handler = handlers[`${method} ${url.pathname}`] ?? DEFAULT_HANDLERS[`${method} ${url.pathname}`];
    if (handler === undefined) {
      return Promise.resolve(problem(404, `Unexpected request: ${method} ${url.pathname}`));
    }
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    return Promise.resolve(
      handler({
        method,
        url,
        body,
        headers: new Headers(init?.headers),
        signal: init?.signal ?? undefined,
      })
    );
```

(`handlers` bleibt dieselbe Referenz: Tests dürfen Einträge nachträglich tauschen.)

In `apps/web/src/test/setup.ts` unter dem `matchMedia`-Stub einfügen:

```ts
// jsdom has no scrollIntoView; the chat scrolls to its newest message.
Element.prototype.scrollIntoView = vi.fn();
```

- [ ] **Step 3: Failing tests schreiben**

In `apps/web/src/api/fetcher.spec.ts` den Import auf `import { ApiError, apiFetch, readApiError } from './fetcher';` erweitern und innerhalb von `describe('apiFetch', …)` nichts ändern; am Dateiende ein neues `describe` anfügen:

```ts
describe('readApiError', () => {
  it('turns a failed response into the error apiFetch would have thrown', async () => {
    const response = new Response(
      '{"title":"Too Many Requests","detail":"slow down","requestId":"r-1","reason":"timeout"}',
      { status: 429, headers: { 'content-type': 'application/problem+json' } }
    );

    const error = await readApiError(response);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      message: 'Too Many Requests',
      detail: 'slow down',
      requestId: 'r-1',
      reason: 'timeout',
    });
  });

  it('names the status when the body is not a problem document', async () => {
    const error = await readApiError(new Response('<html>Bad Gateway</html>', { status: 502 }));

    expect(error.message).toBe('Request failed (502)');
    expect(error.detail).toBeUndefined();
  });
});
```

`apps/web/src/features/chats/chat-transport.spec.ts`:

```ts
import type { UIMessage } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { rememberCsrfToken, setUnauthorizedHandler } from '@/api/session-state';
import { problem, stubApi } from '@/test/stub-api';
import { answerChunks, sseResponse } from '@/test/sse';

import { createChatTransport } from './chat-transport';

afterEach(() => {
  vi.unstubAllGlobals();
  rememberCsrfToken(undefined);
  setUnauthorizedHandler(undefined);
});

const CHAT = 'c-1';
const IDS = { userMessageId: 'u-srv', assistantMessageId: 'a-srv' };

function userMessage(id: string, text: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}

function answer(id: string, text: string, metadata?: unknown): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', text }], metadata };
}

type Trigger = 'submit-message' | 'regenerate-message';

async function send(messages: UIMessage[], trigger: Trigger = 'submit-message', messageId?: string) {
  const transport = createChatTransport(CHAT);
  await transport.sendMessages({ chatId: CHAT, messages, trigger, messageId, abortSignal: undefined });
}

function stubStream() {
  return stubApi({
    [`POST /api/chats/${CHAT}/stream`]: () => sseResponse(answerChunks('ok', IDS)),
    [`POST /api/chats/${CHAT}/messages/a-1/regenerate`]: () => sseResponse(answerChunks('ok', IDS)),
  });
}

function lastCall(fetchMock: ReturnType<typeof stubApi>) {
  const call = fetchMock.mock.calls.at(-1);
  if (call === undefined) throw new Error('no request was made');
  const [input, init] = call;
  return {
    url: String(input),
    headers: new Headers(init?.headers),
    credentials: init?.credentials,
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

describe('createChatTransport', () => {
  it('sends only the new text and its parent, never the history', async () => {
    const fetchMock = stubStream();

    await send([
      userMessage('u-1', 'Hallo'),
      answer('local-1', 'Hi', { assistantMessageId: 'a-srv-1' }),
      userMessage('local-2', 'Und jetzt?'),
    ]);

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/chats/${CHAT}/stream`);
    expect(call.body).toEqual({ parentId: 'a-srv-1', text: 'Und jetzt?' });
  });

  it('hangs the first message of a chat, and an edited first message, under no parent', async () => {
    const fetchMock = stubStream();

    await send([userMessage('u-1', 'Erste Frage')]);

    expect(lastCall(fetchMock).body).toEqual({ parentId: null, text: 'Erste Frage' });
  });

  it('uses the id of a loaded answer as the parent of an edited question', async () => {
    const fetchMock = stubStream();

    await send([userMessage('u-1', 'a'), answer('a-1', 'b'), userMessage('u-2', 'c bearbeitet')]);

    expect(lastCall(fetchMock).body).toEqual({ parentId: 'a-1', text: 'c bearbeitet' });
  });

  it('regenerates through the route of the answer with an empty body', async () => {
    const fetchMock = stubStream();

    await send([userMessage('u-1', 'Hallo')], 'regenerate-message', 'a-1');

    const call = lastCall(fetchMock);
    expect(call.url).toBe(`/api/chats/${CHAT}/messages/a-1/regenerate`);
    expect(call.body).toEqual({});
  });

  it('refuses to regenerate without knowing which answer', async () => {
    stubStream();

    await expect(send([userMessage('u-1', 'Hallo')], 'regenerate-message')).rejects.toThrow(
      /id of the answer/
    );
  });

  it('refuses to send when the last message is not a user message', async () => {
    stubStream();

    await expect(send([userMessage('u-1', 'Hallo'), answer('a-1', 'Hi')])).rejects.toThrow(
      /user message/
    );
  });

  it('carries the session: cookie, token of the session and a trace', async () => {
    rememberCsrfToken('csrf-1');
    const fetchMock = stubStream();

    await send([userMessage('u-1', 'Hallo')]);

    const call = lastCall(fetchMock);
    expect(call.credentials).toBe('include');
    expect(call.headers.get('x-csrf-token')).toBe('csrf-1');
    expect(call.headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(call.headers.get('content-type')).toBe('application/json');
  });

  it('fails with an ApiError that carries the status when the server refuses the stream', async () => {
    stubApi({ [`POST /api/chats/${CHAT}/stream`]: () => problem(429, 'Too Many Requests') });

    await expect(send([userMessage('u-1', 'Hallo')])).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      message: 'Too Many Requests',
    });
  });

  it('tells the app that the session is over on a 401', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubApi({ [`POST /api/chats/${CHAT}/stream`]: () => problem(401, 'Unauthorized') });

    await expect(send([userMessage('u-1', 'Hallo')])).rejects.toMatchObject({ status: 401 });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/api/fetcher.spec.ts src/features/chats/chat-transport.spec.ts`
Expected: FAIL (`readApiError` und `./chat-transport` fehlen).

- [ ] **Step 5: Implementieren**

In `apps/web/src/api/fetcher.ts` den Fehleraufbau in eine Funktion ziehen. Vor `apiFetch` einfügen:

```ts
function toApiError(status: number, body: unknown): ApiError {
  return new ApiError(
    status,
    stringField(body, 'title') ?? `Request failed (${status})`,
    stringField(body, 'detail'),
    stringField(body, 'requestId'),
    stringField(body, 'reason')
  );
}

/**
 * For callers that read a failed response themselves (the chat stream keeps its body as a stream, so it cannot
 * go through `apiFetch`): the same error `apiFetch` would have thrown.
 */
export async function readApiError(response: Response): Promise<ApiError> {
  const text = await response.text();
  return toApiError(response.status, text === '' ? undefined : parseJson(text));
}
```

und in `apiFetch` den `throw new ApiError(...)`-Block ersetzen durch:

```ts
    throw toApiError(response.status, body);
```

`apps/web/src/features/chats/chat-transport.ts`:

```ts
import { DefaultChatTransport, type UIMessage } from 'ai';

import { readApiError } from '@/api/fetcher';
import type { StreamChatDto } from '@/api/generated/model';
import { csrfHeaderFor, notifyUnauthorized } from '@/api/session-state';
import { createTraceparent } from '@/api/trace';

import { messageText, serverMessageId } from './message-tree';

/** The two ways `useChat` asks the transport to send (values of the AI SDK's `trigger`). */
const TRIGGER = { SUBMIT: 'submit-message', REGENERATE: 'regenerate-message' } as const;

/**
 * `fetch` for the chat stream. The session rules of `apiFetch` (cookie, token of the session on writes, trace, a 401
 * ends the session, a failure is an `ApiError`), but the body of a good answer stays a stream.
 */
export async function chatFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('traceparent', createTraceparent());
  const token = csrfHeaderFor(init.method ?? 'POST');
  if (token !== undefined) headers.set('X-CSRF-Token', token);

  const response = await fetch(input, { ...init, headers, credentials: 'include' });
  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    throw await readApiError(response);
  }
  return response;
}

/** Only the new text and where it hangs: the server builds the history from its own tree (ADR 0004). */
function sendBody(messages: UIMessage[]): StreamChatDto {
  const last = messages.at(-1);
  if (last?.role !== 'user') throw new Error('The last message of a send must be a user message');
  const previous = messages.at(-2);
  return {
    parentId: previous === undefined ? null : serverMessageId(previous),
    text: messageText(last),
  };
}

export function createChatTransport(chatId: string): DefaultChatTransport<UIMessage> {
  const chat = encodeURIComponent(chatId);
  return new DefaultChatTransport<UIMessage>({
    api: `/api/chats/${chat}/stream`,
    credentials: 'include',
    fetch: chatFetch,
    prepareSendMessagesRequest: ({ messages, trigger, messageId }) => {
      if (trigger === TRIGGER.REGENERATE) {
        if (messageId === undefined) throw new Error('Regenerating needs the id of the answer');
        return {
          api: `/api/chats/${chat}/messages/${encodeURIComponent(messageId)}/regenerate`,
          body: {},
        };
      }
      return { body: sendBody(messages) };
    },
  });
}
```

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @owui/web exec vitest run src/api src/features/chats`
Expected: PASS. Hängt ein Test, weil `DefaultChatTransport` im jsdom-Umfeld Stream-Klassen vermisst (`TextDecoderStream`, `TransformStream`), die Node-Globals im Vitest-Setup (`setup.ts`) nicht überschreiben; das Fehlen melden und nicht mit Polyfills überdecken, ohne vorher zu prüfen, ob `environment: 'jsdom'` sie ausblendet.

Run: `pnpm --filter @owui/web exec vitest run`
Expected: alle Web-Tests grün (der Standard-Handler für `GET /api/chats` verändert bestehende Tests nicht).

Mutationsprobe: in `chat-transport.ts` `parentId: …` fest auf `null` setzen → der erste und dritte Test werden rot. Zurücksetzen.

- [ ] **Step 7: `pnpm check`, Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src
git commit -m "feat(web): add the chat stream transport

Adds ai and @ai-sdk/react (useChat, DefaultChatTransport; checked against the installed
types, audit clean). The transport sends only { parentId, text }, maps regenerate to
its own route and keeps the session rules of apiFetch; a refused request becomes an
ApiError. readApiError is shared with apiFetch."
```

---

### Task 4: Markdown ohne HTML, ohne Bilder

Die Modellausgabe ist unvertraut (Invariante 7a). `MarkdownContent` stellt sie mit `react-markdown` dar: rohes HTML wird zu Text, Links nur mit festen Schemata, Bilder werden nie geladen (sonst könnte eine Prompt Injection Daten über eine Bild-URL ausleiten), Codeblöcke werden hervorgehoben und lassen sich kopieren.

**Files:**
- Create: `apps/web/src/features/chats/markdown/safe-href.ts`, `safe-href.spec.ts`, `node-text.ts`, `code-block.tsx`, `markdown-content.tsx`, `markdown-content.spec.tsx`
- Modify: `apps/web/package.json` (per `pnpm add`), `apps/web/src/index.css`

**Interfaces:**
- Consumes: `Button`, i18n-Schlüssel `chats.code.*` (Task 2).
- Produces: `safeHref(url: string | undefined): string | undefined`, `safeUrlTransform(url: string): string`, `nodeText(node): string`, `MarkdownContent({ text }: { text: string })`, `CodeBlock({ text, children })`.

- [ ] **Step 1: Abhängigkeiten holen und prüfen (Regel 10)**

Run: `pnpm --filter @owui/web add react-markdown@^10.1.0 remark-gfm@^4.0.1 rehype-highlight@^7.0.2 && pnpm audit --prod`
Expected: drei neue Einträge in `dependencies`, keine bekannten Schwachstellen. Geprüft am 2026-10-10 gegen die installierten Typen: `react-markdown` 10 hat `components`, `urlTransform`, `remarkPlugins`, `rehypePlugins`; rohes HTML wird ohne `rehype-raw` zu Text (Option `skipHtml` lässt es weg); `rehype-highlight` 7 hat `detect` (Standard `false`), registriert die Sprachen `common` und setzt die Klassen `hljs`, `language-x`, `hljs-keyword` und so weiter.

- [ ] **Step 2: Failing tests schreiben**

`apps/web/src/features/chats/markdown/safe-href.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { safeHref, safeUrlTransform } from './safe-href';

describe('safeHref', () => {
  it.each([
    ['https://example.test/a?b=1#c', 'https://example.test/a?b=1#c'],
    ['http://example.test/', 'http://example.test/'],
    ['mailto:ben@example.test', 'mailto:ben@example.test'],
  ])('lets %s through', (url, expected) => {
    expect(safeHref(url)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    '\tjavascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'ftp://example.test/x',
    'tel:+491234',
    '/relative/path',
    '//example.test/x',
    '#anchor',
    '',
  ])('refuses %j', (url) => {
    expect(safeHref(url)).toBeUndefined();
  });

  it('refuses a missing url', () => {
    expect(safeHref(undefined)).toBeUndefined();
  });
});

describe('safeUrlTransform', () => {
  it('answers an empty string for an unsafe url, so no attribute is set', () => {
    expect(safeUrlTransform('javascript:alert(1)')).toBe('');
    expect(safeUrlTransform('https://example.test/')).toBe('https://example.test/');
  });
});
```

`apps/web/src/features/chats/markdown/markdown-content.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownContent } from './markdown-content';

function renderMarkdown(text: string) {
  return render(<MarkdownContent text={text} />);
}

describe('MarkdownContent', () => {
  it('renders emphasis, lists and GFM tables', () => {
    renderMarkdown('**fett**\n\n- eins\n- zwei\n\n| A | B |\n|---|---|\n| 1 | 2 |\n');

    expect(screen.getByText('fett').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
  });

  it('shows raw HTML as text and creates no element from it', () => {
    const { container } = renderMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(2)</script>');

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(2)</script>');
  });

  it('never loads an image: it shows a link with the alt text instead', () => {
    const { container } = renderMarkdown('![Logo](https://evil.test/p.png?d=secret)');

    expect(container.querySelector('img')).toBeNull();
    const link = screen.getByRole('link', { name: 'Logo' });
    expect(link).toHaveAttribute('href', 'https://evil.test/p.png?d=secret');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the alt text of an image with an unsafe source as plain text', () => {
    const { container } = renderMarkdown('![nur Text](javascript:alert(1))');

    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('nur Text');
  });

  it('opens good links in a new tab without handing over the opener', () => {
    renderMarkdown('[Doku](https://example.test/doku) und [Mail](mailto:ben@example.test)');

    const doku = screen.getByRole('link', { name: 'Doku' });
    expect(doku).toHaveAttribute('href', 'https://example.test/doku');
    expect(doku).toHaveAttribute('target', '_blank');
    expect(doku).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Mail' })).toHaveAttribute(
      'href',
      'mailto:ben@example.test'
    );
  });

  it.each([
    ['[Klick](javascript:alert(1))', 'Klick'],
    ['[Daten](data:text/html;base64,PHNjcmlwdD4=)', 'Daten'],
    ['[Intern](/admin/users)', 'Intern'],
  ])('keeps the text of %s but makes no link of it', (markdown, text) => {
    const { container } = renderMarkdown(markdown);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container).toHaveTextContent(text);
  });

  it('highlights a labelled code block', () => {
    const { container } = renderMarkdown('```js\nconst x = 1;\n```');

    expect(container.querySelector('.hljs-keyword')).toHaveTextContent('const');
  });

  it('copies the exact code of a block', async () => {
    const user = userEvent.setup();
    renderMarkdown('```js\nconst x = 1;\nconsole.log(x);\n```');

    await user.click(screen.getByRole('button', { name: 'Kopieren' }));

    expect(await navigator.clipboard.readText()).toBe('const x = 1;\nconsole.log(x);');
    expect(await screen.findByText('Kopiert.')).toBeInTheDocument();
  });

  it('says so when copying is not possible', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    renderMarkdown('```\nplain\n```');

    await user.click(screen.getByRole('button', { name: 'Kopieren' }));

    expect(await screen.findByText('Kopieren ist nicht möglich.')).toBeInTheDocument();
  });

  it('scrolls a long line inside the code block instead of the page', () => {
    const { container } = renderMarkdown('```\n' + 'x'.repeat(500) + '\n```');

    expect(container.querySelector('pre')).toHaveClass('overflow-x-auto');
  });
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/features/chats/markdown`
Expected: FAIL (Module fehlen).

- [ ] **Step 4: Implementieren**

`apps/web/src/features/chats/markdown/safe-href.ts`:

```ts
/** The only schemes a link out of model output may use. Everything else (javascript:, data:, relative paths) is text. */
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** The normalised URL if it is absolute and uses a safe scheme, otherwise `undefined`. */
export function safeHref(url: string | undefined): string | undefined {
  if (url === undefined || !URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  return LINK_PROTOCOLS.has(parsed.protocol) ? parsed.href : undefined;
}

/** For `react-markdown`'s `urlTransform`: an unsafe URL becomes empty, so the component sees no `href` or `src`. */
export function safeUrlTransform(url: string): string {
  return safeHref(url) ?? '';
}
```

`apps/web/src/features/chats/markdown/node-text.ts`:

```ts
interface TextNode {
  type: string;
  value?: string;
  children?: TextNode[];
}

/** The plain text of a syntax-tree node (what the user sees in a code block, without the highlighting spans). */
export function nodeText(node: TextNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(nodeText).join('');
}
```

`apps/web/src/features/chats/markdown/code-block.tsx`:

```tsx
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

const COPY_STATE = { IDLE: 'idle', COPIED: 'copied', FAILED: 'failed' } as const;
type CopyState = (typeof COPY_STATE)[keyof typeof COPY_STATE];

const FEEDBACK_MS = 2000;

/** A fenced code block with a copy button. `text` is the code as plain text, `children` the highlighted markup. */
export function CodeBlock({ text, children }: { text: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [copy, setCopy] = useState<CopyState>(COPY_STATE.IDLE);

  useEffect(() => {
    if (copy === COPY_STATE.IDLE) return;
    const timer = window.setTimeout(() => {
      setCopy(COPY_STATE.IDLE);
    }, FEEDBACK_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copy]);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopy(COPY_STATE.COPIED);
    } catch {
      // Handled by showing it: no clipboard permission, or an insecure context.
      setCopy(COPY_STATE.FAILED);
    }
  }

  return (
    <div className="bg-muted my-2 overflow-hidden rounded-lg border [&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0">
      <div className="flex items-center justify-end gap-2 border-b px-2 py-1">
        <span role="status" className="text-muted-foreground text-xs">
          {copy === COPY_STATE.COPIED && t('chats.code.copied')}
          {copy === COPY_STATE.FAILED && t('chats.code.copyFailed')}
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            void copyText();
          }}
        >
          {t('chats.code.copy')}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 text-sm">{children}</pre>
    </div>
  );
}
```

`apps/web/src/features/chats/markdown/markdown-content.tsx`:

```tsx
import Markdown, { type Components, type Options } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

import { CodeBlock } from './code-block';
import { nodeText } from './node-text';
import { safeUrlTransform } from './safe-href';

const LINK_CLASS = 'text-primary underline underline-offset-2';

/**
 * Model output is untrusted (invariant 7a): no raw HTML (react-markdown turns it into text), links only with the
 * schemes of `safeHref`, and no image is ever loaded: an image becomes a link with its alt text, so a prompt
 * injection cannot send data out through an image URL.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href === undefined || href === '' ? (
      <span>{children}</span>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        {children}
      </a>
    ),
  img: ({ src, alt }) => {
    const href = typeof src === 'string' ? src : '';
    if (href === '') return <span>{alt}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        {alt === undefined || alt === '' ? href : alt}
      </a>
    );
  },
  pre: ({ node, children }) => (
    <CodeBlock text={(node === undefined ? '' : nodeText(node)).replace(/\n$/, '')}>
      {children}
    </CodeBlock>
  ),
  code: ({ className, children }) => (
    <code className={cn('bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]', className)}>
      {children}
    </code>
  ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{children}</ol>,
  li: ({ children }) => <li className="my-1">{children}</li>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-xl font-semibold">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-4 mb-2 text-lg font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-3 mb-1 text-base font-semibold">{children}</h5>,
  blockquote: ({ children }) => (
    <blockquote className="text-muted-foreground my-2 border-l-2 pl-3">{children}</blockquote>
  ),
  hr: () => <hr className="my-4" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
};

const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm];
const REHYPE_PLUGINS: Options['rehypePlugins'] = [[rehypeHighlight, { detect: false }]];

export function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="min-w-0 wrap-break-word">
      <Markdown
        components={COMPONENTS}
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={safeUrlTransform}
      >
        {text}
      </Markdown>
    </div>
  );
}
```

(Überschriften der Antwort werden eine Ebene tiefer gesetzt (`h3` bis `h5`), damit die Seite genau eine `h1` behält und die Gliederung nicht springt.)

Am Ende von `apps/web/src/index.css` anfügen (Hervorhebung in den Tokens des Themes, keine Palettenfarben):

```css
/* Syntax highlighting of code blocks: the class names come from rehype-highlight. */
.hljs-comment,
.hljs-quote {
  color: var(--muted-foreground);
  font-style: italic;
}
.hljs-keyword,
.hljs-selector-tag,
.hljs-literal,
.hljs-built_in,
.hljs-type,
.hljs-section,
.hljs-strong {
  font-weight: 600;
}
.hljs-string,
.hljs-number,
.hljs-attr,
.hljs-attribute,
.hljs-symbol,
.hljs-regexp,
.hljs-meta {
  color: var(--chart-2);
}
.hljs-emphasis {
  font-style: italic;
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @owui/web exec vitest run src/features/chats/markdown`
Expected: PASS. Stolpersteine: (a) `userEvent.setup()` ersetzt `navigator.clipboard` durch einen Stub; ohne `setup()` im Test gibt es kein `readText`. (b) Zeigt `container.querySelector('.hljs-keyword')` nichts, hat `rehype-highlight` die Sprache `js` nicht erkannt: `detect: false` ist gewollt, die Sprache steht im Codeblock (` ```js `). (c) Liefert `getByRole('columnheader')` nichts, steckt die Tabelle in `div > table`; das ist in Ordnung, die Rolle hängt am `th`.

Mutationsproben, jeweils rot sehen und zurücksetzen: (1) `img` aus `COMPONENTS` entfernen → die zwei Bild-Tests werden rot (ein `<img>` entsteht). (2) In `safe-href.ts` `'javascript:'`-Schutz aufweichen (`LINK_PROTOCOLS` um `'javascript:'` erweitern) → die Tabelle und der Link-Test werden rot. (3) `urlTransform` entfernen → die Tests für `javascript:`-Links bleiben grün (die Komponente prüft nur `href`), aber der Bild-Test mit `javascript:`-Quelle zeigt dann den Standard von `react-markdown`; das ist ein Hinweis darauf, dass `urlTransform` die erste Schicht ist und der Test sie belegt.

- [ ] **Step 6: Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src
git commit -m "feat(web): render model output as safe markdown

react-markdown with remark-gfm and rehype-highlight (checked against the installed
types, audit clean). Raw HTML becomes text, links only http, https and mailto with
rel noopener noreferrer, images are never loaded (data exfiltration over an image
URL) and show as links. Code blocks scroll inside and have a copy button."
```

---

### Task 5: Chatliste in der Seitenleiste

Die Liste lädt Seiten über den Cursor des Servers, sucht im Titel (verzögert, damit nicht jeder Tastendruck eine Anfrage auslöst) und löscht mit Rückfrage. Sie steht in jeder Ansicht der angemeldeten Nutzer, deshalb hat `stubApi` seit Task 3 eine leere Standardliste.

**Files:**
- Create: `apps/web/src/hooks/use-debounced-value.ts`, `use-debounced-value.spec.ts`, `apps/web/src/features/chats/use-chat-list.ts`, `chat-list.tsx`, `delete-chat-dialog.tsx`, `chat-list.spec.tsx`
- Modify: `apps/web/src/components/layout/app-layout.tsx`

**Interfaces:**
- Consumes: `chatsList`, `getChatsListQueryKey`, `getChatsDetailQueryKey`, `useChatsRemove` (Client); `chatSummaryDto`, `chatList` (Task 2); `LoadError` (`@/components/common/load-error`).
- Produces: `useDebouncedValue<T>(value: T, delayMs: number): T`; `useChatList(search: string)` (`useInfiniteQuery`, Seiten sind `ChatListDto`); `ChatList()`; `DeleteChatDialog({ chat: ChatSummaryDto, busy: boolean, onConfirm: () => void })`; `chatTitle(title: string | null, untitled: string): string`.

- [ ] **Step 1: Failing tests schreiben**

`apps/web/src/hooks/use-debounced-value.spec.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDebouncedValue } from './use-debounced-value';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  it('passes a value on only after it stayed unchanged for the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');

    rerender({ value: 'abc' });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('abc');
  });
});
```

`apps/web/src/features/chats/chat-list.spec.tsx` (die Liste hängt in der Seitenleiste, darum über `renderApp`):

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chatDetailDto,
  chatList,
  chatSummaryDto,
  modelList,
  sessionInfo,
  userDto,
} from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { callsTo, type Handler, json, noContent, problem, stubApi } from '@/test/stub-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const BEN = userDto({ id: 'u-ben', name: 'Ben Beispiel' });
const REISE = chatSummaryDto({ id: 'c-1', title: 'Reiseplanung' });
const KOCHEN = chatSummaryDto({ id: 'c-2', title: 'Kochen' });

function stubMember(handlers: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/auth/me': () => json(200, sessionInfo(BEN)),
    'GET /api/models': () => json(200, modelList()),
    ...handlers,
  });
}

describe('ChatList', () => {
  it('lists the chats of the user as links to them', async () => {
    stubMember({ 'GET /api/chats': () => json(200, chatList([REISE, KOCHEN])) });

    renderApp('/');

    expect(await screen.findByRole('link', { name: 'Reiseplanung' })).toHaveAttribute(
      'href',
      '/chats/c-1'
    );
    expect(screen.getByRole('link', { name: 'Kochen' })).toHaveAttribute('href', '/chats/c-2');
  });

  it('names a chat without a title and shows markup in a title as text', async () => {
    const evil = chatSummaryDto({ id: 'c-3', title: '<img src=x onerror=alert(1)>' });
    stubMember({
      'GET /api/chats': () => json(200, chatList([chatSummaryDto({ id: 'c-4', title: null }), evil])),
    });

    const { container } = renderApp('/');

    expect(
      await screen.findByRole('link', { name: '<img src=x onerror=alert(1)>' })
    ).toBeInTheDocument();
    // The link to start a chat and the chat without a title carry the same name.
    expect(
      screen.getAllByRole('link', { name: 'Neuer Chat' }).map((link) => link.getAttribute('href'))
    ).toEqual(['/chats', '/chats/c-4']);
    expect(container.querySelector('img')).toBeNull();
  });

  it('says so when there are no chats and offers a new one', async () => {
    stubMember();

    renderApp('/');

    expect(await screen.findByText('Du hast noch keine Chats.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Neuer Chat' })[0]).toHaveAttribute('href', '/chats');
  });

  it('shows the failure with a retry, and the list after it worked', async () => {
    const user = userEvent.setup();
    const handlers: Record<string, Handler> = {
      'GET /api/chats': () => problem(500, 'Internal Server Error'),
    };
    stubMember(handlers);
    renderApp('/');

    await screen.findByText('Das Laden hat nicht geklappt.');
    handlers['GET /api/chats'] = () => json(200, chatList([REISE]));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('link', { name: 'Reiseplanung' })).toBeInTheDocument();
  });

  it('searches the titles after a pause in typing, with one request', async () => {
    const user = userEvent.setup();
    const fetchMock = stubMember({
      'GET /api/chats': (request) =>
        request.url.searchParams.get('q') === 'koch'
          ? json(200, chatList([KOCHEN]))
          : json(200, chatList([REISE, KOCHEN])),
    });
    renderApp('/');
    await screen.findByRole('link', { name: 'Reiseplanung' });

    await user.type(screen.getByRole('searchbox', { name: 'Chats durchsuchen' }), 'koch');

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Reiseplanung' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Kochen' })).toBeInTheDocument();
    const searches = fetchMock.mock.calls.filter(([input]) => String(input).includes('q=koch'));
    expect(searches).toHaveLength(1);
  });

  it('says that nothing was found for a search without matches', async () => {
    const user = userEvent.setup();
    stubMember({
      'GET /api/chats': (request) =>
        json(200, request.url.searchParams.has('q') ? chatList([]) : chatList([REISE])),
    });
    renderApp('/');
    await screen.findByRole('link', { name: 'Reiseplanung' });

    await user.type(screen.getByRole('searchbox', { name: 'Chats durchsuchen' }), 'zzz');

    expect(await screen.findByText('Keine Chats gefunden.')).toBeInTheDocument();
  });

  it('loads the next page with the cursor of the server', async () => {
    const user = userEvent.setup();
    stubMember({
      'GET /api/chats': (request) =>
        request.url.searchParams.get('cursor') === 'next-1'
          ? json(200, chatList([KOCHEN], null))
          : json(200, chatList([REISE], 'next-1')),
    });
    renderApp('/');
    await screen.findByRole('link', { name: 'Reiseplanung' });

    await user.click(screen.getByRole('button', { name: 'Mehr laden' }));

    expect(await screen.findByRole('link', { name: 'Kochen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mehr laden' })).not.toBeInTheDocument();
  });

  it('deletes a chat after a confirmation, with exactly one request', async () => {
    const user = userEvent.setup();
    const handlers: Record<string, Handler> = {
      'GET /api/chats': () => json(200, chatList([REISE, KOCHEN])),
      'DELETE /api/chats/c-1': () => noContent(),
    };
    const fetchMock = stubMember(handlers);
    renderApp('/');
    await screen.findByRole('link', { name: 'Reiseplanung' });

    await user.click(screen.getByRole('button', { name: 'Chat „Reiseplanung“ löschen' }));
    handlers['GET /api/chats'] = () => json(200, chatList([KOCHEN]));
    const confirm = await screen.findByRole('alertdialog');
    expect(callsTo(fetchMock, 'DELETE', '/api/chats/c-1')).toHaveLength(0);
    await user.dblClick(within(confirm).getByRole('button', { name: 'Löschen' }));

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Reiseplanung' })).not.toBeInTheDocument();
    });
    expect(callsTo(fetchMock, 'DELETE', '/api/chats/c-1')).toHaveLength(1);
  });

  it('leaves the chat that is open when it is deleted', async () => {
    const user = userEvent.setup();
    const handlers: Record<string, Handler> = {
      'GET /api/chats': () => json(200, chatList([REISE])),
      'GET /api/chats/c-1': () => json(200, chatDetailDto({ id: 'c-1', title: 'Reiseplanung' })),
      'DELETE /api/chats/c-1': () => noContent(),
    };
    stubMember(handlers);
    const { router } = renderApp('/chats/c-1');
    await screen.findByRole('heading', { name: 'Reiseplanung' });

    await user.click(screen.getByRole('button', { name: 'Chat „Reiseplanung“ löschen' }));
    handlers['GET /api/chats'] = () => json(200, chatList([]));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' })
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/chats');
    });
  });

  it('keeps the chat and says so when deleting fails', async () => {
    const user = userEvent.setup();
    stubMember({
      'GET /api/chats': () => json(200, chatList([REISE])),
      'DELETE /api/chats/c-1': () => problem(500, 'Internal Server Error'),
    });
    renderApp('/');
    await screen.findByRole('link', { name: 'Reiseplanung' });

    await user.click(screen.getByRole('button', { name: 'Chat „Reiseplanung“ löschen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' })
    );

    expect(await screen.findByText(/Das Löschen hat nicht geklappt\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reiseplanung' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/hooks src/features/chats/chat-list.spec.tsx`
Expected: FAIL (Module fehlen; die Listen-Tests finden keine Chats in der Seitenleiste).

- [ ] **Step 3: Implementieren**

`apps/web/src/hooks/use-debounced-value.ts`:

```ts
import { useEffect, useState } from 'react';

/** The value after it stayed unchanged for `delayMs`: for inputs whose every change would cost a request. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}
```

`apps/web/src/features/chats/use-chat-list.ts`:

```ts
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';

import { ApiError } from '@/api/fetcher';
import { chatsList, getChatsListQueryKey } from '@/api/generated/api';

const PAGE_SIZE = 30;

/** The first page has no cursor; an empty string stands for it so the page parameter keeps one type. */
const FIRST_PAGE = '';

/**
 * The chats of the signed-in user, newest first, in pages of the server's cursor. The key starts with the key of the
 * generated list query, so invalidating that one refreshes every search too.
 */
export function useChatList(search: string) {
  const q = search.trim();
  return useInfiniteQuery({
    queryKey: [...getChatsListQueryKey(), { q }],
    initialPageParam: FIRST_PAGE,
    queryFn: async ({ pageParam, signal }) => {
      const response = await chatsList(
        {
          limit: PAGE_SIZE,
          ...(q === '' ? {} : { q }),
          ...(pageParam === FIRST_PAGE ? {} : { cursor: pageParam }),
        },
        { signal }
      );
      // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
      if (response.status !== 200) throw new ApiError(response.status, 'Unexpected answer');
      return response.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // While a search is loading, the old list stays instead of flashing a spinner at every key.
    placeholderData: keepPreviousData,
  });
}
```

`apps/web/src/features/chats/delete-chat-dialog.tsx`:

```tsx
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatSummaryDto } from '@/api/generated/model';
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
import { SidebarMenuAction } from '@/components/ui/sidebar';

/** The title a chat is shown under: chats without one (before the first answer) are "New chat". */
export function chatTitle(title: string | null, untitled: string): string {
  return title === null || title.trim() === '' ? untitled : title;
}

export function DeleteChatDialog({
  chat,
  busy,
  onConfirm,
}: {
  chat: ChatSummaryDto;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const title = chatTitle(chat.title, t('chats.untitled'));
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <SidebarMenuAction disabled={busy} aria-label={t('chats.list.delete.named', { title })}>
          <Trash2 aria-hidden />
        </SidebarMenuAction>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('chats.list.delete.title', { title })}</AlertDialogTitle>
          <AlertDialogDescription>{t('chats.list.delete.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t('chats.list.delete.action')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

`apps/web/src/features/chats/chat-list.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useMatch, useNavigate } from 'react-router';

import { errorMessageKey } from '@/api/error-message';
import { getChatsDetailQueryKey, getChatsListQueryKey, useChatsRemove } from '@/api/generated/api';
import type { ChatSummaryDto } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { Button } from '@/components/ui/button';
import {
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from '@/components/ui/sidebar';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

import { chatTitle, DeleteChatDialog } from './delete-chat-dialog';
import { useChatList } from './use-chat-list';

const SEARCH_DEBOUNCE_MS = 300;

export function ChatList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openId = useMatch('/chats/:id')?.params.id;
  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const list = useChatList(query);
  const remove = useChatsRemove();

  function removeChat(chat: ChatSummaryDto) {
    remove.mutate(
      { id: chat.id },
      {
        onSuccess: () => {
          if (openId === chat.id) {
            // Leave first: the open view must not refetch a chat that is gone.
            void navigate('/chats');
            queryClient.removeQueries({ queryKey: getChatsDetailQueryKey(chat.id) });
          }
          void queryClient.invalidateQueries({ queryKey: getChatsListQueryKey() });
        },
      }
    );
  }

  const chats = list.data?.pages.flatMap((page) => page.items) ?? [];
  const untitled = t('chats.untitled');

  return (
    <div className="space-y-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <NavLink to="/chats" end>
              <Plus aria-hidden />
              <span>{t('chats.list.new')}</span>
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <SidebarInput
        type="search"
        value={search}
        maxLength={200}
        aria-label={t('chats.list.search')}
        placeholder={t('chats.list.search')}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      {remove.isError && (
        <p role="alert" className="text-destructive px-2 text-xs">
          {t('chats.list.delete.failed')} {t(errorMessageKey(remove.error))}
        </p>
      )}
      {list.isPending ? (
        <div role="status">
          <SidebarMenuSkeleton />
          <span className="sr-only">{t('common.loading')}</span>
        </div>
      ) : list.isError ? (
        <LoadError
          error={list.error}
          busy={list.isFetching}
          onRetry={() => {
            void list.refetch();
          }}
        />
      ) : chats.length === 0 ? (
        <p className="text-muted-foreground px-2 text-sm">
          {query.trim() === '' ? t('chats.list.empty') : t('chats.list.noMatches')}
        </p>
      ) : (
        <SidebarMenu>
          {chats.map((chat) => (
            <SidebarMenuItem key={chat.id}>
              <SidebarMenuButton asChild isActive={chat.id === openId}>
                <NavLink to={`/chats/${chat.id}`}>
                  <span className="truncate">{chatTitle(chat.title, untitled)}</span>
                </NavLink>
              </SidebarMenuButton>
              <DeleteChatDialog
                chat={chat}
                busy={remove.isPending}
                onConfirm={() => {
                  removeChat(chat);
                }}
              />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      )}
      {list.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          disabled={list.isFetchingNextPage}
          onClick={() => {
            void list.fetchNextPage();
          }}
        >
          {list.isFetchingNextPage ? t('chats.list.loadingMore') : t('chats.list.more')}
        </Button>
      )}
    </div>
  );
}
```

In `apps/web/src/components/layout/app-layout.tsx` den Import ergänzen (`SidebarGroupLabel` in die Sidebar-Importliste, `ChatList` aus `@/features/chats/chat-list`) und nach der ersten `</SidebarGroup>` (nach der Navigation, vor `</SidebarContent>`) einfügen:

```tsx
          <SidebarGroup>
            <SidebarGroupLabel>{t('chats.list.title')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <ChatList />
            </SidebarGroupContent>
          </SidebarGroup>
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @owui/web exec vitest run src/hooks src/features/chats/chat-list.spec.tsx`
Expected: PASS. Der „offener Chat“-Test braucht die Route `/chats/:id` mit `h1` aus Task 9; **er bleibt bis dahin rot** und wird in Task 9 Step 7 grün: ihn jetzt mit `it.skip` markieren und in Task 9 Step 7 wieder auf `it` stellen (das ist der einzige erlaubte Skip dieses Plans).

Run: `pnpm --filter @owui/web exec vitest run`
Expected: alle bisherigen Tests grün (die Standardliste hält die anderen Ansichten stabil). Zählt ein bestehender Test die Anfragen insgesamt oder sucht eine Rolle, die jetzt doppelt vorkommt, den Test auf die Rolle mit Namen eingrenzen; nie die Liste ausblenden.

Mutationsproben, rot sehen, zurücksetzen: (1) `useDebouncedValue` gibt sofort `value` zurück → der Such-Test zählt mehrere `q=…`-Anfragen. (2) In `removeChat` das `navigate('/chats')` entfernen → „leaves the chat that is open when it is deleted“ wird rot (nach der Aktivierung in Task 9 Step 7).

- [ ] **Step 5: `pnpm check`, Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web/src
git commit -m "feat(web): list, search and delete chats in the sidebar

Cursor pages through useInfiniteQuery and the generated chatsList, search in the
title after a 300 ms pause, delete with a confirmation (the open chat is left first).
Titles are rendered as text."
```

---

### Task 6: Einstellungen eines Chats (Anweisung und Parameter)

Der Dialog gehört zu zwei Stellen: zum offenen Chat (`PATCH /api/chats/:id` ersetzt `systemPrompt` und `params`) und zur Seite „Neuer Chat“ (dort nur Entwurf bis zur ersten Nachricht). Er arbeitet deshalb mit einem Wert `ChatSettings` und einer `onSave`-Funktion statt mit einer eigenen Anfrage.

**Files:**
- Create: `apps/web/src/components/ui/textarea.tsx` (shadcn), `apps/web/src/features/chats/chat-params-form.ts`, `chat-params-form.spec.ts`, `chat-settings-dialog.tsx`, `chat-settings-dialog.spec.tsx`

**Interfaces:**
- Consumes: `ChatParams` (typisiert seit Task 1), `errorMessageKey`, Dialog-Bausteine, `Input`, `Label`.
- Produces:
  - `PARAM_NAME`, `type ParamName`, `PARAM_LIMITS`, `type ParamsDraft = Record<ParamName, string>`
  - `draftFromParams(params: ChatParams): ParamsDraft`, `paramsFromDraft(draft: ParamsDraft): { ok: true; params: ChatParams } | { ok: false; invalid: ParamName[] }`
  - `interface ChatSettings { systemPrompt: string | null; params: ChatParams }`
  - `ChatSettingsDialog({ value: ChatSettings; onSave: (next: ChatSettings) => Promise<void> })`

- [ ] **Step 1: Textfeld-Baustein holen**

Run: `pnpm --filter @owui/web exec shadcn add textarea`
Expected: `apps/web/src/components/ui/textarea.tsx` entsteht. Fragt das Werkzeug nach Überschreiben anderer Dateien, mit „Nein“ antworten. Schlägt der Aufruf fehl (Netz), die Datei mit diesem Inhalt anlegen (Stil der übrigen Bausteine):

```tsx
import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

- [ ] **Step 2: Failing tests schreiben**

`apps/web/src/features/chats/chat-params-form.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  draftFromParams,
  PARAM_LIMITS,
  PARAM_NAME,
  paramsFromDraft,
  type ParamsDraft,
} from './chat-params-form';

const EMPTY: ParamsDraft = { temperature: '', topP: '', maxOutputTokens: '' };

describe('draftFromParams', () => {
  it('shows the stored values as text and leaves the unset ones empty', () => {
    expect(draftFromParams({ temperature: 0.7, maxOutputTokens: 2048 })).toEqual({
      temperature: '0.7',
      topP: '',
      maxOutputTokens: '2048',
    });
  });

  it('keeps a stored zero: temperature 0 is a setting, not an empty field', () => {
    expect(draftFromParams({ temperature: 0 }).temperature).toBe('0');
  });
});

describe('paramsFromDraft', () => {
  it('takes only the fields that are filled', () => {
    expect(paramsFromDraft(EMPTY)).toEqual({ ok: true, params: {} });
    expect(paramsFromDraft({ ...EMPTY, topP: '0.9' })).toEqual({ ok: true, params: { topP: 0.9 } });
  });

  it('keeps a zero', () => {
    expect(paramsFromDraft({ ...EMPTY, temperature: '0' })).toEqual({
      ok: true,
      params: { temperature: 0 },
    });
  });

  it('accepts a decimal comma and surrounding spaces', () => {
    expect(paramsFromDraft({ ...EMPTY, temperature: ' 0,7 ' })).toEqual({
      ok: true,
      params: { temperature: 0.7 },
    });
  });

  it('accepts the limits themselves', () => {
    const result = paramsFromDraft({ temperature: '2', topP: '1', maxOutputTokens: '100000' });

    expect(result).toEqual({
      ok: true,
      params: { temperature: 2, topP: 1, maxOutputTokens: 100000 },
    });
  });

  it.each([
    [PARAM_NAME.TEMPERATURE, '2.1'],
    [PARAM_NAME.TEMPERATURE, '-0.5'],
    [PARAM_NAME.TEMPERATURE, 'abc'],
    [PARAM_NAME.TEMPERATURE, '1e1'],
    [PARAM_NAME.TEMPERATURE, '0.7.1'],
    [PARAM_NAME.TOP_P, '1.01'],
    [PARAM_NAME.MAX_OUTPUT_TOKENS, '0'],
    [PARAM_NAME.MAX_OUTPUT_TOKENS, '100001'],
    [PARAM_NAME.MAX_OUTPUT_TOKENS, '1.5'],
    [PARAM_NAME.MAX_OUTPUT_TOKENS, '1,5'],
  ])('rejects %s = %j and names the field', (name, text) => {
    expect(paramsFromDraft({ ...EMPTY, [name]: text })).toEqual({ ok: false, invalid: [name] });
  });

  it('names every field that is wrong, not only the first', () => {
    expect(paramsFromDraft({ temperature: '9', topP: '9', maxOutputTokens: '5' })).toEqual({
      ok: false,
      invalid: [PARAM_NAME.TEMPERATURE, PARAM_NAME.TOP_P],
    });
  });

  it('uses the same limits as the server declares', () => {
    expect(PARAM_LIMITS).toEqual({
      temperature: { min: 0, max: 2, integer: false },
      topP: { min: 0, max: 1, integer: false },
      maxOutputTokens: { min: 1, max: 100000, integer: true },
    });
  });
});
```

`apps/web/src/features/chats/chat-settings-dialog.spec.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/fetcher';
import { renderPage } from '@/test/render-app';

import { type ChatSettings, ChatSettingsDialog } from './chat-settings-dialog';

const VALUE: ChatSettings = { systemPrompt: 'Antworte kurz.', params: { temperature: 0.5 } };

async function openDialog(onSave: (next: ChatSettings) => Promise<void>, value = VALUE) {
  const user = userEvent.setup();
  renderPage(<ChatSettingsDialog value={value} onSave={onSave} />);
  await user.click(screen.getByRole('button', { name: 'Einstellungen' }));
  return user;
}

describe('ChatSettingsDialog', () => {
  it('shows the current settings', async () => {
    await openDialog(vi.fn().mockResolvedValue(undefined));

    expect(screen.getByLabelText('Anweisung für das Modell')).toHaveValue('Antworte kurz.');
    expect(screen.getByLabelText(/Kreativität/)).toHaveValue('0.5');
    expect(screen.getByLabelText(/Auswahlbreite/)).toHaveValue('');
  });

  it('saves the changed instruction and parameters, and closes', async () => {
    const onSave = vi.fn<(next: ChatSettings) => Promise<void>>().mockResolvedValue(undefined);
    const user = await openDialog(onSave);

    await user.clear(screen.getByLabelText('Anweisung für das Modell'));
    await user.clear(screen.getByLabelText(/Kreativität/));
    await user.type(screen.getByLabelText(/Kreativität/), '0');
    await user.type(screen.getByLabelText(/Maximale Antwortlänge/), '512');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onSave).toHaveBeenCalledWith({
      systemPrompt: null,
      params: { temperature: 0, maxOutputTokens: 512 },
    });
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('does not save an invalid value, marks the field and keeps the dialog open', async () => {
    const onSave = vi.fn<(next: ChatSettings) => Promise<void>>().mockResolvedValue(undefined);
    const user = await openDialog(onSave);

    await user.clear(screen.getByLabelText(/Kreativität/));
    await user.type(screen.getByLabelText(/Kreativität/), '3');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Kreativität/)).toBeInvalid();
    expect(screen.getByText('Bitte prüfe die markierten Felder.')).toBeInTheDocument();
  });

  it('keeps the entries and says what happened when saving fails', async () => {
    const onSave = vi
      .fn<(next: ChatSettings) => Promise<void>>()
      .mockRejectedValue(new ApiError(422, 'Unprocessable'));
    const user = await openDialog(onSave);

    await user.type(screen.getByLabelText('Anweisung für das Modell'), ' Mehr.');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Die Anweisung ist zu lang.')).toBeInTheDocument();
    expect(screen.getByLabelText('Anweisung für das Modell')).toHaveValue('Antworte kurz. Mehr.');
  });

  it('saves once when the form is submitted twice quickly', async () => {
    let resolve: () => void = () => undefined;
    const onSave = vi.fn<(next: ChatSettings) => Promise<void>>().mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const user = await openDialog(onSave);

    await user.type(screen.getByLabelText(/Kreativität/), '{Enter}{Enter}');

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Wird gespeichert …' })).toBeDisabled();
    resolve();
  });

  it('starts from the stored values each time it opens', async () => {
    const user = await openDialog(vi.fn().mockResolvedValue(undefined));
    await user.type(screen.getByLabelText('Anweisung für das Modell'), ' unsaved');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Einstellungen' }));

    expect(screen.getByLabelText('Anweisung für das Modell')).toHaveValue('Antworte kurz.');
  });
});
```

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/features/chats/chat-params-form.spec.ts src/features/chats/chat-settings-dialog.spec.tsx`
Expected: FAIL (Module fehlen).

- [ ] **Step 4: Implementieren**

`apps/web/src/features/chats/chat-params-form.ts`:

```ts
import type { ChatParams } from '@/api/generated/model';

export const PARAM_NAME = {
  TEMPERATURE: 'temperature',
  TOP_P: 'topP',
  MAX_OUTPUT_TOKENS: 'maxOutputTokens',
} as const;

export type ParamName = (typeof PARAM_NAME)[keyof typeof PARAM_NAME];

/** The limits `ChatParams` declares in the API (chat-params.ts); the server checks them again. */
export const PARAM_LIMITS = {
  [PARAM_NAME.TEMPERATURE]: { min: 0, max: 2, integer: false },
  [PARAM_NAME.TOP_P]: { min: 0, max: 1, integer: false },
  [PARAM_NAME.MAX_OUTPUT_TOKENS]: { min: 1, max: 100000, integer: true },
} as const satisfies Record<ParamName, { min: number; max: number; integer: boolean }>;

const PARAM_NAMES: ParamName[] = Object.values(PARAM_NAME);

/** The text of each field while the user edits; empty means "the model's default". */
export type ParamsDraft = Record<ParamName, string>;

export function draftFromParams(params: ChatParams): ParamsDraft {
  return {
    [PARAM_NAME.TEMPERATURE]: params.temperature === undefined ? '' : String(params.temperature),
    [PARAM_NAME.TOP_P]: params.topP === undefined ? '' : String(params.topP),
    [PARAM_NAME.MAX_OUTPUT_TOKENS]:
      params.maxOutputTokens === undefined ? '' : String(params.maxOutputTokens),
  };
}

export type ParamsResult = { ok: true; params: ChatParams } | { ok: false; invalid: ParamName[] };

/** Plain non-negative numbers only: no exponent, no sign, no second dot. `Number()` alone would take "1e1" and " ". */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

function parseParam(name: ParamName, text: string): number | undefined {
  const normalised = text.trim().replace(',', '.');
  if (!PLAIN_NUMBER.test(normalised)) return undefined;
  const value = Number(normalised);
  const limits = PARAM_LIMITS[name];
  if (limits.integer && !Number.isInteger(value)) return undefined;
  return value >= limits.min && value <= limits.max ? value : undefined;
}

export function paramsFromDraft(draft: ParamsDraft): ParamsResult {
  const params: ChatParams = {};
  const invalid: ParamName[] = [];
  for (const name of PARAM_NAMES) {
    if (draft[name].trim() === '') continue;
    const value = parseParam(name, draft[name]);
    if (value === undefined) invalid.push(name);
    else params[name] = value;
  }
  return invalid.length > 0 ? { ok: false, invalid } : { ok: true, params };
}
```

`apps/web/src/features/chats/chat-settings-dialog.tsx`:

```tsx
import { Settings } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import type { ChatParams } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  draftFromParams,
  PARAM_NAME,
  type ParamName,
  type ParamsDraft,
  paramsFromDraft,
} from './chat-params-form';

export interface ChatSettings {
  systemPrompt: string | null;
  params: ChatParams;
}

const PARAM_FIELDS = [
  { name: PARAM_NAME.TEMPERATURE, labelKey: 'chats.settings.temperature' },
  { name: PARAM_NAME.TOP_P, labelKey: 'chats.settings.topP' },
  { name: PARAM_NAME.MAX_OUTPUT_TOKENS, labelKey: 'chats.settings.maxOutputTokens' },
] as const;

export function ChatSettingsDialog({
  value,
  onSave,
}: {
  value: ChatSettings;
  onSave: (next: ChatSettings) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<ParamsDraft>(() => draftFromParams(value.params));
  const [invalid, setInvalid] = useState<ParamName[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  // The state above lags one render behind a second quick submit; the ref does not.
  const savingRef = useRef(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setPrompt(value.systemPrompt ?? '');
      setDraft(draftFromParams(value.params));
      setInvalid([]);
      setError(undefined);
    }
    setOpen(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    const result = paramsFromDraft(draft);
    if (!result.ok) {
      setInvalid(result.invalid);
      return;
    }
    setInvalid([]);
    setError(undefined);
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave({
        systemPrompt: prompt.trim() === '' ? null : prompt,
        params: result.params,
      });
      setOpen(false);
    } catch (caught) {
      setError(caught);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings aria-hidden />
          {t('chats.settings.open')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('chats.settings.title')}</DialogTitle>
            <DialogDescription>{t('chats.settings.description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="chat-system-prompt">{t('chats.settings.prompt')}</Label>
            <Textarea
              id="chat-system-prompt"
              value={prompt}
              placeholder={t('chats.settings.promptHint')}
              onChange={(event) => {
                setPrompt(event.target.value);
              }}
            />
          </div>
          {PARAM_FIELDS.map(({ name, labelKey }) => (
            <div key={name} className="space-y-1.5">
              <Label htmlFor={`chat-param-${name}`}>{t(labelKey)}</Label>
              <Input
                id={`chat-param-${name}`}
                inputMode="decimal"
                value={draft[name]}
                aria-invalid={invalid.includes(name)}
                onChange={(event) => {
                  setDraft({ ...draft, [name]: event.target.value });
                }}
              />
            </div>
          ))}
          <p className="text-muted-foreground text-xs">{t('chats.settings.paramsHint')}</p>
          {invalid.length > 0 && (
            <p role="alert" className="text-destructive text-sm">
              {t('chats.settings.invalid')}
            </p>
          )}
          {error !== undefined && (
            <p role="alert" className="text-destructive text-sm">
              {t(errorMessageKey(error, { 422: 'chats.settings.tooLong' }))}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? t('chats.settings.saving') : t('chats.settings.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @owui/web exec vitest run src/features/chats/chat-params-form.spec.ts src/features/chats/chat-settings-dialog.spec.tsx`
Expected: PASS. Mutationsproben: (1) in `paramsFromDraft` `if (draft[name].trim() === '')` durch `if (!draft[name])` ersetzen ändert nichts, aber `if (!value)` nach dem Parsen (ein „0“ fällt weg) macht „keeps a zero“ rot; (2) `savingRef`-Prüfung entfernen → der Doppel-Submit-Test wird rot (zwei Aufrufe).

- [ ] **Step 6: `pnpm check`, Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web/src
git commit -m "feat(web): edit instruction and parameters of a chat

Dialog with the same limits the server enforces; empty fields mean the model's default,
a zero is kept, a decimal comma is accepted. The save function is passed in, so the
open chat (PATCH) and the new-chat page (draft) share it."
```

---

### Task 7: Eingabefeld, Versionswechsel, Nachricht, Modellauswahl

Vier Bausteine ohne eigene Anfragen: sie bekommen Werte und Rückruffunktionen. Die Nachrichtenansicht ist `memo`, die Eingabe hält ihren Text selbst, damit Tippen die Nachrichtenliste nicht neu zeichnet (bei langen Chats sonst spürbar).

**Files:**
- Create: `apps/web/src/hooks/use-latest.ts`, `apps/web/src/features/chats/composer.tsx`, `composer.spec.tsx`, `branch-switcher.tsx`, `message-item.tsx`, `message-item.spec.tsx`, `model-picker.tsx`

**Interfaces:**
- Consumes: `Branch`, `messageText` (Task 2); `MarkdownContent` (Task 4); `reasonKey`; `useModels`; `Textarea`, `NativeSelect`.
- Produces:
  - `useLatest<T>(value: T): { readonly current: T }` (Ref, nach jedem Render aktuell; für Rückrufe, die `useChat` nur einmal speichert)
  - `Composer({ busy, disabled, initialText?, onSend, onStop })`
  - `BranchSwitcher({ branch, disabled, onSwitch })`
  - `MessageItem` (`memo`) mit Props `{ message: UIMessage; stored: MessageDto | undefined; branch: Branch | undefined; live: boolean; locked: boolean; restore: EditRestore | undefined; onRegenerate(messageId: string): void; onEdit(messageId: string, text: string): void; onSwitch(messageId: string): void }` und `interface EditRestore { token: number; text: string }`
  - `ModelPicker({ value, disabled, onChange })`

- [ ] **Step 1: Failing tests schreiben**

`apps/web/src/features/chats/composer.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders, createQueryClient } from '@/app/providers';

import { Composer } from './composer';

function renderComposer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  render(
    <AppProviders queryClient={createQueryClient()}>
      <Composer busy={false} disabled={false} onSend={onSend} onStop={onStop} {...props} />
    </AppProviders>
  );
  return { onSend, onStop, user: userEvent.setup() };
}

describe('Composer', () => {
  it('sends the text with Enter and empties the field', async () => {
    const { onSend, user } = renderComposer();

    await user.type(screen.getByLabelText('Nachricht'), 'Hallo{Enter}');

    expect(onSend).toHaveBeenCalledWith('Hallo');
    expect(screen.getByLabelText('Nachricht')).toHaveValue('');
  });

  it('sends once on a double Enter', async () => {
    const { onSend, user } = renderComposer();

    await user.type(screen.getByLabelText('Nachricht'), 'Hallo{Enter}{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('starts a new line with Shift+Enter instead of sending', async () => {
    const { onSend, user } = renderComposer();

    await user.type(screen.getByLabelText('Nachricht'), 'eins{Shift>}{Enter}{/Shift}zwei');

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nachricht')).toHaveValue('eins\nzwei');
  });

  it('does not send an empty or blank message', async () => {
    const { onSend, user } = renderComposer();

    await user.type(screen.getByLabelText('Nachricht'), '   {Enter}');
    await user.click(screen.getByRole('button', { name: 'Senden' }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the text and does not send while an answer is running; the button stops instead', async () => {
    const { onSend, onStop, user } = renderComposer({ busy: true });

    await user.type(screen.getByLabelText('Nachricht'), 'schon die nächste{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nachricht')).toHaveValue('schon die nächste');
    expect(screen.queryByRole('button', { name: 'Senden' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stoppen' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('does not send while it is disabled (no model)', async () => {
    const { onSend, user } = renderComposer({ disabled: true });

    await user.type(screen.getByLabelText('Nachricht'), 'Hallo{Enter}');

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
  });

  it('starts with a given text, for a message that could not be sent', () => {
    renderComposer({ initialText: 'Das ging schief' });

    expect(screen.getByLabelText('Nachricht')).toHaveValue('Das ging schief');
  });
});
```

`apps/web/src/features/chats/message-item.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UIMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders, createQueryClient } from '@/app/providers';
import { MessageDtoRole, MessageDtoStatus } from '@/api/generated/model';
import { messageDto, textParts } from '@/test/fixtures';

import { MessageItem } from './message-item';

const ANSWER: UIMessage = {
  id: 'a1',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Das ist **fett**.' }],
};
const QUESTION: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Frage?' }] };
const STORED_ANSWER = messageDto({
  id: 'a1',
  parentId: 'u1',
  role: MessageDtoRole.assistant,
  parts: textParts('Das ist **fett**.'),
});
const STORED_QUESTION = messageDto({ id: 'u1' });

function renderItem(props: Partial<Parameters<typeof MessageItem>[0]> = {}) {
  const handlers = { onRegenerate: vi.fn(), onEdit: vi.fn(), onSwitch: vi.fn() };
  render(
    <AppProviders queryClient={createQueryClient()}>
      <MessageItem
        message={ANSWER}
        stored={STORED_ANSWER}
        branch={undefined}
        live={false}
        locked={false}
        restore={undefined}
        {...handlers}
        {...props}
      />
    </AppProviders>
  );
  return { ...handlers, user: userEvent.setup() };
}

describe('MessageItem', () => {
  it('renders an answer as markdown and a question as plain text', () => {
    const { container } = render(
      <AppProviders queryClient={createQueryClient()}>
        <MessageItem
          message={{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '**nicht fett** <b>x</b>' }] }}
          stored={STORED_QUESTION}
          branch={undefined}
          live={false}
          locked={false}
          restore={undefined}
          onRegenerate={vi.fn()}
          onEdit={vi.fn()}
          onSwitch={vi.fn()}
        />
      </AppProviders>
    );

    expect(container).toHaveTextContent('**nicht fett** <b>x</b>');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows the answer with its formatting', () => {
    renderItem();

    expect(screen.getByText('fett').tagName).toBe('STRONG');
  });

  it('offers to regenerate a stored answer', async () => {
    const { onRegenerate, user } = renderItem();

    await user.click(screen.getByRole('button', { name: 'Neu erzeugen' }));

    expect(onRegenerate).toHaveBeenCalledWith('a1');
  });

  it('offers no action for an answer the server does not know yet (just streamed)', () => {
    renderItem({ stored: undefined });

    expect(screen.queryByRole('button', { name: 'Neu erzeugen' })).not.toBeInTheDocument();
  });

  it('locks the actions while something is running', () => {
    renderItem({ locked: true });

    expect(screen.getByRole('button', { name: 'Neu erzeugen' })).toBeDisabled();
  });

  it('says that the answer is being generated while it is still empty', () => {
    renderItem({ message: { ...ANSWER, parts: [] }, stored: undefined, live: true });

    expect(screen.getByText('Die Antwort wird erzeugt …')).toBeInTheDocument();
  });

  it('marks a stopped answer and keeps its text', () => {
    renderItem({ stored: { ...STORED_ANSWER, status: MessageDtoStatus.aborted } });

    expect(screen.getByText('Die Antwort wurde abgebrochen.')).toBeInTheDocument();
    expect(screen.getByText('fett')).toBeInTheDocument();
  });

  it('marks a failed answer with the reason, says it is not sent to the model and offers a retry', () => {
    renderItem({
      stored: { ...STORED_ANSWER, status: MessageDtoStatus.error, errorReason: 'timeout' },
    });

    expect(
      screen.getByText(/Die Antwort ist fehlgeschlagen und wird dem Modell nicht mitgeschickt\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/Der Anbieter antwortet nicht rechtzeitig\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu erzeugen' })).toBeEnabled();
  });

  it('edits a question: the edited text goes out, the box closes', async () => {
    const { onEdit, user } = renderItem({ message: QUESTION, stored: STORED_QUESTION });

    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const box = screen.getByLabelText('Nachricht bearbeiten');
    expect(box).toHaveValue('Frage?');
    await user.clear(box);
    await user.type(box, 'Andere Frage?');
    await user.click(screen.getByRole('button', { name: 'Als neue Version senden' }));

    expect(onEdit).toHaveBeenCalledWith('u1', 'Andere Frage?');
    expect(screen.queryByLabelText('Nachricht bearbeiten')).not.toBeInTheDocument();
  });

  it('does not send an emptied edit and can cancel it', async () => {
    const { onEdit, user } = renderItem({ message: QUESTION, stored: STORED_QUESTION });

    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await user.clear(screen.getByLabelText('Nachricht bearbeiten'));

    expect(screen.getByRole('button', { name: 'Als neue Version senden' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByLabelText('Nachricht bearbeiten')).not.toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('opens the edit box again with the text when sending it failed', () => {
    renderItem({
      message: QUESTION,
      stored: STORED_QUESTION,
      restore: { token: 1, text: 'Nicht gesendet' },
    });

    expect(screen.getByLabelText('Nachricht bearbeiten')).toHaveValue('Nicht gesendet');
  });

  it('shows the position among the versions and switches', async () => {
    const { onSwitch, user } = renderItem({
      branch: { index: 1, count: 3, previousId: 'a0', nextId: 'a2' },
    });

    expect(screen.getByText('2/3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nächste Version' }));
    await user.click(screen.getByRole('button', { name: 'Vorherige Version' }));

    expect(onSwitch).toHaveBeenNthCalledWith(1, 'a2');
    expect(onSwitch).toHaveBeenNthCalledWith(2, 'a0');
  });

  it('shows no version switch for a single version, and disables the missing direction', () => {
    renderItem({ branch: { index: 0, count: 1, previousId: null, nextId: null } });
    expect(screen.queryByText('1/1')).not.toBeInTheDocument();
  });

  it('disables the switch at the first and the last version', () => {
    renderItem({ branch: { index: 0, count: 2, previousId: null, nextId: 'a2' } });

    expect(screen.getByRole('button', { name: 'Vorherige Version' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nächste Version' })).toBeEnabled();
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/features/chats/composer.spec.tsx src/features/chats/message-item.spec.tsx`
Expected: FAIL (Module fehlen).

- [ ] **Step 3: Implementieren**

`apps/web/src/hooks/use-latest.ts`:

```ts
import { useEffect, useRef } from 'react';

/**
 * A ref that always holds the value of the latest render. For callbacks that a library keeps from the first render
 * on (`useChat` stores its options once): they read the ref instead of a stale closure.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
```

`apps/web/src/features/chats/composer.tsx`:

```tsx
import { SendHorizontal, Square } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * The message box. It owns the text, so typing does not re-render the message list. While an answer runs, the
 * send button becomes a stop button and Enter does nothing; `disabled` is for a chat that cannot send at all.
 */
export function Composer({
  busy,
  disabled,
  initialText = '',
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled: boolean;
  /** A message that could not be sent comes back here (the parent remounts the composer with a new key). */
  initialText?: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(initialText);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  function send() {
    if (busy || disabled || text.trim() === '') return;
    onSend(text);
    setText('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter that confirms an input-method candidate must not send.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1">
      <div className="flex items-end gap-2">
        <Textarea
          ref={field}
          value={text}
          rows={2}
          className="max-h-60 resize-none"
          aria-label={t('chats.composer.label')}
          placeholder={t('chats.composer.placeholder')}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
        {busy ? (
          <Button type="button" variant="outline" onClick={onStop}>
            <Square aria-hidden />
            {t('chats.composer.stop')}
          </Button>
        ) : (
          <Button type="submit" disabled={disabled}>
            <SendHorizontal aria-hidden />
            {t('chats.composer.send')}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t('chats.composer.hint')}</p>
    </form>
  );
}
```

(`Textarea` ist eine Funktionskomponente; in React 19 reicht `ref` als normale Prop, `React.ComponentProps<'textarea'>` enthält sie.)

`apps/web/src/features/chats/branch-switcher.tsx`:

```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import type { Branch } from './message-tree';

/** "‹ 2/3 ›": the versions of a message that share a parent (regenerated answers, edited questions). */
export function BranchSwitcher({
  branch,
  disabled,
  onSwitch,
}: {
  branch: Branch;
  disabled: boolean;
  onSwitch: (messageId: string) => void;
}) {
  const { t } = useTranslation();
  if (branch.count < 2) return null;
  return (
    <div
      role="group"
      aria-label={t('chats.branch.label')}
      className="text-muted-foreground flex items-center text-xs"
    >
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('chats.branch.previous')}
        disabled={disabled || branch.previousId === null}
        onClick={() => {
          if (branch.previousId !== null) onSwitch(branch.previousId);
        }}
      >
        <ChevronLeft aria-hidden />
      </Button>
      <span aria-label={t('chats.branch.position', { index: branch.index + 1, count: branch.count })}>
        {branch.index + 1}/{branch.count}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('chats.branch.next')}
        disabled={disabled || branch.nextId === null}
        onClick={() => {
          if (branch.nextId !== null) onSwitch(branch.nextId);
        }}
      >
        <ChevronRight aria-hidden />
      </Button>
    </div>
  );
}
```

(`getByText('2/3')` findet den `span` über seinen Textinhalt, auch mit `aria-label`.)

`apps/web/src/features/chats/message-item.tsx`:

```tsx
import type { UIMessage } from 'ai';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type MessageDto, MessageDtoRole, MessageDtoStatus } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { reasonKey } from '@/features/connections/provider-reason';

import { BranchSwitcher } from './branch-switcher';
import { MarkdownContent } from './markdown/markdown-content';
import { type Branch, messageText } from './message-tree';

/** An edit that could not be sent: the text comes back into the edit box. A new token reopens it. */
export interface EditRestore {
  token: number;
  text: string;
}

interface MessageItemProps {
  message: UIMessage;
  /** The message as the server stores it; missing for a message that is only in the browser so far. */
  stored: MessageDto | undefined;
  branch: Branch | undefined;
  /** This is the answer that is being streamed right now. */
  live: boolean;
  /** Something runs (an answer, a switch): no action is possible. */
  locked: boolean;
  restore: EditRestore | undefined;
  onRegenerate: (messageId: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onSwitch: (messageId: string) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  stored,
  branch,
  live,
  locked,
  restore,
  onRegenerate,
  onEdit,
  onSwitch,
}: MessageItemProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // A failed edit reopens the box: reacting to a new token while rendering (not in an effect) avoids a flash. The
  // initial value is empty on purpose: the item remounts when the failed send is rolled back, and must open then.
  const [seenToken, setSeenToken] = useState<number | undefined>(undefined);
  if (restore !== undefined && restore.token !== seenToken) {
    setSeenToken(restore.token);
    setEditing(true);
    setDraft(restore.text);
  }

  const text = messageText(message);
  const isUser = message.role === 'user';
  const actionable = stored !== undefined && !live;

  return (
    <li className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium">
        {isUser ? t('chats.message.user') : t('chats.message.assistant')}
      </p>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            aria-label={t('chats.message.editLabel')}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={locked || draft.trim() === ''}
              onClick={() => {
                setEditing(false);
                onEdit(message.id, draft);
              }}
            >
              {t('chats.message.editSend')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
              }}
            >
              {t('chats.message.editCancel')}
            </Button>
          </div>
        </div>
      ) : isUser ? (
        <p className="wrap-break-word whitespace-pre-wrap">{text}</p>
      ) : text === '' ? (
        <p className="text-muted-foreground text-sm">
          {live ? t('chats.message.pending') : t('chats.message.empty')}
        </p>
      ) : (
        <MarkdownContent text={text} />
      )}
      {stored?.status === MessageDtoStatus.aborted && (
        <p className="text-muted-foreground text-sm">{t('chats.message.aborted')}</p>
      )}
      {stored?.status === MessageDtoStatus.error && (
        <p role="note" className="text-destructive text-sm">
          {t('chats.message.failed')}
          {stored.errorReason !== null && ` ${t(reasonKey(stored.errorReason))}`}
        </p>
      )}
      {actionable && !editing && (
        <div className="flex flex-wrap items-center gap-1">
          {branch !== undefined && (
            <BranchSwitcher branch={branch} disabled={locked} onSwitch={onSwitch} />
          )}
          {stored.role === MessageDtoRole.assistant ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={locked}
              onClick={() => {
                onRegenerate(message.id);
              }}
            >
              {t('chats.message.regenerate')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              disabled={locked}
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
            >
              {t('chats.message.edit')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
});
```

`apps/web/src/features/chats/model-picker.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';
import { useModels } from '@/features/models/use-models';

/**
 * Picks the model of a chat. The value is always what the chat stores: if that model is not in the list any more
 * (connection down, model removed) it still shows under its id, with a warning, instead of jumping to another model.
 */
export function ModelPicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const models = useModels();
  const available = models.data?.models ?? [];
  const selected = available.find((model) => model.id === value);
  const missing = models.isSuccess && selected === undefined;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label htmlFor="chat-model">{t('chats.model.label')}</Label>
        <NativeSelect
          id="chat-model"
          value={value}
          disabled={disabled || models.isPending}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {(missing || !models.isSuccess) && <NativeSelectOption value={value}>{value}</NativeSelectOption>}
          {available.map((model) => (
            <NativeSelectOption key={model.id} value={model.id}>
              {model.name} ({model.providerName})
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {selected !== undefined && (
        <p className="text-muted-foreground text-xs">
          {t('chats.model.provider', { provider: selected.providerName })}
        </p>
      )}
      {missing && (
        <p role="alert" className="text-destructive text-xs">
          {t('chats.model.unavailable')}
        </p>
      )}
      {models.isPending && <p className="text-muted-foreground text-xs">{t('chats.model.loading')}</p>}
    </div>
  );
}
```

(Schlägt das Laden der Modelle fehl, bleibt die Auswahl mit der gespeicherten ID bedienbar für den Chat; das Senden hängt nicht an der Liste, sondern an der Antwort des Servers: ein nicht mehr vorhandenes Modell ergibt dort `404`, und Task 9 zeigt „nicht mehr verfügbar“.)

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @owui/web exec vitest run src/features/chats/composer.spec.tsx src/features/chats/message-item.spec.tsx`
Expected: PASS. Stolperstein: der Knopf zum Senden einer Bearbeitung heißt „Als neue Version senden“, damit er sich in der Seite nicht mit „Senden“ des Eingabefelds überschneidet. Mutationsproben, rot sehen, zurücksetzen: (1) `if (busy || disabled …)` in `send` ohne `busy` → der Test „keeps the text and does not send“ wird rot; (2) `actionable` auf `true` setzen → „offers no action for an answer the server does not know yet“ wird rot; (3) `disabled={locked}` am Regenerieren-Knopf entfernen → „locks the actions“ wird rot.

- [ ] **Step 5: `pnpm check`, Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web/src
git commit -m "feat(web): add composer, message item, version switch and model picker

The composer owns its text so typing does not re-render the list; Enter sends once,
Shift+Enter is a new line, the button turns into stop while an answer runs. Messages
the server does not know yet offer no action. A model that is gone stays selected
with a warning."
```

---

### Task 8: Titel nachladen

Der Server setzt zuerst einen Ersatztitel (aus der ersten Nachricht) und erzeugt den eigentlichen Titel in einem Job nach der ersten vollständigen Antwort (`titleSource` wechselt von `fallback` auf `generated`). Die Seite fragt deshalb eine Weile nach, ohne Dauerabfrage.

**Files:**
- Create: `apps/web/src/features/chats/use-title-polling.ts`, `use-title-polling.spec.tsx`

**Interfaces:**
- Consumes: `getChatsDetailQueryKey`, `getChatsListQueryKey`, `ChatDetailDtoTitleSource`, `MessageDtoRole`, `MessageDtoStatus`; `chatDetailDto`, `messageDto` (Task 2).
- Produces: `TITLE_POLL = { INTERVAL_MS: 3000, MAX_TICKS: 10 }` und `useTitlePolling(chat: Pick<ChatDetailDto, 'id' | 'titleSource' | 'messages'>, idle: boolean): void`.

- [ ] **Step 1: Failing test schreiben**

`apps/web/src/features/chats/use-title-polling.spec.tsx`:

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getChatsDetailQueryKey, getChatsListQueryKey } from '@/api/generated/api';
import {
  type ChatDetailDto,
  ChatDetailDtoTitleSource,
  MessageDtoRole,
  MessageDtoStatus,
} from '@/api/generated/model';
import { createQueryClient } from '@/app/providers';
import { chatDetailDto, messageDto } from '@/test/fixtures';

import { TITLE_POLL, useTitlePolling } from './use-title-polling';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const QUESTION = messageDto({ id: 'u1' });
const ANSWER = messageDto({ id: 'a1', parentId: 'u1', role: MessageDtoRole.assistant });

function waitingChat(overrides: Partial<ChatDetailDto> = {}): ChatDetailDto {
  return chatDetailDto({
    id: 'c-1',
    titleSource: ChatDetailDtoTitleSource.fallback,
    messages: [QUESTION, ANSWER],
    activeLeafId: 'a1',
    ...overrides,
  });
}

function setup(chat: ChatDetailDto, idle = true) {
  const queryClient = createQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const view = renderHook((props: { chat: ChatDetailDto; idle: boolean }) => {
    useTitlePolling(props.chat, props.idle);
  }, {
    initialProps: { chat, idle },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { invalidate, ...view };
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useTitlePolling', () => {
  it('refreshes the chat and the list every few seconds while the title is the placeholder', () => {
    const { invalidate } = setup(waitingChat());

    advance(TITLE_POLL.INTERVAL_MS - 1);
    expect(invalidate).not.toHaveBeenCalled();

    advance(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: getChatsDetailQueryKey('c-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: getChatsListQueryKey() });
  });

  it('gives up after the maximum number of tries', () => {
    const { invalidate } = setup(waitingChat());

    advance(TITLE_POLL.INTERVAL_MS * (TITLE_POLL.MAX_TICKS + 5));

    expect(invalidate).toHaveBeenCalledTimes(TITLE_POLL.MAX_TICKS * 2);
  });

  it.each([ChatDetailDtoTitleSource.generated, ChatDetailDtoTitleSource.user])(
    'does not ask when the title is %s',
    (titleSource) => {
      const { invalidate } = setup(waitingChat({ titleSource }));

      advance(TITLE_POLL.INTERVAL_MS * 3);

      expect(invalidate).not.toHaveBeenCalled();
    }
  );

  it.each([MessageDtoStatus.aborted, MessageDtoStatus.error])(
    'does not ask when the only answer is %s: no title job runs for it',
    (status) => {
      const { invalidate } = setup(
        waitingChat({ messages: [QUESTION, { ...ANSWER, status }] })
      );

      advance(TITLE_POLL.INTERVAL_MS * 3);

      expect(invalidate).not.toHaveBeenCalled();
    }
  );

  it('does not ask before there is an answer', () => {
    const { invalidate } = setup(waitingChat({ messages: [QUESTION], activeLeafId: 'u1' }));

    advance(TITLE_POLL.INTERVAL_MS * 3);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('waits while an answer is running and starts when the chat is idle', () => {
    const { invalidate, rerender } = setup(waitingChat(), false);

    advance(TITLE_POLL.INTERVAL_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();

    rerender({ chat: waitingChat(), idle: true });
    advance(TITLE_POLL.INTERVAL_MS);
    expect(invalidate).toHaveBeenCalled();
  });

  it('stops as soon as the generated title has arrived', () => {
    const { invalidate, rerender } = setup(waitingChat());
    advance(TITLE_POLL.INTERVAL_MS);
    const calls = invalidate.mock.calls.length;

    rerender({
      chat: waitingChat({ titleSource: ChatDetailDtoTitleSource.generated }),
      idle: true,
    });
    advance(TITLE_POLL.INTERVAL_MS * 3);

    expect(invalidate).toHaveBeenCalledTimes(calls);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/features/chats/use-title-polling.spec.tsx`
Expected: FAIL (`./use-title-polling` fehlt).

- [ ] **Step 3: Implementieren**

`apps/web/src/features/chats/use-title-polling.ts`:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getChatsDetailQueryKey, getChatsListQueryKey } from '@/api/generated/api';
import {
  type ChatDetailDto,
  ChatDetailDtoTitleSource,
  MessageDtoRole,
  MessageDtoStatus,
} from '@/api/generated/model';

export const TITLE_POLL = { INTERVAL_MS: 3000, MAX_TICKS: 10 } as const;

/**
 * While the chat still has its placeholder title and a complete answer exists (that is what starts the title job),
 * ask the server every few seconds for the generated title, at most `MAX_TICKS` times. Not while an answer is running.
 */
export function useTitlePolling(
  chat: Pick<ChatDetailDto, 'id' | 'titleSource' | 'messages'>,
  idle: boolean
): void {
  const queryClient = useQueryClient();
  const waiting =
    idle &&
    chat.titleSource === ChatDetailDtoTitleSource.fallback &&
    chat.messages.some(
      (message) =>
        message.role === MessageDtoRole.assistant && message.status === MessageDtoStatus.complete
    );

  useEffect(() => {
    if (!waiting) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      void queryClient.invalidateQueries({ queryKey: getChatsDetailQueryKey(chat.id) });
      void queryClient.invalidateQueries({ queryKey: getChatsListQueryKey() });
      if (ticks >= TITLE_POLL.MAX_TICKS) window.clearInterval(timer);
    }, TITLE_POLL.INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [waiting, chat.id, queryClient]);
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @owui/web exec vitest run src/features/chats/use-title-polling.spec.tsx`
Expected: PASS. Mutationsprobe: `ticks >= TITLE_POLL.MAX_TICKS` entfernen → „gives up“ wird rot; `idle &&` entfernen → „waits while an answer is running“ wird rot.

- [ ] **Step 5: `pnpm check`, Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web/src/features/chats/use-title-polling.ts apps/web/src/features/chats/use-title-polling.spec.tsx
git commit -m "feat(web): poll for the generated chat title

Every three seconds, at most ten times, only while the placeholder title stands, a complete
answer exists and nothing runs. No constant polling."
```

---

### Task 9: Chatansicht (Verlauf, Stream, Stopp, Neu erzeugen, Bearbeiten, Äste) und Routen

Das Herz des Plans. `ChatView` lädt den Chat, `ChatSession` besitzt `useChat`. Regeln, die jede Zeile erklärt:

- Der Server besitzt den Baum. `useChat` hält nur den angezeigten Ast; nach jedem Ende eines Streams wird der Chat neu geladen und der Ast neu aus `activeLeafId` abgeleitet.
- Scheitert die Anfrage, bevor die Antwort beginnt (kein `assistantMessageId` in den Metadaten angekommen), nimmt `resync` die optimistische Nachricht weg und der Text kommt zurück ins Eingabefeld (Bearbeiten: ins Bearbeiten-Feld). Ein Fehler **im** Stream (`stream_failed`) ist der gespeicherte Fehler-Zustand: der Verlauf zeigt ihn nach dem Neuladen.
- Nach einem Stopp (oder Verbindungsabbruch) lädt die Seite erst nach `ABORT_SETTLE_MS` neu: der Server speichert die Teilantwort, wenn sein Strom schließt, einen Moment nach dem Abbruch im Browser. Das ist eine Heuristik und nur von Hand prüfbar (Task 11).
- Aktionen (Neu erzeugen, Bearbeiten, Ast wechseln) gibt es nur für Nachrichten, die der Server kennt (`stored`), und nie, während etwas läuft (`locked`). Ein eben gestreamter Beitrag trägt noch eine lokale ID; `regenerate({ messageId })` entfernt ihn vor der Anfrage, seine Metadaten gingen verloren.
- Rückrufe, die `useChat` einmal speichert, lesen nur Refs (`useLatest`).

**Files:**
- Create: `apps/web/src/features/chats/chat-navigation.ts`, `chat-navigation.spec.ts`, `use-chat-detail.ts`, `chat-view.tsx`, `apps/web/src/pages/chat-page.tsx`, `apps/web/src/pages/chat-page.spec.tsx`
- Modify: `apps/web/src/test/render-app.tsx`, `apps/web/src/app/router.tsx`, `apps/web/src/features/chats/chat-list.spec.tsx` (Skip aus Task 5 entfernen)

**Interfaces:**
- Consumes: alles aus Task 2–8; `useChat` aus `@ai-sdk/react`; `useLatest` (Task 7).
- Produces:
  - `firstMessageState(text: string): { firstMessage: string }`, `readFirstMessage(state: unknown): string | undefined` (Router-State: die erste Nachricht eines neuen Chats, Task 10)
  - `useChatDetail(id: string)` (Antwort ausgepackt: `data` ist `ChatDetailDto`)
  - `ChatView({ chatId })`, `ChatSession({ chat, syncToken })`, `ChatPage()`
  - `renderApp(path?, state?)` reicht Router-State durch

- [ ] **Step 1: Typen von `useChat` prüfen (Regel 10)**

Run: `grep -rn "throttle\|onFinish\|isDisconnect\|clearError" apps/web/node_modules/@ai-sdk/react/dist/index.d.*ts | head -20`
Expected: die Option zum Drosseln der Aktualisierungen heißt `throttle` (Stand 4.0.140, geprüft am 2026-10-10); `onFinish` bekommt `{ isAbort, isDisconnect, isError }`; `clearError` ist Teil des Rückgabewerts. **Heißt die Option anders (`experimental_throttle`), im Code von Step 5 den gefundenen Namen verwenden** und die Abweichung in den DoD schreiben.

- [ ] **Step 2: Renderer und Router vorbereiten**

`apps/web/src/test/render-app.tsx`: die erste Funktion ersetzen durch

```tsx
/** `state` is the router state of the first entry (a new chat hands its first message to the chat page this way). */
export function renderApp(path = '/', state?: unknown) {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [{ pathname: path, state }] });
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  return { ...view, queryClient, router };
}
```

`apps/web/src/app/router.tsx`: Import `import { ChatPage } from '@/pages/chat-page';` (alphabetisch nach `AdminUsersPage`) und in den Kindern von `AppLayout` nach `models` die Route

```tsx
          { path: 'chats/:id', element: <ChatPage /> },
```

- [ ] **Step 3: Failing tests schreiben**

`apps/web/src/features/chats/chat-navigation.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { firstMessageState, readFirstMessage } from './chat-navigation';

describe('first message in the router state', () => {
  it('hands the text over', () => {
    expect(readFirstMessage(firstMessageState('Hallo'))).toBe('Hallo');
  });

  it.each([null, undefined, 'Hallo', 5, {}, { firstMessage: 5 }, { firstMessage: '   ' }])(
    'ignores %j',
    (state) => {
      expect(readFirstMessage(state)).toBeUndefined();
    }
  );
});
```

`apps/web/src/pages/chat-page.spec.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ChatDetailDto,
  ChatDetailDtoTitleSource,
  MessageDtoRole,
  MessageDtoStatus,
} from '@/api/generated/model';
import { firstMessageState } from '@/features/chats/chat-navigation';
import {
  chatDetailDto,
  chatTime,
  messageDto,
  modelDto,
  modelList,
  sessionInfo,
  textParts,
  userDto,
} from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { answerChunks, openSse, sseResponse } from '@/test/sse';
import { callsTo, type Handler, json, problem, stubApi } from '@/test/stub-api';

const CHAT_ID = 'c-1';
const STREAM_PATH = `/api/chats/${CHAT_ID}/stream`;
const STREAM = `POST ${STREAM_PATH}`;
const DETAIL_PATH = `/api/chats/${CHAT_ID}`;
const IDS = { userMessageId: 'u2', assistantMessageId: 'a2' };

const BEN = userDto({ id: 'u-ben', name: 'Ben Beispiel' });
const LLAMA = modelDto({ id: 'c-local:llama3:8b', name: 'llama3:8b', providerName: 'Lokal' });
const GPT = modelDto({
  id: 'c-cloud:gpt-x',
  name: 'gpt-x',
  connectionId: 'c-cloud',
  providerName: 'Cloud',
});

const U1 = messageDto({ id: 'u1', parentId: null, parts: textParts('Hallo'), createdAt: chatTime(0) });
const A1 = messageDto({
  id: 'a1',
  parentId: 'u1',
  role: MessageDtoRole.assistant,
  parts: textParts('Hi **du**'),
  modelId: LLAMA.id,
  createdAt: chatTime(1),
});

let detail: ChatDetailDto;

beforeEach(() => {
  detail = chatDetailDto({
    id: CHAT_ID,
    title: 'Erster Chat',
    modelId: LLAMA.id,
    messages: [U1, A1],
    activeLeafId: 'a1',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The chat after one more question and answer, as the server stores it. */
function afterExchange(answer: string, status: MessageDtoStatus = MessageDtoStatus.complete) {
  return {
    ...detail,
    messages: [
      ...detail.messages,
      messageDto({
        id: 'u2',
        parentId: 'a1',
        parts: textParts('Neue Frage'),
        createdAt: chatTime(2),
      }),
      messageDto({
        id: 'a2',
        parentId: 'u2',
        role: MessageDtoRole.assistant,
        parts: textParts(answer),
        status,
        createdAt: chatTime(3),
      }),
    ],
    activeLeafId: 'a2',
  } satisfies ChatDetailDto;
}

function stubChat(handlers: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/auth/me': () => json(200, sessionInfo(BEN)),
    'GET /api/models': () => json(200, modelList([LLAMA, GPT])),
    [`GET ${DETAIL_PATH}`]: () => json(200, detail),
    ...handlers,
  });
}

/** A stream the test feeds by hand; `open()` waits until the app has asked for it. */
function manualStream() {
  const state: { sse: ReturnType<typeof openSse> | undefined; signal: AbortSignal | undefined } = {
    sse: undefined,
    signal: undefined,
  };
  const handler: Handler = (request) => {
    state.sse = openSse(request.signal);
    state.signal = request.signal;
    return state.sse.response;
  };
  return {
    handler,
    signal: () => state.signal,
    async open() {
      await waitFor(() => {
        expect(state.sse).toBeDefined();
      });
      if (state.sse === undefined) throw new Error('The stream was never requested');
      return state.sse;
    },
  };
}

function bodyOfLast(fetchMock: ReturnType<typeof stubApi>, method: string, path: string): unknown {
  const body = callsTo(fetchMock, method, path).at(-1)?.[1]?.body;
  return typeof body === 'string' ? (JSON.parse(body) as unknown) : undefined;
}

async function openChat(state?: unknown) {
  const view = renderApp(`/chats/${CHAT_ID}`, state);
  await screen.findByRole('heading', { level: 1 });
  return view;
}

function messageList() {
  return screen.getByRole('list', { name: 'Nachrichten' });
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText('Nachricht'), `${text}{Enter}`);
}

const START = { type: 'start', messageId: 'local-a', messageMetadata: IDS };
const TEXT_START = { type: 'text-start', id: 't1' };
const delta = (text: string) => ({ type: 'text-delta', id: 't1', delta: text });
const TEXT_END = { type: 'text-end', id: 't1' };
const FINISH = { type: 'finish' };

describe('ChatPage: history', () => {
  it('shows title, history with formatted answer, model and provider', async () => {
    stubChat();

    await openChat();

    expect(screen.getByRole('heading', { level: 1, name: 'Erster Chat' })).toBeInTheDocument();
    expect(within(messageList()).getByText('Hallo')).toBeInTheDocument();
    expect(within(messageList()).getByText('du').tagName).toBe('STRONG');
    await waitFor(() => {
      expect(screen.getByLabelText('Modell')).toHaveValue(LLAMA.id);
    });
    expect(await screen.findByText('Dieser Chat läuft bei: Lokal')).toBeInTheDocument();
  });

  it('shows the active branch of the tree and nothing of the others', async () => {
    const other = messageDto({
      id: 'a1b',
      parentId: 'u1',
      role: MessageDtoRole.assistant,
      parts: textParts('Zweite Fassung'),
      createdAt: chatTime(4),
    });
    detail = { ...detail, messages: [U1, A1, other], activeLeafId: 'a1b' };
    stubChat();

    await openChat();

    expect(within(messageList()).getByText('Zweite Fassung')).toBeInTheDocument();
    expect(within(messageList()).queryByText('du')).not.toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('shows a failed answer with its note and offers to regenerate it (backlog: error answers were missing)', async () => {
    detail = {
      ...detail,
      messages: [
        U1,
        { ...A1, status: MessageDtoStatus.error, errorReason: 'timeout', parts: textParts('Halb') },
      ],
    };
    stubChat();

    await openChat();

    expect(within(messageList()).getByText('Halb')).toBeInTheDocument();
    expect(
      screen.getByText(/Die Antwort ist fehlgeschlagen und wird dem Modell nicht mitgeschickt\./)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu erzeugen' })).toBeEnabled();
  });

  it('shows markup in the title and in a message as text', async () => {
    detail = {
      ...detail,
      title: '<img src=x onerror=alert(1)>',
      messages: [{ ...U1, parts: textParts('<script>alert(1)</script>') }, A1],
    };
    stubChat();

    const { container } = await openChat();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(within(messageList()).getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('ChatPage: loading states', () => {
  it('shows a loading state, then the chat', async () => {
    let release: () => void = () => undefined;
    stubChat({
      [`GET ${DETAIL_PATH}`]: () =>
        new Promise<Response>((resolve) => {
          release = () => {
            resolve(json(200, detail));
          };
        }),
    });
    renderApp(`/chats/${CHAT_ID}`);

    expect(await screen.findByRole('status')).toBeInTheDocument();
    release();

    expect(await screen.findByRole('heading', { level: 1, name: 'Erster Chat' })).toBeInTheDocument();
  });

  it('shows a retry when loading fails', async () => {
    const user = userEvent.setup();
    const handlers: Record<string, Handler> = {
      [`GET ${DETAIL_PATH}`]: () => problem(500, 'Internal Server Error'),
    };
    stubChat(handlers);
    renderApp(`/chats/${CHAT_ID}`);
    await screen.findByText('Das Laden hat nicht geklappt.');

    handlers[`GET ${DETAIL_PATH}`] = () => json(200, detail);
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Erster Chat' })).toBeInTheDocument();
  });

  it('says the chat is gone for a chat that does not exist or is not the user’s', async () => {
    stubChat({ [`GET ${DETAIL_PATH}`]: () => problem(404, 'Not Found') });
    renderApp(`/chats/${CHAT_ID}`);

    expect(
      await screen.findByText('Der Chat oder das Modell ist nicht mehr verfügbar.')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Nachricht')).not.toBeInTheDocument();
  });
});

describe('ChatPage: sending', () => {
  it('sends the question, shows the answer while it streams and loads the stored chat afterwards', async () => {
    const stream = manualStream();
    const fetchMock = stubChat({ [STREAM]: stream.handler });
    const user = userEvent.setup();
    await openChat();

    await ask(user, 'Neue Frage');
    const sse = await stream.open();

    expect(bodyOfLast(fetchMock, 'POST', STREAM_PATH)).toEqual({ parentId: 'a1', text: 'Neue Frage' });
    expect(within(messageList()).getByText('Neue Frage')).toBeInTheDocument();
    expect(screen.getByLabelText('Nachricht')).toHaveValue('');
    expect(screen.getByText('Die Antwort wird erzeugt …')).toBeInTheDocument();

    sse.send(START);
    sse.send(TEXT_START);
    sse.send(delta('Teilantwort'));
    expect(
      await within(messageList()).findByText('Teilantwort', { selector: 'p' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stoppen' })).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Neu erzeugen' })) {
      expect(button).toBeDisabled();
    }

    sse.send(delta(' und Ende'));
    sse.send(TEXT_END);
    sse.send(FINISH);
    detail = afterExchange('Gespeicherte Antwort');
    sse.end();

    expect(await within(messageList()).findByText('Gespeicherte Antwort')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Senden' })).toBeInTheDocument();
    expect(within(messageList()).queryByText('Teilantwort und Ende')).not.toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Neu erzeugen' })) {
      expect(button).toBeEnabled();
    }
  });

  it('sends nothing more while an answer runs: exactly one request', async () => {
    const stream = manualStream();
    const fetchMock = stubChat({ [STREAM]: stream.handler });
    const user = userEvent.setup();
    await openChat();

    await ask(user, 'Eins');
    await stream.open();
    await ask(user, 'Zwei');

    expect(callsTo(fetchMock, 'POST', STREAM_PATH)).toHaveLength(1);
  });

  it('does not leave a ghost message when the request is refused, and gives the text back', async () => {
    stubChat({ [STREAM]: () => problem(429, 'Too Many Requests') });
    const user = userEvent.setup();
    await openChat();

    await ask(user, 'Neue Frage');

    expect(
      await screen.findByText('Es laufen schon zu viele Antworten gleichzeitig. Bitte warte einen Moment.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nachricht')).toHaveValue('Neue Frage');
    expect(within(messageList()).queryByText('Neue Frage')).not.toBeInTheDocument();
    expect(within(messageList()).getByText('Hallo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled();
  });

  it('says the model is gone when the server answers 404 to a send', async () => {
    stubChat({ [STREAM]: () => problem(404, 'Not Found') });
    const user = userEvent.setup();
    await openChat();

    await ask(user, 'Neue Frage');

    expect(
      await screen.findByText('Der Chat oder das Modell ist nicht mehr verfügbar.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nachricht')).toHaveValue('Neue Frage');
  });

  it('shows the stored note when the stream itself breaks, with no ghost and no restored text', async () => {
    const stream = manualStream();
    stubChat({ [STREAM]: stream.handler });
    const user = userEvent.setup();
    await openChat();

    await ask(user, 'Neue Frage');
    const sse = await stream.open();
    sse.send(START);
    sse.send(TEXT_START);
    sse.send(delta('Anfang'));
    sse.send({ type: 'error', errorText: 'stream_failed' });
    detail = afterExchange('Anfang', MessageDtoStatus.error);
    sse.end();

    expect(
      await screen.findByText(/Die Antwort ist fehlgeschlagen und wird dem Modell nicht mitgeschickt\./)
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('Nachricht')).toHaveValue('');
    expect(within(messageList()).getAllByText('Neue Frage')).toHaveLength(1);
  });

  it('does not give the text back when the connection breaks after the answer began', async () => {
    const stream = manualStream();
    stubChat({ [STREAM]: stream.handler });
    const user = userEvent.setup();
    await openChat();

    await ask(user, 'Neue Frage');
    const sse = await stream.open();
    sse.send(START);
    sse.send(TEXT_START);
    sse.send(delta('Anfang'));
    await within(messageList()).findByText('Anfang', { selector: 'p' });
    detail = afterExchange('Anfang', MessageDtoStatus.aborted);
    sse.fail();

    expect(await screen.findByText('Die Antwort wurde abgebrochen.', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByLabelText('Nachricht')).toHaveValue('');
    expect(within(messageList()).getAllByText('Neue Frage')).toHaveLength(1);
  });

  it('keeps the partial answer when stopped and reloads only after the server had time to store it', async () => {
    const stream = manualStream();
    const fetchMock = stubChat({ [STREAM]: stream.handler });
    const user = userEvent.setup();
    await openChat();
    await ask(user, 'Neue Frage');
    const sse = await stream.open();
    sse.send(START);
    sse.send(TEXT_START);
    sse.send(delta('Teil'));
    await within(messageList()).findByText('Teil', { selector: 'p' });
    const loadsBefore = callsTo(fetchMock, 'GET', DETAIL_PATH).length;

    await user.click(screen.getByRole('button', { name: 'Stoppen' }));

    expect(stream.signal()?.aborted).toBe(true);
    expect(within(messageList()).getByText('Teil', { selector: 'p' })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', DETAIL_PATH)).toHaveLength(loadsBefore);

    detail = afterExchange('Teil', MessageDtoStatus.aborted);
    expect(await screen.findByText('Die Antwort wurde abgebrochen.', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', DETAIL_PATH).length).toBeGreaterThan(loadsBefore);
  });

  it('sends the first message a new chat handed over, once, and clears the router state', async () => {
    detail = chatDetailDto({ id: CHAT_ID, modelId: LLAMA.id, title: 'Neuer Chat' });
    const fetchMock = stubChat({
      [STREAM]: () => sseResponse(answerChunks('Antwort', { userMessageId: 'u1', assistantMessageId: 'a1' })),
    });

    const { router } = await openChat(firstMessageState('Erste Frage'));

    await waitFor(() => {
      expect(callsTo(fetchMock, 'POST', STREAM_PATH)).toHaveLength(1);
    });
    expect(bodyOfLast(fetchMock, 'POST', STREAM_PATH)).toEqual({ parentId: null, text: 'Erste Frage' });
    await waitFor(() => {
      expect(router.state.location.state).toBeNull();
    });
    expect(callsTo(fetchMock, 'POST', STREAM_PATH)).toHaveLength(1);
  });
});

describe('ChatPage: regenerate, edit, versions', () => {
  it('regenerates through the route of the answer, once, and shows the new version', async () => {
    const stream = manualStream();
    const fetchMock = stubChat({ [`POST ${DETAIL_PATH}/messages/a1/regenerate`]: stream.handler });
    const user = userEvent.setup();
    await openChat();

    await user.dblClick(screen.getByRole('button', { name: 'Neu erzeugen' }));
    const sse = await stream.open();

    expect(callsTo(fetchMock, 'POST', `${DETAIL_PATH}/messages/a1/regenerate`)).toHaveLength(1);
    expect(bodyOfLast(fetchMock, 'POST', `${DETAIL_PATH}/messages/a1/regenerate`)).toEqual({});
    expect(within(messageList()).queryByText('du')).not.toBeInTheDocument();
    expect(screen.getByText('Die Antwort wird erzeugt …')).toBeInTheDocument();

    const other = messageDto({
      id: 'a1b',
      parentId: 'u1',
      role: MessageDtoRole.assistant,
      parts: textParts('Neue Fassung'),
      createdAt: chatTime(5),
    });
    sse.send({ type: 'start', messageId: 'local-b', messageMetadata: { userMessageId: 'u1', assistantMessageId: 'a1b' } });
    sse.send(TEXT_START);
    sse.send(delta('Neue Fassung'));
    sse.send(TEXT_END);
    sse.send(FINISH);
    detail = { ...detail, messages: [U1, A1, other], activeLeafId: 'a1b' };
    sse.end();

    expect(await screen.findByText('2/2')).toBeInTheDocument();
    expect(within(messageList()).getByText('Neue Fassung')).toBeInTheDocument();
  });

  it('puts the old answer back when regenerating is refused', async () => {
    stubChat({ [`POST ${DETAIL_PATH}/messages/a1/regenerate`]: () => problem(429, 'Too Many Requests') });
    const user = userEvent.setup();
    await openChat();

    await user.click(screen.getByRole('button', { name: 'Neu erzeugen' }));

    expect(
      await screen.findByText('Es laufen schon zu viele Antworten gleichzeitig. Bitte warte einen Moment.')
    ).toBeInTheDocument();
    expect(within(messageList()).getByText('du')).toBeInTheDocument();
  });

  it('edits a question as a new version under the same parent', async () => {
    const stream = manualStream();
    const fetchMock = stubChat({ [STREAM]: stream.handler });
    const user = userEvent.setup();
    await openChat();

    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const box = screen.getByLabelText('Nachricht bearbeiten');
    await user.clear(box);
    await user.type(box, 'Hallo, anders');
    await user.click(screen.getByRole('button', { name: 'Als neue Version senden' }));
    const sse = await stream.open();

    expect(bodyOfLast(fetchMock, 'POST', STREAM_PATH)).toEqual({ parentId: null, text: 'Hallo, anders' });
    expect(within(messageList()).getByText('Hallo, anders')).toBeInTheDocument();
    expect(within(messageList()).queryByText('Hallo')).not.toBeInTheDocument();

    const edited = messageDto({
      id: 'u1e',
      parentId: null,
      parts: textParts('Hallo, anders'),
      createdAt: chatTime(6),
    });
    const answer = messageDto({
      id: 'a1e',
      parentId: 'u1e',
      role: MessageDtoRole.assistant,
      parts: textParts('Andere Antwort'),
      createdAt: chatTime(7),
    });
    sse.send({ type: 'start', messageId: 'local-c', messageMetadata: { userMessageId: 'u1e', assistantMessageId: 'a1e' } });
    sse.send(TEXT_START);
    sse.send(delta('Andere Antwort'));
    sse.send(TEXT_END);
    sse.send(FINISH);
    detail = { ...detail, messages: [U1, A1, edited, answer], activeLeafId: 'a1e' };
    sse.end();

    expect(await screen.findByText('2/2')).toBeInTheDocument();
    expect(within(messageList()).getByText('Andere Antwort')).toBeInTheDocument();
  });

  it('reopens the edit box with the text when sending the edit fails, and puts the old messages back', async () => {
    stubChat({ [STREAM]: () => problem(422, 'Unprocessable Entity') });
    const user = userEvent.setup();
    await openChat();

    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const box = screen.getByLabelText('Nachricht bearbeiten');
    await user.clear(box);
    await user.type(box, 'Zu lang');
    await user.click(screen.getByRole('button', { name: 'Als neue Version senden' }));

    expect(await screen.findByText('Die Nachricht ist zu lang.')).toBeInTheDocument();
    expect(await screen.findByLabelText('Nachricht bearbeiten')).toHaveValue('Zu lang');
    expect(within(messageList()).getByText('du')).toBeInTheDocument();
  });

  it('switches to another version with one request and shows that branch after the reload', async () => {
    const other = messageDto({
      id: 'a1b',
      parentId: 'u1',
      role: MessageDtoRole.assistant,
      parts: textParts('Zweite Fassung'),
      createdAt: chatTime(4),
    });
    detail = { ...detail, messages: [U1, A1, other], activeLeafId: 'a1b' };
    const fetchMock = stubChat({
      [`PATCH ${DETAIL_PATH}`]: () => {
        detail = { ...detail, activeLeafId: 'a1' };
        return json(200, detail);
      },
    });
    const user = userEvent.setup();
    await openChat();

    await user.dblClick(screen.getByRole('button', { name: 'Vorherige Version' }));

    expect(await within(messageList()).findByText('du')).toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'PATCH', DETAIL_PATH)).toHaveLength(1);
    expect(bodyOfLast(fetchMock, 'PATCH', DETAIL_PATH)).toEqual({ activeMessageId: 'a1' });
  });
});

describe('ChatPage: model and settings', () => {
  it('changes the model of the chat', async () => {
    const fetchMock = stubChat({
      [`PATCH ${DETAIL_PATH}`]: () => {
        detail = { ...detail, modelId: GPT.id };
        return json(200, detail);
      },
    });
    const user = userEvent.setup();
    await openChat();
    await screen.findByRole('option', { name: 'gpt-x (Cloud)' });

    await user.selectOptions(screen.getByLabelText('Modell'), GPT.id);

    await waitFor(() => {
      expect(screen.getByLabelText('Modell')).toHaveValue(GPT.id);
    });
    expect(bodyOfLast(fetchMock, 'PATCH', DETAIL_PATH)).toEqual({ modelId: GPT.id });
  });

  it('keeps showing the stored model when it is no longer offered, and warns', async () => {
    stubChat({ 'GET /api/models': () => json(200, modelList([GPT])) });

    await openChat();

    expect(await screen.findByText('Das Modell dieses Chats ist gerade nicht verfügbar.')).toBeInTheDocument();
    expect(screen.getByLabelText('Modell')).toHaveValue(LLAMA.id);
    expect(within(messageList()).getByText('Hallo')).toBeInTheDocument();
  });

  it('saves instruction and parameters of the chat', async () => {
    const fetchMock = stubChat({
      [`PATCH ${DETAIL_PATH}`]: () => {
        detail = { ...detail, systemPrompt: 'Antworte kurz.', params: { temperature: 0 } };
        return json(200, detail);
      },
    });
    const user = userEvent.setup();
    await openChat();

    await user.click(screen.getByRole('button', { name: 'Einstellungen' }));
    await user.type(screen.getByLabelText('Anweisung für das Modell'), 'Antworte kurz.');
    await user.type(screen.getByLabelText(/Kreativität/), '0');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(bodyOfLast(fetchMock, 'PATCH', DETAIL_PATH)).toEqual({
      systemPrompt: 'Antworte kurz.',
      params: { temperature: 0 },
    });
    await user.click(screen.getByRole('button', { name: 'Einstellungen' }));
    expect(screen.getByLabelText('Anweisung für das Modell')).toHaveValue('Antworte kurz.');
  });
});

describe('ChatPage: title', () => {
  it('picks up the generated title after the first answer', async () => {
    detail = { ...detail, titleSource: ChatDetailDtoTitleSource.fallback, title: 'Hallo' };
    const stream = manualStream();
    stubChat({ [STREAM]: stream.handler });
    const user = userEvent.setup();
    await openChat();
    await ask(user, 'Neue Frage');
    const sse = await stream.open();
    sse.send(START);
    sse.send(TEXT_START);
    sse.send(delta('x'));
    sse.send(TEXT_END);
    sse.send(FINISH);
    detail = { ...afterExchange('x'), titleSource: ChatDetailDtoTitleSource.generated, title: 'Begrüßung' };
    sse.end();

    expect(await screen.findByRole('heading', { level: 1, name: 'Begrüßung' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/pages/chat-page.spec.tsx src/features/chats/chat-navigation.spec.ts`
Expected: FAIL (Module `chat-navigation`, `chat-page`, `chat-view` fehlen).

- [ ] **Step 5: Implementieren**

`apps/web/src/features/chats/chat-navigation.ts`:

```ts
const FIRST_MESSAGE = 'firstMessage';

/** Router state for a freshly created chat: its first message, which the chat page sends once on arrival. */
export function firstMessageState(text: string): Record<typeof FIRST_MESSAGE, string> {
  return { [FIRST_MESSAGE]: text };
}

export function readFirstMessage(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !(FIRST_MESSAGE in state)) return undefined;
  const text = state[FIRST_MESSAGE];
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}
```

`apps/web/src/features/chats/use-chat-detail.ts`:

```ts
import { ApiError } from '@/api/fetcher';
import { useChatsDetail } from '@/api/generated/api';

/** One chat with all its messages. The result carries the unwrapped chat (`data` is a `ChatDetailDto`). */
export function useChatDetail(id: string) {
  return useChatsDetail(id, {
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

`apps/web/src/features/chats/chat-view.tsx`:

```tsx
import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';

import { ApiError } from '@/api/fetcher';
import { getChatsDetailQueryKey, getChatsListQueryKey, useChatsUpdate } from '@/api/generated/api';
import type { ChatDetailDto } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Button } from '@/components/ui/button';
import { useLatest } from '@/hooks/use-latest';

import { chatErrorKey, isStreamFailure } from './chat-errors';
import { readFirstMessage } from './chat-navigation';
import { type ChatSettings, ChatSettingsDialog } from './chat-settings-dialog';
import { createChatTransport } from './chat-transport';
import { Composer } from './composer';
import { chatTitle } from './delete-chat-dialog';
import { type EditRestore, MessageItem } from './message-item';
import { activePath, branchesOf, serverMessageId, toUiMessage } from './message-tree';
import { ModelPicker } from './model-picker';
import { useChatDetail } from './use-chat-detail';
import { useTitlePolling } from './use-title-polling';

/**
 * After a stop or a lost connection the server stores the partial answer when its own stream closes, a moment after
 * the browser let go. Reloading sooner would replace the visible text by a chat without it. A heuristic, checked by
 * hand (Task 11).
 */
const ABORT_SETTLE_MS = 500;
const THROTTLE_MS = 50;

const REQUEST_KIND = { SEND: 'send', EDIT: 'edit', REGENERATE: 'regenerate' } as const;

type LastRequest =
  | { kind: typeof REQUEST_KIND.SEND; text: string }
  | { kind: typeof REQUEST_KIND.EDIT; text: string; messageId: string }
  | { kind: typeof REQUEST_KIND.REGENERATE };

interface Restore {
  token: number;
  text: string;
}

function noop() {
  // Placeholder until the first render has set the real function.
}

/** The server announced its ids in the first part of the stream: from then on it has stored the question. */
function questionIsStored(last: UIMessage | undefined): boolean {
  return last?.role === 'assistant' && serverMessageId(last) !== last.id;
}

export function ChatSession({ chat, syncToken }: { chat: ChatDetailDto; syncToken: number }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [composerRestore, setComposerRestore] = useState<Restore>();
  const [editRestore, setEditRestore] = useState<Restore & { messageId: string }>();
  const lastRequest = useRef<LastRequest | undefined>(undefined);
  const sending = useRef(false);
  const restoreToken = useRef(0);
  const appliedToken = useRef(syncToken);
  const firstSent = useRef(false);
  // What the callbacks of useChat need from later in this render; set by an effect below.
  const latest = useRef<{ messages: UIMessage[]; resync: () => void }>({
    messages: [],
    resync: noop,
  });
  const chatNow = useLatest(chat);

  const invalidateChat = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getChatsDetailQueryKey(chat.id) });
    void queryClient.invalidateQueries({ queryKey: getChatsListQueryKey() });
  }, [queryClient, chat.id]);
  const invalidateNow = useLatest(invalidateChat);

  const [initialMessages] = useState(() => activePath(chat).map(toUiMessage));
  const transport = useMemo(() => createChatTransport(chat.id), [chat.id]);

  const { messages, status, error, sendMessage, regenerate, stop, setMessages, clearError } =
    useChat<UIMessage>({
      id: chat.id,
      transport,
      messages: initialMessages,
      throttle: THROTTLE_MS,
      onError: (caught) => {
        // An error inside the stream: the answer is stored with status error; the reload shows it with its note.
        if (isStreamFailure(caught)) return;
        // The server has the question already (the stream began, then the connection broke): nothing to give back.
        if (questionIsStored(latest.current.messages.at(-1))) return;
        // The request failed before an answer began: drop the optimistic message and give the text back.
        latest.current.resync();
        const request = lastRequest.current;
        restoreToken.current += 1;
        if (request?.kind === REQUEST_KIND.SEND) {
          setComposerRestore({ token: restoreToken.current, text: request.text });
        }
        if (request?.kind === REQUEST_KIND.EDIT) {
          setEditRestore({
            token: restoreToken.current,
            text: request.text,
            messageId: request.messageId,
          });
        }
      },
      onFinish: ({ isAbort, isDisconnect }) => {
        // Also runs after errors. The stream is closed here, so the server has stored what it will store.
        const delay = isAbort || isDisconnect ? ABORT_SETTLE_MS : 0;
        window.setTimeout(() => {
          invalidateNow.current();
        }, delay);
      },
    });

  useEffect(() => {
    latest.current = {
      messages,
      resync: () => {
        setMessages(activePath(chatNow.current).map(toUiMessage));
      },
    };
  });

  const busy = status === 'submitted' || status === 'streaming';
  const idle = !busy;

  // The reload brought a newer chat: show its branch, unless something is running.
  useEffect(() => {
    if (!idle || appliedToken.current === syncToken) return;
    appliedToken.current = syncToken;
    setMessages(activePath(chat).map(toUiMessage));
    if (isStreamFailure(error)) clearError();
  }, [idle, syncToken, chat, error, setMessages, clearError]);

  useEffect(() => {
    // A second action in the same tick sees the ref; the status catches up one render later.
    if (idle) sending.current = false;
  }, [idle]);

  useTitlePolling(chat, idle);

  const branchUpdate = useChatsUpdate();
  const modelUpdate = useChatsUpdate();
  const settingsUpdate = useChatsUpdate();
  const { mutate: switchBranch } = branchUpdate;
  const { mutate: changeModel } = modelUpdate;
  const { mutateAsync: saveSettingsRequest } = settingsUpdate;
  const locked = busy || branchUpdate.isPending;

  const send = useCallback(
    (request: Exclude<LastRequest, { kind: typeof REQUEST_KIND.REGENERATE }>) => {
      if (sending.current) return;
      sending.current = true;
      lastRequest.current = request;
      setComposerRestore(undefined);
      setEditRestore(undefined);
      void (request.kind === REQUEST_KIND.EDIT
        ? sendMessage({ text: request.text, messageId: request.messageId })
        : sendMessage({ text: request.text }));
    },
    [sendMessage]
  );

  const handleSend = useCallback(
    (text: string) => {
      send({ kind: REQUEST_KIND.SEND, text });
    },
    [send]
  );

  const handleEdit = useCallback(
    (messageId: string, text: string) => {
      send({ kind: REQUEST_KIND.EDIT, text, messageId });
    },
    [send]
  );

  const handleRegenerate = useCallback(
    (messageId: string) => {
      if (sending.current) return;
      sending.current = true;
      lastRequest.current = { kind: REQUEST_KIND.REGENERATE };
      setEditRestore(undefined);
      void regenerate({ messageId });
    },
    [regenerate]
  );

  const handleSwitch = useCallback(
    (messageId: string) => {
      setEditRestore(undefined);
      switchBranch({ id: chat.id, data: { activeMessageId: messageId } }, { onSuccess: invalidateChat });
    },
    [switchBranch, chat.id, invalidateChat]
  );

  const handleStop = useCallback(() => {
    void stop();
  }, [stop]);

  const handleModelChange = useCallback(
    (modelId: string) => {
      changeModel({ id: chat.id, data: { modelId } }, { onSuccess: invalidateChat });
    },
    [changeModel, chat.id, invalidateChat]
  );

  const saveSettings = useCallback(
    async (next: ChatSettings) => {
      await saveSettingsRequest({
        id: chat.id,
        data: { systemPrompt: next.systemPrompt, params: next.params },
      });
      invalidateChat();
    },
    [saveSettingsRequest, chat.id, invalidateChat]
  );

  // The first message of a freshly created chat comes along in the router state: send it once, then drop the state
  // so a reload does not send it again (StrictMode runs this effect twice; the ref makes the second run a no-op).
  const firstMessage = readFirstMessage(location.state);
  useEffect(() => {
    if (firstMessage === undefined || firstSent.current) return;
    firstSent.current = true;
    void navigate(location.pathname, { replace: true, state: null });
    send({ kind: REQUEST_KIND.SEND, text: firstMessage });
  }, [firstMessage, location.pathname, navigate, send]);

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy]);

  const storedById = useMemo(
    () => new Map(chat.messages.map((message) => [message.id, message])),
    [chat.messages]
  );
  const branches = useMemo(() => branchesOf(chat.messages), [chat.messages]);

  const mutationFailed = branchUpdate.isError || modelUpdate.isError;
  const mutationError = branchUpdate.isError ? branchUpdate.error : modelUpdate.error;

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-4">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold wrap-break-word">
          {chatTitle(chat.title, t('chats.untitled'))}
        </h1>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <ModelPicker
            value={chat.modelId}
            disabled={locked || modelUpdate.isPending}
            onChange={handleModelChange}
          />
          <ChatSettingsDialog
            value={{ systemPrompt: chat.systemPrompt, params: chat.params }}
            onSave={saveSettings}
          />
        </div>
      </header>
      <ol aria-label={t('chats.messages')} className="flex-1 space-y-6">
        {messages.map((message, index) => {
          const restore: EditRestore | undefined =
            editRestore?.messageId === message.id ? editRestore : undefined;
          return (
            <MessageItem
              key={message.id}
              message={message}
              stored={storedById.get(message.id)}
              branch={branches.get(message.id)}
              live={busy && index === messages.length - 1 && message.role === 'assistant'}
              locked={locked}
              restore={restore}
              onRegenerate={handleRegenerate}
              onEdit={handleEdit}
              onSwitch={handleSwitch}
            />
          );
        })}
        {status === 'submitted' && (
          <li role="status" className="text-muted-foreground text-sm">
            {t('chats.message.pending')}
          </li>
        )}
      </ol>
      <div className="bg-background sticky bottom-0 space-y-2 pb-2">
        {status === 'error' && error !== undefined && (
          <p role="alert" className="text-destructive text-sm">
            {t(chatErrorKey(error))}
          </p>
        )}
        {mutationFailed && (
          <p role="alert" className="text-destructive text-sm">
            {t(chatErrorKey(mutationError))}
          </p>
        )}
        <Composer
          key={composerRestore?.token ?? 0}
          busy={busy}
          disabled={false}
          initialText={composerRestore?.text}
          onSend={handleSend}
          onStop={handleStop}
        />
      </div>
      <div ref={end} />
    </div>
  );
}

export function ChatView({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const detail = useChatDetail(chatId);

  if (detail.isPending) return <PageLoading />;
  if (detail.data === undefined) {
    if (detail.error instanceof ApiError && detail.error.status === 404) {
      return (
        <div className="mx-auto max-w-3xl space-y-3">
          <p role="alert">{t('chats.error.gone')}</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/chats">{t('chats.list.new')}</Link>
          </Button>
        </div>
      );
    }
    return (
      <LoadError
        error={detail.error}
        busy={detail.isFetching}
        onRetry={() => {
          void detail.refetch();
        }}
      />
    );
  }
  return (
    <>
      {detail.isRefetchError && (
        <LoadError
          error={detail.error}
          busy={detail.isFetching}
          onRetry={() => {
            void detail.refetch();
          }}
        />
      )}
      <ChatSession chat={detail.data} syncToken={detail.dataUpdatedAt} />
    </>
  );
}
```

`apps/web/src/pages/chat-page.tsx`:

```tsx
import { useParams } from 'react-router';

import { ChatView } from '@/features/chats/chat-view';

export function ChatPage() {
  const { id } = useParams();
  if (id === undefined) throw new Error('The chat route has no id');
  // The key gives every chat its own session: no running state carries over from the chat before.
  return <ChatView key={id} chatId={id} />;
}
```

(Die Dateien `chat-view.tsx` und `chat-page.tsx` sind getrennt, damit die Seite nur den Parameter liest und die Ansicht ohne Router-Parameter testbar bleibt.)

- [ ] **Step 6: Tests laufen lassen, Fehler beheben**

Run: `pnpm --filter @owui/web exec vitest run src/pages/chat-page.spec.tsx src/features/chats/chat-navigation.spec.ts`
Expected: PASS. Bekannte Stolpersteine, der Reihe nach prüfen, bevor man den Code ändert:
1. Stirbt ein Test mit „The operation was aborted“ als ungefangenem Fehler, behandelt `useChat` den Abbruch des Test-Streams als Fehler: dann prüfen, ob `openSse` den Fehler als `AbortError` mit `name === 'AbortError'` wirft (`DOMException`), das SDK erkennt Abbrüche daran.
2. Meldet der „stop“-Test, dass sofort nach dem Klick schon neu geladen wurde, kam `onFinish` ohne `isAbort`: Version und Verhalten von `stop()` in den Typen von `@ai-sdk/react` prüfen (nicht die Wartezeit verlängern, um den Test grün zu machen).
3. Findet „regenerates … once“ zwei Anfragen, ruft `dblClick` den Handler zweimal vor dem Neuzeichnen auf: das `sending`-Ref muss greifen; steht `sending.current = true` vor dem `regenerate`-Aufruf?
4. „ghost“-Tests: der Text steht im `textarea`; `within(messageList())` schließt es aus, nicht `screen.queryByText`.
5. Der Test „first message“: scheitert er, weil `firstMessage` beim zweiten Render fehlt, ist das gewollt (State gelöscht); der Zähler `toHaveLength(1)` belegt, dass die zwei Läufe von StrictMode im Test nicht auftreten (Test ohne StrictMode); die Handprobe in Task 11 belegt den Entwicklungsmodus.

Mutationsproben, jeweils rot sehen, dann zurücksetzen:
1. `resync` in `onError` entfernen → „does not leave a ghost message“ und „puts the old answer back“ werden rot.
2. `ABORT_SETTLE_MS` auf `0` → der Stopp-Test sieht den sofortigen Neuladen-Aufruf (`toHaveLength(loadsBefore)` rot).
3. `if (sending.current) return;` in `handleRegenerate` entfernen → „regenerates … once“ wird rot.
4. `stored` in `MessageItem` immer als vorhanden behandeln (Task 7) ist dort schon geprüft; hier: `storedById.get(message.id)` durch `chat.messages[0]` ersetzen → „sends the question … loads the stored chat“ wird rot (Aktionen an der frisch gestreamten Antwort).
5. `questionIsStored` immer `false` → „does not give the text back when the connection breaks after the answer began“ wird rot (der Text käme ins Eingabefeld zurück, die Frage stünde doppelt da).

- [ ] **Step 7: Den zurückgestellten Test aus Task 5 aktivieren**

In `apps/web/src/features/chats/chat-list.spec.tsx` das `it.skip(` des Tests „leaves the chat that is open when it is deleted“ wieder auf `it(` stellen.

Run: `pnpm --filter @owui/web exec vitest run`
Expected: alle Web-Tests grün, kein `skip` im Repo (`grep -rn "it.skip\|describe.skip" apps/web/src` ohne Treffer).

- [ ] **Step 8: `pnpm check`, Commit**

Run: `pnpm check`
Expected: grün. Meldet `react-hooks` eine Regel (Refs im Render, `set-state-in-effect`), die Stelle so umbauen, dass die Regel erfüllt ist (nicht unterdrücken); die zwei bewussten Muster (`setState` beim Rendern in `MessageItem` nach einem neuen Token, Refs in Effekten) sind die dokumentierten React-Muster.

```bash
git add apps/web/src
git commit -m "feat(web): chat view with streaming, stop, regenerate, edit and versions

useChat on top of the transport; the server owns the tree, so every end of a stream reloads
the chat and the shown branch comes from activeLeafId. A request that fails before the answer
begins drops the optimistic message and gives the text back; an error inside the stream shows
as the stored note. After a stop the reload waits for the server to store the partial answer."
```

---

### Task 10: Neuer Chat und Einstieg

Die Seite `/chats` lässt das Modell wählen, Anweisung und Parameter als Entwurf einstellen und die erste Nachricht schreiben. Erst beim Senden entsteht der Chat (`POST /api/chats`), dann geht es nach `/chats/<id>`, wo die Chatansicht die erste Nachricht aus dem Router-State sendet.

**Files:**
- Create: `apps/web/src/features/chats/new-chat.tsx`, `apps/web/src/pages/new-chat-page.tsx`, `apps/web/src/pages/new-chat-page.spec.tsx`
- Modify: `apps/web/src/app/router.tsx`, `apps/web/src/pages/home-page.tsx`

**Interfaces:**
- Consumes: `useModels`, `ModelPicker`, `ChatSettingsDialog`, `Composer`, `firstMessageState`, `chatErrorKey`, `useChatsCreate`.
- Produces: `NewChat()`, `NewChatPage()`; Routen `chats` und `chats/:id`; Link „Chat starten“ auf der Startseite.

- [ ] **Step 1: Failing tests schreiben**

`apps/web/src/pages/new-chat-page.spec.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageDtoRole, UnavailableConnectionDtoReason } from '@/api/generated/model';
import {
  chatDetailDto,
  chatTime,
  messageDto,
  modelDto,
  modelList,
  sessionInfo,
  textParts,
  userDto,
} from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { answerChunks, sseResponse } from '@/test/sse';
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

function bodyOfLast(fetchMock: ReturnType<typeof stubApi>, method: string, path: string): unknown {
  const body = callsTo(fetchMock, method, path).at(-1)?.[1]?.body;
  return typeof body === 'string' ? (JSON.parse(body) as unknown) : undefined;
}

async function openNewChat() {
  const view = renderApp('/chats');
  await screen.findByRole('heading', { level: 1, name: 'Neuer Chat' });
  return view;
}

describe('NewChatPage', () => {
  it('offers the models, the settings and the message box', async () => {
    stubMember();

    await openNewChat();

    expect(await screen.findByRole('option', { name: 'gpt-x (Cloud)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Modell')).toHaveValue(LLAMA.id);
    expect(screen.getByRole('button', { name: 'Einstellungen' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nachricht')).toBeInTheDocument();
  });

  it('creates the chat with the chosen model and settings, then opens it and sends the first message once', async () => {
    const created = chatDetailDto({ id: 'c-new', modelId: GPT.id, title: 'Neuer Chat' });
    let stored = created;
    const fetchMock = stubMember({
      'POST /api/chats': () => json(201, created),
      'GET /api/chats/c-new': () => json(200, stored),
      'POST /api/chats/c-new/stream': () => {
        stored = {
          ...created,
          messages: [
            messageDto({ id: 'u1', parts: textParts('Erste Frage'), createdAt: chatTime(0) }),
            messageDto({
              id: 'a1',
              parentId: 'u1',
              role: MessageDtoRole.assistant,
              parts: textParts('Erste Antwort'),
              createdAt: chatTime(1),
            }),
          ],
          activeLeafId: 'a1',
        };
        return sseResponse(answerChunks('Erste Antwort', { userMessageId: 'u1', assistantMessageId: 'a1' }));
      },
    });
    const user = userEvent.setup();
    const { router } = await openNewChat();
    await screen.findByRole('option', { name: 'gpt-x (Cloud)' });

    await user.selectOptions(screen.getByLabelText('Modell'), GPT.id);
    await user.click(screen.getByRole('button', { name: 'Einstellungen' }));
    await user.type(screen.getByLabelText('Anweisung für das Modell'), 'Antworte kurz.');
    await user.type(screen.getByLabelText(/Kreativität/), '0.2');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await user.type(screen.getByLabelText('Nachricht'), 'Erste Frage{Enter}{Enter}');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/chats/c-new');
    });
    expect(callsTo(fetchMock, 'POST', '/api/chats')).toHaveLength(1);
    expect(bodyOfLast(fetchMock, 'POST', '/api/chats')).toEqual({
      modelId: GPT.id,
      systemPrompt: 'Antworte kurz.',
      params: { temperature: 0.2 },
    });
    expect(await screen.findByText('Erste Antwort')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/chats/c-new/stream')).toHaveLength(1);
    expect(bodyOfLast(fetchMock, 'POST', '/api/chats/c-new/stream')).toEqual({
      parentId: null,
      text: 'Erste Frage',
    });
    expect(router.state.location.state).toBeNull();
  });

  it('keeps the text and says so when the chat cannot be created', async () => {
    stubMember({ 'POST /api/chats': () => problem(404, 'Not Found') });
    const user = userEvent.setup();
    await openNewChat();

    await user.type(screen.getByLabelText('Nachricht'), 'Hallo{Enter}');

    expect(
      await screen.findByText('Der Chat oder das Modell ist nicht mehr verfügbar.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nachricht')).toHaveValue('Hallo');
    expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled();
  });

  it('blocks the box while the chat is being created', async () => {
    let release: () => void = () => undefined;
    const fetchMock = stubMember({
      'POST /api/chats': () =>
        new Promise<Response>((resolve) => {
          release = () => {
            resolve(json(201, chatDetailDto({ id: 'c-new' })));
          };
        }),
    });
    const user = userEvent.setup();
    await openNewChat();

    await user.type(screen.getByLabelText('Nachricht'), 'Hallo{Enter}');
    await user.type(screen.getByLabelText('Nachricht'), 'Noch eine{Enter}');

    expect(await screen.findByText('Der Chat wird angelegt …')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', '/api/chats')).toHaveLength(1);
    release();
  });

  it('says that an administrator has to connect a provider when there is no model', async () => {
    stubMember({ 'GET /api/models': () => json(200, modelList([])) });

    await openNewChat();

    expect(
      await screen.findByText(
        'Es ist noch kein Modell verfügbar. Ein Administrator muss zuerst einen Anbieter verbinden.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zu den Modellen' })).toHaveAttribute('href', '/models');
    expect(screen.queryByLabelText('Nachricht')).not.toBeInTheDocument();
  });

  it('says that no model is reachable when the providers did not answer', async () => {
    stubMember({
      'GET /api/models': () =>
        json(
          200,
          modelList([], [
            { id: 'c-local', name: 'Lokal', reason: UnavailableConnectionDtoReason.unreachable },
          ])
        ),
    });

    await openNewChat();

    expect(await screen.findByText('Im Moment ist kein Modell erreichbar.')).toBeInTheDocument();
  });

  it('shows a retry when the models cannot be loaded', async () => {
    const user = userEvent.setup();
    const handlers: Record<string, Handler> = {
      'GET /api/models': () => problem(500, 'Internal Server Error'),
    };
    stubMember(handlers);
    renderApp('/chats');
    await screen.findByText('Das Laden hat nicht geklappt.');

    handlers['GET /api/models'] = () => json(200, modelList([LLAMA]));
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByLabelText('Nachricht')).toBeInTheDocument();
  });

  it('is reachable from the start page', async () => {
    stubMember();
    const user = userEvent.setup();
    renderApp('/');

    await user.click(await screen.findByRole('link', { name: 'Chat starten' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Neuer Chat' })).toBeInTheDocument();
  });
});
```

(Die Form von `UnavailableConnectionDto` (`id`, `name`, `reason`) steht in `apps/web/src/api/generated/model/unavailableConnectionDto.ts`; weicht sie ab, die Fixture an die Datei anpassen.)

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `pnpm --filter @owui/web exec vitest run src/pages/new-chat-page.spec.tsx`
Expected: FAIL (Seite und Route fehlen).

- [ ] **Step 3: Implementieren**

`apps/web/src/features/chats/new-chat.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { useChatsCreate } from '@/api/generated/api';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';
import { Button } from '@/components/ui/button';
import { useModels } from '@/features/models/use-models';

import { chatErrorKey } from './chat-errors';
import { firstMessageState } from './chat-navigation';
import { type ChatSettings, ChatSettingsDialog } from './chat-settings-dialog';
import { Composer } from './composer';
import { ModelPicker } from './model-picker';

interface Restore {
  token: number;
  text: string;
}

function nothingToStop() {
  // Creating a chat is quick and cannot be stopped; the composer is only blocked while it runs.
}

export function NewChat() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const models = useModels();
  const create = useChatsCreate();
  const [chosen, setChosen] = useState<string>();
  const [settings, setSettings] = useState<ChatSettings>({ systemPrompt: null, params: {} });
  const [restore, setRestore] = useState<Restore>();

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

  const [first] = models.data.models;
  if (first === undefined) {
    return (
      <div className="space-y-3">
        <p>
          {models.data.unavailableConnections.length > 0
            ? t('chats.new.noModelsReachable')
            : t('chats.new.noModels')}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/models">{t('chats.new.toModels')}</Link>
        </Button>
      </div>
    );
  }
  const modelId = chosen ?? first.id;

  function start(text: string) {
    create.mutate(
      { data: { modelId, systemPrompt: settings.systemPrompt, params: settings.params } },
      {
        onSuccess: (response) => {
          // Only 201 is ever returned here (apiFetch throws the rest).
          if (response.status === 201) {
            void navigate(`/chats/${response.data.id}`, { state: firstMessageState(text) });
          }
        },
        onError: () => {
          setRestore((previous) => ({ token: (previous?.token ?? 0) + 1, text }));
        },
      }
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t('chats.new.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('chats.new.intro')}</p>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <ModelPicker value={modelId} disabled={create.isPending} onChange={setChosen} />
          <ChatSettingsDialog
            value={settings}
            onSave={(next) => {
              setSettings(next);
              return Promise.resolve();
            }}
          />
        </div>
      </header>
      {create.isError && (
        <p role="alert" className="text-destructive text-sm">
          {t(chatErrorKey(create.error))}
        </p>
      )}
      {create.isPending && (
        <p role="status" className="text-muted-foreground text-sm">
          {t('chats.new.creating')}
        </p>
      )}
      <Composer
        key={restore?.token ?? 0}
        busy={false}
        disabled={create.isPending}
        initialText={restore?.text}
        onSend={start}
        onStop={nothingToStop}
      />
    </div>
  );
}
```

`apps/web/src/pages/new-chat-page.tsx`:

```tsx
import { NewChat } from '@/features/chats/new-chat';

export function NewChatPage() {
  return <NewChat />;
}
```

`apps/web/src/app/router.tsx`: Import `import { NewChatPage } from '@/pages/new-chat-page';` (alphabetisch nach `ModelsPage`) und vor der Route `chats/:id` einfügen:

```tsx
          { path: 'chats', element: <NewChatPage /> },
```

`apps/web/src/pages/home-page.tsx`: Imports `import { Link } from 'react-router';` und `import { Button } from '@/components/ui/button';` ergänzen und nach dem Intro-Absatz einfügen:

```tsx
      <Button asChild>
        <Link to="/chats">{t('home.startChat')}</Link>
      </Button>
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @owui/web exec vitest run`
Expected: alle Web-Tests grün. Mutationsproben: (1) `disabled={create.isPending}` am Composer entfernen → „blocks the box while the chat is being created“ zählt zwei `POST /api/chats` (rot); (2) `onError` entfernen → „keeps the text“ wird rot; (3) `firstMessageState(text)` weglassen → die Chatansicht sendet nichts, der Stream-Test wird rot.

- [ ] **Step 5: `pnpm check`, Commit**

Run: `pnpm check`
Expected: grün.

```bash
git add apps/web/src
git commit -m "feat(web): start a chat from a new-chat page and the start page

Model, instruction and parameters are a draft until the first message; the chat is created
then, and its first message travels in the router state so the chat page sends it once."
```

---

### Task 11: Browserprobe über Caddy

Die Komponententests laufen in jsdom ohne Layout, ohne CSP und ohne echten Stream. Diese Task prüft, was dort nicht geht, an der laufenden App mit dem Fake-Anbieter (Muster: [DoD 2b](../../dod/02-modell-anbindung-web.md) und [DoD 3a](../../dod/03-chat-backend.md)). Gefundene Abweichungen werden **jede in einem eigenen Commit mit Test zuerst** behoben; die Probe läuft danach für diesen Punkt neu.

**Files:**
- Modify: `scripts/fake-provider.mjs` (Antwort und Abstand per Umgebungsvariable einstellbar; Standard unverändert)
- Create (nur im Scratchpad, nicht im Repo): `evil-deltas.json`

**Interfaces:**
- Consumes: alles aus Task 1 bis 10; Fake-Anbieter und Smoke-Test aus 3a.
- Produces: die Befunde für `docs/dod/03-chat-web.md` (Task 12).

- [ ] **Step 1: Fake-Anbieter einstellbar machen**

In `scripts/fake-provider.mjs` den Kopfkommentar um zwei Zeilen und die Zuweisung von `deltas` und `streamDelayMs` ersetzen. Kopfkommentar (nach der Zeile mit `key:`):

```js
//   FAKE_DELTAS:   JSON array of strings, the pieces of a chat answer (default: three short pieces)
//   FAKE_DELAY_MS: pause between the pieces in milliseconds (default: 200)
```

und ersetzen:

```js
// A chat answers in three pieces, 200 ms apart, so the stream is visible in the browser. A non-streaming
// request (the title job) gets the same text joined; the title is then the whole answer.
provider.deltas = ['Hallo ', 'aus dem ', 'Testanbieter.'];
provider.streamDelayMs = 200;
```

durch:

```js
// A chat answers in three pieces, 200 ms apart, so the stream is visible in the browser. A non-streaming
// request (the title job) gets the same text joined; the title is then the whole answer.
function readDeltas(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every((piece) => typeof piece === 'string')) {
    console.error('FAKE_DELTAS must be a JSON array of strings');
    process.exit(1);
  }
  return parsed;
}

provider.deltas =
  process.env.FAKE_DELTAS === undefined
    ? ['Hallo ', 'aus dem ', 'Testanbieter.']
    : readDeltas(process.env.FAKE_DELTAS);
provider.streamDelayMs = Number(process.env.FAKE_DELAY_MS ?? '200');
```

Run: `node scripts/fake-provider.mjs 11500 ok & sleep 1; kill %1`
Expected: Ausgabe `fake provider on port 11500, mode ok` (Standard unverändert). Das Skript hat keinen eigenen Test (wie bisher); `pnpm check` muss grün sein.

```bash
git add scripts/fake-provider.mjs
git commit -m "chore: make the fake provider's answer and pace settable

FAKE_DELTAS and FAKE_DELAY_MS, for the browser check of the chat (a long answer to stop,
a hostile answer to render). The default is unchanged."
```

- [ ] **Step 2: App starten (eigenes Compose-Projekt)**

Das Scratchpad-Verzeichnis steht im Systemprompt der Sitzung (`$SCRATCH` im Folgenden). Wegwerf-Werte nur in der Shell, nie in eine Datei im Repo; `.env*` nicht lesen.

```bash
node scripts/fake-provider.mjs 11500 ok   # Hintergrund-Prozess A (run_in_background)
docker compose -p owui-probe up --build -d
node scripts/smoke.mjs http://localhost:8080
```

Expected: alle Smoke-Prüfungen grün. Fehlt Compose eine Variable, die sonst aus einer `.env` kommt, mit `.env.example` als Vorlage eine Wegwerf-Datei **außerhalb des Repos** anlegen und mit `--env-file` übergeben (Schlüssel und Passwörter frisch erzeugen, z. B. `openssl rand -base64 24`).

Im Browser (Chrome-DevTools-Werkzeuge: `new_page`, `take_snapshot`, `click`, `fill`, `press_key`, `list_console_messages`, `list_network_requests`, `emulate`, `resize_page`, `take_screenshot`) `http://localhost:8080` öffnen, das erste Konto registrieren (wird Admin) und unter „Modell-Anbindungen“ eine Verbindung anlegen: Name `Probe`, Adresse `http://host.docker.internal:11500`, Art Ollama.

- [ ] **Step 3: Probe durchgehen und festhalten**

Jede Zeile bekommt im DoD (Task 12) ein Ergebnis in einem Satz. Die Konsole (`list_console_messages`) nach jedem Abschnitt prüfen: **keine** CSP-Verletzung, kein unerwarteter Fehler (erwartete 4xx werden als „Failed to load resource“ protokolliert, siehe DoD 2b).

1. **Einstieg:** Startseite hat den Knopf „Chat starten“; Klick öffnet `/chats` mit Modellauswahl (Modell „llama3:8b“ oder was der Fake meldet, Anbieter „Probe“), Einstellungen und Eingabefeld; die Seitenleiste zeigt „Chats“ mit „Du hast noch keine Chats.“.
2. **Erste Nachricht:** Anweisung „Antworte kurz.“ unter „Einstellungen“ speichern, „Hallo“ senden. Erwartung: Wechsel nach `/chats/<id>`, die Nachricht steht sofort da, „Die Antwort wird erzeugt …“ erscheint, die Antwort kommt **in drei Stücken** (nicht auf einmal), während des Streams zeigt der Knopf „Stoppen“ und „Neu erzeugen“ ist gesperrt. `list_network_requests`: genau ein `POST /api/chats` und ein `POST …/stream`; **Seite neu laden** sendet nichts erneut (kein zweites `POST …/stream`), die Adresszeile hat keinen Zustand.
3. **Titel:** innerhalb von etwa 30 s ändert sich der Titel in Überschrift und Seitenleiste vom Ersatz auf den erzeugten (beim Fake: die ganze Antwort); danach kommen keine weiteren Abfragen von `GET /api/chats/<id>` im Takt von 3 s.
4. **Stopp:** Fake mit langer Antwort neu starten (Prozess A beenden): `FAKE_DELTAS="$(node -e 'console.log(JSON.stringify(Array.from({length: 40}, (_, i) => "Wort" + i + " ")))')" FAKE_DELAY_MS=200 node scripts/fake-provider.mjs 11500 ok` (Hintergrund). Nachricht senden, nach etwa zwei Sekunden „Stoppen“. Erwartung: die Teilantwort bleibt sichtbar, **verschwindet nicht**; nach rund einer Sekunde erscheint „Die Antwort wurde abgebrochen.“; nach einem Neuladen der Seite steht derselbe Teiltext mit demselben Hinweis. Das ist der Beleg für die Wartezeit `ABORT_SETTLE_MS`: verschwindet der Teiltext kurz oder dauerhaft, ist die Heuristik falsch (Abweichung: Wartezeit nicht blind erhöhen, sondern die Ursache im Ablauf suchen und festhalten).
5. **Neu erzeugen und Versionen:** an der Antwort „Neu erzeugen“ (die Ausgabe des Fake ist gleich; es zählt die Mechanik): nach dem Ende steht „‹ 2/2 ›“, Pfeil zurück zeigt die erste Fassung, Pfeil vor die zweite; nach einem Neuladen gilt der zuletzt gewählte Ast. Mit „Bearbeiten“ an der ersten Nachricht „Hallo, anders“ senden: neuer Ast, Umschalter an der Nachricht und an der Antwort stimmen, die erste Fassung ist über den Umschalter erreichbar.
6. **Fehler im Stream:** Fake mit `node scripts/fake-provider.mjs 11500 server_error` neu starten, Nachricht senden. Erwartung: Hinweis „Die Antwort wurde unterbrochen …“, nach dem Neuladen steht die Antwort im Verlauf mit „Die Antwort ist fehlgeschlagen und wird dem Modell nicht mitgeschickt.“ und dem Grund, „Neu erzeugen“ ist möglich (Fake wieder auf `ok`, Neu erzeugen klappt). Der Text des Anbieters erscheint nirgends.
7. **Fehler vor dem Stream:** Eine Nachricht mit mehr als 20000 Zeichen einfügen (React-gesteuertes Feld, deshalb per Skript): `evaluate_script` mit
   `() => { const box = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(box, 'x'.repeat(25000)); box.dispatchEvent(new Event('input', { bubbles: true })); }`
   und senden. Erwartung: Meldung „Die Nachricht ist zu lang.“ (`422`), der Text steht wieder im Feld, im Verlauf steht keine Geisternachricht. Antwortet der Server mit einem anderen Status, die Meldung des Falls notieren.
8. **Doppelaktionen:** zweimal schnell „Enter“, Doppelklick auf „Neu erzeugen“ und auf den Umschalter: je **eine** Anfrage in `list_network_requests`.
9. **Liste:** mehrere Chats anlegen; Suche nach einem Wort aus einem Titel (nach etwa 300 ms eine Anfrage mit `q=`); Suche ohne Treffer zeigt „Keine Chats gefunden.“; Löschen eines anderen Chats mit Rückfrage; Löschen des offenen Chats führt nach `/chats`. Zwei Chats kurz hintereinander löschen: der zweite Löschknopf ist während der ersten Anfrage gesperrt.
10. **Markdown aus unvertrauter Quelle:** Hilfsserver `node -e "require('node:http').createServer((q,r)=>{console.log('HIT '+q.url);r.end()}).listen(11501)"` im Hintergrund starten (zeigt jede Anfrage an `localhost:11501`). Die Datei `$SCRATCH/evil-deltas.json` erzeugen:
    `node -e 'const long = "x".repeat(400); console.log(JSON.stringify(["Bild: ![Logo](http://localhost:11501/pixel.png?d=geheim)\n\n","<script>window.__pwned = 1</script>\n\n<img src=x onerror=\"window.__pwned = 3\">\n\n","[Klick](javascript:window.__pwned=2) und [relativ](/admin/users)\n\n","```js\nconst zeile = '" + long + "';\n```\n"]))' > "$SCRATCH/evil-deltas.json"`
    Fake mit `FAKE_DELTAS="$(cat "$SCRATCH/evil-deltas.json")" node scripts/fake-provider.mjs 11500 ok` neu starten, eine Nachricht senden. Erwartung (per `take_snapshot` und `evaluate_script`):
    - kein `<img>` und kein `<script>` im Nachrichtenbereich (`document.querySelectorAll('ol img, ol script').length === 0`), `window.__pwned === undefined`;
    - „Logo“ ist ein Link auf die Adresse, kein Bild; **der Hilfsserver meldet kein `HIT`**, `list_network_requests` zeigt keine Anfrage an `localhost:11501`;
    - „Klick“ und „relativ“ sind kein Link (`document.querySelectorAll('ol a')` enthält nur den „Logo“-Link);
    - die Rohtexte `<script>…` und `<img …>` stehen als Text da;
    - der Codeblock ist hervorgehoben, hat den Kopieren-Knopf (nach dem Klick „Kopiert.“, Inhalt per `navigator.clipboard.readText()` gleich dem Code) und die lange Zeile scrollt **im Block** (`document.documentElement.scrollWidth <= window.innerWidth`);
    - der erzeugte Titel (er enthält den Text der Antwort) erscheint in der Liste und in der Überschrift als Text, ohne Element.
11. **Darstellung:** dunkel (Schalter oben) und Telefonbreite (`resize_page` auf 375 × 812): Eingabefeld bleibt unten sichtbar, kein waagerechtes Scrollen der Seite, Umschalter und Knöpfe erreichbar, Seitenleiste lässt sich öffnen. Schnappschüsse ansehen: Kontrast des Codes, der Hinweise und der Fehlermeldung lesbar.
12. **Größe:** `pnpm --filter @owui/web build` und die Größe der Hauptdatei (gzip) notieren; wächst sie um mehr als etwa 300 kB gegenüber dem Stand vor diesem Plan (`git stash`-frei: Zahl aus dem Build-Protokoll von Task 3 Step 6 gegen jetzt vergleichen), kommt „Markdown und Hervorhebung nachladen“ als Backlog-Eintrag dazu (ohnehin eingetragen, hier mit der Zahl).
13. **Entwicklungsmodus (StrictMode):** nicht Teil dieser Probe; ob die erste Nachricht dort genau einmal gesendet wird, belegt nur der Test mit dem Ref. Im DoD als „nicht im Browser geprüft“ nennen.

- [ ] **Step 4: Abweichungen beheben**

Für jede Abweichung: zuerst einen Test schreiben, der sie zeigt (rot), dann die kleinste Änderung, `pnpm check`, eigener Commit `fix(web): …`, die betroffene Zeile der Probe wiederholen. Abweichungen, die sich nicht in einem Komponententest abbilden lassen (Layout, Browserverhalten), mit Begründung ohne Test beheben und im DoD benennen.

- [ ] **Step 5: Aufräumen**

```bash
docker compose -p owui-probe down -v
```

Beide Fake-Prozesse und den Hilfsserver beenden, Wegwerf-Dateien (`evil-deltas.json`, Wegwerf-`.env`) löschen. Expected: `docker compose -p owui-probe ps -a` leer, `docker volume ls | grep owui-probe` ohne Treffer.

---

### Task 12: Dokumentation, Abschlussprüfung und DoD-Beleg

Eine Änderung am Vertrag oder an der Architektur gehört in denselben Commit wie die Doku. Diese Task schreibt die Doku nach, die über die Tasks hinweg gewachsen ist, und beweist den Stand.

**Files:**
- Modify: `docs/PLAN.md`, `docs/BACKLOG.md`, `docs/THREAT-MODEL.md`, `docs/adr/0004-chat-streaming-protokoll.md`, `docs/superpowers/specs/2026-10-10-teilprojekt-3-chat-streaming-design.md`, `README.md`
- Create: `docs/dod/03-chat-web.md`

- [ ] **Step 1: Alles grün, Vertrag unverändert**

Run: `pnpm check && pnpm test && pnpm openapi && git diff --exit-code apps/api/openapi.json apps/web/src/api/generated`
Expected: grün, kein Unterschied am erzeugten Client. Die Zahlen (Dateien und Tests je Paket) aus der Ausgabe von `pnpm test` für den DoD notieren. `pnpm audit --prod` ohne bekannte Schwachstellen (Datum notieren).

Run: `grep -rn "it.skip\|describe.skip\|it.only\|describe.only\|console\.\(log\|error\|warn\)" apps/web/src --include=*.ts --include=*.tsx | grep -v generated`
Expected: keine Treffer (Invariante 4: keine Inhalte in `console`).

- [ ] **Step 2: PLAN.md**

Zeile 3 der Tabelle ersetzen durch

```
| 3   | Chat + Streaming                                | erledigt: [Spec](superpowers/specs/2026-10-10-teilprojekt-3-chat-streaming-design.md), Plan [3a](superpowers/plans/2026-10-10-teilprojekt-3a-chat-backend.md), [3b](superpowers/plans/2026-10-10-teilprojekt-3b-chat-web.md), Belege: [DoD 3a](dod/03-chat-backend.md), [DoD 3b](dod/03-chat-web.md); [ADR 0004](adr/0004-chat-streaming-protokoll.md) |
```

und den Abschnitt „Als Nächstes“ durch

```
## Als Nächstes

1. Teilprojekt 4 (RAG mit Hybrid-Suche): Spec im Brainstorming erarbeiten, danach Plan 4a (Backend) und 4b (Web).
   Offen aus Teilprojekt 3 (Ordner und Tags für Chats als 3c, Umbenennen in der Oberfläche u. a.) steht im
   [Backlog](BACKLOG.md).
```

- [ ] **Step 3: BACKLOG.md**

Die Zeile „Antworten mit Status `error` fehlen im Verlauf“ **löschen** (gelöst: der Verlauf zeigt sie mit Hinweis und „Neu erzeugen“, Test „shows a failed answer with its note“). Diese Zeilen in dieselbe Tabelle einfügen (Spalten wie die übrigen, Prettier richtet sie aus):

```
| Chat in der Oberfläche umbenennen                | Die API setzt den Titel per `PATCH` (`titleSource = user`); die Oberfläche bietet es noch nicht an.                                                                                |
| Markdown und Hervorhebung nachladen              | `react-markdown`, `remark-gfm` und `rehype-highlight` liegen im Hauptpaket der Chatansicht; mit `React.lazy` erst beim ersten Chat laden, Größe siehe DoD 3b.                      |
| Wartezeit nach dem Stopp ist eine Heuristik      | Nach einem Stopp lädt die Seite nach 500 ms neu, weil der Server die Teilantwort erst beim Schließen seines Stroms speichert. Besser: der Client fragt, bis die Antwort da ist.    |
| Mitscrollen beim Streamen                        | Die Liste scrollt bei neuen Nachrichten, nicht bei jedem Stück der Antwort; eine lange Antwort wächst unter den Rand.                                                              |
| Laufende Antwort beim Verlassen der Seite        | Wechselt der Nutzer den Chat oder löscht den offenen Chat, läuft der Stream bis zu seinem Ende weiter (der Server speichert die Antwort, im gelöschten Chat scheitert das, siehe oben). |
| Lange Chats ohne Virtualisierung                 | Die Nachrichtenliste rendert alle Nachrichten des Asts; `memo` und eine eigene Eingabe halten das Tippen leicht, sehr lange Verläufe bräuchten ein virtualisiertes Fenster.         |
```

(Nur die Punkte eintragen, die in Task 11 nicht anders ausgegangen sind; wurde etwas dort behoben, die Zeile weglassen.)

- [ ] **Step 4: THREAT-MODEL.md**

In der Tabelle der Bedrohungen die Zeile „Daten-Ausleitung über Markdown (Bilder, Links)“ in der Spalte der Maßnahme ersetzen durch: „Bilder werden nie geladen (sie erscheinen als Link), Links nur `http`, `https`, `mailto` mit `rel="noopener noreferrer"`, rohes HTML wird Text, `urlTransform` und `safeHref` als zwei Schichten; Tests mit Bild, Skript und `javascript:`-Link, Handprobe ohne Bildanfrage (3b)“, und zwei Zeilen darunter einfügen:

```
| Tampering | HTML in Titel, Nachricht oder Modellname | Alles wird als Text gerendert, kein `dangerouslySetInnerHTML` (ESLint-Regel); Tests mit `<img onerror>` in Titel, Chatliste und Nachricht (3b) |
| Tampering | Schreibzugriff auf die Stream-Route über eine fremde Seite (CSRF) | Der Transport sendet `X-CSRF-Token` wie `apiFetch` (Test in `chat-transport.spec.ts`); Cookie `SameSite` wie in Teilprojekt 1 |
```

Run: `pnpm exec prettier --write docs/THREAT-MODEL.md docs/BACKLOG.md docs/PLAN.md`
Expected: Tabellen neu ausgerichtet, keine inhaltliche Änderung.

- [ ] **Step 5: ADR 0004 und Spec 3**

`docs/adr/0004-chat-streaming-protokoll.md`, Abschnitt „Folgen“: den Punkt „Der Web-Client (Plan 3b) muss …“ ersetzen durch:

```
- Der Web-Client bildet mit `prepareSendMessagesRequest` das Senden auf `{ parentId, text }` und `regenerate` auf die
  Route der Antwort ab. Geprüft in Plan 3b (2026-10-10): `regenerate({ messageId })` entfernt die Antwort und alles
  danach aus der Liste und ruft den Transport mit dem Auslöser `regenerate-message` und der `messageId` auf; die
  Metadaten der entfernten Antwort sind dann weg. Der Client erlaubt Neu erzeugen, Bearbeiten und Ast-Wechsel darum
  nur für Nachrichten, die der Server kennt (aus dem geladenen Chat), und lädt den Chat nach jedem Ende eines
  Streams neu. Belegt durch `chat-transport.spec.ts` und `chat-page.spec.tsx`, Handprobe im
  [DoD 3b](../dod/03-chat-web.md).
```

Spec 3: Kopfzeile „Status: Backend umgesetzt (Plan 3a), Web offen (Plan 3b)“ → „Status: umgesetzt (Plan 3a Backend, Plan 3b Web)“; in der Tabelle der Bibliotheken die Zeile „Transport“ am Ende „**teilweise unsicher** → Komponententest und Browserprobe in Plan 3b“ → „**bestätigt in Plan 3b** (siehe ADR 0004)“; in Abschnitt 8 am Ende anfügen:

```
**Umsetzung (Plan 3b):** Abweichungen und Ergänzungen gegenüber diesem Abschnitt: Antworten mit Status `error`
bleiben im Verlauf sichtbar (Hinweis „fehlgeschlagen, wird dem Modell nicht mitgeschickt“, Neu erzeugen möglich);
Aktionen gibt es nur für Nachrichten, die der Server kennt; die erste Nachricht eines neuen Chats reist im
Router-State und wird einmal gesendet; nach einem Stopp lädt die Seite nach 500 ms neu (Heuristik, Backlog); der
Titel wird bis zu zehnmal im Abstand von 3 s nachgeladen; `ChatParams` ist im OpenAPI-Schema typisiert.
```

- [ ] **Step 6: README**

In `README.md` die Zeilen 4 bis 5 (Absatz „Aktueller Stand“) ersetzen durch:

```
einem React-Frontend (Vite, shadcn/ui). Aktueller Stand: **Chat mit Streaming (Teilprojekt 3)**. Es gibt
Anmeldung mit Rollen, die Anbindung von Modellen und einen Chat, der Antworten live zeigt, mit Stoppen,
Neu erzeugen, Bearbeiten und Chatliste. Die Gesamt-Spec steht in
```

(Der folgende Link auf die Gesamt-Spec bleibt unverändert; den Satz so setzen, dass der Absatz grammatisch weiterläuft.)

- [ ] **Step 7: DoD-Beleg**

`docs/dod/03-chat-web.md` nach dem Muster von [03-chat-backend.md](../../dod/03-chat-backend.md) und der [Vorlage](../../dod/TEMPLATE.md) anlegen. Gerüst (die mit `<…>` markierten Stellen sind **Messwerte und Befunde aus den Läufen** und werden aus der echten Ausgabe eingetragen, nicht geschätzt):

```md
### DoD: Teilprojekt 3b (Chat und Streaming, Web)

- [x] Vertrag: Oberfläche nutzt den erzeugten Client; die einzige Ausnahme ist der Stream über den `useChat`-Transport
      (Body-Typ `StreamChatDto` aus dem Client). `ChatParams` ist im OpenAPI-Schema typisiert (Task 1); `pnpm openapi`
      ohne Abweichung.
- [x] Tests: `pnpm test` grün (<n> Web-Dateien, <n> Tests; API unverändert <n>), `pnpm check` grün. Mutationsproben,
      jeweils rot gesehen: <Liste je Task aus den Schritten „Mutationsproben“>.
- [x] Invarianten ([AGENTS.md](../../AGENTS.md) Abschnitt 2): 1 und 4: keine Inhalte in `console` (Suche ohne Treffer),
      Identität nie vom Client (der Transport sendet nur `parentId` und Text); 7a: Markdown ohne HTML und ohne Bilder,
      Links mit festen Schemata, Tests und Handprobe Punkt 10; 8: Zustände jeder Ansicht (laden, leer, Fehler mit
      Wiederholen, in Arbeit) für Chatliste, Chatansicht und neuen Chat; 10: `ai`/`@ai-sdk/react`-Optionen gegen die
      installierten Typen geprüft (`throttle`: <Name>), Bibliotheksversionen <…>; 12: Texte nur über i18n.
- [x] Abhängigkeiten: neu `ai`, `@ai-sdk/react`, `react-markdown`, `remark-gfm`, `rehype-highlight` (Versionen <…>);
      `pnpm audit --prod`: <Ergebnis> (<Datum>). Größe der Hauptdatei: <kB gzip> (vorher <kB>).
- [x] UI: Handprobe im Browser über Caddy (siehe unten); Konsole ohne CSP-Meldung: <Ergebnis>.
- [x] Betrieb: `docker compose -p owui-probe up --build -d`, `node scripts/smoke.mjs http://localhost:8080` grün,
      danach `down -v`.
- [x] Docs: PLAN, BACKLOG, THREAT-MODEL, Spec 3, ADR 0004, README aktualisiert.
- [ ] Offen: siehe [BACKLOG](../BACKLOG.md).

Handprobe (Punkte aus Task 11): <je Punkt 1 bis 12 ein Satz mit dem Ergebnis; Abweichungen mit Commit>.

Nicht oder nur teilweise geprüft:

- Entwicklungsmodus mit StrictMode (die erste Nachricht genau einmal): nur durch den Test mit dem Ref belegt.
- Wartezeit nach dem Stopp (500 ms): in <n> Läufen der Handprobe ohne Verlust des Teiltexts; eine Heuristik (Backlog).
- Echter Anbieter (Ollama, OpenAI-kompatibel): alles gegen den Fake-Anbieter.
- Bildschirmleser: nur Rollen und Namen in Tests, kein Lauf mit einem Bildschirmleser.

Aufräumen: Compose-Projekt `owui-probe` samt Volume, Fake-Anbieter und Hilfsserver beendet, Wegwerf-Dateien gelöscht.
```

- [ ] **Step 8: Abschlussprüfung des ganzen Zweigs**

Einen unabhängigen Prüfer über alle Commits dieses Plans laufen lassen (`git log --oneline` ab dem letzten Commit vor Task 1) mit dem Auftrag: Invarianten aus `AGENTS.md`, Review-Focus dieses Plans, Rennen zwischen Stream-Ende, Neuladen und Aktionen, Zugänglichkeit der neuen Ansichten. Kritische Funde: jeweils Test zuerst (rot), dann beheben, eigener Commit. Zurückgestellte kleine Funde in den Backlog und in den DoD (Abschnitt „Abschlussprüfung“, wie in [DoD 3a](../../dod/03-chat-backend.md)).

- [ ] **Step 9: Commit und CI**

Run: `pnpm check`
Expected: grün (Prettier prüft auch die Markdown-Dateien).

```bash
git add docs README.md
git commit -m "docs: record Teilprojekt 3b (chat web)

PLAN, BACKLOG, THREAT-MODEL, spec 3, ADR 0004 and README, plus the DoD with the browser check.
The backlog item about error answers is resolved; new items come from the check."
git push
gh run list --branch main --limit 1
```

Expected: die CI zum letzten Commit wird grün; bei Rot zuerst beheben, bevor neue Arbeit beginnt. Ist die Aufgabe abgeschlossen und der Kontext groß: den Nutzer in einem Satz auf `/clear` hinweisen.

