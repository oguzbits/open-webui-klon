import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chatDetailDto,
  chatList,
  chatSummaryDto,
  modelList,
  sessionInfo,
  userDto,
} from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { callsTo, type Handler, json, noContent, problem, stubApi } from '@/test/stub-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const BEN = userDto({ id: 'u-ben', name: 'Ben Beispiel' });
const REISE = chatSummaryDto({ id: 'c-1', title: 'Reiseplanung' });
const KOCHEN = chatSummaryDto({ id: 'c-2', title: 'Kochen' });

/** Fills the session and model routes into the given handlers in place, so a test can swap a route between steps. */
function stubMember(handlers: Record<string, Handler> = {}) {
  const base: Record<string, Handler> = {
    'GET /api/auth/me': () => json(200, sessionInfo(BEN)),
    'GET /api/models': () => json(200, modelList()),
  };
  for (const [route, handler] of Object.entries(base)) {
    if (!(route in handlers)) handlers[route] = handler;
  }
  return stubApi(handlers);
}

describe('ChatList', () => {
  it('lists the chats of the user as links to them', async () => {
    stubMember({ 'GET /api/chats': () => json(200, chatList([REISE, KOCHEN])) });

    renderApp('/');

    expect(await screen.findByRole('link', { name: 'Reiseplanung' })).toHaveAttribute(
      'href',
      '/chats/c-1'
    );
    expect(screen.getByRole('link', { name: 'Kochen' })).toHaveAttribute('href', '/chats/c-2');
  });

  it('names a chat without a title and shows markup in a title as text', async () => {
    const evil = chatSummaryDto({ id: 'c-3', title: '<img src=x onerror=alert(1)>' });
    stubMember({
      'GET /api/chats': () =>
        json(200, chatList([chatSummaryDto({ id: 'c-4', title: null }), evil])),
    });

    const { container } = renderApp('/');

    expect(
      await screen.findByRole('link', { name: '<img src=x onerror=alert(1)>' })
    ).toBeInTheDocument();
    // The link to start a chat and the chat without a title carry the same name.
    expect(
      screen.getAllByRole('link', { name: 'Neuer Chat' }).map((link) => link.getAttribute('href'))
    ).toEqual(['/chats', '/chats/c-4']);
    expect(container.querySelector('img')).toBeNull();
  });

  it('says so when there are no chats and offers a new one', async () => {
    stubMember();

    renderApp('/');

    expect(await screen.findByText('Du hast noch keine Chats.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Neuer Chat' })[0]).toHaveAttribute(
      'href',
      '/chats'
    );
  });

  it('shows the failure with a retry, and the list after it worked', async () => {
    const user = userEvent.setup();
    const handlers: Record<string, Handler> = {
      'GET /api/chats': () => problem(500, 'Internal Server Error'),
    };
    stubMember(handlers);
    renderApp('/');

    // The start page shows its own status with a retry, so the one of the list is found by its text.
    const failure = (await screen.findByText('Das Laden hat nicht geklappt.')).closest(
      '[role="alert"]'
    );
    expect(failure).not.toBeNull();
    handlers['GET /api/chats'] = () => json(200, chatList([REISE]));
    await user.click(
      within(failure as HTMLElement).getByRole('button', { name: 'Erneut versuchen' })
    );

    expect(await screen.findByRole('link', { name: 'Reiseplanung' })).toBeInTheDocument();
  });

  it('searches the titles after a pause in typing, with one request', async () => {
    const user = userEvent.setup();
    const fetchMock = stubMember({
      'GET /api/chats': (request) =>
        request.url.searchParams.get('q') === 'koch'
          ? json(200, chatList([KOCHEN]))
          : json(200, chatList([REISE, KOCHEN])),
    });
    renderApp('/');
    await screen.findByRole('link', { name: 'Reiseplanung' });

    await user.type(screen.getByRole('searchbox', { name: 'Chats durchsuchen' }), 'koch');

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Reiseplanung' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Kochen' })).toBeInTheDocument();
    // Every request with a search term counts: typing "koch" key by key must not ask for "k", "ko", "koc".
    const searches = fetchMock.mock.calls.flatMap(([input]) =>
      typeof input === 'string' && input.includes('q=') ? [input] : []
    );
    expect(searches).toEqual(['/api/chats?limit=30&q=koch']);
  });

  it('says that nothing was found for a search without matches', async () => {
    const user = userEvent.setup();
    stubMember({
      'GET /api/chats': (request) =>
        json(200, request.url.searchParams.has('q') ? chatList([]) : chatList([REISE])),
    });
    renderApp('/');
    await screen.findByRole('link', { name: 'Reiseplanung' });

    await user.type(screen.getByRole('searchbox', { name: 'Chats durchsuchen' }), 'zzz');

    expect(await screen.findByText('Keine Chats gefunden.')).toBeInTheDocument();
  });

  it('loads the next page with the cursor of the server', async () => {
    const user = userEvent.setup();
    stubMember({
      'GET /api/chats': (request) =>
        request.url.searchParams.get('cursor') === 'next-1'
          ? json(200, chatList([KOCHEN], null))
          : json(200, chatList([REISE], 'next-1')),
    });
    renderApp('/');
    await screen.findByRole('link', { name: 'Reiseplanung' });

    await user.click(screen.getByRole('button', { name: 'Mehr laden' }));

    expect(await screen.findByRole('link', { name: 'Kochen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mehr laden' })).not.toBeInTheDocument();
  });

  it('deletes a chat after a confirmation, with exactly one request', async () => {
    const user = userEvent.setup();
    const handlers: Record<string, Handler> = {
      'GET /api/chats': () => json(200, chatList([REISE, KOCHEN])),
      'DELETE /api/chats/c-1': () => noContent(),
    };
    const fetchMock = stubMember(handlers);
    renderApp('/');
    await screen.findByRole('link', { name: 'Reiseplanung' });

    await user.click(screen.getByRole('button', { name: 'Chat „Reiseplanung“ löschen' }));
    handlers['GET /api/chats'] = () => json(200, chatList([KOCHEN]));
    const confirm = await screen.findByRole('alertdialog');
    expect(callsTo(fetchMock, 'DELETE', '/api/chats/c-1')).toHaveLength(0);
    await user.dblClick(within(confirm).getByRole('button', { name: 'Löschen' }));

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: 'Reiseplanung' })).not.toBeInTheDocument();
    });
    expect(callsTo(fetchMock, 'DELETE', '/api/chats/c-1')).toHaveLength(1);
  });

  // Needs the route /chats/:id with its h1 from Task 9: re-enabled there (Task 9 Step 7).
  it.skip('leaves the chat that is open when it is deleted', async () => {
    const user = userEvent.setup();
    const handlers: Record<string, Handler> = {
      'GET /api/chats': () => json(200, chatList([REISE])),
      'GET /api/chats/c-1': () => json(200, chatDetailDto({ id: 'c-1', title: 'Reiseplanung' })),
      'DELETE /api/chats/c-1': () => noContent(),
    };
    stubMember(handlers);
    const { router } = renderApp('/chats/c-1');
    await screen.findByRole('heading', { name: 'Reiseplanung' });

    await user.click(screen.getByRole('button', { name: 'Chat „Reiseplanung“ löschen' }));
    handlers['GET /api/chats'] = () => json(200, chatList([]));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' })
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/chats');
    });
  });

  it('keeps the chat and says so when deleting fails', async () => {
    const user = userEvent.setup();
    stubMember({
      'GET /api/chats': () => json(200, chatList([REISE])),
      'DELETE /api/chats/c-1': () => problem(500, 'Internal Server Error'),
    });
    renderApp('/');
    await screen.findByRole('link', { name: 'Reiseplanung' });

    await user.click(screen.getByRole('button', { name: 'Chat „Reiseplanung“ löschen' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Löschen' })
    );

    expect(await screen.findByText(/Das Löschen hat nicht geklappt\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reiseplanung' })).toBeInTheDocument();
  });
});
