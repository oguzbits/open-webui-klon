import { vi } from 'vitest';

export interface StubRequest {
  method: string;
  url: URL;
  body: unknown;
  headers: Headers;
}

export type Handler = (request: StubRequest) => Response | Promise<Response>;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function problem(
  status: number,
  title: string,
  detail?: string,
  extra: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ title, detail, status, ...extra }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

/**
 * Replaces fetch for one test. Handlers are keyed "METHOD /path" (query string ignored) and may be swapped
 * between steps of a test; a request nobody expected answers 404 with a title that names it.
 */
export function stubApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      'http://app.test'
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = handlers[`${method} ${url.pathname}`];
    if (handler === undefined) {
      return Promise.resolve(problem(404, `Unexpected request: ${method} ${url.pathname}`));
    }
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    return Promise.resolve(handler({ method, url, body, headers: new Headers(init?.headers) }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
