import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';

type StreamResult = Awaited<ReturnType<MockLanguageModelV4['doStream']>>;
type Chunk = StreamResult['stream'] extends ReadableStream<infer C> ? C : never;

export interface ChatModelOptions {
  deltas?: string[];
  /** Pause between two chunks; makes a stream long enough to be cut off. */
  chunkDelayMs?: number;
  /** After the first text, the provider stream breaks with this error. */
  failWith?: Error;
  usage?: { input: number; output: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function head(): Chunk[] {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: '1' },
  ];
}

function textChunks(deltas: string[], usage: { input: number; output: number }): Chunk[] {
  return [
    ...head(),
    ...deltas.map((delta): Chunk => ({ type: 'text-delta', id: '1', delta })),
    { type: 'text-end', id: '1' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: {
          total: usage.input,
          noCache: usage.input,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: usage.output, text: usage.output, reasoning: undefined },
      },
    },
  ];
}

/** A chat model without a network: streams `deltas`, or breaks after the first one when `failWith` is set. */
export function chatModel(options: ChatModelOptions = {}): MockLanguageModelV4 {
  const deltas = options.deltas ?? ['Hallo ', 'Welt'];
  const usage = options.usage ?? { input: 3, output: 5 };
  return new MockLanguageModelV4({
    // The non-streaming call (the title job): the whole text at once, or the failure.
    doGenerate: () => {
      if (options.failWith !== undefined) return Promise.reject(options.failWith);
      return Promise.resolve({
        content: [{ type: 'text', text: deltas.join('') }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: {
            total: usage.input,
            noCache: usage.input,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: usage.output, text: usage.output, reasoning: undefined },
        },
        warnings: [],
      });
    },
    doStream: () => {
      if (options.failWith !== undefined) {
        const failure = options.failWith;
        const queued: Chunk[] = [
          ...head(),
          { type: 'text-delta', id: '1', delta: deltas[0] ?? '' },
        ];
        let index = 0;
        return Promise.resolve({
          stream: new ReadableStream<Chunk>({
            async pull(controller) {
              const next = queued[index];
              if (next !== undefined) {
                index += 1;
                controller.enqueue(next);
                return;
              }
              await sleep(10);
              controller.error(failure);
            },
          }),
        });
      }
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks: textChunks(deltas, usage),
          initialDelayInMs: null,
          chunkDelayInMs: options.chunkDelayMs ?? null,
        }),
      });
    },
  });
}

export async function collect(stream: ReadableStream<unknown>): Promise<unknown[]> {
  const reader = stream.getReader();
  const chunks: unknown[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}
