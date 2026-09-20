/**
 * table.mjs — la tabella che interessa a chi usa squint, non a chi lo sviluppa.
 *
 * Quattro grandezze e basta: token, soldi, tempo, e la percentuale fra i due bracci.
 *
 *   node bench/table.mjs <battery.jsonl> [--md]
 *
 * TRE REGOLE, tutte preregistrate in run.mjs e applicate qui senza eccezioni.
 *
 * 1. La percentuale e' APPAIATA. Si calcola il delta caso per caso e poi se ne fa la
 *    media, non il rapporto fra due medie: la seconda cosa lascia che un caso costoso
 *    domini il risultato.
 * 2. Accanto alla differenza c'e' sempre la dispersione. Se la media dei delta e'
 *    minore della loro deviazione standard, la riga dice NULLO.
 * 3. I token di Jev stanno nella tabella. squint sposta il costo, non lo cancella: i
 *    token che Claude non legge li legge Jev, e una tabella che mostrasse solo il lato
 *    risparmiato sarebbe pubblicita'.
 */

import { readFileSync } from 'node:fs';

const rows = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const MD = process.argv.includes('--md');

const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1)); };

/**
 * I token NUOVI che entrano nel modello. E' questa la grandezza che squint puo'
 * muovere, ed e' l'unica onesta da mettere in cima alla tabella.
 *
 * MISURATO, e vale la pena scriverlo perche' la prima versione di questo file
 * sbagliava: sommare `cache_creation` e `cache_read` produce un risultato NULLO anche
 * dove il meccanismo funziona benissimo. `cache_read` e' il prompt di sistema servito
 * dalla cache - 58.395 token, identici nei due bracci - e in due run su otto si
 * moltiplica perche' la sessione ha fatto piu' giri, cosa che col file letto non ha
 * niente a che vedere. Quella costante e quel rumore seppelliscono il segnale.
 * `cache_creation` invece e' il contenuto mai visto prima, cioe' il file: li' il
 * restringimento si vede in ogni singola coppia.
 */
const newTok = (r) => r.cache_create ?? 0;
const cachedTok = (r) => r.cache_read ?? 0;

const pairs = [];
for (const o of rows.filter((r) => r.arm === 'off')) {
  const n = rows.find((r) => r.arm === 'on' && r.id === o.id && r.rep === o.rep);
  if (!n || !o.cost_usd || !n.cost_usd) continue;
  pairs.push({
    id: o.id, rep: o.rep, stratum: o.stratum, fired: n.narrowings > 0,
    off: { newTok: newTok(o), cachedTok: cachedTok(o), outTok: o.out_tok ?? 0, cost: o.cost_usd, ms: o.ms, pass: o.pass },
    on: { newTok: newTok(n), cachedTok: cachedTok(n), outTok: n.out_tok ?? 0, cost: n.cost_usd, ms: n.ms, pass: n.pass },
    jevTok: n.jevInputTokens ?? 0, jevCalls: n.jevCalls ?? 0,
  });
}

const it = (v) => Math.round(v).toLocaleString('it-IT');
const usd = (v) => '$' + v.toFixed(4);
const sec = (v) => (v / 1000).toFixed(1) + ' s';

/** Il delta appaiato di una grandezza, con la sua dispersione e il verdetto. */
function delta(sel, pick) {
  const ds = sel.map((p) => ((pick(p.on) - pick(p.off)) / pick(p.off)) * 100).filter(Number.isFinite);
  if (!ds.length) return { text: 'n/a', nullo: true };
  const m = mean(ds), s = sd(ds);
  const sign = m >= 0 ? '+' : '';
  if (s === null) return { text: `${sign}${m.toFixed(1)}%`, nullo: true, note: 'una sola coppia' };
  const nullo = Math.abs(m) < s;
  return {
    text: `${sign}${m.toFixed(1)}%`,
    spread: `±${s.toFixed(1)}%`,
    nullo,
    verdict: nullo ? 'NULLO — la differenza sta sotto la dispersione' : `separa, ${(Math.abs(m) / s).toFixed(1)}× la dispersione`,
  };
}

