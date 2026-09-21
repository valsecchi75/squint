/**
 * The textual graft, judged by one thing: the bytes of `settings.json` before the
 * install and after the uninstall - and, harder, the bytes of every line the install
 * did not add.
 *
 * The fixtures in install.test.ts are all produced by `serialize`, so they are already
 * in the one shape `JSON.stringify` emits, and a writer that reserializes the whole
 * file passes them by construction. People do not write JSON that way - they keep short
 * arrays and leaf objects on one line - so every fixture here is hand-written, with
 * inline containers, an arbitrary key order and somebody else's hook already in place.
 *
 * Ported with the code from the JEF installer, where these were written first.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { buildCommand, installInto, MARKER, uninstallFrom } from '../src/install.js';

const ROOT = 'C:/tools/squint';
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'squint-graft-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** hash -> install -> hash -> uninstall -> hash, on a file written exactly as given. */
function roundTrip(raw: string): { before: string; installed: string; after: string } {
  return withTempDir((dir) => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, raw, 'utf8');
    const before = readFileSync(file, 'utf8');
    assert.equal(installInto(file, ROOT), 'installed');
    const installed = readFileSync(file, 'utf8');
    assert.equal(uninstallFrom(file), 'uninstalled');
    return { before, installed, after: readFileSync(file, 'utf8') };
  });
}

/** Inline arrays, inline leaf objects, arbitrary key order, another hook already registered. */
function handWritten(eol: '\n' | '\r\n' = '\r\n', indent = '    ', trailingNewline = true): string {
  const i1 = indent;
  const i2 = indent + indent;
  const i3 = indent + indent + indent;
  const lines = [
    '{',
    `${i1}"$schema": "https://json.schemastore.org/claude-code-settings.json",`,
    `${i1}"permissions": {`,
    `${i2}"allow": ["WebSearch", "Bash(npm test)"],`,
    `${i2}"deny": ["Read(./Secrets/**)"]`,
    `${i1}},`,
    `${i1}"hooks": {`,
    `${i2}"PreToolUse": [`,
    `${i3}{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "node \\"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.js\\"" }] }`,
    `${i2}]`,
    `${i1}},`,
    `${i1}"env": { "EDITOR": "code --wait" },`,
    `${i1}"statusLine": { "type": "command", "command": "echo hi" }`,
    '}',
  ];
  return lines.join(eol) + (trailingNewline ? eol : '');
}

