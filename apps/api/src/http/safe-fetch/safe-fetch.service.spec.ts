import type { LookupAddress } from 'node:dns';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SAFE_FETCH_ERROR, SafeFetchError, type SafeFetchErrorCode } from './errors.js';
import {
  SAFE_FETCH_DEFAULTS,
  SafeFetchService,
  type SafeFetchOptions,
} from './safe-fetch.service.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Server[] = [];

async function serve(handler: Handler): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

/** Test servers listen on loopback, so the tests allow exactly that address. */
function loopbackService(overrides: Partial<SafeFetchOptions> = {}): SafeFetchService {
  return new SafeFetchService({
    ...SAFE_FETCH_DEFAULTS,
    isAllowedAddress: (address) => address === '127.0.0.1',
    timeoutMs: 2000,
    ...overrides,
  });
}

function fakeLookup(table: Record<string, string[]>): SafeFetchOptions['lookup'] {
  return (hostname) =>
    Promise.resolve(
      (table[hostname] ?? []).map((address): LookupAddress => ({
        address,
        family: address.includes(':') ? 6 : 4,
      }))
    );
}

async function expectFailure(promise: Promise<unknown>, code: SafeFetchErrorCode): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(SafeFetchError);
  expect(error).toMatchObject({ code });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => {
            resolve();
          });
        })
    )
  );
});

