# Teilprojekt 3a: Chat und Streaming (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Angemeldete Nutzer legen Chats an, senden Nachrichten und erhalten die Antwort als Stream (POST-SSE im AI-SDK-UI-Message-Format); Abbruch, Regenerieren, Bearbeiten (Geschwister im Nachrichten-Baum), System-Prompt, Parameter, Chatliste mit Titelsuche und ein Titel-Job (pg-boss) funktionieren gegen ein Mock-Modell.

**Architecture:** Neues Modul `chats` (Controller dünn, Services: `ChatsService` für Chats, `MessageTreeService` für den Baum in SQL, `ChatStreamService` für `streamText` und Speichern, `ChatTitleService` für den Titel-Job) und neues Modul `jobs` (pg-boss hinter dem Token `JOB_QUEUE`). Der Server besitzt den Verlauf; der Client sendet nur `{ parentId, text }`. Das Modell kommt aus `ModelRegistryService.resolve()` (Teilprojekt 2).

**Tech Stack:** NestJS 12, TypeORM 1, PostgreSQL, `ai` ^7.0.127 (`streamText`, `toUIMessageStream`, `pipeUIMessageStreamToResponse`, `convertToModelMessages`), `pg-boss` 12.x (neu), Vitest, Supertest.

**Spec:** [Teilprojekt 3 (Chat und Streaming)](../specs/2026-10-10-teilprojekt-3-chat-streaming-design.md). Plan 3b (Web) folgt nach diesem Plan.

## Abweichungen von der Spec (mit Begründung, in Task 10 in die Spec übernommen)

1. **Teiltext bei Abbruch ist geklärt** (Probe mit `ai` 7.0.127, 2026-10-10): Der `onEnd`-Callback von `toUIMessageStream` liefert `isAborted`, `outcome` (`completed` | `failed` | `aborted` | `unknown`) und `responseMessage.parts` mit dem **Teiltext** (Zustand `streaming`). `result.usage` lehnt bei Abbruch und Fehler ab; es wird nur bei `completed` erwartet. Der geplante Rückfall über `onChunk` entfällt.
2. **Die Methoden `result.toUIMessageStream` und `result.pipeUIMessageStreamToResponse` sind in `ai` 7 veraltet.** Genutzt werden die eigenständigen Funktionen `toUIMessageStream({ stream: result.stream, ... })` und `pipeUIMessageStreamToResponse({ response, stream })`.
3. **Ein Fehler im Modellstrom wird vom Stream geworfen**, nicht als Fehler-Teil geschickt (Probe). Darum schreibt der Dienst bei einem Fehler selbst einen Fehler-Teil (`{ type: 'error', errorText: 'stream_failed' }`) und beendet die Antwort. Das Ergebnis von `pipeUIMessageStreamToResponse` wird **immer** abgewartet, sonst stürzt der Prozess an einer unbehandelten Ablehnung ab.
4. **Kein `@nestjs/event-emitter`:** Es gibt genau einen Aufrufer für „Antwort fertig". `ChatStreamService` ruft `ChatTitleService.scheduleAfterAnswer()` direkt auf (eine Abhängigkeit weniger, YAGNI).
5. **Kein Env `CHAT_STREAM_RATE_LIMIT`:** Das Rate Limit der Stream-Routen ist wie bei der Test-Route aus Teilprojekt 2 eine Konstante am Dekorator (`@Throttle`), `limit` kann dort nicht aus der Konfiguration kommen. Die Missbrauchsgrenze ist `CHAT_MAX_CONCURRENT_STREAMS`.

## Global Constraints

- `pnpm` verwenden, nie `npm` oder `yarn`. Node ≥ 24 (Root-`engines`); pg-boss verlangt ≥ 22.12.
- Kein `any`, kein `@ts-ignore`, kein `as unknown as`, kein `export *`. Typen aus DTOs, kein handgeschriebener Paralleltyp.
- Werte, die Logik steuern (Rolle, Status, Titelquelle, Job-Name), stehen als `export const X = {...} as const` im Wörterbuch `chats/chat-dictionaries.ts` und werden überall importiert, auch in Tests.
- Jede Datenabfrage ist in SQL auf `userId` begrenzt; die Identität kommt aus `@CurrentUser()`, nie aus Body oder Query. Fremde und unbekannte Chats, Nachrichten und Eltern sind immer `404`.
- Keine Chat-Inhalte in Logs (nur `chatId`, `messageId`, Rolle, Längen, Dauer, Status, Token-Zahlen) und nicht in der Job-Tabelle (Job-Daten: nur `chatId`).
- Env nur über `apps/api/src/config/env.ts`; Beispielwerte in `.env.example` und `compose.yml`.
- Fail fast: kein stilles `catch`. Erlaubt und mit Log: das Schließen einer abgebrochenen Antwort (Task 7) und das Planen des Titel-Jobs (Task 8, bewusst best-effort, steht in der Spec Abschnitt 7).
- Migrationen werden mit `pnpm --filter @owui/api migration:generate chats/<Name>`-ähnlichem Aufruf **generiert** (Pfad wie in AGENTS.md, Abschnitt 3) und nie von Hand geändert; Eintrag in `database/entities.ts` und `database/migrations/index.ts`.
- Keine echten LLM- oder Netzwerkaufrufe in Tests: `MockLanguageModelV4` (`ai/test`), `simulateReadableStream` kommt aus `ai`.
- Commits: Conventional Commits, Imperativ, ein Thema, direkt auf `main`; Husky-Hooks nie umgehen. Jeder Commit endet mit `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Dateiinhalte mit Write/Edit schreiben, nicht per Heredoc (der Bash-Guard prüft Heredoc-Text).
- Nach jedem Push `gh run list --branch main --limit 1` prüfen.

## Review Focus

1. **Abbruch mitten im Stream:** Der Client trennt; erwartet wird ein gespeicherter Teiltext mit Status `aborted`, freigegebener Stream-Platz, abgebrochene Modellanfrage (Task 7, Test über echte HTTP-Verbindung).
2. **Zwei Tabs / zwei Anfragen gleichzeitig:** Das dritte gleichzeitige Streaming eines Nutzers bekommt `429`, der Platz wird auch bei Fehlern frei (Task 7).
3. **Chat wird gelöscht, während die Antwort läuft:** Das Speichern der Antwort darf nicht abstürzen und nichts in einen fremden Chat schreiben (Task 6, Test).
4. **Fremde `parentId`:** Eine `parentId` aus dem Chat eines anderen Nutzers (oder eines anderen Chats desselben Nutzers) ist `404` und schreibt nichts (Task 6).
5. **Gleiche Zeitstempel in der Liste:** Mehrere Chats mit identischem `updated_at` dürfen beim Blättern nicht doppelt oder gar nicht erscheinen (Task 5, Cursor mit Mikrosekunden).
6. **Provider-Fehler mitten in der Antwort:** Der Nutzer sieht nur `stream_failed`, die Nachricht steht mit Status `error` und grober Ursache in der DB, der Fehlertext des Anbieters taucht nirgends auf (Task 7).
7. **Titel überschreibt Umbenennung:** Benennt der Nutzer um, bevor der Job fertig ist, bleibt sein Titel (Task 8).

---

## Datei-Übersicht

| Datei | Zweck |
| ----- | ----- |
| `apps/api/src/chats/chat-dictionaries.ts` | Wörterbücher: Rolle, Status, Titelquelle, Job-Name, Stream-Fehlertext |
| `apps/api/src/chats/chat-params.ts` | `ChatParams` (DTO-Klasse mit Validierung, auch Typ der JSON-Spalte) |
| `apps/api/src/chats/chat.entity.ts`, `message.entity.ts` | Entities |
| `apps/api/src/chats/chat-history.ts` | rein: Verlauf aus Zeilen bauen, kürzen |
| `apps/api/src/chats/chat-title.ts` | rein: Rückfalltitel, Titel bereinigen |
| `apps/api/src/chats/list-cursor.ts` | rein: Cursor kodieren/dekodieren, `LIKE` maskieren |
| `apps/api/src/chats/stream-slots.ts` | gleichzeitige Streams pro Nutzer |
| `apps/api/src/chats/chats.dto.ts` | Ein- und Ausgabe-DTOs |
| `apps/api/src/chats/chats.service.ts` | Chats: anlegen, listen, lesen, ändern, löschen |
| `apps/api/src/chats/message-tree.service.ts` | Baum in SQL: Pfad, Anhängen, neuestes Blatt, Antwort speichern |
| `apps/api/src/chats/chat-stream.service.ts` | `streamText`, Abbruch, Speichern, Antwort an den Client |
| `apps/api/src/chats/chat-title.service.ts` | Titel planen und erzeugen (Worker) |
| `apps/api/src/chats/chats.controller.ts` | Routen |
| `apps/api/src/chats/chats.module.ts` | Modul |
| `apps/api/src/jobs/job-queue.ts` | Token `JOB_QUEUE` und Schnittstelle |
| `apps/api/src/jobs/pg-boss-job-queue.ts`, `jobs.module.ts` | pg-boss-Umsetzung und Modul |
| `apps/api/src/testing/chat-model.ts` | Mock-Modell für Chat-Tests |
| `apps/api/src/testing/fake-job-queue.ts` | Warteschlange im Speicher |
| `apps/api/src/testing/chat-fixtures.ts` | Hilfen für DB-Tests (Nutzer, Chat, Aufräumen) |

---

### Task 1: Abhängigkeit und Vertragstest für `streamText`

**Files:**

- Modify: `apps/api/package.json` (per `pnpm add`), `pnpm-lock.yaml` (durch pnpm)
- Create: `apps/api/src/testing/chat-model.ts`
- Create: `apps/api/src/chats/ai-stream.contract.spec.ts`

**Interfaces:**

- Produces: `chatModel(options?: ChatModelOptions): MockLanguageModelV4` und `collect(stream: ReadableStream<unknown>): Promise<unknown[]>` aus `testing/chat-model.ts`. `ChatModelOptions = { deltas?: string[]; chunkDelayMs?: number; failWith?: Error; usage?: { input: number; output: number } }`. Standard-`deltas`: `['Hallo ', 'Welt']`.

- [ ] **Step 1: pg-boss prüfen und installieren**

Die Doku von `pg-boss` 12.x (Typen im Paket nach der Installation) lesen und die in der Spec genannten Signaturen gegenprüfen: `new PgBoss({ connectionString, max, schema })`, `start()`, `createQueue(name)` (ist ein zweiter Aufruf mit demselben Namen erlaubt?), `send(name, data, options)`, `work(name, options, handler)` (Handler bekommt ein Array), `stop({ graceful, timeout })`, `on('error', ...)`.

Run: `pnpm --filter @owui/api add pg-boss`
Expected: Paket in `apps/api/package.json`. Danach `ls apps/api/node_modules/pg-boss/dist/*.d.ts` und die Typen lesen. Hat `pg-boss` Installationsskripte (`pnpm` meldet ignorierte Build-Skripte), nicht freigeben, wenn keine nötig sind.

- [ ] **Step 2: Mock-Modell für Chat-Tests schreiben**

```ts
// apps/api/src/testing/chat-model.ts
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

type StreamResult = Awaited<ReturnType<MockLanguageModelV4['doStream']>>;
type Chunk = StreamResult['stream'] extends ReadableStream<infer C> ? C : never;

export interface ChatModelOptions {
  deltas?: string[];
  /** Pause between two chunks; makes a stream long enough to be cut off. */
  chunkDelayMs?: number;
  /** After the first text, the provider stream breaks with this error. */
  failWith?: Error;
  usage?: { input: number; output: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function head(): Chunk[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: '1' },
  ];
}

function textChunks(deltas: string[], usage: { input: number; output: number }): Chunk[] {
  return [
    ...head(),
    ...deltas.map((delta): Chunk => ({ type: 'text-delta', id: '1', delta })),
    { type: 'text-end', id: '1' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: usage.input }, outputTokens: { total: usage.output } },
    },
  ];
}

/** A chat model without a network: streams `deltas`, or breaks after the first one when `failWith` is set. */
export function chatModel(options: ChatModelOptions = {}): MockLanguageModelV4 {
  const deltas = options.deltas ?? ['Hallo ', 'Welt'];
  const usage = options.usage ?? { input: 3, output: 5 };
  return new MockLanguageModelV4({
    doStream: () => {
      if (options.failWith !== undefined) {
        const failure = options.failWith;
        const queued: Chunk[] = [
          ...head(),
          { type: 'text-delta', id: '1', delta: deltas[0] ?? '' },
        ];
        let index = 0;
        return Promise.resolve({
          stream: new ReadableStream<Chunk>({
            async pull(controller) {
              const next = queued[index];
              if (next !== undefined) {
                index += 1;
                controller.enqueue(next);
                return;
              }
              await sleep(10);
              controller.error(failure);
            },
          }),
        });
      }
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks: textChunks(deltas, usage),
          initialDelayInMs: null,
          chunkDelayInMs: options.chunkDelayMs ?? null,
        }),
      });
    },
  });
}

export async function collect(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const reader = stream.getReader();
  const chunks: unknown[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}
```

Run: `pnpm --filter @owui/api typecheck`
Expected: grün. Lehnt `tsc` die Form von `usage` oder `finishReason` ab, die Felder nach den Typen in `node_modules/ai` bzw. dem dort verlinkten `@ai-sdk/provider` anpassen (keine Casts).

- [ ] **Step 3: Vertragstest schreiben, der das verifizierte Verhalten festhält**

```ts
// apps/api/src/chats/ai-stream.contract.spec.ts
import { streamText, toUIMessageStream } from 'ai';
import { describe, expect, it } from 'vitest';

import { chatModel, collect } from '../testing/chat-model.js';

interface EndEvent {
  status: string;
  isAborted: boolean;
  parts: unknown[];
}

function uiStreamOf(result: ReturnType<typeof streamText>, ends: EndEvent[]) {
  return toUIMessageStream({
    stream: result.stream,
    onError: () => 'stream_failed',
    onEnd: (event) => {
      ends.push({
        status: event.outcome.status,
        isAborted: event.isAborted,
        parts: event.responseMessage.parts,
      });
    },
  });
}

describe('AI SDK contract the chat builds on (ai 7)', () => {
  it('reports a completed answer with its text and usage', async () => {
    const ends: EndEvent[] = [];
    const result = streamText({ model: chatModel(), prompt: 'x', maxRetries: 0 });

    await collect(uiStreamOf(result, ends));

    expect(ends).toHaveLength(1);
    expect(ends[0]?.status).toBe('completed');
    expect(ends[0]?.isAborted).toBe(false);
    expect(ends[0]?.parts).toContainEqual({ type: 'text', text: 'Hallo Welt', state: 'done' });
    expect(await result.usage).toMatchObject({ inputTokens: 3, outputTokens: 5 });
  });

  it('keeps the partial text when the abort signal fires, and usage rejects', async () => {
    const controller = new AbortController();
    const ends: EndEvent[] = [];
    const result = streamText({
      model: chatModel({ deltas: ['Hallo ', 'Welt ', 'wie ', 'geht ', 'es'], chunkDelayMs: 40 }),
      prompt: 'x',
      maxRetries: 0,
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 70);

    await collect(uiStreamOf(result, ends));

    expect(ends[0]?.status).toBe('aborted');
    expect(ends[0]?.isAborted).toBe(true);
    const text = ends[0]?.parts.find(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' && part !== null && 'type' in part && part.type === 'text'
    );
    expect(text?.text.startsWith('Hallo')).toBe(true);
    expect(text?.text).not.toBe('Hallo Welt wie geht es');
    await expect(Promise.resolve(result.usage)).rejects.toThrow();
  });

  it('throws a broken provider stream through the UI stream and reports outcome failed', async () => {
    const ends: EndEvent[] = [];
    const result = streamText({
      model: chatModel({ failWith: new Error('provider text that must not reach the user') }),
      prompt: 'x',
      maxRetries: 0,
    });

    await expect(collect(uiStreamOf(result, ends))).rejects.toThrow();

    expect(ends[0]?.status).toBe('failed');
  });

  it('hands the abort signal to the model', async () => {
    const controller = new AbortController();
    const model = chatModel();
    await collect(
      uiStreamOf(
        streamText({ model, prompt: 'x', maxRetries: 0, abortSignal: controller.signal }),
        []
      )
    );

    expect(model.doStreamCalls[0]?.abortSignal).toBeDefined();
  });
});
```

- [ ] **Step 4: Test ausführen**

Run: `pnpm --filter @owui/api exec vitest run src/chats/ai-stream.contract.spec.ts`
Expected: PASS. Schlägt ein Fall fehl, weil sich `ai` anders verhält als in der Probe, **den Plan anpassen** (Abweichung dokumentieren), nicht den Test lockern.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/testing/chat-model.ts apps/api/src/chats/ai-stream.contract.spec.ts
git commit -m "test(chats): pin AI SDK abort and error behaviour and add pg-boss

pg-boss 12 runs the title job (Teilprojekt 3); the contract test documents that
the UI stream hands over the partial text on abort and throws on a broken
provider stream.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Konfiguration

**Files:**

- Modify: `apps/api/src/config/env.ts` (nach `PROVIDER_REQUEST_TIMEOUT_MS`)
- Modify: `apps/api/src/config/env.spec.ts`
- Modify: `.env.example`, `compose.yml` (Abschnitt `api` → `environment`)

**Interfaces:**

- Produces: Felder auf `Env`: `CHAT_MAX_CONCURRENT_STREAMS` (2), `CHAT_STREAM_MAX_DURATION_MS` (300000), `CHAT_MESSAGE_MAX_LENGTH` (20000), `CHAT_SYSTEM_PROMPT_MAX_LENGTH` (4000), `CHAT_CONTEXT_MAX_CHARS` (60000), `CHAT_MAX_OUTPUT_TOKENS` (4096), `CHAT_MAX_MESSAGES_PER_CHAT` (1000), alle `number`.

- [ ] **Step 1: Failing test**

In `env.spec.ts` im Block `describe('validateEnv', ...)` ergänzen:

```ts
  it('has defaults for the chat limits and rejects values outside their range', () => {
    const env = validateEnv(VALID);

    expect(env.CHAT_MAX_CONCURRENT_STREAMS).toBe(2);
    expect(env.CHAT_STREAM_MAX_DURATION_MS).toBe(300000);
    expect(env.CHAT_MESSAGE_MAX_LENGTH).toBe(20000);
    expect(env.CHAT_SYSTEM_PROMPT_MAX_LENGTH).toBe(4000);
    expect(env.CHAT_CONTEXT_MAX_CHARS).toBe(60000);
    expect(env.CHAT_MAX_OUTPUT_TOKENS).toBe(4096);
    expect(env.CHAT_MAX_MESSAGES_PER_CHAT).toBe(1000);

    expect(() => validateEnv({ ...VALID, CHAT_MAX_CONCURRENT_STREAMS: '0' })).toThrow(
      /CHAT_MAX_CONCURRENT_STREAMS/
    );
    expect(() => validateEnv({ ...VALID, CHAT_STREAM_MAX_DURATION_MS: '10' })).toThrow(
      /CHAT_STREAM_MAX_DURATION_MS/
    );
    expect(() => validateEnv({ ...VALID, CHAT_MAX_OUTPUT_TOKENS: 'many' })).toThrow(
      /CHAT_MAX_OUTPUT_TOKENS/
    );
  });
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @owui/api exec vitest run src/config/env.spec.ts`
Expected: FAIL (`undefined` statt Standardwerten).

- [ ] **Step 3: Felder ergänzen**

Nach `PROVIDER_REQUEST_TIMEOUT_MS` in `Env`:

```ts
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  CHAT_MAX_CONCURRENT_STREAMS = 2;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(3600000)
  CHAT_STREAM_MAX_DURATION_MS = 300000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200000)
  CHAT_MESSAGE_MAX_LENGTH = 20000;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200000)
  CHAT_SYSTEM_PROMPT_MAX_LENGTH = 4000;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(2000000)
  CHAT_CONTEXT_MAX_CHARS = 60000;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  CHAT_MAX_OUTPUT_TOKENS = 4096;

  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100000)
  CHAT_MAX_MESSAGES_PER_CHAT = 1000;
