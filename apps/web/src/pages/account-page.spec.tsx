import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiKeyDto } from '@/api/generated/model';
import { authConfig, sessionInfo, userDto } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { type Handler, json, noContent, problem, stubApi } from '@/test/stub-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CURRENT = 'old passphrase 1234';
const NEXT = 'brand new passphrase';

function apiKey(overrides: Partial<ApiKeyDto> = {}): ApiKeyDto {
  return {
    id: 'key-1',
    name: 'Skript',
    prefix: 'sk-1a2b3c4d',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

function stubAccount(handlers: Record<string, Handler> = {}, config = authConfig()) {
  return stubApi({
    'GET /api/auth/me': () =>
      json(200, sessionInfo(userDto({ name: 'Ben Beispiel', email: 'ben@example.com' }))),
    'GET /api/auth/config': () => json(200, config),
    'GET /api/auth/api-keys': () => json(200, []),
    ...handlers,
  });
}

function callsTo(fetchMock: ReturnType<typeof stubApi>, method: string, path: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => input === path && (init?.method ?? 'GET') === method
  );
}

async function openAccount() {
  renderApp('/settings/account');
  await screen.findByRole('heading', { name: 'Konto' });
}

async function fillPasswords(
  user: ReturnType<typeof userEvent.setup>,
  { current = CURRENT, next = NEXT, repeat = NEXT } = {}
) {
  // user.type refuses an empty string, and "field left empty" is one of the cases.
  const fields = [
    ['Aktuelles Passwort', current],
    ['Neues Passwort', next],
    ['Neues Passwort wiederholen', repeat],
  ] as const;
  for (const [label, value] of fields) {
    if (value !== '') await user.type(screen.getByLabelText(label), value);
  }
}

describe('AccountPage: profile and navigation', () => {
  it('shows who is signed in and is reachable from the navigation', async () => {
    stubAccount();
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { name: 'Willkommen' });

    await user.click(screen.getByRole('link', { name: 'Konto' }));

    expect(await screen.findByRole('heading', { name: 'Konto' })).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    expect(main.getByText('Ben Beispiel')).toBeInTheDocument();
    expect(main.getByText('ben@example.com')).toBeInTheDocument();
  });
});

