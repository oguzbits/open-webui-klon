/**
 * Rules of the Stop hook: the agent may only finish when `pnpm check` is green for the current working tree.
 * A pass is remembered by a hash of the changed files, so an unchanged tree is not checked twice. The hook
 * blocks at most once per turn (`stop_hook_active`), so it can never trap the agent in a loop.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Hash of every changed, new or deleted file (ignored files do not count); null for a clean tree. */
export function workingTreeHash(cwd) {
  const status = execFileSync('git', ['status', '--porcelain=v1', '-z', '-uall'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const entries = status.split('\0').filter((entry) => entry !== '');
  if (entries.length === 0) return null;

  const hash = createHash('sha256');
  for (const entry of [...entries].sort()) {
    hash.update(entry).update('\0');
    const path = entry.slice(3);
    try {
      hash.update(readFileSync(join(cwd, path)));
    } catch {
      hash.update('<missing>');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function tail(text, lines) {
  const all = text.split('\n');
  return all.slice(Math.max(0, all.length - lines)).join('\n');
}

/**
 * @param {{ input: { stop_hook_active?: boolean }, hash: string | null, savedHash: string | null,
 *   runCheck: () => { ok: boolean, output: string } }} args
 * @returns {{ action: 'allow', saveHash?: string, warning?: string } | { action: 'block', reason: string }}
 */
export function decideStop({ input, hash, savedHash, runCheck }) {
  if (hash === null || hash === savedHash) return { action: 'allow' };

  const result = runCheck();
  if (result.ok) return { action: 'allow', saveHash: hash };

  const report = tail(result.output, 40);
  if (input.stop_hook_active === true) {
    return {
      action: 'allow',
      warning: `pnpm check is still red; the Stop hook blocks only once per turn.\n${report}`,
    };
  }
  return {
    action: 'block',
    reason: `pnpm check ist rot. Behebe die Ursache, bevor du fertig meldest.\n${report}`,
  };
}
