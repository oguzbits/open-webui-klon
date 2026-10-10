import { DefaultChatTransport, type UIMessage } from 'ai';

import { readApiError } from '@/api/fetcher';
import type { StreamChatDto } from '@/api/generated/model';
import { csrfHeaderFor, notifyUnauthorized } from '@/api/session-state';
import { createTraceparent } from '@/api/trace';

import { messageText, serverMessageId } from './message-tree';

/** The two ways `useChat` asks the transport to send (values of the AI SDK's `trigger`). */
const TRIGGER = { SUBMIT: 'submit-message', REGENERATE: 'regenerate-message' } as const;

/**
 * `fetch` for the chat stream. The session rules of `apiFetch` (cookie, token of the session on writes, trace, a 401
 * ends the session, a failure is an `ApiError`), but the body of a good answer stays a stream.
 */
export async function chatFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('traceparent', createTraceparent());
  const token = csrfHeaderFor(init.method ?? 'POST');
  if (token !== undefined) headers.set('X-CSRF-Token', token);

  const response = await fetch(input, { ...init, headers, credentials: 'include' });
  if (!response.ok) {
    if (response.status === 401) notifyUnauthorized();
    throw await readApiError(response);
  }
  return response;
}

/** Only the new text and where it hangs: the server builds the history from its own tree (ADR 0004). */
function sendBody(messages: UIMessage[]): StreamChatDto {
  const last = messages.at(-1);
  if (last?.role !== 'user') throw new Error('The last message of a send must be a user message');
  const previous = messages.at(-2);
  return {
    parentId: previous === undefined ? null : serverMessageId(previous),
    text: messageText(last),
  };
}

export function createChatTransport(chatId: string): DefaultChatTransport<UIMessage> {
  const chat = encodeURIComponent(chatId);
  return new DefaultChatTransport<UIMessage>({
    api: `/api/chats/${chat}/stream`,
    credentials: 'include',
    fetch: chatFetch,
    prepareSendMessagesRequest: ({ messages, trigger, messageId }) => {
      if (trigger === TRIGGER.REGENERATE) {
        if (messageId === undefined) throw new Error('Regenerating needs the id of the answer');
        return {
          api: `/api/chats/${chat}/messages/${encodeURIComponent(messageId)}/regenerate`,
          body: {},
        };
      }
      return { body: sendBody(messages) };
    },
  });
}
