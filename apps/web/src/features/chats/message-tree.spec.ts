import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { MessageDtoRole } from '@/api/generated/model';
import { chatTime, messageDto, textParts } from '@/test/fixtures';

import { activePath, branchesOf, messageText, serverMessageId, toUiMessage } from './message-tree';

const U1 = messageDto({ id: 'u1', parentId: null, createdAt: chatTime(0) });
const A1 = messageDto({
  id: 'a1',
  parentId: 'u1',
  role: MessageDtoRole.assistant,
  createdAt: chatTime(1),
});
const U2 = messageDto({ id: 'u2', parentId: 'a1', createdAt: chatTime(2) });
const A2 = messageDto({
  id: 'a2',
  parentId: 'u2',
  role: MessageDtoRole.assistant,
  createdAt: chatTime(3),
});
// A regenerated answer to u1 and an edited first question: siblings in the tree.
const A1B = messageDto({
  id: 'a1b',
  parentId: 'u1',
  role: MessageDtoRole.assistant,
  createdAt: chatTime(4),
});
const U1E = messageDto({ id: 'u1e', parentId: null, createdAt: chatTime(5) });
const ALL = [U1, A1, U2, A2, A1B, U1E];

function ids(messages: { id: string }[]): string[] {
  return messages.map((message) => message.id);
}

describe('activePath', () => {
  it('walks from the active leaf up to the first message and returns it in order', () => {
    expect(ids(activePath({ messages: ALL, activeLeafId: 'a2' }))).toEqual([
      'u1',
      'a1',
      'u2',
      'a2',
    ]);
  });

  it('follows the other branch when the leaf lies there', () => {
    expect(ids(activePath({ messages: ALL, activeLeafId: 'a1b' }))).toEqual(['u1', 'a1b']);
    expect(ids(activePath({ messages: ALL, activeLeafId: 'u1e' }))).toEqual(['u1e']);
  });

  it('is empty without an active leaf', () => {
    expect(activePath({ messages: [], activeLeafId: null })).toEqual([]);
  });

  it('fails on a tree whose parent is missing instead of showing half a chat', () => {
    const orphan = messageDto({ id: 'x', parentId: 'gone' });

    expect(() => activePath({ messages: [orphan], activeLeafId: 'x' })).toThrow(/missing parent/);
  });

  it('fails on a cycle instead of looping forever', () => {
    const a = messageDto({ id: 'a', parentId: 'b' });
    const b = messageDto({ id: 'b', parentId: 'a' });

    expect(() => activePath({ messages: [a, b], activeLeafId: 'a' })).toThrow(/cycle/);
  });
});

describe('branchesOf', () => {
  const branches = branchesOf(ALL);

  it('numbers the answers that share one question, oldest first', () => {
    expect(branches.get('a1')).toEqual({ index: 0, count: 2, previousId: null, nextId: 'a1b' });
    expect(branches.get('a1b')).toEqual({ index: 1, count: 2, previousId: 'a1', nextId: null });
  });

  it('treats the first messages of a chat as siblings of each other', () => {
    expect(branches.get('u1')).toEqual({ index: 0, count: 2, previousId: null, nextId: 'u1e' });
    expect(branches.get('u1e')?.index).toBe(1);
  });

  it('gives a message without siblings a single position', () => {
    expect(branches.get('u2')).toEqual({ index: 0, count: 1, previousId: null, nextId: null });
  });

  it('orders by creation time and falls back to the id for equal times', () => {
    const x = messageDto({ id: 'b', parentId: 'p', createdAt: chatTime(7) });
    const y = messageDto({ id: 'a', parentId: 'p', createdAt: chatTime(7) });

    const result = branchesOf([x, y]);

    expect(result.get('a')?.index).toBe(0);
    expect(result.get('b')?.index).toBe(1);
  });
});

describe('message conversion', () => {
  it('turns a stored message into a finished UI message', () => {
    const message = messageDto({
      id: 'a1',
      role: MessageDtoRole.assistant,
      parts: textParts('Hi'),
    });

    expect(toUiMessage(message)).toEqual({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hi', state: 'done' }],
    });
  });

  it('joins the text parts and ignores parts that are not text', () => {
    const message: Pick<UIMessage, 'parts'> = {
      parts: [
        { type: 'text', text: 'Hallo ' },
        { type: 'step-start' },
        { type: 'text', text: 'Welt' },
      ],
    };

    expect(messageText(message)).toBe('Hallo Welt');
  });
});

describe('serverMessageId', () => {
  it('takes the id the server announced in the metadata of a streamed answer', () => {
    const streamed: UIMessage = {
      id: 'local-1',
      role: 'assistant',
      parts: [],
      metadata: { userMessageId: 'u-srv', assistantMessageId: 'a-srv' },
    };

    expect(serverMessageId(streamed)).toBe('a-srv');
  });

  it('uses the own id for a loaded answer, a user message and unusable metadata', () => {
    expect(serverMessageId({ id: 'a1', role: 'assistant', parts: [] })).toBe('a1');
    expect(
      serverMessageId({
        id: 'u1',
        role: 'user',
        parts: [],
        metadata: { assistantMessageId: 'ignored' },
      })
    ).toBe('u1');
    expect(
      serverMessageId({
        id: 'a2',
        role: 'assistant',
        parts: [],
        metadata: { assistantMessageId: 7 },
      })
    ).toBe('a2');
  });
});
