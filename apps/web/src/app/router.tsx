import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppLayout } from '@/components/layout/app-layout';
import { GATE, SessionGate } from '@/features/auth/session-gate';
import { AccountPage } from '@/pages/account-page';
import { AdminConnectionsPage } from '@/pages/admin-connections-page';
import { AdminUsersPage } from '@/pages/admin-users-page';
import { ChatPage } from '@/pages/chat-page';
import { HomePage } from '@/pages/home-page';
import { LoginPage } from '@/pages/login-page';
import { ModelsPage } from '@/pages/models-page';
import { NewChatPage } from '@/pages/new-chat-page';
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
          { path: 'models', element: <ModelsPage /> },
          { path: 'chats', element: <NewChatPage /> },
          { path: 'chats/:id', element: <ChatPage /> },
          {
            element: <SessionGate allow={GATE.ADMIN} />,
            children: [
              { path: 'admin/users', element: <AdminUsersPage /> },
              { path: 'admin/connections', element: <AdminConnectionsPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
