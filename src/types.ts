/**
 * The whole type surface of squint. Deliberately small: this package does one
 * thing, so it needs one config block and one record shape.
 *
 * Every number in `NarrowConfig` is MEASURED, and the measurement is beside it in
 * `docs/evidence.md`. None of them is a preference.
 */

export interface NarrowConfig {
  /** false leaves every Read untouched. The hook still runs and still records why. */
  enabled: boolean;

  /**
   * Below this a file is cheap enough that the call costs more than the narrowing
   * saves. 400 lines. On a real TypeScript repository this refuses roughly five
   * reads out of six (measured: 40 eligible files out of 230).
   */
  minLines: number;

  /**
   * Above this the file would have to be cut into sections, and confidences from
   * different sections are not comparable. Measured upstream, that path loses the
   * target 3 times in 11 while a single-request file has not lost one in 23. So an
   * oversized file is REFUSED rather than narrowed: a wrong window hides code.
   */
  maxBytes: number;

  /**
   * The gate that decides whether the pick is trustworthy enough to hide the rest.
   *
   * MEASURED, on 26 hand-written targets across 5 files: all five windows that lost
   * their target scored **0.41 or below**; the highest failure was 0.41 and the
   * upstream project's single observed failure was 0.42. At 0.60 the sample gives
   * 14 narrowings with 14/14 recall. Lowering it to 0.50 buys 2 more narrowings and
   * moves the floor to within 0.09 of the worst observed failure - a margin five
   * failures cannot estimate. Full curve in docs/evidence.md.
   */
  minConfidence: number;

  /** The window is `totalLines / windowDivisor`, floored at `minWindow`. */
  windowDivisor: number;

  /**
   * 150 lines, centred on the pick, so it forgives +/-75. Measured upstream over 32
   * targets: the chosen line sat a median of 4 lines from the real one, 31 of 32
   * within 25 and all 32 within 60. Our own 26 targets: median error 8 lines.
   */
  minWindow: number;

  /** A Choice accepts at most 255 options, so chunk SIZE grows, never the count. */
  maxChunks: number;
  chunkLines: number;

  /** A goal shorter than this is not a statement of intent, so nothing is narrowed. */
  minGoalChars: number;

  /**
   * Its own timeout, NOT the one you would use for a small classification call.
   *
   * MEASURED: this request carries the file itself (~22.000 input tokens). A 3.000 ms
   * budget censored 2 of 9 narrowings at exactly the threshold, with one success
   * landing 80 ms short of failing. 6.000 ms is twice the largest observed success.
   */
  timeoutMs: number;
}

export const DEFAULT_CONFIG: NarrowConfig = {
  enabled: true,
  minLines: 400,
  maxBytes: 80_000,
  minConfidence: 0.6,
  windowDivisor: 5,
  minWindow: 150,
  maxChunks: 200,
  chunkLines: 10,
  minGoalChars: 12,
  timeoutMs: 6_000,
};

/** Where to reach Jev. The key is read from the environment and never from a file. */
export interface JevConfig {
  model: string;
  host: string;
}

export const DEFAULT_JEV: JevConfig = { model: 'jev-latest', host: 'api.typesafe.ai' };

// --- The wire shapes we rely on ----------------------------------------------

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
}

export interface ChoiceAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}

export interface JevUsage {
  inputTokens: number;
  outputTokens: number;
}

export type JevResult =
  | {
      status: 'ok';
      answers: Record<string, ChoiceAnswer | NoulAnswer>;
      usage: JevUsage;
      elapsedMs: number;
    }
  | { status: 'unavailable'; reason: string; elapsedMs: number };

// --- The ledger ---------------------------------------------------------------

/**
 * One JSONL line per Read the hook looked at, narrowed OR NOT.
 *
 * The pass-throughs are the denominator, and that is the point. A ledger that
 * recorded only the narrowings would report a 100% hit rate for a hook that fires
 * on one file in six.
 */
export interface NarrowRecord {
  timestamp: string;
  sessionId: string;
  /** Repo-relative and sanitized: an absolute path carries a username. */
  path: string;
  totalLines: number;
  narrowed: boolean;
  /** Why nothing happened. Absent when `narrowed` is true. */
  reason?: string;
  offset?: number;
  limit?: number;
  pickedLine?: number;
  confidence?: number;
  /** The `exists` noul. Recorded, deliberately not acted on - see policy.ts. */
  exists?: number;
  /**
   * A count of LINES, never of tokens. The hook knows exactly what it stopped from
   * being read and knows nothing about how those lines would tokenise. Converting
   * it with a divisor would turn a measurement into an estimate nobody can check.
   */
  linesAvoided?: number;
  inputTokens?: number;
  elapsedMs?: number;
}
