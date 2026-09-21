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
 *   - the entry is spliced into the bytes as they are, so every other line survives
 *     verbatim - inline arrays included - and the splice is verified by re-parsing
 *     before it is trusted; only when that fails is the file re-serialised, with the
 *     indentation and line endings it already had, and the outcome says so.
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
import { isDeepStrictEqual } from 'node:util';

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
   * The normal path is the textual graft below, which splices the entry into the bytes
   * as they are and leaves every other line untouched. This outcome is the FALLBACK for
   * a file the graft cannot model - duplicate keys are the real case - where the entry
   * is added by re-serialising the parsed object instead, and `JSON.stringify` expands
   * an inline array or object onto several lines. The JSON is equivalent and nothing
   * was lost - but unrelated lines will show as changed in a diff, and silently doing
   * that to someone's file is the one outcome that is not acceptable. So it is SAID.
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

// --- The textual graft ----------------------------------------------------------
//
// A hand-formatted settings.json keeps short arrays and leaf objects on one line, and a
// whole-file reserialize expands every one of them. So the entry is SPLICED INTO THE
// TEXT instead: a minimal JSON scanner finds the container it belongs in, copies the
// separator its neighbours already use, and inserts the entry after the last of them.
// The uninstall is the exact inverse - it removes the entry together with the separator
// that joined it. Ported from the JEF installer, where the byte-for-byte tests it
// carries were written first.
//
// NONE OF THIS IS TRUSTED. `verifiedGraft` re-parses the spliced text and compares it
// with the settings the structural merge produced; on any disagreement the caller falls
// back to the reserialize and reports `-reformatted`. The scanner can be wrong; the
// file it edits holds the user's permissions; the verification is what makes the
// combination acceptable.

interface Bounds {
  start: number;
  end: number;
}
interface Member extends Bounds {
  key: string;
  valueStart: number;
}
type PathStep = string | number;

function skipWhitespace(raw: string, i: number): number {
  while (i < raw.length && (raw[i] === ' ' || raw[i] === '\t' || raw[i] === '\n' || raw[i] === '\r')) i++;
  return i;
}

/** Index just past the closing quote. Only `\\` matters: it can hide the quote that follows. */
function scanString(raw: string, i: number): number {
  for (i += 1; i < raw.length; i += 1) {
    if (raw[i] === '\\') i += 1;
    else if (raw[i] === '"') return i + 1;
  }
  throw new Error('unterminated string');
}

/** Index just past the value starting at `i` (which must be its first character). */
function scanValue(raw: string, i: number): number {
  if (i >= raw.length) throw new Error('value expected');
  if (raw[i] === '"') return scanString(raw, i);
  if (raw[i] === '{' || raw[i] === '[') {
    let depth = 0;
    for (let j = i; j < raw.length; j += 1) {
      const c = raw[j] as string;
      if (c === '"') {
        j = scanString(raw, j) - 1;
      } else if (c === '{' || c === '[') {
        depth += 1;
      } else if ((c === '}' || c === ']') && (depth -= 1) === 0) {
        return j + 1;
      }
    }
    throw new Error('unterminated container');
  }
  // A number, `true`, `false` or `null`: it ends where the enclosing syntax resumes.
  let j = i;
  while (j < raw.length && !' \t\r\n,}]'.includes(raw[j] as string)) j += 1;
  if (j === i) throw new Error('empty value');
  return j;
}

function objectMembers(raw: string, objectStart: number): Member[] {
  const out: Member[] = [];
  let i = skipWhitespace(raw, objectStart + 1);
  while (raw[i] !== '}') {
    const start = i;
    const keyEnd = scanString(raw, i);
    i = skipWhitespace(raw, keyEnd);
    if (raw[i] !== ':') throw new Error('expected a colon');
    const valueStart = skipWhitespace(raw, i + 1);
    const end = scanValue(raw, valueStart);
    out.push({ key: JSON.parse(raw.slice(start, keyEnd)) as string, start, valueStart, end });
    i = skipWhitespace(raw, end);
    if (raw[i] === ',') i = skipWhitespace(raw, i + 1);
  }
  return out;
}

function arrayElements(raw: string, arrayStart: number): Bounds[] {
  const out: Bounds[] = [];
  let i = skipWhitespace(raw, arrayStart + 1);
  while (raw[i] !== ']') {
    const end = scanValue(raw, i);
    out.push({ start: i, end });
    i = skipWhitespace(raw, end);
    if (raw[i] === ',') i = skipWhitespace(raw, i + 1);
  }
  return out;
}

