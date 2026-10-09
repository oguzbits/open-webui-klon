import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import i18n from './i18n';
import './index.css';

const container = document.getElementById('root');
if (container === null) throw new Error('Root element is missing');

createRoot(container).render(
  <StrictMode>
    <h1>{i18n.t('app.name')}</h1>
  </StrictMode>
);
