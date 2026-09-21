/**
 * The hook: `PreToolUse` with matcher `Read`.
 *
 * It answers with `hookSpecificOutput.updatedInput`, rewriting the tool's own `offset`
 * and `limit` so a large file comes back as the fifth of it that answers the question.
 * That field is what makes this work without the model's cooperation: a suggestion in
 * the prompt is ignorable by construction, a rewritten `limit` is not.
 *
 * FAIL-OPEN IS ABSOLUTE. This runs on every Read of the session. Any failure -
 * unparseable payload, missing key, timeout, unusable answer, unreadable file - emits
 * `{}` and the Read proceeds untouched. The exit code is always 0, and
 * `permissionDecision` is never emitted: this narrows, it never blocks.
 *
 * Node only, no shell: the registered command quotes its path, which on Windows
 * routinely contains spaces.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './config.js';
import { appendRecord, countCalls, isExcludedPath, scrub, shortPath } from './ledger.js';
import { askJev } from './jev.js';
import {
  buildChunks,
  buildQuestions,
  confidenceAccepted,
  narrowingNote,
  preflightNoFile,
  preflightSize,
  windowFor,
  type PassReason,
} from './policy.js';
import type { ChoiceAnswer, NarrowRecord, NoulAnswer } from './types.js';

const HOOK_EVENT = 'PreToolUse';

export interface HookOutput {
  hookSpecificOutput?: { hookEventName: string; updatedInput?: Record<string, unknown> };
  additionalContext?: string;
}

export interface HookDeps {
  raw?: string;
  env?: NodeJS.ProcessEnv;
  projectRoot?: string;
  stdout?: (t: string) => void;
  stderr?: (t: string) => void;
  append?: (projectRoot: string, record: NarrowRecord) => void;
}

export async function readStdin(stream: AsyncIterable<unknown> = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer));
    }
  } catch {
    // Whatever arrived is enough; a stream error is never a throw here.
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The goal, and how stale it is. */
export interface Goal {
  /** The last thing the user actually typed, trimmed and truncated. */
  text: string;
  /**
   * How many assistant turns have happened SINCE the user said it.
   *
   * This exists because it names the one failure this hook cannot otherwise see.
   * `text` is aimed at by every narrowing, but in a real session it can be twenty
   * turns old and about something else entirely: you ask about the parser, the agent
   * works, then reads `report.ts` for its own reasons, and the window is aimed at the
   * parser anyway.
   *
   * `[MEASURED]` On eleven hand-built stale pairs the window missed what the read
   * actually needed 11 times out of 11, and the confidence floor accepted every one of
   * them - at up to 0.98. Confidence says how sure the model is about which chunk
   * matches THIS goal; it cannot say whether the goal has anything to do with the read.
   *
   * NOTHING BRANCHES ON THIS. It is recorded so the distribution can exist before
   * anybody picks a cut-off, because a threshold chosen without one is a guess wearing
   * a number (ERR-028). See docs/evidence.md section 6.
   */
  ageTurns: number;
  /**
   * Whether the message that supplied `text` was typed by the person or written by the
   * harness under the `user` role. RECORDED, NOT ACTED ON - see `NarrowRecord.goalSource`.
   */
  source: 'user' | 'system';
}

/** The fold over a transcript, one entry at a time, so a replay can stop at any line. */
export interface GoalState {
  last: string;
  /** Assistant turns seen since `last` was set. */
  since: number;
  system: boolean;
}

export const emptyGoalState = (): GoalState => ({ last: '', since: 0, system: false });

/**
 * Messages the harness writes under the `user` role. The two flags are Claude Code's
 * own labels (a compaction summary, an injected skill body, a note relayed from another
 * session, a caveat). The two prefixes are shapes seen in real transcripts that carry no
 * flag at all. The list is a detector for the ledger, not a filter: nothing is dropped
 * because of it.
 */
const SYSTEM_PREFIXES = ['<task-notification>', '[Request interrupted'];

