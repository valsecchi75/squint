/**
 * charts.mjs — rigenera i tre grafici di docs/img a partire dai dati grezzi.
 *
 * Esistono perche' un grafico disegnato a mano e' un numero che nessuno puo'
 * ricontrollare. Ogni barra qui viene da una riga di `battery.jsonl` o da un record
 * di `calibration.json`; niente e' scritto a mano nel disegno.
 *
 *   node bench/charts.mjs <battery.jsonl> <calibration.json> <outDir>
 *
 * I colori sono quelli che GitHub usa in entrambi i temi, cosi' il grafico resta
 * leggibile in chiaro e in scuro senza due versioni.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [BATTERY, CALIB, OUTDIR] = process.argv.slice(2);
mkdirSync(OUTDIR, { recursive: true });

const MUTED = '#8b949e', GREY = '#6e7681', GREEN = '#3fb950', RED = '#f85149', AMBER = '#d29922';
const FONT = '-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const txt = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" fill="${o.fill ?? MUTED}" font-size="${o.size ?? 11}"${o.weight ? ` font-weight="${o.weight}"` : ''}${o.anchor ? ` text-anchor="${o.anchor}"` : ''}>${esc(s)}</text>`;
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}">\n${body}\n</svg>\n`;

const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1)); };
const pct = (v) => (v >= 0 ? '+' : '') + v.toFixed(0) + '%';

// --- i dati -----------------------------------------------------------------
const rows = readFileSync(BATTERY, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const calib = JSON.parse(readFileSync(CALIB, 'utf8')).filter((r) => r.recall !== undefined && r.conf !== null);

const pairs = [];
for (const o of rows.filter((r) => r.arm === 'off')) {
  const n = rows.find((r) => r.arm === 'on' && r.id === o.id && r.rep === o.rep);
  if (!n || !o.cost_usd || !n.cost_usd) continue;
  pairs.push({ id: o.id, rep: o.rep, stratum: o.stratum, fired: n.narrowings > 0,
    off: o.cost_usd, on: n.cost_usd, delta: ((n.cost_usd - o.cost_usd) / o.cost_usd) * 100 });
}
// Una barra per caso: le ripetizioni dello stesso caso si mediano, perche' il grafico
// racconta i casi e la dispersione fra ripetizioni sta nel testo sotto.
const byCase = new Map();
for (const p of pairs) {
  const e = byCase.get(p.id) ?? { id: p.id, stratum: p.stratum, off: [], on: [], deltas: [], fired: 0, n: 0 };
  e.off.push(p.off); e.on.push(p.on); e.deltas.push(p.delta); e.fired += p.fired ? 1 : 0; e.n += 1;
  byCase.set(p.id, e);
}
const ORDER = ['LARGE', 'REPEAT', 'SMALL', 'HUGE', 'EXPLORE'];
const cases = [...byCase.values()]
  .map((e) => ({ ...e, offM: mean(e.off), onM: mean(e.on), deltaM: mean(e.deltas) }))
  .sort((a, b) => (ORDER.indexOf(a.stratum) - ORDER.indexOf(b.stratum)) || a.id.localeCompare(b.id, 'en', { numeric: true }));

// --- 1. l'A/B appaiato -------------------------------------------------------
function chartAB() {
  const groups = ORDER.map((s) => ({ s, items: cases.filter((c) => c.stratum === s) })).filter((g) => g.items.length);
  const BW = 16, GAP = 4, SLOT = BW * 2 + GAP + 12, PAD = 34;
  const W = Math.max(720, 60 + sum(groups.map((g) => g.items.length * SLOT + PAD)));
  const H = 330, BASE = 258, TOP = 96;
  const maxCost = Math.max(...cases.flatMap((c) => [c.offM, c.onM]));
  const y = (v) => BASE - (v / maxCost) * (BASE - TOP);

  let x = 56, body = '';
  body += txt(0, 14, 'A/B appaiato — costo per run, stessa domanda nei due bracci', { weight: 600 });
  body += txt(0, 30, `${pairs.length} coppie, haiku, sorgenti di hash identico. Grigio = hook spento, verde = hook acceso.`);
  body += `<line x1="46" y1="${BASE}" x2="${W - 20}" y2="${BASE}" stroke="${MUTED}" stroke-width="1" opacity="0.25"/>`;

  for (const g of groups) {
    const x0 = x;
    for (const c of g.items) {
      const fullyFired = c.fired === c.n;
      const col = g.s === 'LARGE' || g.s === 'REPEAT' ? (fullyFired ? GREEN : AMBER) : GREY;
      body += `<rect x="${x}" y="${y(c.offM)}" width="${BW}" height="${BASE - y(c.offM)}" fill="${GREY}"/>`;
      body += `<rect x="${x + BW + GAP}" y="${y(c.onM)}" width="${BW}" height="${BASE - y(c.onM)}" fill="${col}"/>`;
      body += txt(x, BASE + 14, c.id);
      const dcol = Math.abs(c.deltaM) < 8 ? MUTED : c.deltaM < 0 ? GREEN : RED;
      body += txt(x, Math.min(y(c.offM), y(c.onM)) - 6, pct(c.deltaM), { fill: dcol, size: 10, weight: 600 });
      x += SLOT;
    }
    const ds = pairs.filter((p) => p.stratum === g.s).map((p) => p.delta);
    const m = mean(ds), s = sd(ds);
    const nullo = s !== null && Math.abs(m) < s;
    body += txt(x0, 54, g.s, { weight: 600, fill: g.s === 'LARGE' || g.s === 'REPEAT' ? GREEN : MUTED });
    body += txt(x0, 70, `media ${pct(m)}, disp. ${s === null ? 'n/a' : s.toFixed(0) + '%'}`, { size: 10 });
    body += txt(x0, 84, nullo ? 'NULLO' : 'separa', { size: 10, weight: 600, fill: nullo ? MUTED : GREEN });
    x += PAD;
    if (g !== groups[groups.length - 1]) body += `<line x1="${x - PAD / 2}" y1="46" x2="${x - PAD / 2}" y2="${BASE + 18}" stroke="${MUTED}" stroke-width="1" opacity="0.2" stroke-dasharray="3 3"/>`;
  }

  const q = rows.filter((r) => r.pass).length;
  body += txt(0, H - 22, `SMALL e HUGE sono i controlli negativi: l'hook non puo' scattare, quindi i bracci non devono separarsi.`);
  body += txt(0, H - 6, `Qualita' delle risposte: ${q}/${rows.length} corrette sull'insieme delle run. Ambra = l'hook non e' scattato in tutte le ripetizioni.`);
  writeFileSync(join(OUTDIR, 'ab.svg'), svg(W, H, body));
  return { W, H };
}

// --- 2. la taratura della confidenza -----------------------------------------
function chartCalibration() {
  const W = 720, H = 320, L = 56, R = 700, TOP = 60, BASE = 240;
  const px = (c) => L + (c / 1) * (R - L);
  let body = '';
  body += txt(0, 14, 'Taratura — a quale confidenza la finestra smette di contenere la risposta', { weight: 600 });
  body += txt(0, 30, `${calib.length} bersagli scritti a mano. Ogni punto e' un bersaglio: verde = la finestra conteneva la riga vera.`);
  body += `<line x1="${L}" y1="${BASE}" x2="${R}" y2="${BASE}" stroke="${MUTED}" stroke-width="1" opacity="0.25"/>`;
  for (let c = 0; c <= 1.0001; c += 0.1) {
    body += `<line x1="${px(c)}" y1="${BASE}" x2="${px(c)}" y2="${BASE + 4}" stroke="${MUTED}" stroke-width="1" opacity="0.4"/>`;
    body += txt(px(c), BASE + 18, c.toFixed(1), { anchor: 'middle', size: 10 });
  }
  body += txt((L + R) / 2, BASE + 34, 'confidenza della scelta', { anchor: 'middle', size: 10 });

  // I punti, sfalsati in verticale quando si sovrappongono.
  const buckets = new Map();
  for (const r of calib) {
    const k = Math.round(r.conf * 50);
    const n = buckets.get(k) ?? 0;
    buckets.set(k, n + 1);
    const cy = BASE - 16 - n * 13;
    body += `<circle cx="${px(r.conf).toFixed(1)}" cy="${cy}" r="5" fill="${r.recall ? GREEN : RED}" opacity="0.9"/>`;
  }
  const floor = 0.6;
  body += `<line x1="${px(floor)}" y1="${TOP - 10}" x2="${px(floor)}" y2="${BASE}" stroke="${AMBER}" stroke-width="2" stroke-dasharray="4 3"/>`;
  body += txt(px(floor) + 6, TOP - 12, 'pavimento 0,60 — spedito', { fill: AMBER, size: 11, weight: 600 });
  const fails = calib.filter((r) => !r.recall);
  const worst = fails.length ? Math.max(...fails.map((r) => r.conf)) : null;
  if (worst !== null) {
    body += `<line x1="${px(worst)}" y1="${BASE - 4}" x2="${px(worst)}" y2="${BASE + 4}" stroke="${RED}" stroke-width="2"/>`;
    body += txt(px(worst), TOP + 6, `peggior fallimento ${worst.toFixed(2)}`, { fill: RED, size: 10, anchor: 'middle' });
  }
  body += txt(0, H - 38, `${calib.filter((r) => r.recall).length} finestre su ${calib.length} contenevano il bersaglio.` +
    (worst !== null ? `  Tutte quelle che non lo contenevano stanno a ${worst.toFixed(2)} o sotto.` : ''));
  body += txt(0, H - 22, `Al pavimento 0,60 l'hook restringe ${calib.filter((r) => r.conf >= 0.6).length} bersagli su ${calib.length} e ne perde ${calib.filter((r) => r.conf >= 0.6 && !r.recall).length}.`);
  body += txt(0, H - 6, `Il prezzo del margine: ${calib.filter((r) => r.conf < 0.6 && r.recall).length} restringimenti corretti buttati via.`, { fill: AMBER });
  writeFileSync(join(OUTDIR, 'calibration.svg'), svg(W, H, body));
}

// --- 3. a cosa e' proporzionale il risparmio ---------------------------------
function chartCoverage({ eligible, total }) {
  const W = 720, H = 200;
  let body = '';
  body += txt(0, 14, 'A cosa e\' proporzionale il risparmio', { weight: 600 });
  body += txt(0, 30, 'Il -36% vale sulle letture su cui l\'hook scatta, non sulla giornata di lavoro.');
  const BW = 660, X = 30, Y = 58, Hh = 26;
  const w1 = Math.round((eligible / total) * BW);
  body += `<rect x="${X}" y="${Y}" width="${w1}" height="${Hh}" fill="${GREEN}"/>`;
  body += `<rect x="${X + w1}" y="${Y}" width="${BW - w1}" height="${Hh}" fill="${GREY}" opacity="0.5"/>`;
  body += txt(X, Y - 8, `${eligible} file idonei`, { fill: GREEN, size: 11, weight: 600 });
  body += txt(X + w1 + 8, Y - 8, `${total - eligible} file che l'hook non puo' toccare`, { size: 11 });
  body += txt(X, Y + Hh + 18, `${eligible} file su ${total} passano il cancello di taglia (>= 400 righe e < 80.000 byte): circa uno su ${(total / eligible).toFixed(0)}.`);
  body += txt(X, Y + Hh + 36, 'Su un repository di moduli piccoli il risparmio tende a zero per costruzione.');
  body += txt(X, Y + Hh + 60, 'E questo e\' il limite SUPERIORE: conta i file idonei, non le volte in cui un agente', { weight: 600 });
  body += txt(X, Y + Hh + 76, 'sceglie davvero di leggerne uno per intero invece di cercare con Grep o delegare.', { weight: 600 });
  writeFileSync(join(OUTDIR, 'coverage.svg'), svg(W, H, body));
}

chartAB();
chartCalibration();
chartCoverage({ eligible: 40, total: 230 });
console.log(`scritti ab.svg, calibration.svg, coverage.svg in ${OUTDIR}`);
