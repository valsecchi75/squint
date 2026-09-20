/**
 * adversarial-report.mjs — legge adversarial.jsonl e dice se il risultato ha retto.
 *
 * Le due previsioni sono in adversarial.mjs, scritte prima delle run:
 *   A1   invertendo l'ordine dei bracci il risparmio deve RESTARE;
 *   A2a  il placebo deve risparmiare quanto squint (comprime uguale);
 *   A2b  il placebo deve PERDERE le risposte.
 *
 * E una previsione numerica, calcolata prima delle run dalla geometria delle finestre:
 * il placebo centra il bersaglio 2 volte su 10 per puro caso, perche' la finestra e'
 * un quinto del file.
 *
 *   node bench/adversarial-report.mjs <adversarial.jsonl> [battery.jsonl]
 *
 * Il secondo argomento, se c'e', e' la batteria principale: serve a mettere il
 * risparmio con l'ordine invertito accanto a quello con l'ordine originale.
 */

import { readFileSync } from 'node:fs';

const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const main = process.argv[3]
  ? readFileSync(process.argv[3], 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  : [];

const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1)); };
const pct = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
const newTok = (r) => r.cache_create ?? 0;

const byArm = (arm) => rows.filter((r) => r.arm === arm);
const ids = [...new Set(rows.map((r) => r.id))];

/** Delta appaiato di `arm` contro `off`, sulla grandezza `pick`. */
function paired(arm, pick) {
  const ds = [];
  for (const id of ids) {
    const a = rows.find((r) => r.arm === arm && r.id === id);
    const o = rows.find((r) => r.arm === 'off' && r.id === id);
    if (!a || !o || !pick(o)) continue;
    ds.push(((pick(a) - pick(o)) / pick(o)) * 100);
  }
  const m = mean(ds), s = sd(ds);
  return { n: ds.length, m, s, nullo: s !== null && Math.abs(m) < s, dirs: new Set(ds.map(Math.sign)).size };
}

const line = (label, r) =>
  console.log('  ' + label.padEnd(30) +
    (r.n ? `${pct(r.m)} ${r.s === null ? '' : '±' + r.s.toFixed(1) + '%'}`.padStart(16) : 'n/a'.padStart(16)) +
    '   ' + (r.n ? (r.nullo ? 'NULLO' : `separa, ${(Math.abs(r.m) / r.s).toFixed(1)}x`) : ''));

console.log('='.repeat(78));
console.log('ATTACCO 1 — L\'ORDINE DEI BRACCI');
console.log('='.repeat(78));
console.log('  Qui `on` gira PRIMO e `off` secondo. Nella batteria principale era il contrario.');
console.log('  Se il risparmio fosse il vantaggio di correre secondo, qui deve sparire.\n');
const costRev = paired('on', (r) => r.cost_usd);
const tokRev = paired('on', newTok);
line('token nuovi, on contro off', tokRev);
line('costo, on contro off', costRev);

if (main.length) {
  const mp = [];
  for (const o of main.filter((r) => r.arm === 'off' && r.stratum === 'LARGE')) {
    const n = main.find((r) => r.arm === 'on' && r.id === o.id && r.rep === o.rep);
    if (!n || !o.cost_usd || !n.cost_usd || !(n.narrowings > 0)) continue;
    mp.push({ cost: ((n.cost_usd - o.cost_usd) / o.cost_usd) * 100, tok: ((newTok(n) - newTok(o)) / newTok(o)) * 100 });
  }
  const mc = mean(mp.map((p) => p.cost)), sc = sd(mp.map((p) => p.cost));
  const mt = mean(mp.map((p) => p.tok)), st = sd(mp.map((p) => p.tok));
  console.log('\n  per confronto, la batteria principale (ordine off -> on, solo dove l\'hook e\' scattato):');
  console.log('  ' + 'token nuovi'.padEnd(30) + `${pct(mt)} ±${st.toFixed(1)}%`.padStart(16) + `   n=${mp.length}`);
  console.log('  ' + 'costo'.padEnd(30) + `${pct(mc)} ±${sc.toFixed(1)}%`.padStart(16) + `   n=${mp.length}`);
  const survives = !costRev.nullo && Math.sign(costRev.m) === Math.sign(mc);
  console.log('\n  VERDETTO A1: ' + (survives
    ? 'il risparmio RESTA con l\'ordine invertito. Non e\' un artefatto dell\'ordine.'
    : 'il risparmio NON resta. Il risultato principale va ritirato.'));
}

console.log('\n' + '='.repeat(78));
console.log('ATTACCO 2 — IL PLACEBO: stessa compressione, nessuna intelligenza');
console.log('='.repeat(78));
const costPla = paired('placebo', (r) => r.cost_usd);
const tokPla = paired('placebo', newTok);
line('token nuovi, placebo vs off', tokPla);
line('costo, placebo vs off', costPla);

const q = (arm) => {
  const s = byArm(arm);
  return { ok: s.filter((r) => r.pass).length, n: s.length };
};
console.log('\n  RISPOSTE CORRETTE');
for (const arm of ['off', 'on', 'placebo']) {
  const x = q(arm);
  console.log('  ' + arm.padEnd(30) + `${x.ok}/${x.n}`.padStart(16) + (arm === 'placebo' ? '   previsione dalla geometria: 2/10 per caso' : ''));
}
const pl = q('placebo'), on = q('on');
console.log('\n  VERDETTO A2a (comprime uguale): ' + (!tokPla.nullo && Math.sign(tokPla.m) < 0
  ? 'si, il placebo taglia i token come squint.' : 'no, il placebo non comprime come atteso — il confronto non regge.'));
console.log('  VERDETTO A2b (perde le risposte): ' + (pl.ok < on.ok
  ? `si, ${pl.ok}/${pl.n} contro ${on.ok}/${on.n}. La finestra GIUSTA porta informazione, non solo la finestra CORTA.`
  : `NO: ${pl.ok}/${pl.n} contro ${on.ok}/${on.n}. Le domande erano rispondibili senza leggere il punto giusto, e la riga «nessuna risposta persa» non dimostra quello che sembra.`));

console.log('\n  dove ha guardato il placebo, e se il bersaglio c\'era dentro');
for (const r of byArm('placebo')) {
  const w = r.windows[0];
  console.log('  ' + r.id.padEnd(5) + (r.file ?? '').padEnd(20) +
    ('riga ' + r.trueLine).padStart(10) +
    (w ? `   finestra ${w.from}-${w.to}   ${r.recall ? 'DENTRO' : 'fuori'}` : '   nessuna finestra') +
    `   risposta ${r.pass ? 'giusta' : 'sbagliata'}`);
}

console.log('\ncoppia per coppia');
console.log('caso   off        on         placebo    | on vs off   placebo vs off');
for (const id of ids) {
  const g = (a) => rows.find((r) => r.arm === a && r.id === id);
  const [o, n, p] = ['off', 'on', 'placebo'].map(g);
  if (!o?.cost_usd) continue;
  const d = (x) => (x?.cost_usd ? pct(((x.cost_usd - o.cost_usd) / o.cost_usd) * 100) : 'n/a');
  console.log(id.padEnd(6) +
    ['off', 'on', 'placebo'].map((a) => ('$' + (g(a)?.cost_usd ?? 0).toFixed(4)).padEnd(11)).join('') +
    '| ' + d(n).padStart(9) + '   ' + d(p).padStart(13));
}
console.log(`\n${rows.length} run, spesa ACTUAL $${sum(rows.map((r) => r.cost_usd ?? 0)).toFixed(4)}.`);
