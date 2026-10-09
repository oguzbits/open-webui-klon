import { useHealthReady } from '@/api/generated/api';

/** One place for the polling policy: no automatic retries (the retry button is the retry), refresh every 30 s. */
export function useApiHealth() {
  return useHealthReady({ query: { retry: false, refetchInterval: 30_000 } });
}
