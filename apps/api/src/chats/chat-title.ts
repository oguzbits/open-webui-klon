const FALLBACK_LENGTH = 60;
const TITLE_LENGTH = 80;
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const WRAPPING = /^[\s"'`„“”«»‚‘’#*_>-]+|[\s"'`„“”«»‚‘’#*_]+$/gu;

function cut(text: string, length: number): string {
  return Array.from(text).slice(0, length).join('');
}

/** The title a chat gets with its first message: the start of the message. */
export function fallbackTitle(text: string): string {
  return cut(text.replace(/\s+/gu, ' ').trim(), FALLBACK_LENGTH);
}

/** A model's title proposal as plain text: first line, no quotes or markdown marks, no control characters. */
export function sanitizeTitle(raw: string): string {
  const firstLine = raw.split('\n').find((line) => line.trim() !== '') ?? '';
  const plain = firstLine
    .replace(CONTROL_CHARACTERS, '')
    .replace(/\*\*|__|`/gu, '')
    .replace(WRAPPING, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return cut(plain, TITLE_LENGTH);
}