```

In `.env.example` nach `PROVIDER_REQUEST_TIMEOUT_MS=10000`:

```
CHAT_MAX_CONCURRENT_STREAMS=2
CHAT_STREAM_MAX_DURATION_MS=300000
CHAT_MESSAGE_MAX_LENGTH=20000
CHAT_SYSTEM_PROMPT_MAX_LENGTH=4000
CHAT_CONTEXT_MAX_CHARS=60000
CHAT_MAX_OUTPUT_TOKENS=4096
CHAT_MAX_MESSAGES_PER_CHAT=1000
```

In `compose.yml` unter `PROVIDER_REQUEST_TIMEOUT_MS` für jede Variable eine Zeile `NAME: ${NAME:-<Standard>}`.

- [ ] **Step 4: Test laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/config/env.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config .env.example compose.yml
git commit -m "feat(config): add chat limits

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wörterbücher, Entities, Migration

**Files:**

- Create: `apps/api/src/chats/chat-dictionaries.ts`, `chat-params.ts`, `chat.entity.ts`, `message.entity.ts`
- Modify: `apps/api/src/database/entities.ts`, `apps/api/src/database/migrations/index.ts`
- Create (generiert): `apps/api/src/database/migrations/<zeitstempel>-add-chats.ts`
- Create: `apps/api/src/chats/chat-schema.db.spec.ts`
- Create: `apps/api/src/testing/chat-fixtures.ts`

**Interfaces:**

- Produces: `MESSAGE_ROLE`, `MESSAGE_STATUS`, `CHAT_TITLE_SOURCE`, `CHAT_JOB`, `STREAM_ERROR_TEXT`, `MESSAGE_ERROR_REASON` und die Typen `MessageRole`, `MessageStatus`, `ChatTitleSource`; `class ChatParams`; `interface MessagePart { type: 'text'; text: string }`; Entities `Chat` (`id`, `userId`, `title: string | null`, `titleSource`, `modelId`, `systemPrompt: string | null`, `params: ChatParams`, `activeLeafId: string | null`, `createdAt`, `updatedAt`) und `Message` (`id`, `chatId`, `parentId: string | null`, `role`, `parts: MessagePart[]`, `status`, `errorReason: string | null`, `modelId: string | null`, `inputTokens: number | null`, `outputTokens: number | null`, `createdAt`); `resetChatTables(dataSource)`, `insertChat(dataSource, userId, overrides?)`, `insertMessage(dataSource, chatId, overrides)` in `testing/chat-fixtures.ts`.

- [ ] **Step 1: Wörterbücher und Parameter-Klasse schreiben**

```ts
// apps/api/src/chats/chat-dictionaries.ts
import { PROVIDER_ERROR } from '../http/safe-fetch/provider-error.js';

export const MESSAGE_ROLE = { USER: 'user', ASSISTANT: 'assistant' } as const;
export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

export const MESSAGE_STATUS = { COMPLETE: 'complete', ABORTED: 'aborted', ERROR: 'error' } as const;
export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];

export const CHAT_TITLE_SOURCE = { FALLBACK: 'fallback', GENERATED: 'generated', USER: 'user' } as const;
export type ChatTitleSource = (typeof CHAT_TITLE_SOURCE)[keyof typeof CHAT_TITLE_SOURCE];

export const CHAT_JOB = { GENERATE_TITLE: 'chat.generate-title' } as const;

/** The only error text that reaches the client from inside a stream; the web app maps it to a message. */
export const STREAM_ERROR_TEXT = 'stream_failed';

/** Coarse reason stored with a failed answer: a provider reason (`PROVIDER_ERROR`) or `internal`. */
export const MESSAGE_ERROR_REASON = { ...PROVIDER_ERROR, INTERNAL: 'internal' } as const;
```

Vorher `apps/api/src/http/safe-fetch/provider-error.ts` lesen: Ist `PROVIDER_ERROR` ein `as const`-Objekt mit Werten wie `timeout`, kann es so gespreizt werden; sonst `MESSAGE_ERROR_REASON` ohne Spread als eigenes Wörterbuch schreiben.

```ts
// apps/api/src/chats/chat-params.ts
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** Sampling settings of one chat. The server clamps `maxOutputTokens` to its own limit when it streams. */
export class ChatParams {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  topP?: number;

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

- [ ] **Step 2: Entities schreiben**

```ts
// apps/api/src/chats/chat.entity.ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../users/user.entity.js';
import { CHAT_TITLE_SOURCE, type ChatTitleSource } from './chat-dictionaries.js';
import type { ChatParams } from './chat-params.js';
import { Message } from './message.entity.js';

const SOURCE_VALUES = Object.values(CHAT_TITLE_SOURCE)
  .map((value) => `'${value}'`)
  .join(', ');

/** `title` is null until the first message is sent. Every query filters on `userId`. */
@Entity({ name: 'chat' })
@Index('chat_user_updated_idx', ['userId', 'updatedAt', 'id'])
@Check('chat_title_source_check', `title_source IN (${SOURCE_VALUES})`)
export class Chat {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  @Column({ name: 'title_source', type: 'text', default: CHAT_TITLE_SOURCE.FALLBACK })
  titleSource!: ChatTitleSource;

  @Column({ name: 'model_id', type: 'text' })
  modelId!: string;

  @Column({ name: 'system_prompt', type: 'text', nullable: true })
  systemPrompt!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  params!: ChatParams;

  @Column({ name: 'active_leaf_id', type: 'uuid', nullable: true })
  activeLeafId!: string | null;

  @ManyToOne(() => Message, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'active_leaf_id' })
  activeLeaf!: Message | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

```ts
// apps/api/src/chats/message.entity.ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import {
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  type MessageRole,
  type MessageStatus,
} from './chat-dictionaries.js';
import type { MessagePart } from './chat-params.js';
import { Chat } from './chat.entity.js';

const ROLE_VALUES = Object.values(MESSAGE_ROLE)
  .map((value) => `'${value}'`)
  .join(', ');
const STATUS_VALUES = Object.values(MESSAGE_STATUS)
  .map((value) => `'${value}'`)
  .join(', ');

