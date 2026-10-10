/**
 * Rules of the Bash guard (PreToolUse hook). Pure functions, no I/O, so node:test can cover them.
 *
 * Blocks three things (AGENTS.md, Git and invariant 6): force pushes, bypassing git hooks, and touching secret
 * files. It is a safety net against slips by the agent, not a sandbox: a determined shell trick (variables,
 * encoded strings) gets past it. `.claude/settings.json` permissions are the second layer.
 */

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
/** git options before the subcommand that take a separate value. */
const GIT_OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
]);
const FORCE_LONG_OPTIONS = ['--force', '--force-with-lease', '--force-if-includes', '--mirror'];

const REASON = {
  force:
    'Force-Push ist verboten (AGENTS.md, Git). Normal pushen; bei abgelehntem Push kurz melden und `git revert` nutzen.',
  hooks:
    'Git-Hooks dürfen nicht umgangen werden (`--no-verify`, `HUSKY=0`, `core.hooksPath`). Die Ursache des fehlgeschlagenen Hooks beheben.',
  secret:
    'Zugriff auf Secret-Dateien ist verboten (`.env*` außer `.env.example`, SSH-Schlüssel, Cloud-Zugangsdaten; AGENTS.md, Invariante 6).',
};

/** Splits a command into segments of tokens. Quotes group, separators outside quotes end a segment. */
export function tokenize(command) {
  const segments = [];
  let tokens = [];
  let current = '';
  let hasToken = false;
  let quote = null;

  const endToken = () => {
    if (hasToken) tokens.push(current);
    current = '';
    hasToken = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && i + 1 < command.length) {
        i += 1;
        current += command[i];
      } else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
    } else if (char === '\\' && i + 1 < command.length) {
      i += 1;
      current += command[i];
      hasToken = true;
    } else if (SEPARATORS.has(char)) endSegment();
    else if (char === ' ' || char === '\t' || char === '\r') endToken();
    else {
      current += char;
      hasToken = true;
    }
  }
  endSegment();
  return segments;
}

/** The text inside `$( ... )` (balanced) and backticks, so the inner command is judged on its own. */
export function substitutions(command) {
  const found = [];
  for (let i = 0; i < command.length - 1; i += 1) {
    if (command[i] === '$' && command[i + 1] === '(') {
      let depth = 1;
      let j = i + 2;
      while (j < command.length && depth > 0) {
        if (command[j] === '(') depth += 1;
        else if (command[j] === ')') depth -= 1;
        j += 1;
      }
      found.push(command.slice(i + 2, depth === 0 ? j - 1 : j));
    }
  }
  for (const match of command.matchAll(/`([^`]*)`/g)) found.push(match[1]);
  return found;
}

function baseName(path) {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? '';
}

function isSecretPath(token) {
  if (/\s/.test(token)) return false;
  const candidates = [token.replace(/^[0-9]*[<>]+/, '')];
  const equals = token.indexOf('=');
  if (equals > 0) candidates.push(token.slice(equals + 1));
  return candidates.some((candidate) => {
    const name = baseName(candidate);
    if (name === '' || name === '.env.example') return false;
    if (name === '.env' || name.startsWith('.env.') || /^\.env[*?[]/.test(name)) return true;
    if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(name)) return true;
    if (name === '.netrc') return true;
    return /(^|\/)\.aws\/credentials$/.test(candidate);
  });
}

/** Finds `git`, skips its global options and returns the subcommand and everything after it. */
function parseGit(tokens) {
  let index = tokens.findIndex((token) => baseName(token) === 'git');
  if (index === -1) return null;
  const globalOptions = [];
  index += 1;
  while (index < tokens.length && tokens[index].startsWith('-')) {
    const option = tokens[index];
    globalOptions.push(option);
    index += 1;
    if (GIT_OPTIONS_WITH_VALUE.has(option) && index < tokens.length) {
      globalOptions.push(tokens[index]);
      index += 1;
    }
  }
  if (index >= tokens.length) return null;
  return { globalOptions, subcommand: tokens[index], args: tokens.slice(index + 1) };
}

function hasShortFlag(args, letter) {
  for (const arg of args) {
    if (arg === '--') return false;
    if (/^-[A-Za-z]+$/.test(arg) && arg.includes(letter)) return true;
  }
  return false;
}

function checkGit(git) {
  const mentionsHooksPath = (value) => value.toLowerCase().includes('core.hookspath');
  if (git.globalOptions.some(mentionsHooksPath)) return REASON.hooks;
  if (git.subcommand === 'config' && git.args.some(mentionsHooksPath)) return REASON.hooks;
  if (git.args.includes('--no-verify')) return REASON.hooks;
  if (git.subcommand === 'commit' && hasShortFlag(git.args, 'n')) return REASON.hooks;

  if (git.subcommand === 'push') {
    for (const arg of git.args) {
      if (arg === '--') break;
      if (FORCE_LONG_OPTIONS.some((option) => arg === option || arg.startsWith(`${option}=`))) {
        return REASON.force;
      }
      if (arg.length > 1 && arg.startsWith('+')) return REASON.force;
    }
    if (hasShortFlag(git.args, 'f')) return REASON.force;
  }
  return null;
}

function checkSegment(tokens) {
  if (tokens.some((token) => token === 'HUSKY=0')) return REASON.hooks;
  if (tokens.some(isSecretPath)) return REASON.secret;

  const git = parseGit(tokens);
  if (git !== null) {
    const reason = checkGit(git);
    if (reason !== null) return reason;
  }

  // `bash -c "<command>"`: judge the inner command as well.
  const shell = tokens.findIndex((token) => SHELLS.has(baseName(token)));
  if (shell !== -1) {
    const flag = tokens.findIndex((token, i) => i > shell && /^-[A-Za-z]*c[A-Za-z]*$/.test(token));
    if (flag !== -1 && flag + 1 < tokens.length) {
      const inner = judge(tokens[flag + 1]);
      if (inner !== null) return inner;
    }
  }
  return null;
}

/** First rule that the command breaks, or null. */
function judge(command) {
  for (const inner of substitutions(command)) {
    const reason = judge(inner);
    if (reason !== null) return reason;
  }
  for (const tokens of tokenize(command)) {
    const reason = checkSegment(tokens);
    if (reason !== null) return reason;
  }
  return null;
}

/**
 * @param {string} command
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function evaluateBashCommand(command) {
  const reason = judge(command);
  return reason === null ? { blocked: false } : { blocked: true, reason };
}
