export interface PageText {
  /** 1-based page number; null for formats without pages. */
  page: number | null;
  text: string;
}

export interface TextChunk {
  ordinal: number;
  page: number | null;
  content: string;
}

export interface ChunkOptions {
  /** Largest chunk, in characters. */
  chars: number;
  /** Characters repeated from the end of a chunk at the start of the next one. */
  overlap: number;
}

/** Break points in order of preference; a break is only used in the second half of the window. */
const SEPARATORS = ['\n\n', '\n', '. ', ' '];

function breakAt(text: string, start: number, end: number): number {
  const earliest = start + Math.ceil((end - start) / 2);
  for (const separator of SEPARATORS) {
    const found = text.lastIndexOf(separator, end - separator.length);
    if (found >= earliest) return found + separator.length;
  }
  return end;
}

function chunkText(text: string, { chars, overlap }: ChunkOptions): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    const hardEnd = Math.min(start + chars, text.length);
    const end = hardEnd === text.length ? hardEnd : breakAt(text, start, hardEnd);
    const piece = text.slice(start, end).trim();
    if (piece !== '') pieces.push(piece);
    if (end >= text.length) break;
    // Start the next chunk inside the overlap, moved forward to the next word so no chunk begins mid-word.
    let next = Math.max(end - overlap, start + 1);
    const space = text.indexOf(' ', next);
    if (space !== -1 && space < end) next = space + 1;
    start = next;
  }
  return pieces;
}

/** Splits page texts into chunks of at most `chars` characters, numbered across all pages. */
export function chunkPages(pages: PageText[], options: ChunkOptions): TextChunk[] {
  if (options.overlap >= options.chars) {
    throw new RangeError('The chunk overlap must be smaller than the chunk size');
  }
  const chunks: TextChunk[] = [];
  for (const { page, text } of pages) {
    for (const content of chunkText(text, options)) {
      chunks.push({ ordinal: chunks.length, page, content });
    }
  }
  return chunks;
}