/** A node of the message tree: `parentId` null is a root, siblings (same parent) are regenerated or edited branches. */
@Entity({ name: 'message' })
@Index('message_chat_parent_idx', ['chatId', 'parentId'])
@Check('message_role_check', `role IN (${ROLE_VALUES})`)
@Check('message_status_check', `status IN (${STATUS_VALUES})`)
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'chat_id', type: 'uuid' })
  chatId!: string;

  @ManyToOne(() => Chat, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chat_id' })
  chat!: Chat;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @ManyToOne(() => Message, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent!: Message | null;

  @Column({ type: 'text' })
  role!: MessageRole;

  @Column({ type: 'jsonb' })
  parts!: MessagePart[];

  @Column({ type: 'text', default: MESSAGE_STATUS.COMPLETE })
  status!: MessageStatus;

  @Column({ name: 'error_reason', type: 'text', nullable: true })
  errorReason!: string | null;

  @Column({ name: 'model_id', type: 'text', nullable: true })
  modelId!: string | null;

  @Column({ name: 'input_tokens', type: 'int', nullable: true })
  inputTokens!: number | null;

  @Column({ name: 'output_tokens', type: 'int', nullable: true })
  outputTokens!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

Hinweis: `chat.entity.ts` und `message.entity.ts` verweisen kreisförmig aufeinander (`Chat.activeLeaf`, `Message.chat`). Das ist in TypeORM mit Lambda-Verweisen erlaubt; dependency-cruiser hat Zyklen verboten. Meldet `pnpm depcruise` den Zyklus, `Chat.activeLeaf` (die Relation) streichen und die Spalte `activeLeafId` allein behalten; die Fremdschlüssel-Beziehung entsteht dann in Step 4 als Raw-SQL-Migration (`migration:create`), nicht im generierten Teil.

- [ ] **Step 3: Entities eintragen und Migration generieren**

`database/entities.ts`: `Chat`, `Message` importieren und in `ENTITIES` aufnehmen.

Run: `pnpm db:up`, dann `pnpm --filter @owui/api migration:generate database/migrations/add-chats`
Expected: eine Datei `database/migrations/<zeitstempel>-add-chats.ts`. Lesen: Tabellen `chat` und `message`, beide `CHECK`-Constraints, Index `chat_user_updated_idx` auf `(user_id, updated_at, id)`, Index `message_chat_parent_idx`, FKs mit `ON DELETE CASCADE` bzw. `SET NULL`. Die Datei **nicht von Hand ändern**; in `migrations/index.ts` eintragen.

- [ ] **Step 4: Fixtures und Schema-Test schreiben**

```ts
// apps/api/src/testing/chat-fixtures.ts
import type { DataSource } from 'typeorm';

import { MESSAGE_ROLE, MESSAGE_STATUS } from '../chats/chat-dictionaries.js';
import { Chat } from '../chats/chat.entity.js';
import { Message } from '../chats/message.entity.js';

/** Chats and messages disappear with their user (cascade), but tests of the chat tables alone reset them directly. */
export async function resetChatTables(dataSource: DataSource): Promise<void> {
  await dataSource.query('TRUNCATE chat CASCADE');
}

export async function insertChat(
  dataSource: DataSource,
  userId: string,
  overrides: Partial<Omit<Chat, 'user' | 'activeLeaf'>> = {}
): Promise<Chat> {
  const repository = dataSource.getRepository(Chat);
  return repository.save(
    repository.create({
      userId,
      title: null,
      modelId: 'connection:model',
      systemPrompt: null,
      params: {},
      ...overrides,
    })
  );
}

export async function insertMessage(
  dataSource: DataSource,
  chatId: string,
  overrides: Partial<Omit<Message, 'chat' | 'parent'>> = {}
): Promise<Message> {
  const repository = dataSource.getRepository(Message);
  return repository.save(
    repository.create({
      chatId,
      parentId: null,
      role: MESSAGE_ROLE.USER,
      parts: [{ type: 'text', text: 'Hallo' }],
      status: MESSAGE_STATUS.COMPLETE,
      ...overrides,
    })
  );
}
```

```ts
// apps/api/src/chats/chat-schema.db.spec.ts
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_TEST_DATABASE_URL, testDatabaseUrl } from '../../test/db-global-setup.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { insertChat, insertMessage, resetChatTables } from '../testing/chat-fixtures.js';
import { insertUser, resetAuthTables } from '../testing/db-fixtures.js';
import { MESSAGE_ROLE } from './chat-dictionaries.js';

describe('chat schema (database)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource(buildDataSourceOptions(testDatabaseUrl() || DEFAULT_TEST_DATABASE_URL));
    await dataSource.initialize();
  });
  afterAll(async () => {
    await dataSource.destroy();
  });
  beforeEach(async () => {
    await resetAuthTables(dataSource);
    await resetChatTables(dataSource);
  });

  it('rejects an unknown role, status and title source', async () => {
    const user = await insertUser(dataSource);
    const chat = await insertChat(dataSource, user.id);

    await expect(
      insertMessage(dataSource, chat.id, { role: 'system' as typeof MESSAGE_ROLE.USER })
    ).rejects.toThrow(/message_role_check/);
    await expect(
      dataSource.query(`UPDATE chat SET title_source = 'robot' WHERE id = $1`, [chat.id])
    ).rejects.toThrow(/chat_title_source_check/);
  });

  it('deletes messages with their chat and chats with their user', async () => {
    const user = await insertUser(dataSource);
    const chat = await insertChat(dataSource, user.id);
    const root = await insertMessage(dataSource, chat.id);
    await insertMessage(dataSource, chat.id, { parentId: root.id, role: MESSAGE_ROLE.ASSISTANT });

    await dataSource.query('DELETE FROM app_user WHERE id = $1', [user.id]);

    expect(await dataSource.query('SELECT 1 FROM chat')).toHaveLength(0);
    expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
  });

  it('clears active_leaf_id when its message is deleted, and deletes children of a deleted parent', async () => {
    const user = await insertUser(dataSource);
    const chat = await insertChat(dataSource, user.id);
    const root = await insertMessage(dataSource, chat.id);
    const child = await insertMessage(dataSource, chat.id, {
      parentId: root.id,
      role: MESSAGE_ROLE.ASSISTANT,
    });
    await dataSource.query('UPDATE chat SET active_leaf_id = $1 WHERE id = $2', [child.id, chat.id]);

    await dataSource.query('DELETE FROM message WHERE id = $1', [root.id]);

    const rows: { active_leaf_id: string | null }[] = await dataSource.query(
      'SELECT active_leaf_id FROM chat WHERE id = $1',
      [chat.id]
    );
    expect(rows[0]?.active_leaf_id).toBeNull();
    expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
  });
});
```

Zuvor in `apps/api/src/models/provider-connection.schema.db.spec.ts` nachsehen, wie dort die `DataSource` im Test aufgebaut wird, und das Muster übernehmen, falls es vom obigen abweicht (zum Beispiel ohne `|| DEFAULT_TEST_DATABASE_URL`).

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm db:up && pnpm --filter @owui/api test:db -- src/chats/chat-schema.db.spec.ts`
Expected: PASS. Dazu `pnpm check` (Typen, ESLint, depcruise).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/chats apps/api/src/database apps/api/src/testing/chat-fixtures.ts
git commit -m "feat(chats): add chat and message tables

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Reine Hilfsfunktionen

**Files:**

- Create: `apps/api/src/chats/chat-history.ts` (+ `.spec.ts`), `chat-title.ts` (+ `.spec.ts`), `list-cursor.ts` (+ `.spec.ts`), `stream-slots.ts` (+ `.spec.ts`)

**Interfaces:**

- Produces:
  - `buildHistory(rows: HistoryRow[], maxChars: number): UiHistoryMessage[]` mit `HistoryRow = { role: MessageRole; status: MessageStatus; parts: MessagePart[] }` und `UiHistoryMessage = { role: MessageRole; parts: MessagePart[] }`; `textOf(parts: MessagePart[]): string`.
  - `fallbackTitle(text: string): string`, `sanitizeTitle(raw: string): string`.
  - `encodeCursor(cursor: { ts: string; id: string }): string`, `decodeCursor(value: string): { ts: string; id: string } | undefined`, `escapeLike(value: string): string`.
  - `class StreamSlots` mit `acquire(userId: string): () => void` (wirft `HttpException` 429); Konstruktor `(config: ConfigService<Env, true>)`.

- [ ] **Step 1: Failing tests schreiben**

```ts
// apps/api/src/chats/chat-history.spec.ts
import { describe, expect, it } from 'vitest';

import { MESSAGE_ROLE, MESSAGE_STATUS } from './chat-dictionaries.js';
import { buildHistory, type HistoryRow, textOf } from './chat-history.js';

function row(
  role: HistoryRow['role'],
  text: string,
  status: HistoryRow['status'] = MESSAGE_STATUS.COMPLETE
): HistoryRow {
  return { role, status, parts: text === '' ? [] : [{ type: 'text', text }] };
}

describe('buildHistory', () => {
  it('keeps order and roles', () => {
    const history = buildHistory(
      [row(MESSAGE_ROLE.USER, 'a'), row(MESSAGE_ROLE.ASSISTANT, 'b'), row(MESSAGE_ROLE.USER, 'c')],
      1000
    );

    expect(history.map((message) => [message.role, textOf(message.parts)])).toEqual([
      ['user', 'a'],
      ['assistant', 'b'],
      ['user', 'c'],
    ]);
  });

  it('keeps an aborted answer with text but drops failed answers and empty ones', () => {
    const history = buildHistory(
      [
        row(MESSAGE_ROLE.USER, 'a'),
        row(MESSAGE_ROLE.ASSISTANT, 'halb', MESSAGE_STATUS.ABORTED),
        row(MESSAGE_ROLE.USER, 'b'),
        row(MESSAGE_ROLE.ASSISTANT, 'kaputt', MESSAGE_STATUS.ERROR),
        row(MESSAGE_ROLE.USER, 'c'),
        row(MESSAGE_ROLE.ASSISTANT, '', MESSAGE_STATUS.ABORTED),
        row(MESSAGE_ROLE.USER, 'd'),
      ],
      1000
    );

    expect(history.map((message) => textOf(message.parts))).toEqual(['a', 'halb', 'b', 'c', 'd']);
  });

  it('cuts the oldest messages first, always keeps the newest one and starts with a user message', () => {
    const history = buildHistory(
      [
        row(MESSAGE_ROLE.USER, 'x'.repeat(40)),
        row(MESSAGE_ROLE.ASSISTANT, 'y'.repeat(40)),
        row(MESSAGE_ROLE.USER, 'z'.repeat(40)),
      ],
      60
    );

    expect(history.map((message) => message.role)).toEqual(['user']);
    expect(textOf(history[0]?.parts ?? [])).toBe('z'.repeat(40));
  });

  it('keeps the newest message even when it alone is over the limit', () => {
    const history = buildHistory([row(MESSAGE_ROLE.USER, 'x'.repeat(500))], 10);

    expect(history).toHaveLength(1);
  });
});
```

```ts
// apps/api/src/chats/chat-title.spec.ts
import { describe, expect, it } from 'vitest';

import { fallbackTitle, sanitizeTitle } from './chat-title.js';

describe('fallbackTitle', () => {
  it('collapses whitespace and cuts at 60 characters', () => {
    expect(fallbackTitle('  Hallo \n\n  Welt  ')).toBe('Hallo Welt');
    expect(Array.from(fallbackTitle('a'.repeat(200)))).toHaveLength(60);
  });

  it('does not cut a character in half', () => {
    const title = fallbackTitle('😀'.repeat(100));

    expect(Array.from(title)).toHaveLength(60);
    expect(title).not.toContain('�');
  });
});

describe('sanitizeTitle', () => {
  it.each([
    ['"Ein Titel"', 'Ein Titel'],
    ['„Ein Titel“', 'Ein Titel'],
    ['# Ein **Titel**', 'Ein Titel'],
    ['\n\nErste Zeile\nZweite Zeile', 'Erste Zeile'],
    ['Titel\u0000mit\u0007Steuerzeichen', 'TitelmitSteuerzeichen'],
    ['   ', ''],
    ['', ''],
    ['"""', ''],
  ])('turns %j into %j', (raw, expected) => {
    expect(sanitizeTitle(raw)).toBe(expected);
  });

  it('cuts at 80 characters', () => {
    expect(Array.from(sanitizeTitle('b'.repeat(300)))).toHaveLength(80);
  });

  it('keeps markup-like text as plain characters (it is only ever shown as text)', () => {
    expect(sanitizeTitle('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});
```

```ts
// apps/api/src/chats/list-cursor.spec.ts
import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor, escapeLike } from './list-cursor.js';

describe('cursor', () => {
  it('round-trips a microsecond timestamp and an id', () => {
    const cursor = { ts: '2026-10-10T09:00:00.123456Z', id: '0f1c9b0e-0000-4000-8000-000000000001' };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it.each(['', 'not base64 json', Buffer.from('{"ts":1,"id":2}').toString('base64url')])(
    'rejects %j',
    (value) => {
      expect(decodeCursor(value)).toBeUndefined();
    }
  );
});

describe('escapeLike', () => {
  it('masks the wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
```

```ts
// apps/api/src/chats/stream-slots.spec.ts
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { configOf } from '../testing/provider-fixtures.js';
import { StreamSlots } from './stream-slots.js';

function slots(limit = 2): StreamSlots {
  return new StreamSlots(configOf({ CHAT_MAX_CONCURRENT_STREAMS: limit }));
}

describe('StreamSlots', () => {
  it('refuses the stream over the limit with 429, per user', () => {
    const pool = slots();
    pool.acquire('ann');
    pool.acquire('ann');

    expect(() => pool.acquire('ann')).toThrowError(
      expect.objectContaining({ status: HttpStatus.TOO_MANY_REQUESTS })
    );
    expect(() => pool.acquire('ben')).not.toThrow();
  });

  it('gives the place back on release, and a second release does nothing', () => {
    const pool = slots(1);
    const release = pool.acquire('ann');
    release();
    release();

    const again = pool.acquire('ann');

    expect(() => pool.acquire('ann')).toThrow();
    again();
    expect(() => pool.acquire('ann')).not.toThrow();
  });
});
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag sehen**

Run: `pnpm --filter @owui/api exec vitest run src/chats`
Expected: FAIL (Module fehlen).

- [ ] **Step 3: Implementierung schreiben**

```ts
// apps/api/src/chats/chat-history.ts
import { MESSAGE_ROLE, MESSAGE_STATUS, type MessageRole, type MessageStatus } from './chat-dictionaries.js';
import type { MessagePart } from './chat-params.js';

export interface HistoryRow {
  role: MessageRole;
  status: MessageStatus;
  parts: MessagePart[];
}

export interface UiHistoryMessage {
  role: MessageRole;
  parts: MessagePart[];
}

export function textOf(parts: MessagePart[]): string {
  return parts.map((part) => part.text).join('');
}

/**
 * The messages that go to the model, oldest first. Failed answers and answers without text are left out (some
 * providers refuse empty turns). The oldest messages are cut first until `maxChars` fits; the newest message
 * always stays, and the history starts with a user message.
 */
export function buildHistory(rows: HistoryRow[], maxChars: number): UiHistoryMessage[] {
  const usable = rows.filter(
    (row) => row.status !== MESSAGE_STATUS.ERROR && textOf(row.parts).length > 0
  );

  const kept: UiHistoryMessage[] = [];
  let total = 0;
  for (let index = usable.length - 1; index >= 0; index -= 1) {
    const row = usable[index];
    if (row === undefined) continue;
    const size = textOf(row.parts).length;
    if (kept.length > 0 && total + size > maxChars) break;
    total += size;
    kept.unshift({ role: row.role, parts: row.parts });
  }
  while (kept.length > 1 && kept[0]?.role !== MESSAGE_ROLE.USER) kept.shift();
  return kept;
}
```

```ts
// apps/api/src/chats/chat-title.ts
const FALLBACK_LENGTH = 60;
const TITLE_LENGTH = 80;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const WRAPPING = /^[\s"'`„“”«»‚‘’#*_>\-]+|[\s"'`„“”«»‚‘’#*_>]+$/gu;

function cut(text: string, length: number): string {
  return Array.from(text).slice(0, length).join('');
}

/** The title a chat gets with its first message: the start of the message. */
export function fallbackTitle(text: string): string {
  return cut(text.replace(/\s+/gu, ' ').trim(), FALLBACK_LENGTH);
}

/** A model's title proposal as plain text: first line, no quotes or markdown marks, no control characters. */
export function sanitizeTitle(raw: string): string {
  const firstLine = raw.split('\n').find((line) => line.trim() !== '') ?? '';
  const plain = firstLine
    .replace(CONTROL_CHARACTERS, '')
    .replace(/\*\*|__|`/gu, '')
    .replace(WRAPPING, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return cut(plain, TITLE_LENGTH);
}
```

```ts
// apps/api/src/chats/list-cursor.ts
export interface ListCursor {
  /** Microsecond timestamp as text from Postgres (a JS Date would cut it to milliseconds). */
  ts: string;
  id: string;
}

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(value: string): ListCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'ts' in parsed &&
      'id' in parsed &&
      typeof parsed.ts === 'string' &&
      typeof parsed.id === 'string'
    ) {
      return { ts: parsed.ts, id: parsed.id };
    }
  } catch {
    // not a cursor we issued
  }
  return undefined;
}

/** Makes `%`, `_` and `\` literal characters in an ILIKE pattern (used with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
```

Das `catch` in `decodeCursor` ist die einzige erlaubte Ausnahme der Regel „kein stilles catch": Ein fremder Cursor ist eine erwartete Eingabe, die der Aufrufer als `422` beantwortet (`undefined` ist das Ergebnis, kein Ersatzwert).

```ts
// apps/api/src/chats/stream-slots.ts
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';

/** Limits the streams a user runs at the same time. In memory, so it counts per API process. */
@Injectable()
export class StreamSlots {
  private readonly limit: number;
  private readonly running = new Map<string, number>();

  constructor(config: ConfigService<Env, true>) {
    this.limit = config.get('CHAT_MAX_CONCURRENT_STREAMS', { infer: true });
  }

  /** Takes a place or throws 429. Call the returned function exactly when the stream is over (idempotent). */
  acquire(userId: string): () => void {
    const current = this.running.get(userId) ?? 0;
    if (current >= this.limit) {
      throw new HttpException('Too many running answers', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.running.set(userId, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.running.get(userId) ?? 1) - 1;
      if (left <= 0) this.running.delete(userId);
      else this.running.set(userId, left);
    };
  }
}
```

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/chats`
Expected: PASS

- [ ] **Step 5: Mutationsprobe**

`if (current >= this.limit)` einmal zu `>` ändern → `stream-slots.spec.ts` muss rot werden; `kept.shift()`-Schleife in `buildHistory` entfernen → Test „starts with a user message" rot. Änderungen zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/chats
git commit -m "feat(chats): add history, title, cursor and stream-slot helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Chats anlegen, listen, lesen, ändern, löschen

**Files:**

- Create: `apps/api/src/chats/chats.dto.ts`, `chats.service.ts`, `chats.controller.ts`, `chats.module.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/testing/create-db-test-app.ts`
- Create: `apps/api/src/chats/chats.controller.spec.ts` (HTTP ohne DB), `apps/api/src/chats/chats.db.spec.ts`

Der Service nutzt im Task den `MessageTreeService` nur für `activeMessageId` (Task 6). Dieser Task legt deshalb zuerst die Chat-Operationen an und lässt `PATCH ... activeMessageId` in Task 6 folgen.

**Interfaces:**

- Consumes: `ModelRegistryService.resolve(modelId: string): Promise<ResolvedModel>` (wirft `NotFoundException`), `ConfigService<Env, true>`.
- Produces:
  - DTOs: `CreateChatDto { modelId: string; systemPrompt?: string | null; params?: ChatParams }`, `UpdateChatDto { title?: string; modelId?: string; systemPrompt?: string | null; params?: ChatParams; activeMessageId?: string }`, `ChatSummaryDto { id; title: string | null; modelId; updatedAt: Date }`, `ChatListDto { items: ChatSummaryDto[]; nextCursor: string | null }`, `MessageDto { id; parentId: string | null; role; parts: MessagePart[]; status; errorReason: string | null; modelId: string | null; createdAt: Date }`, `ChatDetailDto { id; title; titleSource; modelId; systemPrompt: string | null; params: ChatParams; activeLeafId: string | null; createdAt; updatedAt; messages: MessageDto[] }`, `ListChatsQueryDto { q?: string; cursor?: string; limit?: number }`.
  - `ChatsService`: `create(userId: string, dto: CreateChatDto): Promise<Chat>`, `list(userId: string, query: ListChatsQueryDto): Promise<ChatListDto>`, `getDetail(userId: string, chatId: string): Promise<ChatDetailDto>`, `getOwned(userId: string, chatId: string): Promise<Chat>` (404), `update(userId: string, chatId: string, dto: UpdateChatDto): Promise<Chat>`, `remove(userId: string, chatId: string): Promise<void>`.

- [ ] **Step 1: DTOs schreiben**

```ts
// apps/api/src/chats/chats.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  CHAT_TITLE_SOURCE,
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  type ChatTitleSource,
  type MessageRole,
  type MessageStatus,
} from './chat-dictionaries.js';
import { ChatParams, type MessagePart } from './chat-params.js';

/** Hard ceilings of the DTOs; the configured limits (smaller) are checked in the services. */
export const DTO_TEXT_CEILING = 200000;

export class CreateChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  modelId!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(DTO_TEXT_CEILING)
  systemPrompt?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChatParams)
  params?: ChatParams;
}

export class UpdateChatDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  modelId?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(DTO_TEXT_CEILING)
  systemPrompt?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ChatParams)
  params?: ChatParams;

  /** Switch the shown branch: the newest leaf below this message becomes the active one. */
  @IsOptional()
  @IsUUID()
  activeMessageId?: string;
}

export class ListChatsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ChatSummaryDto {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  title!: string | null;
  modelId!: string;
  updatedAt!: Date;
}

export class ChatListDto {
  @ApiProperty({ type: [ChatSummaryDto] })
  items!: ChatSummaryDto[];
  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class MessagePartDto {
  @ApiProperty({ enum: ['text'] })
  type!: 'text';
  text!: string;
}

export class MessageDto {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  parentId!: string | null;
  @ApiProperty({ enum: Object.values(MESSAGE_ROLE) })
  role!: MessageRole;
  @ApiProperty({ type: [MessagePartDto] })
  parts!: MessagePart[];
  @ApiProperty({ enum: Object.values(MESSAGE_STATUS) })
  status!: MessageStatus;
  @ApiProperty({ type: String, nullable: true })
  errorReason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  modelId!: string | null;
  createdAt!: Date;
}

export class ChatDetailDto {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  title!: string | null;
  @ApiProperty({ enum: Object.values(CHAT_TITLE_SOURCE) })
  titleSource!: ChatTitleSource;
  modelId!: string;
  @ApiProperty({ type: String, nullable: true })
  systemPrompt!: string | null;
  @ApiProperty({ type: ChatParams })
  params!: ChatParams;
  @ApiProperty({ type: String, nullable: true })
  activeLeafId!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  @ApiProperty({ type: [MessageDto] })
  messages!: MessageDto[];
}

export class StreamChatDto {
  /** The message the new one answers to; `null` starts a new root (first message, or an edited first message). */
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  @ApiProperty({ type: String, nullable: true })
  parentId!: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(DTO_TEXT_CEILING)
  text!: string;
}
```

Die Stream-Klasse `StreamChatDto` wird in Task 7 benutzt; sie steht hier, damit die DTO-Datei nur einmal angefasst wird.

- [ ] **Step 2: Failing DB-Test für den Service schreiben**

```ts
// apps/api/src/chats/chats.db.spec.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { insertChat } from '../testing/chat-fixtures.js';
import { chatModel } from '../testing/chat-model.js';
import { authed, type Http, type Login, loginUser, signupUser, TEST_PASSWORD } from '../testing/http-session.js';
import { USER_ROLE } from '../users/user-role.js';
import type { ChatDetailDto, ChatListDto } from './chats.dto.js';

const MODEL_ID = 'connection-1:fake-model';

describe('chats (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let ann: Login;
  let ben: Login;

  afterEach(async () => {
    await app.close();
  });

  async function start(env: Record<string, string> = {}): Promise<void> {
    app = await createDbTestApp(testDatabaseUrl(), env, {
      configure: (builder) =>
        builder.overrideProvider(ModelRegistryService).useValue({
          resolve: (modelId: string) =>
            modelId === MODEL_ID
              ? Promise.resolve({
                  model: chatModel(),
                  connection: { id: 'connection-1', name: 'Fake', type: 'ollama' },
                  rawModelId: 'fake-model',
                })
              : Promise.reject(Object.assign(new Error('Model not found'), { status: 404 })),
        }),
    });
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    ann = await signupUser(http, { email: 'ann@example.com' });
    const pending = await signupUser(http, { email: 'ben@example.com' });
    await authed(http, ann)
      .patch(`/api/users/${pending.user.id}`)
      .send({ role: USER_ROLE.USER })
      .expect(200);
    ben = await loginUser(http, 'ben@example.com', TEST_PASSWORD);
  }

  async function createChat(login: Login, body: Record<string, unknown> = {}) {
    const response = await authed(http, login)
      .post('/api/chats')
      .send({ modelId: MODEL_ID, ...body })
      .expect(201);
    return response.body as ChatDetailDto;
  }

  describe('create, read, change, delete', () => {
    it('creates a chat with system prompt and parameters and reads it back with no messages', async () => {
      await start();

      const created = await createChat(ann, {
        systemPrompt: 'Antworte kurz.',
        params: { temperature: 0.2, topP: 0.9, maxOutputTokens: 100 },
      });
      const read = await authed(http, ann).get(`/api/chats/${created.id}`).expect(200);

      expect(read.body).toMatchObject({
        id: created.id,
        title: null,
        titleSource: 'fallback',
        modelId: MODEL_ID,
        systemPrompt: 'Antworte kurz.',
        params: { temperature: 0.2, topP: 0.9, maxOutputTokens: 100 },
        activeLeafId: null,
        messages: [],
      });
    });

    it('refuses an unknown model with 404 and a too long system prompt with 422', async () => {
      await start({ CHAT_SYSTEM_PROMPT_MAX_LENGTH: '10' });

      await authed(http, ann).post('/api/chats').send({ modelId: 'nope:x' }).expect(404);
      await authed(http, ann)
        .post('/api/chats')
        .send({ modelId: MODEL_ID, systemPrompt: 'x'.repeat(11) })
        .expect(422);
      expect(await dataSource.query('SELECT 1 FROM chat')).toHaveLength(0);
    });

    it('rejects unknown fields and bad parameters with 400', async () => {
      await start();

      await authed(http, ann).post('/api/chats').send({ modelId: MODEL_ID, userId: ben.user.id }).expect(400);
      await authed(http, ann)
        .post('/api/chats')
        .send({ modelId: MODEL_ID, params: { temperature: 5 } })
        .expect(400);
    });

    it('renames (title source becomes user), changes model, prompt and parameters, and can clear the prompt', async () => {
      await start();
      const chat = await createChat(ann, { systemPrompt: 'alt' });

      const renamed = await authed(http, ann)
        .patch(`/api/chats/${chat.id}`)
        .send({ title: 'Mein Titel', systemPrompt: null, params: { topP: 0.5 } })
        .expect(200);

      expect(renamed.body).toMatchObject({
        title: 'Mein Titel',
        titleSource: 'user',
        systemPrompt: null,
        params: { topP: 0.5 },
      });
      await authed(http, ann).patch(`/api/chats/${chat.id}`).send({ modelId: 'nope:x' }).expect(404);
    });

    it('deletes a chat with its messages and answers 404 afterwards', async () => {
      await start();
      const chat = await createChat(ann);

      await authed(http, ann).delete(`/api/chats/${chat.id}`).expect(204);

      await authed(http, ann).get(`/api/chats/${chat.id}`).expect(404);
      await authed(http, ann).delete(`/api/chats/${chat.id}`).expect(404);
    });
  });

  describe('the list', () => {
    it('shows only the own chats, newest change first, and searches the title without treating % as a wildcard', async () => {
      await start();
      const user = ann.user.id;
      await insertChat(dataSource, user, { title: 'Reiseplan Italien' });
      await insertChat(dataSource, user, { title: '100% Rabatt' });
      await insertChat(dataSource, user, { title: 'Kochen' });
      await insertChat(dataSource, ben.user.id, { title: 'Reiseplan von Ben' });

      const all = await authed(http, ann).get('/api/chats').expect(200);
      const reise = await authed(http, ann).get('/api/chats?q=reise').expect(200);
      const percent = await authed(http, ann).get('/api/chats?q=%25').expect(200);
      const underscore = await authed(http, ann).get('/api/chats?q=_').expect(200);

      expect((all.body as ChatListDto).items.map((item) => item.title)).toEqual([
        'Kochen',
        '100% Rabatt',
        'Reiseplan Italien',
      ]);
      expect((reise.body as ChatListDto).items.map((item) => item.title)).toEqual(['Reiseplan Italien']);
      expect((percent.body as ChatListDto).items.map((item) => item.title)).toEqual(['100% Rabatt']);
      expect((underscore.body as ChatListDto).items).toHaveLength(0);
    });

    it('pages through chats with identical timestamps without repeating or skipping one', async () => {
      await start();
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push((await insertChat(dataSource, ann.user.id, { title: `Chat ${index}` })).id);
      }
      await dataSource.query(`UPDATE chat SET updated_at = '2026-10-10T09:00:00.123456Z' WHERE user_id = $1`, [
        ann.user.id,
      ]);

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 5; page += 1) {
        const url: string = `/api/chats?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
        const body = (await authed(http, ann).get(url).expect(200)).body as ChatListDto;
        seen.push(...body.items.map((item) => item.id));
        cursor = body.nextCursor;
        if (cursor === null) break;
      }

      expect([...seen].sort()).toEqual([...ids].sort());
      expect(new Set(seen).size).toBe(5);
    });

    it('answers 422 for a cursor it did not issue', async () => {
      await start();

      await authed(http, ann).get('/api/chats?cursor=garbage').expect(422);
    });
  });

  describe('other users', () => {
    it('cannot read, change, delete or even see the chat of someone else', async () => {
      await start();
      const chat = await createChat(ann);

      await authed(http, ben).get(`/api/chats/${chat.id}`).expect(404);
      await authed(http, ben).patch(`/api/chats/${chat.id}`).send({ title: 'x' }).expect(404);
      await authed(http, ben).delete(`/api/chats/${chat.id}`).expect(404);
      expect(((await authed(http, ben).get('/api/chats').expect(200)).body as ChatListDto).items).toHaveLength(0);
      expect(await dataSource.query('SELECT 1 FROM chat WHERE id = $1', [chat.id])).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 3: Test laufen lassen, Fehlschlag sehen**

Run: `pnpm db:up && pnpm --filter @owui/api test:db -- src/chats/chats.db.spec.ts`
Expected: FAIL (Route 404 / Modul fehlt).

- [ ] **Step 4: Service, Controller, Modul schreiben**

```ts
// apps/api/src/chats/chats.service.ts
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { Env } from '../config/env.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { CHAT_TITLE_SOURCE } from './chat-dictionaries.js';
import { Chat } from './chat.entity.js';
import {
  type ChatDetailDto,
  type ChatListDto,
  type CreateChatDto,
  type ListChatsQueryDto,
  type UpdateChatDto,
} from './chats.dto.js';
import { decodeCursor, encodeCursor, escapeLike } from './list-cursor.js';
import { MessageTreeService } from './message-tree.service.js';

const DEFAULT_PAGE_SIZE = 30;

interface ListRow {
  id: string;
  title: string | null;
  model_id: string;
  updated_at: Date;
  cursor_ts: string;
}

@Injectable()
export class ChatsService {
  private readonly systemPromptMax: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: ModelRegistryService,
    private readonly tree: MessageTreeService,
    config: ConfigService<Env, true>
  ) {
    this.systemPromptMax = config.get('CHAT_SYSTEM_PROMPT_MAX_LENGTH', { infer: true });
  }

  async create(userId: string, dto: CreateChatDto): Promise<Chat> {
    await this.registry.resolve(dto.modelId);
    this.checkSystemPrompt(dto.systemPrompt);
    const repository = this.dataSource.getRepository(Chat);
    return repository.save(
      repository.create({
        userId,
        title: null,
        modelId: dto.modelId,
        systemPrompt: dto.systemPrompt ?? null,
        params: dto.params ?? {},
      })
    );
  }

  /** The chat if it belongs to the user, else 404 (the same answer for "does not exist"). */
  async getOwned(userId: string, chatId: string): Promise<Chat> {
    const chat = await this.dataSource.getRepository(Chat).findOneBy({ id: chatId, userId });
    if (chat === null) throw new NotFoundException('Chat not found');
    return chat;
  }

  async getDetail(userId: string, chatId: string): Promise<ChatDetailDto> {
    const chat = await this.getOwned(userId, chatId);
    const messages = await this.tree.listMessages(userId, chatId);
    return { ...chat, messages };
  }

  async list(userId: string, query: ListChatsQueryDto): Promise<ChatListDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === undefined) {
      throw new UnprocessableEntityException('Invalid cursor');
    }
    const pattern = query.q === undefined || query.q === '' ? null : `%${escapeLike(query.q)}%`;

    const rows: ListRow[] = await this.dataSource.query(
      `SELECT id, title, model_id, updated_at,
              to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
         FROM chat
        WHERE user_id = $1
          AND ($2::text IS NULL OR title ILIKE $2 ESCAPE '\\')
          AND ($3::timestamptz IS NULL OR (updated_at, id) < ($3::timestamptz, $4::uuid))
        ORDER BY updated_at DESC, id DESC
        LIMIT $5`,
      [userId, pattern, cursor?.ts ?? null, cursor?.id ?? null, limit + 1]
    );

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((row) => ({
        id: row.id,
        title: row.title,
        modelId: row.model_id,
        updatedAt: row.updated_at,
      })),
      nextCursor:
        rows.length > limit && last !== undefined
          ? encodeCursor({ ts: last.cursor_ts, id: last.id })
          : null,
    };
  }

  async update(userId: string, chatId: string, dto: UpdateChatDto): Promise<Chat> {
    const chat = await this.getOwned(userId, chatId);
    if (dto.modelId !== undefined) {
      await this.registry.resolve(dto.modelId);
      chat.modelId = dto.modelId;
    }
    if (dto.systemPrompt !== undefined) {
      this.checkSystemPrompt(dto.systemPrompt);
      chat.systemPrompt = dto.systemPrompt;
    }
    if (dto.params !== undefined) chat.params = dto.params;
    if (dto.title !== undefined) {
      chat.title = dto.title.trim();
      chat.titleSource = CHAT_TITLE_SOURCE.USER;
    }
    if (dto.activeMessageId !== undefined) {
      chat.activeLeafId = await this.tree.newestLeafBelow(userId, chatId, dto.activeMessageId);
    }
    return this.dataSource.getRepository(Chat).save(chat);
  }

  async remove(userId: string, chatId: string): Promise<void> {
    const result: [unknown[], number] = await this.dataSource.query(
      'DELETE FROM chat WHERE id = $1 AND user_id = $2',
      [chatId, userId]
    );
    if (result[1] === 0) throw new NotFoundException('Chat not found');
  }

  private checkSystemPrompt(prompt: string | null | undefined): void {
    if (typeof prompt === 'string' && prompt.length > this.systemPromptMax) {
      throw new UnprocessableEntityException('System prompt is too long');
    }
  }
}
```

Hinweise zur Umsetzung: (1) Das Ergebnis von `dataSource.query('DELETE ...')` ist bei TypeORM mit `pg` ein `[rows, affectedCount]`-Paar; vor dem Verlassen darauf im DB-Test „deletes ... answers 404 afterwards" nachweisen, sonst `result` gegen die tatsächliche Form anpassen. (2) `update` mit `title: '   '` wird vom DTO nicht abgefangen (`IsNotEmpty` lässt Leerzeichen durch): `dto.title.trim() === ''` → `UnprocessableEntityException` vor dem Setzen ergänzen und mit einem Test (`PATCH {title: '   '}` → 422) belegen. (3) `ChatDetailDto` aus `{ ...chat, messages }`: die Entity trägt zusätzlich `userId` und `user`; der Controller formt die Antwort (Step 5), der Service gibt die Entity-Felder an den Controller.

Der Service ruft `tree.listMessages` und `tree.newestLeafBelow` auf; beides entsteht in Task 6. Damit dieser Task grün wird, legt Step 5 zunächst nur die Chat-Operationen fest und Task 6 liefert den `MessageTreeService`. **Reihenfolge:** Task 6 vor Task 5 Step 4 ausführen, oder `MessageTreeService` in diesem Task mit genau `listMessages` und `newestLeafBelow` (siehe Task 6, Step 3) beginnen. Empfohlen: Task 6 zuerst vollständig umsetzen (Baum-Tests sind unabhängig von Chat-Routen), dann Task 5.

```ts
// apps/api/src/chats/chats.controller.ts (Teil 1: Chat-Routen; Stream-Routen kommen in Task 7)
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators.js';
import type { User } from '../users/user.entity.js';
import {
  ChatDetailDto,
  ChatListDto,
  CreateChatDto,
  ListChatsQueryDto,
  UpdateChatDto,
} from './chats.dto.js';
import { ChatsService } from './chats.service.js';

/** Every signed-in user (not "pending"); the global guard closes the routes for everybody else. */
@ApiTags('chats')
@Controller('chats')
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Get()
  @ApiOkResponse({ type: ChatListDto })
  @ApiUnprocessableEntityResponse({ description: 'The cursor is not valid' })
  list(@CurrentUser() user: User, @Query() query: ListChatsQueryDto): Promise<ChatListDto> {
    return this.chats.list(user.id, query);
  }

  @Post()
  @ApiCreatedResponse({ type: ChatDetailDto })
  @ApiNotFoundResponse({ description: 'The model is not available' })
  @ApiUnprocessableEntityResponse({ description: 'The system prompt is too long' })
  async create(@CurrentUser() user: User, @Body() dto: CreateChatDto): Promise<ChatDetailDto> {
    const chat = await this.chats.create(user.id, dto);
    return this.chats.getDetail(user.id, chat.id);
  }

  @Get(':id')
  @ApiOkResponse({ type: ChatDetailDto })
  @ApiNotFoundResponse()
  detail(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string
  ): Promise<ChatDetailDto> {
    return this.chats.getDetail(user.id, id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ChatDetailDto })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({ description: 'The title is blank or the system prompt is too long' })
  async update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChatDto
  ): Promise<ChatDetailDto> {
    await this.chats.update(user.id, id, dto);
    return this.chats.getDetail(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.chats.remove(user.id, id);
  }
}
```

`getDetail` gibt nur die DTO-Felder zurück: Dafür in `ChatsService.getDetail` die Entity auf die Felder von `ChatDetailDto` abbilden (`id`, `title`, `titleSource`, `modelId`, `systemPrompt`, `params`, `activeLeafId`, `createdAt`, `updatedAt`, `messages`) statt `...chat` zu streuen, damit `userId` nicht in der Antwort steht. Ein Test prüft, dass die Antwort kein Feld `userId` enthält.

```ts
// apps/api/src/chats/chats.module.ts
import { Module } from '@nestjs/common';

import { ModelsModule } from '../models/models.module.js';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';
import { MessageTreeService } from './message-tree.service.js';

@Module({
  imports: [ModelsModule],
  controllers: [ChatsController],
  providers: [ChatsService, MessageTreeService],
  exports: [ChatsService, MessageTreeService],
})
export class ChatsModule {}
```

`ChatsModule` in `app.module.ts` (Liste `imports`) und in `testing/create-db-test-app.ts` (Liste `imports`, nach `ModelsModule`) eintragen. `testing/db-fixtures.ts`: `resetChatTables` wird in `createDbTestApp` mit den anderen Resets aufgerufen (`await resetChatTables(dataSource)` vor `resetAuthTables`).

- [ ] **Step 5: HTTP-Test ohne DB (Zugriff und Eingabe)**

```ts
// apps/api/src/chats/chats.controller.spec.ts
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../testing/create-test-app.js';
import { fakeAuth } from '../testing/fake-auth.js';
import { ChatsController } from './chats.controller.js';
import { ChatsService } from './chats.service.js';

class FakeChats {
  readonly calls: { method: string; args: unknown[] }[] = [];
  private record<T>(method: string, args: unknown[], result: T): Promise<T> {
    this.calls.push({ method, args });
    return Promise.resolve(result);
  }
  list(userId: string, query: unknown) {
    return this.record('list', [userId, query], { items: [], nextCursor: null });
  }
  create(userId: string, dto: unknown) {
    return this.record('create', [userId, dto], { id: randomUUID() });
  }
  getDetail(userId: string, id: string) {
    return this.record('getDetail', [userId, id], { id, messages: [] });
  }
  update(userId: string, id: string, dto: unknown) {
    return this.record('update', [userId, id, dto], { id });
  }
  remove(userId: string, id: string) {
    return this.record('remove', [userId, id], undefined);
  }
}

describe('ChatsController (HTTP, no database)', () => {
  let app: NestExpressApplication;
  const auth = fakeAuth();
  const fake = new FakeChats();

  afterEach(async () => {
    await app.close();
    fake.calls.length = 0;
  });

  async function start() {
    app = await createTestApp({
      controllers: [ChatsController],
      providers: [...auth.providers, { provide: ChatsService, useValue: fake }],
    });
    return request(app.getHttpServer());
  }

  const ID = randomUUID();
  const routes = [
    ['get', '/api/chats'],
    ['post', '/api/chats'],
    ['get', `/api/chats/${ID}`],
    ['patch', `/api/chats/${ID}`],
    ['delete', `/api/chats/${ID}`],
  ] as const;

  it.each(routes)('%s %s needs a session (401) and refuses a pending account (403)', async (method, url) => {
    const http = await start();

    await http[method](url).expect(401);
    await http[method](url).set(auth.session('pending')).expect(403);
    expect(fake.calls).toHaveLength(0);
  });

  it('hands the user of the session to the service, never one from the request', async () => {
    const http = await start();

    await http
      .post('/api/chats')
      .set(auth.session('user'))
      .send({ modelId: 'c:m' })
      .expect(201);
    await http.post('/api/chats').set(auth.session('user')).send({ modelId: 'c:m', userId: 'x' }).expect(400);

    expect(fake.calls.filter((call) => call.method === 'create')).toHaveLength(1);
    expect(fake.calls[0]?.args[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a malformed id and bad query values before the service', async () => {
    const http = await start();

    await http.get('/api/chats/not-a-uuid').set(auth.session('user')).expect(400);
    await http.get('/api/chats?limit=1000').set(auth.session('user')).expect(400);
    expect(fake.calls).toHaveLength(0);
  });
});
```

Zusätzlich im DB-Test `chats.db.spec.ts` den Fall `PATCH {title: '   '}` → `422` und „die Antwort enthält kein `userId`" ergänzen.

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/chats` und `pnpm --filter @owui/api test:db -- src/chats`
Expected: PASS

- [ ] **Step 7: Mutationsprobe**

In `ChatsService.getOwned` den Filter `userId` entfernen → „other users" im DB-Test rot. In `list` den Vergleich `<` durch `<=` ersetzen → der Cursor-Test (identische Zeitstempel) rot. Zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src
git commit -m "feat(chats): create, list, read, change and delete chats

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Nachrichten-Baum in SQL

**Hinweis zur Reihenfolge:** Dieser Task kommt vor Task 5, Step 4 (siehe dort).

**Files:**

- Create: `apps/api/src/chats/message-tree.service.ts`
- Create: `apps/api/src/chats/message-tree.db.spec.ts`

**Interfaces:**

- Consumes: `Chat`, `Message`, Wörterbücher, `fallbackTitle`, `ConfigService`.
- Produces `MessageTreeService`:
  - `listMessages(userId: string, chatId: string): Promise<MessageDto[]>` (alle Nachrichten des Chats, nach `createdAt, id`; nur wenn der Chat dem Nutzer gehört, sonst leer; der Aufrufer hat den Chat vorher mit `getOwned` geprüft).
  - `loadPath(userId: string, chatId: string, leafId: string): Promise<HistoryRow[]>` (Wurzel → Blatt; `[]` wenn nicht auffindbar).
  - `appendUserMessage(userId: string, chatId: string, parentId: string | null, text: string): Promise<{ messageId: string }>` (Transaktion, Baumregeln, Nachrichtenlimit `409`, Rückfalltitel bei der ersten Nachricht, setzt `activeLeafId`).
  - `prepareRegenerate(userId: string, chatId: string, messageId: string): Promise<{ userMessageId: string }>` (404 wenn keine Antwort dieses Chats dieses Nutzers; Limit `409`).
  - `saveAssistant(input: SaveAssistantInput): Promise<boolean>` mit `SaveAssistantInput = { userId; chatId; id: string; parentId: string; status: MessageStatus; parts: MessagePart[]; errorReason: string | null; modelId: string; inputTokens: number | null; outputTokens: number | null }`; `false`, wenn der Chat inzwischen nicht mehr existiert.
  - `newestLeafBelow(userId: string, chatId: string, messageId: string): Promise<string>` (404, wenn die Nachricht nicht zum Chat des Nutzers gehört).
  - `countCompletedAnswers(chatId: string): Promise<number>`.

- [ ] **Step 1: Failing DB-Tests schreiben**

```ts
// apps/api/src/chats/message-tree.db.spec.ts
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { buildDataSourceOptions } from '../database/data-source-options.js';
import { BASE_TEST_ENV } from '../testing/create-test-app.js';
import { insertChat, insertMessage, resetChatTables } from '../testing/chat-fixtures.js';
import { insertUser, resetAuthTables } from '../testing/db-fixtures.js';
import { MESSAGE_ROLE, MESSAGE_STATUS } from './chat-dictionaries.js';
import { MessageTreeService } from './message-tree.service.js';

describe('MessageTreeService (database)', () => {
  let dataSource: DataSource;
  let tree: MessageTreeService;
  let close: () => Promise<void>;

  async function build(env: Record<string, string> = {}): Promise<void> {
    const module = await Test.createTestingModule({
      imports: [
        AppConfigModule.forRoot({
          raw: { ...BASE_TEST_ENV, DATABASE_URL: testDatabaseUrl(), ...env },
          ignoreEnvFile: true,
        }),
        TypeOrmModule.forRoot(buildDataSourceOptions(testDatabaseUrl())),
      ],
      providers: [MessageTreeService],
    }).compile();
    dataSource = module.get(DataSource);
    tree = module.get(MessageTreeService);
    close = () => module.close();
  }

  beforeAll(async () => {
    await build();
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await resetAuthTables(dataSource);
    await resetChatTables(dataSource);
  });

  async function setup() {
    const ann = await insertUser(dataSource);
    const ben = await insertUser(dataSource);
    const chat = await insertChat(dataSource, ann.id);
    return { ann, ben, chat };
  }

  describe('appendUserMessage', () => {
    it('stores the first message as a root, sets the active leaf and the fallback title', async () => {
      const { ann, chat } = await setup();

      const { messageId } = await tree.appendUserMessage(ann.id, chat.id, null, '  Wie wird das Wetter?  ');

      const rows = await dataSource.query('SELECT title, title_source, active_leaf_id FROM chat WHERE id = $1', [chat.id]);
      expect(rows[0]).toEqual({
        title: 'Wie wird das Wetter?',
        title_source: 'fallback',
        active_leaf_id: messageId,
      });
      const messages = await tree.listMessages(ann.id, chat.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ role: MESSAGE_ROLE.USER, parentId: null, status: MESSAGE_STATUS.COMPLETE });
      expect(messages[0]?.parts).toEqual([{ type: 'text', text: '  Wie wird das Wetter?  ' }]);
    });

    it('does not touch an existing title', async () => {
      const { ann, chat } = await setup();
      await dataSource.query(`UPDATE chat SET title = 'Mein Titel', title_source = 'user' WHERE id = $1`, [chat.id]);

      await tree.appendUserMessage(ann.id, chat.id, null, 'Hallo');

      const rows = await dataSource.query('SELECT title, title_source FROM chat WHERE id = $1', [chat.id]);
      expect(rows[0]).toEqual({ title: 'Mein Titel', title_source: 'user' });
    });

    it('allows only an answer, or nothing, as parent of a user message', async () => {
      const { ann, chat } = await setup();
      const first = await tree.appendUserMessage(ann.id, chat.id, null, 'a');

      await expect(tree.appendUserMessage(ann.id, chat.id, first.messageId, 'b')).rejects.toMatchObject({ status: 422 });
    });

    it('answers 404 for a parent of another chat or of another user, and writes nothing', async () => {
      const { ann, ben, chat } = await setup();
      const otherChatOfAnn = await insertChat(dataSource, ann.id);
      const foreign = await insertChat(dataSource, ben.id);
      const inOther = await insertMessage(dataSource, otherChatOfAnn.id, { role: MESSAGE_ROLE.ASSISTANT });
      const inForeign = await insertMessage(dataSource, foreign.id, { role: MESSAGE_ROLE.ASSISTANT });

      await expect(tree.appendUserMessage(ann.id, chat.id, inOther.id, 'x')).rejects.toMatchObject({ status: 404 });
      await expect(tree.appendUserMessage(ann.id, chat.id, inForeign.id, 'x')).rejects.toMatchObject({ status: 404 });
      await expect(tree.appendUserMessage(ann.id, chat.id, randomUUID(), 'x')).rejects.toMatchObject({ status: 404 });
      await expect(tree.appendUserMessage(ben.id, chat.id, null, 'x')).rejects.toMatchObject({ status: 404 });
      expect(await dataSource.query('SELECT 1 FROM message WHERE chat_id = $1', [chat.id])).toHaveLength(0);
    });

    it('refuses with 409 when the chat holds the maximum number of messages', async () => {
      await build({ CHAT_MAX_MESSAGES_PER_CHAT: '2' });
      const { ann, chat } = await setup();
      const first = await tree.appendUserMessage(ann.id, chat.id, null, 'a');
      await insertMessage(dataSource, chat.id, { parentId: first.messageId, role: MESSAGE_ROLE.ASSISTANT });

      await expect(tree.appendUserMessage(ann.id, chat.id, null, 'b')).rejects.toMatchObject({ status: 409 });
      await build();
    });
  });

  describe('loadPath and newestLeafBelow', () => {
    async function branches() {
      const { ann, ben, chat } = await setup();
      const q = await insertMessage(dataSource, chat.id, { createdAt: new Date('2026-10-10T09:00:00Z') });
      const a1 = await insertMessage(dataSource, chat.id, {
        parentId: q.id,
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: 'text', text: 'erste' }],
        createdAt: new Date('2026-10-10T09:01:00Z'),
      });
      const a2 = await insertMessage(dataSource, chat.id, {
        parentId: q.id,
        role: MESSAGE_ROLE.ASSISTANT,
        parts: [{ type: 'text', text: 'zweite' }],
        createdAt: new Date('2026-10-10T09:02:00Z'),
      });
      const q2 = await insertMessage(dataSource, chat.id, { parentId: a1.id, createdAt: new Date('2026-10-10T09:03:00Z') });
      return { ann, ben, chat, q, a1, a2, q2 };
    }

    it('returns the path from the root to a leaf in order', async () => {
      const { ann, chat, q2 } = await branches();

      const path = await tree.loadPath(ann.id, chat.id, q2.id);

      expect(path.map((row) => row.role)).toEqual(['user', 'assistant', 'user']);
      expect(path[1]?.parts).toEqual([{ type: 'text', text: 'erste' }]);
    });

    it('returns nothing for a leaf of someone else', async () => {
      const { ben, chat, q2 } = await branches();

      expect(await tree.loadPath(ben.id, chat.id, q2.id)).toEqual([]);
    });

    it('finds the newest leaf below a message, following the newest child at each step', async () => {
      const { ann, chat, q, a1, a2, q2 } = await branches();

      expect(await tree.newestLeafBelow(ann.id, chat.id, q.id)).toBe(a2.id);
      expect(await tree.newestLeafBelow(ann.id, chat.id, a1.id)).toBe(q2.id);
      expect(await tree.newestLeafBelow(ann.id, chat.id, q2.id)).toBe(q2.id);
    });

    it('answers 404 for a message of another chat or user', async () => {
      const { ann, ben, chat, q } = await branches();

      await expect(tree.newestLeafBelow(ben.id, chat.id, q.id)).rejects.toMatchObject({ status: 404 });
      await expect(tree.newestLeafBelow(ann.id, chat.id, randomUUID())).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('prepareRegenerate', () => {
    it('accepts an answer and returns the user message it answers', async () => {
      const { ann, chat } = await setup();
      const q = await insertMessage(dataSource, chat.id);
      const a = await insertMessage(dataSource, chat.id, { parentId: q.id, role: MESSAGE_ROLE.ASSISTANT });

      expect(await tree.prepareRegenerate(ann.id, chat.id, a.id)).toEqual({ userMessageId: q.id });
    });

    it('refuses a user message (422) and a foreign or unknown message (404)', async () => {
      const { ann, ben, chat } = await setup();
      const q = await insertMessage(dataSource, chat.id);
      const a = await insertMessage(dataSource, chat.id, { parentId: q.id, role: MESSAGE_ROLE.ASSISTANT });

      await expect(tree.prepareRegenerate(ann.id, chat.id, q.id)).rejects.toMatchObject({ status: 422 });
      await expect(tree.prepareRegenerate(ben.id, chat.id, a.id)).rejects.toMatchObject({ status: 404 });
      await expect(tree.prepareRegenerate(ann.id, chat.id, randomUUID())).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('saveAssistant', () => {
    const base = {
      status: MESSAGE_STATUS.COMPLETE,
      parts: [{ type: 'text' as const, text: 'Antwort' }],
      errorReason: null,
      modelId: 'c:m',
      inputTokens: 3,
      outputTokens: 5,
    };

    it('stores the answer and makes it the active leaf', async () => {
      const { ann, chat } = await setup();
      const { messageId } = await tree.appendUserMessage(ann.id, chat.id, null, 'Frage');
      const id = randomUUID();

      const saved = await tree.saveAssistant({ ...base, userId: ann.id, chatId: chat.id, id, parentId: messageId });

      expect(saved).toBe(true);
      const rows = await dataSource.query('SELECT active_leaf_id FROM chat WHERE id = $1', [chat.id]);
      expect(rows[0].active_leaf_id).toBe(id);
      expect(await tree.countCompletedAnswers(chat.id)).toBe(1);
    });

    it('does not count aborted or failed answers as completed', async () => {
      const { ann, chat } = await setup();
      const { messageId } = await tree.appendUserMessage(ann.id, chat.id, null, 'Frage');
      await tree.saveAssistant({ ...base, status: MESSAGE_STATUS.ABORTED, userId: ann.id, chatId: chat.id, id: randomUUID(), parentId: messageId });

      expect(await tree.countCompletedAnswers(chat.id)).toBe(0);
    });

    it('returns false and writes nothing when the chat was deleted meanwhile', async () => {
      const { ann, chat } = await setup();
      const { messageId } = await tree.appendUserMessage(ann.id, chat.id, null, 'Frage');
      await dataSource.query('DELETE FROM chat WHERE id = $1', [chat.id]);

      const saved = await tree.saveAssistant({ ...base, userId: ann.id, chatId: chat.id, id: randomUUID(), parentId: messageId });

      expect(saved).toBe(false);
      expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
    });

    it('does not write into the chat of another user', async () => {
      const { ann, ben, chat } = await setup();
      const { messageId } = await tree.appendUserMessage(ann.id, chat.id, null, 'Frage');

      const saved = await tree.saveAssistant({ ...base, userId: ben.id, chatId: chat.id, id: randomUUID(), parentId: messageId });

      expect(saved).toBe(false);
      expect(await dataSource.query('SELECT 1 FROM message WHERE role = $1', [MESSAGE_ROLE.ASSISTANT])).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Fehlschlag sehen**

Run: `pnpm --filter @owui/api test:db -- src/chats/message-tree.db.spec.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: `MessageTreeService` schreiben**

```ts
// apps/api/src/chats/message-tree.service.ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';

import type { Env } from '../config/env.js';
import {
  CHAT_TITLE_SOURCE,
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  type MessageRole,
  type MessageStatus,
} from './chat-dictionaries.js';
import type { HistoryRow } from './chat-history.js';
import { fallbackTitle } from './chat-title.js';
import type { MessagePart } from './chat-params.js';
import type { MessageDto } from './chats.dto.js';

export interface SaveAssistantInput {
  userId: string;
  chatId: string;
  id: string;
  parentId: string;
  status: MessageStatus;
  parts: MessagePart[];
  errorReason: string | null;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

interface MessageRow {
  id: string;
  parent_id: string | null;
  role: MessageRole;
  parts: MessagePart[];
  status: MessageStatus;
  error_reason: string | null;
  model_id: string | null;
  created_at: Date;
}

/**
 * The message tree of a chat. Every method names the user and joins `chat` on `user_id`, so a message of someone
 * else is never reachable, whatever ids the client sends. Writes run in one transaction with the chat row locked.
 */
@Injectable()
export class MessageTreeService {
  private readonly maxMessages: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService<Env, true>
  ) {
    this.maxMessages = config.get('CHAT_MAX_MESSAGES_PER_CHAT', { infer: true });
  }

  async listMessages(userId: string, chatId: string): Promise<MessageDto[]> {
    const rows: MessageRow[] = await this.dataSource.query(
      `SELECT m.id, m.parent_id, m.role, m.parts, m.status, m.error_reason, m.model_id, m.created_at
         FROM message m JOIN chat c ON c.id = m.chat_id
        WHERE m.chat_id = $1 AND c.user_id = $2
        ORDER BY m.created_at, m.id`,
      [chatId, userId]
    );
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      role: row.role,
      parts: row.parts,
      status: row.status,
      errorReason: row.error_reason,
      modelId: row.model_id,
      createdAt: row.created_at,
    }));
  }

  async loadPath(userId: string, chatId: string, leafId: string): Promise<HistoryRow[]> {
    const rows: Pick<MessageRow, 'role' | 'status' | 'parts'>[] = await this.dataSource.query(
      `WITH RECURSIVE path AS (
         SELECT m.id, m.parent_id, m.role, m.status, m.parts, 0 AS depth
           FROM message m JOIN chat c ON c.id = m.chat_id
          WHERE m.id = $1 AND m.chat_id = $2 AND c.user_id = $3
         UNION ALL
         SELECT p.id, p.parent_id, p.role, p.status, p.parts, path.depth + 1
           FROM message p JOIN path ON p.id = path.parent_id
       )
       SELECT role, status, parts FROM path ORDER BY depth DESC`,
      [leafId, chatId, userId]
    );
    return rows;
  }

  async newestLeafBelow(userId: string, chatId: string, messageId: string): Promise<string> {
    const rows: { id: string }[] = await this.dataSource.query(
      `WITH RECURSIVE below AS (
         SELECT m.id, 0 AS depth
           FROM message m JOIN chat c ON c.id = m.chat_id
          WHERE m.id = $1 AND m.chat_id = $2 AND c.user_id = $3
         UNION ALL
         SELECT child.id, below.depth + 1
           FROM below
           JOIN LATERAL (
             SELECT id FROM message WHERE parent_id = below.id ORDER BY created_at DESC, id DESC LIMIT 1
           ) child ON true
       )
       SELECT id FROM below ORDER BY depth DESC LIMIT 1`,
      [messageId, chatId, userId]
    );
    const leaf = rows[0];
    if (leaf === undefined) throw new NotFoundException('Message not found');
    return leaf.id;
  }

  async appendUserMessage(
    userId: string,
    chatId: string,
    parentId: string | null,
    text: string
  ): Promise<{ messageId: string }> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockChat(manager, userId, chatId);
      await this.checkRoom(manager, chatId);
      if (parentId !== null) {
        const role = await this.roleOf(manager, userId, chatId, parentId);
        if (role !== MESSAGE_ROLE.ASSISTANT) {
          throw new UnprocessableEntityException('A message can only follow an answer');
        }
      }
      const rows: { id: string }[] = await manager.query(
        `INSERT INTO message (chat_id, parent_id, role, parts, status)
         VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
        [chatId, parentId, MESSAGE_ROLE.USER, JSON.stringify([{ type: 'text', text }]), MESSAGE_STATUS.COMPLETE]
      );
      const messageId = rows[0]?.id;
      if (messageId === undefined) throw new Error('Insert returned no id');
      await manager.query(
        `UPDATE chat
            SET active_leaf_id = $2,
                updated_at = now(),
                title = COALESCE(title, $3),
                title_source = CASE WHEN title IS NULL THEN $4 ELSE title_source END
          WHERE id = $1`,
        [chatId, messageId, fallbackTitle(text), CHAT_TITLE_SOURCE.FALLBACK]
      );
      return { messageId };
    });
  }

  async prepareRegenerate(
    userId: string,
    chatId: string,
    messageId: string
  ): Promise<{ userMessageId: string }> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockChat(manager, userId, chatId);
      await this.checkRoom(manager, chatId);
      const rows: { role: MessageRole; parent_id: string | null }[] = await manager.query(
        `SELECT m.role, m.parent_id
           FROM message m JOIN chat c ON c.id = m.chat_id
          WHERE m.id = $1 AND m.chat_id = $2 AND c.user_id = $3`,
        [messageId, chatId, userId]
      );
      const row = rows[0];
      if (row === undefined) throw new NotFoundException('Message not found');
      if (row.role !== MESSAGE_ROLE.ASSISTANT || row.parent_id === null) {
        throw new UnprocessableEntityException('Only an answer can be regenerated');
      }
      return { userMessageId: row.parent_id };
    });
  }

  /** Stores the answer and makes it the active leaf. False when the chat is gone (deleted while it was streaming). */
  async saveAssistant(input: SaveAssistantInput): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const inserted: { id: string }[] = await manager.query(
        `INSERT INTO message (id, chat_id, parent_id, role, parts, status, error_reason, model_id, input_tokens, output_tokens)
         SELECT $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10
          WHERE EXISTS (SELECT 1 FROM chat WHERE id = $2 AND user_id = $11)
          RETURNING id`,
        [
          input.id,
          input.chatId,
          input.parentId,
          MESSAGE_ROLE.ASSISTANT,
          JSON.stringify(input.parts),
          input.status,
          input.errorReason,
          input.modelId,
          input.inputTokens,
          input.outputTokens,
          input.userId,
        ]
      );
      if (inserted.length === 0) return false;
      await manager.query(
        'UPDATE chat SET active_leaf_id = $2, updated_at = now() WHERE id = $1 AND user_id = $3',
        [input.chatId, input.id, input.userId]
      );
      return true;
    });
  }

  async countCompletedAnswers(chatId: string): Promise<number> {
    const rows: { count: string }[] = await this.dataSource.query(
      'SELECT count(*) AS count FROM message WHERE chat_id = $1 AND role = $2 AND status = $3',
      [chatId, MESSAGE_ROLE.ASSISTANT, MESSAGE_STATUS.COMPLETE]
    );
    return Number(rows[0]?.count ?? 0);
  }

  private async lockChat(manager: EntityManager, userId: string, chatId: string): Promise<void> {
    const rows: unknown[] = await manager.query(
      'SELECT 1 FROM chat WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [chatId, userId]
    );
    if (rows.length === 0) throw new NotFoundException('Chat not found');
  }

  private async checkRoom(manager: EntityManager, chatId: string): Promise<void> {
    const rows: { count: string }[] = await manager.query(
      'SELECT count(*) AS count FROM message WHERE chat_id = $1',
      [chatId]
    );
    if (Number(rows[0]?.count ?? 0) >= this.maxMessages) {
      throw new ConflictException('This chat holds the maximum number of messages');
    }
  }

  private async roleOf(
    manager: EntityManager,
    userId: string,
    chatId: string,
    messageId: string
  ): Promise<MessageRole> {
    const rows: { role: MessageRole }[] = await manager.query(
      `SELECT m.role FROM message m JOIN chat c ON c.id = m.chat_id
        WHERE m.id = $1 AND m.chat_id = $2 AND c.user_id = $3`,
      [messageId, chatId, userId]
    );
    const row = rows[0];
    if (row === undefined) throw new NotFoundException('Message not found');
    return row.role;
  }
}
```

Hinweise: (1) Läuft der Rekursionsteil `JOIN LATERAL` in `newestLeafBelow` nicht (Postgres lehnt den Verweis auf die rekursive Tabelle ab), die Tiefe in einer Schleife im Service ermitteln (je Ebene eine Abfrage `SELECT id FROM message WHERE parent_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, höchstens `CHAT_MAX_MESSAGES_PER_CHAT` Schritte) und im Plan-Nachtrag vermerken. (2) Einen Fehlschlag wegen `ParameterTypes` bei `$1, $2 ... SELECT`-Einfügung durch explizite Casts (`$1::uuid`, `$9::int`) beheben.

