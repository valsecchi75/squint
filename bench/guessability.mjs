/**
 * guessability.mjs — il pavimento della colonna «risposte corrette».
 *
 * PERCHE' ESISTE. La batteria riporta che squint non perde risposte: 18/19. Il test
 * avversariale ha pero' mostrato che un hook FINTO, che sbaglia finestra 8 volte su 10,
 * risponde 10/10. Due spiegazioni restano in piedi e portano a conclusioni opposte:
 *
 *   (a) l'agente recupera - vede che la finestra non basta e rilegge;
 *   (b) le domande erano rispondibili SENZA leggere niente, e allora la colonna
 *       «risposte corrette» non misura il meccanismo, misura il modello.
 *
 * Questo script separa le due. Pone le stesse identiche domande con OGNI strumento di
 * lettura vietato: niente Read, niente Grep, niente Glob, niente Bash. Il modello puo'
 * solo rispondere a memoria, dal nome del file e dalla descrizione nella domanda.
 *
 *   PREVISIONE, scritta prima delle run: il tasso deve essere BASSO. Le domande
 *   descrivono cosa fa una funzione e chiedono il nome esatto; indovinarlo senza il
 *   file significa che la descrizione telegrafa il nome.
 *
 *   SE INVECE E' ALTO, va detto forte: il 18/19 di squint e il 10/10 del placebo si
 *   spiegano entrambi senza scomodare ne' il meccanismo ne' il recupero, e la colonna
 *   «risposte corrette» va letta come un pavimento, non come una prova.
 *
 *   node bench/guessability.mjs <workspace> <out.jsonl> [nCasi]
 *
 * Gira in una qualunque delle directory dei bracci: nessuno strumento puo' toccarle,
 * quindi quale sia non cambia niente.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

import { CASES } from './cases.mjs';
import { grade } from './lib.mjs';

const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const WS = process.argv[2];
const OUT = process.argv[3];
const N = Number(process.argv[4] ?? 10);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const selected = CASES.filter((c) => c.stratum === 'LARGE').slice(0, N);
console.error(`indovinabilita': ${selected.length} domande, nessuno strumento di lettura\n`);

let ok = 0, spent = 0;
for (const c of selected) {
  const args = ['-p', c.prompt, '--model', 'haiku', '--output-format', 'json',
    // Tutto vietato. Non e' una richiesta di non leggere: e' l'impossibilita' di farlo.
    '--disallowedTools', 'Read Glob Grep Bash Agent Task Skill'];
  const r = spawnSync(CLAUDE, args, { cwd: join(WS, 'off'), encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
  let j = {};
  try { j = JSON.parse(r.stdout || '{}'); } catch { /* vuoto */ }
  const answer = (j.result || '').trim();
  const pass = grade(c, answer);
  ok += pass ? 1 : 0;
  spent += j.total_cost_usd ?? 0;
  const rec = {
    test: 'guessability', id: c.id, file: c.file, truth: c.truth,
    pass, answer: answer.slice(0, 160),
    cost_usd: j.total_cost_usd ?? null, tools: null,
    session: j.session_id ?? null,
  };
  appendFileSync(OUT, JSON.stringify(rec) + '\n');
  console.error(`  ${c.id.padEnd(4)} ${String(c.truth).padEnd(24)} ${pass ? 'INDOVINATA' : 'no        '}  $${(j.total_cost_usd ?? 0).toFixed(4)}`);
  sleep(2000);
}

console.error(`\n${'='.repeat(64)}`);
console.error(`SENZA LEGGERE NIENTE: ${ok}/${selected.length} risposte corrette`);
console.error(`${'='.repeat(64)}`);
console.error('  Questo e il PAVIMENTO di ogni altra cifra di qualita in docs/evidence.md.');
console.error('  Un braccio che risponde a questo livello non ha dimostrato di aver letto.');
console.error(`\nspesa ACTUAL $${spent.toFixed(4)}`);
