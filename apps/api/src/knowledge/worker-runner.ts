import { Worker } from 'node:worker_threads';

import { ParseError } from './parse-error.js';
import { DOCUMENT_FAILURE } from './rag-dictionaries.js';

export interface WorkerLimits {
  timeoutMs: number;
  /** Heap limit of the worker; crossing it ends the worker, not the server. */
  memoryMb: number;
}

/**
 * Runs one worker thread to its first message and returns that message. The worker gets an empty environment (it
 * has no business with the server's secrets) and is always terminated afterwards. A timeout, a crash, running out
 * of memory or leaving without an answer is a `ParseError`; nothing the worker says about it is passed on, because
 * parser messages can quote the document.
 */
export function runWorker(url: URL, data: unknown, limits: WorkerLimits): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, {
      workerData: data,
      env: {},
      resourceLimits: { maxOldGenerationSizeMb: limits.memoryMb },
    });
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new ParseError(DOCUMENT_FAILURE.TIMEOUT));
      });
    }, limits.timeoutMs);

    worker.once('message', (message: unknown) => {
      finish(() => {
        resolve(message);
      });
    });
    worker.once('error', () => {
      finish(() => {
        reject(new ParseError(DOCUMENT_FAILURE.UNREADABLE));
      });
    });
    worker.once('exit', () => {
      finish(() => {
        reject(new ParseError(DOCUMENT_FAILURE.UNREADABLE));
      });
    });
  });
}
