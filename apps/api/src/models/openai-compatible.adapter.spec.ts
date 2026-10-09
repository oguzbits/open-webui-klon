import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { parseAllowedHost } from '../http/safe-fetch/address-policy.js';
import { PROVIDER_ERROR, ProviderError } from '../http/safe-fetch/provider-error.js';
import {
  PROVIDER_FETCH_DEFAULTS,
  ProviderFetchService,
} from '../http/safe-fetch/provider-fetch.service.js';
import { FAKE_MODE, FakeProvider } from '../testing/fake-provider.js';
import { asV4 } from '../testing/v4-model.js';
import { OpenAiCompatibleAdapter } from './openai-compatible.adapter.js';
import type { ProviderTarget } from './provider-adapter.js';

const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'ping' }] }];
const providers: FakeProvider[] = [];

async function startProvider(): Promise<FakeProvider> {
  const provider = await FakeProvider.start();
  providers.push(provider);
  return provider;
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

function adapter(allowedHosts: string[] = ['127.0.0.1']): OpenAiCompatibleAdapter {
  return new OpenAiCompatibleAdapter(
    new ProviderFetchService({
      ...PROVIDER_FETCH_DEFAULTS,
      timeoutMs: 1000,
      allowedHosts: allowedHosts.map(parseAllowedHost),
    })
  );
}

function targetFor(provider: FakeProvider, apiKey?: string): ProviderTarget {
  return { connectionId: randomUUID(), baseUrl: `${provider.url}/v1`, apiKey };
}

async function failureOf(work: PromiseLike<unknown>): Promise<ProviderError> {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!(outcome instanceof ProviderError)) throw new Error('expected a ProviderError');
  return outcome;
}

describe('OpenAiCompatibleAdapter: model list', () => {
  it('reads the ids from /models below the base URL', async () => {
    const provider = await startProvider();

    const models = await adapter().listModels(targetFor(provider));

    expect(models).toEqual([
      { id: 'llama3:8b', name: 'llama3:8b' },
      { id: 'mistral:7b', name: 'mistral:7b' },
    ]);
    expect(provider.requests.map((request) => request.path)).toEqual(['/v1/models']);
  });

  it('sends the key as a Bearer token and reports a refused key as UNAUTHORIZED', async () => {
    const provider = await startProvider();
    provider.requiredKey = 'sk-secret';

    await adapter().listModels(targetFor(provider, 'sk-secret'));

    expect(provider.requests[0]?.authorization).toBe('Bearer sk-secret');
    expect((await failureOf(adapter().listModels(targetFor(provider, 'sk-wrong')))).reason).toBe(
      PROVIDER_ERROR.UNAUTHORIZED
    );
  });

  it('turns an answer in the wrong format into BAD_RESPONSE', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.WRONG_SHAPE;

    expect((await failureOf(adapter().listModels(targetFor(provider)))).reason).toBe(
      PROVIDER_ERROR.BAD_RESPONSE
    );
  });

  it('turns an HTML login page into BAD_RESPONSE', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.HTML;

    expect((await failureOf(adapter().listModels(targetFor(provider)))).reason).toBe(
      PROVIDER_ERROR.BAD_RESPONSE
    );
  });
});

describe('OpenAiCompatibleAdapter: language model', () => {
  it('calls {base}/chat/completions with the raw model id and the key', async () => {
    const provider = await startProvider();
    const target = targetFor(provider, 'sk-secret');

    const model = asV4(adapter().languageModel(target, 'gpt-4o'));
    await model.doGenerate({ prompt: PROMPT });

    expect(model.modelId).toBe('gpt-4o');
    expect(model.provider).toBe(`${target.connectionId}.chat`);
    const request = provider.requests[0];
    expect(request?.path).toBe('/v1/chat/completions');
    expect(request?.authorization).toBe('Bearer sk-secret');
    expect(JSON.parse(request?.body ?? '{}')).toMatchObject({ model: 'gpt-4o' });
  });

  it('sends no Authorization header without a key', async () => {
    const provider = await startProvider();

    await asV4(adapter().languageModel(targetFor(provider), 'gpt-4o')).doGenerate({
      prompt: PROMPT,
    });

    expect(provider.requests[0]?.authorization).toBeUndefined();
  });

  it('refuses a host that is not allowed, without a request', async () => {
    const provider = await startProvider();
    const model = asV4(adapter([]).languageModel(targetFor(provider), 'gpt-4o'));

    const error = await failureOf(model.doGenerate({ prompt: PROMPT }));

    expect(error.reason).toBe(PROVIDER_ERROR.BLOCKED_HOST);
    expect(provider.requests).toHaveLength(0);
  });
});
