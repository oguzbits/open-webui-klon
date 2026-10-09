import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppLayout } from '@/components/layout/app-layout';
import { GATE, SessionGate } from '@/features/auth/session-gate';
import { AccountPage } from '@/pages/account-page';
import { HomePage } from '@/pages/home-page';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { PendingPage } from '@/pages/pending-page';

export const routes: RouteObject[] = [
  {
    element: <SessionGate allow={GATE.ANONYMOUS} />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  {
    element: <SessionGate allow={GATE.PENDING} />,
    children: [{ path: '/pending', element: <PendingPage /> }],
  },
  {
    element: <SessionGate allow={GATE.MEMBER} />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <HomePage /> },
          { path: 'settings/account', element: <AccountPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
