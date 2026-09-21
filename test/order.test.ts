/**
 * The ORDER in which the hook touches the disk.
 *
 * This is not tidiness. Two defects were measured on 2026-09-21 and both were orderings:
 *
 *   1. The hook read the file BEFORE asking whether it needed it, so a 40 MB path under
 *      `Secrets/` was pulled into memory and refused afterwards (43 ms -> 89 ms). The
 *      project rule is that an excluded path is never READ and never sent; only the
 *      second half of that held.
 *   2. `squint off` wrote `.squint.json` next to wherever you were standing, while the
 *      hook reads it from the project root. From a subdirectory the switch printed
 *      `off` and narrowing stayed on.
 *
 * The trick below is that a path which does NOT EXIST cannot be read. If the hook still
 * reports `excluded-path` or `agent-set-window`, it decided before opening anything -
 * had it tried, the answer would have been `no-path` / unreadable. The test therefore
 * fails if the old order ever comes back.
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';

import { main } from '../src/hook.js';
import { canonicalDir, projectRootFrom } from '../src/cli.js';
import { appendRecord, countCalls } from '../src/ledger.js';
import { preflightNoFile, preflightSize } from '../src/policy.js';
import { DEFAULT_CONFIG, type NarrowRecord } from '../src/types.js';

const dir = mkdtempSync(join(tmpdir(), 'squint-order-'));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the hook on a payload and returns the ledger line it would have written. */
async function reasonFor(toolInput: Record<string, unknown>): Promise<string | undefined> {
  let written: NarrowRecord | undefined;
  await main({
    raw: JSON.stringify({ tool_name: 'Read', session_id: 's', transcript_path: '', tool_input: toolInput }),
    env: {},
    projectRoot: dir,
    stdout: () => undefined,
    stderr: () => undefined,
    append: (_root, record) => void (written = record),
  });
  return written?.reason;
}

describe('the hook decides before it reads', () => {
  it('refuses an excluded path that does not exist — so it cannot have opened it', async () => {
    const ghost = join(dir, 'Secrets', 'nothing-here.txt');
    assert.equal(await reasonFor({ file_path: ghost }), 'excluded-path');
  });

  it('refuses an agent-set window on a file that does not exist', async () => {
    const ghost = join(dir, 'imaginary.ts');
    assert.equal(await reasonFor({ file_path: ghost, offset: 10, limit: 20 }), 'agent-set-window');
  });

  it('a real excluded file is still refused, and its size never mattered', async () => {
    mkdirSync(join(dir, 'Secrets'), { recursive: true });
    const real = join(dir, 'Secrets', 'api.txt');
    writeFileSync(real, 'sk-must-never-be-read\n'.repeat(1000), 'utf8');
    assert.equal(await reasonFor({ file_path: real }), 'excluded-path');
  });

  it('records totalLines 0 when nothing was opened, which means UNREAD', async () => {
    let written: NarrowRecord | undefined;
    await main({
      raw: JSON.stringify({ tool_name: 'Read', session_id: 's', transcript_path: '', tool_input: { file_path: join(dir, 'Secrets', 'x') } }),
      env: {}, projectRoot: dir, stdout: () => undefined, stderr: () => undefined,
      append: (_r, rec) => void (written = rec),
    });
    assert.equal(written?.totalLines, 0);
    assert.equal(written?.goalAgeTurns, undefined, 'the transcript must not have been parsed either');
  });
});

