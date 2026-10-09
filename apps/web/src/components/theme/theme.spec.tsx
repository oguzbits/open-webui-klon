import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY, ThemeProvider } from './theme-provider';
import { ThemeToggle } from './theme-toggle';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
}

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('theme toggle', () => {
  it('cycles system, light, dark and sets the dark class only for dark', async () => {
    const user = userEvent.setup();
    renderToggle();
    const button = screen.getByRole('button', { name: /Darstellung wechseln/ });

    await user.click(button); // system -> light
    expect(document.documentElement).not.toHaveClass('dark');
    await user.click(button); // light -> dark
    expect(document.documentElement).toHaveClass('dark');
    await user.click(button); // dark -> system
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('remembers the choice and restores it on the next visit', async () => {
    const user = userEvent.setup();
    const first = renderToggle();
    const button = screen.getByRole('button', { name: /Darstellung wechseln/ });
    await user.click(button);
    await user.click(button); // dark
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    first.unmount();
    document.documentElement.classList.remove('dark');

    renderToggle();

    expect(document.documentElement).toHaveClass('dark');
  });

  it('keeps working when the browser blocks storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const user = userEvent.setup();
    renderToggle();
    const button = screen.getByRole('button', { name: /Darstellung wechseln/ });

    await user.click(button);
    await user.click(button);

    expect(document.documentElement).toHaveClass('dark');
  });
});
