/**
 * `squint <command>` — the surface a person uses.
 *
 * Everything here is read-only or reversible, with one exception: `key` writes your
 * TypeSafe key into your user environment, and it says so before it does it.
 *
 * The commands exist because a hook with no surface is a hook you cannot debug. When a
 * read is not narrowed you want to know whether the key is missing, the file is too
 * small, or the model was unsure - and "nothing happened" looks identical in all three.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { CONFIG_FILENAME, loadConfig } from './config.js';
import { apiKeyFrom } from './jev.js';
import { LEDGER_DIR } from './ledger.js';
import { installInto, installSkill, MARKER, targetOf, uninstallFrom, uninstallSkill, type Outcome } from './install.js';
import type { NarrowRecord } from './types.js';

const OK = 'ok';
const NO = 'MISSING';

// --- reading the ledger --------------------------------------------------------

export interface Summary {
  sessions: number;
  looked: number;
  narrowed: number;
  linesAvoided: number;
  inputTokens: number;
  reasons: Record<string, number>;
  confidences: number[];
}

export function summarise(records: readonly NarrowRecord[], sessions: number): Summary {
  const s: Summary = { sessions, looked: records.length, narrowed: 0, linesAvoided: 0, inputTokens: 0, reasons: {}, confidences: [] };
  for (const r of records) {
    s.inputTokens += r.inputTokens ?? 0;
    if (r.narrowed) {
      s.narrowed += 1;
      s.linesAvoided += r.linesAvoided ?? 0;
      if (typeof r.confidence === 'number') s.confidences.push(r.confidence);
    } else if (r.reason !== undefined) {
      s.reasons[r.reason] = (s.reasons[r.reason] ?? 0) + 1;
    }
  }
  return s;
}

export function readLedger(projectRoot: string): Summary {
  const dir = join(projectRoot, LEDGER_DIR);
  if (!existsSync(dir)) return summarise([], 0);
  const records: NarrowRecord[] = [];
  let sessions = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    sessions += 1;
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      try {
        records.push(JSON.parse(line) as NarrowRecord);
      } catch {
        // one bad line never costs the whole report
      }
    }
  }
  return summarise(records, sessions);
}

/**
 * The report. Note what it does NOT print: a token saving.
 *
 * The hook knows how many LINES it stopped from being read. Turning that into tokens
 * needs a divisor, and a measurement multiplied by a guess is a guess. So the lines are
 * ACTUAL and the token figure is absent, rather than invented.
 */
export function renderReport(s: Summary, root: string): string {
  const out: string[] = [];
  out.push(`squint · report · ${root}`);
  if (s.looked === 0) {
    out.push('');
    out.push('  No reads recorded yet. The ledger appears once Claude reads a file here.');
    return out.join('\n');
  }
  const rate = ((s.narrowed / s.looked) * 100).toFixed(0);
  out.push('');
  out.push(`  sessions            ${s.sessions}`);
  out.push(`  reads looked at     ${s.looked}`);
  out.push(`  of those, narrowed  ${s.narrowed}  (${rate}%)`);
  out.push(`  lines not read      ${s.linesAvoided.toLocaleString('en-US')}   ACTUAL, a line count - never converted to tokens`);
  out.push(`  Jev input tokens    ${s.inputTokens.toLocaleString('en-US')}   ACTUAL, what the decisions cost`);
  if (s.confidences.length > 0) {
    const c = [...s.confidences].sort((a, b) => a - b);
    out.push(`  confidence          min ${c[0]?.toFixed(2)} · median ${c[Math.floor(c.length / 2)]?.toFixed(2)} · max ${c[c.length - 1]?.toFixed(2)}`);
  }
  const reasons = Object.entries(s.reasons).sort((a, b) => b[1] - a[1]);
  if (reasons.length > 0) {
    out.push('');
    out.push('  left alone, and why  (these are the denominator, not failures)');
    for (const [why, n] of reasons) out.push(`    ${String(n).padStart(4)}  ${why}`);
  }
  return out.join('\n');
}

