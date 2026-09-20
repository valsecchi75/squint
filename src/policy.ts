/**
 * The policy: everything jev-narrow decides WITHOUT doing any I/O.
 *
 * NOTHING IN THIS MODULE TOUCHES THE DISK, THE NETWORK OR THE CLOCK. It imports
 * types only, and test/policy.test.ts asserts that against this file's own source -
 * a policy that reads a file to decide whether to spend a call has already spent
 * something.
 *
 * THE DANGEROUS PART, STATED FIRST. This is the only code here that can HIDE CODE.
 * A window that drops the answer is a silent omission: the agent reads what it was
 * handed and never learns the rest existed. Every decision below is therefore biased
 * towards doing nothing, and the ledger records every refusal so the hit rate can
 * never be quoted without its denominator.
 *
 * Ported from the Read hook of github.com/BorisLeMeec/jev (MIT). The thresholds are
 * kept verbatim because they are measured numbers; docs/evidence.md re-measures the
 * one that matters most on an independent sample.
 */

import type { ChoiceQuestion, NoulQuestion, NarrowConfig } from './types.js';

// ---------------------------------------------------------------------------
// The questions, kept in English like every other JEF question (brand voice)
// ---------------------------------------------------------------------------

export const LOCATE_INSTRUCTIONS =
  'Which numbered chunk of `file.chunks` contains the part of this file that most ' +
  'directly implements what `goal` describes? Each chunk is a run of consecutive lines from the file at `file.path`.';

/**
 * Kept for the ledger, NOT used as a safety signal, and the distinction is measured:
 * on twelve labelled targets this noul read 0.26 and 0.31 on windows that were
 * CORRECT. What separated the hits from the miss was the CHOICE CONFIDENCE, not this.
 * Recording it without acting on it is the honest middle: it costs nothing extra in
 * the same request, and a future calibration may find a use we cannot see today.
 */
export const LOCATE_EXISTS_INSTRUCTIONS =
  'Does any chunk in `file.chunks` actually implement what `goal` describes, rather than merely mentioning or calling it?';

// ---------------------------------------------------------------------------
// Why a Read was left alone
// ---------------------------------------------------------------------------

/**
 * The refusal ladder, in the order it is evaluated. Each value is printed verbatim in
 * the `narrowing` record so `/jef report` can say WHY nothing happened - a hook that
 * silently does nothing is indistinguishable from a hook that is broken.
 */
export type PassReason =
  | 'disabled'
  | 'not-a-read'
  | 'no-path'
  | 'agent-set-window'
  | 'file-too-small'
  | 'file-too-large'
  | 'no-goal'
  | 'excluded-path'
  | 'low-confidence'
  | 'no-chunk-chosen'
  | 'window-covers-file'
  | 'unavailable';

export type Preflight =
  | { action: 'pass'; reason: PassReason; detail: string }
  | { action: 'ask' };

export interface PreflightInput {
  toolName: string;
  hasExplicitWindow: boolean;
  /** Already normalised by the caller; only used to report, never re-read here. */
  path: string;
  totalLines: number;
  totalBytes: number;
  goal: string;
  /** True when sanitize.isExcludedPath said so: Secrets/ and .env never leave (ERR-001). */
  excluded: boolean;
}

/**
 * Everything that can be decided WITHOUT a call. Ordered cheapest-first so the common
 * refusals cost nothing: on this repository only 6 files of 27 in `.jef/src`, and 40 of
 * 230 overall, pass the size gate at all (measured 2026-09-20), so most Reads stop here.
 */
export function preflight(input: PreflightInput, config: NarrowConfig): Preflight {
  if (!config.enabled) return { action: 'pass', reason: 'disabled', detail: 'readNarrowing.enabled is false' };
  if (input.toolName !== 'Read') return { action: 'pass', reason: 'not-a-read', detail: `tool is ${input.toolName}` };
  if (input.path === '') return { action: 'pass', reason: 'no-path', detail: 'no file_path in tool_input' };

  // An explicit window is the agent's OWN decision about this file. Second-guessing it
  // would also break the escape hatch the note offers the reader ("read it again with
  // an explicit offset"), which would then be narrowed a second time.
  if (input.hasExplicitWindow) {
    return { action: 'pass', reason: 'agent-set-window', detail: 'the agent set offset or limit itself' };
  }

  // ERR-001 is absolute and comes before any size consideration: the GOAL text and the
  // file chunks both leave towards TypeSafe, so an excluded path must never get here.
  if (input.excluded) return { action: 'pass', reason: 'excluded-path', detail: 'path is excluded from egress' };

  if (input.totalLines < config.minLines) {
    return { action: 'pass', reason: 'file-too-small', detail: `${input.totalLines} lines, under the ${config.minLines}-line floor` };
  }

  // Above this a file must be split into sections, and confidences from different
  // sections are NOT comparable. Measured by the upstream author, that path loses the
  // target 3 times in 11 while a single-request file has not lost one in 23. For `find`
  // a wrong line is a hint beside a correct file; here it would hide code, so the file
  // is refused rather than narrowed.
  if (input.totalBytes > config.maxBytes) {
    return { action: 'pass', reason: 'file-too-large', detail: `${input.totalBytes} bytes, over the ${config.maxBytes}-byte single-request limit` };
  }

  if (input.goal.trim().length < config.minGoalChars) {
    return { action: 'pass', reason: 'no-goal', detail: `goal is ${input.goal.trim().length} chars, under ${config.minGoalChars}` };
  }

  return { action: 'ask' };
}

