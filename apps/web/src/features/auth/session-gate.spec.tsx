import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from '@/api/fetcher';
import { getAuthMeQueryKey } from '@/api/generated/api';
import { UserDtoRole } from '@/api/generated/model';
import { AppProviders, createQueryClient } from '@/app/providers';
import { authConfig, sessionInfo, userDto } from '@/test/fixtures';
import { type Handler, json, problem, stubApi } from '@/test/stub-api';

import { type Gate, GATE, SessionGate } from './session-gate';

afterEach(() => {
  vi.unstubAllGlobals();
});

const WHO = {
  anonymous: () => problem(401, 'Unauthorized'),
  pending: () => json(200, sessionInfo(userDto({ role: UserDtoRole.pending }))),
  user: () => json(200, sessionInfo(userDto({ role: UserDtoRole.user }))),
  admin: () => json(200, sessionInfo(userDto({ role: UserDtoRole.admin }))),
} satisfies Record<string, Handler>;

function renderGate(allow: Gate, me: Handler) {
  stubApi({ 'GET /api/auth/me': me, 'GET /api/auth/config': () => json(200, authConfig()) });
  const queryClient = createQueryClient();
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Startseite</p> },
      { path: '/login', element: <p>Anmeldeseite</p> },
      { path: '/pending', element: <p>Wartebildschirm</p> },
      {
        element: <SessionGate allow={allow} />,
        children: [{ path: '/target', element: <p>Ziel</p> }],
      },
    ],
    { initialEntries: ['/target'] }
  );
  render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  return { queryClient, router };
}

describe('SessionGate', () => {
  const MATRIX: [Gate, keyof typeof WHO, string][] = [
    [GATE.ANONYMOUS, 'anonymous', 'Ziel'],
    [GATE.ANONYMOUS, 'pending', 'Wartebildschirm'],
    [GATE.ANONYMOUS, 'user', 'Startseite'],
    [GATE.ANONYMOUS, 'admin', 'Startseite'],
    [GATE.PENDING, 'anonymous', 'Anmeldeseite'],
    [GATE.PENDING, 'pending', 'Ziel'],
    [GATE.PENDING, 'user', 'Startseite'],
    [GATE.PENDING, 'admin', 'Startseite'],
    [GATE.MEMBER, 'anonymous', 'Anmeldeseite'],
    [GATE.MEMBER, 'pending', 'Wartebildschirm'],
    [GATE.MEMBER, 'user', 'Ziel'],
    [GATE.MEMBER, 'admin', 'Ziel'],
    [GATE.ADMIN, 'anonymous', 'Anmeldeseite'],
    [GATE.ADMIN, 'pending', 'Wartebildschirm'],
    [GATE.ADMIN, 'user', 'Startseite'],
    [GATE.ADMIN, 'admin', 'Ziel'],
  ];

  it.each(MATRIX)('gate %s, state %s: shows %s', async (allow, who, expected) => {
    renderGate(allow, WHO[who]);

    expect(await screen.findByText(expected)).toBeInTheDocument();
  });

  it('shows a loading state while the session is being checked', () => {
    renderGate(GATE.MEMBER, () => new Promise<Response>(() => undefined));

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an error with a retry button when the server fails, and recovers', async () => {
    let healthy = false;
    renderGate(GATE.MEMBER, () => (healthy ? WHO.user() : problem(500, 'Internal Server Error')));
    const user = userEvent.setup();

    expect(await screen.findByRole('alert')).toHaveTextContent('Das Laden hat nicht geklappt.');
    healthy = true;
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByText('Ziel')).toBeInTheDocument();
  });

  it('lets the sign-in page appear even when the session check fails', async () => {
    renderGate(GATE.ANONYMOUS, () => problem(503, 'Unavailable'));

    expect(await screen.findByText('Ziel')).toBeInTheDocument();
  });

  it('keeps a signed-in user in place when a later refresh fails for another reason than 401', async () => {
    let failing = false;
    const { queryClient } = renderGate(GATE.MEMBER, () =>
      failing ? problem(500, 'x') : WHO.user()
    );
    await screen.findByText('Ziel');

    failing = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: getAuthMeQueryKey() });
    });

    expect(screen.getByText('Ziel')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends the user to sign-in when an ordinary request learns the session ended', async () => {
    let signedIn = true;
    stubApi({
      'GET /api/auth/me': () => (signedIn ? WHO.user() : WHO.anonymous()),
      'GET /api/something': () => problem(401, 'Unauthorized'),
    });
    const router = createMemoryRouter(
      [
        { path: '/login', element: <p>Anmeldeseite</p> },
        {
          element: <SessionGate allow={GATE.MEMBER} />,
          children: [{ path: '/', element: <p>Ziel</p> }],
        },
      ],
      { initialEntries: ['/'] }
    );
    render(
      <AppProviders queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>
    );
    await screen.findByText('Ziel');

    signedIn = false;
    await act(async () => {
      await apiFetch('/api/something').catch(() => undefined);
    });

    expect(await screen.findByText('Anmeldeseite')).toBeInTheDocument();
  });

  it('remembers where the visitor wanted to go', async () => {
    const { router } = renderGate(GATE.MEMBER, WHO.anonymous);

    await screen.findByText('Anmeldeseite');

    expect(router.state.location.state).toEqual({ from: '/target' });
  });
});
