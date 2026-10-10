import { describe, expect, it } from 'vitest';

import { MESSAGE_ROLE, MESSAGE_STATUS } from './chat-dictionaries.js';
import { buildHistory, type HistoryRow, textOf } from './chat-history.js';

function row(
  role: HistoryRow['role'],
  text: string,
  status: HistoryRow['status'] = MESSAGE_STATUS.COMPLETE
): HistoryRow {
  return { role, status, parts: text === '' ? [] : [{ type: 'text', text }] };
}

describe('buildHistory', () => {
  it('keeps order and roles', () => {
    const history = buildHistory(
      [row(MESSAGE_ROLE.USER, 'a'), row(MESSAGE_ROLE.ASSISTANT, 'b'), row(MESSAGE_ROLE.USER, 'c')],
      1000
    );

    expect(history.map((message) => [message.role, textOf(message.parts)])).toEqual([
      ['user', 'a'],
      ['assistant', 'b'],
      ['user', 'c'],
    ]);
  });

  it('keeps an aborted answer with text but drops failed answers and empty ones', () => {
    const history = buildHistory(
      [
        row(MESSAGE_ROLE.USER, 'a'),
        row(MESSAGE_ROLE.ASSISTANT, 'halb', MESSAGE_STATUS.ABORTED),
        row(MESSAGE_ROLE.USER, 'b'),
        row(MESSAGE_ROLE.ASSISTANT, 'kaputt', MESSAGE_STATUS.ERROR),
        row(MESSAGE_ROLE.USER, 'c'),
        row(MESSAGE_ROLE.ASSISTANT, '', MESSAGE_STATUS.ABORTED),
        row(MESSAGE_ROLE.USER, 'd'),
      ],
      1000
    );

    expect(history.map((message) => textOf(message.parts))).toEqual(['a', 'halb', 'b', 'c', 'd']);
  });

  it('cuts the oldest messages first, always keeps the newest one and starts with a user message', () => {
    const history = buildHistory(
      [
        row(MESSAGE_ROLE.USER, 'x'.repeat(40)),
        row(MESSAGE_ROLE.ASSISTANT, 'y'.repeat(40)),
        row(MESSAGE_ROLE.USER, 'z'.repeat(40)),
      ],
      60
    );

    expect(history.map((message) => message.role)).toEqual(['user']);
    expect(textOf(history[0]?.parts ?? [])).toBe('z'.repeat(40));
  });

  it('drops a leading answer that the cut left behind', () => {
    const history = buildHistory(
      [
        row(MESSAGE_ROLE.USER, 'x'.repeat(40)),
        row(MESSAGE_ROLE.ASSISTANT, 'y'.repeat(20)),
        row(MESSAGE_ROLE.USER, 'z'.repeat(20)),
      ],
      45
    );

    expect(history.map((message) => message.role)).toEqual(['user']);
    expect(textOf(history[0]?.parts ?? [])).toBe('z'.repeat(20));
  });

  it('keeps the newest message even when it alone is over the limit', () => {
    const history = buildHistory([row(MESSAGE_ROLE.USER, 'x'.repeat(500))], 10);

    expect(history).toHaveLength(1);
  });
});
