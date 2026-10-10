import { csrfHeaderFor, notifyUnauthorized, rememberCsrfToken } from './session-state';
import { createTraceparent } from './trace';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
    readonly requestId?: string,
    /** Why a model provider failed (the 502 of the connection test): one value of the server's PROVIDER_ERROR. */
    readonly reason?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/** Answers that carry the session's token. */
const TOKEN_SOURCES = new Set(['/api/auth/me', '/api/auth/login', '/api/auth/signup']);
const LOGOUT = '/api/auth/logout';
/** A 401 here means "wrong credentials" or "not signed in yet", not "the session ended". */
const EXPECTED_401 = new Set([...TOKEN_SOURCES, '/api/auth/config']);

function toApiError(status: number, body: unknown): ApiError {
  return new ApiError(
    status,
    stringField(body, 'title') ?? `Request failed (${status})`,
    stringField(body, 'detail'),
    stringField(body, 'requestId'),
    stringField(body, 'reason')
  );
}

/**
 * For callers that read a failed response themselves (the chat stream keeps its body as a stream, so it cannot
 * go through `apiFetch`): the same error `apiFetch` would have thrown.
 */
export async function readApiError(response: Response): Promise<ApiError> {
  const text = await response.text();
  return toApiError(response.status, text === '' ? undefined : parseJson(text));
}

/**
 * Orval mutator. The server answers errors as RFC 9457 problem details; anything else
 * (a proxy's HTML page) still becomes an ApiError with the status code. Writing requests carry the CSRF token
 * of the session; a 401 on an ordinary request tells the app that the session is over.
 */
export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const path = url.split('?')[0] ?? url;
  const headers = new Headers(options.headers);
  headers.set('traceparent', createTraceparent());
  const token = csrfHeaderFor(options.method ?? 'GET');
  if (token !== undefined) headers.set('X-CSRF-Token', token);

  const response = await fetch(url, { ...options, headers, credentials: 'include' });
  const text = await response.text();
  const body: unknown = text === '' ? undefined : parseJson(text);

  if (!response.ok) {
    if (response.status === 401) {
      if (TOKEN_SOURCES.has(path)) rememberCsrfToken(undefined);
      if (!EXPECTED_401.has(path)) notifyUnauthorized();
    }
    throw toApiError(response.status, body);
  }
  if (TOKEN_SOURCES.has(path)) rememberCsrfToken(stringField(body, 'csrfToken'));
  if (path === LOGOUT) rememberCsrfToken(undefined);
  return { data: body, status: response.status, headers: response.headers } as T;
}
