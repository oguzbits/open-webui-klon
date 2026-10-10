import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

const U1 = messageDto({
  id: 'u1',
  parentId: null,
  parts: textParts('Hallo'),
  createdAt: chatTime(0),
});
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

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '<img src=x onerror=alert(1)>'
    );
    expect(within(messageList()).getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('ChatPage: loading states', () => {
  it('shows a loading state, then the chat', async () => {
    let release: (() => void) | undefined;
    stubChat({
      [`GET ${DETAIL_PATH}`]: () =>
        new Promise<Response>((resolve) => {
          release = () => {
            resolve(json(200, detail));
          };
        }),
    });
    renderApp(`/chats/${CHAT_ID}`);

    // Wait for the chat request itself: before it, the session check shows a loading state of its own.
    await waitFor(() => {
      expect(release).toBeDefined();
    });
    expect(within(screen.getByRole('main')).getByRole('status')).toBeInTheDocument();
    release?.();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Erster Chat' })
    ).toBeInTheDocument();
  });

  it('shows a retry when loading fails', async () => {
    const user = userEvent.setup();
    let failing = true;
    stubChat({
      [`GET ${DETAIL_PATH}`]: () =>
        failing ? problem(500, 'Internal Server Error') : json(200, detail),
    });
    renderApp(`/chats/${CHAT_ID}`);
    await screen.findByText('Das Laden hat nicht geklappt.');

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Erster Chat' })
    ).toBeInTheDocument();
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

    expect(bodyOfLast(fetchMock, 'POST', STREAM_PATH)).toEqual({
      parentId: 'a1',
      text: 'Neue Frage',
    });
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

  it('sends once when Enter comes twice before the page renders again', async () => {
    const stream = manualStream();
    const fetchMock = stubChat({ [STREAM]: stream.handler });
    const user = userEvent.setup();
    await openChat();
    const box = screen.getByLabelText('Nachricht');
    await user.type(box, 'Eins');

    act(() => {
      fireEvent.keyDown(box, { key: 'Enter' });
      fireEvent.keyDown(box, { key: 'Enter' });
    });
    await stream.open();

    expect(callsTo(fetchMock, 'POST', STREAM_PATH)).toHaveLength(1);
    expect(within(messageList()).getAllByText('Eins')).toHaveLength(1);
  });

  it('does not leave a ghost message when the request is refused, and gives the text back', async () => {
    stubChat({ [STREAM]: () => problem(429, 'Too Many Requests') });
    const user = userEvent.setup();
    await openChat();

    await ask(user, 'Neue Frage');

    expect(
      await screen.findByText(
        'Es laufen schon zu viele Antworten gleichzeitig. Bitte warte einen Moment.'
      )
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
      await screen.findByText(
        /Die Antwort ist fehlgeschlagen und wird dem Modell nicht mitgeschickt\./
      )
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

    expect(
      await screen.findByText('Die Antwort wurde abgebrochen.', undefined, { timeout: 3000 })
    ).toBeInTheDocument();
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
    expect(
      await screen.findByText('Die Antwort wurde abgebrochen.', undefined, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', DETAIL_PATH).length).toBeGreaterThan(loadsBefore);
  });

  it('sends the first message a new chat handed over, once, and clears the router state', async () => {
    detail = chatDetailDto({ id: CHAT_ID, modelId: LLAMA.id, title: 'Neuer Chat' });
    const fetchMock = stubChat({
      [STREAM]: () =>
        sseResponse(answerChunks('Antwort', { userMessageId: 'u1', assistantMessageId: 'a1' })),
    });

    const { router } = await openChat(firstMessageState('Erste Frage'));

    await waitFor(() => {
      expect(callsTo(fetchMock, 'POST', STREAM_PATH)).toHaveLength(1);
    });
    expect(bodyOfLast(fetchMock, 'POST', STREAM_PATH)).toEqual({
      parentId: null,
      text: 'Erste Frage',
    });
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
    await openChat();

    // Two clicks before React renders again (a fast double click): only the guard in the handler can stop the second.
    const button = screen.getByRole('button', { name: 'Neu erzeugen' });
    act(() => {
      button.click();
      button.click();
    });
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
    sse.send({
      type: 'start',
      messageId: 'local-b',
      messageMetadata: { userMessageId: 'u1', assistantMessageId: 'a1b' },
    });
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
    stubChat({
      [`POST ${DETAIL_PATH}/messages/a1/regenerate`]: () => problem(429, 'Too Many Requests'),
    });
    const user = userEvent.setup();
    await openChat();

    await user.click(screen.getByRole('button', { name: 'Neu erzeugen' }));

    expect(
      await screen.findByText(
        'Es laufen schon zu viele Antworten gleichzeitig. Bitte warte einen Moment.'
      )
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

    expect(bodyOfLast(fetchMock, 'POST', STREAM_PATH)).toEqual({
      parentId: null,
      text: 'Hallo, anders',
    });
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
    sse.send({
      type: 'start',
      messageId: 'local-c',
      messageMetadata: { userMessageId: 'u1e', assistantMessageId: 'a1e' },
    });
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

    // The guard against the double click is released once the new branch is shown.
    await user.click(screen.getByRole('button', { name: 'Nächste Version' }));
    await waitFor(() => {
      expect(callsTo(fetchMock, 'PATCH', DETAIL_PATH)).toHaveLength(2);
    });
    expect(bodyOfLast(fetchMock, 'PATCH', DETAIL_PATH)).toEqual({ activeMessageId: 'a1b' });
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

    expect(
      await screen.findByText('Das Modell dieses Chats ist gerade nicht verfügbar.')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Modell')).toHaveValue(LLAMA.id);
    expect(within(messageList()).getByText('Hallo')).toBeInTheDocument();
  });

  it('offers a retry when the model list fails to load, and keeps the chat readable', async () => {
    let failing = true;
    stubChat({
      'GET /api/models': () =>
        failing ? problem(500, 'Internal Server Error') : json(200, modelList([LLAMA, GPT])),
    });
    const user = userEvent.setup();
    await openChat();

    expect(await screen.findByText('Das Laden hat nicht geklappt.')).toBeInTheDocument();
    expect(screen.getByLabelText('Modell')).toHaveValue(LLAMA.id);
    expect(within(messageList()).getByText('Hallo')).toBeInTheDocument();

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('option', { name: 'gpt-x (Cloud)' })).toBeInTheDocument();
    expect(screen.queryByText('Das Laden hat nicht geklappt.')).not.toBeInTheDocument();
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
    detail = {
      ...afterExchange('x'),
      titleSource: ChatDetailDtoTitleSource.generated,
      title: 'Begrüßung',
    };
    sse.end();

    expect(await screen.findByRole('heading', { level: 1, name: 'Begrüßung' })).toBeInTheDocument();
  });
});
