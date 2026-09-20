/**
 * The ledger, and the two rules that keep it honest.
 *
 * ONE: every Read the hook looked at gets a line, narrowed or not. The refusals are
 * the denominator. A ledger of successes only would report a 100% hit rate for a hook
 * that fires on one file in six, which is the exact shape of lie this file exists to
 * prevent.
 *
 * TWO: `linesAvoided` is a count of LINES. It is never multiplied by a
 * characters-per-token divisor to produce a token figure, because the hook does not
 * know how those lines would tokenise. A measurement multiplied by a guess is a guess.
 *
 * Writing to it must never be able to break a Read: every entry point here swallows
 * its own failures.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, isAbsolute, join, relative, sep } from 'node:path';

import type { NarrowRecord } from './types.js';

export const LEDGER_DIR = '.squint';

/** Paths that must never leave the machine, whatever else is configured. */
const EXCLUDED = [/(^|[\\/])\.env($|[.\\/])/i, /(^|[\\/])secrets?([\\/]|$)/i, /(^|[\\/])\.git([\\/]|$)/i];

export function isExcludedPath(p: string): boolean {
  return EXCLUDED.some((re) => re.test(p));
}

/**
 * Repo-relative where possible. An absolute path on a developer's machine carries a
 * username, and the ledger is a file people paste into issues.
 */
export function shortPath(path: string, projectRoot: string): string {
  if (!isAbsolute(path)) return path.split(sep).join('/');
  const rel = relative(projectRoot, path);
  return rel === '' || rel.startsWith('..') ? basename(path) : rel.split(sep).join('/');
}

/**
 * The goal comes from the user's own words and goes to a third party, so anything
 * shaped like a credential is removed before it leaves. This is a coarse net by
 * design: it catches the common vendor prefixes and long opaque strings, and it does
 * NOT claim to catch a secret with no recognisable shape. That limit is stated rather
 * than hidden - see the README's "What leaves your machine".
 */
export function scrub(text: string): string {
  return text
    .replace(/\b(sk|pk|gh[pousr]|xox[baprs]|AKIA|ASIA)[-_A-Za-z0-9]{12,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]')
    .replace(/\b(api[_-]?key|token|secret|password|passwd)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

export function appendRecord(projectRoot: string, record: NarrowRecord): void {
  try {
    const dir = join(projectRoot, LEDGER_DIR);
    mkdirSync(dir, { recursive: true });
    const safe = record.sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'unknown';
    appendFileSync(join(dir, `session-${safe}.jsonl`), JSON.stringify(record) + '\n', 'utf8');
  } catch {
    // The ledger is never allowed to cost a Read.
  }
}
