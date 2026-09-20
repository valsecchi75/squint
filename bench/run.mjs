/**
 * compare.mjs — la batteria comparativa del Read narrowing di JEF.
 *
 * PREREGISTRAZIONE (scritta prima di qualunque run a pagamento):
 *
 *   H1  Sullo strato LARGE il braccio ON costa meno del braccio OFF.
 *   H2  Sullo strato SMALL i due bracci NON si separano: l'hook non puo' scattare
 *       (file sotto le 400 righe) e quindi non deve ne' risparmiare ne' costare.
 *       Questo e' il CONTROLLO NEGATIVO: se ON e OFF si separassero qui, la
 *       differenza misurata su LARGE non sarebbe attribuibile al restringimento.
 *   H3  La qualita' non peggiora in nessuno strato.
 *
 *   Metrica primaria : delta di costo APPAIATO (stessa domanda, due bracci), in %.
 *   Unita' di analisi: la coppia, non la run.
 *   Cosa conta come NULLO: se la media dei delta appaiati e' minore della loro
 *       deviazione standard, il risultato e' NULLO e va scritto come nullo.
 *   Regola di arresto: il numero di ripetizioni e' fissato qui sotto e non si
 *       cambia dopo aver visto i dati.
 *   Ground truth: scritta a mano leggendo i file, mai chiesta a un modello.
 *
 * I bracci differiscono SOLO per .claude/settings.json. I sorgenti hanno hash
 * identico, verificato prima della prima run.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// The Claude Code binary. Override with CLAUDE_BIN when it is not on PATH.
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const WS = process.argv[2];   // directory holding the on/ and off/ arms
const OUT = process.argv[3];  // where to append the JSONL results
const STRATA = (process.argv[4] ?? 'LARGE,SMALL,EXPLORE').split(',');
const REPS = Number(process.argv[5] ?? 2);

// Forma imperativa, identica a quella gia' misurata negli A/B precedenti: spinge
// l'agente ad aprire il file invece di cercarlo. La prima esecuzione di questa
// batteria usava una forma interrogativa e l'agente, con il solo Read permesso,
// non riusciva a localizzare il file e rinunciava - la run e' stata fermata e
// rifatta, non corretta a posteriori.
const ask = (file, what) =>
  `Leggi il file src/${file} e dimmi il nome esatto della funzione che ${what}. Rispondi SOLO con il nome della funzione, nient altro.`;

/** Ogni caso porta la riga vera: serve a dire se la finestra l'ha contenuta. */
const CASES = [
  // --- LARGE: >= 400 righe e < 80 KB, l'hook PUO' scattare -------------------
  { id: 'A1', stratum: 'LARGE', file: 'report.ts', lines: 1307, truth: 'percentileNearestRank', line: 388,
    prompt: ask('report.ts', 'calcola un percentile senza interpolare fra due valori') },
  { id: 'A2', stratum: 'LARGE', file: 'report.ts', lines: 1307, truth: 'grouped', line: 912,
    prompt: ask('report.ts', 'aggiunge i separatori delle migliaia a un numero quando viene stampato') },
  { id: 'A3', stratum: 'LARGE', file: 'cli.ts', lines: 1040, truth: 'collectEvidence', line: 370,
    prompt: ask('cli.ts', 'raccoglie le evidenze deterministiche dagli argomenti della riga di comando') },
  { id: 'A4', stratum: 'LARGE', file: 'escalation.ts', lines: 507, truth: 'shouldEscalate', line: 188,
    prompt: ask('escalation.ts', 'decide se il task va portato a un tier superiore') },
  { id: 'A5', stratum: 'LARGE', file: 'pipeline.ts', lines: 629, truth: 'estimateContextAvoided', line: 337,
    prompt: ask('pipeline.ts', 'stima quanto contesto e stato evitato') },
  { id: 'A6', stratum: 'LARGE', file: 'install-settings.ts', lines: 737, truth: 'pruneEmptyHooks', line: 229,
    prompt: ask('install-settings.ts', 'toglie la mappa hooks quando resta vuota') },

  // --- SMALL: sotto le 400 righe, l'hook NON PUO' scattare (controllo) -------
  { id: 'B1', stratum: 'SMALL', file: 'typesafe-client.ts', lines: 313, truth: 'abortAfter', line: 223,
    prompt: ask('typesafe-client.ts', 'produce una promessa che scade dopo un timeout') },
  { id: 'B2', stratum: 'SMALL', file: 'load-config.ts', lines: 347, truth: 'normalizeConfig', line: 165,
    prompt: ask('load-config.ts', 'valida e normalizza la configurazione grezza') },
  { id: 'B3', stratum: 'SMALL', file: 'state-store.ts', lines: 365, truth: 'redactUnderKey', line: 73,
    prompt: ask('state-store.ts', 'oscura un valore in base al nome della chiave che lo contiene') },

  // --- EXPLORE: nessun file indicato, tool liberi, caso realistico -----------
  // La ground truth qui non e' un nome ma un INSIEME di cose che la risposta deve
  // contenere: un compito esplorativo non ha una risposta di una parola.
  { id: 'C1', stratum: 'EXPLORE', free: true, truth: null,
    must: [/model-router/i, /complexity/i, /risk/i],
    prompt: 'In questo progetto, quale modulo decide il tier di esecuzione e su quali grandezze si basa? Rispondi in massimo tre righe, nominando il file e le grandezze.' },
  { id: 'C2', stratum: 'EXPLORE', free: true, truth: null,
    must: [/sanitize/i, /(secrets|\.env)/i],
    prompt: 'In questo progetto, come si evita di mandare segreti al servizio esterno? Rispondi in massimo tre righe, nominando il file responsabile.' },
];

