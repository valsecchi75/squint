// split-report.mjs — la decomposizione che conta: l'effetto DOVE l'hook e' scattato,
// separato da quello dove non e' scattato. Aggregarli mescola due popolazioni diverse
// e produce una media che non descrive nessuna delle due.
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
    offCost: o.cost_usd, onCost: n.cost_usd, offPass: o.pass, onPass: n.pass, recall: n.recall });
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
};

console.log('='.repeat(72));
console.log('DECOMPOSIZIONE PER ESITO DELL\'HOOK');
console.log('='.repeat(72));
const large = pairs.filter(p => p.stratum === 'LARGE');
const small = pairs.filter(p => p.stratum === 'SMALL');
show('[1] LARGE, hook SCATTATO — la popolazione che il meccanismo descrive', large.filter(p => p.fired));
show('[2] LARGE, hook NON scattato — stessi file, chiamata fallita o rifiutata', large.filter(p => !p.fired));
show('[3] LARGE, tutto insieme — mescola le due popolazioni sopra', large);
show('[4] SMALL — CONTROLLO NEGATIVO: l\'hook non puo\' scattare, i bracci non devono separarsi', small);

console.log('\n' + '='.repeat(72));
console.log('TASSO DI SCATTO');
console.log('='.repeat(72));
console.log('  su file idonei (LARGE): ' + large.filter(p => p.fired).length + '/' + large.length);
console.log('  su file non idonei (SMALL): ' + small.filter(p => p.fired).length + '/' + small.length + '  (deve essere 0)');

console.log('\ncoppia per coppia');
console.log('caso rep strato  scatto   OFF       ON        delta');
for (const p of pairs) {
  console.log([p.id, String(p.rep), p.stratum.padEnd(6), (p.fired ? 'si ' : 'no ').padEnd(7),
    ('$' + p.offCost.toFixed(4)).padStart(9), ('$' + p.onCost.toFixed(4)).padStart(9), pct(p.delta).padStart(8)].join(' '));
}
console.log('\nspesa: $' + sum(rows.map(r => r.cost_usd ?? 0)).toFixed(4) + ' ACTUAL su ' + rows.length + ' run');
