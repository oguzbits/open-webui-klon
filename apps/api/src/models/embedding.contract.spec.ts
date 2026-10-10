import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embedMany } from 'ai';
import { describe, expect, it } from 'vitest';

interface Call {
  url: string;
  authorization: string | null;
  model: unknown;
  input: unknown;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function embeddingsAnswer(inputs: string[]): Response {
  return new Response(
    JSON.stringify({
      object: 'list',
      model: 'nomic-embed-text',
      data: inputs.map((text, index) => ({
        object: 'embedding',
        index,
        embedding: [text.length, index, 0.5],
      })),
      usage: { prompt_tokens: 7, total_tokens: 7 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

describe('AI SDK contract the embedding service builds on', () => {
  it('sends the model id and the texts through our fetch and returns one vector per text in order', async () => {
    const calls: Call[] = [];
    const provider = createOpenAICompatible({
      name: 'connection-1',
      baseURL: 'http://models.test/v1',
      apiKey: 'sk-test',
      fetch: (input, init) => {
        const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '');
        const parsed = typeof body === 'object' && body !== null ? body : {};
        calls.push({
          url: urlOf(input),
          authorization: new Headers(init?.headers).get('authorization'),
          model: 'model' in parsed ? parsed.model : undefined,
          input: 'input' in parsed ? parsed.input : undefined,
        });
        const inputs = 'input' in parsed && Array.isArray(parsed.input) ? parsed.input : [];
        return Promise.resolve(embeddingsAnswer(inputs.map(String)));
      },
    });

    const result = await embedMany({
      model: provider.embeddingModel('nomic-embed-text'),
      values: ['a', 'bbb', 'cc'],
    });

    expect(calls).toEqual([
      {
        url: 'http://models.test/v1/embeddings',
        authorization: 'Bearer sk-test',
        model: 'nomic-embed-text',
        input: ['a', 'bbb', 'cc'],
      },
    ]);
    expect(result.embeddings).toEqual([
      [1, 0, 0.5],
      [3, 1, 0.5],
      [2, 2, 0.5],
    ]);
    expect(result.usage.tokens).toBe(7);
  });
});
