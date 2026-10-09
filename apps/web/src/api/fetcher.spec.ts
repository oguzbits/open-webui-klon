import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from './fetcher';

function stubFetch(status: number, body: string, contentType: string) {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(body, { status, headers: { 'content-type': contentType } }))
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('sends cookies and a traceparent header and returns data, status and headers', async () => {
    const fetchMock = stubFetch(200, '{"status":"ok"}', 'application/json');

    const result = await apiFetch<{ data: unknown; status: number; headers: Headers }>(
      '/api/health/live',
      { method: 'GET' }
    );

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('traceparent')).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
    );
    expect(result).toMatchObject({ data: { status: 'ok' }, status: 200 });
  });

  it('turns a problem details response into an ApiError with the request id', async () => {
    stubFetch(
      503,
      '{"title":"Service Unavailable","detail":"Shutting down","requestId":"req-12345678"}',
      'application/problem+json'
    );

    await expect(apiFetch('/api/health/ready')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      detail: 'Shutting down',
      requestId: 'req-12345678',
    });
  });

  it('turns a non-JSON error page (for example from a proxy) into an ApiError', async () => {
    stubFetch(502, '<html>Bad Gateway</html>', 'text/html');

    await expect(apiFetch('/api/health/ready')).rejects.toMatchObject({
      name: 'ApiError',
      status: 502,
    });
  });
});
