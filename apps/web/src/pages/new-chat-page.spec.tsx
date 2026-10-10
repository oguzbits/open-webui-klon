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
        return sseResponse(
          answerChunks('Erste Antwort', { userMessageId: 'u1', assistantMessageId: 'a1' })
        );
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

  it('blames the instruction, not the message, when the server refuses the new chat with 422', async () => {
    stubMember({ 'POST /api/chats': () => problem(422, 'Unprocessable Entity') });
    const user = userEvent.setup();
    await openNewChat();

    await user.type(screen.getByLabelText('Nachricht'), 'Hallo{Enter}');

    expect(await screen.findByText('Die Anweisung ist zu lang.')).toBeInTheDocument();
    expect(screen.queryByText('Die Nachricht ist zu lang.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nachricht')).toHaveValue('Hallo');
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
    expect(screen.getByLabelText('Modell')).toBeDisabled();
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
    expect(screen.getByRole('link', { name: 'Zu den Modellen' })).toHaveAttribute(
      'href',
      '/models'
    );
    expect(screen.queryByLabelText('Nachricht')).not.toBeInTheDocument();
  });

  it('says that no model is reachable when the providers did not answer', async () => {
    stubMember({
      'GET /api/models': () =>
        json(
          200,
          modelList(
            [],
            [{ id: 'c-local', name: 'Lokal', reason: UnavailableConnectionDtoReason.unreachable }]
          )
        ),
    });

    await openNewChat();

    expect(await screen.findByText('Im Moment ist kein Modell erreichbar.')).toBeInTheDocument();
  });

  it('shows a retry when the models cannot be loaded', async () => {
    const user = userEvent.setup();
    // stubApi reads this object live, so the swap below reaches the next request (stubMember would copy it).
    const handlers: Record<string, Handler> = {
      'GET /api/auth/me': () => json(200, sessionInfo(BEN)),
      'GET /api/models': () => problem(500, 'Internal Server Error'),
    };
    stubApi(handlers);
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

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Neuer Chat' })
    ).toBeInTheDocument();
  });
});