describe('the ceiling on calls per session', () => {
  // A file the hook would call on, a transcript with a goal, no key: the Read stops at
  // `unavailable` (the call was due, nothing answered) - or at `budget-spent` before
  // the call is even attempted. Which of the two says whether the ceiling worked.
  const root = mkdtempSync(join(tmpdir(), 'squint-budget-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const big = join(root, 'big.ts');
  writeFileSync(big, Array.from({ length: 600 }, (_, i) => `const line${i} = ${i};`).join('\n'), 'utf8');
  const transcript = join(root, 't.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'user', message: { content: 'find where the parser is built' } }) + '\n', 'utf8');
  const paid: NarrowRecord = { timestamp: 't', sessionId: 'budget', path: 'big.ts', totalLines: 600, narrowed: true, inputTokens: 100 };
  const refused: NarrowRecord = { timestamp: 't', sessionId: 'budget', path: 'big.ts', totalLines: 600, narrowed: false, reason: 'low-confidence' };

  const reasonWith = async (config: string, ledgerRows: NarrowRecord[]): Promise<string | undefined> => {
    rmSync(join(root, '.squint'), { recursive: true, force: true });
    writeFileSync(join(root, '.squint.json'), config, 'utf8');
    for (const r of ledgerRows) appendRecord(root, r);
    let written: NarrowRecord | undefined;
    await main({
      raw: JSON.stringify({ tool_name: 'Read', session_id: 'budget', transcript_path: transcript, tool_input: { file_path: big } }),
      env: {}, projectRoot: root, stdout: () => undefined, stderr: () => undefined,
      append: (_r, rec) => void (written = rec),
    });
    return written?.reason;
  };

  it('lets the call through while the session is under the ceiling', async () => {
    assert.equal(await reasonWith('{"narrow":{"maxCallsPerSession":2}}', [paid]), 'unavailable');
  });

  it('refuses, and RECORDS the refusal, once the ceiling is reached', async () => {
    assert.equal(await reasonWith('{"narrow":{"maxCallsPerSession":2}}', [paid, paid]), 'budget-spent');
  });

  it('counts only calls that were paid for: refusals are not spending', async () => {
    assert.equal(await reasonWith('{"narrow":{"maxCallsPerSession":2}}', [paid, refused, refused, refused]), 'unavailable');
  });

  it('counts per session, not per project', async () => {
    const other = { ...paid, sessionId: 'someone-else' };
    assert.equal(await reasonWith('{"narrow":{"maxCallsPerSession":1}}', [other, other]), 'unavailable');
  });

  it('the default ceiling is far above anything a real session has done', () => {
    // [ACTUAL] 75 sessions with the hook on, maximum 1 call. The default is a bound on
    // a runaway, not a tuned threshold - see types.ts.
    assert.ok(DEFAULT_CONFIG.maxCallsPerSession >= 20);
    assert.equal(countCalls(root, 'no-such-session'), 0, 'no ledger means no calls, never an error');
  });
});

describe('the two preflight stages agree with the ladder', () => {
  const base = { toolName: 'Read', hasExplicitWindow: false, path: 'a.ts', excluded: false };

  it('lets an ordinary read through to the stages that need the file', () => {
    assert.equal(preflightNoFile(base, DEFAULT_CONFIG).action, 'ask');
  });

  it('stops an excluded path before any size is known', () => {
    const r = preflightNoFile({ ...base, excluded: true }, DEFAULT_CONFIG);
    assert.equal(r.action === 'pass' && r.reason, 'excluded-path');
  });

  it('the size gate answers from a byte count alone', () => {
    assert.equal(preflightSize(DEFAULT_CONFIG.maxBytes, DEFAULT_CONFIG).action, 'ask');
    const r = preflightSize(DEFAULT_CONFIG.maxBytes + 1, DEFAULT_CONFIG);
    assert.equal(r.action === 'pass' && r.reason, 'file-too-large');
  });
});

describe('the CLI finds the same project root as the hook', () => {
  const root = mkdtempSync(join(tmpdir(), 'squint-root-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const deep = join(root, 'src', 'deep');
  mkdirSync(deep, { recursive: true });
  mkdirSync(join(root, '.claude'), { recursive: true });

  it('walks up from a subdirectory to the marked root', () => {
    assert.equal(projectRootFrom(deep, {}), canonicalDir(root));
  });

  it('CLAUDE_PROJECT_DIR wins, because when it is set it IS the answer', () => {
    assert.equal(projectRootFrom(deep, { CLAUDE_PROJECT_DIR: root }), canonicalDir(root));
  });

  it('falls back to the current directory when nothing is marked', () => {
    const bare = mkdtempSync(join(tmpdir(), 'squint-bare-'));
    after(() => rmSync(bare, { recursive: true, force: true }));
    assert.equal(projectRootFrom(bare, {}), canonicalDir(bare));
  });

  it('never calls HOME the project, however many markers live there', () => {
    // This is the case the previous version got wrong: `~/.claude` exists for every
    // Claude Code user, so an unmarked directory under home resolved to home itself.
    const bare = mkdtempSync(join(tmpdir(), 'squint-home-'));
    after(() => rmSync(bare, { recursive: true, force: true }));
    assert.notEqual(projectRootFrom(bare, {}), canonicalDir(homedir()));
  });
});
