import { vi } from 'vitest';

export interface StubRequest {
  method: string;
  url: URL;
  body: unknown;
  headers: Headers;
  /** Fires when the app aborts the request (stop button, navigation). */
  signal: AbortSignal | undefined;
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

/** Every signed-in page shows the chat list in its sidebar: a test that does not care gets an empty one. */
const DEFAULT_HANDLERS: Record<string, Handler> = {
  'GET /api/chats': () => json(200, { items: [], nextCursor: null }),
};

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
    const handler =
      handlers[`${method} ${url.pathname}`] ?? DEFAULT_HANDLERS[`${method} ${url.pathname}`];
    if (handler === undefined) {
      return Promise.resolve(problem(404, `Unexpected request: ${method} ${url.pathname}`));
    }
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    return Promise.resolve(
      handler({
        method,
        url,
        body,
        headers: new Headers(init?.headers),
        signal: init?.signal ?? undefined,
      })
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The requests a test made to one route, to count them (double submit) and to read their bodies. */
export function callsTo(fetchMock: ReturnType<typeof stubApi>, method: string, path: string) {
  return fetchMock.mock.calls.filter(
    ([input, init]) => input === path && (init?.method ?? 'GET') === method
  );
}