function containerBounds(raw: string, containerStart: number): Bounds[] {
  return raw[containerStart] === '{' ? objectMembers(raw, containerStart) : arrayElements(raw, containerStart);
}

/** First character of the value at `path`, or null when the path is not in the file. */
function locateValue(raw: string, path: readonly PathStep[]): number | null {
  let start = skipWhitespace(raw, 0);
  for (const step of path) {
    if (typeof step === 'string') {
      if (raw[start] !== '{') return null;
      const member = objectMembers(raw, start).find((m) => m.key === step);
      if (!member) return null;
      start = member.valueStart;
    } else {
      if (raw[start] !== '[') return null;
      const element = arrayElements(raw, start)[step];
      if (!element) return null;
      start = element.start;
    }
  }
  return start;
}

/**
 * The whitespace that joins two siblings in this container, copied from the container
 * itself: it carries the indentation AND the inline-versus-expanded choice, which is
 * the part `Format` cannot express.
 */
function siblingSeparator(raw: string, containerStart: number, items: readonly Bounds[]): string {
  if (items.length >= 2) {
    const gap = raw.slice(items[0]!.end, items[1]!.start);
    return gap.slice(gap.indexOf(',') + 1);
  }
  if (items.length === 1) return raw.slice(containerStart + 1, items[0]!.start);
  return '';
}

/** Our own entry, laid out to match the separator it will follow. */
function renderEntry(value: unknown, key: string | null, separator: string, f: Format): string {
  const lineIndent = /(?:\r?\n)([ \t]*)$/.exec(separator)?.[1];
  const body =
    lineIndent === undefined
      ? JSON.stringify(value) // the container is written inline, so the new entry is too
      : JSON.stringify(value, null, f.indent).split('\n').join(f.eol + lineIndent);
  return key === null ? body : `${JSON.stringify(key)}: ${body}`;
}

/** Appends one entry at the end of a container, touching nothing before the insertion point. */
function appendEntry(raw: string, containerStart: number, key: string | null, value: unknown, f: Format): string {
  const items = containerBounds(raw, containerStart);
  const separator = siblingSeparator(raw, containerStart, items);
  const at = items.length > 0 ? items[items.length - 1]!.end : containerStart + 1;
  const glue = items.length > 0 ? `,${separator}` : separator;
  return raw.slice(0, at) + glue + renderEntry(value, key, separator, f) + raw.slice(at);
}

/**
 * The exact inverse of `appendEntry`: an entry is removed together with the separator
 * that joined it to its left neighbour - which, for the entry the install appended, is
 * precisely the span the install had added.
 */
function removeEntry(raw: string, containerStart: number, index: number): string {
  const items = containerBounds(raw, containerStart);
  const target = items[index];
  if (!target) throw new Error('entry index out of range');
  if (index > 0) return raw.slice(0, items[index - 1]!.end) + raw.slice(target.end);
  // First of several: the comma is on its right instead. Sole entry: back to the
  // bracket, which is where `appendEntry` inserted into an empty container.
  if (items.length > 1) return raw.slice(0, target.start) + raw.slice(items[1]!.start);
  return raw.slice(0, containerStart + 1) + raw.slice(target.end);
}

function removeEntryAt(raw: string, containerPath: readonly PathStep[], index: number): string | null {
  const at = locateValue(raw, containerPath);
  return at === null ? null : removeEntry(raw, at, index);
}

function removeMemberAt(raw: string, containerPath: readonly PathStep[], key: string): string | null {
  const at = locateValue(raw, containerPath);
  if (at === null || raw[at] !== '{') return null;
  const index = objectMembers(raw, at).findIndex((m) => m.key === key);
  return index < 0 ? null : removeEntry(raw, at, index);
}

/** Splices our group in at the shallowest container that already exists. */
export function graftHookGroup(raw: string, f: Format, group: HookGroup): string | null {
  const root = skipWhitespace(raw, 0);
  if (raw[root] !== '{') return null;

  const hooksAt = locateValue(raw, ['hooks']);
  if (hooksAt === null) return appendEntry(raw, root, 'hooks', { [EVENT]: [group] }, f);
  if (raw[hooksAt] !== '{') return null;

  const eventAt = locateValue(raw, ['hooks', EVENT]);
  if (eventAt === null) return appendEntry(raw, hooksAt, EVENT, [group], f);
  if (raw[eventAt] !== '[') return null;

  return appendEntry(raw, eventAt, null, group, f);
}

