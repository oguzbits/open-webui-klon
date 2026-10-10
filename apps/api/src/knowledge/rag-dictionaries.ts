export const DOCUMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
} as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];

/** Coarse reason stored with a failed document; the web app maps it to a message. */
export const DOCUMENT_FAILURE = {
  TOO_LARGE: 'too_large',
  TOO_MANY_PAGES: 'too_many_pages',
  UNREADABLE: 'unreadable',
  TIMEOUT: 'timeout',
  NO_TEXT: 'no_text',
  EMBEDDING_FAILED: 'embedding_failed',
} as const;
export type DocumentFailure = (typeof DOCUMENT_FAILURE)[keyof typeof DOCUMENT_FAILURE];

/** Decided by the server from the bytes (and the extension for text), never from the client's MIME type. */
export const DOCUMENT_TYPE = {
  PDF: 'pdf',
  DOCX: 'docx',
  MARKDOWN: 'markdown',
  TEXT: 'text',
} as const;
export type DocumentType = (typeof DOCUMENT_TYPE)[keyof typeof DOCUMENT_TYPE];

/** The error text clients see when the knowledge features cannot run (no embedding model, provider down). */
export const KNOWLEDGE_UNAVAILABLE = 'knowledge_unavailable';
