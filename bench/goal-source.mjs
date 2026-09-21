/**
 * goal-source.mjs — chi ha scritto il goal, e quanto era vecchio, a ogni Read reale.
 *
 * LA DOMANDA: quante volte, in una sessione vera, il messaggio che squint prenderebbe
 * come goal NON l'ha scritto l'utente? Un riassunto di compaction, il corpo di una skill
 * iniettata, una nota da un'altra sessione, una notifica di un subagent: arrivano tutti
 * col ruolo `user`. Il hook li punterebbe come se fossero una richiesta.
 *
 * METODO: replay offline. Legge OGNI transcript di Claude Code presente sulla macchina,
 * scorre le righe con LO STESSO fold che usa il hook (`foldGoal` / `finishGoal` da
 * dist/src/hook.js, non una copia) e, a ogni `tool_use` di Read senza offset/limit,
 * fotografa il goal che il hook avrebbe visto in quel momento. La riga assistant che
 * contiene il tool_use viene contata PRIMA della foto: nel transcript reale e' scritta
 * 70 ms prima che il hook scatti (misurato 2026-09-21 su una sessione della batteria).
 *
 * Nessuna chiamata, nessun costo, nessun dato personale in uscita: il JSON pubblicato
 * porta solo conteggi, categorie ed eta' in turni. Mai il testo, mai un percorso.
 *
 * Uso:  node bench/goal-source.mjs [docs/data/goal-source.json]
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIST = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'src');
const mod = (name) => import(pathToFileURL(join(DIST, name)).href);
const { emptyGoalState, foldGoal, finishGoal } = await mod('hook.js');
const { isExcludedPath } = await mod('ledger.js');
const { DEFAULT_CONFIG } = await mod('types.js');

const OUT = process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'docs', 'data', 'goal-source.json');
const base = join(homedir(), '.claude', 'projects');

/** Le stesse etichette che il ledger registra, piu' il dettaglio che il ledger non porta. */
function category(text, entry) {
  if (entry.isCompactSummary === true) return 'compaction-summary';
  if (entry.isMeta === true) {
    if (text.startsWith('Base directory for this skill')) return 'skill-body';
    if (text.startsWith('Another Claude session sent a message')) return 'other-session';
    if (text.startsWith('<local-command-caveat>')) return 'caveat';
    if (text.startsWith('[Image')) return 'image';
    return 'meta-other';
  }
  if (text.startsWith('<task-notification>')) return 'task-notification';
  if (text.startsWith('[Request interrupted')) return 'interrupted';
  return 'user';
}

/** Il file passerebbe le porte di taglia oggi? `null` se non esiste piu'. */
function eligibleNow(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const bytes = statSync(filePath).size;
    if (bytes > DEFAULT_CONFIG.maxBytes) return false;
    const lines = readFileSync(filePath, 'utf8').split('\n').length;
    return lines >= DEFAULT_CONFIG.minLines;
  } catch {
    return null;
  }
}

const opportunities = [];
let transcripts = 0;
for (const dir of readdirSync(base)) {
  const pdir = join(base, dir);
  let names;
  try { names = readdirSync(pdir); } catch { continue; }
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    transcripts += 1;
    const state = emptyGoalState();
    // La categoria del messaggio che ha fornito il testo: la stessa cosa che `source`
    // dice in due valori, tenuta a grana fine per la tabella.
    let lastCategory = 'none';
    let raw;
    try { raw = readFileSync(join(pdir, name), 'utf8'); } catch { continue; }
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      const before = state.last;
      foldGoal(state, o);
      if (o.type === 'user' && state.last !== before) lastCategory = category(state.last, o);
      if (o.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
      for (const c of o.message.content) {
        if (c.type !== 'tool_use' || c.name !== 'Read') continue;
        const input = c.input ?? {};
        if (input.offset !== undefined || input.limit !== undefined) continue;
        const filePath = String(input.file_path ?? '');
        if (filePath === '' || isExcludedPath(filePath)) continue;
        const goal = finishGoal(state);
        opportunities.push({
          sidechain: o.isSidechain === true,
          source: goal.source,
          category: goal.text === '' ? 'empty-after-cut' : lastCategory,
          ageTurns: goal.ageTurns,
          goalChars: goal.text.length,
          eligibleNow: eligibleNow(filePath),
        });
      }
    }
  }
}