describe('the graft: a hand-written settings.json survives byte for byte', () => {
  it('round trip on a hand-written file with inline arrays and objects', () => {
    const raw = handWritten();
    const { before, installed, after } = roundTrip(raw);
    assert.ok(installed.includes(MARKER));
    // The user's own lines must survive the INSTALL verbatim, not just the uninstall.
    assert.ok(installed.includes('"allow": ["WebSearch", "Bash(npm test)"]'), 'inline array was expanded');
    assert.ok(installed.includes('"statusLine": { "type": "command", "command": "echo hi" }'), 'inline object was expanded');
    assert.equal(sha(after), sha(before));
    assert.equal(after, before);
  });

  it('holds for two spaces, four spaces and a tab, LF and CRLF, with and without a final newline', () => {
    for (const indent of ['  ', '    ', '\t']) {
      for (const eol of ['\n', '\r\n'] as const) {
        for (const trailingNewline of [true, false]) {
          const label = `indent ${JSON.stringify(indent)} eol ${JSON.stringify(eol)} nl ${trailingNewline}`;
          const { before, installed, after } = roundTrip(handWritten(eol, indent, trailingNewline));
          assert.ok(installed.includes(MARKER), label);
          assert.ok(installed.includes(`${indent}${indent}"deny": ["Read(./Secrets/**)"]`), `expanded: ${label}`);
          assert.equal(installed.endsWith('\n'), trailingNewline, `final newline changed: ${label}`);
          if (eol === '\r\n') assert.ok(!/[^\r]\n/.test(installed), `a lone LF survived in a CRLF file: ${label}`);
          assert.equal(sha(after), sha(before), label);
        }
      }
    }
  });

  it('splices the entry in without disturbing any line before it', () => {
    withTempDir((dir) => {
      const file = join(dir, 'settings.json');
      const raw = handWritten();
      writeFileSync(file, raw, 'utf8');
      assert.equal(installInto(file, ROOT), 'installed');
      const installed = readFileSync(file, 'utf8');
      for (const line of raw.split('\r\n')) {
        if (line.endsWith('}] }')) continue; // the neighbour's entry gains the comma that joins ours
        assert.ok(installed.includes(line), `line lost or reformatted: ${JSON.stringify(line)}`);
      }
      const parsed = JSON.parse(installed) as { hooks: { PreToolUse: { matcher: string }[] } };
      assert.equal(parsed.hooks.PreToolUse.length, 2);
      assert.equal(parsed.hooks.PreToolUse[1]?.matcher, 'Read');
    });
  });

  it('a file with no hooks key at all: install grafts one, uninstall takes it back out', () => {
    const raw = ['{', '\t"env": { "EDITOR": "code --wait" },', '\t"permissions": { "allow": ["WebSearch"] }', '}', ''].join('\r\n');
    const { before, installed, after } = roundTrip(raw);
    assert.ok(installed.includes('"permissions": { "allow": ["WebSearch"] }'), 'inline object was expanded');
    assert.equal(sha(after), sha(before));
    assert.ok(!after.includes('hooks'), `hooks residue: ${JSON.stringify(after)}`);
  });

  it('a file with hooks but no PreToolUse keeps its other events untouched', () => {
    const raw = [
      '{',
      '  "hooks": {',
      '    "PostToolUse": [{ "matcher": "Edit", "hooks": [{ "type": "command", "command": "node \\"fmt.js\\"" }] }]',
      '  }',
      '}',
      '',
    ].join('\n');
    const { before, installed, after } = roundTrip(raw);
    assert.ok(installed.includes('"PostToolUse": [{ "matcher": "Edit"'), 'the other event was expanded');
    assert.equal(sha(after), sha(before));
  });

  it('an inline PreToolUse array gets an inline entry, and loses it again', () => {
    const raw = '{\n  "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [] }] }\n}\n';
    const { before, installed, after } = roundTrip(raw);
    assert.equal(installed.split('\n').length, before.split('\n').length, `install added lines:\n${installed}`);
    assert.equal(sha(after), sha(before));
  });

  it('an empty file `{}` round-trips', () => {
    const { before, installed, after } = roundTrip('{}\n');
    assert.ok(installed.includes(MARKER));
    assert.equal(after, before);
  });

  it('our command sharing a group inside a hand-written file loses only itself', () => {
    withTempDir((dir) => {
      const file = join(dir, 'settings.json');
      // The realistic way this happens: someone hand-merged our command into their own group.
      const ours = `{ "type": "command", "command": ${JSON.stringify(buildCommand(ROOT))} }`;
      const group = (middle: string): string =>
        [
          '{',
          '  "hooks": { "PreToolUse": [',
          `    { "matcher": "Read", "hooks": [{ "type": "command", "command": "node \\"before.js\\"" }${middle}, { "type": "command", "command": "node \\"after.js\\"" }] }`,
          '  ] }',
          '}',
          '',
        ].join('\r\n');
      writeFileSync(file, group(`, ${ours}`), 'utf8');
      assert.equal(uninstallFrom(file), 'uninstalled');
      assert.equal(readFileSync(file, 'utf8'), group(''), 'only our command and the comma that joined it may go');
    });
  });

  it('a second install is `unchanged` and leaves the bytes alone', () => {
    withTempDir((dir) => {
      const file = join(dir, 'settings.json');
      writeFileSync(file, handWritten(), 'utf8');
      assert.equal(installInto(file, ROOT), 'installed');
      const once = readFileSync(file, 'utf8');
      assert.equal(installInto(file, ROOT), 'unchanged');
      assert.equal(readFileSync(file, 'utf8'), once);
      assert.equal(once.split(MARKER).length - 1, 1, 'a second install must not duplicate the entry');
    });
  });
});

describe('the graft is never trusted: the fallback still exists and still speaks', () => {
  it('a file the scanner cannot model is reformatted OUT LOUD, never quietly', () => {
    withTempDir((dir) => {
      const file = join(dir, 'settings.json');
      // Duplicate keys: JSON.parse keeps the last, a textual scan finds the first. The
      // verification catches the disagreement and the installer says `reformatted`.
      const raw = '{\n  "hooks": { "PostToolUse": [] },\n  "hooks": { "Stop": [] }\n}\n';
      writeFileSync(file, raw, 'utf8');
      assert.equal(installInto(file, ROOT), 'installed-reformatted');
      const written = readFileSync(file, 'utf8');
      assert.ok(written.includes(MARKER));
      assert.deepEqual(Object.keys((JSON.parse(written) as { hooks: object }).hooks), ['Stop', 'PreToolUse']);
    });
  });

  it('a path that is a directory is `corrupt`, not a file to be created over', () => {
    withTempDir((dir) => {
      // The old loader treated EVERY read failure as "missing" and went on to write.
      const file = join(dir, 'settings.json');
      mkdirSync(file);
      assert.equal(installInto(file, ROOT), 'corrupt');
      assert.equal(uninstallFrom(file), 'corrupt');
    });
  });
});
