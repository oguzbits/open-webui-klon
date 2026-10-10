import {
  MESSAGE_ROLE,
  MESSAGE_STATUS,
  type MessageRole,
  type MessageStatus,
} from './chat-dictionaries.js';
import type { MessagePart } from './chat-params.js';

export interface HistoryRow {
  role: MessageRole;
  status: MessageStatus;
  parts: MessagePart[];
}

export interface UiHistoryMessage {
  role: MessageRole;
  parts: MessagePart[];
}

export function textOf(parts: MessagePart[]): string {
  return parts.map((part) => part.text).join('');
}

/**
 * The messages that go to the model, oldest first. Failed answers and answers without text are left out (some
 * providers refuse empty turns). The oldest messages are cut first until `maxChars` fits; the newest message
 * always stays, and the history starts with a user message.
 */
export function buildHistory(rows: HistoryRow[], maxChars: number): UiHistoryMessage[] {
  const usable = rows.filter(
    (row) => row.status !== MESSAGE_STATUS.ERROR && textOf(row.parts).length > 0
  );

  const kept: UiHistoryMessage[] = [];
  let total = 0;
  for (let index = usable.length - 1; index >= 0; index -= 1) {
    const row = usable[index];
    if (row === undefined) continue;
    const size = textOf(row.parts).length;
    if (kept.length > 0 && total + size > maxChars) break;
    total += size;
    kept.unshift({ role: row.role, parts: row.parts });
  }
  while (kept.length > 1 && kept[0]?.role !== MESSAGE_ROLE.USER) kept.shift();
  return kept;
}
