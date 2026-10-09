import { ApiError } from '@/api/fetcher';
import { useModelsList } from '@/api/generated/api';

/**
 * The models the signed-in user may use, plus the connections that did not answer. The result carries the
 * unwrapped list (`data.models`, `data.unavailableConnections`). Chat (Teilprojekt 3) reuses this hook.
 */
export function useModels() {
  return useModelsList({
    query: {
      select: (response) => {
        // Only 200 is ever returned here (apiFetch throws the rest); anything else is shown as a failed load.
        if (response.status !== 200) throw new ApiError(response.status, 'Unexpected answer');
        return response.data;
      },
    },
  });
}
