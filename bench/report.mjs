// report.mjs — la decomposizione che conta: l'effetto DOVE l'hook e' scattato,
// separato da quello dove non e' scattato. Aggregarli mescola due popolazioni diverse
// e produce una media che non descrive nessuna delle due.
//
// La regola del nullo e' preregistrata in run.mjs e applicata qui senza eccezioni:
// se la media dei delta appaiati e' minore della loro deviazione standard, il
// risultato e' NULLO e viene stampato come nullo.
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const sum = a => a.reduce((x, y) => x + y, 0);
const mean = a => (a.length ? sum(a) / a.length : null);
const sd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map(v => (v - m) ** 2)) / (a.length - 1)); };
const pct = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

const pairs = [];
for (const o of rows.filter(r => r.arm === 'off')) {
  const n = rows.find(r => r.arm === 'on' && r.id === o.id && r.rep === o.rep);
  if (!n || !o.cost_usd || !n.cost_usd) continue;
  pairs.push({ id: o.id, rep: o.rep, stratum: o.stratum, fired: n.narrowings > 0,
    delta: ((n.cost_usd - o.cost_usd) / o.cost_usd) * 100,
    offCost: o.cost_usd, onCost: n.cost_usd, offPass: o.pass, onPass: n.pass, recall: n.recall,
    onReads: (n.tools?.Read ?? 0), offReads: (o.tools?.Read ?? 0),
    onRereads: n.rereadCount ?? 0, offRereads: o.rereadCount ?? 0,
    jevCalls: n.jevCalls ?? 0, jevTok: n.jevInputTokens ?? 0, reasons: n.reasons ?? {} });
}

const show = (label, sel) => {
  const ds = sel.map(p => p.delta);
  const m = mean(ds), s = sd(ds);
  console.log('\n' + label);
  console.log('  n coppie: ' + ds.length);
  if (!ds.length) return;
  console.log('  delta medio: ' + pct(m) + '   dispersione: ' + (s === null ? 'n/a' : s.toFixed(1) + '%'));
  if (s !== null) {
    console.log('  ' + (Math.abs(m) < s ? 'VERDETTO: NULLO (differenza sotto la dispersione)'
      : 'VERDETTO: separa, effetto ' + (Math.abs(m) / s).toFixed(1) + 'x la dispersione'));
    const versi = new Set(ds.map(Math.sign));
    console.log('  coppie nello stesso verso: ' + (versi.size === 1 ? 'tutte' : 'no (' + versi.size + ' versi)'));
  }
  const q = k => sel.filter(p => p[k]).length + '/' + sel.length;
  console.log('  qualita: OFF ' + q('offPass') + '   ON ' + q('onPass'));
  const rec = sel.filter(p => p.recall !== null);
  if (rec.length) console.log('  recall (la finestra conteneva la riga vera): ' + rec.filter(p => p.recall).length + '/' + rec.length);
};

console.log('='.repeat(72));
console.log('DECOMPOSIZIONE PER ESITO DELL\'HOOK');
console.log('='.repeat(72));
const of = s => pairs.filter(p => p.stratum === s);
const large = of('LARGE'), small = of('SMALL'), huge = of('HUGE'), explore = of('EXPLORE'), repeat = of('REPEAT');
show('[1] LARGE, hook SCATTATO — la popolazione che il meccanismo descrive', large.filter(p => p.fired));
show('[2] LARGE, hook NON scattato — stessi file, chiamata fallita o rifiutata', large.filter(p => !p.fired));
show('[3] LARGE, tutto insieme — mescola le due popolazioni sopra', large);
show('[4] SMALL — CONTROLLO NEGATIVO: sotto le 400 righe l\'hook non puo\' scattare', small);
show('[5] HUGE — CONTROLLO NEGATIVO: sopra gli 80.000 byte l\'hook deve RIFIUTARE', huge);
show('[6] REPEAT — due bersagli distanti nello stesso file, una sola sessione', repeat);
show('[7] EXPLORE — compito aperto, tool liberi', explore);

console.log('\n' + '='.repeat(72));
console.log('TASSO DI SCATTO — quante volte l\'hook ha davvero ristretto');
console.log('='.repeat(72));
const rate = (label, sel, expect) => {
  if (!sel.length) return;
  console.log('  ' + label.padEnd(44) + sel.filter(p => p.fired).length + '/' + sel.length + (expect ? '   ' + expect : ''));
};
rate('LARGE (file idonei)', large);
rate('SMALL (sotto il pavimento di righe)', small, '(deve essere 0)');
rate('HUGE (sopra il tetto di byte)', huge, '(deve essere 0)');
rate('REPEAT (file idonei, due bersagli)', repeat);
rate('EXPLORE (compito aperto, nessun file indicato)', explore);

