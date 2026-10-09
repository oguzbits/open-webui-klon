import { type BoundFunctions, type queries, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserDtoRole } from '@/api/generated/model';
import { sessionInfo, userDto } from '@/test/fixtures';
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
const BEN = userDto({ id: 'u-ben', name: 'Ben Beispiel', email: 'ben@example.com' });
const PIA = userDto({
  id: 'u-pia',
  name: 'Pia Wartend',
  email: 'pia@example.com',
  role: UserDtoRole.pending,
});
const LAST_ADMIN_MESSAGE = 'Es muss mindestens ein aktiver Administrator bleiben.';
const GENERIC_MESSAGE = 'Das hat nicht geklappt. Bitte versuche es erneut.';

function stubAdmin(handlers: Record<string, Handler> = {}) {
  return stubApi({
    'GET /api/auth/me': () => json(200, sessionInfo(ADMIN)),
    'GET /api/users': () => json(200, [ADMIN, BEN, PIA]),
    ...handlers,
  });
}

async function openUsers() {
  renderApp('/admin/users');
  await screen.findByRole('heading', { name: 'Nutzerverwaltung' });
}

function rowOf(name: string) {
  return screen.findByRole('row', { name: new RegExp(name) });
}

describe('AdminUsersPage: access', () => {
  it('sends an ordinary user to the start page without asking for the list', async () => {
    const fetchMock = stubApi({
      'GET /api/auth/me': () => json(200, sessionInfo(BEN)),
      'GET /api/users': () => json(200, []),
    });

    renderApp('/admin/users');

    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Nutzer' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, 'GET', '/api/users')).toHaveLength(0);
  });

  it('shows the navigation link to admins, and it leads to the page', async () => {
    stubAdmin();
    const user = userEvent.setup();
    renderApp('/');

    await user.click(await screen.findByRole('link', { name: 'Nutzer' }));

    expect(await screen.findByRole('heading', { name: 'Nutzerverwaltung' })).toBeInTheDocument();
  });
});

