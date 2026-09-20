/**
 * One call to Jev, and the rules that keep it from ever costing more than it should.
 *
 * FAIL-OPEN IS ABSOLUTE HERE. This sits on the path of every `Read` in a session, so
 * any failure - missing key, timeout, transport error, malformed answer - returns
 * `unavailable` and the Read proceeds untouched. Nothing thrown below this boundary
 * escapes.
 *
 * The key comes from the environment and from nowhere else. It is never read from a
 * file, never written to the ledger, never printed, not even inside an error.
 */

import { TypeSafeClient } from '@typesafe-ai/sdk';

import type { ChoiceQuestion, JevConfig, JevResult, NoulQuestion } from './types.js';

/** The names accepted, in order. The first one set wins. */
const KEY_NAMES = ['TYPESAFE_API_KEY', 'TYPE_SAFE_AI_KEY', 'TYPESAFE_AI_API_KEY'] as const;

export function apiKeyFrom(env: NodeJS.ProcessEnv): string | null {
  for (const name of KEY_NAMES) {
    const v = env[name];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/** A value no wire response could ever be, so the race below cannot be confused. */
const BUDGET_SPENT: unique symbol = Symbol('jev.budgetSpent');

function looksLikeResponse(raw: unknown): raw is {
  answers: Record<string, never>;
  usage: { input_tokens: number; output_tokens: number };
} {
  if (typeof raw !== 'object' || raw === null) return false;
  const o = raw as Record<string, unknown>;
  if (typeof o['answers'] !== 'object' || o['answers'] === null) return false;
  const u = o['usage'];
  if (typeof u !== 'object' || u === null) return false;
  const usage = u as Record<string, unknown>;
  // A response without usage is REJECTED rather than reported with zeros: a zero we
  // did not measure is a lie, and the ledger would carry it forever.
  return typeof usage['input_tokens'] === 'number' && typeof usage['output_tokens'] === 'number';
}

export async function askJev(
  state: object,
  questions: Record<string, ChoiceQuestion | NoulQuestion>,
  jev: JevConfig,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<JevResult> {
  const started = Date.now();
  const elapsed = (): number => Date.now() - started;

  const apiKey = apiKeyFrom(env);
  if (apiKey === null) {
    return { status: 'unavailable', reason: 'no api key in environment', elapsedMs: elapsed() };
  }

  // A safety net over the SDK's own timeout, which is per attempt and has no total
  // budget. The abort signal alone is not enough: it only reaches a transport that
  // honours it, so the budget is RACED as well. A transport that hangs must not be
  // able to hold a Read open.
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<typeof BUDGET_SPENT>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(BUDGET_SPENT);
    }, timeoutMs);
  });

  try {
    const client = new TypeSafeClient({
      apiKey,
      baseURL: `https://${jev.host}`,
      defaultModel: jev.model,
      timeout: timeoutMs,
      // One retry at most. The hook has seconds; a second attempt already spends the
      // backoff, and anything longer is a stall rather than a recovery.
      retry: { maxRetries: 1 },
      // 'off', not the SDK default: its logger is the console, and this process's
      // stdout is the hook protocol. At 'debug' it prints request bodies unredacted.
      logLevel: 'off',
    });

    const call: Promise<unknown> = client.systemOne(
      { state: state as never, questions: questions as never, model: jev.model },
      { signal: controller.signal },
    );
    // Whoever loses the race still settles. An unclaimed rejection would surface as
    // an unhandled one and take the hook's process down with it.
    call.catch(() => undefined);

    const raw: unknown = await Promise.race([call, budget]);
    if (raw === BUDGET_SPENT) {
      return { status: 'unavailable', reason: `timeout after ${timeoutMs} ms`, elapsedMs: elapsed() };
    }
    if (!looksLikeResponse(raw)) {
      return { status: 'unavailable', reason: 'unusable response shape', elapsedMs: elapsed() };
    }
    return {
      status: 'ok',
      answers: raw.answers,
      usage: { inputTokens: raw.usage.input_tokens, outputTokens: raw.usage.output_tokens },
      elapsedMs: elapsed(),
    };
  } catch (err) {
    // The boundary: nothing escapes. The message is the error's NAME, never its text,
    // because an SDK error can quote the request - and the request carries the file.
    const name = (err as Error)?.name ?? 'error';
    return { status: 'unavailable', reason: `call failed (${String(name)})`, elapsedMs: elapsed() };
  } finally {
    clearTimeout(timer);
  }
}
