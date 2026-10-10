import type { UIMessage } from 'ai';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type MessageDto, MessageDtoRole, MessageDtoStatus } from '@/api/generated/model';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { reasonKey } from '@/features/connections/provider-reason';

import { BranchSwitcher } from './branch-switcher';
import { MarkdownContent } from './markdown/markdown-content';
import { type Branch, messageText } from './message-tree';

/** An edit that could not be sent: the text comes back into the edit box. A new token reopens it. */
export interface EditRestore {
  token: number;
  text: string;
}

interface MessageItemProps {
  message: UIMessage;
  /** The message as the server stores it; missing for a message that is only in the browser so far. */
  stored: MessageDto | undefined;
  branch: Branch | undefined;
  /** This is the answer that is being streamed right now. */
  live: boolean;
  /** Something runs (an answer, a switch): no action is possible. */
  locked: boolean;
  restore: EditRestore | undefined;
  onRegenerate: (messageId: string) => void;
  onEdit: (messageId: string, text: string) => void;
  onSwitch: (messageId: string) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  stored,
  branch,
  live,
  locked,
  restore,
  onRegenerate,
  onEdit,
  onSwitch,
}: MessageItemProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // A failed edit reopens the box: reacting to a new token while rendering (not in an effect) avoids a flash. The
  // initial value is empty on purpose: the item remounts when the failed send is rolled back, and must open then.
  const [seenToken, setSeenToken] = useState<number | undefined>(undefined);
  if (restore !== undefined && restore.token !== seenToken) {
    setSeenToken(restore.token);
    setEditing(true);
    setDraft(restore.text);
  }

  const text = messageText(message);
  const isUser = message.role === 'user';
  const actionable = stored !== undefined && !live;

  return (
    <li className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium">
        {isUser ? t('chats.message.user') : t('chats.message.assistant')}
      </p>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            aria-label={t('chats.message.editLabel')}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={locked || draft.trim() === ''}
              onClick={() => {
                setEditing(false);
                onEdit(message.id, draft);
              }}
            >
              {t('chats.message.editSend')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
              }}
            >
              {t('chats.message.editCancel')}
            </Button>
          </div>
        </div>
      ) : isUser ? (
        <p className="wrap-break-word whitespace-pre-wrap">{text}</p>
      ) : text === '' ? (
        <p className="text-muted-foreground text-sm">
          {live ? t('chats.message.pending') : t('chats.message.empty')}
        </p>
      ) : (
        <MarkdownContent text={text} />
      )}
      {stored?.status === MessageDtoStatus.aborted && (
        <p className="text-muted-foreground text-sm">{t('chats.message.aborted')}</p>
      )}
      {stored?.status === MessageDtoStatus.error && (
        <p role="note" className="text-destructive text-sm">
          {t('chats.message.failed')}
          {stored.errorReason !== null && ` ${t(reasonKey(stored.errorReason))}`}
        </p>
      )}
      {actionable && !editing && (
        <div className="flex flex-wrap items-center gap-1">
          {branch !== undefined && (
            <BranchSwitcher branch={branch} disabled={locked} onSwitch={onSwitch} />
          )}
          {stored.role === MessageDtoRole.assistant ? (
            <Button
              variant="ghost"
              size="xs"
              disabled={locked}
              onClick={() => {
                onRegenerate(message.id);
              }}
            >
              {t('chats.message.regenerate')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              disabled={locked}
              onClick={() => {
                setDraft(text);
                setEditing(true);
              }}
            >
              {t('chats.message.edit')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
});
