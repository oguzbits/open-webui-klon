export const MAX_FILENAME_LENGTH = 255;
const FALLBACK_NAME = 'document';
/** Control characters, and the bidirectional overrides that make `evil\u202Etxt.exe` read as `evilexe.txt`. */
const UNWANTED = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu;

/**
 * The name shown in the list. It is kept in the database only and never used as a path, but it still comes from
 * the client: path parts and control characters go, the length is capped by characters (not UTF-16 units).
 */
export function cleanFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(UNWANTED, '').trim();
  if (cleaned === '') return FALLBACK_NAME;
  return Array.from(cleaned).slice(0, MAX_FILENAME_LENGTH).join('');
}

/**
 * Multer hands over the name of a part as Latin-1 text even when the browser sent UTF-8 bytes. Read the bytes
 * again as UTF-8; a name that is not valid UTF-8 that way was Latin-1 to begin with and stays as it is.
 */
export function decodeMultipartName(raw: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw, 'latin1'));
  } catch {
    return raw;
  }
}
