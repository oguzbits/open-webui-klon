import type { LookupAddress } from 'node:dns';
import { afterEach, describe, expect, it } from 'vitest';

import { FAKE_MODE, FakeProvider } from '../../testing/fake-provider.js';
import { parseAllowedHost } from './address-policy.js';
import { PROVIDER_ERROR, ProviderError, type ProviderErrorReason } from './provider-error.js';
import {
  PROVIDER_FETCH_DEFAULTS,
  ProviderFetchService,
  type ProviderFetchOptions,
} from './provider-fetch.service.js';

const providers: FakeProvider[] = [];

async function startProvider(): Promise<FakeProvider> {
  const provider = await FakeProvider.start();
  providers.push(provider);
  return provider;
}

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

function addresses(...list: string[]): LookupAddress[] {
  return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

function fakeLookup(table: Record<string, string[]>): ProviderFetchOptions['lookup'] {
  return (hostname) => {
    const found = table[hostname];
    return found === undefined
      ? Promise.reject(new Error('ENOTFOUND'))
      : Promise.resolve(addresses(...found));
  };
}

/** Test servers listen on loopback, so the tests list exactly that host. */
function service(overrides: Partial<ProviderFetchOptions> = {}): ProviderFetchService {
  return new ProviderFetchService({
    ...PROVIDER_FETCH_DEFAULTS,
    timeoutMs: 1000,
    maxJsonBytes: 1024,
    allowedHosts: ['127.0.0.1', 'models.test'].map(parseAllowedHost),
    lookup: fakeLookup({ 'models.test': ['127.0.0.1'] }),
    ...overrides,
  });
}

async function reasonOf(promise: Promise<unknown>): Promise<ProviderErrorReason | 'resolved'> {
  const outcome = await promise.then(
    () => undefined,
    (error: unknown) => error
  );
  if (outcome === undefined) return 'resolved';
  if (!(outcome instanceof ProviderError)) {
    throw outcome instanceof Error ? outcome : new Error('unexpected rejection');
  }
  return outcome.reason;
}

describe('ProviderFetchService: reading a list', () => {
  it('returns the parsed JSON of an allowed host', async () => {
    const provider = await startProvider();

    const json = await service().getJson(provider.url, '/api/tags', undefined);

    expect(json).toMatchObject({ models: [{ name: 'llama3:8b' }, { name: 'mistral:7b' }] });
  });

  it('sends the key as a Bearer token, and no header without a key', async () => {
    const provider = await startProvider();
    provider.requiredKey = 'sk-secret';

    await service().getJson(provider.url, '/v1/models', 'sk-secret');
    expect(provider.requests.at(-1)?.authorization).toBe('Bearer sk-secret');

    expect(await reasonOf(service().getJson(provider.url, '/v1/models', undefined))).toBe(
      PROVIDER_ERROR.UNAUTHORIZED
    );
    expect(await reasonOf(service().getJson(provider.url, '/v1/models', 'sk-wrong'))).toBe(
      PROVIDER_ERROR.UNAUTHORIZED
    );
  });
});

describe('ProviderFetchService: which hosts may be reached', () => {
  it('refuses a loopback host that is not on the list, without connecting', async () => {
    const provider = await startProvider();

    const reason = await reasonOf(
      service({ allowedHosts: [] }).getJson(provider.url, '/api/tags', undefined)
    );

    expect(reason).toBe(PROVIDER_ERROR.BLOCKED_HOST);
    expect(provider.requests).toHaveLength(0);
  });

  it('lets a listed host:port through only on that port', async () => {
    const provider = await startProvider();
    const wrongPort = [parseAllowedHost(`127.0.0.1:${provider.port + 1}`)];
    const rightPort = [parseAllowedHost(`127.0.0.1:${provider.port}`)];

    expect(
      await reasonOf(
        service({ allowedHosts: wrongPort }).getJson(provider.url, '/api/tags', undefined)
      )
    ).toBe(PROVIDER_ERROR.BLOCKED_HOST);
    expect(
      await reasonOf(
        service({ allowedHosts: rightPort }).getJson(provider.url, '/api/tags', undefined)
      )
    ).toBe('resolved');
  });

  it.each(['169.254.169.254', '[fe80::1]', '0.0.0.0', '[::ffff:169.254.169.254]'])(
    'never reaches %s, even when it is on the list',
    async (host) => {
      const listed = service({ allowedHosts: [parseAllowedHost(host)] });

      expect(await reasonOf(listed.getJson(`http://${host}`, '/latest/meta-data', undefined))).toBe(
        PROVIDER_ERROR.BLOCKED_HOST
      );
    }
  );

  it('checks every address a name resolves to', async () => {
    const mixed = service({
      allowedHosts: [],
      lookup: fakeLookup({ 'mixed.test': ['93.184.216.34', '10.0.0.5'] }),
    });

    expect(await reasonOf(mixed.getJson('http://mixed.test', '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.BLOCKED_HOST
    );
  });

  it('checks again on every call, not only when the connection was saved', async () => {
    const provider = await startProvider();
    const answers = [['127.0.0.1'], ['169.254.169.254']];
    const rebinding = service({
      lookup: () => Promise.resolve(addresses(...(answers.shift() ?? []))),
    });
    const base = `http://models.test:${provider.port}`;

    expect(await reasonOf(rebinding.getJson(base, '/api/tags', undefined))).toBe('resolved');
    expect(await reasonOf(rebinding.getJson(base, '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.BLOCKED_HOST
    );
    expect(provider.requests).toHaveLength(1);
  });

  it('resolves the name once per call and connects to the address it validated', async () => {
    const provider = await startProvider();
    let lookups = 0;
    const counting = service({
      lookup: (hostname) => {
        lookups += 1;
        return fakeLookup({ 'models.test': ['127.0.0.1'] })(hostname);
      },
    });

    await counting.getJson(`http://models.test:${provider.port}`, '/api/tags', undefined);

    expect(lookups).toBe(1);
    expect(provider.requests[0]?.host).toBe(`models.test:${provider.port}`);
  });

  it('assertHostAllowed accepts a good host and refuses a bad or unknown one', async () => {
    const provider = await startProvider();

    await expect(service().assertHostAllowed(provider.url)).resolves.toBeUndefined();
    expect(await reasonOf(service({ allowedHosts: [] }).assertHostAllowed(provider.url))).toBe(
      PROVIDER_ERROR.BLOCKED_HOST
    );
    expect(await reasonOf(service().assertHostAllowed('http://unknown.test'))).toBe(
      PROVIDER_ERROR.UNREACHABLE
    );
  });
});

describe('ProviderFetchService: redirects and origin', () => {
  it('treats a redirect as an error and never follows it (the key stays with the connection host)', async () => {
    const provider = await startProvider();
    const elsewhere = await startProvider();
    provider.mode = FAKE_MODE.REDIRECT;
    provider.redirectTo = `${elsewhere.url}/api/tags`;

    const reason = await reasonOf(service().getJson(provider.url, '/api/tags', 'sk-secret'));

    expect(reason).toBe(PROVIDER_ERROR.BAD_RESPONSE);
    expect(elsewhere.requests).toHaveLength(0);
  });

  it('refuses a target on another origin than the connection', async () => {
    const provider = await startProvider();
    const fetchForConnection = service().createFetch(provider.url);

    for (const target of [
      'http://127.0.0.1:1/x',
      `https://127.0.0.1:${provider.port}/x`,
      'http://models.test/x',
    ]) {
      expect(await reasonOf(fetchForConnection(target))).toBe(PROVIDER_ERROR.BLOCKED_HOST);
    }
    expect(provider.requests).toHaveLength(0);
  });

  it('accepts URLs only, not Request objects', async () => {
    const provider = await startProvider();
    const fetchForConnection = service().createFetch(provider.url);

    await expect(fetchForConnection(new Request(`${provider.url}/api/tags`))).rejects.toThrow(
      TypeError
    );
  });
});

describe('ProviderFetchService: answers it does not trust', () => {
  it.each([
    [FAKE_MODE.UNAUTHORIZED, PROVIDER_ERROR.UNAUTHORIZED],
    [FAKE_MODE.SERVER_ERROR, PROVIDER_ERROR.BAD_RESPONSE],
    [FAKE_MODE.HTML, PROVIDER_ERROR.BAD_RESPONSE],
    [FAKE_MODE.GARBAGE, PROVIDER_ERROR.BAD_RESPONSE],
    [FAKE_MODE.OVERSIZED, PROVIDER_ERROR.BAD_RESPONSE],
    [FAKE_MODE.OVERSIZED_STREAM, PROVIDER_ERROR.BAD_RESPONSE],
  ])('maps the provider mode %s to %s', async (mode, expected) => {
    const provider = await startProvider();
    provider.mode = mode;

    expect(await reasonOf(service().getJson(provider.url, '/api/tags', undefined))).toBe(expected);
  });

  it('gives up on a provider that never answers', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.HANG;
    const started = Date.now();

    const reason = await reasonOf(
      service({ timeoutMs: 300 }).getJson(provider.url, '/api/tags', undefined)
    );

    expect(reason).toBe(PROVIDER_ERROR.TIMEOUT);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('reports a closed port as unreachable', async () => {
    const provider = await startProvider();
    await provider.close();

    expect(await reasonOf(service().getJson(provider.url, '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.UNREACHABLE
    );
  });

  it('reports a name that does not resolve as unreachable', async () => {
    const nowhere = service({ lookup: fakeLookup({}) });

    expect(await reasonOf(nowhere.getJson('http://nowhere.test', '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.UNREACHABLE
    );
    const empty = service({ lookup: () => Promise.resolve([]) });
    expect(await reasonOf(empty.getJson('http://empty.test', '/api/tags', undefined))).toBe(
      PROVIDER_ERROR.UNREACHABLE
    );
  });

  it('never puts the key or the URL into an error message', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.UNAUTHORIZED;

    const error = await service()
      .getJson(`${provider.url}`, '/api/tags?secret=1', 'sk-secret')
      .then(
        () => undefined,
        (reason: unknown) => reason
      );

    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error ? error.message : '').not.toMatch(
      /sk-secret|127\.0\.0\.1|secret=1/
    );
  });
});

describe('ProviderFetchService: streams for the chat', () => {
  it('passes a streamed answer through unchanged', async () => {
    const provider = await startProvider();
    const fetchForConnection = service().createFetch(provider.url);

    const response = await fetchForConnection(`${provider.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'llama3:8b', stream: true }),
    });
    const text = await response.text();

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(text).toContain('"content":"pong"');
    expect(text).toContain('data: [DONE]');
  });

  it('returns a non-streamed answer with its status', async () => {
    const provider = await startProvider();
    provider.mode = FAKE_MODE.SERVER_ERROR;
    const fetchForConnection = service().createFetch(provider.url);

    const response = await fetchForConnection(`${provider.url}/v1/chat/completions`, {
      method: 'POST',
      body: '{}',
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'boom' });
  });
});
