import { ApiError } from '@/api/fetcher';
import { useChatsDetail } from '@/api/generated/api';
import type { ChatDetailDto } from '@/api/generated/model';

/** One chat with all its messages. The result carries the unwrapped chat (`data` is a `ChatDetailDto`). */
export function useChatDetail(id: string) {
  // The generated error type is `void`; what apiFetch throws is unknown until checked (ApiError for an HTTP status).
  return useChatsDetail<ChatDetailDto, unknown>(id, {
    query: {
      select: (response) => {
        // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
        if (response.status !== 200) throw new ApiError(response.status, 'Unexpected answer');
        return response.data;
      },
    },
  });
}
