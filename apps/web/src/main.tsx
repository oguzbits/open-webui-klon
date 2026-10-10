import '@/lib/zod-config';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { AppProviders } from '@/app/providers';
import { createAppRouter } from '@/app/router';

import '@/i18n';
import './index.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Root element is missing');

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={createAppRouter()} />
    </AppProviders>
  </StrictMode>
);
