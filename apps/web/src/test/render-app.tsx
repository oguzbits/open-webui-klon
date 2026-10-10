import { render } from '@testing-library/react';
import { type ReactElement, StrictMode } from 'react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';

import { AppProviders, createQueryClient } from '@/app/providers';
import { routes } from '@/app/router';

/**
 * `state` is the router state of the first entry (a new chat hands its first message to the chat page this way).
 * `strict` wraps the app in StrictMode like main.tsx, for effects that must survive the extra mount in development.
 */
export function renderApp(
  path = '/',
  state?: unknown,
  { strict = false }: { strict?: boolean } = {}
) {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [{ pathname: path, state }] });
  const app = (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
  const view = render(strict ? <StrictMode>{app}</StrictMode> : app);
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
