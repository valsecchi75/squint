/**
 * The goal, and how stale it is.
 *
 * `lastUserMessage` had NO tests before this file, which is uncomfortable given that
 * every narrowing in the package is aimed at whatever it returns. It is also where the
 * one measured defect lives: a goal many turns old produces a confident, precise,
 * wrong window (docs/evidence.md section 6). `ageTurns` is the instrument for that, so
 * it gets tested before anybody is asked to trust a number derived from it.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { lastUserMessage } from '../src/hook.js';

const dir = mkdtempSync(join(tmpdir(), 'squint-goal-'));
after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
/** Writes a transcript from a list of entries and returns its path. */
const transcript = (entries: unknown[]): string => {
  const p = join(dir, `t${n++}.jsonl`);
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return p;
};
const user = (text: string): unknown => ({ type: 'user', message: { content: text } });
const userBlocks = (...blocks: unknown[]): unknown => ({ type: 'user', message: { content: blocks } });
const assistant = (): unknown => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] } });

describe('lastUserMessage — the text', () => {
  it('takes the last thing the user typed, not the first', () => {
    const g = lastUserMessage(transcript([user('find the parser'), assistant(), user('now the formatter')]));
    assert.equal(g.text, 'now the formatter');
  });

  it('ignores a tool_result, which is not the user speaking', () => {
    const g = lastUserMessage(transcript([
      user('find the parser'),
      assistant(),
      userBlocks({ type: 'tool_result', content: 'file contents here' }),
    ]));
    assert.equal(g.text, 'find the parser');
  });

  it('joins the text blocks of a structured user message', () => {
    const g = lastUserMessage(transcript([
      userBlocks({ type: 'text', text: 'find' }, { type: 'tool_result', content: 'noise' }, { type: 'text', text: 'the parser' }),
    ]));
    assert.equal(g.text, 'find the parser');
  });

  it('cuts at a system reminder, which is noise wrapped around the request', () => {
    const g = lastUserMessage(transcript([user('find the parser<system-reminder>be nice</system-reminder>')]));
    assert.equal(g.text, 'find the parser');
  });

  it('truncates to the cap', () => {
    const g = lastUserMessage(transcript([user('x'.repeat(900))]), 600);
    assert.equal(g.text.length, 600);
  });

  it('returns an empty goal for a missing transcript, and an empty goal means pass through', () => {
    const g = lastUserMessage(join(dir, 'does-not-exist.jsonl'));
    assert.deepEqual(g, { text: '', ageTurns: 0, source: 'user' });
  });

  it('survives a corrupt line instead of throwing', () => {
    const p = join(dir, 'corrupt.jsonl');
    writeFileSync(p, '{not json\n' + JSON.stringify(user('find the parser')) + '\n', 'utf8');
    assert.equal(lastUserMessage(p).text, 'find the parser');
  });
});

describe('lastUserMessage — how stale the goal is', () => {
  it('is 0 when the user has just spoken', () => {
    assert.equal(lastUserMessage(transcript([user('find the parser')])).ageTurns, 0);
  });

  it('counts the assistant turns since the user spoke', () => {
    const g = lastUserMessage(transcript([user('find the parser'), assistant(), assistant(), assistant()]));
    assert.equal(g.ageTurns, 3);
  });

  it('resets when the user speaks again: a fresh instruction is a fresh goal', () => {
    const g = lastUserMessage(transcript([
      user('find the parser'), assistant(), assistant(), assistant(), assistant(),
      user('now the formatter'), assistant(),
    ]));
    assert.equal(g.text, 'now the formatter');
    assert.equal(g.ageTurns, 1);
  });

  it('is not reset by a tool_result, because a tool result is not a new instruction', () => {
    const g = lastUserMessage(transcript([
      user('find the parser'),
      assistant(),
      userBlocks({ type: 'tool_result', content: 'contents' }),
      assistant(),
    ]));
    assert.equal(g.text, 'find the parser');
    assert.equal(g.ageTurns, 2, 'the tool_result must not restart the count');
  });

  it('counts an assistant turn that only thought, because it still happened', () => {
    const thinkingOnly = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '...' }] } };
    const g = lastUserMessage(transcript([user('find the parser'), thinkingOnly, thinkingOnly]));
    assert.equal(g.ageTurns, 2);
  });

  it('the long-session shape: one instruction, then twenty turns of work', () => {
    const g = lastUserMessage(transcript([user('find the parser'), ...Array.from({ length: 20 }, assistant)]));
    assert.equal(g.ageTurns, 20);
    // Nothing branches on this yet. The test pins the measurement, not a policy.
    assert.equal(g.text, 'find the parser');
  });
});

describe('lastUserMessage — who wrote the goal', () => {
  // `[ACTUAL 2026-09-21]` Every shape below was seen in a real transcript on the
  // development machine. Each is labelled, never dropped: the ledger gets the
  // distribution first, and only a distribution can justify a rule.
  const meta = (text: string): unknown => ({ type: 'user', isMeta: true, message: { content: text } });

  it('is `user` for a message the person typed', () => {
    assert.equal(lastUserMessage(transcript([user('find the parser')])).source, 'user');
  });

  it('is `system` for a skill body injected with isMeta', () => {
    const g = lastUserMessage(transcript([user('find the parser'), meta('Base directory for this skill: C:/x\n\n# Debug Skill\n...')]));
    assert.equal(g.source, 'system');
    assert.match(g.text, /^Base directory/, 'the text is still taken - this is a label, not a filter');
  });

  it('is `system` for a compaction summary', () => {
    const summary = { type: 'user', isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { content: 'This session is being continued from a previous conversation that ran out of context. Summary: ...' } };
    assert.equal(lastUserMessage(transcript([user('find the parser'), assistant(), summary])).source, 'system');
  });

  it('is `system` for a task notification, which carries no flag at all', () => {
    const g = lastUserMessage(transcript([user('find the parser'), userBlocks({ type: 'text', text: '<task-notification>agent done</task-notification>' })]));
    assert.equal(g.source, 'system');
  });

  it('goes back to `user` as soon as the person speaks again', () => {
    const g = lastUserMessage(transcript([meta('Base directory for this skill: C:/x'), assistant(), user('now the formatter')]));
    assert.equal(g.source, 'user');
    assert.equal(g.text, 'now the formatter');
  });

  it('a tool_result does not change the source, because it did not supply the text', () => {
    const g = lastUserMessage(transcript([meta('Base directory for this skill: C:/x'), assistant(), userBlocks({ type: 'tool_result', content: 'x' })]));
    assert.equal(g.source, 'system');
  });
});