if (explore.length) {
  console.log('\n' + '='.repeat(72));
  console.log('EXPLORE — cosa ha fatto davvero l\'agente');
  console.log('='.repeat(72));
  console.log('  La domanda di questo strato non e\' il risparmio ma se una lettura');
  console.log('  IDONEA avvenga mai. Gli strumenti che ha scelto sono la risposta.');
  for (const arm of ['off', 'on']) {
    const rs = rows.filter(r => r.stratum === 'EXPLORE' && r.arm === arm);
    const tot = {};
    for (const r of rs) for (const [t, n] of Object.entries(r.tools ?? {})) tot[t] = (tot[t] || 0) + n;
    console.log('  ' + arm.toUpperCase().padEnd(4) + ' ' + rs.length + ' run   tool: ' +
      (Object.keys(tot).length ? Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([t, n]) => t + '×' + n).join(', ') : 'nessuno'));
  }
  const onRows = rows.filter(r => r.stratum === 'EXPLORE' && r.arm === 'on');
  const looked = sum(onRows.map(r => r.ledgerRows ?? 0));
  console.log('  Read che l\'hook ha guardato (braccio ON, dal mastro): ' + looked);
  const why = {};
  for (const r of onRows) for (const [k, v] of Object.entries(r.reasons ?? {})) why[k] = (why[k] || 0) + v;
  console.log('  perche\' non ha ristretto: ' + (Object.keys(why).length ? Object.entries(why).map(([k, v]) => k + '×' + v).join(', ') : 'n/a'));
  console.log('  restringimenti: ' + sum(onRows.map(r => r.narrowings ?? 0)));
}

if (repeat.length) {
  console.log('\n' + '='.repeat(72));
  console.log('REPEAT — quanto vale una cache della decisione (bersaglio di O1)');
  console.log('='.repeat(72));
  const rr = rows.filter(r => r.stratum === 'REPEAT');
  for (const arm of ['off', 'on']) {
    const rs = rr.filter(r => r.arm === arm);
    console.log('  ' + arm.toUpperCase().padEnd(4) +
      ' Read totali ' + String(sum(rs.map(r => r.tools?.Read ?? 0))).padStart(3) +
      '   riletture dello stesso file ' + String(sum(rs.map(r => r.rereadCount ?? 0))).padStart(3) +
      '   chiamate a Jev ' + String(sum(rs.map(r => r.jevCalls ?? 0))).padStart(3) +
      '   token in ingresso a Jev ' + sum(rs.map(r => r.jevInputTokens ?? 0)).toLocaleString('it-IT'));
  }
  // La grandezza giusta NON e' il numero di riletture: e' il numero di chiamate a Jev
  // che una sessione ha pagato DUE volte. Una rilettura con offset esplicito passa con
  // `agent-set-window` e non chiama nessuno, quindi contarla come occasione di cache
  // sopravvaluta il bersaglio. Questa riga ha detto «al massimo N» finche' non e' stato
  // misurato che N vero e' un altro numero.
  const onAll = rows.filter(r => r.arm === 'on');
  const multi = onAll.filter(r => (r.jevCalls ?? 0) > 1);
  const dup = sum(multi.map(r => r.jevCalls - 1));
  const reread = sum(rr.filter(r => r.arm === 'on').map(r => r.rereadCount ?? 0));
  const asw = sum(onAll.map(r => r.reasons?.['agent-set-window'] ?? 0));
  console.log('  sessioni ON con piu di una chiamata a Jev: ' + multi.length + '/' + onAll.length);
  console.log('  chiamate che una cache eliminerebbe: ' + dup);
  console.log('  riletture dello stesso file in REPEAT: ' + reread +
    '   Read passati come agent-set-window (tutta la batteria): ' + asw);
  console.log('  La rilettura arriva con un offset esplicito, e squint la lascia stare senza chiamare:');
  console.log('  la via di fuga scritta nella nota previene gia\' la chiamata che la cache dovrebbe togliere.');
}

console.log('\n' + '='.repeat(72));
console.log('COPPIA PER COPPIA');
console.log('='.repeat(72));
console.log('caso rep strato   scatto  jev  OFF       ON        delta');
for (const p of pairs) {
  console.log([p.id.padEnd(4), String(p.rep), p.stratum.padEnd(7), (p.fired ? 'si ' : 'no ').padEnd(7),
    String(p.jevCalls).padStart(3),
    ('$' + p.offCost.toFixed(4)).padStart(9), ('$' + p.onCost.toFixed(4)).padStart(9), pct(p.delta).padStart(8)].join(' '));
}

const spent = sum(rows.map(r => r.cost_usd ?? 0));
console.log('\nspesa: $' + spent.toFixed(4) + ' ACTUAL su ' + rows.length + ' run' +
  (rows.length ? '   ($' + (spent / rows.length).toFixed(4) + ' per run)' : ''));
const missing = rows.filter(r => r.cost_usd === null || r.exit !== 0);
if (missing.length) console.log('run senza costo o con uscita non nulla: ' + missing.length + ' — ' + missing.map(r => r.id + '/' + r.arm).join(', '));
