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

async function send(
  messages: UIMessage[],
  trigger: Trigger = 'submit-message',
  messageId?: string
) {
  const transport = createChatTransport(CHAT);
  await transport.sendMessages({
    chatId: CHAT,
    messages,
    trigger,
    messageId,
    abortSignal: undefined,
  });
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
    url: input instanceof Request ? input.url : input.toString(),
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
