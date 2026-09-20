/**
 * The installer, and the two defects a fresh-install rehearsal found.
 *
 * Both were discovered by running the README's own commands against a clean clone
 * from GitHub, which is the only way to find them: every earlier test ran inside a
 * working tree that already had a `.claude/` and a project to install into.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { cli, installInto, MARKER, merge, remove, targetOf, uninstallFrom } from '../src/install.js';

const ROOT = 'C:/tools/squint';

describe('targetOf — where the entry goes', () => {
  it('defaults to the USER settings, not the current directory', () => {
    // The default used to be `cwd`, which meant the README's own commands installed
    // the hook into the clone of this repository - where it can never fire, because
    // Claude Code reads the settings of the project you are working in.
    assert.equal(targetOf(['install'], 'C:/anywhere'), join(homedir(), '.claude', 'settings.json'));
  });

  it('takes one project when asked', () => {
    assert.match(targetOf(['install', '--project', 'myproj'], 'C:/work'), /myproj[\\/]\.claude[\\/]settings\.json$/);
  });

  it('takes an exact file when asked', () => {
    assert.match(targetOf(['install', '--settings', 'other.json'], 'C:/work'), /other\.json$/);
  });

  it('prefers --settings over --project when both are given', () => {
    assert.match(targetOf(['install', '--project', 'p', '--settings', 'exact.json'], 'C:/work'), /exact\.json$/);
  });
});

describe('installInto — a project that was never configured', () => {
  it('creates .claude/ instead of throwing ENOENT', () => {
    // The fresh-install case, verbatim: the directory does not exist yet.
    const dir = mkdtempSync(join(tmpdir(), 'squint-fresh-'));
    try {
      const path = join(dir, '.claude', 'settings.json');
      assert.equal(existsSync(join(dir, '.claude')), false, 'the fixture must start without .claude/');
      assert.equal(installInto(path, ROOT), 'installed');
      const written = JSON.parse(readFileSync(path, 'utf8')) as { hooks: Record<string, unknown[]> };
      assert.equal(written.hooks['PreToolUse']?.length, 1);
      assert.ok(JSON.stringify(written).includes(MARKER));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('round-trips: install then uninstall leaves the file as it was', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squint-round-'));
    try {
      mkdirSync(join(dir, '.claude'));
      const path = join(dir, '.claude', 'settings.json');
      writeFileSync(path, '{\n  "permissions": {\n    "allow": [\n      "Bash(ls)"\n    ]\n  }\n}\n', 'utf8');
      const before = readFileSync(path, 'utf8');

      assert.equal(installInto(path, ROOT), 'installed');
      assert.ok(readFileSync(path, 'utf8').includes(MARKER));

      assert.equal(uninstallFrom(path), 'uninstalled');
      assert.equal(readFileSync(path, 'utf8'), before, 'the file must come back exactly as it was');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is idempotent: installing twice changes nothing the second time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squint-twice-'));
    try {
      const path = join(dir, '.claude', 'settings.json');
      assert.equal(installInto(path, ROOT), 'installed');
      const after = readFileSync(path, 'utf8');
      assert.equal(installInto(path, ROOT), 'unchanged');
      assert.equal(readFileSync(path, 'utf8'), after);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('merge and remove keep what is not ours', () => {
  it('appends to an existing PreToolUse array instead of replacing it', () => {
    const existing = {
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command' as const, command: 'guard.sh' }] }] },
      permissions: { allow: ['Bash(ls)'] },
    };
    const next = merge(existing, ROOT);
    assert.equal(next.hooks?.['PreToolUse']?.length, 2);
    assert.equal(next.hooks?.['PreToolUse']?.[0]?.matcher, 'Bash', 'the neighbour must survive');
    assert.deepEqual(next['permissions'], existing.permissions);
  });

  it('removing ours leaves the neighbour and the other keys alone', () => {
    const withBoth = merge(
      {
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command' as const, command: 'guard.sh' }] }] },
        env: { A: '1' },
      },
      ROOT,
    );
    const back = remove(withBoth);
    assert.equal(back.hooks?.['PreToolUse']?.length, 1);
    assert.equal(back.hooks?.['PreToolUse']?.[0]?.matcher, 'Bash');
    assert.deepEqual(back['env'], { A: '1' });
  });

  it('drops the hooks map entirely when ours was the only thing in it', () => {
    assert.equal(remove(merge({}, ROOT)).hooks, undefined, 'an empty hooks map is a fingerprint we left');
  });

  it('a settings file it cannot parse is left alone, never overwritten', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squint-bad-'));
    try {
      mkdirSync(join(dir, '.claude'));
      const path = join(dir, '.claude', 'settings.json');
      writeFileSync(path, '{ this is not json', 'utf8');
      assert.equal(installInto(path, ROOT), 'corrupt');
      assert.equal(readFileSync(path, 'utf8'), '{ this is not json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cli', () => {
  it('prints usage and exits 0 when called with no command', () => {
    const r = cli([], 'C:/work', ROOT);
    assert.equal(r.code, 0);
    assert.match(r.text, /squint installer/);
    assert.match(r.text, /--project/, 'usage must name the flag that installs into one project');
  });

  it('says where it wrote, so nobody has to guess', () => {
    const dir = mkdtempSync(join(tmpdir(), 'squint-cli-'));
    try {
      const r = cli(['install', '--project', dir], 'C:/work', ROOT);
      assert.equal(r.code, 0);
      assert.match(r.text, /squint · install · installed/);
      assert.ok(r.text.includes(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