function block(title, sel, why) {
  if (!sel.length) return;
  const M = (arm, pick) => mean(sel.map((p) => pick(p[arm])));
  const lines = [
    ['token NUOVI letti', it(M('off', (x) => x.newTok)), it(M('on', (x) => x.newTok)), delta(sel, (x) => x.newTok)],
    ['token dalla cache', it(M('off', (x) => x.cachedTok)), it(M('on', (x) => x.cachedTok)), delta(sel, (x) => x.cachedTok)],
    ['token scritti', it(M('off', (x) => x.outTok)), it(M('on', (x) => x.outTok)), delta(sel, (x) => x.outTok)],
    ['costo', usd(M('off', (x) => x.cost)), usd(M('on', (x) => x.cost)), delta(sel, (x) => x.cost)],
    ['tempo', sec(M('off', (x) => x.ms)), sec(M('on', (x) => x.ms)), delta(sel, (x) => x.ms)],
  ];
  const jev = mean(sel.map((p) => p.jevTok));
  const calls = sum(sel.map((p) => p.jevCalls));
  const q = (arm) => sel.filter((p) => p[arm].pass).length + '/' + sel.length;

  if (MD) {
    console.log(`\n### ${title}\n`);
    if (why) console.log(why + '\n');
    console.log(`${sel.length} coppie.\n`);
    console.log('| per run | senza squint | con squint | differenza | verdetto |');
    console.log('|---|---:|---:|---:|---|');
    for (const [k, a, b, d] of lines) {
      console.log(`| ${k} | ${a} | ${b} | **${d.text}** ${d.spread ?? ''} | ${d.nullo ? '**nullo**' : 'separa'} |`);
    }
    console.log(`| token spesi a Jev | 0 | ${it(jev)} | — | ${calls} chiamate in ${sel.length} sessioni |`);
    console.log(`| risposte corrette | ${q('off')} | ${q('on')} | — | |`);
  } else {
    console.log('\n' + '='.repeat(78));
    console.log(title);
    if (why) console.log(why);
    console.log('='.repeat(78));
    console.log('  ' + `${sel.length} coppie`);
    console.log('  ' + 'per run'.padEnd(20) + 'senza squint'.padStart(14) + 'con squint'.padStart(14) + 'differenza'.padStart(14) + '   verdetto');
    for (const [k, a, b, d] of lines) {
      console.log('  ' + k.padEnd(20) + a.padStart(14) + b.padStart(14) +
        (d.text + ' ' + (d.spread ?? '')).padStart(14) + '   ' + (d.nullo ? 'NULLO' : 'separa'));
    }
    console.log('  ' + 'token a Jev'.padEnd(20) + '0'.padStart(14) + it(jev).padStart(14) + ''.padStart(14) + '   ' + calls + ' chiamate in ' + sel.length + ' sessioni');
    console.log('  ' + 'risposte corrette'.padEnd(20) + q('off').padStart(14) + q('on').padStart(14));
  }
}

const of = (s) => pairs.filter((p) => p.stratum === s);
const large = of('LARGE');

if (MD) console.log('# squint, acceso contro spento\n\nOgni cifra e\' ACTUAL: letta dalla risposta JSON di ogni sessione e dal libro mastro dell\'hook.');

block('LARGE, dove l\'hook e\' SCATTATO', large.filter((p) => p.fired),
  'File grandi, domanda su una cosa sola. E\' la situazione per cui squint esiste, ed e\' l\'unica riga che descrive il meccanismo.');
block('LARGE, dove l\'hook NON e\' scattato', large.filter((p) => !p.fired),
  'Stessi file, stessa domanda: l\'hook ha chiesto e ha rinunciato. Qui non deve cambiare niente.');
block('SMALL — controllo negativo', of('SMALL'),
  'Sotto le 400 righe l\'hook non puo\' scattare. Se qui i bracci si separassero, il risparmio su LARGE non sarebbe attribuibile al restringimento.');
block('HUGE — controllo negativo', of('HUGE'),
  'Sopra gli 80.000 byte l\'hook rifiuta per costruzione. Secondo controllo, su un cancello diverso.');
block('REPEAT — due bersagli distanti nello stesso file', of('REPEAT'),
  'Una domanda che nomina due cose lontane. Serve a vedere se la seconda lettura costa una seconda chiamata.');
block('EXPLORE — domanda aperta, nessun file indicato', of('EXPLORE'),
  'Nessun file nominato, tool di ricerca liberi, delega vietata. Qui la grandezza interessante non e\' il risparmio ma se l\'hook entri mai in gioco.');

// --- la riga che conta per chi deve decidere se installarlo -------------------
const fired = large.filter((p) => p.fired);
const eligible = large.length;
console.log('\n' + (MD ? '### Quanto spesso entra in gioco\n' : '='.repeat(78) + '\nQUANTO SPESSO ENTRA IN GIOCO\n' + '='.repeat(78)));
const rate = (label, sel) => sel.length && console.log((MD ? '- ' : '  ') + label.padEnd(52) + sel.filter((p) => p.fired).length + '/' + sel.length);
rate('file grandi, domanda su una cosa sola (LARGE)', large);
rate('due bersagli distanti nello stesso file (REPEAT)', of('REPEAT'));
rate('domanda aperta (EXPLORE)', of('EXPLORE'));
rate('file sotto le 400 righe (SMALL) — deve essere 0', of('SMALL'));
rate('file sopra gli 80.000 byte (HUGE) — deve essere 0', of('HUGE'));
if (fired.length && eligible) {
  const d = delta(fired, (x) => x.cost);
  console.log((MD ? '\n' : '\n  ') +
    `Il risparmio vale su ${fired.length} letture su ${eligible} idonee. Sulle altre non succede niente.`);
  console.log((MD ? '' : '  ') + `Dove scatta: ${d.text} ${d.spread ?? ''} sul costo.`);
}

const spent = sum(rows.map((r) => r.cost_usd ?? 0));
console.log(`\n${rows.length} run, spesa ACTUAL $${spent.toFixed(4)}.`);