- [ ] **Step 4: Tests laufen lassen**

Run: `pnpm --filter @owui/api test:db -- src/chats/message-tree.db.spec.ts`
Expected: PASS

- [ ] **Step 5: Mutationsprobe**

In `loadPath` die Bedingung `AND c.user_id = $3` entfernen → „returns nothing for a leaf of someone else" rot. In `saveAssistant` `AND user_id = $11` entfernen → „does not write into the chat of another user" rot. In `appendUserMessage` den Rollenvergleich entfernen → „allows only an answer" rot. Zurücknehmen.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/chats
git commit -m "feat(chats): add the message tree with per-user SQL

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Danach Task 5, Step 4 bis 8 ausführen und dessen Commit machen.

---

### Task 7: Streaming, Abbruch, Regenerieren

**Files:**

- Create: `apps/api/src/chats/chat-stream.service.ts`, `chat-stream.db.spec.ts`
- Modify: `apps/api/src/chats/chats.controller.ts` (Stream-Routen), `chats.module.ts` (Provider), `chats.controller.spec.ts` (Zugriff der neuen Routen)

**Interfaces:**

- Consumes: `ChatsService.getOwned`, `MessageTreeService` (Task 6), `StreamSlots`, `ModelRegistryService.resolve`, `buildHistory`, Wörterbücher, `ChatTitleService.scheduleAfterAnswer(chatId: string): Promise<void>` (Task 8; bis dahin eine leere Implementierung `async scheduleAfterAnswer() {}` in einer Zwischenversion von `chat-title.service.ts` bereitstellen, die Task 8 ersetzt).
- Produces: `ChatStreamService.stream(userId: string, chatId: string, input: StreamChatDto, response: Response): Promise<void>` und `ChatStreamService.regenerate(userId: string, chatId: string, messageId: string, response: Response): Promise<void>`. Routen `POST /chats/:id/stream` (Body `StreamChatDto`) und `POST /chats/:id/messages/:messageId/regenerate`, beide `@Throttle({ default: { limit: 30, ttl: 60_000 } })`, Antwort `text/event-stream`.