/**
 * Feeds one parsed transcript entry into the fold.
 *
 * Tool results and the agent's own turns are skipped when looking for the text: they
 * say what it has been doing, not what it was asked for. Assistant turns are counted,
 * though - that count IS the staleness. The count resets every time the user speaks
 * again, because a fresh instruction is a fresh goal however long the agent worked
 * before it.
 */
export function foldGoal(state: GoalState, entry: unknown): void {
  const o = entry as { type?: unknown; isMeta?: unknown; isCompactSummary?: unknown; message?: { content?: unknown } };
  if (o?.type === 'assistant') {
    state.since += 1;
    return;
  }
  if (o?.type !== 'user') return;
  const content = o.message?.content;
  let text = '';
  if (typeof content === 'string') {
    text = content.trim();
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const raw of content) {
      const m = raw as { type?: unknown; text?: unknown };
      if (m?.type !== 'text' || typeof m.text !== 'string') continue; // a tool_result is not the user
      parts.push(m.text);
    }
    text = parts.join(' ').trim();
  }
  if (text === '') return;
  state.last = text;
  state.since = 0;
  state.system = o.isMeta === true || o.isCompactSummary === true || SYSTEM_PREFIXES.some((p) => text.startsWith(p));
}

/**
 * The markers are cut because a system reminder or a slash-command wrapper is noise
 * around the real request. A marker at position zero leaves an empty string, and an
 * empty goal makes the caller pass the Read through - which is the right outcome.
 */
export function finishGoal(state: GoalState, maxChars = 600): Goal {
  let last = state.last;
  for (const marker of ['<system-reminder>', '<command-name>', '<local-command-stdout>', '<ide_opened_file>']) {
    const i = last.indexOf(marker);
    if (i >= 0) last = last.slice(0, i);
  }
  last = last.trim();
  return { text: last.length > maxChars ? last.slice(0, maxChars) : last, ageTurns: state.since, source: state.system ? 'system' : 'user' };
}

/** The last thing the USER actually typed, how many assistant turns ago, and who wrote it. */
export function lastUserMessage(transcriptPath: string, maxChars = 600): Goal {
  const state = emptyGoalState();
  if (transcriptPath === '' || !existsSync(transcriptPath)) return finishGoal(state, maxChars);
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return finishGoal(state, maxChars);
  }
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      foldGoal(state, JSON.parse(line));
    } catch {
      continue;
    }
  }
  return finishGoal(state, maxChars);
}

type Fields = Omit<NarrowRecord, 'timestamp' | 'sessionId' | 'path' | 'totalLines'>;
/** `exactOptionalPropertyTypes` rejects an explicit undefined; the filter below strips them. */
type Patch = { [K in keyof Fields]?: Fields[K] | undefined };

function record(sessionId: string, path: string, totalLines: number, rest: Patch): NarrowRecord {
  // The filter is what makes the cast true: every `undefined` is gone, so the result
  // really does satisfy the strict optional shape the record type asks for.
  const defined = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<Fields>;
  return { ...defined, timestamp: new Date().toISOString(), sessionId, path, totalLines, narrowed: rest.narrowed ?? false };
}

