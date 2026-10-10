import { errorMessageKey } from '@/api/error-message';
import { ApiError } from '@/api/fetcher';

/**
 * The only error text the server sends inside a stream (`STREAM_ERROR_TEXT` in the API's chat-dictionaries.ts): never
 * the provider's own words. The two values are one contract; the browser check in Task 11 covers the pair.
 */
export const STREAM_ERROR_TEXT = 'stream_failed';

/** An error that came through an open stream (the answer is stored with status `error`), not a failed request. */
export function isStreamFailure(error: unknown): boolean {
  return (
    error instanceof Error && !(error instanceof ApiError) && error.message === STREAM_ERROR_TEXT
  );
}

/** The i18n key for whatever went wrong while sending, regenerating or changing a chat. */
export function chatErrorKey(error: unknown): string {
  if (isStreamFailure(error)) return 'chats.error.streamFailed';
  return errorMessageKey(error, {
    404: 'chats.error.gone',
    422: 'chats.error.tooLong',
    429: 'chats.error.tooManyStreams',
  });
}
