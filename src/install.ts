/**
 * Install and uninstall the hook entry in `.claude/settings.json`.
 *
 * MERGE, NEVER REWRITE. That file already carries whatever else the project set up -
 * permissions, other hooks, env, statusLine - and an installer that reformats it has
 * damaged it even when the JSON is equivalent. So:
 *
 *   - the merge functions are pure and every other key is carried through untouched;
 *   - an uninstall removes the entry and nothing else, and drops `hooks` only if it
 *     was left empty, which is a fingerprint we left;
 *   - the file is written back with the INDENTATION AND LINE ENDINGS IT ALREADY HAD,
 *     not with this file's house style.
 *
 * An uninstall described in a README but never executed is not an uninstall, so both
 * directions are a command you can actually run:
 *
 *   node dist/src/install.js install
 *   node dist/src/install.js uninstall
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface HookCommand {
  type: 'command';
  command: string;
  timeout?: number;
}
export interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}
export interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export const EVENT = 'PreToolUse';
export const MATCHER = 'Read';
/** Identifies our entry inside the array, so we only ever remove our own. */
export const MARKER = 'squint/dist/src/hook.js';

/**
 * Seconds, as Claude Code counts hook timeouts. Larger than the 6 s call budget so a
 * slow answer is decided by our own timeout - which fails open - rather than by the
 * harness killing the process at an arbitrary point.
 */
export const TIMEOUT_SECONDS = 20;

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '');

export function buildCommand(installRoot: string): string {
  // One quoted argument: the real path routinely contains spaces on Windows.
  return `node "${norm(installRoot)}/dist/src/hook.js"`;
}

export function buildGroup(installRoot: string, timeout = TIMEOUT_SECONDS): HookGroup {
  return { matcher: MATCHER, hooks: [{ type: 'command', command: buildCommand(installRoot), timeout }] };
}

const has = (groups: HookGroup[]): boolean => groups.some((g) => g.hooks?.some((h) => h.command?.includes(MARKER)));

/** Idempotent BY REFERENCE: an unchanged result is the very object passed in, so the
 *  caller knows it must not rewrite the file. */
export function merge(settings: ClaudeSettings, installRoot: string, timeout = TIMEOUT_SECONDS): ClaudeSettings {
  const existing = settings.hooks?.[EVENT] ?? [];
  if (has(existing)) return settings;
  const hooks = { ...settings.hooks };
  // Appended, never assigned: this array may already hold the project's own guardrails.
  hooks[EVENT] = [...existing, buildGroup(installRoot, timeout)];
  return { ...settings, hooks };
}

export function remove(settings: ClaudeSettings): ClaudeSettings {
  const existing = settings.hooks?.[EVENT];
  if (!existing || !has(existing)) return settings;
  const kept: HookGroup[] = [];
  for (const g of existing) {
    if (!g.hooks?.some((h) => h.command?.includes(MARKER))) {
      kept.push(g);
      continue;
    }
    // Only a group we were IN may disappear. A neighbour that was already empty is
    // the user's, not our residue.
    const hooks = g.hooks.filter((h) => !h.command?.includes(MARKER));
    if (hooks.length > 0) kept.push({ ...g, hooks });
  }
  const hooks = { ...settings.hooks };
  if (kept.length > 0) hooks[EVENT] = kept;
  else delete hooks[EVENT];
  const next: ClaudeSettings = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

export interface Format {
  indent: string;
  eol: '\n' | '\r\n';
  trailingNewline: boolean;
}

/** Copies the formatting we found instead of imposing our own. */
export function detectFormat(raw: string): Format {
  const m = /^([ \t]+)\S/m.exec(raw);
  return {
    indent: m?.[1] ?? '  ',
    eol: raw.includes('\r\n') ? '\r\n' : '\n',
    trailingNewline: raw.endsWith('\n'),
  };
}

export function serialize(settings: ClaudeSettings, f: Format): string {
  const body = JSON.stringify(settings, null, f.indent).split('\n').join(f.eol);
  return f.trailingNewline ? body + f.eol : body;
}

export type Outcome =
  | 'installed'
  | 'uninstalled'
  | 'unchanged'
  | 'missing'
  | 'corrupt'
  /**
   * Written, but the file came back with a different SHAPE than it had.
   *
   * We preserve indentation and line endings, but the entry is added by re-serialising
   * the parsed object, and `JSON.stringify` expands an inline array or object onto
   * several lines. The JSON is equivalent and nothing was lost - but a hand-formatted
   * settings.json will show unrelated lines as changed in a diff, and silently doing
   * that to someone's file is the one outcome that is not acceptable. So it is SAID.
   *
   * Preserving the original bytes exactly needs a textual graft that inserts the entry
   * without reprinting the rest. That is a beta item; this alpha reports the fact
   * instead of hiding it.
   */
  | 'installed-reformatted'
  | 'uninstalled-reformatted';

/**
 * Would re-serialising this file reproduce it? If yes, our write is byte-exact for
 * every line but the one we added. If no, the shape changes and the caller must say so.
 */
export function isCanonical(raw: string, settings: ClaudeSettings, f: Format): boolean {
  return serialize(settings, f) === raw;
}

function load(path: string): { settings: ClaudeSettings; format: Format; missing: boolean; raw: string } | 'corrupt' {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { settings: {}, format: { indent: '  ', eol: '\n', trailingNewline: true }, missing: true, raw: '' };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'corrupt';
    return { settings: parsed as ClaudeSettings, format: detectFormat(raw), missing: false, raw };
  } catch {
    // A file we cannot parse is left ALONE. Overwriting it would destroy settings we
    // never read.
    return 'corrupt';
  }
}