// --- doctor --------------------------------------------------------------------

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export function keyCommandFor(platform: string): string {
  if (platform === 'win32') return 'setx TYPESAFE_API_KEY "your-key-here"        (then open a NEW terminal)';
  return 'export TYPESAFE_API_KEY=your-key-here        (add it to ~/.bashrc or ~/.zshrc)';
}

export function doctorChecks(env: NodeJS.ProcessEnv, platform: string, installRoot: string, target: string): Check[] {
  const checks: Check[] = [];

  const major = Number((process.versions.node ?? '0').split('.')[0]);
  checks.push({
    name: 'Node >= 20',
    ok: major >= 20,
    detail: `found ${process.versions.node}`,
    ...(major >= 20 ? {} : { fix: 'install Node 20 or newer' }),
  });

  const built = existsSync(join(installRoot, 'dist', 'src', 'hook.js'));
  checks.push({
    name: 'built',
    ok: built,
    detail: built ? 'dist/src/hook.js is present' : 'dist/ is missing',
    ...(built ? {} : { fix: 'npm run build' }),
  });

  const key = apiKeyFrom(env) !== null;
  checks.push({
    name: 'TYPESAFE_API_KEY',
    ok: key,
    // The key is never printed, not even partially: a prefix is still a leak in a log.
    detail: key ? 'present in the environment' : 'not set',
    ...(key ? {} : { fix: keyCommandFor(platform) }),
  });

  let installed = false;
  try {
    installed = existsSync(target) && readFileSync(target, 'utf8').includes(MARKER);
  } catch {
    installed = false;
  }
  checks.push({
    name: 'hook registered',
    ok: installed,
    detail: installed ? target : `not in ${target}`,
    ...(installed ? {} : { fix: 'squint install' }),
  });

  return checks;
}

export function renderDoctor(checks: readonly Check[]): string {
  const out = ['squint · doctor', ''];
  for (const c of checks) {
    out.push(`  [${c.ok ? OK : NO}] ${c.name.padEnd(18)} ${c.detail}`);
    if (!c.ok && c.fix !== undefined) out.push(`         -> ${c.fix}`);
  }
  const bad = checks.filter((c) => !c.ok).length;
  out.push('');
  out.push(bad === 0 ? '  Ready. Open a project and use Claude Code normally.' : `  ${bad} thing(s) to fix above.`);
  return out.join('\n');
}

// --- the on/off switch ----------------------------------------------------------

/**
 * Flips `narrow.enabled` in `.squint.json`, creating the file if needed.
 *
 * Deliberately NOT an uninstall: turning it off leaves the hook registered, so it still
 * runs and still records that it was asked and declined. Uninstalling hides the fact
 * that it was ever there, and those are different things to want.
 */
export function setEnabled(projectRoot: string, enabled: boolean): string {
  const path = join(projectRoot, CONFIG_FILENAME);
  let raw: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      raw = {};
    }
  }
  const narrow = (typeof raw['narrow'] === 'object' && raw['narrow'] !== null ? raw['narrow'] : {}) as Record<string, unknown>;
  narrow['enabled'] = enabled;
  raw['narrow'] = narrow;
  writeFileSync(path, JSON.stringify(raw, null, 2) + '\n', 'utf8');
  return path;
}

// --- persisting the key ----------------------------------------------------------

/**
 * Writes the key to the user environment. Windows only for now, and that limit is
 * stated rather than faked: `setx` has an equivalent nowhere else, and appending to
 * somebody's shell profile from a tool is a thing to do only when you can test it.
 */
export function persistKey(key: string, platform: string): { ok: boolean; text: string } {
  if (platform !== 'win32') {
    return { ok: false, text: `Add this to your shell profile, then open a new terminal:\n\n  export TYPESAFE_API_KEY=${'*'.repeat(8)}\n\n(squint does not edit shell profiles: it cannot test that on this platform.)` };
  }
  const r = spawnSync('setx', ['TYPESAFE_API_KEY', key], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return { ok: false, text: `setx failed (exit ${String(r.status)}). Set TYPESAFE_API_KEY by hand.` };
  return { ok: true, text: 'Saved to your user environment. Open a NEW terminal for it to take effect.' };
}

export async function promptKey(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write(
      [
        'squint · key',
        '',
        '  Your TypeSafe key is read from the environment and never stored by squint',
        '  itself. This writes it once to your USER environment variables so every',
        '  terminal and every Claude Code session inherits it.',
        '',
        '  Get one at https://docs.typesafe.ai',
        '',
      ].join('\n') + '\n',
    );
    const key = await rl.question('  TYPESAFE_API_KEY: ');
    return key.trim();
  } finally {
    rl.close();
  }
}

