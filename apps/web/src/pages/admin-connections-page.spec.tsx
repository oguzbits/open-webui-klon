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
      [`GET ${LIST}`]: () => (healthy ? json(200, [LOCAL]) : problem(500, 'Internal Server Error')),
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
