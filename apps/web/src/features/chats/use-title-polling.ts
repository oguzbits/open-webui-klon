import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getChatsDetailQueryKey, getChatsListQueryKey } from '@/api/generated/api';
import {
  type ChatDetailDto,
  ChatDetailDtoTitleSource,
  MessageDtoRole,
  MessageDtoStatus,
} from '@/api/generated/model';

export const TITLE_POLL = { INTERVAL_MS: 3000, MAX_TICKS: 10 } as const;

/**
 * While the chat still has its placeholder title and a complete answer exists (that is what starts the title job),
 * ask the server every few seconds for the generated title, at most `MAX_TICKS` times. Not while an answer is running.
 */
export function useTitlePolling(
  chat: Pick<ChatDetailDto, 'id' | 'titleSource' | 'messages'>,
  idle: boolean
): void {
  const queryClient = useQueryClient();
  const waiting =
    idle &&
    chat.titleSource === ChatDetailDtoTitleSource.fallback &&
    chat.messages.some(
      (message) =>
        message.role === MessageDtoRole.assistant && message.status === MessageDtoStatus.complete
    );

  useEffect(() => {
    if (!waiting) return;
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      void queryClient.invalidateQueries({ queryKey: getChatsDetailQueryKey(chat.id) });
      void queryClient.invalidateQueries({ queryKey: getChatsListQueryKey() });
      if (ticks >= TITLE_POLL.MAX_TICKS) window.clearInterval(timer);
    }, TITLE_POLL.INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [waiting, chat.id, queryClient]);
}
