/**
 * stale-goal.mjs — il rischio dichiarato «il piu' grande e non misurato», misurato.
 *
 * IL PROBLEMA. `lastUserMessage()` prende l'ultimo turno UTENTE del transcript e lo usa
 * come obiettivo verso cui puntare la finestra. In una sessione vera quel turno puo'
 * essere venti mosse indietro e riguardare tutt'altro: chiedi del parser, l'agente
 * lavora, poi legge `report.ts` per ragioni sue, e l'hook restringe quella lettura
 * verso *il parser*.
 *
 * Nella batteria questo non si vede: ogni sessione ha UN solo turno utente, quindi
 * l'obiettivo e' sempre fresco e sempre pertinente. La misura e' strutturalmente cieca.
 *
 * COSA FA QUESTO SCRIPT. Prende due bersagli dello STESSO file, passa a Jev l'obiettivo
 * del primo, e verifica la finestra contro la riga vera del SECONDO — cioe' simula
 * esattamente «l'obiettivo e' vecchio, la lettura serve per altro».
 *
 * LE DUE DOMANDE, e la seconda conta piu' della prima:
 *
 *   S1  Quante volte la finestra prodotta da un obiettivo scaduto contiene comunque
 *       cio' che serve? Previsione: circa il caso, perche' la finestra e' un quinto
 *       del file e l'obiettivo non ha nessuna relazione col bersaglio.
 *
 *   S2  CON CHE CONFIDENZA? Questa e' la domanda pericolosa. Il pavimento a 0,60 e'
 *       l'unica difesa che l'hook ha. Ma la confidenza dice «quanto sono sicuro di
 *       quale chunk implementa QUESTO obiettivo», non «quanto questo obiettivo
 *       c'entra con la lettura in corso». Se un obiettivo scaduto ma ben formato
 *       produce confidenza alta, il pavimento non vede niente e l'hook restringe con
 *       sicurezza verso la cosa sbagliata.
 *
 * Nessuna sessione Claude: solo chiamate a Jev, quindi costa centesimi.
 *
 *   node bench/stale-goal.mjs <srcDir> <out.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CASES } from './cases.mjs';

const SRC = process.argv[2];
const OUT = process.argv[3];
const DIST = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'src');
const mod = (n) => import(pathToFileURL(join(DIST, n)).href);
const { buildChunks, buildQuestions, windowFor, confidenceAccepted } = await mod('policy.js');
const { askJev } = await mod('jev.js');
const { loadConfig } = await mod('config.js');
const { narrow, jev } = loadConfig(process.cwd());

/**
 * L'obiettivo si estrae dal prompt del caso, cosi' e' *letteralmente* quello che
 * l'hook avrebbe visto: `lastUserMessage` prende il testo dell'utente cosi' com'e'.
 */
const goalOf = (c) => c.prompt;

// Coppie (obiettivo di X, bersaglio di Y) sullo STESSO file. Solo dove il file ha almeno
// due casi, altrimenti non c'e' un secondo bersaglio verso cui essere scaduti.
const large = CASES.filter((c) => c.stratum === 'LARGE');
const byFile = {};
for (const c of large) (byFile[c.file] ??= []).push(c);
const PAIRS = [];
for (const [file, cs] of Object.entries(byFile)) {
  if (cs.length < 2) continue;
  for (const stale of cs) for (const target of cs) {
    if (stale.id !== target.id) PAIRS.push({ file, stale, target });
  }
}

console.log(`${PAIRS.length} coppie (obiettivo scaduto, bersaglio reale) su ${Object.keys(byFile).length} file\n`);

