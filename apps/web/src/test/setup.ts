import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import '@/i18n';

// jsdom has no matchMedia; the theme provider and the sidebar need it.
window.matchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// jsdom has no scrollIntoView; the chat scrolls to its newest message.
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});
