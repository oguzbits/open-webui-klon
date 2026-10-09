export const SAFE_FETCH_ERROR = {
  INVALID_URL: 'INVALID_URL',
  BLOCKED_SCHEME: 'BLOCKED_SCHEME',
  CREDENTIALS_IN_URL: 'CREDENTIALS_IN_URL',
  BLOCKED_ADDRESS: 'BLOCKED_ADDRESS',
  DNS_FAILED: 'DNS_FAILED',
  BAD_REDIRECT: 'BAD_REDIRECT',
  TOO_MANY_REDIRECTS: 'TOO_MANY_REDIRECTS',
  CONTENT_TYPE_NOT_ALLOWED: 'CONTENT_TYPE_NOT_ALLOWED',
  RESPONSE_TOO_LARGE: 'RESPONSE_TOO_LARGE',
  TIMEOUT: 'TIMEOUT',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
} as const;

export type SafeFetchErrorCode = (typeof SAFE_FETCH_ERROR)[keyof typeof SAFE_FETCH_ERROR];

/** The message never contains the full URL (query strings can carry tokens). */
export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'SafeFetchError';
  }
}
