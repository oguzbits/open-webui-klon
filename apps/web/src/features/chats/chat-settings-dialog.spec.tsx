import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/fetcher';
import { renderPage } from '@/test/render-app';

import { type ChatSettings, ChatSettingsDialog } from './chat-settings-dialog';

const VALUE: ChatSettings = { systemPrompt: 'Antworte kurz.', params: { temperature: 0.5 } };

async function openDialog(onSave: (next: ChatSettings) => Promise<void>, value = VALUE) {
  const user = userEvent.setup();
  renderPage(<ChatSettingsDialog value={value} onSave={onSave} />);
  await user.click(screen.getByRole('button', { name: 'Einstellungen' }));
  return user;
}

describe('ChatSettingsDialog', () => {
  it('shows the current settings', async () => {
    await openDialog(vi.fn().mockResolvedValue(undefined));

    expect(screen.getByLabelText('Anweisung für das Modell')).toHaveValue('Antworte kurz.');
    expect(screen.getByLabelText(/Kreativität/)).toHaveValue('0.5');
    expect(screen.getByLabelText(/Auswahlbreite/)).toHaveValue('');
  });

  it('saves the changed instruction and parameters, and closes', async () => {
    const onSave = vi.fn<(next: ChatSettings) => Promise<void>>().mockResolvedValue(undefined);
    const user = await openDialog(onSave);

    await user.clear(screen.getByLabelText('Anweisung für das Modell'));
    await user.clear(screen.getByLabelText(/Kreativität/));
    await user.type(screen.getByLabelText(/Kreativität/), '0');
    await user.type(screen.getByLabelText(/Maximale Antwortlänge/), '512');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onSave).toHaveBeenCalledWith({
      systemPrompt: null,
      params: { temperature: 0, maxOutputTokens: 512 },
    });
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('does not save an invalid value, marks the field and keeps the dialog open', async () => {
    const onSave = vi.fn<(next: ChatSettings) => Promise<void>>().mockResolvedValue(undefined);
    const user = await openDialog(onSave);

    await user.clear(screen.getByLabelText(/Kreativität/));
    await user.type(screen.getByLabelText(/Kreativität/), '3');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Kreativität/)).toBeInvalid();
    expect(screen.getByText('Bitte prüfe die markierten Felder.')).toBeInTheDocument();
  });

  it('keeps the entries and says what happened when saving fails', async () => {
    const onSave = vi
      .fn<(next: ChatSettings) => Promise<void>>()
      .mockRejectedValue(new ApiError(422, 'Unprocessable'));
    const user = await openDialog(onSave);

    await user.type(screen.getByLabelText('Anweisung für das Modell'), ' Mehr.');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Die Anweisung ist zu lang.')).toBeInTheDocument();
    expect(screen.getByLabelText('Anweisung für das Modell')).toHaveValue('Antworte kurz. Mehr.');
  });

  it('saves once when the form is submitted twice quickly', async () => {
    let resolve: () => void = () => undefined;
    const onSave = vi.fn<(next: ChatSettings) => Promise<void>>().mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const user = await openDialog(onSave);

    const field = screen.getByLabelText(/Kreativität/);
    await user.type(field, '{Enter}');
    // The disabled button already stops a further Enter; a second submit event must be stopped by the guard itself.
    fireEvent.submit(field);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Wird gespeichert …' })).toBeDisabled();
    resolve();
  });

  it('stays open and locked while saving, so a failed save is shown', async () => {
    let reject: (reason: unknown) => void = () => undefined;
    const onSave = vi.fn<(next: ChatSettings) => Promise<void>>().mockImplementation(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        })
    );
    const user = await openDialog(onSave);
    await user.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(screen.getByLabelText('Anweisung für das Modell')).toBeDisabled();
    expect(screen.getByLabelText(/Kreativität/)).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => {
      reject(new ApiError(422, 'Unprocessable'));
    });

    expect(await screen.findByText('Die Anweisung ist zu lang.')).toBeInTheDocument();
    expect(screen.getByLabelText('Anweisung für das Modell')).toBeEnabled();
  });

  it('starts from the stored values each time it opens', async () => {
    const user = await openDialog(vi.fn().mockResolvedValue(undefined));
    await user.type(screen.getByLabelText('Anweisung für das Modell'), ' unsaved');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Einstellungen' }));

    expect(screen.getByLabelText('Anweisung für das Modell')).toHaveValue('Antworte kurz.');
  });
});
