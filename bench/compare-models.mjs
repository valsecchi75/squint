/**
 * compare-models.mjs — lo stesso disegno, due modelli, affiancati.
 *
 *   node bench/compare-models.mjs <haiku.jsonl> <opus.jsonl>
 *
 * PERCHE'. I numeri di testata di questo progetto - token nuovi -47,5%, costo -36,8% -
 * vengono da `claude-haiku-4-5`. Il meccanismo e' model-independent in linea di
 * principio, perche' cambia cosa il tool restituisce e non cosa il modello decide, ma
 * la TAGLIA dell'effetto non lo e': un modello che legge diversamente, che decide
 * diversamente quando rileggere, o che ha un prompt di sistema di dimensione diversa,
 * puo' spostare il risultato in entrambi i versi.
 *
 * Questo script mette i due insiemi uno accanto all'altro sugli stessi identici casi,
 * con la stessa regola del nullo di sempre: se la media dei delta appaiati e' minore
 * della loro deviazione standard, il risultato e' nullo e si scrive nullo.
 *
 * LA RIGA CHE CONTA NON E' LA PRIMA. Il controllo negativo - i file sotto il pavimento,
 * dove l'hook non puo' agire - dice quanto rumore porta ciascun modello. Un effetto su
 * LARGE va letto contro il rumore di QUEL modello, non contro quello dell'altro.
 */

import { readFileSync } from 'node:fs';

const load = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const A = { name: 'haiku', rows: load(process.argv[2]) };
const B = { name: 'opus', rows: load(process.argv[3]) };

const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1)); };
const newTok = (r) => r.cache_create ?? 0;
const pc = (v) => (v === null ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1) + '%');

/** Le coppie di uno strato, opzionalmente solo quelle in cui l'hook ha scattato. */
function pairs(rows, stratum, firedOnly) {
  const out = [];
  for (const o of rows.filter((r) => r.arm === 'off' && r.stratum === stratum)) {
    const n = rows.find((r) => r.arm === 'on' && r.id === o.id && r.rep === o.rep);
    if (!n || !o.cost_usd || !n.cost_usd) continue;
    if (firedOnly && !(n.narrowings > 0)) continue;
    out.push({ off: o, on: n });
  }
  return out;
}

function delta(ps, pick) {
  const ds = ps.map((p) => ((pick(p.on) - pick(p.off)) / pick(p.off)) * 100).filter(Number.isFinite);
  if (!ds.length) return null;
  const m = mean(ds), s = sd(ds);
  return {
    n: ds.length, m, s,
    nullo: s === null ? true : Math.abs(m) < s,
    ratio: s ? Math.abs(m) / s : null,
    offMean: mean(ps.map((p) => pick(p.off))),
    onMean: mean(ps.map((p) => pick(p.on))),
    sameDirection: new Set(ds.map(Math.sign)).size <= 1,
  };
}

const show = (label, d) => {
  if (!d) { console.log('  ' + label.padEnd(22) + 'nessuna coppia'); return; }
  const verdict = d.nullo ? 'NULLO' : `separa ${d.ratio.toFixed(1)}×`;
  console.log('  ' + label.padEnd(22) + (pc(d.m) + (d.s === null ? '' : ' ±' + d.s.toFixed(1) + '%')).padStart(16)
    + '   ' + verdict.padEnd(12) + ' n=' + d.n + (d.sameDirection && d.n > 1 ? '  tutte nello stesso verso' : ''));
};

for (const M of [A, B]) {
  const fired = pairs(M.rows, 'LARGE', true);
  const all = pairs(M.rows, 'LARGE', false);
  const small = pairs(M.rows, 'SMALL', false);
  console.log('\n' + '='.repeat(78));
  console.log(`${M.name.toUpperCase()}  —  ${M.rows.length} run`);
  console.log('='.repeat(78));
  console.log(`  tasso di scatto su LARGE: ${all.filter((p) => p.on.narrowings > 0).length}/${all.length}` +
    `   su SMALL: ${small.filter((p) => p.on.narrowings > 0).length}/${small.length} (deve essere 0)`);
  console.log('\n  LARGE, dove l\'hook e\' SCATTATO');
  show('token nuovi', delta(fired, newTok));
  show('costo', delta(fired, (r) => r.cost_usd));
  show('tempo', delta(fired, (r) => r.ms));
  const q = (k) => fired.filter((p) => p[k].pass).length + '/' + fired.length;
  console.log('  ' + 'risposte corrette'.padEnd(22) + ('senza ' + q('off') + '  con ' + q('on')).padStart(16));
  const rec = fired.filter((p) => p.on.recall !== null);
  if (rec.length) console.log('  ' + 'bersaglio in finestra'.padEnd(22) + (rec.filter((p) => p.on.recall).length + '/' + rec.length).padStart(16));
  console.log('\n  SMALL — CONTROLLO NEGATIVO: il rumore di questo modello');
  show('token nuovi', delta(small, newTok));
  show('costo', delta(small, (r) => r.cost_usd));
  console.log('\n  ' + 'costo medio per run'.padEnd(22) + ('$' + (sum(M.rows.map((r) => r.cost_usd ?? 0)) / M.rows.length).toFixed(4)).padStart(16));
}

// --- il confronto vero e proprio ---------------------------------------------
console.log('\n' + '='.repeat(78));
console.log('L\'EFFETTO SI TRASFERISCE?');
console.log('='.repeat(78));
const rows = [
  ['token nuovi, dove scatta', (M) => delta(pairs(M.rows, 'LARGE', true), newTok)],
  ['costo, dove scatta', (M) => delta(pairs(M.rows, 'LARGE', true), (r) => r.cost_usd)],
  ['costo, controllo SMALL', (M) => delta(pairs(M.rows, 'SMALL', false), (r) => r.cost_usd)],
];
console.log('  ' + 'grandezza'.padEnd(26) + 'haiku'.padStart(18) + 'opus'.padStart(18));
for (const [label, f] of rows) {
  const a = f(A), b = f(B);
  const fmt = (d) => (!d ? '—' : pc(d.m) + ' ' + (d.nullo ? '(nullo)' : `(${d.ratio.toFixed(1)}×)`));
  console.log('  ' + label.padEnd(26) + fmt(a).padStart(18) + fmt(b).padStart(18));
}
const fa = delta(pairs(A.rows, 'LARGE', true), (r) => r.cost_usd);
const fb = delta(pairs(B.rows, 'LARGE', true), (r) => r.cost_usd);
console.log();
if (fa && fb && !fa.nullo && !fb.nullo && Math.sign(fa.m) === Math.sign(fb.m)) {
  console.log('  L\'effetto si trasferisce: separa su entrambi i modelli, nello stesso verso.');
  console.log(`  La TAGLIA cambia: ${pc(fa.m)} su haiku, ${pc(fb.m)} su opus.`);
} else {
  console.log('  NON si trasferisce allo stesso modo. Il numero pubblicato vale per il modello su cui e\' stato preso.');
}
console.log('\n  Il controllo negativo va letto per primo: dice quanto rumore porta ciascun');
console.log('  modello, e un effetto su LARGE vale solo se supera il rumore DI QUEL modello.');
