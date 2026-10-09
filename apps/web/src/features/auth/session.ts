import { ApiError } from '@/api/fetcher';
import { useAuthMe } from '@/api/generated/api';
import type { UserDto } from '@/api/generated/model';

export const SESSION_STATUS = {
  LOADING: 'loading',
  ANONYMOUS: 'anonymous',
  ERROR: 'error',
  READY: 'ready',
} as const;

export type Session =
  | { status: typeof SESSION_STATUS.LOADING }
  | { status: typeof SESSION_STATUS.ANONYMOUS }
  | { status: typeof SESSION_STATUS.ERROR; error: unknown; retry: () => void; retrying: boolean }
  | { status: typeof SESSION_STATUS.READY; user: UserDto };

/** Who is signed in, from the one `me` query. Only a 401 means "nobody"; other failures keep what was known. */
export function useSession(): Session {
  const me = useAuthMe({ query: { staleTime: 60_000 } });
  if (me.error instanceof ApiError && me.error.status === 401) {
    return { status: SESSION_STATUS.ANONYMOUS };
  }
  // A failed background refresh must not throw a signed-in user out.
  if (me.data !== undefined) return { status: SESSION_STATUS.READY, user: me.data.data.user };
  if (me.isPending) return { status: SESSION_STATUS.LOADING };
  return {
    status: SESSION_STATUS.ERROR,
    error: me.error,
    retry: () => {
      void me.refetch();
    },
    retrying: me.isFetching,
  };
}

/** For views below a `SessionGate`: the gate guarantees a user, so anything else is a programming error. */
export function useCurrentUser(): UserDto {
  const session = useSession();
  if (session.status !== SESSION_STATUS.READY) {
    throw new Error('useCurrentUser needs a signed-in session: render it below a SessionGate');
  }
  return session.user;
}
