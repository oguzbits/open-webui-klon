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

    expect(await screen.findByRole('alert')).toHaveTextContent('Nicht alle Anbieter antworten');
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
        return calls === 1 ? json(200, modelList([LLAMA])) : new Promise<Response>(() => undefined);
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
