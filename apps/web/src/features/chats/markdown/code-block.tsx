import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

const COPY_STATE = { IDLE: 'idle', COPIED: 'copied', FAILED: 'failed' } as const;
type CopyState = (typeof COPY_STATE)[keyof typeof COPY_STATE];

const FEEDBACK_MS = 2000;

/** A fenced code block with a copy button. `text` is the code as plain text, `children` the highlighted markup. */
export function CodeBlock({ text, children }: { text: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [copy, setCopy] = useState<CopyState>(COPY_STATE.IDLE);

  useEffect(() => {
    if (copy === COPY_STATE.IDLE) return;
    const timer = window.setTimeout(() => {
      setCopy(COPY_STATE.IDLE);
    }, FEEDBACK_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copy]);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopy(COPY_STATE.COPIED);
    } catch {
      // Handled by showing it: no clipboard permission, or an insecure context.
      setCopy(COPY_STATE.FAILED);
    }
  }

  return (
    <div className="bg-muted my-2 overflow-hidden rounded-lg border [&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0">
      <div className="flex items-center justify-end gap-2 border-b px-2 py-1">
        <span role="status" className="text-muted-foreground text-xs">
          {copy === COPY_STATE.COPIED && t('chats.code.copied')}
          {copy === COPY_STATE.FAILED && t('chats.code.copyFailed')}
        </span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            void copyText();
          }}
        >
          {t('chats.code.copy')}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 text-sm">{children}</pre>
    </div>
  );
}