// ---------------------------------------------------------------------------
// The chunks that become the Choice
// ---------------------------------------------------------------------------

export interface Chunk {
  /** 1-based line number of the chunk's first line, in the WHOLE file. */
  startLine: number;
  text: string;
}

export interface ChunkPlan {
  chunks: Record<string, Chunk>;
  /** The Choice criteria: id -> human label. Keyed objects, never positional (DEC-029). */
  criteria: Record<string, string>;
}

/**
 * Chunk size grows rather than the count, because a Choice accepts at most 255 options
 * (tech-stack §7) and because DEC-029 measured that JEF is only safe from the
 * positional-index defect while its options are KEYED - which they are here (`c0`,
 * `c1`, ...) with a descriptive label each.
 */
export function buildChunks(lines: readonly string[], config: NarrowConfig): ChunkPlan {
  const size = Math.max(config.chunkLines, Math.ceil(lines.length / config.maxChunks));
  const chunks: Record<string, Chunk> = {};
  const criteria: Record<string, string> = {};
  for (let start = 0; start < lines.length; start += size) {
    const end = Math.min(start + size, lines.length);
    const id = `c${Math.floor(start / size)}`;
    chunks[id] = { startLine: start + 1, text: lines.slice(start, end).join('\n') };
    criteria[id] = `lines ${start + 1}-${end}`;
  }
  return { chunks, criteria };
}

/** The two questions of the single request. One call, both answers (ERR-009). */
export function buildQuestions(criteria: Record<string, string>): {
  where: ChoiceQuestion;
  exists: NoulQuestion;
} {
  return {
    where: { type: 'choice', instructions: LOCATE_INSTRUCTIONS, criteria },
    exists: { type: 'noul', instructions: LOCATE_EXISTS_INSTRUCTIONS },
  };
}

// ---------------------------------------------------------------------------
// From the chosen line to the window
// ---------------------------------------------------------------------------

export interface Window {
  offset: number;
  limit: number;
}

/**
 * A fifth of the file, never under `minWindow` lines, centred on the pick.
 *
 * Both numbers are measured upstream over 32 targets in 413-1191 line files: the chosen
 * line sat a median of 4 lines from the real one, 31 of 32 within 25 lines and all 32
 * within 60. A 150-line window centred on the pick forgives +/-75, past the worst error
 * seen. The divisor was 3 at first, which on a 413-line file kept 73% of the file and
 * saved almost nothing.
 *
 * `[FACT ACTUAL 2026-09-20]` Our own replication saw a WORSE error than any of those:
 * 133 lines, at confidence 0.63. Recall survived only because the window was clamped to
 * the end of the file. That is why `minConfidence` is calibrated separately and why the
 * regret counter exists - the window forgives a small error, not a large one.
 */
export function windowFor(pickedLine: number, totalLines: number, config: NarrowConfig): Window | null {
  const window = Math.max(config.minWindow, Math.floor(totalLines / config.windowDivisor));
  // A window that covers the file saves nothing and still costs a call's worth of
  // risk: better to hand back the untouched Read.
  if (window >= totalLines) return null;

  let offset = pickedLine - Math.floor(window / 2);
  if (offset < 1) offset = 1;
  if (offset + window > totalLines) offset = totalLines - window;
  return { offset, limit: window };
}

/**
 * The note that rides along with a narrowing. It must say what was done, how to undo
 * it, and that nothing was removed from the FILE - the agent is otherwise entitled to
 * believe it has seen the whole thing.
 */
export function narrowingNote(
  basename: string,
  totalLines: number,
  w: Window,
  pickedLine: number,
  confidence: number,
): string {
  return (
    `jev-narrow narrowed this Read: ${basename} is ${totalLines} lines, showing ${w.offset}-${w.offset + w.limit - 1} ` +
    `(match at line ${pickedLine}, confidence ${confidence.toFixed(2)}). ` +
    'Read it again with an explicit offset or limit to see any other part - nothing was removed from the file.'
  );
}

/**
 * The confidence gate, kept as its own function so the calibration has one call site.
 *
 * `[MEASURED]` Upstream: across twelve labelled targets every correct window scored
 * 0.71 or above and the one that lost its target scored 0.42, so 0.60 sits between them.
 * `[FACT ACTUAL 2026-09-20]` Our replication adds a second data point ON THE OTHER SIDE:
 * a window at 0.63 picked a line 133 off. The floor is therefore known to be thin, is
 * configurable, and Phase 10 activity 3 recalibrates it on this repository before the
 * default moves. Until then it stays at the upstream value - a threshold nobody has
 * re-measured must not be quietly changed (ERR-028).
 */
export function confidenceAccepted(confidence: number, config: NarrowConfig): boolean {
  return confidence >= config.minConfidence;
}
