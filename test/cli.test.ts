/**
 * The command surface: doctor, report, on/off, and the key prompt.
 *
 * The report is where a tool of this kind most easily starts lying, so most of these
 * tests are about what it must NOT say.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  doctorChecks,
  keyCommandFor,
  readLedger,
  renderDoctor,
  renderReport,
  run,
  setEnabled,
  summarise,
} from '../src/cli.js';
import type { NarrowRecord } from '../src/types.js';

const rec = (over: Partial<NarrowRecord> = {}): NarrowRecord => ({
  timestamp: '2026-09-20T10:00:00.000Z',
  sessionId: 's1',
  path: 'src/big.ts',
  totalLines: 1000,
  narrowed: false,
  ...over,
});

const deps = (over: Partial<Parameters<typeof run>[1]> = {}): Parameters<typeof run>[1] => ({
  env: {},
  platform: 'win32',
  cwd: 'C:/nowhere',
  installRoot: 'C:/tools/squint',
  ...over,
});

describe('summarise — the refusals are the denominator', () => {
  it('counts what was looked at, not only what was narrowed', () => {
    const s = summarise(
      [
        rec({ narrowed: true, linesAvoided: 800, confidence: 0.9, inputTokens: 100 }),
        rec({ reason: 'file-too-small', inputTokens: 0 }),
        rec({ reason: 'low-confidence', confidence: 0.4, inputTokens: 200 }),
        rec({ reason: 'file-too-small' }),
      ],
      1,
    );
    assert.equal(s.looked, 4);
    assert.equal(s.narrowed, 1);
    assert.equal(s.reasons['file-too-small'], 2);
    assert.equal(s.reasons['low-confidence'], 1);
  });

  it('counts the tokens a refusal cost, because a refusal is not free', () => {
    // A low-confidence pass-through happens AFTER the call. Hiding its cost would
    // make the hook look cheaper than it is.
    const s = summarise([rec({ reason: 'low-confidence', inputTokens: 21944 })], 1);
    assert.equal(s.narrowed, 0);
    assert.equal(s.inputTokens, 21944);
  });

  it('only collects the confidence of windows that were actually used', () => {
    const s = summarise([rec({ narrowed: true, confidence: 0.9 }), rec({ reason: 'low-confidence', confidence: 0.3 })], 1);
    assert.deepEqual(s.confidences, [0.9]);
  });
});

describe('renderReport — what it must not say', () => {
  it('never prints a token or money saving derived from lines', () => {
    const text = renderReport(summarise([rec({ narrowed: true, linesAvoided: 900, inputTokens: 20000 })], 1), 'C:/p');
    assert.match(text, /lines not read\s+900/);
    assert.match(text, /never converted to tokens/);
    assert.ok(!/saved.*\$/i.test(text), 'a money saving would be a guess wearing a measurement costume');
    assert.ok(!/tokens saved/i.test(text));
  });

  it('prints the hit rate with its denominator, never alone', () => {
    const text = renderReport(summarise([rec({ narrowed: true }), rec({ reason: 'file-too-small' }), rec({ reason: 'file-too-small' })], 1), 'C:/p');
    assert.match(text, /reads looked at\s+3/);
    assert.match(text, /of those, narrowed\s+1\s+\(33%\)/);
  });

  it('says so plainly when there is nothing yet', () => {
    const text = renderReport(summarise([], 0), 'C:/p');
    assert.match(text, /No reads recorded yet/);
  });

  it('calls the refusals the denominator rather than failures', () => {
    const text = renderReport(summarise([rec({ reason: 'low-confidence' })], 1), 'C:/p');
    assert.match(text, /denominator, not failures/);
  });
});

describe('doctor', () => {
  it('reports the key as missing without ever printing it', () => {
    const checks = doctorChecks({}, 'win32', 'C:/tools/squint', 'C:/x/settings.json');
    const key = checks.find((c) => c.name === 'TYPESAFE_API_KEY');
    assert.equal(key?.ok, false);
    assert.match(key?.fix ?? '', /setx TYPESAFE_API_KEY/);
  });

  it('never echoes the key when it IS set, not even a prefix', () => {
    const secret = 'sk-abcdef0123456789abcdef';
    const checks = doctorChecks({ TYPESAFE_API_KEY: secret }, 'linux', 'C:/tools/squint', 'C:/x/settings.json');
    const text = renderDoctor(checks);
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes(secret.slice(0, 6)), 'a prefix is still a leak in a log');
    assert.match(text, /present in the environment/);
  });

  it('gives the right instruction per platform', () => {
    assert.match(keyCommandFor('win32'), /setx/);
    assert.match(keyCommandFor('darwin'), /export/);
  });

  it('exits non-zero while something is still missing', async () => {
    const r = await run(['doctor'], deps());
    assert.equal(r.code, 1);
    assert.match(r.text, /thing\(s\) to fix/);
  });
});

describe('on / off', () => {
  it('writes the flag without destroying the rest of the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squint-flag-'));
    try {
      writeFileSync(join(dir, '.squint.json'), JSON.stringify({ narrow: { minLines: 900 }, jev: { model: 'x' } }), 'utf8');
      setEnabled(dir, false);
      const back = JSON.parse(readFileSync(join(dir, '.squint.json'), 'utf8')) as {
        narrow: { enabled: boolean; minLines: number };
        jev: { model: string };
      };
      assert.equal(back.narrow.enabled, false);
      assert.equal(back.narrow.minLines, 900, 'the other settings must survive the switch');
      assert.equal(back.jev.model, 'x');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the file when there is none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squint-flag2-'));
    try {
      assert.equal(setEnabled(dir, true).written, true);
      assert.match(readFileSync(join(dir, '.squint.json'), 'utf8'), /"enabled": true/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a file it cannot parse alone, and says so, instead of replacing it', async () => {
    // The old code parsed, failed, started from `{}` and wrote that over the user's
    // file - the installer's own rule ("what was not read is not overwritten") applied
    // to the settings file and not to the config file.
    const dir = mkdtempSync(join(tmpdir(), 'squint-flag3-'));
    try {
      const broken = '{ "narrow": { "minLines": 900, }\n'; // trailing comma: the typo people make
      writeFileSync(join(dir, '.squint.json'), broken, 'utf8');
      assert.equal(setEnabled(dir, false).written, false);
      assert.equal(readFileSync(join(dir, '.squint.json'), 'utf8'), broken, 'the bytes must be untouched');
      const r = await run(['off'], deps({ cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } }));
      assert.equal(r.code, 1);
      assert.match(r.text, /corrupt/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readLedger', () => {
  it('reads every session file and survives a corrupt line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squint-led-'));
    try {
      mkdirSync(join(dir, '.squint'));
      writeFileSync(join(dir, '.squint', 'session-a.jsonl'), JSON.stringify(rec({ narrowed: true, linesAvoided: 500 })) + '\nnot json\n', 'utf8');
      writeFileSync(join(dir, '.squint', 'session-b.jsonl'), JSON.stringify(rec({ reason: 'file-too-small' })) + '\n', 'utf8');
      const s = readLedger(dir);
      assert.equal(s.sessions, 2);
      assert.equal(s.looked, 2, 'the unparseable line is dropped, not counted');
      assert.equal(s.linesAvoided, 500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is empty, not an error, before anything has happened', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squint-led2-'));
    try {
      assert.equal(readLedger(dir).looked, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('run — dispatch', () => {
  it('prints usage for no command, and exits 0', async () => {
    const r = await run([], deps());
    assert.equal(r.code, 0);
    assert.match(r.text, /squint doctor/);
    assert.match(r.text, /squint report/);
  });

  it('exits 1 on an unknown command', async () => {
    assert.equal((await run(['nonsense'], deps())).code, 1);
  });

  it('key writes nothing when nothing is typed', async () => {
    const r = await run(['key'], deps({ prompt: async () => '' }));
    assert.equal(r.code, 1);
    assert.match(r.text, /Nothing entered, nothing written/);
  });

  it('key treats a whitespace answer as nothing, and writes nothing', async () => {
    // This test found a real defect: the check was `=== ''`, so two spaces got
    // through and setx wrote a whitespace key into the user environment. A key like
    // that looks present to the doctor and then fails every call.
    for (const answer of ['  ', '\t', '\n  \n', '\r\n']) {
      const r = await run(['key'], deps({ prompt: async () => answer }));
      assert.equal(r.code, 1, `answer ${JSON.stringify(answer)} must write nothing`);
      assert.match(r.text, /Nothing entered, nothing written/);
    }
  });

  it('warns on install when the key is missing, because the hook would be inert', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'squint-inst-'));
    try {
      const r = await run(['install', '--project', dir], deps({ env: {} }));
      assert.match(r.text, /TYPESAFE_API_KEY is not set/);
      assert.match(r.text, /pass through untouched/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not warn when the key is there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'squint-inst2-'));
    try {
      const r = await run(['install', '--project', dir], deps({ env: { TYPESAFE_API_KEY: 'k' } }));
      assert.ok(!r.text.includes('is not set'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
