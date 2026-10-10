import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getChatsDetailQueryKey, getChatsListQueryKey } from '@/api/generated/api';
import {
  type ChatDetailDto,
  ChatDetailDtoTitleSource,
  MessageDtoRole,
  MessageDtoStatus,
} from '@/api/generated/model';
import { createQueryClient } from '@/app/providers';
import { chatDetailDto, messageDto } from '@/test/fixtures';

import { TITLE_POLL, useTitlePolling } from './use-title-polling';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const QUESTION = messageDto({ id: 'u1' });
const ANSWER = messageDto({ id: 'a1', parentId: 'u1', role: MessageDtoRole.assistant });

function waitingChat(overrides: Partial<ChatDetailDto> = {}): ChatDetailDto {
  return chatDetailDto({
    id: 'c-1',
    titleSource: ChatDetailDtoTitleSource.fallback,
    messages: [QUESTION, ANSWER],
    activeLeafId: 'a1',
    ...overrides,
  });
}

function setup(chat: ChatDetailDto, idle = true) {
  const queryClient = createQueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const view = renderHook(
    (props: { chat: ChatDetailDto; idle: boolean }) => {
      useTitlePolling(props.chat, props.idle);
    },
    {
      initialProps: { chat, idle },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    }
  );
  return { invalidate, ...view };
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useTitlePolling', () => {
  it('refreshes the chat and the list every few seconds while the title is the placeholder', () => {
    const { invalidate } = setup(waitingChat());

    advance(TITLE_POLL.INTERVAL_MS - 1);
    expect(invalidate).not.toHaveBeenCalled();

    advance(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: getChatsDetailQueryKey('c-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: getChatsListQueryKey() });
  });

  it('gives up after the maximum number of tries', () => {
    const { invalidate } = setup(waitingChat());

    advance(TITLE_POLL.INTERVAL_MS * (TITLE_POLL.MAX_TICKS + 5));

    expect(invalidate).toHaveBeenCalledTimes(TITLE_POLL.MAX_TICKS * 2);
  });

  it.each([ChatDetailDtoTitleSource.generated, ChatDetailDtoTitleSource.user])(
    'does not ask when the title is %s',
    (titleSource) => {
      const { invalidate } = setup(waitingChat({ titleSource }));

      advance(TITLE_POLL.INTERVAL_MS * 3);

      expect(invalidate).not.toHaveBeenCalled();
    }
  );

  it.each([MessageDtoStatus.aborted, MessageDtoStatus.error])(
    'does not ask when the only answer is %s: no title job runs for it',
    (status) => {
      const { invalidate } = setup(waitingChat({ messages: [QUESTION, { ...ANSWER, status }] }));

      advance(TITLE_POLL.INTERVAL_MS * 3);

      expect(invalidate).not.toHaveBeenCalled();
    }
  );

  it('does not ask before there is an answer', () => {
    const { invalidate } = setup(waitingChat({ messages: [QUESTION], activeLeafId: 'u1' }));

    advance(TITLE_POLL.INTERVAL_MS * 3);

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('waits while an answer is running and starts when the chat is idle', () => {
    const { invalidate, rerender } = setup(waitingChat(), false);

    advance(TITLE_POLL.INTERVAL_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();

    rerender({ chat: waitingChat(), idle: true });
    advance(TITLE_POLL.INTERVAL_MS);
    expect(invalidate).toHaveBeenCalled();
  });

  it('stops as soon as the generated title has arrived', () => {
    const { invalidate, rerender } = setup(waitingChat());
    advance(TITLE_POLL.INTERVAL_MS);
    const calls = invalidate.mock.calls.length;

    rerender({
      chat: waitingChat({ titleSource: ChatDetailDtoTitleSource.generated }),
      idle: true,
    });
    advance(TITLE_POLL.INTERVAL_MS * 3);

    expect(invalidate).toHaveBeenCalledTimes(calls);
  });
});
