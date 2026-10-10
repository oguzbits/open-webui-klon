import type { DocumentDto } from './knowledge.dto.js';
import type { DocumentFailure, DocumentStatus, DocumentType } from './rag-dictionaries.js';

/** A `document` row as selected with `DOCUMENT_COLUMNS`. */
export interface DocumentRow {
  id: string;
  filename: string;
  type: DocumentType;
  size_bytes: number;
  status: DocumentStatus;
  failure_reason: DocumentFailure | null;
  page_count: number | null;
  created_at: Date;
}

/** Everything a client may see of a document; the storage key and the hash stay inside. Prefix with the alias. */
export function documentColumns(alias: string): string {
  return [
    'id',
    'filename',
    'type',
    'size_bytes',
    'status',
    'failure_reason',
    'page_count',
    'created_at',
  ]
    .map((column) => `${alias}.${column}`)
    .join(', ');
}

export function toDocumentDto(row: DocumentRow): DocumentDto {
  return {
    id: row.id,
    filename: row.filename,
    type: row.type,
    sizeBytes: row.size_bytes,
    status: row.status,
    failureReason: row.failure_reason,
    pageCount: row.page_count,
    createdAt: row.created_at,
  };
}
