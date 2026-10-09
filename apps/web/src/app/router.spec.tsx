import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserDtoRole } from '@/api/generated/model';
import { authConfig, sessionInfo, userDto } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { json, noContent, problem, stubApi } from '@/test/stub-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubSignedIn(user = userDto({ name: 'Ben Beispiel' })) {
  return stubApi({
    'GET /api/auth/me': () => json(200, sessionInfo(user)),
    'GET /api/health/ready': () => json(200, { status: 'ok' }),
  });
}

describe('app routing and layout', () => {
  it('renders the home page inside a main landmark with navigation and theme toggle', async () => {
    stubSignedIn();

    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Willkommen' })
    );
    expect(screen.getByRole('link', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Darstellung wechseln/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute(
      'href',
      '#content'
    );
  });

  it('answers an unknown address with a friendly page and a way back', async () => {
    stubSignedIn();

    renderApp('/gibt-es-nicht');

    expect(
      await screen.findByRole('heading', { name: 'Seite nicht gefunden' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Startseite' })).toHaveAttribute('href', '/');
  });

  it('announces the mobile sidebar in German instead of the generated English text', async () => {
    stubSignedIn();
    vi.stubGlobal('innerWidth', 375);
    const user = userEvent.setup();
    renderApp('/');

    await user.click(
      await screen.findByRole('button', { name: 'Seitenleiste ein- oder ausblenden' })
    );

    expect(await screen.findByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
  });

  it('sends an anonymous visitor to sign-in and, after signing in, back to the wanted address', async () => {
    let signedIn = false;
    stubApi({
      'GET /api/auth/me': () =>
        signedIn ? json(200, sessionInfo(userDto())) : problem(401, 'Unauthorized'),
      'GET /api/auth/config': () => json(200, authConfig()),
      'POST /api/auth/login': () => {
        signedIn = true;
        return json(200, sessionInfo(userDto()));
      },
    });
    const user = userEvent.setup();
    renderApp('/gibt-es-nicht');

    await screen.findByRole('heading', { name: 'Anmelden' });
    await user.type(screen.getByLabelText('E-Mail-Adresse'), 'ben@example.com');
    await user.type(screen.getByLabelText('Passwort'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Anmelden' }));

    expect(
      await screen.findByRole('heading', { name: 'Seite nicht gefunden' })
    ).toBeInTheDocument();
  });

  it('keeps a waiting account on the waiting screen, whatever address it types', async () => {
    stubSignedIn(userDto({ role: UserDtoRole.pending, name: 'Pia' }));

    renderApp('/');

    expect(
      await screen.findByRole('heading', { name: 'Dein Konto wartet auf Freischaltung' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start' })).not.toBeInTheDocument();
  });

  it('lets a waiting account check its status and moves on once it was approved', async () => {
    let role: string = UserDtoRole.pending;
    stubApi({
      'GET /api/auth/me': () =>
        json(200, sessionInfo(userDto({ role: role as typeof UserDtoRole.user, name: 'Pia' }))),
      'GET /api/health/ready': () => json(200, { status: 'ok' }),
    });
    const user = userEvent.setup();
    renderApp('/pending');
    await screen.findByRole('heading', { name: 'Dein Konto wartet auf Freischaltung' });

    role = UserDtoRole.user;
    await user.click(screen.getByRole('button', { name: 'Status prüfen' }));

    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
  });

  it('shows the signed-in name and signs out: cache gone, back on the sign-in page', async () => {
    let signedIn = true;
    const fetchMock = stubApi({
      'GET /api/auth/me': () =>
        signedIn
          ? json(200, sessionInfo(userDto({ name: 'Ben Beispiel' })))
          : problem(401, 'Unauthorized'),
      'GET /api/auth/config': () => json(200, authConfig()),
      'GET /api/health/ready': () => json(200, { status: 'ok' }),
      'POST /api/auth/logout': () => {
        signedIn = false;
        return noContent();
      },
    });
    const user = userEvent.setup();
    const { queryClient } = renderApp('/');
    expect(await screen.findByText('Ben Beispiel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abmelden' }));

    expect(await screen.findByRole('heading', { name: 'Anmelden' })).toBeInTheDocument();
    expect(queryClient.getQueryCache().findAll({ queryKey: ['/api/health/ready'] })).toHaveLength(
      0
    );
    const logoutCalls = fetchMock.mock.calls.filter(([input]) => input === '/api/auth/logout');
    expect(logoutCalls).toHaveLength(1);
  });

  it('keeps the user in place and says so when signing out fails', async () => {
    stubApi({
      'GET /api/auth/me': () => json(200, sessionInfo(userDto())),
      'GET /api/health/ready': () => json(200, { status: 'ok' }),
      'POST /api/auth/logout': () => problem(500, 'Internal Server Error'),
    });
    const user = userEvent.setup();
    renderApp('/');
    await screen.findByRole('heading', { name: 'Willkommen' });

    await user.click(screen.getByRole('button', { name: 'Abmelden' }));

    expect(
      await screen.findByText('Das hat nicht geklappt. Bitte versuche es erneut.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeEnabled();
  });
});
