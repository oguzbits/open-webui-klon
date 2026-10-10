import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';

import { AppProviders, createQueryClient } from '@/app/providers';
import { routes } from '@/app/router';

/** `state` is the router state of the first entry (a new chat hands its first message to the chat page this way). */
export function renderApp(path = '/', state?: unknown) {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [{ pathname: path, state }] });
  const view = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  return { ...view, queryClient, router };
}

/** One component inside the real providers, without the route table. */
export function renderPage(ui: ReactElement, path = '/') {
  const queryClient = createQueryClient();
  render(
    <AppProviders queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </AppProviders>
  );
  return { queryClient };
}
