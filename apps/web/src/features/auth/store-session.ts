import type { QueryClient } from '@tanstack/react-query';

import { getAuthMeQueryKey } from '@/api/generated/api';
import type { SessionInfoDto } from '@/api/generated/model';

/**
 * Makes the given session the current one. Everything else in the cache belongs to whoever was signed in
 * before, so it goes; `me` stays and is overwritten so the views that watch it update.
 */
export function storeSession(queryClient: QueryClient, session: SessionInfoDto): void {
  const meKey = getAuthMeQueryKey();
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== meKey[0] });
  queryClient.setQueryData(meKey, { data: session, status: 200 as const, headers: new Headers() });
}
