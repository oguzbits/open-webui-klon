import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { UserDtoRole } from '@/api/generated/model';
import { LoadError } from '@/components/common/load-error';
import { PageLoading } from '@/components/common/page-loading';

import { SESSION_STATUS, useSession } from './session';

export const GATE = {
  /** The sign-in page: only for visitors who are not signed in. */
  ANONYMOUS: 'anonymous',
  /** The waiting screen: only for accounts that wait for approval. */
  PENDING: 'pending',
  /** Everything else: signed in and approved. */
  MEMBER: 'member',
  ADMIN: 'admin',
} as const;

export type Gate = (typeof GATE)[keyof typeof GATE];

/** Convenience only. The server decides what a session may do; this just sends people to the right page. */
function redirectTarget(state: unknown): string {
  if (
    typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    typeof state.from === 'string'
  ) {
    const { from } = state;
    if (from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/login')) return from;
  }
  return '/';
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="grid min-h-[50svh] place-items-center p-4">{children}</div>;
}

export function SessionGate({ allow }: { allow: Gate }) {
  const session = useSession();
  const location = useLocation();

  if (session.status === SESSION_STATUS.LOADING) {
    return (
      <Centered>
        <PageLoading />
      </Centered>
    );
  }
  if (session.status === SESSION_STATUS.ERROR) {
    // The sign-in page copes with an unreachable server on its own.
    if (allow === GATE.ANONYMOUS) return <Outlet />;
    return (
      <Centered>
        <div className="w-full max-w-md">
          <LoadError error={session.error} busy={session.retrying} onRetry={session.retry} />
        </div>
      </Centered>
    );
  }
  if (session.status === SESSION_STATUS.ANONYMOUS) {
    if (allow === GATE.ANONYMOUS) return <Outlet />;
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }

  const pending = session.user.role === UserDtoRole.pending;
  switch (allow) {
    case GATE.ANONYMOUS:
      return <Navigate to={pending ? '/pending' : redirectTarget(location.state)} replace />;
    case GATE.PENDING:
      return pending ? <Outlet /> : <Navigate to="/" replace />;
    case GATE.MEMBER:
      return pending ? <Navigate to="/pending" replace /> : <Outlet />;
    case GATE.ADMIN:
      if (pending) return <Navigate to="/pending" replace />;
      return session.user.role === UserDtoRole.admin ? <Outlet /> : <Navigate to="/" replace />;
  }
}
