export interface ListCursor {
  /** Microsecond timestamp as text from Postgres (a JS Date would cut it to milliseconds). */
  ts: string;
  id: string;
}

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})\d{3}Z$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Only what `encodeCursor` produces from Postgres: anything else would fail the SQL cast with a 500. */
function isValid(cursor: ListCursor): boolean {
  const millis = TIMESTAMP.exec(cursor.ts)?.[1];
  if (millis === undefined || !UUID.test(cursor.id)) return false;
  // A date like February 31st matches the pattern but is not a real date.
  const date = new Date(`${millis}Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString() === `${millis}Z`;
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
      const cursor = { ts: parsed.ts, id: parsed.id };
      if (isValid(cursor)) return cursor;
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