function transcriptFor(sid) {
  const base = join(process.env.USERPROFILE || '', '.claude', 'projects');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    const p = join(base, d, sid + '.jsonl');
    if (existsSync(p)) return p;
  }
  return null;
}

/** Quali tool ha usato, e se l'hook ha lasciato la sua traccia. */
function inspect(path) {
  if (!path || !existsSync(path)) return { tools: null, narrowings: 0, windows: [] };
  const tools = {};
  const windows = [];
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const c of o.message.content) if (c.type === 'tool_use') tools[c.name] = (tools[c.name] || 0) + 1;
    }
  }
  const re = /JEF narrowed this Read: (\S+) is (\d+) lines, showing (\d+)-(\d+) \(match at line (\d+), confidence ([\d.]+)\)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    windows.push({ file: m[1], total: +m[2], from: +m[3], to: +m[4], picked: +m[5], conf: +m[6] });
  }
  return { tools, narrowings: windows.length, windows };
}

function grade(c, answer) {
  if (c.truth !== null) return new RegExp('\\b' + c.truth + '\\b').test(answer);
  return c.must.every((re) => re.test(answer));
}

const selected = CASES.filter((c) => STRATA.includes(c.stratum));
console.error(`batteria: ${selected.length} casi x 2 bracci x ${REPS} ripetizioni = ${selected.length * 2 * REPS} run`);

for (let rep = 1; rep <= REPS; rep++) {
  for (const c of selected) {
    for (const arm of ['off', 'on']) {
      const cwd = join(WS, arm);
      const args = ['-p', c.prompt, '--model', 'haiku', '--output-format', 'json'];
      // Lo strato EXPLORE lascia liberi i tool di ricerca: e' il suo scopo.
      // Glob e' permesso anche negli strati mirati: senza, un percorso sbagliato al
      // primo tentativo diventa una rinuncia invece di una lettura. Vale per
      // ENTRAMBI i bracci, quindi non sposta il confronto.
      args.push('--allowedTools', c.free ? 'Read Grep Glob Bash' : 'Read Glob');
      const t0 = Date.now();
      const r = spawnSync(CLAUDE, args, { cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
      const ms = Date.now() - t0;
      let j = {};
      try { j = JSON.parse(r.stdout || '{}'); } catch { /* lasciato vuoto */ }
      const answer = (j.result || '').trim();
      const seen = j.session_id ? inspect(transcriptFor(j.session_id)) : { tools: null, narrowings: 0, windows: [] };
      // La finestra ha contenuto la riga vera? Solo dove una riga vera esiste.
      const recall = c.line && seen.windows.length > 0
        ? seen.windows.some((w) => c.line >= w.from && c.line <= w.to)
        : null;
      const rec = {
        rep, id: c.id, stratum: c.stratum, arm,
        file: c.file ?? null, fileLines: c.lines ?? null, trueLine: c.line ?? null,
        pass: grade(c, answer), answer: answer.slice(0, 140),
        cost_usd: j.total_cost_usd ?? null,
        cache_create: j.usage?.cache_creation_input_tokens ?? null,
        cache_read: j.usage?.cache_read_input_tokens ?? null,
        out_tok: j.usage?.output_tokens ?? null,
        turns: j.num_turns ?? null, ms,
        tools: seen.tools, narrowings: seen.narrowings, windows: seen.windows, recall,
        session: j.session_id ?? null, exit: r.status,
      };
      console.log(JSON.stringify(rec));
      appendFileSync(OUT, JSON.stringify(rec) + '\n');
    }
  }
}
