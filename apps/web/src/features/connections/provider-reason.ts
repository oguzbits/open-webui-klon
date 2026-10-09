import { errorMessageKey } from '@/api/error-message';
import { ApiError } from '@/api/fetcher';
import { UnavailableConnectionDtoReason } from '@/api/generated/model';

/** One sentence per reason the server names; `satisfies` makes a new server-side reason a compile error here. */
const REASON_KEY = {
  [UnavailableConnectionDtoReason.timeout]: 'connections.reason.timeout',
  [UnavailableConnectionDtoReason.unreachable]: 'connections.reason.unreachable',
  [UnavailableConnectionDtoReason.unauthorized]: 'connections.reason.unauthorized',
  [UnavailableConnectionDtoReason.bad_response]: 'connections.reason.bad_response',
  [UnavailableConnectionDtoReason.blocked_host]: 'connections.reason.blocked_host',
} as const satisfies Record<UnavailableConnectionDtoReason, string>;

const UNKNOWN_REASON_KEY = 'connections.reason.unknown';

/** The i18n key for a reason; a reason this version does not know (a newer server) gets a neutral sentence. */
export function reasonKey(reason: string | undefined): string {
  for (const known of Object.values(UnavailableConnectionDtoReason)) {
    if (known === reason) return REASON_KEY[known];
  }
  return UNKNOWN_REASON_KEY;
}

/** The sentence for a failed connection test: the 502 carries the reason, everything else is a shared message. */
export function testFailureKey(error: unknown): string {
  if (error instanceof ApiError && error.status === 502) return reasonKey(error.reason);
  return errorMessageKey(error);
}
