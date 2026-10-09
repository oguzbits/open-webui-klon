import { afterEach, describe, expect, it, vi } from 'vitest';

import { noContent, json, problem, stubApi } from '@/test/stub-api';

import { apiFetch } from './fetcher';
import { csrfHeaderFor, rememberCsrfToken, setUnauthorizedHandler } from './session-state';

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

describe('apiFetch: session handling', () => {
  afterEach(() => {
    rememberCsrfToken(undefined);
    setUnauthorizedHandler(undefined);
  });

  const SESSION = { user: { id: 'u1' }, csrfToken: 'csrf-1' };

  it.each(['/api/auth/me', '/api/auth/login', '/api/auth/signup'])(
    'learns the token from %s',
    async (path) => {
      stubApi({
        [`GET ${path}`]: () => json(200, SESSION),
        [`POST ${path}`]: () => json(200, SESSION),
      });

      await apiFetch(path, { method: path === '/api/auth/me' ? 'GET' : 'POST' });

      expect(csrfHeaderFor('POST')).toBe('csrf-1');
    }
  );

  it('sends the token on writing requests and never on reads', async () => {
    const fetchMock = stubApi({
      'GET /api/auth/me': () => json(200, SESSION),
      'GET /api/users': () => json(200, []),
      'POST /api/users': () => json(201, {}),
      'DELETE /api/users/1': () => noContent(),
    });
    await apiFetch('/api/auth/me');

    await apiFetch('/api/users');
    await apiFetch('/api/users', { method: 'POST', body: '{}' });
    await apiFetch('/api/users/1', { method: 'DELETE' });

    const sent = fetchMock.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('X-CSRF-Token')
    );
    expect(sent).toEqual([null, null, 'csrf-1', 'csrf-1']);
  });

  it('does not invent a token when the answer has none', async () => {
    stubApi({ 'GET /api/auth/me': () => json(200, { user: { id: 'u1' } }) });

    await apiFetch('/api/auth/me');

    expect(csrfHeaderFor('POST')).toBeUndefined();
  });

  it('forgets the token after logout and when me answers 401', async () => {
    stubApi({
      'GET /api/auth/me': () => json(200, SESSION),
      'POST /api/auth/logout': () => noContent(),
    });
    await apiFetch('/api/auth/me');
    await apiFetch('/api/auth/logout', { method: 'POST' });
    expect(csrfHeaderFor('POST')).toBeUndefined();

    rememberCsrfToken('stale');
    stubApi({ 'GET /api/auth/me': () => problem(401, 'Unauthorized') });
    await expect(apiFetch('/api/auth/me')).rejects.toMatchObject({ status: 401 });

    expect(csrfHeaderFor('POST')).toBeUndefined();
  });

  it('reports a 401 on an ordinary request, but not on login, signup, me or config', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    stubApi({
      'GET /api/users': () => problem(401, 'Unauthorized'),
      'POST /api/auth/login': () => problem(401, 'Unauthorized'),
      'POST /api/auth/signup': () => problem(401, 'Unauthorized'),
      'GET /api/auth/me': () => problem(401, 'Unauthorized'),
      'GET /api/auth/config': () => problem(401, 'Unauthorized'),
    });

    const expected = [
      { path: '/api/auth/login', method: 'POST' },
      { path: '/api/auth/signup', method: 'POST' },
      { path: '/api/auth/me', method: 'GET' },
      { path: '/api/auth/config', method: 'GET' },
    ];
    for (const { path, method } of expected) {
      await expect(apiFetch(`${path}?x=1`, { method })).rejects.toMatchObject({ status: 401 });
    }
    expect(handler).not.toHaveBeenCalled();

    await expect(apiFetch('/api/users')).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not report other failures as an ended session', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    stubApi({ 'GET /api/users': () => problem(403, 'Forbidden') });

    await expect(apiFetch('/api/users')).rejects.toMatchObject({ status: 403 });

    expect(handler).not.toHaveBeenCalled();
  });
});
