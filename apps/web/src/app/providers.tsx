import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect } from 'react';

import { getAuthMeQueryKey } from '@/api/generated/api';
import { setUnauthorizedHandler } from '@/api/session-state';
import { ThemeProvider } from '@/components/theme/theme-provider';

export function createQueryClient(): QueryClient {
  // No automatic retries: every failed view shows its own "Erneut versuchen" button.
  return new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
  });
}

const appQueryClient = createQueryClient();

export function AppProviders({
  children,
  queryClient = appQueryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  // An ordinary request that answers 401 means the session ended: look again, the gates do the rest.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void queryClient.invalidateQueries({ queryKey: getAuthMeQueryKey() });
    });
    return () => {
      setUnauthorizedHandler(undefined);
    };
  }, [queryClient]);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