const count = (rows, f) => rows.reduce((acc, r) => { const k = f(r); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
const pct = (n, d) => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length === 0 ? null : s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

const usable = opportunities.filter((r) => r.goalChars >= DEFAULT_CONFIG.minGoalChars);
const eligible = usable.filter((r) => r.eligibleNow === true);
const summary = {
  measuredOn: new Date().toISOString().slice(0, 10),
  transcripts,
  readsWithoutWindow: opportunities.length,
  ofWhichGoalUsable: usable.length,
  ofWhichFileEligibleToday: eligible.length,
  bySource: { all: count(usable, (r) => r.source), eligibleToday: count(eligible, (r) => r.source) },
  byCategory: { all: count(usable, (r) => r.category), eligibleToday: count(eligible, (r) => r.category) },
  ageTurns: {
    all: { p50: quantile(usable.map((r) => r.ageTurns), 0.5), p90: quantile(usable.map((r) => r.ageTurns), 0.9), p99: quantile(usable.map((r) => r.ageTurns), 0.99), max: Math.max(0, ...usable.map((r) => r.ageTurns)) },
    eligibleToday: { p50: quantile(eligible.map((r) => r.ageTurns), 0.5), p90: quantile(eligible.map((r) => r.ageTurns), 0.9), p99: quantile(eligible.map((r) => r.ageTurns), 0.99), max: Math.max(0, ...eligible.map((r) => r.ageTurns)) },
    histogram: count(usable, (r) => (r.ageTurns === 0 ? '0' : r.ageTurns <= 5 ? '1-5' : r.ageTurns <= 20 ? '6-20' : r.ageTurns <= 50 ? '21-50' : '>50')),
  },
  emptyAfterCut: opportunities.length - usable.length,
};

console.log(`transcript letti                         ${transcripts}`);
console.log(`Read senza finestra esplicita            ${opportunities.length}`);
console.log(`  con un goal usabile (>= ${DEFAULT_CONFIG.minGoalChars} caratteri)  ${usable.length}`);
console.log(`  di cui il file passa le porte OGGI     ${eligible.length}`);
console.log('');
console.log('chi ha scritto il goal (goal usabile):');
for (const [k, v] of Object.entries(summary.byCategory.all).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${pct(v, usable.length).padStart(6)}  ${k}`);
console.log(`  -> system: ${summary.bySource.all.system ?? 0} / ${usable.length} (${pct(summary.bySource.all.system ?? 0, usable.length)})`);
console.log('');
console.log('sul sottoinsieme il cui file passa le porte oggi:');
for (const [k, v] of Object.entries(summary.byCategory.eligibleToday).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${pct(v, eligible.length).padStart(6)}  ${k}`);
console.log(`  -> system: ${summary.bySource.eligibleToday.system ?? 0} / ${eligible.length} (${pct(summary.bySource.eligibleToday.system ?? 0, eligible.length)})`);
console.log('');
console.log(`eta' del goal in turni assistant (goal usabile): p50 ${summary.ageTurns.all.p50} · p90 ${summary.ageTurns.all.p90} · p99 ${summary.ageTurns.all.p99} · max ${summary.ageTurns.all.max}`);
console.log(`  istogramma: ${JSON.stringify(summary.ageTurns.histogram)}`);
console.log(`  sul sottoinsieme eleggibile oggi: p50 ${summary.ageTurns.eligibleToday.p50} · p90 ${summary.ageTurns.eligibleToday.p90} · max ${summary.ageTurns.eligibleToday.max}`);

writeFileSync(OUT, JSON.stringify(summary, null, 2) + '\n');
console.log(`\nscritto ${OUT}`);
