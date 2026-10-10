import { streamText, toUIMessageStream } from 'ai';
import { describe, expect, it } from 'vitest';

import { chatModel, collect } from '../testing/chat-model.js';

interface EndEvent {
  status: string;
  isAborted: boolean;
  parts: unknown[];
}

function uiStreamOf(result: ReturnType<typeof streamText>, ends: EndEvent[]) {
  return toUIMessageStream({
    stream: result.stream,
    onError: () => 'stream_failed',
    onEnd: (event) => {
      ends.push({
        status: event.outcome.status,
        isAborted: event.isAborted,
        parts: event.responseMessage.parts,
      });
    },
  });
}

describe('AI SDK contract the chat builds on (ai 7)', () => {
  it('reports a completed answer with its text and usage', async () => {
    const ends: EndEvent[] = [];
    const result = streamText({ model: chatModel(), prompt: 'x', maxRetries: 0 });

    await collect(uiStreamOf(result, ends));

    expect(ends).toHaveLength(1);
    expect(ends[0]?.status).toBe('completed');
    expect(ends[0]?.isAborted).toBe(false);
    expect(ends[0]?.parts).toContainEqual({ type: 'text', text: 'Hallo Welt', state: 'done' });
    expect(await result.usage).toMatchObject({ inputTokens: 3, outputTokens: 5 });
  });

  it('keeps the partial text when the abort signal fires, and usage rejects', async () => {
    const controller = new AbortController();
    const ends: EndEvent[] = [];
    const result = streamText({
      model: chatModel({ deltas: ['Hallo ', 'Welt ', 'wie ', 'geht ', 'es'], chunkDelayMs: 40 }),
      prompt: 'x',
      maxRetries: 0,
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 110);

    await collect(uiStreamOf(result, ends));

    expect(ends[0]?.status).toBe('aborted');
    expect(ends[0]?.isAborted).toBe(true);
    const text = ends[0]?.parts.find(
      (part): part is { type: 'text'; text: string } =>
        typeof part === 'object' && part !== null && 'type' in part && part.type === 'text'
    );
    expect(text?.text.startsWith('Hallo')).toBe(true);
    expect(text?.text).not.toBe('Hallo Welt wie geht es');
    await expect(Promise.resolve(result.usage)).rejects.toThrow();
  });

  it('throws a broken provider stream through the UI stream and reports outcome failed', async () => {
    const ends: EndEvent[] = [];
    const result = streamText({
      model: chatModel({ failWith: new Error('provider text that must not reach the user') }),
      prompt: 'x',
      maxRetries: 0,
    });

    await expect(collect(uiStreamOf(result, ends))).rejects.toThrow();

    expect(ends[0]?.status).toBe('failed');
  });

  it('hands the abort signal to the model', async () => {
    const controller = new AbortController();
    const model = chatModel();
    await collect(
      uiStreamOf(
        streamText({ model, prompt: 'x', maxRetries: 0, abortSignal: controller.signal }),
        []
      )
    );

    expect(model.doStreamCalls[0]?.abortSignal).toBeDefined();
  });
});
