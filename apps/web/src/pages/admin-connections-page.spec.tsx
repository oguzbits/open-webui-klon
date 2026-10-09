import { type BoundFunctions, type queries, screen, waitFor, within } from '@testing-library/react';
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
  ])(
    'shows a clear sentence for %i and keeps the dialog and the typed values',
    async (status, text) => {
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
    }
  );

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
      dialog.getByText(
        'Ein Schlüssel ist hinterlegt. Er wird aus Sicherheitsgründen nicht angezeigt.'
      )
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
      dialog.getByText(
        'Ein Schlüssel ist hinterlegt. Er wird aus Sicherheitsgründen nicht angezeigt.'
      )
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
