import { SendHorizontal, Square } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * The message box. It owns the text, so typing does not re-render the message list. While an answer runs, the
 * send button becomes a stop button and Enter does nothing; `disabled` is for a chat that cannot send at all.
 */
export function Composer({
  busy,
  disabled,
  initialText = '',
  onSend,
  onStop,
}: {
  busy: boolean;
  disabled: boolean;
  /** A message that could not be sent comes back here (the parent remounts the composer with a new key). */
  initialText?: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(initialText);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  function send() {
    if (busy || disabled || text.trim() === '') return;
    onSend(text);
    setText('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter that confirms an input-method candidate must not send.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1">
      <div className="flex items-end gap-2">
        <Textarea
          ref={field}
          value={text}
          rows={2}
          className="max-h-60 resize-none"
          aria-label={t('chats.composer.label')}
          placeholder={t('chats.composer.placeholder')}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={handleKeyDown}
        />
        {busy ? (
          <Button type="button" variant="outline" onClick={onStop}>
            <Square aria-hidden />
            {t('chats.composer.stop')}
          </Button>
        ) : (
          <Button type="submit" disabled={disabled}>
            <SendHorizontal aria-hidden />
            {t('chats.composer.send')}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t('chats.composer.hint')}</p>
    </form>
  );
}
