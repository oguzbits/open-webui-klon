import { createTraceparent } from './trace';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: string,
    readonly requestId?: string
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

/**
 * Orval mutator. The server answers errors as RFC 9457 problem details; anything else
 * (a proxy's HTML page) still becomes an ApiError with the status code.
 */
export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('traceparent', createTraceparent());

  const response = await fetch(url, { ...options, headers, credentials: 'include' });
  const text = await response.text();
  const body: unknown = text === '' ? undefined : parseJson(text);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      stringField(body, 'title') ?? `Request failed (${response.status})`,
      stringField(body, 'detail'),
      stringField(body, 'requestId')
    );
  }
  return { data: body, status: response.status, headers: response.headers } as T;
}
