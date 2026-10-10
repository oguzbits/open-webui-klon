export interface ListCursor {
  /** Microsecond timestamp as text from Postgres (a JS Date would cut it to milliseconds). */
  ts: string;
  id: string;
}

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(value: string): ListCursor | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'ts' in parsed &&
      'id' in parsed &&
      typeof parsed.ts === 'string' &&
      typeof parsed.id === 'string'
    ) {
      return { ts: parsed.ts, id: parsed.id };
    }
  } catch {
    // not a cursor we issued
  }
  return undefined;
}

/** Makes `%`, `_` and `\` literal characters in an ILIKE pattern (used with ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