- [ ] **Step 1: Failing DB-Tests schreiben (HTTP über ein echtes Netz)**

```ts
// apps/api/src/chats/chat-stream.db.spec.ts
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { type ChatModelOptions, chatModel } from '../testing/chat-model.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { insertChat } from '../testing/chat-fixtures.js';
import { authed, type Http, type Login, loginUser, signupUser, TEST_PASSWORD } from '../testing/http-session.js';
import { USER_ROLE } from '../users/user-role.js';
import { MESSAGE_ROLE, MESSAGE_STATUS, STREAM_ERROR_TEXT } from './chat-dictionaries.js';
import type { ChatDetailDto } from './chats.dto.js';

const MODEL_ID = 'connection-1:fake-model';

async function until<T>(read: () => Promise<T | undefined>, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('chat streaming (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let ann: Login;
  let ben: Login;
  let models: ReturnType<typeof chatModel>[] = [];
  let options: ChatModelOptions = {};

  afterEach(async () => {
    await app.close();
    models = [];
    options = {};
  });

  async function start(env: Record<string, string> = {}): Promise<void> {
    app = await createDbTestApp(testDatabaseUrl(), env, {
      configure: (builder) =>
        builder.overrideProvider(ModelRegistryService).useValue({
          resolve: () => {
            const model = chatModel(options);
            models.push(model);
            return Promise.resolve({
              model,
              connection: { id: 'connection-1', name: 'Fake', type: 'ollama' },
              rawModelId: 'fake-model',
            });
          },
        }),
    });
    dataSource = app.get(DataSource);
    http = request(app.getHttpServer());
    ann = await signupUser(http, { email: 'ann@example.com' });
    const pending = await signupUser(http, { email: 'ben@example.com' });
    await authed(http, ann).patch(`/api/users/${pending.user.id}`).send({ role: USER_ROLE.USER }).expect(200);
    ben = await loginUser(http, 'ben@example.com', TEST_PASSWORD);
  }

  async function newChat(login = ann, body: Record<string, unknown> = {}): Promise<string> {
    const response = await authed(http, login).post('/api/chats').send({ modelId: MODEL_ID, ...body }).expect(201);
    return (response.body as ChatDetailDto).id;
  }

  async function detail(login: Login, chatId: string): Promise<ChatDetailDto> {
    return (await authed(http, login).get(`/api/chats/${chatId}`).expect(200)).body as ChatDetailDto;
  }

  /** The `data:` lines of an event stream as parsed JSON (the `[DONE]` marker as the string). */
  function events(body: string): unknown[] {
    return body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .map((data) => (data === '[DONE]' ? data : (JSON.parse(data) as unknown)));
  }

  function textOfEvents(all: unknown[]): string {
    return all
      .flatMap((event) =>
        typeof event === 'object' && event !== null && 'type' in event && event.type === 'text-delta' && 'delta' in event
          ? [String(event.delta)]
          : []
      )
      .join('');
  }

  describe('a normal answer', () => {
    it('streams the text, announces the ids, stores both messages and sets the leaf', async () => {
      await start();
      const chatId = await newChat();

      const response = await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Hallo?' })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');
      const all = events(response.text);
      expect(textOfEvents(all)).toBe('Hallo Welt');
      const start = all.find(
        (event): event is { type: 'start'; messageMetadata: { userMessageId: string; assistantMessageId: string } } =>
          typeof event === 'object' && event !== null && 'type' in event && event.type === 'start'
      );
      const chat = await detail(ann, chatId);
      expect(chat.messages.map((m) => [m.role, m.status])).toEqual([
        [MESSAGE_ROLE.USER, MESSAGE_STATUS.COMPLETE],
        [MESSAGE_ROLE.ASSISTANT, MESSAGE_STATUS.COMPLETE],
      ]);
      expect(chat.messages[1]?.parts).toEqual([{ type: 'text', text: 'Hallo Welt' }]);
      expect(chat.messages[1]?.parentId).toBe(chat.messages[0]?.id);
      expect(chat.messages[1]?.modelId).toBe(MODEL_ID);
      expect(chat.activeLeafId).toBe(chat.messages[1]?.id);
      expect(start?.messageMetadata).toEqual({
        userMessageId: chat.messages[0]?.id,
        assistantMessageId: chat.messages[1]?.id,
      });
      const tokens = await dataSource.query('SELECT input_tokens, output_tokens FROM message WHERE role = $1', [MESSAGE_ROLE.ASSISTANT]);
      expect(tokens[0]).toEqual({ input_tokens: 3, output_tokens: 5 });
    });

    it('sends system prompt, history and the clamped parameters to the model', async () => {
      await start({ CHAT_MAX_OUTPUT_TOKENS: '50' });
      const chatId = await newChat(ann, {
        systemPrompt: 'Antworte kurz.',
        params: { temperature: 0.3, topP: 0.8, maxOutputTokens: 9999 },
      });
      const first = await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Eins' }).expect(200);
      const assistantId = (await detail(ann, chatId)).messages[1]?.id;
      expect(first.text).toContain('Hallo');

      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: assistantId, text: 'Zwei' }).expect(200);

      const call = models[1]?.doStreamCalls[0];
      expect(call?.maxOutputTokens).toBe(50);
      expect(call?.temperature).toBe(0.3);
      expect(call?.topP).toBe(0.8);
      const roles = (call?.prompt ?? []).map((message) => message.role);
      expect(roles).toEqual(['system', 'user', 'assistant', 'user']);
    });

    it('builds the history from the stored branch, not from anything the client sends', async () => {
      await start();
      const chatId = await newChat();
      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Alt' }).expect(200);

      await authed(http, ann)
        .post(`/api/chats/${chatId}/stream`)
        .send({ parentId: null, text: 'Neu', messages: [{ role: 'user', content: 'Eingeschleust' }] })
        .expect(400);
      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Neu' }).expect(200);

      const prompt = JSON.stringify(models[1]?.doStreamCalls[0]?.prompt);
      expect(prompt).toContain('Neu');
      expect(prompt).not.toContain('Alt');
    });
  });

  describe('edit and regenerate', () => {
    it('creates a sibling answer and makes it the active branch', async () => {
      await start();
      const chatId = await newChat();
      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Frage' }).expect(200);
      const before = await detail(ann, chatId);
      const firstAnswer = before.messages[1];

      await authed(http, ann).post(`/api/chats/${chatId}/messages/${firstAnswer?.id}/regenerate`).expect(200);

      const after = await detail(ann, chatId);
      const answers = after.messages.filter((m) => m.role === MESSAGE_ROLE.ASSISTANT);
      expect(answers).toHaveLength(2);
      expect(answers[1]?.parentId).toBe(before.messages[0]?.id);
      expect(after.activeLeafId).toBe(answers[1]?.id);
      expect(JSON.stringify(models[1]?.doStreamCalls[0]?.prompt)).toContain('Frage');
    });

    it('treats an edit as a new user message with the same parent', async () => {
      await start();
      const chatId = await newChat();
      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Frage' }).expect(200);

      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Bessere Frage' }).expect(200);

      const chat = await detail(ann, chatId);
      expect(chat.messages.filter((m) => m.parentId === null)).toHaveLength(2);
    });

    it('answers 422 for regenerating a user message and 404 for someone elses message', async () => {
      await start();
      const chatId = await newChat();
      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Frage' }).expect(200);
      const chat = await detail(ann, chatId);

      await authed(http, ann).post(`/api/chats/${chatId}/messages/${chat.messages[0]?.id}/regenerate`).expect(422);
      await authed(http, ben).post(`/api/chats/${chatId}/messages/${chat.messages[1]?.id}/regenerate`).expect(404);
    });
  });

  describe('refusals before the stream starts', () => {
    it('answers 404 for a foreign chat and writes nothing', async () => {
      await start();
      const chatId = await newChat();

      await authed(http, ben).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'x' }).expect(404);

      expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
    });

    it('answers 404 for a parent from another chat of the same user', async () => {
      await start();
      const first = await newChat();
      const second = await newChat();
      await authed(http, ann).post(`/api/chats/${first}/stream`).send({ parentId: null, text: 'x' }).expect(200);
      const answerOfFirst = (await detail(ann, first)).messages[1]?.id;

      await authed(http, ann).post(`/api/chats/${second}/stream`).send({ parentId: answerOfFirst, text: 'y' }).expect(404);
    });

    it('answers 422 for a message over the limit, and for a blank one', async () => {
      await start({ CHAT_MESSAGE_MAX_LENGTH: '10', CHAT_CONTEXT_MAX_CHARS: '1000' });
      const chatId = await newChat();

      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'x'.repeat(11) }).expect(422);
      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: '   ' }).expect(422);
      expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
    });

    it('answers 404 when the model is no longer available and stores no user message', async () => {
      await start();
      const chatId = await newChat();
      app.get(ModelRegistryService).resolve = () => Promise.reject(Object.assign(new Error('gone'), { status: 404 }));

      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'x' }).expect(404);

      expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
    });
  });

  describe('a broken provider', () => {
    it('shows only the coarse error, stores the answer as error with its reason and leaks no provider text', async () => {
      options = { failWith: new ProviderError(PROVIDER_ERROR.TIMEOUT, 'provider secret text 12345') };
      await start();
      const chatId = await newChat();

      const response = await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Frage' });

      expect(response.text).toContain(`"errorText":"${STREAM_ERROR_TEXT}"`);
      expect(response.text).not.toContain('12345');
      const chat = await until(async () => {
        const read = await detail(ann, chatId);
        return read.messages.length === 2 ? read : undefined;
      });
      expect(chat.messages[1]).toMatchObject({ status: MESSAGE_STATUS.ERROR, errorReason: PROVIDER_ERROR.TIMEOUT });
      expect(JSON.stringify(chat)).not.toContain('12345');
    });

    it('frees the place so the next answer works', async () => {
      options = { failWith: new Error('boom') };
      await start({ CHAT_MAX_CONCURRENT_STREAMS: '1' });
      const chatId = await newChat();
      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'a' });
      options = {};

      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'b' }).expect(200);
    });
  });

  describe('abort and limits (over a real connection)', () => {
    function openStream(chatId: string, login: Login, body: unknown) {
      const address = app.getHttpServer().address() as AddressInfo;
      const payload = JSON.stringify(body);
      return new Promise<{ req: ReturnType<typeof httpRequest>; firstChunk: string }>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port: address.port,
            path: `/api/chats/${chatId}/stream`,
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload),
              cookie: login.cookie,
              'x-csrf-token': login.csrf,
              origin: 'http://app.test',
            },
          },
          (res) => {
            res.once('data', (chunk: Buffer) => resolve({ req, firstChunk: chunk.toString() }));
            res.on('error', () => undefined);
          }
        );
        req.on('error', reject);
        req.end(payload);
      });
    }

    it('stores the partial text as aborted when the client leaves, aborts the model and frees the place', async () => {
      options = { deltas: ['Eins ', 'Zwei ', 'Drei ', 'Vier ', 'Fuenf'], chunkDelayMs: 60 };
      await start({ CHAT_MAX_CONCURRENT_STREAMS: '1' });
      await app.listen(0);
      const chatId = await newChat();

      const { req } = await openStream(chatId, ann, { parentId: null, text: 'Lange Antwort' });
      req.destroy();

      const chat = await until(async () => {
        const read = await detail(ann, chatId);
        return read.messages.length === 2 ? read : undefined;
      });
      expect(chat.messages[1]?.status).toBe(MESSAGE_STATUS.ABORTED);
      const text = chat.messages[1]?.parts.map((part) => part.text).join('') ?? '';
      expect(text.startsWith('Eins')).toBe(true);
      expect(text).not.toBe('Eins Zwei Drei Vier Fuenf');
      expect(models[0]?.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
      expect(chat.activeLeafId).toBe(chat.messages[1]?.id);
      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Danach' }).expect(200);
    });

    it('stops a stream that runs longer than the configured maximum', async () => {
      options = { deltas: Array.from({ length: 50 }, () => 'x'), chunkDelayMs: 100 };
      await start({ CHAT_STREAM_MAX_DURATION_MS: '1000' });
      const chatId = await newChat();

      await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Lang' });

      const chat = await detail(ann, chatId);
      expect(chat.messages[1]?.status).toBe(MESSAGE_STATUS.ABORTED);
    });

    it('answers the third parallel stream of one user with 429 and lets another user through', async () => {
      options = { deltas: ['a', 'b', 'c', 'd'], chunkDelayMs: 150 };
      await start({ CHAT_MAX_CONCURRENT_STREAMS: '2' });
      await app.listen(0);
      const chats = [await newChat(), await newChat(), await newChat()];
      const benChat = await newChat(ben);

      const one = await openStream(chats[0] ?? '', ann, { parentId: null, text: '1' });
      const two = await openStream(chats[1] ?? '', ann, { parentId: null, text: '2' });
      await authed(http, ann).post(`/api/chats/${chats[2]}/stream`).send({ parentId: null, text: '3' }).expect(429);
      await authed(http, ben).post(`/api/chats/${benChat}/stream`).send({ parentId: null, text: 'b' }).expect(200);

      one.req.destroy();
      two.req.destroy();
    });

    it('does not crash or write into another chat when the chat is deleted during the stream', async () => {
      options = { deltas: ['a', 'b', 'c', 'd'], chunkDelayMs: 80 };
      await start();
      await app.listen(0);
      const chatId = await newChat();
      const bystander = await insertChat(dataSource, ann.id, { title: 'Bleibt' });

      const { req } = await openStream(chatId, ann, { parentId: null, text: 'x' });
      await authed(http, ann).delete(`/api/chats/${chatId}`).expect(204);
      await new Promise((resolve) => setTimeout(resolve, 600));
      req.destroy();

      expect(await dataSource.query('SELECT 1 FROM message')).toHaveLength(0);
      expect(await dataSource.query('SELECT 1 FROM chat WHERE id = $1', [bystander.id])).toHaveLength(1);
      await authed(http, ann).get('/api/chats').expect(200);
    });
  });

});
```

