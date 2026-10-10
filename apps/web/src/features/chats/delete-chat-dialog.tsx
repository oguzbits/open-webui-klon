import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ChatSummaryDto } from '@/api/generated/model';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { SidebarMenuAction } from '@/components/ui/sidebar';

/** The title a chat is shown under: chats without one (before the first answer) are "New chat". */
export function chatTitle(title: string | null, untitled: string): string {
  return title === null || title.trim() === '' ? untitled : title;
}

export function DeleteChatDialog({
  chat,
  busy,
  onConfirm,
}: {
  chat: ChatSummaryDto;
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const title = chatTitle(chat.title, t('chats.untitled'));
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <SidebarMenuAction disabled={busy} aria-label={t('chats.list.delete.named', { title })}>
          <Trash2 aria-hidden />
        </SidebarMenuAction>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('chats.list.delete.title', { title })}</AlertDialogTitle>
          <AlertDialogDescription>{t('chats.list.delete.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{t('chats.list.delete.action')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
