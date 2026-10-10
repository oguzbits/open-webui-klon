import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { ParseError } from './parse-error.js';
import { DOCUMENT_FAILURE } from './rag-dictionaries.js';
import { runWorker } from './worker-runner.js';

const directory = mkdtempSync(join(tmpdir(), 'worker-runner-'));
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

function workerFile(name: string, source: string): URL {
  const path = join(directory, name);
  writeFileSync(path, source);
  return pathToFileURL(path);
}

const LIMITS = { timeoutMs: 1500, memoryMb: 64 };

async function failureOf(work: Promise<unknown>): Promise<ParseError> {
  const outcome = await work.then(
    () => undefined,
    (error: unknown) => error
  );
  if (!(outcome instanceof ParseError)) throw new Error('expected a ParseError');
  return outcome;
}

describe('runWorker', () => {
  it('returns what the worker posts', async () => {
    const url = workerFile(
      'echo.mjs',
      `import { parentPort, workerData } from 'node:worker_threads';
       parentPort.postMessage({ echoed: workerData.value });`
    );

    expect(await runWorker(url, { value: 42 }, LIMITS)).toEqual({ echoed: 42 });
  });

  it('gives the worker an empty environment so it cannot read the server secrets', async () => {
    process.env.WORKER_RUNNER_TEST_SECRET = 'hunter2';
    try {
      const url = workerFile(
        'env.mjs',
        `import { parentPort } from 'node:worker_threads';
         parentPort.postMessage({ secret: process.env.WORKER_RUNNER_TEST_SECRET ?? null });`
      );

      expect(await runWorker(url, {}, LIMITS)).toEqual({ secret: null });
    } finally {
      delete process.env.WORKER_RUNNER_TEST_SECRET;
    }
  });

  it('ends a worker that runs forever after the time limit and stays alive itself', async () => {
    const url = workerFile('hang.mjs', 'setInterval(() => {}, 1000);');
    const started = Date.now();

    const error = await failureOf(runWorker(url, {}, { ...LIMITS, timeoutMs: 300 }));

    expect(error.reason).toBe(DOCUMENT_FAILURE.TIMEOUT);
    expect(Date.now() - started).toBeLessThan(1400);
  });

  it('turns a worker that runs out of memory into unreadable and stays alive itself', async () => {
    const url = workerFile(
      'oom.mjs',
      'const keep = []; for (;;) keep.push(new Array(1_000_000).fill(1));'
    );

    const error = await failureOf(runWorker(url, {}, { timeoutMs: 20_000, memoryMb: 64 }));

    expect(error.reason).toBe(DOCUMENT_FAILURE.UNREADABLE);
  }, 30_000);

  it('turns a throwing worker and a worker that exits without an answer into unreadable', async () => {
    const throwing = workerFile('throws.mjs', "throw new Error('secret text from the document');");
    const silent = workerFile('silent.mjs', 'process.exit(0);');

    const first = await failureOf(runWorker(throwing, {}, LIMITS));
    const second = await failureOf(runWorker(silent, {}, LIMITS));

    expect(first.reason).toBe(DOCUMENT_FAILURE.UNREADABLE);
    expect(first.message).not.toContain('secret');
    expect(second.reason).toBe(DOCUMENT_FAILURE.UNREADABLE);
  });
});