const results = [];
for (const { file, stale, target } of PAIRS) {
  const lines = readFileSync(join(SRC, file), 'utf8').split('\n');
  const { chunks, criteria } = buildChunks(lines, narrow);
  const state = {
    goal: goalOf(stale),
    file: { path: file, chunks: Object.fromEntries(Object.entries(chunks).map(([id, c]) => [id, { start_line: c.startLine, text: c.text }])) },
  };
  const r = await askJev(state, buildQuestions(criteria), jev, narrow.timeoutMs, process.env);
  if (r.status !== 'ok') { console.log(`${stale.id}->${target.id}  FALLITA (${r.reason})`); continue; }

  const where = r.answers['where'];
  const chosen = chunks[where?.choice];
  const picked = chosen?.startLine ?? null;
  const w = picked ? windowFor(picked, lines.length, narrow) : null;
  const accepted = where ? confidenceAccepted(where.confidence, narrow) : false;
  const inWindow = (line) => (w ? line >= w.offset && line <= w.offset + w.limit - 1 : null);

  const rec = {
    file, staleGoal: stale.id, staleTrueLine: stale.line, target: target.id, targetTrueLine: target.line,
    conf: where?.confidence ?? null,
    accepted,                                  // l'hook avrebbe ristretto?
    picked, window: w,
    hitsStale: inWindow(stale.line),           // la finestra centra cio' che l'obiettivo CHIEDE
    hitsTarget: inWindow(target.line),         // la finestra centra cio' che la lettura SERVE
    totalLines: lines.length,
    inTok: r.usage.inputTokens, elapsedMs: r.elapsedMs,
  };
  results.push(rec);
  console.log(
    `${stale.id}->${target.id}  ${file.padEnd(20)} conf ${rec.conf?.toFixed(2)}  ` +
    `${accepted ? 'RESTRINGE' : 'rinuncia '}  centra l obiettivo ${String(rec.hitsStale).padEnd(5)}  centra cio che serve ${rec.hitsTarget}`,
  );
}

writeFileSync(OUT, JSON.stringify(results, null, 2));

// --- il verdetto ------------------------------------------------------------
const acc = results.filter((r) => r.accepted);
const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : 'n/a');
console.log('\n' + '='.repeat(70));
console.log('S1 — la finestra da obiettivo scaduto contiene cio che la lettura serve?');
console.log('='.repeat(70));
console.log(`  su tutte le coppie:            ${results.filter((r) => r.hitsTarget).length}/${results.length}  (${pct(results.filter((r) => r.hitsTarget).length, results.length)})`);
console.log(`  sulle sole dove avrebbe ristretto: ${acc.filter((r) => r.hitsTarget).length}/${acc.length}  (${pct(acc.filter((r) => r.hitsTarget).length, acc.length)})`);
const chance = results.length
  ? Math.round((results.reduce((s, r) => s + (r.window ? r.window.limit / r.totalLines : 0), 0) / results.length) * 100)
  : 0;
console.log(`  atteso per puro caso (la finestra e' questa quota del file): ~${chance}%`);

console.log('\n' + '='.repeat(70));
console.log('S2 — il pavimento di confidenza vede che l obiettivo e scaduto?');
console.log('='.repeat(70));
console.log(`  coppie in cui l hook AVREBBE RISTRETTO lo stesso: ${acc.length}/${results.length}  (${pct(acc.length, results.length)})`);
if (acc.length) {
  const cs = acc.map((r) => r.conf).sort((a, b) => a - b);
  console.log(`  confidenze in quei casi: min ${cs[0].toFixed(2)}  mediana ${cs[Math.floor(cs.length / 2)].toFixed(2)}  max ${cs[cs.length - 1].toFixed(2)}`);
  const bad = acc.filter((r) => !r.hitsTarget);
  console.log(`  di quelle, quante avrebbero NASCOSTO cio che serviva: ${bad.length}/${acc.length}`);
  if (bad.length) console.log(`  con confidenza fino a ${Math.max(...bad.map((r) => r.conf)).toFixed(2)}`);
}
console.log('\n  Il pavimento misura la sicurezza sul chunk, non la pertinenza dell obiettivo.');
console.log('  Se la colonna qui sopra e alta, quella distinzione non e accademica.');
