import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { decideStop, tail, workingTreeHash } from './stop-check-core.mjs';

describe('workingTreeHash', () => {
  let dir;
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stop-check-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.env\n');
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is null for a clean tree', () => {
    assert.equal(workingTreeHash(dir), null);
  });

  it('changes when a tracked file changes, and is stable for the same content', () => {
    writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
    const first = workingTreeHash(dir);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(workingTreeHash(dir), first);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 3;\n');
    assert.notEqual(workingTreeHash(dir), first);
  });

  it('changes when the same file is edited again within one run (different bytes, same size)', () => {
    writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
    const first = workingTreeHash(dir);
    writeFileSync(join(dir, 'a.ts'), 'export const a = 9;\n');
    assert.notEqual(workingTreeHash(dir), first);
  });

  it('sees new files, also in new directories', () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 1;\n');
    assert.notEqual(workingTreeHash(dir), null);
  });

  it('sees a deleted file', () => {
    rmSync(join(dir, 'a.ts'));
    assert.notEqual(workingTreeHash(dir), null);
  });

  it('ignores ignored files', () => {
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'x.js'), 'x');
    writeFileSync(join(dir, '.env'), 'SECRET=1');
    assert.equal(workingTreeHash(dir), null);
  });

  it('is null again after the change is committed', () => {
    writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
    git('commit', '-q', '-am', 'change');
    assert.equal(workingTreeHash(dir), null);
  });
});

describe('decideStop', () => {
  const fail = () => ({ ok: false, output: 'line 1\nerror TS2322: broken' });
  const pass = () => ({ ok: true, output: '' });

  function run({ runCheck = pass, ...overrides }) {
    let runs = 0;
    const decision = decideStop({
      input: {},
      hash: 'h1',
      savedHash: null,
      runCheck: () => {
        runs += 1;
        return runCheck();
      },
      ...overrides,
    });
    return { decision, runs };
  }

  it('lets the agent stop without running anything when nothing changed', () => {
    const { decision, runs } = run({ hash: null });
    assert.equal(decision.action, 'allow');
    assert.equal(runs, 0);
  });

  it('skips the check when this exact state already passed', () => {
    const { decision, runs } = run({ savedHash: 'h1' });
    assert.equal(decision.action, 'allow');
    assert.equal(runs, 0);
  });

  it('runs the check for a new state, allows and remembers a pass', () => {
    const { decision, runs } = run({ savedHash: 'old' });
    assert.equal(runs, 1);
    assert.deepEqual(decision, { action: 'allow', saveHash: 'h1' });
  });

  it('blocks a failing check with the error output as the reason', () => {
    const { decision } = run({ runCheck: fail });
    assert.equal(decision.action, 'block');
    assert.match(decision.reason, /TS2322/);
    assert.equal(decision.saveHash, undefined);
  });

  it('blocks at most once: a second failure in the same turn lets the agent stop, with a warning', () => {
    const { decision } = run({ input: { stop_hook_active: true }, runCheck: fail });
    assert.equal(decision.action, 'allow');
    assert.match(decision.warning, /pnpm check/);
    assert.equal(decision.saveHash, undefined);
  });

  it('does not remember a failure, so the next turn checks again', () => {
    const first = run({ runCheck: fail });
    assert.equal(first.decision.saveHash, undefined);
    const second = run({ savedHash: null, runCheck: fail });
    assert.equal(second.runs, 1);
  });
});

describe('tail', () => {
  it('keeps the last lines only', () => {
    const text = Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n');
    const result = tail(text, 5);
    assert.equal(result, 'l95\nl96\nl97\nl98\nl99');
  });
  it('returns short text unchanged', () => {
    assert.equal(tail('a\nb', 5), 'a\nb');
  });
});
