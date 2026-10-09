export const BASE_URL_PROBLEM = {
  INVALID: 'invalid',
  SCHEME: 'scheme',
  CREDENTIALS: 'credentials',
  QUERY: 'query',
} as const;

export type BaseUrlProblem = (typeof BASE_URL_PROBLEM)[keyof typeof BASE_URL_PROBLEM];

/** The message never contains the rejected input (it may carry credentials). */
export class InvalidBaseUrlError extends Error {
  constructor(
    readonly problem: BaseUrlProblem,
    message: string
  ) {
    super(message);
    this.name = 'InvalidBaseUrlError';
  }
}

/** http(s) only, no credentials, no query or fragment; scheme and host lower-case, no trailing slash. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new InvalidBaseUrlError(BASE_URL_PROBLEM.INVALID, 'The address is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidBaseUrlError(
      BASE_URL_PROBLEM.SCHEME,
      'The address must start with http:// or https://'
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new InvalidBaseUrlError(
      BASE_URL_PROBLEM.CREDENTIALS,
      'The address must not contain credentials'
    );
  }
  if (url.search !== '' || url.hash !== '') {
    throw new InvalidBaseUrlError(
      BASE_URL_PROBLEM.QUERY,
      'The address must not contain a query or fragment'
    );
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
