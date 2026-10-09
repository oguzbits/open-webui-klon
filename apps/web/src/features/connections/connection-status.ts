import type {
  ModelListDto,
  ProviderConnectionDto,
  UnavailableConnectionDtoReason,
} from '@/api/generated/model';

export const CONNECTION_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
  UNREACHABLE: 'unreachable',
  UNKNOWN: 'unknown',
} as const;
export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

/**
 * The server's own model list says which connections did not answer, so the admin page needs no extra route.
 * `health` is undefined while that list is loading or failed.
 */
export function unreachableReason(
  connection: ProviderConnectionDto,
  health: ModelListDto | undefined
): UnavailableConnectionDtoReason | undefined {
  if (!connection.enabled || health === undefined) return undefined;
  return health.unavailableConnections.find((entry) => entry.id === connection.id)?.reason;
}

export function connectionStatus(
  connection: ProviderConnectionDto,
  health: ModelListDto | undefined
): ConnectionStatus {
  if (!connection.enabled) return CONNECTION_STATUS.DISABLED;
  if (health === undefined) return CONNECTION_STATUS.UNKNOWN;
  return unreachableReason(connection, health) === undefined
    ? CONNECTION_STATUS.ACTIVE
    : CONNECTION_STATUS.UNREACHABLE;
}

/** Visible (not hidden) models of an active connection; undefined when there is nothing to count. */
export function visibleModelCount(
  connection: ProviderConnectionDto,
  health: ModelListDto | undefined
): number | undefined {
  if (health === undefined) return undefined;
  if (connectionStatus(connection, health) !== CONNECTION_STATUS.ACTIVE) return undefined;
  return health.models.filter((model) => model.connectionId === connection.id).length;
}
