import type { UIMessage } from 'ai';

import type { ChatDetailDto, MessageDto } from '@/api/generated/model';

/** The server keeps the tree consistent (foreign keys, tree rules); a broken one is an error, not a smaller chat. */
export function activePath(chat: Pick<ChatDetailDto, 'messages' | 'activeLeafId'>): MessageDto[] {
  if (chat.activeLeafId === null) return [];
  const byId = new Map(chat.messages.map((message) => [message.id, message]));
  const path: MessageDto[] = [];
  const seen = new Set<string>();
  let current: string | null = chat.activeLeafId;
  while (current !== null) {
    if (seen.has(current)) throw new Error('The message tree has a cycle');
    seen.add(current);
    const message = byId.get(current);
    if (message === undefined) throw new Error('The message tree has a missing parent');
    path.push(message);
    current = message.parentId;
  }
  return path.reverse();
}

export interface Branch {
  index: number;
  count: number;
  previousId: string | null;
  nextId: string | null;
}

function bySiblingOrder(a: MessageDto, b: MessageDto): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

/**
 * Where each message stands among the messages that share its parent: regenerated answers under one question,
 * edited questions under one answer, edited first messages of a chat. Computed once per loaded chat.
 */
export function branchesOf(messages: MessageDto[]): Map<string, Branch> {
  const groups = new Map<string | null, MessageDto[]>();
  for (const message of messages) {
    const group = groups.get(message.parentId);
    if (group === undefined) groups.set(message.parentId, [message]);
    else group.push(message);
  }
  const branches = new Map<string, Branch>();
  for (const group of groups.values()) {
    group.sort(bySiblingOrder);
    group.forEach((message, index) => {
      branches.set(message.id, {
        index,
        count: group.length,
        previousId: group[index - 1]?.id ?? null,
        nextId: group[index + 1]?.id ?? null,
      });
    });
  }
  return branches;
}

export function toUiMessage(message: MessageDto): UIMessage {
  return {
    id: message.id,
    role: message.role,
    parts: message.parts.map((part) => ({
      type: 'text' as const,
      text: part.text,
      state: 'done' as const,
    })),
  };
}

export function messageText(message: Pick<UIMessage, 'parts'>): string {
  return message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('');
}

/**
 * A streamed answer carries the id the server stored it under in its metadata (first part of the stream); its own id
 * is a local one until the chat is reloaded. Every other message already has the server's id.
 */
export function serverMessageId(message: UIMessage): string {
  const metadata: unknown = message.metadata;
  if (
    message.role === 'assistant' &&
    typeof metadata === 'object' &&
    metadata !== null &&
    'assistantMessageId' in metadata &&
    typeof metadata.assistantMessageId === 'string'
  ) {
    return metadata.assistantMessageId;
  }
  return message.id;
}
