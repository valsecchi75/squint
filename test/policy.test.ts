/**
 * The narrowing policy. Pure functions only: nothing here touches the disk,
 * the network or the clock, and the last test asserts that property against the
 * module's own source - the same guard pre-gate.test.ts uses, for the same reason.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildChunks,
  buildQuestions,
  confidenceAccepted,
  LOCATE_INSTRUCTIONS,
  narrowingNote,
  preflight,
  windowFor,
  type PreflightInput,
} from '../src/policy.js';
import type { NarrowConfig } from '../src/types.js';

const CONFIG: NarrowConfig = {
  enabled: true,
  minLines: 400,
  maxBytes: 80000,
  minConfidence: 0.6,
  windowDivisor: 5,
  minWindow: 150,
  maxChunks: 200,
  chunkLines: 10,
  minGoalChars: 12,
  timeoutMs: 6000,
  maxCallsPerSession: 50,
};

const OK: PreflightInput = {
  toolName: 'Read',
  hasExplicitWindow: false,
  path: 'src/report.ts',
  totalLines: 1307,
  totalBytes: 57433,
  goal: 'dove si calcola un percentile senza interpolare',
  excluded: false,
};

describe('preflight — the refusal ladder', () => {
  it('asks when every gate is clear', () => {
    assert.deepEqual(preflight(OK, CONFIG), { action: 'ask' });
  });

  it('does nothing when the feature is off', () => {
    const r = preflight(OK, { ...CONFIG, enabled: false });
    assert.equal(r.action, 'pass');
    assert.equal(r.action === 'pass' && r.reason, 'disabled');
  });

  it('ignores a tool that is not Read', () => {
    const r = preflight({ ...OK, toolName: 'Bash' }, CONFIG);
    assert.equal(r.action === 'pass' && r.reason, 'not-a-read');
  });

  it('never second-guesses a window the agent chose itself', () => {
    const r = preflight({ ...OK, hasExplicitWindow: true }, CONFIG);
    assert.equal(r.action === 'pass' && r.reason, 'agent-set-window');
  });

  it('refuses an excluded path BEFORE any size consideration (ERR-001)', () => {
    // Small enough to be refused for its size too: the point is which reason wins.
    const r = preflight({ ...OK, excluded: true, totalLines: 10 }, CONFIG);
    assert.equal(r.action === 'pass' && r.reason, 'excluded-path');
  });

  it('leaves a small file alone', () => {
    const r = preflight({ ...OK, totalLines: 399 }, CONFIG);
    assert.equal(r.action === 'pass' && r.reason, 'file-too-small');
  });

  it('takes a file exactly at the floor', () => {
    assert.equal(preflight({ ...OK, totalLines: 400 }, CONFIG).action, 'ask');
  });

  it('refuses a file that would need sectioning, rather than narrowing it', () => {
    const r = preflight({ ...OK, totalBytes: 80001 }, CONFIG);
    assert.equal(r.action === 'pass' && r.reason, 'file-too-large');
  });

  it('does nothing without a goal to narrow towards', () => {
    const r = preflight({ ...OK, goal: '   short   ' }, CONFIG);
    assert.equal(r.action === 'pass' && r.reason, 'no-goal');
  });
});

describe('buildChunks — keyed options, never positional (DEC-029)', () => {
  it('uses chunkLines while the count stays under the ceiling', () => {
    const { chunks, criteria } = buildChunks(new Array(100).fill('x'), CONFIG);
    assert.equal(Object.keys(chunks).length, 10);
    assert.equal(chunks['c0']?.startLine, 1);
    assert.equal(chunks['c1']?.startLine, 11);
    assert.equal(criteria['c0'], 'lines 1-10');
    assert.equal(criteria['c9'], 'lines 91-100');
  });

  it('grows the chunk instead of the count past maxChunks', () => {
    const { chunks } = buildChunks(new Array(4000).fill('x'), CONFIG);
    assert.ok(Object.keys(chunks).length <= CONFIG.maxChunks, 'never more chunks than the ceiling');
    // 4000/200 = 20 lines per chunk, so the second chunk starts at 21.
    assert.equal(chunks['c1']?.startLine, 21);
  });

  it('keeps every option under the API ceiling of 255 even on a huge file', () => {
    const { criteria } = buildChunks(new Array(100000).fill('x'), CONFIG);
    assert.ok(Object.keys(criteria).length <= 255);
  });

  it('every chunk id is a key with a descriptive label, never an index', () => {
    const { criteria } = buildChunks(new Array(50).fill('x'), CONFIG);
    for (const [id, label] of Object.entries(criteria)) {
      assert.match(id, /^c\d+$/);
      assert.match(label, /^lines \d+-\d+$/);
    }
  });

  it('the last chunk stops at the last line, never past it', () => {
    const { chunks, criteria } = buildChunks(new Array(95).fill('x'), CONFIG);
    const ids = Object.keys(chunks);
    const last = ids[ids.length - 1] as string;
    assert.equal(criteria[last], 'lines 91-95');
  });
});

describe('buildQuestions', () => {
  it('asks exactly two questions in one request (ERR-009)', () => {
    const q = buildQuestions({ c0: 'lines 1-10', c1: 'lines 11-20' });
    assert.equal(Object.keys(q).length, 2);
    assert.equal(q.where.type, 'choice');
    assert.equal(q.exists.type, 'noul');
    assert.equal(q.where.instructions, LOCATE_INSTRUCTIONS);
  });
});

describe('windowFor — a fifth of the file, floored at minWindow', () => {
  it('centres the window on the pick', () => {
    const w = windowFor(650, 1300, CONFIG);
    assert.deepEqual(w, { offset: 650 - 130, limit: 260 });
  });

  it('clamps at the start instead of going below line 1', () => {
    const w = windowFor(10, 1300, CONFIG);
    assert.equal(w?.offset, 1);
    assert.equal(w?.limit, 260);
  });

  it('clamps at the end instead of running past the last line', () => {
    const w = windowFor(1295, 1300, CONFIG);
    assert.equal((w as { offset: number }).offset + (w as { limit: number }).limit, 1300);
  });

  it('honours the floor on a file whose fifth would be tiny', () => {
    const w = windowFor(200, 400, CONFIG);
    assert.equal(w?.limit, 150, 'a fifth of 400 is 80, so the 150 floor wins');
  });

  it('refuses when the window would cover the whole file', () => {
    assert.equal(windowFor(50, 140, CONFIG), null);
  });

  it('always saves something when it returns a window', () => {
    for (const total of [400, 700, 1307, 5000]) {
      const w = windowFor(Math.floor(total / 2), total, CONFIG);
      assert.ok(w !== null && w.limit < total, `a window on ${total} lines must be smaller than the file`);
    }
  });
});

describe('confidenceAccepted — the gate that decides whether to hide the rest', () => {
  it('accepts at the floor and rejects just under it', () => {
    assert.equal(confidenceAccepted(0.6, CONFIG), true);
    assert.equal(confidenceAccepted(0.59, CONFIG), false);
  });

  it('would have accepted the 0.63 pick that missed by 133 lines', () => {
    // Not an aspiration: the measurement of 2026-09-20. The test exists so that when
    // the floor is recalibrated, whoever moves it sees this case go from true to false
    // instead of discovering the trade-off afterwards.
    assert.equal(confidenceAccepted(0.63, CONFIG), true);
    assert.equal(confidenceAccepted(0.63, { ...CONFIG, minConfidence: 0.7 }), false);
  });
});

describe('narrowingNote', () => {
  it('says what was hidden, how to undo it, and that the file is intact', () => {
    const note = narrowingNote('report.ts', 1307, { offset: 251, limit: 261 }, 381, 0.82);
    assert.match(note, /report\.ts is 1307 lines/);
    assert.match(note, /showing 251-511/);
    assert.match(note, /confidence 0\.82/);
    assert.match(note, /explicit offset or limit/);
    assert.match(note, /nothing was removed from the file/);
  });

  it('carries no curly brace, which would cut `--json` output in half', () => {
    const note = narrowingNote('a.ts', 500, { offset: 1, limit: 150 }, 20, 0.9);
    assert.ok(!note.includes('{') && !note.includes('}'));
  });
});

describe('il timeout del restringimento e separato da quello di analyze', () => {
  it('non riusa typesafe.timeoutMs: e una richiesta di taglia diversa', () => {
    // `[FACT ACTUAL 2026-09-20]` Su 9 letture idonee, 7 hanno risposto in 1.142-2.920 ms
    // e 2 sono state CENSURATE a 3.006 e 3.003 ms, cioe' esattamente il timeout di
    // `analyze`. Una riuscita e' arrivata 80 ms prima di fallire. Il test fissa il
    // fatto che i due valori sono distinti, cosi' un refactor non puo' riunificarli
    // in silenzio e rimettere a buttare via un quarto dei restringimenti.
    assert.equal(CONFIG.timeoutMs, 6000);
    assert.ok(CONFIG.timeoutMs > 3000, 'deve superare il timeout di analyze, che censurava le chiamate');
    assert.ok(CONFIG.timeoutMs >= 2 * 2920, 'almeno il doppio della latenza massima osservata con successo');
  });
});

describe('the module stays pure', () => {
  it('imports no I/O: a policy that reads a file has already spent something', () => {
    // This file runs COMPILED from .jef/dist/test/, so `../..` is .jef/ - the same
    // walk pre-gate.test.ts does to reach the TypeScript source it guards.
    const jefRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const src = readFileSync(join(jefRoot, 'src', 'policy.ts'), 'utf8');
    const imports = src.match(/^import .*$/gm) ?? [];
    for (const line of imports) {
      assert.ok(
        line.includes("from './types.js'"),
        `policy.ts must import types only, found: ${line}`,
      );
    }
    for (const forbidden of ['node:fs', 'node:child_process', 'node:https', 'jev.js']) {
      assert.ok(!src.includes(forbidden), `policy.ts must not reference ${forbidden}`);
    }
  });
});
