import { Settings } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorMessageKey } from '@/api/error-message';
import type { ChatParams } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  draftFromParams,
  PARAM_NAME,
  type ParamName,
  type ParamsDraft,
  paramsFromDraft,
} from './chat-params-form';

export interface ChatSettings {
  systemPrompt: string | null;
  params: ChatParams;
}

const PARAM_FIELDS = [
  { name: PARAM_NAME.TEMPERATURE, labelKey: 'chats.settings.temperature' },
  { name: PARAM_NAME.TOP_P, labelKey: 'chats.settings.topP' },
  { name: PARAM_NAME.MAX_OUTPUT_TOKENS, labelKey: 'chats.settings.maxOutputTokens' },
] as const;

export function ChatSettingsDialog({
  value,
  onSave,
}: {
  value: ChatSettings;
  onSave: (next: ChatSettings) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<ParamsDraft>(() => draftFromParams(value.params));
  const [invalid, setInvalid] = useState<ParamName[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  // The state above lags one render behind a second quick submit; the ref does not.
  const savingRef = useRef(false);

  function handleOpenChange(next: boolean) {
    // Not while saving: closing would hide the error of a save that fails.
    if (!next && savingRef.current) return;
    if (next) {
      setPrompt(value.systemPrompt ?? '');
      setDraft(draftFromParams(value.params));
      setInvalid([]);
      setError(undefined);
    }
    setOpen(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    const result = paramsFromDraft(draft);
    if (!result.ok) {
      setInvalid(result.invalid);
      return;
    }
    setInvalid([]);
    setError(undefined);
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave({
        systemPrompt: prompt.trim() === '' ? null : prompt,
        params: result.params,
      });
      setOpen(false);
    } catch (caught) {
      setError(caught);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings aria-hidden />
          {t('chats.settings.open')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('chats.settings.title')}</DialogTitle>
            <DialogDescription>{t('chats.settings.description')}</DialogDescription>
          </DialogHeader>
          <fieldset disabled={saving} className="min-w-0 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="chat-system-prompt">{t('chats.settings.prompt')}</Label>
              <Textarea
                id="chat-system-prompt"
                value={prompt}
                placeholder={t('chats.settings.promptHint')}
                onChange={(event) => {
                  setPrompt(event.target.value);
                }}
              />
            </div>
            {PARAM_FIELDS.map(({ name, labelKey }) => (
              <div key={name} className="space-y-1.5">
                <Label htmlFor={`chat-param-${name}`}>{t(labelKey)}</Label>
                <Input
                  id={`chat-param-${name}`}
                  inputMode="decimal"
                  value={draft[name]}
                  aria-invalid={invalid.includes(name)}
                  onChange={(event) => {
                    setDraft({ ...draft, [name]: event.target.value });
                  }}
                />
              </div>
            ))}
          </fieldset>
          <p className="text-muted-foreground text-xs">{t('chats.settings.paramsHint')}</p>
          {invalid.length > 0 && (
            <p role="alert" className="text-destructive text-sm">
              {t('chats.settings.invalid')}
            </p>
          )}
          {error !== undefined && (
            <p role="alert" className="text-destructive text-sm">
              {t(errorMessageKey(error, { 422: 'chats.settings.tooLong' }))}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? t('chats.settings.saving') : t('chats.settings.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
