import { ApiError } from './fetcher';

const BY_STATUS: Record<number, string> = {
  403: 'error.forbidden',
  404: 'error.notFound',
  413: 'error.tooLarge',
  429: 'error.tooMany',
};

/**
 * The i18n key for a failed request. `specific` gives a status the meaning it has in the caller's context
 * (a 401 means "wrong password" on the login form), the rest is shared.
 */
export function errorMessageKey(
  error: unknown,
  specific: Partial<Record<number, string>> = {}
): string {
  if (!(error instanceof ApiError)) return 'error.network';
  return specific[error.status] ?? BY_STATUS[error.status] ?? 'error.generic';
}
