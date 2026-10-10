#!/usr/bin/env node
/** PreToolUse hook for Bash: denies force pushes, hook bypasses and secret-file access. Rules: bash-guard-core.mjs. */
import { readFileSync } from 'node:fs';

import { evaluateBashCommand } from './bash-guard-core.mjs';

let command;
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  command = input?.tool_input?.command;
} catch {
  command = undefined;
}

if (typeof command !== 'string') {
  // Fail closed: a Bash call we cannot read is not judged "fine".
  console.error('bash-guard: could not read the command from the hook input.');
  process.exit(2);
}

const verdict = evaluateBashCommand(command);
if (verdict.blocked) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.reason,
      },
    })
  );
}
