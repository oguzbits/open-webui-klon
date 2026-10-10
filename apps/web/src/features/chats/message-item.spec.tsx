import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UIMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders, createQueryClient } from '@/app/providers';
import { MessageDtoRole, MessageDtoStatus } from '@/api/generated/model';
import { messageDto, textParts } from '@/test/fixtures';

import { MessageItem } from './message-item';

const ANSWER: UIMessage = {
  id: 'a1',
  role: 'assistant',
  parts: [{ type: 'text', text: 'Das ist **fett**.' }],
};
const QUESTION: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Frage?' }] };
const STORED_ANSWER = messageDto({
  id: 'a1',
  parentId: 'u1',
  role: MessageDtoRole.assistant,
  parts: textParts('Das ist **fett**.'),
});
const STORED_QUESTION = messageDto({ id: 'u1' });

function renderItem(props: Partial<Parameters<typeof MessageItem>[0]> = {}) {
  const handlers = { onRegenerate: vi.fn(), onEdit: vi.fn(), onSwitch: vi.fn() };
  render(
    <AppProviders queryClient={createQueryClient()}>
      <MessageItem
        message={ANSWER}
        stored={STORED_ANSWER}
        branch={undefined}
        live={false}
        locked={false}
        restore={undefined}
        {...handlers}
        {...props}
      />
    </AppProviders>
  );
  return { ...handlers, user: userEvent.setup() };
}

describe('MessageItem', () => {
  it('renders an answer as markdown and a question as plain text', () => {
    const { container } = render(
      <AppProviders queryClient={createQueryClient()}>
        <MessageItem
          message={{
            id: 'u1',
            role: 'user',
            parts: [{ type: 'text', text: '**nicht fett** <b>x</b>' }],
          }}
          stored={STORED_QUESTION}
          branch={undefined}
          live={false}
          locked={false}
          restore={undefined}
          onRegenerate={vi.fn()}
          onEdit={vi.fn()}
          onSwitch={vi.fn()}
        />
      </AppProviders>
    );

    expect(container).toHaveTextContent('**nicht fett** <b>x</b>');
    expect(container.querySelector('strong')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows the answer with its formatting', () => {
    renderItem();

    expect(screen.getByText('fett').tagName).toBe('STRONG');
  });

  it('offers to regenerate a stored answer', async () => {
    const { onRegenerate, user } = renderItem();

    await user.click(screen.getByRole('button', { name: 'Neu erzeugen' }));

    expect(onRegenerate).toHaveBeenCalledWith('a1');
  });

  it('offers no action for an answer the server does not know yet (just streamed)', () => {
    renderItem({ stored: undefined });

    expect(screen.queryByRole('button', { name: 'Neu erzeugen' })).not.toBeInTheDocument();
  });

  it('locks the actions while something is running', () => {
    renderItem({ locked: true });

    expect(screen.getByRole('button', { name: 'Neu erzeugen' })).toBeDisabled();
  });

  it('says that the answer is being generated while it is still empty', () => {
    renderItem({ message: { ...ANSWER, parts: [] }, stored: undefined, live: true });

    expect(screen.getByText('Die Antwort wird erzeugt …')).toBeInTheDocument();
  });

  it('marks a stopped answer and keeps its text', () => {
    renderItem({ stored: { ...STORED_ANSWER, status: MessageDtoStatus.aborted } });

    expect(screen.getByText('Die Antwort wurde abgebrochen.')).toBeInTheDocument();
    expect(screen.getByText('fett')).toBeInTheDocument();
  });

  it('marks a failed answer with the reason, says it is not sent to the model and offers a retry', () => {
    renderItem({
      stored: { ...STORED_ANSWER, status: MessageDtoStatus.error, errorReason: 'timeout' },
    });

    expect(
      screen.getByText(/Die Antwort ist fehlgeschlagen und wird dem Modell nicht mitgeschickt\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/Der Anbieter antwortet nicht rechtzeitig\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu erzeugen' })).toBeEnabled();
  });

  it('edits a question: the edited text goes out, the box closes', async () => {
    const { onEdit, user } = renderItem({ message: QUESTION, stored: STORED_QUESTION });

    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const box = screen.getByLabelText('Nachricht bearbeiten');
    expect(box).toHaveValue('Frage?');
    await user.clear(box);
    await user.type(box, 'Andere Frage?');
    await user.click(screen.getByRole('button', { name: 'Als neue Version senden' }));

    expect(onEdit).toHaveBeenCalledWith('u1', 'Andere Frage?');
    expect(screen.queryByLabelText('Nachricht bearbeiten')).not.toBeInTheDocument();
  });

  it('does not send an emptied edit and can cancel it', async () => {
    const { onEdit, user } = renderItem({ message: QUESTION, stored: STORED_QUESTION });

    await user.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    await user.clear(screen.getByLabelText('Nachricht bearbeiten'));

    expect(screen.getByRole('button', { name: 'Als neue Version senden' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByLabelText('Nachricht bearbeiten')).not.toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('opens the edit box again with the text when sending it failed', () => {
    renderItem({
      message: QUESTION,
      stored: STORED_QUESTION,
      restore: { token: 1, text: 'Nicht gesendet' },
    });

    expect(screen.getByLabelText('Nachricht bearbeiten')).toHaveValue('Nicht gesendet');
  });

  it('shows the position among the versions and switches', async () => {
    const { onSwitch, user } = renderItem({
      branch: { index: 1, count: 3, previousId: 'a0', nextId: 'a2' },
    });

    expect(screen.getByText('2/3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Nächste Version' }));
    await user.click(screen.getByRole('button', { name: 'Vorherige Version' }));

    expect(onSwitch).toHaveBeenNthCalledWith(1, 'a2');
    expect(onSwitch).toHaveBeenNthCalledWith(2, 'a0');
  });

  it('shows no version switch for a single version, and disables the missing direction', () => {
    renderItem({ branch: { index: 0, count: 1, previousId: null, nextId: null } });
    expect(screen.queryByText('1/1')).not.toBeInTheDocument();
  });

  it('disables the switch at the first and the last version', () => {
    renderItem({ branch: { index: 0, count: 2, previousId: null, nextId: 'a2' } });

    expect(screen.getByRole('button', { name: 'Vorherige Version' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nächste Version' })).toBeEnabled();
  });

  it('locks the version switch while something is running', () => {
    renderItem({
      branch: { index: 1, count: 3, previousId: 'a0', nextId: 'a2' },
      locked: true,
    });

    expect(screen.getByRole('button', { name: 'Vorherige Version' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nächste Version' })).toBeDisabled();
  });

  it('locks the edit button while something is running', () => {
    renderItem({ message: QUESTION, stored: STORED_QUESTION, locked: true });
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
  });

  it('does not send an open edit while something is running', () => {
    renderItem({
      message: QUESTION,
      stored: STORED_QUESTION,
      locked: true,
      restore: { token: 1, text: 'Nicht gesendet' },
    });

    expect(screen.getByRole('button', { name: 'Als neue Version senden' })).toBeDisabled();
  });
});