Der Log-Test (Inhalte nicht in Logs) steht in Task 9, Step 1.

Hinweise zu den Tests: (a) `app.listen(0)` ist nötig, weil `request(app.getHttpServer())` den Server pro Aufruf kurz selbst startet; für die „über echte Verbindung"-Fälle wird einmal gebunden. Mischt sich beides, `request('http://127.0.0.1:' + port)` statt `app.getHttpServer()` verwenden. (b) `ProviderError`-Konstruktor und `PROVIDER_ERROR.TIMEOUT`-Name vorher in `http/safe-fetch/provider-error.ts` lesen und die Aufrufe anpassen. (c) Der Test „model is no longer available" überschreibt `resolve` am bereits überschriebenen Provider-Objekt; ist das Objekt nicht veränderbar, die Überschreibung über eine Variable `let resolveImpl` im Test lösen.

- [ ] **Step 2: Fehlschlag sehen**

Run: `pnpm --filter @owui/api test:db -- src/chats/chat-stream.db.spec.ts`
Expected: FAIL (Route fehlt).

- [ ] **Step 3: `ChatStreamService` schreiben**

```ts
// apps/api/src/chats/chat-stream.service.ts
import { randomUUID } from 'node:crypto';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from 'ai';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../config/env.js';
import { ProviderError } from '../http/safe-fetch/provider-error.js';
import { ModelRegistryService, type ResolvedModel } from '../models/model-registry.service.js';
import {
  MESSAGE_ERROR_REASON,
  MESSAGE_STATUS,
  type MessageStatus,
  STREAM_ERROR_TEXT,
} from './chat-dictionaries.js';
import { buildHistory } from './chat-history.js';
import type { MessagePart } from './chat-params.js';
import { ChatTitleService } from './chat-title.service.js';
import type { Chat } from './chat.entity.js';
import type { StreamChatDto } from './chats.dto.js';
import { ChatsService } from './chats.service.js';
import { MessageTreeService } from './message-tree.service.js';
import { StreamSlots } from './stream-slots.js';

interface Run {
  userId: string;
  chat: Chat;
  resolved: ResolvedModel;
  /** The user message the answer hangs under; the history ends here. */
  userMessageId: string;
}

/** Looks through the `cause` chain for a provider error; everything else is "internal". */
function reasonOf(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof ProviderError) return current.reason;
    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined;
  }
  return MESSAGE_ERROR_REASON.INTERNAL;
}

function statusOf(outcome: { status: string }, isAborted: boolean): MessageStatus {
  if (isAborted) return MESSAGE_STATUS.ABORTED;
  if (outcome.status === 'completed') return MESSAGE_STATUS.COMPLETE;
  if (outcome.status === 'failed') return MESSAGE_STATUS.ERROR;
  return MESSAGE_STATUS.ABORTED;
}

async function drain(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

@Injectable()
export class ChatStreamService {
  private readonly messageMax: number;
  private readonly contextMax: number;
  private readonly outputMax: number;
  private readonly durationMs: number;

  constructor(
    private readonly chats: ChatsService,
    private readonly tree: MessageTreeService,
    private readonly registry: ModelRegistryService,
    private readonly slots: StreamSlots,
    private readonly titles: ChatTitleService,
    private readonly logger: PinoLogger,
    config: ConfigService<Env, true>
  ) {
    this.logger.setContext(ChatStreamService.name);
    this.messageMax = config.get('CHAT_MESSAGE_MAX_LENGTH', { infer: true });
    this.contextMax = config.get('CHAT_CONTEXT_MAX_CHARS', { infer: true });
    this.outputMax = config.get('CHAT_MAX_OUTPUT_TOKENS', { infer: true });
    this.durationMs = config.get('CHAT_STREAM_MAX_DURATION_MS', { infer: true });
  }

  /** New user message under `input.parentId`, then the answer as an event stream. */
  async stream(userId: string, chatId: string, input: StreamChatDto, response: Response): Promise<void> {
    const text = input.text.trim();
    if (text === '' || input.text.length > this.messageMax || text.length > this.contextMax) {
      throw new UnprocessableEntityException('The message is empty or too long');
    }
    const release = this.slots.acquire(userId);
    try {
      const chat = await this.chats.getOwned(userId, chatId);
      const resolved = await this.registry.resolve(chat.modelId);
      const { messageId } = await this.tree.appendUserMessage(userId, chatId, input.parentId, input.text);
      await this.run({ userId, chat, resolved, userMessageId: messageId }, response);
    } finally {
      release();
    }
  }

  /** A new answer next to `messageId`, to the same user message. */
  async regenerate(userId: string, chatId: string, messageId: string, response: Response): Promise<void> {
    const release = this.slots.acquire(userId);
    try {
      const chat = await this.chats.getOwned(userId, chatId);
      const resolved = await this.registry.resolve(chat.modelId);
      const { userMessageId } = await this.tree.prepareRegenerate(userId, chatId, messageId);
      await this.run({ userId, chat, resolved, userMessageId }, response);
    } finally {
      release();
    }
  }

  private async run(run: Run, response: Response): Promise<void> {
    const { userId, chat, resolved, userMessageId } = run;
    const startedAt = Date.now();
    const assistantMessageId = randomUUID();

    const path = await this.tree.loadPath(userId, chat.id, userMessageId);
    const history = buildHistory(path, this.contextMax);
    const messages = await convertToModelMessages(
      history.map((message): Omit<UIMessage, 'id'> => ({ role: message.role, parts: message.parts }))
    );

    const abort = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) abort.abort();
    });
    const abortSignal = AbortSignal.any([abort.signal, AbortSignal.timeout(this.durationMs)]);

    const result = streamText({
      model: resolved.model,
      system: chat.systemPrompt ?? undefined,
      messages,
      abortSignal,
      maxRetries: 0,
      maxOutputTokens: Math.min(chat.params.maxOutputTokens ?? this.outputMax, this.outputMax),
      temperature: chat.params.temperature,
      topP: chat.params.topP,
    });

    const ui = toUIMessageStream({
      stream: result.stream,
      onError: () => STREAM_ERROR_TEXT,
      messageMetadata: ({ part }) =>
        part.type === 'start' ? { userMessageId, assistantMessageId } : undefined,
      onEnd: async (event) => {
        const status = statusOf(event.outcome, event.isAborted);
        const joined = event.responseMessage.parts
          .flatMap((part) => (part.type === 'text' ? [part.text] : []))
          .join('');
        const parts: MessagePart[] = joined === '' ? [] : [{ type: 'text', text: joined }];
        const usage = status === MESSAGE_STATUS.COMPLETE ? await result.usage : undefined;
        const saved = await this.tree.saveAssistant({
          userId,
          chatId: chat.id,
          id: assistantMessageId,
          parentId: userMessageId,
          status,
          parts,
          errorReason:
            status === MESSAGE_STATUS.ERROR
              ? reasonOf(event.outcome.status === 'failed' ? event.outcome.error : undefined)
              : null,
          modelId: chat.modelId,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
        });
        this.logger.info({
          chatId: chat.id,
          messageId: assistantMessageId,
          status,
          saved,
          outputChars: joined.length,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          durationMs: Date.now() - startedAt,
        });
        if (saved && status === MESSAGE_STATUS.COMPLETE) {
          await this.titles.scheduleAfterAnswer(chat.id);
        }
      },
    });

    // One branch goes to the client, the other is read to the end so the answer is stored even if the client left.
    const [toClient, toDrain] = ui.tee();
    const [sent, drained] = await Promise.allSettled([
      pipeUIMessageStreamToResponse({ response, stream: toClient }),
      drain(toDrain),
    ]);

    if (drained.status === 'rejected') {
      this.logger.warn({
        chatId: chat.id,
        messageId: assistantMessageId,
        errorName: drained.reason instanceof Error ? drained.reason.name : 'unknown',
        durationMs: Date.now() - startedAt,
      });
      this.endWithError(response);
    } else if (sent.status === 'rejected') {
      this.logger.debug({ chatId: chat.id, messageId: assistantMessageId }, 'client left the stream');
    }
  }

  /** The stream broke after the headers went out: tell the client in the stream protocol and close. */
  private endWithError(response: Response): void {
    if (response.writableEnded || response.destroyed) return;
    response.write(`data: ${JSON.stringify({ type: 'error', errorText: STREAM_ERROR_TEXT })}\n\n`);
    response.write('data: [DONE]\n\n');
    response.end();
  }
}
```

