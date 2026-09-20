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

import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './config.js';
import { appendRecord, isExcludedPath, scrub, shortPath } from './ledger.js';
import { askJev } from './jev.js';
import {
  buildChunks,
  buildQuestions,
  confidenceAccepted,
  narrowingNote,
  preflight,
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
}

/**
 * The last thing the USER actually typed, and how many assistant turns ago.
 *
 * Tool results and the agent's own turns are skipped when looking for the text: they
 * say what it has been doing, not what it was asked for. They are counted, though -
 * that count IS the staleness.
 *
 * The markers are cut because a system reminder or a slash-command wrapper is noise
 * around the real request. A marker at position zero leaves an empty string, and an
 * empty goal makes the caller pass the Read through - which is the right outcome.
 */
export function lastUserMessage(transcriptPath: string, maxChars = 600): Goal {
  const none: Goal = { text: '', ageTurns: 0 };
  if (transcriptPath === '' || !existsSync(transcriptPath)) return none;
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return none;
  }
  let last = '';
  // Assistant turns seen since `last` was set. Reset every time the user speaks again,
  // because a fresh instruction is a fresh goal however long the agent worked before it.
  let since = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    let o: { type?: unknown; message?: { content?: unknown } };
    try {
      o = JSON.parse(line) as typeof o;
    } catch {
      continue;
    }
    if (o.type === 'assistant') {
      since += 1;
      continue;
    }
    if (o.type !== 'user') continue;
    const content = o.message?.content;
    if (typeof content === 'string') {
      if (content.trim() !== '') {
        last = content.trim();
        since = 0;
      }
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const raw2 of content) {
        const m = raw2 as { type?: unknown; text?: unknown };
        if (m?.type !== 'text' || typeof m.text !== 'string') continue; // a tool_result is not the user
        parts.push(m.text);
      }
      const joined = parts.join(' ').trim();
      if (joined !== '') {
        last = joined;
        since = 0;
      }
    }
  }
  for (const marker of ['<system-reminder>', '<command-name>', '<local-command-stdout>', '<ide_opened_file>']) {
    const i = last.indexOf(marker);
    if (i >= 0) last = last.slice(0, i);
  }
  last = last.trim();
  return { text: last.length > maxChars ? last.slice(0, maxChars) : last, ageTurns: since };
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

    // The cheap refusals first, and NOTHING is read from disk before they clear.
    if (!narrow.enabled) return pass('disabled', 'narrow.enabled is false');
    if (toolName !== 'Read') return pass('not-a-read', `tool is ${toolName}`);
    if (filePath === '') return pass('no-path', 'no file_path');

    const shown = shortPath(filePath, projectRoot);
    const hasWindow = toolInput['offset'] !== undefined || toolInput['limit'] !== undefined;

    let data: string;
    try {
      data = readFileSync(filePath, 'utf8');
    } catch {
      return pass('no-path', 'unreadable file');
    }
    const lines = data.split('\n');
    const goal = lastUserMessage(transcript);

    const pre = preflight(
      {
        toolName,
        hasExplicitWindow: hasWindow,
        path: shown,
        totalLines: lines.length,
        totalBytes: Buffer.byteLength(data, 'utf8'),
        goal: goal.text,
        excluded: isExcludedPath(filePath),
      },
      narrow,
    );
    if (pre.action === 'pass') {
      return pass(pre.reason, pre.detail, () => append(projectRoot, record(sessionId, shown, lines.length, { goalAgeTurns: goal.ageTurns, reason: pre.reason })));
    }

    const { chunks, criteria } = buildChunks(lines, narrow);
    if (Object.keys(criteria).length < 2) {
      return pass('file-too-small', 'fewer than two chunks to choose between', () =>
        append(projectRoot, record(sessionId, shown, lines.length, { goalAgeTurns: goal.ageTurns, reason: 'file-too-small' })),
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
        append(projectRoot, record(sessionId, shown, lines.length, { goalAgeTurns: goal.ageTurns, reason: 'unavailable', elapsedMs: res.elapsedMs })),
      );
    }

    const where = res.answers['where'] as ChoiceAnswer | undefined;
    const exists = res.answers['exists'] as NoulAnswer | undefined;
    const chosen = where?.choice !== undefined ? chunks[where.choice] : undefined;
    const spent = { inputTokens: res.usage.inputTokens, elapsedMs: res.elapsedMs, exists: exists?.noul };

    if (where === undefined || chosen === undefined) {
      return pass('no-chunk-chosen', 'no chunk stood out', () =>
        append(projectRoot, record(sessionId, shown, lines.length, { goalAgeTurns: goal.ageTurns, reason: 'no-chunk-chosen', ...spent })),
      );
    }
    if (!confidenceAccepted(where.confidence, narrow)) {
      return pass('low-confidence', `${where.confidence.toFixed(2)} is under the ${narrow.minConfidence} floor`, () =>
        append(projectRoot, record(sessionId, shown, lines.length, { goalAgeTurns: goal.ageTurns,
          reason: 'low-confidence', confidence: where.confidence, pickedLine: chosen.startLine, ...spent,
        })),
      );
    }
    const w = windowFor(chosen.startLine, lines.length, narrow);
    if (w === null) {
      return pass('window-covers-file', 'the window would cover the whole file', () =>
        append(projectRoot, record(sessionId, shown, lines.length, { goalAgeTurns: goal.ageTurns,
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
      append(projectRoot, record(sessionId, shown, lines.length, { goalAgeTurns: goal.ageTurns,
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
