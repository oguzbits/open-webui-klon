import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiStatus } from './api-status';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderStatus() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiStatus />
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiStatus', () => {
  it('shows a loading state first and then the success message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json(200, { status: 'ok' })))
    );

    renderStatus();

    expect(screen.getByRole('status')).toHaveTextContent('Die Verbindung wird geprüft');
    expect(await screen.findByText('Der Server ist erreichbar.')).toBeInTheDocument();
  });

  it('shows an error with a retry button, disables it while retrying and recovers', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => Promise.resolve(json(503, { title: 'Service Unavailable' })))
      .mockImplementation(() => Promise.resolve(json(200, { status: 'ok' })));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderStatus();

    expect(await screen.findByText('Der Server antwortet gerade nicht.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByText('Der Server ist erreichbar.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