Hinweise: (1) `event.outcome.error` und `event.responseMessage.parts`: Die Typen stehen in `node_modules/ai/dist/index.d.ts` (`UIMessageStreamOnEndCallback`); passt eine Form nicht, anhand der Typen anpassen, keine Casts. (2) Ein Fehler **in** `onEnd` (zum Beispiel beim Speichern) wird im Strom ausgelöst und landet im `drained`-Zweig; das Log nennt dann nur den Fehlernamen. (3) Wirft `streamText` bei fehlerhaften Parametern synchron, passiert das vor dem Pipen und der Controller antwortet über den Exception-Filter. (4) `AbortSignal.any` und `AbortSignal.timeout` sind in Node ≥ 20 verfügbar.

- [ ] **Step 4: Controller, Modul und Zwischenversion des Titel-Dienstes**

In `chats.controller.ts` ergänzen (Imports: `Res`, `Throttle`, `ApiProduces`, `Response` aus `express`, `StreamChatDto`, `ChatStreamService`; Konstruktor um `private readonly streams: ChatStreamService` erweitern):

```ts
/** An answer costs model time: keep the rate low (the concurrent-stream limit is the hard cap). */
const STREAM_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

  @Post(':id/stream')
  @Throttle(STREAM_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'AI SDK UI message stream (server-sent events)' })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({ description: 'The message is empty or too long' })
  @ApiTooManyRequestsResponse({ description: 'Too many answers run at the same time' })
  async stream(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StreamChatDto,
    @Res() response: Response
  ): Promise<void> {
    await this.streams.stream(user.id, id, dto, response);
  }

  @Post(':id/messages/:messageId/regenerate')
  @Throttle(STREAM_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'AI SDK UI message stream (server-sent events)' })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({ description: 'Only an answer can be regenerated' })
  @ApiTooManyRequestsResponse({ description: 'Too many answers run at the same time' })
  async regenerate(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Res() response: Response
  ): Promise<void> {
    await this.streams.regenerate(user.id, id, messageId, response);
  }
```

`chats.module.ts`: Provider `ChatStreamService`, `StreamSlots`, `ChatTitleService` ergänzen. Zwischenversion (wird in Task 8 ersetzt):

```ts
// apps/api/src/chats/chat-title.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatTitleService {
  scheduleAfterAnswer(_chatId: string): Promise<void> {
    return Promise.resolve();
  }
}
```

In `chats.controller.spec.ts` die beiden neuen Routen in die Tabelle `routes` aufnehmen (401 und 403) und die Providerliste um `{ provide: ChatStreamService, useValue: {} }` ergänzen.

- [ ] **Step 5: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/chats` und `pnpm --filter @owui/api test:db -- src/chats/chat-stream.db.spec.ts`
Expected: PASS. Hängt der Abbruch-Test (Eintrag bleibt aus), prüfen: feuert `response.on('close')`? Wird `abort.abort()` aufgerufen? Endet `drain`? Notfalls den Zweig mit `console`-freiem Debug über `logger.debug` untersuchen und den Fehler beheben; die Tests nicht lockern.

- [ ] **Step 6: Mutationsprobe**

(a) In `run` das `abort.abort()` auskommentieren → der Abbruch-Test rot. (b) In `stream()` `release()` entfernen → Test „frees the place" und 429-Test auffällig. (c) In `endWithError` den Fehler-Teil entfernen → „shows only the coarse error" rot. (d) `drain(toDrain)` entfernen → Abbruch-Test rot (Antwort wird nicht gespeichert). Zurücknehmen.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/chats
git commit -m "feat(chats): stream answers with abort, regenerate and limits

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Jobs-Modul (pg-boss) und Titel-Job

**Files:**

- Create: `apps/api/src/jobs/job-queue.ts`, `pg-boss-job-queue.ts`, `jobs.module.ts`, `pg-boss-job-queue.db.spec.ts`
- Create: `apps/api/src/testing/fake-job-queue.ts`
- Replace: `apps/api/src/chats/chat-title.service.ts` (Zwischenversion aus Task 7)
- Create: `apps/api/src/chats/chat-title.service.spec.ts` (Einheit, mit Fakes), `chat-title.db.spec.ts`
- Modify: `apps/api/src/chats/chats.module.ts` (importiert `JobsModule`), `apps/api/src/app.module.ts` (`JobsModule`), `apps/api/src/testing/create-db-test-app.ts` (Fake-Warteschlange als Standard)

**Interfaces:**

- Produces:
  - `JOB_QUEUE` (Symbol) und `interface JobQueue { send(name: string, data: { chatId: string }): Promise<void>; work(name: string, handler: (data: { chatId: string }) => Promise<void>): Promise<void> }`. (Der Datentyp ist absichtlich eng: Job-Daten enthalten nur eine ID. Kommt ein zweiter Job mit anderem Datentyp, wird die Schnittstelle dann verallgemeinert.)
  - `PgBossJobQueue implements JobQueue, OnApplicationBootstrap, BeforeApplicationShutdown`.
  - `FakeJobQueue implements JobQueue` mit `sent: { name: string; data: { chatId: string } }[]` und `run(name: string): Promise<void>` (führt den registrierten Worker für alle gesendeten Jobs aus; Fehler des Workers werden weitergereicht).
  - `ChatTitleService`: `scheduleAfterAnswer(chatId: string): Promise<void>`, `generate(chatId: string): Promise<void>`, Worker-Registrierung in `onApplicationBootstrap`.

- [ ] **Step 1: pg-boss-Schnittstelle und Fake**

```ts
// apps/api/src/jobs/job-queue.ts
export const JOB_QUEUE = Symbol('JOB_QUEUE');

export interface ChatJobData {
  chatId: string;
}

/** The background job queue; pg-boss in production. Job data are ids only: no content in the job table. */
export interface JobQueue {
  send(name: string, data: ChatJobData): Promise<void>;
  /** Registers the handler for `name`. A thrown error fails the job (the queue retries it). */
  work(name: string, handler: (data: ChatJobData) => Promise<void>): Promise<void>;
}
```

```ts
// apps/api/src/testing/fake-job-queue.ts
import type { ChatJobData, JobQueue } from '../jobs/job-queue.js';

/** In memory: jobs wait until a test calls `run`. */
export class FakeJobQueue implements JobQueue {
  readonly sent: { name: string; data: ChatJobData }[] = [];
  private readonly handlers = new Map<string, (data: ChatJobData) => Promise<void>>();

  send(name: string, data: ChatJobData): Promise<void> {
    this.sent.push({ name, data });
    return Promise.resolve();
  }

  work(name: string, handler: (data: ChatJobData) => Promise<void>): Promise<void> {
    this.handlers.set(name, handler);
    return Promise.resolve();
  }

  /** Runs every job sent under `name` once, in order; the first error is thrown. */
  async run(name: string): Promise<void> {
    const handler = this.handlers.get(name);
    if (handler === undefined) throw new Error(`No worker registered for ${name}`);
    for (const job of this.sent.filter((entry) => entry.name === name)) await handler(job.data);
  }
}
```

- [ ] **Step 2: Failing Einheitstest für den Titel-Dienst**

Der Dienst hängt an `DataSource`, `MessageTreeService`, `ModelRegistryService`, `JOB_QUEUE` und `PinoLogger`. Die Einheitstests prüfen die Entscheidungen mit Fakes; die DB-Tests (Step 5) den SQL-Teil.

```ts
// apps/api/src/chats/chat-title.service.spec.ts
import { describe, expect, it } from 'vitest';

import { FakeJobQueue } from '../testing/fake-job-queue.js';
import { silentLogger } from '../testing/provider-fixtures.js';
import { CHAT_JOB } from './chat-dictionaries.js';
import { ChatTitleService } from './chat-title.service.js';

function service(options: { answers: number; titleSource?: string }) {
  const queue = new FakeJobQueue();
  const tree = { countCompletedAnswers: () => Promise.resolve(options.answers) };
  const dataSource = {
    query: () => Promise.resolve([{ title_source: options.titleSource ?? 'fallback' }]),
  };
  const titles = new ChatTitleService(
    dataSource as never,
    tree as never,
    {} as never,
    queue,
    silentLogger()
  );
  return { titles, queue };
}

describe('scheduleAfterAnswer', () => {
  it('queues exactly one job, with the chat id only, after the first completed answer', async () => {
    const { titles, queue } = service({ answers: 1 });

    await titles.scheduleAfterAnswer('chat-1');

    expect(queue.sent).toEqual([{ name: CHAT_JOB.GENERATE_TITLE, data: { chatId: 'chat-1' } }]);
  });

  it('queues nothing after later answers or when the user named the chat', async () => {
    const later = service({ answers: 2 });
    const named = service({ answers: 1, titleSource: 'user' });

    await later.titles.scheduleAfterAnswer('chat-1');
    await named.titles.scheduleAfterAnswer('chat-1');

    expect(later.queue.sent).toEqual([]);
    expect(named.queue.sent).toEqual([]);
  });
});
```

Der `as never`-Kniff ist hier nur an Testfakes erlaubt, weil `as unknown as` verboten ist und die Fakes bewusst Teilmengen sind; wo der Konstruktor kleinere Schnittstellen zulässt (`Pick<...>`), diese stattdessen im Konstruktor typisieren und die Fakes ohne Cast übergeben (bevorzugt).

- [ ] **Step 3: Titel-Dienst schreiben**

```ts
// apps/api/src/chats/chat-title.service.ts
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { generateText } from 'ai';
import { PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';

import { JOB_QUEUE, type JobQueue } from '../jobs/job-queue.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { CHAT_JOB, CHAT_TITLE_SOURCE, MESSAGE_ROLE, MESSAGE_STATUS } from './chat-dictionaries.js';
import { sanitizeTitle } from './chat-title.js';
import { textOf } from './chat-history.js';
import { MessageTreeService } from './message-tree.service.js';
import type { MessagePart } from './chat-params.js';

const TITLE_INSTRUCTION =
  'Schreibe einen kurzen Titel (höchstens 6 Wörter) für diese Unterhaltung, in der Sprache der Nutzerfrage. Antworte nur mit dem Titel, ohne Anführungszeichen.';
const EXCERPT_CHARS = 1000;
const TITLE_TIMEOUT_MS = 30_000;
const TITLE_MAX_OUTPUT_TOKENS = 30;

interface FirstTurn {
  model_id: string;
  question: MessagePart[];
  answer: MessagePart[];
}

/**
 * The title of a chat. The first completed answer queues a job that carries only the chat id; the worker asks the
 * chat's own model for a title. If that fails after the retries, the title stays the start of the first message
 * (`titleSource = fallback`), which the product treats as a normal, visible default.
 */
@Injectable()
export class ChatTitleService implements OnApplicationBootstrap {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tree: MessageTreeService,
    private readonly registry: ModelRegistryService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(ChatTitleService.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.work(CHAT_JOB.GENERATE_TITLE, (data) => this.generate(data.chatId));
  }

  /**
   * Called after an answer was stored. Best effort: if queueing fails the chat keeps its fallback title and the
   * error is logged (the answer is already saved and must not turn into an error for the user).
   */
  async scheduleAfterAnswer(chatId: string): Promise<void> {
    try {
      const rows: { title_source: string }[] = await this.dataSource.query(
        'SELECT title_source FROM chat WHERE id = $1',
        [chatId]
      );
      if (rows[0]?.title_source !== CHAT_TITLE_SOURCE.FALLBACK) return;
      if ((await this.tree.countCompletedAnswers(chatId)) !== 1) return;
      await this.queue.send(CHAT_JOB.GENERATE_TITLE, { chatId });
    } catch (error) {
      this.logger.error({
        chatId,
        errorName: error instanceof Error ? error.name : 'unknown',
        msg: 'could not queue the title job',
      });
    }
  }

  /** The job. Throws when no usable title comes out, so the queue retries. */
  async generate(chatId: string): Promise<void> {
    const rows: FirstTurn[] = await this.dataSource.query(
      `SELECT c.model_id, q.parts AS question, a.parts AS answer
         FROM chat c
         JOIN message q ON q.chat_id = c.id AND q.role = $2
         JOIN message a ON a.parent_id = q.id AND a.role = $3 AND a.status = $4
        WHERE c.id = $1 AND c.title_source = $5
        ORDER BY q.created_at, a.created_at
        LIMIT 1`,
      [chatId, MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT, MESSAGE_STATUS.COMPLETE, CHAT_TITLE_SOURCE.FALLBACK]
    );
    const turn = rows[0];
    if (turn === undefined) return;

    const { model } = await this.registry.resolve(turn.model_id);
    const result = await generateText({
      model,
      system: TITLE_INSTRUCTION,
      prompt: `Frage: ${textOf(turn.question).slice(0, EXCERPT_CHARS)}\n\nAntwort: ${textOf(turn.answer).slice(0, EXCERPT_CHARS)}`,
      maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
    });
    const title = sanitizeTitle(result.text);
    if (title === '') throw new Error('The model returned no usable title');

    const updated: [unknown[], number] = await this.dataSource.query(
      `UPDATE chat SET title = $2, title_source = $3
        WHERE id = $1 AND title_source = $4`,
      [chatId, title, CHAT_TITLE_SOURCE.GENERATED, CHAT_TITLE_SOURCE.FALLBACK]
    );
    this.logger.info({ chatId, titleChars: title.length, applied: updated[1] > 0 });
  }
}
```

Der Titel bumpt `updated_at` nicht (kein `updated_at`-Trigger im Raw-`UPDATE`): so springt die Chatliste nach dem Job nicht um.

- [ ] **Step 4: pg-boss-Umsetzung und Modul**

`node_modules/pg-boss/dist/*.d.ts` lesen und die Aufrufe gegen die Typen prüfen (Step 1 von Task 1). Dann:

```ts
// apps/api/src/jobs/pg-boss-job-queue.ts
import {
  type BeforeApplicationShutdown,
  Injectable,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgBoss } from 'pg-boss';
import { PinoLogger } from 'nestjs-pino';

import type { Env } from '../config/env.js';
import type { ChatJobData, JobQueue } from './job-queue.js';

const RETRY_LIMIT = 2;
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * pg-boss with its own small connection pool (it cannot share TypeORM's). It starts on the first use or at
 * application start, whichever comes first, so the order of the modules does not matter.
 */
@Injectable()
export class PgBossJobQueue implements JobQueue, OnApplicationBootstrap, BeforeApplicationShutdown {
  private boss: Promise<PgBoss> | undefined;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(PgBossJobQueue.name);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.started();
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.boss === undefined) return;
    const boss = await this.boss;
    await boss.stop({ graceful: true, timeout: SHUTDOWN_TIMEOUT_MS });
  }

  async send(name: string, data: ChatJobData): Promise<void> {
    const boss = await this.started();
    await boss.createQueue(name);
    await boss.send(name, data, { retryLimit: RETRY_LIMIT, retryDelay: 5, retryBackoff: true });
  }

  async work(name: string, handler: (data: ChatJobData) => Promise<void>): Promise<void> {
    const boss = await this.started();
    await boss.createQueue(name);
    await boss.work<ChatJobData>(name, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }

  private started(): Promise<PgBoss> {
    this.boss ??= this.start();
    return this.boss;
  }

  private async start(): Promise<PgBoss> {
    const boss = new PgBoss({
      connectionString: this.config.get('DATABASE_URL', { infer: true }),
      max: 3,
    });
    boss.on('error', (error: Error) => {
      this.logger.error({ errorName: error.name, msg: 'pg-boss error' });
    });
    await boss.start();
    return boss;
  }
}
```

```ts
// apps/api/src/jobs/jobs.module.ts
import { Module } from '@nestjs/common';

import { JOB_QUEUE } from './job-queue.js';
import { PgBossJobQueue } from './pg-boss-job-queue.js';

@Module({
  providers: [PgBossJobQueue, { provide: JOB_QUEUE, useExisting: PgBossJobQueue }],
  exports: [JOB_QUEUE],
})
export class JobsModule {}
```

Zeigen die Typen von `pg-boss` 12 andere Formen (`work`-Signatur, `createQueue`-Idempotenz, Import `PgBoss` als Named oder Default Export), den Code an die Typen anpassen, nicht umgekehrt. Ist `createQueue` bei vorhandener Queue ein Fehler, die Existenz vorher mit `boss.getQueue(name)` prüfen.

`ChatsModule`: `imports: [ModelsModule, JobsModule]`; `AppModule`: `JobsModule` einfügen. In `testing/create-db-test-app.ts` `JobsModule`-Anbieter standardmäßig durch eine Fake-Warteschlange ersetzen:

```ts
  // inside createDbTestApp, after `if (options.configure) builder = options.configure(builder);`
  if (options.jobs !== 'real') builder = builder.overrideProvider(JOB_QUEUE).useValue(new FakeJobQueue());
