/**
 * Config loading (I/O). Reads `<projectRoot>/.squint.json` if it exists.
 *
 * Fail-open: a missing, unreadable or malformed file never throws - the affected
 * fields fall back to the defaults in types.ts, which is the table published in the
 * README. The defaults live in exactly one place, so no module hardcodes a threshold.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_CONFIG, DEFAULT_JEV, type JevConfig, type NarrowConfig } from './types.js';

export const CONFIG_FILENAME = '.squint.json';

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' && v.length > 0 ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** A count: at least 1. A zero here would not mean "off" - it would divide by nothing. */
const count = (v: unknown, d: number, floor = 1): number => Math.max(floor, Math.floor(num(v, d)));

/** A probability. Anything outside [0,1] is a bug in the file, not a preference. */
const prob = (v: unknown, d: number): number => {
  const n = num(v, Number.NaN);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : d;
};

export interface LoadedConfig {
  narrow: NarrowConfig;
  jev: JevConfig;
}

export function normalize(raw: unknown): LoadedConfig {
  const r = obj(raw);
  const n = obj(r['narrow']);
  const j = obj(r['jev']);
  return {
    narrow: {
      enabled: bool(n['enabled'], DEFAULT_CONFIG.enabled),
      minLines: count(n['minLines'], DEFAULT_CONFIG.minLines),
      maxBytes: count(n['maxBytes'], DEFAULT_CONFIG.maxBytes),
      minConfidence: prob(n['minConfidence'], DEFAULT_CONFIG.minConfidence),
      // Below 2 the window would cover the whole file, which policy.ts rejects anyway -
      // clamping here makes the intent explicit instead of relying on that.
      windowDivisor: count(n['windowDivisor'], DEFAULT_CONFIG.windowDivisor, 2),
      minWindow: count(n['minWindow'], DEFAULT_CONFIG.minWindow),
      // Hard ceiling from the API: a Choice accepts at most 255 options.
      maxChunks: Math.min(255, count(n['maxChunks'], DEFAULT_CONFIG.maxChunks, 2)),
      chunkLines: count(n['chunkLines'], DEFAULT_CONFIG.chunkLines),
      minGoalChars: count(n['minGoalChars'], DEFAULT_CONFIG.minGoalChars),
      // A non-positive timeout would turn fail-open into always-open: an already
      // elapsed budget aborts before the request ever leaves.
      timeoutMs: count(n['timeoutMs'], DEFAULT_CONFIG.timeoutMs),
    },
    jev: {
      model: str(j['model'], DEFAULT_JEV.model),
      host: str(j['host'], DEFAULT_JEV.host),
    },
  };
}

export function loadConfig(projectRoot: string): LoadedConfig {
  try {
    return normalize(JSON.parse(readFileSync(join(projectRoot, CONFIG_FILENAME), 'utf8')));
  } catch {
    return normalize(undefined);
  }
}
