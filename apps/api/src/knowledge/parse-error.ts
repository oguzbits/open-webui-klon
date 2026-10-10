import type { DocumentFailure } from './rag-dictionaries.js';

/** A document that cannot be turned into text. The message is fixed: parser errors may quote the document. */
export class ParseError extends Error {
  constructor(readonly reason: DocumentFailure) {
    super(`The document could not be parsed (${reason})`);
    this.name = ParseError.name;
  }
}
