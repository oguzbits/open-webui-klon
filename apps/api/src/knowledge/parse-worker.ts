// Runs inside a worker thread (see worker-runner.ts). Self-contained on purpose: it imports packages only, so
// Node can load this file as TypeScript in tests and as JavaScript after the build, without resolving app code.
import { parentPort, workerData } from 'node:worker_threads';

import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

interface ParseRequest {
  type: 'pdf' | 'docx';
  bytes: Uint8Array;
  maxPages: number;
}

async function parse(request: ParseRequest) {
  if (request.type === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(request.bytes) });
    return { ok: true, pages: [{ page: null, text: value }], pageCount: null };
  }
  const pdf = await getDocumentProxy(new Uint8Array(request.bytes));
  // Checked before any text is read, so a huge document costs only its header.
  if (pdf.numPages > request.maxPages) return { ok: false, reason: 'too_many_pages' };
  const { text } = await extractText(pdf, { mergePages: false });
  return {
    ok: true,
    pages: text.map((pageText, index) => ({ page: index + 1, text: pageText })),
    pageCount: pdf.numPages,
  };
}

parentPort?.postMessage(await parse(workerData as ParseRequest));
