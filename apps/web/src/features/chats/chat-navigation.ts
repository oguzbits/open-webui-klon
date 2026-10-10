const FIRST_MESSAGE = 'firstMessage';

/** Router state for a freshly created chat: its first message, which the chat page sends once on arrival. */
export function firstMessageState(text: string): Record<typeof FIRST_MESSAGE, string> {
  return { [FIRST_MESSAGE]: text };
}

export function readFirstMessage(state: unknown): string | undefined {
  if (typeof state !== 'object' || state === null || !(FIRST_MESSAGE in state)) return undefined;
  const text = state[FIRST_MESSAGE];
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}
