import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders, createQueryClient } from '@/app/providers';

import { Composer } from './composer';

function renderComposer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn();
  const onStop = vi.fn();
  render(
    <AppProviders queryClient={createQueryClient()}>
      <Composer busy={false} disabled={false} onSend={onSend} onStop={onStop} {...props} />
    </AppProviders>
  );
  return { onSend, onStop, user: userEvent.setup() };
}

describe('Composer', () => {
  it('sends the text with Enter and empties the field', async () => {
    const { onSend, user } = renderComposer();

    await user.type(screen.getByLabelText('Nachricht'), 'Hallo{Enter}');

    expect(onSend).toHaveBeenCalledWith('Hallo');
    expect(screen.getByLabelText('Nachricht')).toHaveValue('');
  });

  it('sends once on a double Enter', async () => {
    const { onSend, user } = renderComposer();

    await user.type(screen.getByLabelText('Nachricht'), 'Hallo{Enter}{Enter}');

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('starts a new line with Shift+Enter instead of sending', async () => {
    const { onSend, user } = renderComposer();

    await user.type(screen.getByLabelText('Nachricht'), 'eins{Shift>}{Enter}{/Shift}zwei');

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nachricht')).toHaveValue('eins\nzwei');
  });

  it('does not send an empty or blank message', async () => {
    const { onSend, user } = renderComposer();

    await user.type(screen.getByLabelText('Nachricht'), '   {Enter}');
    await user.click(screen.getByRole('button', { name: 'Senden' }));

    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the text and does not send while an answer is running; the button stops instead', async () => {
    const { onSend, onStop, user } = renderComposer({ busy: true });

    await user.type(screen.getByLabelText('Nachricht'), 'schon die nächste{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nachricht')).toHaveValue('schon die nächste');
    expect(screen.queryByRole('button', { name: 'Senden' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stoppen' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('does not send while it is disabled (no model)', async () => {
    const { onSend, user } = renderComposer({ disabled: true });

    await user.type(screen.getByLabelText('Nachricht'), 'Hallo{Enter}');

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled();
  });

  it('starts with a given text, for a message that could not be sent', () => {
    renderComposer({ initialText: 'Das ging schief' });

    expect(screen.getByLabelText('Nachricht')).toHaveValue('Das ging schief');
  });
});
