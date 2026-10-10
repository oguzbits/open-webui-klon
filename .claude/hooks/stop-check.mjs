#!/usr/bin/env node
/** Stop hook: the agent may only finish when `pnpm check` is green. Rules: stop-check-core.mjs. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { decideStop, workingTreeHash } from './stop-check-core.mjs';

const CHECK_TIMEOUT_MS = 280_000;

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  // No readable input: treat it like a first stop in this turn.
}
const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();

const statePath = resolve(
  cwd,
  execFileSync('git', ['rev-parse', '--git-path', 'claude-stop-check.json'], {
    cwd,
    encoding: 'utf8',
  }).trim()
);

function savedHash() {
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return typeof state.hash === 'string' ? state.hash : null;
  } catch {
    return null;
  }
}

function runCheck() {
  const result = spawnSync('pnpm', ['check'], {
    cwd,
    encoding: 'utf8',
    timeout: CHECK_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`;
  return { ok: result.status === 0, output };
}

const decision = decideStop({
  input,
  hash: workingTreeHash(cwd),
  savedHash: savedHash(),
  runCheck,
});

if (decision.action === 'block') {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: decision.reason }));
} else {
  if (decision.saveHash !== undefined) {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ hash: decision.saveHash }));
  }
  if (decision.warning !== undefined) {
    process.stdout.write(JSON.stringify({ systemMessage: decision.warning }));
  }
}