```

und `DbTestAppOptions` um `jobs?: 'fake' | 'real'` erweitern (`ChatsModule` zieht `JobsModule` transitiv, daher steht `JobsModule` nicht extra in der Importliste des Testmoduls).

- [ ] **Step 5: DB-Tests für Titel und Warteschlange**

```ts
// apps/api/src/chats/chat-title.db.spec.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { JOB_QUEUE } from '../jobs/job-queue.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { chatModel } from '../testing/chat-model.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { FakeJobQueue } from '../testing/fake-job-queue.js';
import { authed, type Http, type Login, signupUser } from '../testing/http-session.js';
import { CHAT_JOB, CHAT_TITLE_SOURCE } from './chat-dictionaries.js';
import type { ChatDetailDto } from './chats.dto.js';

const MODEL_ID = 'connection-1:fake-model';

describe('chat titles (database)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let http: Http;
  let ann: Login;
  let queue: FakeJobQueue;
  let titleText = 'Wetter in Berlin';

  afterEach(async () => {
    await app.close();
    titleText = 'Wetter in Berlin';
  });

  async function start(): Promise<void> {
    app = await createDbTestApp(
      testDatabaseUrl(),
      {},
      {
        configure: (builder) =>
          builder.overrideProvider(ModelRegistryService).useValue({
            resolve: () =>
              Promise.resolve({
                model: chatModel({ deltas: [titleText] }),
                connection: { id: 'connection-1', name: 'Fake', type: 'ollama' },
                rawModelId: 'fake-model',
              }),
          }),
      }
    );
    dataSource = app.get(DataSource);
    queue = app.get<FakeJobQueue>(JOB_QUEUE);
    http = request(app.getHttpServer());
    ann = await signupUser(http, { email: 'ann@example.com' });
  }

  async function chatWithAnswer(): Promise<string> {
    const created = await authed(http, ann).post('/api/chats').send({ modelId: MODEL_ID }).expect(201);
    const chatId = (created.body as ChatDetailDto).id;
    await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: 'Wie wird das Wetter in Berlin?' }).expect(200);
    return chatId;
  }

  async function titleOf(chatId: string) {
    const rows = await dataSource.query('SELECT title, title_source FROM chat WHERE id = $1', [chatId]);
    return rows[0] as { title: string; title_source: string };
  }

  it('queues one job with the chat id only after the first answer, not after the second', async () => {
    await start();
    const chatId = await chatWithAnswer();
    const detail = (await authed(http, ann).get(`/api/chats/${chatId}`).expect(200)).body as ChatDetailDto;

    await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: detail.messages[1]?.id, text: 'Und morgen?' }).expect(200);

    expect(queue.sent).toEqual([{ name: CHAT_JOB.GENERATE_TITLE, data: { chatId } }]);
  });

  it('replaces the fallback title with the generated one', async () => {
    await start();
    const chatId = await chatWithAnswer();
    expect(await titleOf(chatId)).toEqual({ title: 'Wie wird das Wetter in Berlin?', title_source: CHAT_TITLE_SOURCE.FALLBACK });

    await queue.run(CHAT_JOB.GENERATE_TITLE);

    expect(await titleOf(chatId)).toEqual({ title: 'Wetter in Berlin', title_source: CHAT_TITLE_SOURCE.GENERATED });
  });

  it('does not overwrite a title the user chose before the job ran', async () => {
    await start();
    const chatId = await chatWithAnswer();
    await authed(http, ann).patch(`/api/chats/${chatId}`).send({ title: 'Mein Titel' }).expect(200);

    await queue.run(CHAT_JOB.GENERATE_TITLE);

    expect(await titleOf(chatId)).toEqual({ title: 'Mein Titel', title_source: CHAT_TITLE_SOURCE.USER });
  });

  it('keeps the fallback and throws (so the queue retries) when the model gives no usable title', async () => {
    await start();
    titleText = '"""';
    const chatId = await chatWithAnswer();

    await expect(queue.run(CHAT_JOB.GENERATE_TITLE)).rejects.toThrow(/no usable title/);

    expect((await titleOf(chatId)).title_source).toBe(CHAT_TITLE_SOURCE.FALLBACK);
  });

  it('does nothing for a chat that was deleted meanwhile', async () => {
    await start();
    const chatId = await chatWithAnswer();
    await authed(http, ann).delete(`/api/chats/${chatId}`).expect(204);

    await expect(queue.run(CHAT_JOB.GENERATE_TITLE)).resolves.toBeUndefined();
  });

  it('shows markup in a generated title as plain characters only (the API stores text)', async () => {
    await start();
    titleText = '<script>alert(1)</script> Titel';
    const chatId = await chatWithAnswer();

    await queue.run(CHAT_JOB.GENERATE_TITLE);

    expect((await titleOf(chatId)).title).toBe('<script>alert(1)</script> Titel');
  });
});
```

```ts
// apps/api/src/jobs/pg-boss-job-queue.db.spec.ts
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { AppConfigModule } from '../config/app-config.module.js';
import { AppLoggerModule } from '../logging/logger.module.js';
import { BASE_TEST_ENV } from '../testing/create-test-app.js';
import { PgBossJobQueue } from './pg-boss-job-queue.js';

const NAME = 'test.job-queue';

describe('PgBossJobQueue (database)', () => {
  let queue: PgBossJobQueue;
  let close: () => Promise<void>;

  afterEach(async () => {
    await close();
  });

  async function start(): Promise<void> {
    const module = await Test.createTestingModule({
      imports: [
        AppConfigModule.forRoot({ raw: { ...BASE_TEST_ENV, DATABASE_URL: testDatabaseUrl() }, ignoreEnvFile: true }),
        AppLoggerModule,
      ],
      providers: [PgBossJobQueue],
    }).compile();
    await module.init();
    queue = module.get(PgBossJobQueue);
    close = () => module.close();
  }

  it('delivers a job to the worker and retries a failing one', async () => {
    await start();
    const seen: string[] = [];
    let attempts = 0;
    await queue.work(NAME, async (data) => {
      attempts += 1;
      if (attempts === 1) throw new Error('first attempt fails');
      seen.push(data.chatId);
    });

    await queue.send(NAME, { chatId: 'chat-1' });

    const deadline = Date.now() + 30_000;
    while (seen.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
    expect(seen).toEqual(['chat-1']);
    expect(attempts).toBe(2);
  }, 40_000);
});
```

Die Retry-Verzögerung (`retryDelay: 5` Sekunden) macht diesen Test mehrere Sekunden lang; ist das zu langsam, im Test eine Konstante über den Konstruktor nicht ändern, sondern `retryDelay` in `pg-boss-job-queue.ts` auf `1` setzen (der Wert ist für den Titel ohnehin unkritisch).

- [ ] **Step 6: Tests laufen lassen**

Run: `pnpm --filter @owui/api exec vitest run src/chats src/jobs` und `pnpm --filter @owui/api test:db -- src/chats src/jobs`
Expected: PASS. Dazu `pnpm check`.

- [ ] **Step 7: Mutationsprobe**

In `generate` die Bedingung `AND title_source = $4` im `UPDATE` entfernen → „does not overwrite a title the user chose" rot. In `scheduleAfterAnswer` die Prüfung `!== 1` entfernen → „not after the second" rot. Zurücknehmen.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src pnpm-lock.yaml
git commit -m "feat(chats): generate titles in a pg-boss job

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Log-Test, OpenAPI, Smoke-Test

**Files:**

- Create: `apps/api/src/chats/chat-logs.db.spec.ts`
- Modify: `apps/api/openapi.json` (generiert), `apps/web/src/api/generated/**` (generiert)
- Modify: `scripts/smoke.mjs`, `scripts/fake-provider.mjs`

- [ ] **Step 1: Log-Test schreiben**

```ts
// apps/api/src/chats/chat-logs.db.spec.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PinoLogger } from 'nestjs-pino';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { testDatabaseUrl } from '../../test/db-global-setup.js';
import { ModelRegistryService } from '../models/model-registry.service.js';
import { chatModel } from '../testing/chat-model.js';
import { createDbTestApp } from '../testing/create-db-test-app.js';
import { authed, signupUser } from '../testing/http-session.js';
import { capturingLogger } from '../testing/provider-fixtures.js';
import type { ChatDetailDto } from './chats.dto.js';

const MESSAGE = 'GEHEIME-NACHRICHT-4711';
const PROMPT = 'GEHEIMER-SYSTEMPROMPT-4712';
const ANSWER = 'GEHEIME-ANTWORT-4713';

describe('chat content stays out of the logs (database)', () => {
  let app: NestExpressApplication;

  afterEach(async () => {
    await app.close();
  });

  it('writes ids, lengths and counts, never message, prompt, answer or title', async () => {
    const logs = capturingLogger();
    app = await createDbTestApp(
      testDatabaseUrl(),
      { LOG_LEVEL: 'trace' },
      {
        configure: (builder) =>
          builder
            .overrideProvider(PinoLogger)
            .useValue(logs.logger)
            .overrideProvider(ModelRegistryService)
            .useValue({
              resolve: () =>
                Promise.resolve({
                  model: chatModel({ deltas: [ANSWER] }),
                  connection: { id: 'connection-1', name: 'Fake', type: 'ollama' },
                  rawModelId: 'fake-model',
                }),
            }),
      }
    );
    const http = request(app.getHttpServer());
    const ann = await signupUser(http, { email: 'ann@example.com' });
    const created = await authed(http, ann)
      .post('/api/chats')
      .send({ modelId: 'connection-1:fake-model', systemPrompt: PROMPT })
      .expect(201);
    const chatId = (created.body as ChatDetailDto).id;

    await authed(http, ann).post(`/api/chats/${chatId}/stream`).send({ parentId: null, text: MESSAGE }).expect(200);
    await authed(http, ann).patch(`/api/chats/${chatId}`).send({ title: MESSAGE }).expect(200);

    const output = logs.output();
    expect(output).toContain(chatId);
    expect(output).not.toContain(MESSAGE);
    expect(output).not.toContain(PROMPT);
    expect(output).not.toContain(ANSWER);
  });
});
```

Wie in `models.db.spec.ts` (Zeile 49 ff.) muss geprüft werden, dass das Überschreiben von `PinoLogger` die Dienste erreicht (sie injizieren `PinoLogger`); das Muster dort übernehmen.

- [ ] **Step 2: Test laufen lassen**

Run: `pnpm --filter @owui/api test:db -- src/chats/chat-logs.db.spec.ts`
Expected: PASS. Schlägt er fehl, die Logzeile suchen, die den Inhalt trägt (zum Beispiel ein Request-Body-Log von `pino-http`), und dort schwärzen oder entfernen, **nicht** den Test lockern.

- [ ] **Step 3: OpenAPI und Web-Client erzeugen**

Run: `pnpm openapi`
Expected: `apps/api/openapi.json` und `apps/web/src/api/generated/**` enthalten die Chat-Routen und DTOs; `git diff --stat` zeigt nur Chat-bezogene Änderungen. Dann `pnpm check`.

- [ ] **Step 4: Fake-Anbieter und Smoke-Test erweitern**

`scripts/fake-provider.mjs` lesen und ergänzen: `POST /v1/chat/completions` mit `stream: true` antwortet als SSE (`data: {"id":"c","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Hallo "}}]}`, zwei bis drei Chunks mit 200 ms Abstand, danach `data: {...finish_reason: "stop"}` und `data: [DONE]`); ohne `stream` ein vollständiges JSON (für den Titel-Job: `{"choices":[{"message":{"role":"assistant","content":"Testtitel"}}]}`).

`scripts/smoke.mjs` um zwei Prüfungen ergänzen (ohne Anmeldung, wie die übrigen):

```js
const chatsWithoutSession = await fetch(`${BASE_URL}/api/chats`);
check('chat list needs a session', chatsWithoutSession.status === 401);

const streamWithoutSession = await fetch(`${BASE_URL}/api/chats/00000000-0000-4000-8000-000000000000/stream`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE_URL },
  body: JSON.stringify({ parentId: null, text: 'x' }),
});
check('chat stream needs a session', streamWithoutSession.status === 401);
```

Run: `pnpm check && pnpm test`
Expected: grün.

- [ ] **Step 5: Commit**

```bash
git add apps scripts
git commit -m "feat(chats): log test, OpenAPI and smoke checks for chats

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Handprobe über Caddy, Dokumentation, DoD

**Files:**

- Create: `docs/dod/03-chat-backend.md`
- Modify: `docs/PLAN.md`, `docs/BACKLOG.md`, `docs/THREAT-MODEL.md`, `docs/superpowers/specs/2026-10-10-teilprojekt-3-chat-streaming-design.md`, `docs/superpowers/specs/2026-10-09-open-webui-nestjs-design.md`, `README.md`
- Create: `docs/adr/0004-chat-streaming-protokoll.md` (Nummer vorher mit `ls docs/adr` prüfen)

- [ ] **Step 1: Handprobe mit dem ganzen Stack**

`docker compose -p owui-probe up --build -d` (eigenes Projekt mit frischer Datenbank), den Fake-Anbieter (`node scripts/fake-provider.mjs`) auf einem freigegebenen Host (`PROVIDER_ALLOWED_HOSTS`) starten, als Admin anmelden, eine Verbindung anlegen und dann mit `curl -N` (Cookie und CSRF-Header aus der Anmeldung) prüfen:

1. `POST /api/chats` → Chat-ID.
2. `POST /api/chats/<id>/stream` mit `curl -N`: **die Chunks kommen einzeln und zeitlich versetzt an** (nicht erst am Ende; Beleg für „keine Pufferung" durch Caddy).
3. Während des Streams `Ctrl-C`: danach `GET /api/chats/<id>` zeigt eine Antwort mit Status `aborted` und Teiltext.
4. Titel: nach einer vollständigen Antwort wechselt `title` innerhalb weniger Sekunden auf `Testtitel` (`titleSource: generated`).
5. Dritter paralleler Stream desselben Nutzers: `429`.
6. `docker compose -p owui-probe logs api`: keine Nachrichtentexte.
7. `docker compose -p owui-probe down -v`.

Abweichungen der Probe mit Test zuerst beheben und in einem eigenen Commit festhalten.

- [ ] **Step 2: Docs aktualisieren (ein Commit)**

- Spec Abschnitt 6 und 7 und die Abweichungsliste dieses Plans einarbeiten: kein Event-Emitter (direkter Aufruf), Teiltext über `onEnd` des UI-Streams, Fehler-Teil selbst geschrieben, kein `CHAT_STREAM_RATE_LIMIT` (Konstante). Abschnitt 2 der Spec: die Zeile „Abbruch" auf „sicher (Vertragstest)".
- `docs/dod/03-chat-backend.md` nach [docs/dod/TEMPLATE.md](../../dod/TEMPLATE.md): Zahlen aus `pnpm test`, `pnpm test:db`, `pnpm check`, Mutationsproben (Task 4 bis 8 mit Befund), Handprobe (Punkte 1 bis 7), Nicht-Geprüftes.
- `docs/PLAN.md`: Teilprojekt 3 auf „Backend erledigt (Plan 3a), Web offen (Plan 3b)"; „Als Nächstes": Plan 3b schreiben.
- `docs/BACKLOG.md`: Resumable Streams; Ordner und Tags (3c); tokengenaue Kontextkürzung; Stream-Platzzähler über mehrere Knoten; Volltextsuche in Nachrichten; Titel-Modell getrennt vom Chat-Modell; Audit-Einträge für das Löschen von Chats; Antworten mit Status `error` fehlen im Verlauf (Nutzer sieht Lücke, Modell nicht); pg-boss braucht Rechte zum Anlegen seines Schemas (zu Datenbank-Rollen trennen).
- `docs/THREAT-MODEL.md`: die Zeilen aus Abschnitt 9 der Spec.
- Gesamt-Spec: offene Frage in Abschnitt 9 „Streaming-Protokoll" auf „entschieden, siehe ADR 0004".
- ADR 0004 (Kontext, Entscheidung `useChat` + UI-Message-Stream über POST-SSE, Server besitzt den Verlauf, Folgen: kein Resume, Ast-Wechsel über `PATCH`).
- `README.md`: ein Satz zu den Chat-Variablen und dazu, dass pg-boss sein eigenes Schema `pgboss` anlegt.

- [ ] **Step 3: Gesamtprüfung und Push**

Run: `pnpm check && pnpm test && pnpm test:db`
Expected: alles grün (Zahlen in den DoD-Beleg übernehmen).

```bash
git add docs README.md
git commit -m "docs: record Teilprojekt 3a (chat backend)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git push
gh run list --branch main --limit 1
```

Rote CI vor neuer Arbeit beheben.

---

## Self-Review (gegen die Spec)

- **Spec Abschnitt 1 (Erfolg):** Stream und Speichern (Task 7), Abbruch mit Teiltext (Task 7, echte Verbindung), Regenerieren und Bearbeiten als Geschwister (Task 7), Isolation (Tasks 5, 6, 7), Titel-Job mit Rückfall (Task 8), keine Inhalte in Logs und Job-Tabelle (Tasks 8, 9), Smoke und Handprobe (Tasks 9, 10).
- **Abschnitt 4 (Daten):** Task 3 (Tabellen, CHECKs, Index, Kaskaden, `SET NULL`); Baumregeln Task 6.
- **Abschnitt 5 (Schnittstellen):** Liste, Anlegen, Lesen, Ändern (inklusive `activeMessageId`), Löschen: Task 5; Stream, Regenerieren: Task 7. Fehlercodes 404/409/422/429: Tasks 5 bis 7.
- **Abschnitt 6 (Ablauf, Konfiguration):** Task 2 (Variablen), Task 7 (Schritte 1 bis 8; Schritt 8 „Ereignis" als direkter Aufruf, siehe Abweichung 4).
- **Abschnitt 7 (Titel):** Task 8.
- **Abschnitt 9/10:** Bedrohungsmodell und Tests: Task 10 und die Tests der Tasks 4 bis 9.
- **Nicht in diesem Plan (gehört zu 3b):** Web, Markdown, Transport, i18n, Browser-Prüfung.
- **Typkonsistenz:** `HistoryRow`/`UiHistoryMessage` (Task 4) werden in Task 6 und 7 genutzt; `MessagePart` kommt aus `chat-params.ts` (Task 3); `SaveAssistantInput` (Task 6) wird in Task 7 mit denselben Feldern gefüllt; `ChatTitleService.scheduleAfterAnswer(chatId: string): Promise<void>` (Zwischenversion Task 7, Ersatz Task 8) hat dieselbe Signatur; `JobQueue` (Task 8) wird von `FakeJobQueue` und `PgBossJobQueue` umgesetzt.
- **Bekannte Unsicherheiten, die im Plan geprüft werden:** `JOIN LATERAL` im rekursiven Teil (Task 6, Hinweis mit Rückfall), pg-boss-12-Signaturen (Task 1 und 8), Ergebnisform von `DELETE` über `dataSource.query` (Task 5, Hinweis), Typen von `usage`/`finishReason` im Mock (Task 1).