/**
 * Takes back out the smallest span that is ours alone - one more level would take a
 * neighbour. Mirrors `remove()` level for level, including dropping `hooks` when we
 * were the only thing in it.
 */
export function graftRemoveGroup(raw: string, settings: ClaudeSettings): string | null {
  const groups = settings.hooks?.[EVENT] ?? [];
  const groupIndex = groups.findIndex((g) => g.hooks?.some((h) => h.command?.includes(MARKER)));
  if (groupIndex < 0) return null;

  const commands = groups[groupIndex]!.hooks;
  if (commands.length > 1) {
    const index = commands.findIndex((h) => h.command?.includes(MARKER));
    return removeEntryAt(raw, ['hooks', EVENT, groupIndex, 'hooks'], index);
  }
  if (groups.length > 1) return removeEntryAt(raw, ['hooks', EVENT], groupIndex);
  if (Object.keys(settings.hooks ?? {}).length > 1) return removeMemberAt(raw, ['hooks'], EVENT);
  return removeMemberAt(raw, [], 'hooks');
}

/**
 * A graft is accepted only once the bytes it produced parse back to the settings the
 * structural merge intended: deterministic evidence, not a belief about the scanner.
 * Duplicate keys are the real case this catches - `JSON.parse` keeps the last, a
 * textual scan finds the first.
 */
export function verifiedGraft(graft: () => string | null, expected: ClaudeSettings): string | null {
  try {
    const text = graft();
    return text !== null && isDeepStrictEqual(JSON.parse(text), expected) ? text : null;
  } catch {
    return null;
  }
}

interface Loaded {
  settings: ClaudeSettings;
  format: Format;
  missing: boolean;
  raw: string;
}

function load(path: string): Loaded | 'corrupt' {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    // Only a file that is NOT THERE may be created from scratch. Any other failure -
    // a directory at that path, a permission - is a file we could not read, and the
    // rule below applies to it: what was not read is not overwritten.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return 'corrupt';
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

/**
 * Writes `next` back, preferring the textual graft so the user's own bytes are never
 * re-laid-out. The whole-file reserialize is kept for the two cases where it is honest:
 * a file we are creating, and a file already in exactly the shape `JSON.stringify`
 * produces, where the rewrite is provably lossless. Anything else falls through to
 * `reformatted` - still written, but said out loud.
 */
function writeMerged(path: string, loaded: Loaded, next: ClaudeSettings, graft: () => string | null): 'exact' | 'reformatted' {
  if (loaded.missing || isCanonical(loaded.raw, loaded.settings, loaded.format)) {
    writeFileSync(path, serialize(next, loaded.format), 'utf8');
    return 'exact';
  }
  const grafted = verifiedGraft(graft, next);
  writeFileSync(path, grafted ?? serialize(next, loaded.format), 'utf8');
  return grafted === null ? 'reformatted' : 'exact';
}

export function installInto(path: string, installRoot: string): Outcome {
  const loaded = load(path);
  if (loaded === 'corrupt') return 'corrupt';
  const next = merge(loaded.settings, installRoot);
  if (next === loaded.settings) return 'unchanged';
  // A project that has never been configured has no `.claude/` yet, and a fresh
  // install is exactly that case. Found by running the README's own commands on a
  // clean clone, where this threw ENOENT.
  mkdirSync(dirname(path), { recursive: true });
  const written = writeMerged(path, loaded, next, () => graftHookGroup(loaded.raw, loaded.format, buildGroup(installRoot)));
  return written === 'exact' ? 'installed' : 'installed-reformatted';
}

export function uninstallFrom(path: string): Outcome {
  const loaded = load(path);
  if (loaded === 'corrupt') return 'corrupt';
  if (loaded.missing) return 'missing';
  const next = remove(loaded.settings);
  if (next === loaded.settings) return 'unchanged';
  const written = writeMerged(path, loaded, next, () => graftRemoveGroup(loaded.raw, loaded.settings));
  return written === 'exact' ? 'uninstalled' : 'uninstalled-reformatted';
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
