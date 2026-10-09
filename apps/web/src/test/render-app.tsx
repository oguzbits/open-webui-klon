import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router';

import { AppProviders, createQueryClient } from '@/app/providers';
import { routes } from '@/app/router';

export function renderApp(path = '/') {
  const queryClient = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
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