/**
 * Copies the `/squint` skill next to the settings file it was installed with, and bakes
 * the CLI path into it.
 *
 * The placeholder is substituted rather than resolved at run time because a skill is
 * prose handed to a model: it cannot compute a path, so it has to be told one. If the
 * template is missing the install still succeeds - the hook is the product, the skill is
 * the way to ask it questions.
 */
export function installSkill(settingsPath: string, installRoot: string): 'installed' | 'skipped' {
  const template = join(installRoot, 'skills', 'squint', 'SKILL.md');
  if (!existsSync(template)) return 'skipped';
  try {
    const body = readFileSync(template, 'utf8').split('SQUINT_CLI').join(`${norm(installRoot)}/dist/src/bin.js`);
    const dir = join(dirname(settingsPath), 'skills', 'squint');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), body, 'utf8');
    return 'installed';
  } catch {
    return 'skipped';
  }
}

/** The mirror: removes only the file we wrote, never the directory around it. */
export function uninstallSkill(settingsPath: string): 'removed' | 'absent' {
  const file = join(dirname(settingsPath), 'skills', 'squint', 'SKILL.md');
  try {
    if (!existsSync(file)) return 'absent';
    rmSync(file, { force: true });
    return 'removed';
  } catch {
    return 'absent';
  }
}

export function installInto(path: string, installRoot: string): Outcome {
  const loaded = load(path);
  if (loaded === 'corrupt') return 'corrupt';
  const next = merge(loaded.settings, installRoot);
  if (next === loaded.settings) return 'unchanged';
  const exact = loaded.missing || isCanonical(loaded.raw, loaded.settings, loaded.format);
  // A project that has never been configured has no `.claude/` yet, and a fresh
  // install is exactly that case. Found by running the README's own commands on a
  // clean clone, where this threw ENOENT.
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialize(next, loaded.format), 'utf8');
  return exact ? 'installed' : 'installed-reformatted';
}

export function uninstallFrom(path: string): Outcome {
  const loaded = load(path);
  if (loaded === 'corrupt') return 'corrupt';
  if (loaded.missing) return 'missing';
  const next = remove(loaded.settings);
  if (next === loaded.settings) return 'unchanged';
  const exact = isCanonical(loaded.raw, loaded.settings, loaded.format);
  writeFileSync(path, serialize(next, loaded.format), 'utf8');
  return exact ? 'uninstalled' : 'uninstalled-reformatted';
}

// --- CLI ----------------------------------------------------------------------

const USAGE = [
  'squint installer',
  '',
  '  install                      turn it on for EVERY project (~/.claude/settings.json)',
  '  install --project <dir>      turn it on for one project only',
  '  install --settings <file>    write to an exact settings file',
  '',
  '  uninstall [same flags]       take it back out of the same place',
  '',
  'The default is your user settings, not the current directory. Installing into a',
  'clone of this repository would do nothing: Claude Code reads the settings of the',
  'project you are working in, and that is never this one.',
].join('\n');

/**
 * Where the entry goes. The default is the USER settings file, and that choice was
 * made by a bug: with the current directory as default, the README's own commands
 * installed the hook into the clone of this repository - where it can never fire,
 * because Claude Code reads the settings of whatever project you are working in.
 */
export function targetOf(argv: readonly string[], cwd: string): string {
  const s = argv.indexOf('--settings');
  if (s >= 0 && argv[s + 1]) return resolve(cwd, argv[s + 1] as string);
  const p = argv.indexOf('--project');
  if (p >= 0 && argv[p + 1]) return join(resolve(cwd, argv[p + 1] as string), '.claude', 'settings.json');
  return join(homedir(), '.claude', 'settings.json');
}

export function cli(argv: readonly string[], cwd: string, installRoot: string): { text: string; code: number } {
  const cmd = argv[0];
  const path = targetOf(argv, cwd);

  /** Said out loud, never hidden: we changed the shape of a file we did not write. */
  const note = (r: Outcome): string =>
    r.endsWith('-reformatted')
      ? [
          '',
          '  note: the entry was added, but your settings.json was hand-formatted and has',
          '  been re-printed. The JSON is equivalent and nothing was lost - but unrelated',
          '  lines will show as changed in a diff. Check it before committing.',
        ].join('\n')
      : '';

  if (cmd === 'install') {
    const r = installInto(path, installRoot);
    return { text: `squint · install · ${r} · ${path}${note(r)}`, code: r === 'corrupt' ? 1 : 0 };
  }
  if (cmd === 'uninstall') {
    const r = uninstallFrom(path);
    return { text: `squint · uninstall · ${r} · ${path}${note(r)}`, code: r === 'corrupt' ? 1 : 0 };
  }
  return { text: USAGE, code: cmd === undefined ? 0 : 1 };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  // dist/src/install.js -> the package root is two levels up.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { text, code } = cli(process.argv.slice(2), process.cwd(), root);
  process.stdout.write(text + '\n');
  process.exit(code);
}
