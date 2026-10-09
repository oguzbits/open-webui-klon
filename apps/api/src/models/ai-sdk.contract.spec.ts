import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  model: unknown;
}

function chatCompletion(): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'llama3:8b',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'ping' }] }];

describe('AI SDK contract the model registry builds on', () => {
  it('sends model id, key and request through the fetch we hand in', async () => {
    const calls: Call[] = [];
    const provider = createOpenAICompatible({
      name: 'connection-1',
      baseURL: 'http://models.test/v1',
      apiKey: 'sk-test',
      fetch: (input, init) => {
        const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '');
        calls.push({
          url: urlOf(input),
          method: init?.method,
          authorization: new Headers(init?.headers).get('authorization'),
          model:
            typeof body === 'object' && body !== null && 'model' in body ? body.model : undefined,
        });
        return Promise.resolve(chatCompletion());
      },
    });

    const model = provider.languageModel('llama3:8b');
    const asLanguageModel: LanguageModel = model;
    const result = await model.doGenerate({ prompt: PROMPT });

    expect(asLanguageModel).toBe(model);
    expect(model.provider).toBe('connection-1.chat');
    expect(model.modelId).toBe('llama3:8b');
    expect(calls).toEqual([
      {
        url: 'http://models.test/v1/chat/completions',
        method: 'POST',
        authorization: 'Bearer sk-test',
        model: 'llama3:8b',
      },
    ]);
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);
  });

  it('sends no Authorization header without a key', async () => {
    let authorization: string | null = 'unset';
    const provider = createOpenAICompatible({
      name: 'connection-2',
      baseURL: 'http://models.test/v1',
      fetch: (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization');
        return Promise.resolve(chatCompletion());
      },
    });

    await provider.languageModel('m').doGenerate({ prompt: PROMPT });

    expect(authorization).toBeNull();
  });

  it('lets an error thrown by our fetch reach the caller unchanged', async () => {
    class Blocked extends Error {
      readonly reason = 'blocked_host';
    }
    const provider = createOpenAICompatible({
      name: 'connection-3',
      baseURL: 'http://models.test/v1',
      fetch: () => Promise.reject(new Blocked('no')),
    });

    await expect(provider.languageModel('m').doGenerate({ prompt: PROMPT })).rejects.toBeInstanceOf(
      Blocked
    );
  });

  it('ships a v4 mock model for the chat tests of Teilprojekt 3', () => {
    const mock: LanguageModel = new MockLanguageModelV4();

    expect(typeof mock === 'string' ? mock : mock.specificationVersion).toBe('v4');
  });
});
