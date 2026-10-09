const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /\p{Cc}/u;
const RAW_MODEL_ID_MAX_LENGTH = 512;

export interface ParsedModelId {
  connectionId: string;
  rawModelId: string;
}

/** The id the outside world sees: `<connectionId>:<rawModelId>`. */
export function formatModelId(connectionId: string, rawModelId: string): string {
  return `${connectionId}:${rawModelId}`;
}

/**
 * Splits at the FIRST colon: the connection id is a UUID and has none, while raw ids do (`llama3:8b`).
 * Returns undefined for anything that is not such an id; callers answer 404.
 */
export function parseModelId(id: string): ParsedModelId | undefined {
  const separator = id.indexOf(':');
  if (separator <= 0) return undefined;
  const connectionId = id.slice(0, separator);
  const rawModelId = id.slice(separator + 1);
  if (!UUID.test(connectionId)) return undefined;
  if (rawModelId === '' || rawModelId.length > RAW_MODEL_ID_MAX_LENGTH) return undefined;
  if (CONTROL_CHARACTERS.test(rawModelId)) return undefined;
  return { connectionId, rawModelId };
}
