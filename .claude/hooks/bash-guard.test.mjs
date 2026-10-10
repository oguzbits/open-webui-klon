import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateBashCommand } from './bash-guard-core.mjs';

function blocked(command) {
  const verdict = evaluateBashCommand(command);
  assert.equal(verdict.blocked, true, `should block: ${command}`);
  assert.ok(verdict.reason.length > 0);
}

function allowed(command) {
  const verdict = evaluateBashCommand(command);
  assert.equal(verdict.blocked, false, `should allow: ${command} (${verdict.reason ?? ''})`);
}

describe('force push', () => {
  for (const command of [
    'git push --force',
    'git push -f origin main',
    'git push origin main --force',
    'git push --force-with-lease',
    'git push --force-with-lease=main origin main',
    'git push --force-if-includes',
    'git push -fu origin main',
    'git push origin +main',
    'git push origin +HEAD:main',
    'git push --mirror',
    'git -C apps push --force',
    'git -c user.name=x push -f',
    'cd apps && git push -f',
    'pnpm check; git push --force',
    'echo ok | git push -f',
    'bash -c "git push --force"',
    "sh -c 'git push -f origin main'",
    'echo $(git push --force)',
    'echo `git push -f`',
  ]) {
    it(`blocks ${command}`, () => blocked(command));
  }

  for (const command of [
    'git push',
    'git push origin main',
    'git push -u origin main',
    'git push --dry-run',
    'git push -n',
    'git push origin feature/force-push-docs',
    'git log --oneline -n 5',
    'git commit -m "docs: explain why we never push --force"',
    'echo "git push --force is blocked"',
  ]) {
    it(`allows ${command}`, () => allowed(command));
  }
});

describe('hook bypass', () => {
  for (const command of [
    'git commit --no-verify -m x',
    'git commit -m x --no-verify',
    'git commit -n -m x',
    'git commit -nm x',
    'git commit -am x -n',
    'git push --no-verify',
    'git merge --no-verify topic',
    'git rebase --no-verify main',
    'git -C . commit --no-verify',
    'HUSKY=0 git commit -m x',
    'export HUSKY=0 && git commit -m x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git config core.hooksPath /dev/null',
    'git commit --no-verify',
  ]) {
    it(`blocks ${command}`, () => blocked(command));
  }

  for (const command of [
    'git commit -m "fix: x"',
    'git commit -am "fix: x"',
    'git commit -m "docs: never use --no-verify"',
    'git add -n .',
    'git log -n 3',
    'git status',
    'HUSKY=1 git commit -m x',
  ]) {
    it(`allows ${command}`, () => allowed(command));
  }
});

describe('secret files', () => {
  for (const command of [
    'cat .env',
    'cat .env.local',
    'cat apps/api/.env',
    'cat ./apps/api/.env.production',
    'less .env',
    'grep PASSWORD .env',
    'head -n 3 .env.test',
    'source .env',
    '. .env',
    'cp .env /tmp/x',
    'cat < .env',
    'cat <.env',
    'echo hi > .env',
    'git add .env',
    'git add -f .env.local',
    'docker compose --env-file .env up',
    'docker compose --env-file=.env up',
    'cat .env*',
    'cat .env.*',
    'cat "$(pwd)/.env"',
    "cat '.env'",
    'cat ~/.ssh/id_rsa',
    'cat ~/.ssh/id_ed25519',
    'cat ~/.aws/credentials',
    'cat ~/.netrc',
    'tail -f apps/api/.env.staging',
    'bash -c "cat .env"',
  ]) {
    it(`blocks ${command}`, () => blocked(command));
  }

  for (const command of [
    'cat .env.example',
    'cat apps/api/.env.example',
    'git add .env.example',
    'git add .gitignore',
    'ls apps',
    'cat ~/.ssh/id_rsa.pub',
    'cat ~/.ssh/config',
    'cat .environment-notes.md',
    'git commit -m "docs: .env stays out of git"',
    'echo "do not read .env"',
    'pnpm test',
  ]) {
    it(`allows ${command}`, () => allowed(command));
  }
});

describe('shape of input', () => {
  it('allows an empty command', () => allowed(''));
  it('allows whitespace', () => allowed('   \n  '));
  it('does not choke on an unbalanced quote', () => {
    const verdict = evaluateBashCommand('echo "unterminated');
    assert.equal(typeof verdict.blocked, 'boolean');
  });
  it('still blocks after an unbalanced quote earlier in a chain', () => {
    blocked('echo "x"; git push --force');
  });
  it('names the rule in the reason', () => {
    assert.match(evaluateBashCommand('git push -f').reason, /force/i);
    assert.match(evaluateBashCommand('git commit --no-verify').reason, /no-verify|hook/i);
    assert.match(evaluateBashCommand('cat .env').reason, /secret|\.env/i);
  });
  it('never echoes the file content or the full command back', () => {
    const { reason } = evaluateBashCommand('cat .env && echo SUPERSECRET');
    assert.doesNotMatch(reason, /SUPERSECRET/);
  });
});