// --- dispatch --------------------------------------------------------------------

const USAGE = [
  'squint · narrow a Read to the part that answers the question',
  '',
  '  squint doctor                is everything ready?',
  '  squint report                what the hook has done in this project',
  '  squint on | off              turn narrowing on or off here, without uninstalling',
  '  squint key                   store your TypeSafe key in your user environment',
  '',
  '  squint install               register the hook for EVERY project',
  '  squint install --project <dir>     ... for one project only',
  '  squint install --settings <file>   ... into an exact settings file',
  '  squint uninstall [same flags]      take it back out',
  '',
].join('\n');

export interface CliDeps {
  env: NodeJS.ProcessEnv;
  platform: string;
  cwd: string;
  installRoot: string;
  prompt?: () => Promise<string>;
}

export async function run(argv: readonly string[], deps: CliDeps): Promise<{ text: string; code: number }> {
  const cmd = argv[0];
  const target = targetOf(argv, deps.cwd);

  switch (cmd) {
    case 'doctor': {
      const checks = doctorChecks(deps.env, deps.platform, deps.installRoot, target);
      return { text: renderDoctor(checks), code: checks.every((c) => c.ok) ? 0 : 1 };
    }
    case 'report':
      return { text: renderReport(readLedger(deps.cwd), deps.cwd), code: 0 };

    case 'on':
    case 'off': {
      const path = setEnabled(deps.cwd, cmd === 'on');
      return { text: `squint · ${cmd} · ${path}`, code: 0 };
    }
    case 'key': {
      // Trimmed HERE, not trusted from the prompt. A test that returned two spaces
      // got past an `=== ''` check and made setx write a whitespace key into the
      // user environment - which then looks present to the doctor and fails every
      // call with a 401. Whatever answers, it is cleaned before anything is written.
      const key = (await (deps.prompt ?? promptKey)()).trim();
      if (key === '') return { text: '  Nothing entered, nothing written.', code: 1 };
      const r = persistKey(key, deps.platform);
      return { text: '\n  ' + r.text, code: r.ok ? 0 : 1 };
    }
    case 'install': {
      const r: Outcome = installInto(target, deps.installRoot);
      const skill = installSkill(target, deps.installRoot);
      const lines = [`squint · install · ${r} · ${target}`];
      if (skill === 'installed') lines.push('  the /squint command is available in Claude Code');
      if (r.endsWith('-reformatted')) {
        lines.push('  note: your settings.json was hand-formatted and has been re-printed.');
        lines.push('  The JSON is equivalent and nothing was lost, but unrelated lines will');
        lines.push('  show as changed in a diff. Check it before committing.');
      }
      // The install is worth nothing without the key, so the check comes with it
      // rather than waiting for somebody to wonder why nothing is happening.
      if (apiKeyFrom(deps.env) === null) {
        lines.push('');
        lines.push('  TYPESAFE_API_KEY is not set, so every read will pass through untouched.');
        lines.push('  Run:  squint key        or set it yourself:');
        lines.push(`        ${keyCommandFor(deps.platform)}`);
      }
      return { text: lines.join('\n'), code: r === 'corrupt' ? 1 : 0 };
    }
    case 'uninstall': {
      const r = uninstallFrom(target);
      const skill = uninstallSkill(target);
      const lines = [`squint · uninstall · ${r} · ${target}`];
      if (skill === 'removed') lines.push('  the /squint command was removed too');
      return { text: lines.join('\n'), code: r === 'corrupt' ? 1 : 0 };
    }
    default:
      return { text: USAGE, code: cmd === undefined ? 0 : 1 };
  }
}