describe('SafeFetchService: what may be requested', () => {
  it('returns status, final URL, content type and body of an allowed target', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('hello');
    });

    const result = await loopbackService().fetch(`${base}/page`);

    expect(result).toMatchObject({ status: 200, contentType: 'text/plain', url: `${base}/page` });
    expect(result.body.toString('utf8')).toBe('hello');
  });

  it.each([
    'ftp://example.com/file',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/plain,hi',
  ])('rejects the scheme of %s', async (url) => {
    await expectFailure(loopbackService().fetch(url), SAFE_FETCH_ERROR.BLOCKED_SCHEME);
  });

  it('rejects credentials inside the URL', async () => {
    await expectFailure(
      loopbackService().fetch('http://user:pw@example.com/'),
      SAFE_FETCH_ERROR.CREDENTIALS_IN_URL
    );
  });

  it.each(['', 'not a url', 'http://'])('rejects the malformed URL %j', async (url) => {
    await expectFailure(loopbackService().fetch(url), SAFE_FETCH_ERROR.INVALID_URL);
  });

  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://127.1/',
    'http://0/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://localhost/',
    'http://localhost./',
  ])('blocks %s with the default policy', async (url) => {
    await expectFailure(
      new SafeFetchService(SAFE_FETCH_DEFAULTS).fetch(url),
      SAFE_FETCH_ERROR.BLOCKED_ADDRESS
    );
  });

  it('blocks a hostname that resolves to a private address', async () => {
    const service = loopbackService({ lookup: fakeLookup({ 'internal.test': ['10.0.0.5'] }) });

    await expectFailure(service.fetch('http://internal.test/'), SAFE_FETCH_ERROR.BLOCKED_ADDRESS);
  });

  it('blocks a hostname when only one of several addresses is private', async () => {
    const service = loopbackService({
      lookup: fakeLookup({ 'mixed.test': ['127.0.0.1', '10.0.0.5'] }),
    });

    await expectFailure(service.fetch('http://mixed.test/'), SAFE_FETCH_ERROR.BLOCKED_ADDRESS);
  });

  it('reports a hostname that does not resolve', async () => {
    const service = loopbackService({ lookup: fakeLookup({}) });

    await expectFailure(service.fetch('http://nowhere.test/'), SAFE_FETCH_ERROR.DNS_FAILED);
  });

  it('connects to the validated address and resolves the name only once (no DNS rebinding)', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('pinned');
    });
    const { port } = new URL(base);
    const lookup = vi.fn(fakeLookup({ 'pinned.test': ['127.0.0.1'] }));

    // "pinned.test" does not exist in real DNS: the request can only succeed through the validated address.
    const result = await loopbackService({ lookup }).fetch(`http://pinned.test:${port}/`);

    expect(result.body.toString('utf8')).toBe('pinned');
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe('SafeFetchService: redirects', () => {
  const redirecting: Handler = (request, response) => {
    const target: Record<string, string> = {
      '/start': '/final',
      '/to-private': 'http://10.0.0.5/secret',
      '/to-file': 'file:///etc/passwd',
      '/loop': '/loop',
    };
    const location = target[request.url ?? ''];
    if (location !== undefined) {
      response.writeHead(302, { location });
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('done');
  };

  it('follows a relative redirect and reports the final URL', async () => {
    const base = await serve(redirecting);

    const result = await loopbackService().fetch(`${base}/start`);

    expect(result.url).toBe(`${base}/final`);
    expect(result.body.toString('utf8')).toBe('done');
  });

  it('validates the redirect target again: a private address is blocked', async () => {
    const base = await serve(redirecting);

    await expectFailure(
      loopbackService().fetch(`${base}/to-private`),
      SAFE_FETCH_ERROR.BLOCKED_ADDRESS
    );
  });

  it('validates the redirect target again: a different scheme is blocked', async () => {
    const base = await serve(redirecting);

    await expectFailure(
      loopbackService().fetch(`${base}/to-file`),
      SAFE_FETCH_ERROR.BLOCKED_SCHEME
    );
  });

  it('stops a redirect loop after the configured number of hops', async () => {
    const base = await serve(redirecting);

    await expectFailure(
      loopbackService({ maxRedirects: 3 }).fetch(`${base}/loop`),
      SAFE_FETCH_ERROR.TOO_MANY_REDIRECTS
    );
  });
});

describe('SafeFetchService: redirect budget', () => {
  it('makes exactly maxRedirects follow-up requests before giving up', async () => {
    let requests = 0;
    const base = await serve((_request, response) => {
      requests += 1;
      response.writeHead(302, { location: '/again' });
      response.end();
    });

    await expectFailure(
      loopbackService({ maxRedirects: 3 }).fetch(base),
      SAFE_FETCH_ERROR.TOO_MANY_REDIRECTS
    );

    expect(requests).toBe(4);
  });
});

describe('SafeFetchService: response limits', () => {
  it('sends accept-encoding identity so no compressed bomb is delivered', async () => {
    const base = await serve((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(String(request.headers['accept-encoding']));
    });

    const result = await loopbackService().fetch(base);

    expect(result.body.toString('utf8')).toBe('identity');
  });

  it('rejects a content type outside the allowlist', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end('binary');
    });

    await expectFailure(loopbackService().fetch(base), SAFE_FETCH_ERROR.CONTENT_TYPE_NOT_ALLOWED);
  });

  it('accepts an allowed content type with parameters and different case', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'Text/HTML; charset=UTF-8' });
      response.end('<p>ok</p>');
    });

    const result = await loopbackService().fetch(base);

    expect(result.contentType).toBe('text/html');
  });

  it('rejects a declared size above the limit without reading the body', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-length': '1000000' });
      response.flushHeaders();
    });

    await expectFailure(
      loopbackService({ maxBytes: 1000 }).fetch(base),
      SAFE_FETCH_ERROR.RESPONSE_TOO_LARGE
    );
  });

  it('aborts a streamed body that grows past the limit without declaring a size', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('x'.repeat(600));
      response.write('x'.repeat(600));
      response.end();
    });

    await expectFailure(
      loopbackService({ maxBytes: 1000 }).fetch(base),
      SAFE_FETCH_ERROR.RESPONSE_TOO_LARGE
    );
  });

  it('gives up on a server that never answers', async () => {
    const base = await serve(() => {
      // never responds
    });

    await expectFailure(loopbackService({ timeoutMs: 300 }).fetch(base), SAFE_FETCH_ERROR.TIMEOUT);
  });

  it('gives up on a server that stops in the middle of the body', async () => {
    const base = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('partial');
    });

    await expectFailure(loopbackService({ timeoutMs: 300 }).fetch(base), SAFE_FETCH_ERROR.TIMEOUT);
  });
});