export async function main(deps: HookDeps = {}): Promise<HookOutput> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? ((t: string): void => void process.stdout.write(t));
  const stderr = deps.stderr ?? ((t: string): void => void process.stderr.write(t));
  const debug = env['SQUINT_DEBUG'] === '1';
  const append = deps.append ?? appendRecord;

  const pass = (reason: PassReason, detail: string, log?: () => void): HookOutput => {
    if (debug) stderr(`squint: passing through (${reason}: ${detail})\n`);
    try {
      log?.();
    } catch {
      // never let the ledger break a Read
    }
    return {};
  };

  try {
    const raw = deps.raw ?? (await readStdin());
    let payload: { tool_name?: unknown; tool_input?: unknown; transcript_path?: unknown; session_id?: unknown };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return pass('not-a-read', 'unparseable payload');
    }

    const toolName = typeof payload.tool_name === 'string' ? payload.tool_name : '';
    const toolInput = (payload.tool_input ?? {}) as Record<string, unknown>;
    const filePath = typeof toolInput['file_path'] === 'string' ? toolInput['file_path'] : '';
    const sessionId = typeof payload.session_id === 'string' ? payload.session_id : 'unknown';
    const transcript = typeof payload.transcript_path === 'string' ? payload.transcript_path : '';
    const projectRoot = deps.projectRoot ?? env['CLAUDE_PROJECT_DIR'] ?? process.cwd();

    const { narrow, jev } = loadConfig(projectRoot);
    const shown = shortPath(filePath, projectRoot);

    // STAGE 1 - what the tool call alone decides. NOTHING is opened here, and for an
    // excluded path that is a guarantee rather than a saving: `Secrets/` must not be
    // READ, not merely withheld. The old single pass had it backwards - it pulled a
    // 40 MB excluded file into memory and refused it afterwards (43 -> 89 ms, measured
    // 2026-09-21).
    const cheap = preflightNoFile(
      {
        toolName,
        hasExplicitWindow: toolInput['offset'] !== undefined || toolInput['limit'] !== undefined,
        path: shown,
        excluded: isExcludedPath(filePath),
      },
      narrow,
    );
    // These ledger lines carry `totalLines: 0` and no `goalAgeTurns`, because neither
    // the file nor the transcript was opened. 0 here means UNREAD, not empty. Nothing
    // consumes either field on a refusal: both are only ever read off narrowed records.
    if (cheap.action === 'pass') {
      return pass(cheap.reason, cheap.detail, () => append(projectRoot, record(sessionId, shown, 0, { reason: cheap.reason })));
    }

    // STAGE 2 - the size gate, answered from `stat` so an oversized file is refused
    // without being loaded. For valid UTF-8 the size on disk equals the byte length of
    // the decoded text, which is the number the old code paid a full read to learn.
    let bytes: number;
    try {
      bytes = statSync(filePath).size;
    } catch {
      return pass('no-path', 'unreadable file');
    }
    const oversized = preflightSize(bytes, narrow);
    if (oversized.action === 'pass') {
      return pass(oversized.reason, oversized.detail, () => append(projectRoot, record(sessionId, shown, 0, { reason: oversized.reason })));
    }

    // STAGE 3 - only now is the file worth opening.
    let data: string;
    try {
      data = readFileSync(filePath, 'utf8');
    } catch {
      return pass('no-path', 'unreadable file');
    }
    const lines = data.split('\n');
    if (lines.length < narrow.minLines) {
      return pass('file-too-small', `${lines.length} lines, under the ${narrow.minLines}-line floor`, () =>
        append(projectRoot, record(sessionId, shown, lines.length, { reason: 'file-too-small' })),
      );
    }

    // Still the file alone: a chunk count needs nothing the transcript has, so it is
    // answered before the transcript is paid for.
    const { chunks, criteria } = buildChunks(lines, narrow);
    if (Object.keys(criteria).length < 2) {
      return pass('file-too-small', 'fewer than two chunks to choose between', () =>
        append(projectRoot, record(sessionId, shown, lines.length, { reason: 'file-too-small' })),
      );
    }

    // STAGE 4 - the transcript last, because it is the most expensive read of the four:
    // 29 ms on an 8.2 MB session (measured 2026-09-21), and worth nothing on a Read that
    // was never going to be narrowed.
    const goal = lastUserMessage(transcript);
    const aim = { goalAgeTurns: goal.ageTurns, goalSource: goal.source };
    if (goal.text.trim().length < narrow.minGoalChars) {
      return pass('no-goal', `goal is ${goal.text.trim().length} chars, under ${narrow.minGoalChars}`, () =>
        append(projectRoot, record(sessionId, shown, lines.length, { ...aim, reason: 'no-goal' })),
      );
    }

    // The ceiling, checked last of all the free gates so that `budget-spent` means
    // exactly one thing: this Read would have made a call. Counting it earlier would
    // turn a `file-too-small` or `no-goal` into a `budget-spent` and lose the reason.
    const calls = countCalls(projectRoot, sessionId);
    if (calls >= narrow.maxCallsPerSession) {
      return pass('budget-spent', `${calls} calls this session, at the ${narrow.maxCallsPerSession} ceiling`, () =>
        append(projectRoot, record(sessionId, shown, lines.length, { ...aim, reason: 'budget-spent' })),
      );
    }

    // Everything past here costs a call. The goal is the user's own text going to a
    // third party, so it is scrubbed first.
    const state = {
      goal: scrub(goal.text),
      file: {
        path: shown,
        chunks: Object.fromEntries(Object.entries(chunks).map(([id, c]) => [id, { start_line: c.startLine, text: c.text }])),
      },
    };

    const res = await askJev(state, buildQuestions(criteria), jev, narrow.timeoutMs, env);
    if (res.status !== 'ok') {
      return pass('unavailable', res.reason, () =>
        append(projectRoot, record(sessionId, shown, lines.length, { ...aim, reason: 'unavailable', elapsedMs: res.elapsedMs })),
      );
    }

    const where = res.answers['where'] as ChoiceAnswer | undefined;
    const exists = res.answers['exists'] as NoulAnswer | undefined;
    const chosen = where?.choice !== undefined ? chunks[where.choice] : undefined;
    const spent = { inputTokens: res.usage.inputTokens, elapsedMs: res.elapsedMs, exists: exists?.noul };

    if (where === undefined || chosen === undefined) {
      return pass('no-chunk-chosen', 'no chunk stood out', () =>
        append(projectRoot, record(sessionId, shown, lines.length, { ...aim, reason: 'no-chunk-chosen', ...spent })),
      );
    }
    if (!confidenceAccepted(where.confidence, narrow)) {
      return pass('low-confidence', `${where.confidence.toFixed(2)} is under the ${narrow.minConfidence} floor`, () =>
        append(projectRoot, record(sessionId, shown, lines.length, { ...aim,
          reason: 'low-confidence', confidence: where.confidence, pickedLine: chosen.startLine, ...spent,
        })),
      );
    }
    const w = windowFor(chosen.startLine, lines.length, narrow);
    if (w === null) {
      return pass('window-covers-file', 'the window would cover the whole file', () =>
        append(projectRoot, record(sessionId, shown, lines.length, { ...aim,
          reason: 'window-covers-file', confidence: where.confidence, pickedLine: chosen.startLine, ...spent,
        })),
      );
    }

    const out: HookOutput = {
      hookSpecificOutput: {
        hookEventName: HOOK_EVENT,
        updatedInput: { file_path: filePath, offset: w.offset, limit: w.limit },
      },
      additionalContext: narrowingNote(basename(filePath), lines.length, w, chosen.startLine, where.confidence),
    };

    try {
      append(projectRoot, record(sessionId, shown, lines.length, { ...aim,
        narrowed: true,
        offset: w.offset,
        limit: w.limit,
        pickedLine: chosen.startLine,
        confidence: where.confidence,
        linesAvoided: lines.length - w.limit,
        ...spent,
      }));
    } catch {
      // never let the ledger cost a narrowing that already succeeded
    }

    if (debug) stderr(`squint: ${shown} ${w.offset}-${w.offset + w.limit - 1} of ${lines.length}\n`);
    stdout(JSON.stringify(out));
    return out;
  } catch (err) {
    if (debug) stderr(`squint: hook failed (${String((err as Error)?.name ?? 'error')})\n`);
    return {};
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main().finally(() => {
    // Exit 2 would block the tool call. This never blocks.
    process.exit(0);
  });
}
