export const PROVIDER_ERROR = {
  TIMEOUT: 'timeout',
  UNREACHABLE: 'unreachable',
  UNAUTHORIZED: 'unauthorized',
  BAD_RESPONSE: 'bad_response',
  BLOCKED_HOST: 'blocked_host',
} as const;

export type ProviderErrorReason = (typeof PROVIDER_ERROR)[keyof typeof PROVIDER_ERROR];

/** The message never contains a URL, a key or any text the provider sent. */
export class ProviderError extends Error {
  constructor(
    readonly reason: ProviderErrorReason,
    message: string
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
