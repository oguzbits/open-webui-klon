import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';

import { ApiError } from '@/api/fetcher';
import { chatsList, getChatsListQueryKey } from '@/api/generated/api';

const PAGE_SIZE = 30;

/** The first page has no cursor; an empty string stands for it so the page parameter keeps one type. */
const FIRST_PAGE = '';

/**
 * The chats of the signed-in user, newest first, in pages of the server's cursor. The key starts with the key of the
 * generated list query, so invalidating that one refreshes every search too.
 */
export function useChatList(search: string) {
  const q = search.trim();
  return useInfiniteQuery({
    queryKey: [...getChatsListQueryKey(), { q }],
    initialPageParam: FIRST_PAGE,
    queryFn: async ({ pageParam, signal }) => {
      const response = await chatsList(
        {
          limit: PAGE_SIZE,
          ...(q === '' ? {} : { q }),
          ...(pageParam === FIRST_PAGE ? {} : { cursor: pageParam }),
        },
        { signal }
      );
      // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
      if (response.status !== 200) throw new ApiError(response.status, 'Unexpected answer');
      return response.data;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // While a search is loading, the old list stays instead of flashing a spinner at every key.
    placeholderData: keepPreviousData,
  });
}