describe('AccountPage: change password', () => {
  it('sends the passwords, empties the fields and confirms', async () => {
    let sent: unknown;
    stubAccount({
      'POST /api/auth/password': ({ body }) => {
        sent = body;
        return noContent();
      },
    });
    const user = userEvent.setup();
    await openAccount();
    await fillPasswords(user);

    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByText(/Dein Passwort ist geändert/)).toBeInTheDocument();
    expect(sent).toEqual({ currentPassword: CURRENT, newPassword: NEXT });
    expect(screen.getByLabelText('Aktuelles Passwort')).toHaveValue('');
    expect(screen.getByLabelText('Neues Passwort')).toHaveValue('');
  });

  it.each([
    ['a field is empty', { current: '' }, 'Bitte fülle alle Felder aus.'],
    [
      'the new password is too short',
      { next: 'short', repeat: 'short' },
      'Das Passwort braucht mindestens 12 Zeichen.',
    ],
    [
      'the new password is too long',
      { next: 'x'.repeat(129), repeat: 'x'.repeat(129) },
      'Das Passwort darf höchstens 128 Zeichen haben.',
    ],
    [
      'the repetition differs',
      { repeat: 'something else entirely' },
      'Die beiden neuen Passwörter sind nicht gleich.',
    ],
  ])('does not send anything when %s', async (_name, input, message) => {
    const fetchMock = stubAccount();
    const user = userEvent.setup();
    await openAccount();
    await fillPasswords(user, input);

    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/auth/password')).toHaveLength(0);
  });

  it('names both possible reasons when the server says 400, and keeps the typed values', async () => {
    stubAccount({ 'POST /api/auth/password': () => problem(400, 'Bad Request') });
    const user = userEvent.setup();
    await openAccount();
    await fillPasswords(user);

    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByText(/Das aktuelle Passwort stimmt nicht/)).toBeInTheDocument();
    expect(screen.getByLabelText('Neues Passwort')).toHaveValue(NEXT);
  });

  it('stays signed in after a failed change (a 400 is no lost session)', async () => {
    stubAccount({ 'POST /api/auth/password': () => problem(400, 'Bad Request') });
    const user = userEvent.setup();
    await openAccount();
    await fillPasswords(user);

    await user.click(screen.getByRole('button', { name: 'Passwort ändern' }));
    await screen.findByText(/Das aktuelle Passwort stimmt nicht/);

    expect(screen.getByRole('heading', { name: 'Konto' })).toBeInTheDocument();
  });

  it('sends one request on a double click and locks the button meanwhile', async () => {
    const fetchMock = stubAccount({
      'POST /api/auth/password': () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    await openAccount();
    await fillPasswords(user);

    await user.dblClick(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(await screen.findByRole('button', { name: 'Wird geändert …' })).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', '/api/auth/password')).toHaveLength(1);
  });
});

describe('AccountPage: api keys', () => {
  it('shows a loading state while the keys are fetched', async () => {
    const fetchMock = stubAccount({
      'GET /api/auth/api-keys': () => new Promise<Response>(() => undefined),
    });

    await openAccount();

    // The settings load first (their own loading state); wait until the key list itself is what loads.
    await waitFor(() => {
      expect(callsTo(fetchMock, 'GET', '/api/auth/api-keys')).toHaveLength(1);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the empty state with the create button', async () => {
    stubAccount();

    await openAccount();

    expect(await screen.findByText('Du hast noch keine API-Schlüssel.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neuen Schlüssel erstellen' })).toBeEnabled();
  });

  it('lists the keys with their dates and "never" for what did not happen', async () => {
    stubAccount({
      'GET /api/auth/api-keys': () =>
        json(200, [
          apiKey(),
          apiKey({
            id: 'key-2',
            name: 'Cron',
            prefix: 'sk-ffeeddcc',
            expiresAt: '2027-01-01T00:00:00.000Z',
            lastUsedAt: '2026-10-05T10:00:00.000Z',
          }),
        ]),
    });

    await openAccount();

    const skript = await screen.findByRole('row', { name: /Skript/ });
    expect(within(skript).getByText('sk-1a2b3c4d')).toBeInTheDocument();
    expect(within(skript).getByText('Nie benutzt')).toBeInTheDocument();
    expect(within(skript).getByText('Läuft nie ab')).toBeInTheDocument();
    const cron = screen.getByRole('row', { name: /Cron/ });
    expect(within(cron).queryByText('Nie benutzt')).not.toBeInTheDocument();
    expect(within(cron).queryByText('Läuft nie ab')).not.toBeInTheDocument();
  });

  it('shows an error with a retry button and recovers', async () => {
    let healthy = false;
    stubAccount({
      'GET /api/auth/api-keys': () =>
        healthy ? json(200, [apiKey()]) : problem(500, 'Internal Server Error'),
    });
    const user = userEvent.setup();
    await openAccount();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('row', { name: /Skript/ })).toBeInTheDocument();
  });

  it('explains that keys are switched off and sends no request for them', async () => {
    const fetchMock = stubAccount({}, authConfig({ apiKeysEnabled: false }));

    await openAccount();

    expect(
      await screen.findByText('API-Schlüssel sind auf diesem Server ausgeschaltet.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Neuen Schlüssel erstellen' })
    ).not.toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', '/api/auth/api-keys')).toHaveLength(0);
  });

  it('creates a key, shows it once with a warning, and the page forgets it on close', async () => {
    const SECRET = `sk-${'ab'.repeat(32)}`;
    let created = false;
    let sent: unknown;
    stubAccount({
      'GET /api/auth/api-keys': () => json(200, created ? [apiKey({ name: 'Neu' })] : []),
      'POST /api/auth/api-keys': ({ body }) => {
        created = true;
        sent = body;
        return json(201, { ...apiKey({ name: 'Neu' }), key: SECRET });
      },
    });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Neuen Schlüssel erstellen' }));
    const form = await screen.findByRole('dialog', { name: 'Neuen Schlüssel erstellen' });
    await user.type(within(form).getByLabelText('Name'), '  Neu  ');
    await user.selectOptions(within(form).getByLabelText('Laufzeit'), '30');

    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));

    const shown = await screen.findByRole('dialog', { name: 'Dein neuer Schlüssel' });
    expect(within(shown).getByText(SECRET)).toBeInTheDocument();
    expect(within(shown).getByText(/nur jetzt/)).toBeInTheDocument();
    expect(sent).toEqual({ name: '  Neu  ', expiresInDays: 30 });

    await user.click(within(shown).getByRole('button', { name: 'Schließen' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(SECRET);
    expect(await screen.findByRole('row', { name: /Neu/ })).toBeInTheDocument();
  });

  it('sends no expiry when the key should not expire, and refuses an empty name', async () => {
    let sent: unknown;
    const fetchMock = stubAccount({
      'POST /api/auth/api-keys': ({ body }) => {
        sent = body;
        return json(201, { ...apiKey({ name: 'Dauer' }), key: `sk-${'cd'.repeat(32)}` });
      },
    });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Neuen Schlüssel erstellen' }));
    const form = await screen.findByRole('dialog', { name: 'Neuen Schlüssel erstellen' });

    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));
    expect(await within(form).findByText('Bitte gib einen Namen ein.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/auth/api-keys')).toHaveLength(0);

    await user.type(within(form).getByLabelText('Name'), 'Dauer');
    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));

    await screen.findByRole('dialog', { name: 'Dein neuer Schlüssel' });
    expect(sent).toEqual({ name: 'Dauer' });
  });

  it('sends one request on a double click while creating', async () => {
    const fetchMock = stubAccount({
      'POST /api/auth/api-keys': () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Neuen Schlüssel erstellen' }));
    const form = await screen.findByRole('dialog', { name: 'Neuen Schlüssel erstellen' });
    await user.type(within(form).getByLabelText('Name'), 'Doppelt');

    await user.dblClick(within(form).getByRole('button', { name: 'Erstellen' }));

    expect(await within(form).findByRole('button', { name: 'Wird erstellt …' })).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', '/api/auth/api-keys')).toHaveLength(1);
  });

  it('says so in the dialog when creating fails, and keeps the dialog open', async () => {
    stubAccount({ 'POST /api/auth/api-keys': () => problem(500, 'Internal Server Error') });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Neuen Schlüssel erstellen' }));
    const form = await screen.findByRole('dialog', { name: 'Neuen Schlüssel erstellen' });
    await user.type(within(form).getByLabelText('Name'), 'Kaputt');

    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));

    expect(
      await within(form).findByText('Das hat nicht geklappt. Bitte versuche es erneut.')
    ).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Erstellen' })).toBeEnabled();
  });

  it('copies the key and tells when copying is not possible', async () => {
    const SECRET = `sk-${'ef'.repeat(32)}`;
    stubAccount({
      'POST /api/auth/api-keys': () => json(201, { ...apiKey({ name: 'Kopie' }), key: SECRET }),
    });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Neuen Schlüssel erstellen' }));
    const form = await screen.findByRole('dialog', { name: 'Neuen Schlüssel erstellen' });
    await user.type(within(form).getByLabelText('Name'), 'Kopie');
    await user.click(within(form).getByRole('button', { name: 'Erstellen' }));
    const shown = await screen.findByRole('dialog', { name: 'Dein neuer Schlüssel' });

    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await user.click(within(shown).getByRole('button', { name: 'Kopieren' }));
    expect(await within(shown).findByText('Kopiert.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(SECRET);

    await user.click(within(shown).getByRole('button', { name: 'Kopieren' }));
    expect(await within(shown).findByText(/Kopieren ist nicht möglich/)).toBeInTheDocument();
  });

  it('revokes a key after a confirmation, once, and refreshes the list', async () => {
    let revoked = false;
    const fetchMock = stubAccount({
      'GET /api/auth/api-keys': () => json(200, revoked ? [] : [apiKey()]),
      'DELETE /api/auth/api-keys/key-1': () => {
        revoked = true;
        return noContent();
      },
    });
    const user = userEvent.setup();
    await openAccount();

    await user.click(await screen.findByRole('button', { name: 'Skript widerrufen' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(callsTo(fetchMock, 'DELETE', '/api/auth/api-keys/key-1')).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Widerrufen' }));

    expect(await screen.findByText('Du hast noch keine API-Schlüssel.')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'DELETE', '/api/auth/api-keys/key-1')).toHaveLength(1);
  });

  it('keeps the key and says so when revoking fails; cancelling sends nothing', async () => {
    const fetchMock = stubAccount({
      'GET /api/auth/api-keys': () => json(200, [apiKey()]),
      'DELETE /api/auth/api-keys/key-1': () => problem(500, 'Internal Server Error'),
    });
    const user = userEvent.setup();
    await openAccount();
    await user.click(await screen.findByRole('button', { name: 'Skript widerrufen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' })
    );
    expect(callsTo(fetchMock, 'DELETE', '/api/auth/api-keys/key-1')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Skript widerrufen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Widerrufen' })
    );

    expect(
      await screen.findByText('Das hat nicht geklappt. Bitte versuche es erneut.')
    ).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Skript/ })).toBeInTheDocument();
  });

  it('renders a key name that looks like HTML as plain text', async () => {
    stubAccount({
      'GET /api/auth/api-keys': () => json(200, [apiKey({ name: '<img src=x onerror=alert(1)>' })]),
    });

    await openAccount();

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
