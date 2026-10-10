import { DOCUMENT_TYPE, type DocumentType } from './rag-dictionaries.js';

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
/** ZIP entry names sit in the local headers (start) and in the central directory (end). */
const ZIP_WINDOW_BYTES = 64 * 1024;
const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];
const TEXT_EXTENSIONS = ['.txt'];

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((value, index) => bytes[index] === value);
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function isWordPackage(bytes: Uint8Array): boolean {
  const window =
    latin1(bytes.subarray(0, ZIP_WINDOW_BYTES)) + latin1(bytes.subarray(-ZIP_WINDOW_BYTES));
  return window.includes('[Content_Types].xml') && window.includes('word/');
}

function isPlainText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * The type of an upload, decided from the bytes. The file name only tells Markdown from plain text; it never
 * turns bytes into a PDF or DOCX, and a client-sent MIME type is not consulted at all.
 */
export function detectDocumentType(bytes: Uint8Array, filename: string): DocumentType | undefined {
  if (bytes.length === 0) return undefined;
  if (startsWith(bytes, PDF_MAGIC)) return DOCUMENT_TYPE.PDF;
  if (startsWith(bytes, ZIP_MAGIC)) return isWordPackage(bytes) ? DOCUMENT_TYPE.DOCX : undefined;

  const name = filename.toLowerCase();
  const markdown = MARKDOWN_EXTENSIONS.some((extension) => name.endsWith(extension));
  const text = TEXT_EXTENSIONS.some((extension) => name.endsWith(extension));
  if (!markdown && !text) return undefined;
  if (!isPlainText(bytes)) return undefined;
  return markdown ? DOCUMENT_TYPE.MARKDOWN : DOCUMENT_TYPE.TEXT;
}
