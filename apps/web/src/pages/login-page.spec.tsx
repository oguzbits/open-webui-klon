import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAuthMeQueryKey } from '@/api/generated/api';
import { authConfig, sessionInfo, userDto } from '@/test/fixtures';
import { renderPage } from '@/test/render-app';
import { type Handler, json, problem, stubApi } from '@/test/stub-api';

import { LoginPage } from './login-page';

const ADA = userDto({ id: 'u-ada', name: 'Ada', email: 'ada@example.com' });
const PASSWORD = 'correct horse battery';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubAuth(handlers: Record<string, Handler> = {}, config = authConfig()) {
  return stubApi({ 'GET /api/auth/config': () => json(200, config), ...handlers });
}

function postsTo(fetchMock: ReturnType<typeof stubApi>, path: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => input === path && (init?.method ?? 'GET') === 'POST'
  );
}

async function fillLogin(user: ReturnType<typeof userEvent.setup>, password = PASSWORD) {
  await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ada@example.com');
  await user.type(screen.getByLabelText('Passwort'), password);
}

describe('LoginPage: sign in', () => {
  it('shows a loading state, then the form', async () => {
    stubAuth();

    renderPage(<LoginPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
    expect(screen.getByLabelText('E-Mail-Adresse')).toBeInTheDocument();
  });

  it('signs in with what was typed and replaces the cache with the new session', async () => {
    let sent: unknown;
    stubAuth({
      'POST /api/auth/login': ({ body }) => {
        sent = body;
        return json(200, sessionInfo(ADA));
      },
    });
    const user = userEvent.setup();
    const { queryClient } = renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });
    queryClient.setQueryData(['/api/users'], { data: [userDto({ id: 'previous-users-data' })] });
    await fillLogin(user);

    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    await waitFor(() => {
      expect(queryClient.getQueryData(getAuthMeQueryKey())).toMatchObject({
        data: { user: { id: 'u-ada' } },
      });
    });
    expect(sent).toEqual({ email: 'ada@example.com', password: PASSWORD });
    expect(queryClient.getQueryData(['/api/users'])).toBeUndefined();
  });

  it('explains a wrong password and lets the user try again with the email still filled', async () => {
    stubAuth({ 'POST /api/auth/login': () => problem(401, 'Unauthorized') });
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });
    await fillLogin(user, 'wrong password!');

    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-Mail-Adresse oder Passwort stimmt nicht.'
    );
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeEnabled();
    expect(screen.getByLabelText('E-Mail-Adresse')).toHaveValue('ada@example.com');
  });

  it('asks for both fields and sends nothing when one is empty', async () => {
    const fetchMock = stubAuth();
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ada@example.com');

    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Bitte fülle alle Felder aus.');
    expect(postsTo(fetchMock, '/api/auth/login')).toHaveLength(0);
  });

  it('sends one request on a double click and locks the button meanwhile', async () => {
    const fetchMock = stubAuth({
      'POST /api/auth/login': () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });
    await fillLogin(user);

    await user.dblClick(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('button', { name: 'Anmeldung läuft …' })).toBeDisabled();
    expect(postsTo(fetchMock, '/api/auth/login')).toHaveLength(1);
  });

  it.each([
    [
      'too many attempts',
      () => problem(429, 'Too Many Requests'),
      'Zu viele Versuche. Bitte warte einen Moment.',
    ],
    ['invalid input', () => problem(400, 'Bad Request'), 'Bitte prüfe deine Eingaben.'],
    [
      'a server error',
      () => problem(500, 'Internal Server Error'),
      'Das hat nicht geklappt. Bitte versuche es erneut.',
    ],
    [
      'an unreachable server',
      () => {
        throw new TypeError('Failed to fetch');
      },
      'Der Server ist gerade nicht erreichbar.',
    ],
  ])('says what happened after %s', async (_name, handler, message) => {
    stubAuth({ 'POST /api/auth/login': handler });
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });
    await fillLogin(user);

    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Anmelden' })).toBeEnabled();
  });

  it('shows an error with a retry button when the page settings cannot be loaded, and recovers', async () => {
    let healthy = false;
    stubApi({
      'GET /api/auth/config': () =>
        healthy ? json(200, authConfig()) : problem(503, 'Unavailable'),
    });
    const user = userEvent.setup();
    renderPage(<LoginPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
  });
});

describe('LoginPage: sign up', () => {
  it('offers registration only when the server allows it', async () => {
    stubAuth({}, authConfig({ signupEnabled: false }));
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });

    expect(screen.queryByRole('button', { name: /Registrieren/ })).not.toBeInTheDocument();
  });

  it('switches between the two forms', async () => {
    stubAuth();
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Anmelden' });

    await user.click(screen.getByRole('button', { name: /Registrieren/ }));
    expect(screen.getByRole('heading', { name: 'Konto erstellen' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Anmelden/ }));
    expect(screen.getByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
  });

  it('starts with registration and explains the admin role while no account exists', async () => {
    stubAuth({}, authConfig({ onboarding: true }));
    renderPage(<LoginPage />);

    expect(await screen.findByRole('heading', { name: 'Konto erstellen' })).toBeInTheDocument();
    expect(
      screen.getByText('Es gibt noch kein Konto. Das erste Konto wird Administrator.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Anmelden/ })).not.toBeInTheDocument();
  });

  it('creates the account with the three fields and stores the session', async () => {
    let sent: unknown;
    stubAuth(
      {
        'POST /api/auth/signup': ({ body }) => {
          sent = body;
          return json(201, sessionInfo(ADA));
        },
      },
      authConfig({ onboarding: true })
    );
    const user = userEvent.setup();
    const { queryClient } = renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Konto erstellen' });
    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ada@example.com');
    await user.type(screen.getByLabelText('Passwort'), PASSWORD);

    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    await waitFor(() => {
      expect(queryClient.getQueryData(getAuthMeQueryKey())).toMatchObject({
        data: { user: { id: 'u-ada' } },
      });
    });
    expect(sent).toEqual({ email: 'ada@example.com', name: 'Ada', password: PASSWORD });
  });

  it.each([
    [409, 'Diese E-Mail-Adresse ist schon registriert.'],
    [403, 'Die Registrierung ist ausgeschaltet.'],
    [400, 'Bitte prüfe deine Eingaben.'],
    [429, 'Zu viele Versuche. Bitte warte einen Moment.'],
  ])('explains a %i answer', async (status, message) => {
    stubAuth(
      { 'POST /api/auth/signup': () => problem(status, 'x') },
      authConfig({ onboarding: true })
    );
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Konto erstellen' });
    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ada@example.com');
    await user.type(screen.getByLabelText('Passwort'), PASSWORD);

    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Konto erstellen' })).toBeEnabled();
  });

  it.each([
    ['11 characters', 'x'.repeat(11), 'Das Passwort braucht mindestens 12 Zeichen.'],
    ['129 characters', 'x'.repeat(129), 'Das Passwort darf höchstens 128 Zeichen haben.'],
  ])('rejects a password of %s without asking the server', async (_name, password, message) => {
    const fetchMock = stubAuth({}, authConfig({ onboarding: true }));
    const user = userEvent.setup();
    renderPage(<LoginPage />);
    await screen.findByRole('heading', { name: 'Konto erstellen' });
    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ada@example.com');
    await user.click(screen.getByLabelText('Passwort'));
    await user.paste(password);

    await user.click(screen.getByRole('button', { name: 'Konto erstellen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(postsTo(fetchMock, '/api/auth/signup')).toHaveLength(0);
  });
});