describe('AdminUsersPage: list', () => {
  it('shows a loading state while the list is fetched', async () => {
    stubAdmin({ 'GET /api/users': () => new Promise<Response>(() => undefined) });

    await openUsers();

    expect(await screen.findByRole('status')).toBeInTheDocument();
  });

  it('shows an error with a retry button and recovers', async () => {
    let healthy = false;
    stubAdmin({
      'GET /api/users': () =>
        healthy ? json(200, [ADMIN, BEN]) : problem(500, 'Internal Server Error'),
    });
    const user = userEvent.setup();
    await openUsers();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(within(alert).getByRole('button', { name: 'Erneut versuchen' }));

    expect(await rowOf('Ben Beispiel')).toBeInTheDocument();
  });

  it('shows role and status of every account, and marks the own row without actions', async () => {
    stubAdmin({
      'GET /api/users': () =>
        json(200, [
          ADMIN,
          BEN,
          PIA,
          userDto({ id: 'u-gus', name: 'Gus Gesperrt', disabled: true }),
        ]),
    });
    await openUsers();

    const ben = within(await rowOf('Ben Beispiel'));
    expect(ben.getByText('Aktiv')).toBeInTheDocument();
    expect(ben.getByLabelText('Rolle von Ben Beispiel')).toHaveValue('user');
    expect(
      within(await rowOf('Pia Wartend')).getByText('Wartet auf Freischaltung')
    ).toBeInTheDocument();
    expect(within(await rowOf('Gus Gesperrt')).getByText('Gesperrt')).toBeInTheDocument();
    const own = within(await rowOf('Rita Root'));
    expect(own.getByText('Das bist du.')).toBeInTheDocument();
    expect(own.queryAllByRole('button')).toHaveLength(0);
    expect(own.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders a name that looks like HTML as plain text', async () => {
    stubAdmin({
      'GET /api/users': () =>
        json(200, [
          ADMIN,
          userDto({ id: 'u-x', name: '<img src=x onerror=alert(1)>', email: 'x@example.com' }),
        ]),
    });

    await openUsers();

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('AdminUsersPage: change an account', () => {
  it('approves a waiting account with one click and refreshes the list', async () => {
    let users = [ADMIN, BEN, PIA];
    let sent: unknown;
    stubAdmin({
      'GET /api/users': () => json(200, users),
      'PATCH /api/users/u-pia': ({ body }) => {
        sent = body;
        const approved = { ...PIA, role: UserDtoRole.user };
        users = [ADMIN, BEN, approved];
        return json(200, approved);
      },
    });
    const user = userEvent.setup();
    await openUsers();

    await user.click(await screen.findByRole('button', { name: 'Pia Wartend freischalten' }));

    await waitFor(async () => {
      expect(within(await rowOf('Pia Wartend')).getByText('Aktiv')).toBeInTheDocument();
    });
    expect(sent).toEqual({ role: 'user' });
    expect(
      screen.queryByRole('button', { name: 'Pia Wartend freischalten' })
    ).not.toBeInTheDocument();
  });

  it('sends one request on a double click and locks all row actions meanwhile', async () => {
    const fetchMock = stubAdmin({
      'PATCH /api/users/u-pia': () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    await openUsers();

    await user.dblClick(await screen.findByRole('button', { name: 'Pia Wartend freischalten' }));

    expect(callsTo(fetchMock, 'PATCH', '/api/users/u-pia')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Ben Beispiel sperren' })).toBeDisabled();
    expect(screen.getByLabelText('Rolle von Ben Beispiel')).toBeDisabled();
  });

  it('changes the role from the selection', async () => {
    let sent: unknown;
    stubAdmin({
      'PATCH /api/users/u-ben': ({ body }) => {
        sent = body;
        return json(200, { ...BEN, role: UserDtoRole.admin });
      },
    });
    const user = userEvent.setup();
    await openUsers();

    await user.selectOptions(await screen.findByLabelText('Rolle von Ben Beispiel'), 'admin');

    await waitFor(() => {
      expect(sent).toEqual({ role: 'admin' });
    });
  });

  it('disables and enables an account', async () => {
    const bodies: unknown[] = [];
    let ben = BEN;
    stubAdmin({
      'GET /api/users': () => json(200, [ADMIN, ben]),
      'PATCH /api/users/u-ben': ({ body }) => {
        bodies.push(body);
        ben = { ...ben, disabled: !ben.disabled };
        return json(200, ben);
      },
    });
    const user = userEvent.setup();
    await openUsers();

    await user.click(await screen.findByRole('button', { name: 'Ben Beispiel sperren' }));
    await user.click(await screen.findByRole('button', { name: 'Ben Beispiel entsperren' }));

    await screen.findByRole('button', { name: 'Ben Beispiel sperren' });
    expect(bodies).toEqual([{ disabled: true }, { disabled: false }]);
  });

  it('turns the 409 of the server into a clear sentence and keeps the list', async () => {
    stubAdmin({ 'PATCH /api/users/u-ben': () => problem(409, 'Conflict') });
    const user = userEvent.setup();
    await openUsers();

    await user.click(await screen.findByRole('button', { name: 'Ben Beispiel sperren' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(LAST_ADMIN_MESSAGE);
    expect(await rowOf('Ben Beispiel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ben Beispiel sperren' })).toBeEnabled();
  });
});

describe('AdminUsersPage: create an account', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Nutzer anlegen' }));
    return within(await screen.findByRole('dialog', { name: 'Nutzer anlegen' }));
  }

  async function fillCreate(
    dialog: BoundFunctions<typeof queries>,
    user: ReturnType<typeof userEvent.setup>,
    input: { name?: string; email?: string; password?: string } = {}
  ) {
    const {
      name = 'Neo Neu',
      email = 'neo@example.com',
      password = 'a long start passphrase',
    } = input;
    // user.type refuses an empty string, and "field left empty" is one of the cases.
    if (name !== '') await user.type(dialog.getByLabelText('Name'), name);
    await user.type(dialog.getByLabelText('E-Mail-Adresse'), email);
    await user.type(dialog.getByLabelText('Passwort'), password);
  }

  it('creates an account with the chosen role, closes the dialog and shows the new row', async () => {
    let users = [ADMIN, BEN];
    let sent: unknown;
    stubAdmin({
      'GET /api/users': () => json(200, users),
      'POST /api/users': ({ body }) => {
        sent = body;
        const created = userDto({
          id: 'u-neo',
          name: 'Neo Neu',
          email: 'neo@example.com',
          role: UserDtoRole.admin,
        });
        users = [ADMIN, BEN, created];
        return json(201, created);
      },
    });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user);
    await user.selectOptions(dialog.getByLabelText('Rolle'), 'admin');

    await user.click(dialog.getByRole('button', { name: 'Anlegen' }));

    expect(await rowOf('Neo Neu')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(sent).toEqual({
      name: 'Neo Neu',
      email: 'neo@example.com',
      password: 'a long start passphrase',
      role: 'admin',
    });
  });

  it.each([
    ['a field is empty', { name: '' }, 'Bitte fülle alle Felder aus.'],
    [
      'the password is too short',
      { password: 'short' },
      'Das Passwort braucht mindestens 12 Zeichen.',
    ],
    [
      'the password is too long',
      { password: 'x'.repeat(129) },
      'Das Passwort darf höchstens 128 Zeichen haben.',
    ],
  ])('sends nothing when %s', async (_name, input, message) => {
    const fetchMock = stubAdmin();
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user, input);

    await user.click(dialog.getByRole('button', { name: 'Anlegen' }));

    expect(await dialog.findByText(message)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/users')).toHaveLength(0);
  });

  it('says so in the dialog when the email is taken, and keeps the dialog open', async () => {
    stubAdmin({ 'POST /api/users': () => problem(409, 'Conflict') });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user);

    await user.click(dialog.getByRole('button', { name: 'Anlegen' }));

    expect(
      await dialog.findByText('Diese E-Mail-Adresse ist schon registriert.')
    ).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Anlegen' })).toBeEnabled();
  });

  it('sends one request on a double click', async () => {
    const fetchMock = stubAdmin({
      'POST /api/users': () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openCreate(user);
    await fillCreate(dialog, user);

    await user.dblClick(dialog.getByRole('button', { name: 'Anlegen' }));

    expect(await dialog.findByRole('button', { name: 'Wird angelegt …' })).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', '/api/users')).toHaveLength(1);
  });

  it('starts empty every time it is opened', async () => {
    stubAdmin();
    const user = userEvent.setup();
    await openUsers();
    let dialog = await openCreate(user);
    await user.type(dialog.getByLabelText('Name'), 'Halb fertig');
    await user.click(dialog.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    dialog = await openCreate(user);

    expect(dialog.getByLabelText('Name')).toHaveValue('');
  });
});

describe('AdminUsersPage: set a password', () => {
  async function openPassword(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      await screen.findByRole('button', { name: 'Passwort für Ben Beispiel setzen' })
    );
    return within(await screen.findByRole('dialog', { name: 'Passwort für Ben Beispiel setzen' }));
  }

  it('sets the password and closes the dialog', async () => {
    let sent: unknown;
    stubAdmin({
      'POST /api/users/u-ben/password': ({ body }) => {
        sent = body;
        return noContent();
      },
    });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openPassword(user);
    await user.type(dialog.getByLabelText('Neues Passwort'), 'a fresh long passphrase');

    await user.click(dialog.getByRole('button', { name: 'Passwort setzen' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(sent).toEqual({ password: 'a fresh long passphrase' });
  });

  it.each([
    ['empty', '', 'Bitte fülle alle Felder aus.'],
    ['too short', 'short', 'Das Passwort braucht mindestens 12 Zeichen.'],
    ['too long', 'x'.repeat(129), 'Das Passwort darf höchstens 128 Zeichen haben.'],
  ])('sends nothing when the password is %s', async (_name, password, message) => {
    const fetchMock = stubAdmin();
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openPassword(user);
    if (password !== '') await user.type(dialog.getByLabelText('Neues Passwort'), password);

    await user.click(dialog.getByRole('button', { name: 'Passwort setzen' }));

    expect(await dialog.findByText(message)).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/users/u-ben/password')).toHaveLength(0);
  });

  it('says so and stays open when the server fails', async () => {
    stubAdmin({ 'POST /api/users/u-ben/password': () => problem(500, 'Internal Server Error') });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openPassword(user);
    await user.type(dialog.getByLabelText('Neues Passwort'), 'a fresh long passphrase');

    await user.click(dialog.getByRole('button', { name: 'Passwort setzen' }));

    expect(await dialog.findByText(GENERIC_MESSAGE)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Passwort setzen' })).toBeEnabled();
  });

  it('sends one request on a double click and locks the button meanwhile', async () => {
    const fetchMock = stubAdmin({
      'POST /api/users/u-ben/password': () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    await openUsers();
    const dialog = await openPassword(user);
    await user.type(dialog.getByLabelText('Neues Passwort'), 'a fresh long passphrase');

    await user.dblClick(dialog.getByRole('button', { name: 'Passwort setzen' }));

    expect(await dialog.findByRole('button', { name: 'Wird gespeichert …' })).toBeDisabled();
    expect(callsTo(fetchMock, 'POST', '/api/users/u-ben/password')).toHaveLength(1);
  });
});

describe('AdminUsersPage: delete an account', () => {
  it('asks first; cancelling sends nothing; confirming deletes once and refreshes', async () => {
    let users = [ADMIN, BEN];
    const fetchMock = stubAdmin({
      'GET /api/users': () => json(200, users),
      'DELETE /api/users/u-ben': () => {
        users = [ADMIN];
        return noContent();
      },
    });
    const user = userEvent.setup();
    await openUsers();

    await user.click(await screen.findByRole('button', { name: 'Ben Beispiel löschen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Abbrechen' })
    );
    expect(callsTo(fetchMock, 'DELETE', '/api/users/u-ben')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Ben Beispiel löschen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' })
    );

    await waitFor(() => {
      expect(screen.queryByRole('row', { name: /Ben Beispiel/ })).not.toBeInTheDocument();
    });
    expect(callsTo(fetchMock, 'DELETE', '/api/users/u-ben')).toHaveLength(1);
  });

  it('keeps the account and explains why when the server refuses', async () => {
    stubAdmin({ 'DELETE /api/users/u-ben': () => problem(409, 'Conflict') });
    const user = userEvent.setup();
    await openUsers();
    await user.click(await screen.findByRole('button', { name: 'Ben Beispiel löschen' }));

    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(LAST_ADMIN_MESSAGE);
    expect(await rowOf('Ben Beispiel')).toBeInTheDocument();
  });
});
