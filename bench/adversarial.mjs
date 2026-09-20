/**
 * adversarial.mjs — il test che prova a far cadere il risultato principale.
 *
 * IL RISULTATO SOTTO ATTACCO. Sui file grandi, dove l'hook scatta, il braccio con
 * squint legge circa meta' dei token nuovi e costa circa un terzo in meno, senza
 * perdere risposte. Se quel risultato e' vero deve sopravvivere a due prove che sono
 * costruite apposta per romperlo. Se non sopravvive, va ritirato.
 *
 * ── ATTACCO 1 · L'ORDINE ─────────────────────────────────────────────────────
 *
 * Nella batteria principale ogni coppia gira SEMPRE `off` per primo e `on` per
 * secondo. La cache dei prompt e' uno stato che persiste fra le run: se la prima run
 * paga la costruzione della cache e la seconda la rilegge a un decimo del prezzo,
 * allora il "risparmio" di squint sarebbe solo il vantaggio di correre secondo, e si
 * misurerebbe identico anche senza hook.
 *
 *   PREVISIONE  A1  Invertendo l'ordine — `on` per primo, `off` per secondo — il
 *               risparmio deve RESTARE. Se svanisce o si rovescia, il risultato
 *               principale era un artefatto dell'ordine e va ritirato.
 *
 * ── ATTACCO 2 · IL PLACEBO ───────────────────────────────────────────────────
 *
 * Il risultato ha due ingredienti che la batteria non separa: la lettura e' piu'
 * CORTA, e la parte che resta e' quella GIUSTA. Il terzo braccio monta un hook finto
 * (`placebo-hook.mjs`) che comprime ESATTAMENTE quanto squint — stessi cancelli,
 * stessa dimensione di finestra — ma sceglie DOVE guardare da un hash del nome del
 * file, senza mai vedere l'obiettivo.
 *
 *   PREVISIONE  A2a  Sul COSTO il placebo deve assomigliare a squint: comprime uguale.
 *   PREVISIONE  A2b  Sulle RISPOSTE il placebo deve CROLLARE. Se non crolla, allora le
 *                    domande della batteria erano rispondibili senza leggere il punto
 *                    giusto, e la riga «nessuna risposta persa» non dimostra quello
 *                    che sembra dimostrare: dimostrerebbe solo che il modello sapeva
 *                    gia' rispondere.
 *
 * Le previsioni sono scritte qui, prima delle run, e non si rinegoziano dopo.
 *
 * ── ORDINE DEI BRACCI, E IL SUO LIMITE ───────────────────────────────────────
 *
 * Ogni caso gira nella sequenza `on`, `off`, `placebo`. Cosi' l'attacco 1 ha `on` in
 * prima posizione, che e' il punto. Il placebo pero' finisce in terza posizione,
 * cioe' nella posizione che l'attacco 1 sospetta essere avvantaggiata. Il limite e'
 * dichiarato e gioca CONTRO la conclusione che ci interessa: se il placebo, pur
 * stando nella posizione comoda, perde le risposte, il crollo e' reale.
 *
 *   node bench/adversarial.mjs <workspace> <out.jsonl> [nCasi]
 *
 * Il workspace vuole tre directory — `on/`, `off/`, `placebo/` — con sorgenti di hash
 * identico, diverse solo per `.claude/settings.json`.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { CASES } from './cases.mjs';
import { transcriptFor, inspect, grade } from './lib.mjs';

const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const WS = process.argv[2];
const OUT = process.argv[3];
const N = Number(process.argv[4] ?? 10);

/** L'ordine e' fisso e dichiarato sopra: non si cambia dopo aver visto i dati. */
const ARMS = ['on', 'off', 'placebo'];

const LOCK = OUT + '.lock';
try {
  closeSync(openSync(LOCK, 'wx'));
} catch {
  console.error(`un'altra batteria sta gia' scrivendo su ${OUT}. Esco senza toccare nulla.`);
  process.exit(1);
}
const release = () => { try { unlinkSync(LOCK); } catch { /* gia' andato */ } };
process.on('exit', release);
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(s, () => { release(); process.exit(130); });

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function runOnce(cwd, args) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    const r = spawnSync(CLAUDE, args, { cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    const ms = Date.now() - t0;
    let j = {};
    try { j = JSON.parse(r.stdout || '{}'); } catch { /* vuoto */ }
    if (r.status === 0 && j.session_id && typeof j.total_cost_usd === 'number') return { j, ms, attempts: attempt };
    console.error(`  tentativo ${attempt}/3 non valido (exit ${r.status}, ${ms} ms) — rifaccio`);
    sleep(4000);
  }
  return { j: {}, ms: 0, attempts: 3 };
}

const selected = CASES.filter((c) => c.stratum === 'LARGE').slice(0, N);
const total = selected.length * ARMS.length;
console.error(`avversariale: ${selected.length} casi LARGE x ${ARMS.length} bracci (${ARMS.join(', ')}) = ${total} run`);

let done = 0;
for (const c of selected) {
  for (const arm of ARMS) {
    const cwd = join(WS, arm);
    const args = ['-p', c.prompt, '--model', 'haiku', '--output-format', 'json',
      '--allowedTools', 'Read Glob', '--disallowedTools', 'Agent Task'];
    const { j, ms, attempts } = runOnce(cwd, args);
    const answer = (j.result || '').trim();
    const seen = j.session_id
      ? inspect(transcriptFor(j.session_id), cwd, j.session_id)
      : { tools: null, reads: [], rereadCount: 0, narrowings: 0, windows: [], notesInTranscript: 0, reasons: {}, jevCalls: 0, jevInputTokens: 0, ledgerRows: 0 };
    const recall = c.line && seen.windows.length > 0
      ? seen.windows.some((w) => c.line >= w.from && c.line <= w.to)
      : null;
    const rec = {
      test: 'adversarial', arm, id: c.id, stratum: c.stratum,
      file: c.file, fileLines: c.lines, trueLine: c.line,
      pass: grade(c, answer), answer: answer.slice(0, 140),
      cost_usd: j.total_cost_usd ?? null,
      cache_create: j.usage?.cache_creation_input_tokens ?? null,
      cache_read: j.usage?.cache_read_input_tokens ?? null,
      out_tok: j.usage?.output_tokens ?? null,
      turns: j.num_turns ?? null, ms,
      tools: seen.tools, narrowings: seen.narrowings, windows: seen.windows, recall,
      jevCalls: seen.jevCalls, jevInputTokens: seen.jevInputTokens, reasons: seen.reasons,
      session: j.session_id ?? null, attempts,
    };
    appendFileSync(OUT, JSON.stringify(rec) + '\n');
    done += 1;
    console.error(`  [${done}/${total}] ${rec.id}/${arm}  $${(rec.cost_usd ?? 0).toFixed(4)}  pass=${rec.pass}  narrow=${rec.narrowings}  recall=${rec.recall}`);
    sleep(2500);
  }
}
