import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderApp } from '@/test/render-app';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubHealthy() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response('{"status":"ok"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    )
  );
}

describe('app routing and layout', () => {
  it('renders the home page inside a main landmark with navigation and theme toggle', async () => {
    stubHealthy();

    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Willkommen' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('heading', { name: 'Willkommen' })
    );
    expect(screen.getByRole('link', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Darstellung wechseln/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute(
      'href',
      '#content'
    );
  });

  it('answers an unknown address with a friendly page and a way back', () => {
    stubHealthy();

    renderApp('/gibt-es-nicht');

    expect(screen.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Startseite' })).toHaveAttribute('href', '/');
  });

  it('announces the mobile sidebar in German instead of the generated English text', async () => {
    stubHealthy();
    vi.stubGlobal('innerWidth', 375);
    const user = userEvent.setup();
    renderApp('/');

    await user.click(
      await screen.findByRole('button', { name: 'Seitenleiste ein- oder ausblenden' })
    );

    expect(await screen.findByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
  });
});
