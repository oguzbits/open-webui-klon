import { PROVIDER_ERROR } from '../http/safe-fetch/provider-error.js';

export const MESSAGE_ROLE = { USER: 'user', ASSISTANT: 'assistant' } as const;
export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

export const MESSAGE_STATUS = { COMPLETE: 'complete', ABORTED: 'aborted', ERROR: 'error' } as const;
export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];

export const CHAT_TITLE_SOURCE = {
  FALLBACK: 'fallback',
  GENERATED: 'generated',
  USER: 'user',
} as const;
export type ChatTitleSource = (typeof CHAT_TITLE_SOURCE)[keyof typeof CHAT_TITLE_SOURCE];

export const CHAT_JOB = { GENERATE_TITLE: 'chat.generate-title' } as const;

/** The only error text that reaches the client from inside a stream; the web app maps it to a message. */
export const STREAM_ERROR_TEXT = 'stream_failed';

/** Coarse reason stored with a failed answer: a provider reason (`PROVIDER_ERROR`) or `internal`. */
export const MESSAGE_ERROR_REASON = { ...PROVIDER_ERROR, INTERNAL: 'internal' } as const;
