/**
 * consult.mjs — squint su una base di conoscenza, nel regime di CONSULTAZIONE.
 *
 * PERCHE' ESISTE. I test reali hanno mostrato che su un compito di MODIFICA il
 * restringimento viene disfatto: l'agente deve capire il file per cambiarlo, quindi lo
 * rilegge tutto e la finestra non toglie niente (misurato, 2 volte su 2). Ma il caso in
 * cui squint ha dato i suoi numeri migliori non e' la modifica: e' la consultazione -
 * apri la pagina, prendi la risposta, chiudi. E una consultazione si fa su
 * documentazione.
 *
 * La taratura su prosa ha gia' detto che il passo di localizzazione funziona: su
 * documentazione strutturata restringerebbe 12 volte su 16 (75%, contro il 50% sul
 * codice) con recall 12/12. Quello che quella misura NON puo' dire e' se il
 * restringimento SOPRAVVIVE in una sessione vera. Questo script lo chiede.
 *
 * ── DUE SOTTO-STRATI, perche' la domanda si sdoppia ──────────────────────────
 *
 *   NAMED    la pagina e' indicata nella domanda. E' il regime dello strato LARGE
 *            della batteria, ora su prosa invece che su codice. Isola la lettura dal
 *            recupero.
 *
 *   SEARCH   la pagina NON e' indicata: l'agente deve trovarla fra 346. E' il caso
 *            vero di un second brain, e porta con se' un sospetto preciso da
 *            verificare: piu' il recupero e' bravo, meno resta da restringere, perche'
 *            un agente che trova la riga con Grep poi legge una fetta con offset
 *            esplicito - e squint si fa da parte per progetto (`agent-set-window`,
 *            16 volte su 31 nei test reali).
 *
 * ── LA DOMANDA DECISIVA ──────────────────────────────────────────────────────
 *
 * Non «quanto risparmia», che su poche coppie non e' dichiarabile. Ma: **quando
 * l'hook restringe, l'agente riapre il resto della pagina?** Nei test reali la
 * risposta e' stata si', 2 su 2, e il file e' rientrato al 100%. Se in consultazione
 * la risposta e' no, la differenza fra i due regimi e' stabilita e vale piu' di
 * qualunque percentuale.
 *
 * GROUND TRUTH scritta a mano leggendo le pagine, mai chiesta a un modello. Ogni
 * risposta attesa e' una stringa breve che ho verificato stare a una riga precisa.
 *
 *   node work/real-tests/consult.mjs <workspace> <out.jsonl> [NAMED|SEARCH|tutti]
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const WS = process.argv[2];
const OUT = process.argv[3];
const ONLY = (process.argv[4] ?? 'tutti').toUpperCase();
const MODEL = process.env.MODEL ?? 'opus';
const BUDGET = process.env.MAX_BUDGET_USD ?? '1.00';

const BP = 'superpowers-dev/skills/writing-skills/anthropic-best-practices.md';
const CD = 'claude-plugins-official/plugins/plugin-dev/skills/command-development/SKILL.md';
const IC = 'claude-plugins-official/plugins/plugin-dev/skills/command-development/references/interactive-commands.md';
const PH = 'superpowers-dev/docs/porting-to-a-new-harness.md';

/**
 * Otto consultazioni. Le stesse quattro pagine della taratura, ognuna interrogata due
 * volte: una con la pagina indicata e una senza. Le risposte attese sono state
 * verificate a mano alla riga indicata.
 */
const CASES = [
  // --- NAMED: la pagina e' nella domanda -------------------------------------
  { id: 'N1', stratum: 'NAMED', file: BP, line: 157, must: [/gerund|gerundi/i],
    q: `Leggi ${BP} e dimmi quale forma grammaticale e raccomandata per il nome di una skill. Rispondi in una riga.` },
  { id: 'N2', stratum: 'NAMED', file: CD, line: 142, must: [/allowed-tools/i],
    q: `Leggi ${CD} e dimmi come si chiama il campo del frontmatter che limita quali strumenti un comando puo usare. Rispondi solo col nome del campo.` },
  { id: 'N3', stratum: 'NAMED', file: IC, line: 243, must: [/multiselect/i],
    q: `Leggi ${IC} e dimmi come si chiama il parametro che permette di selezionare piu opzioni invece di una sola. Rispondi solo col nome del parametro.` },
  { id: 'N4', stratum: 'NAMED', file: PH, line: 88, must: [/session[- ]?start/i, /inie|inject/i],
    q: `Leggi ${PH} e dimmi qual e l unica capacita non negoziabile che un harness deve avere. Rispondi in una riga.` },

  // --- SEARCH: la pagina va trovata fra 346 -----------------------------------
  { id: 'S1', stratum: 'SEARCH', file: BP, line: 190, must: [/terza persona|third person/i],
    q: 'In questa base di documentazione, in quale persona grammaticale va scritta la descrizione di una skill, e perche? Rispondi in massimo due righe, nominando il file da cui lo ricavi.' },
  { id: 'S2', stratum: 'SEARCH', file: BP, line: 385, must: [/\b100\b/],
    q: 'In questa base di documentazione, oltre quante righe un file di riferimento dovrebbe avere un indice in cima? Rispondi col numero e col file da cui lo ricavi.' },
  { id: 'S3', stratum: 'SEARCH', file: CD, line: 180, must: [/argument-hint/i],
    q: 'In questa base di documentazione, quale campo del frontmatter documenta gli argomenti attesi per il completamento automatico? Rispondi col nome del campo e col file da cui lo ricavi.' },
  { id: 'S4', stratum: 'SEARCH', file: CD, line: 241, must: [/\$1|posizional|positional/i],
    q: 'In questa base di documentazione, come si catturano gli argomenti di un comando uno per uno invece che tutti in blocco? Rispondi in massimo due righe, nominando il file.' },
];

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function transcriptFor(sid) {
  const base = join(process.env.USERPROFILE || '', '.claude', 'projects');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    const p = join(base, d, sid + '.jsonl');
    if (existsSync(p)) return p;
  }
  return null;
}

/** Il mastro dell'hook: la prova primaria, e l'unica che vede i motivi dei rifiuti. */
function ledger(armDir, sid) {
  const p = join(armDir, '.squint', `session-${String(sid).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)}.jsonl`);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

/**
 * Ogni Read del transcript, tradotta in intervallo di righe.
 *
 * `offset` assente vuol dire dall'inizio, `limit` assente fino alla fine: e' cosi' che
 * Read li interpreta, e trattarli come zero fa sbagliare la copertura - errore che ho
 * gia' fatto una volta calcolando la copertura di APP1.
 */
function readsOf(transcriptPath) {
  const out = [];
  if (!transcriptPath || !existsSync(transcriptPath)) return out;
  const tools = {};
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'assistant' || !Array.isArray(o.message?.content)) continue;
    for (const c of o.message.content) {
      if (c.type !== 'tool_use') continue;
      tools[c.name] = (tools[c.name] || 0) + 1;
      if (c.name !== 'Read') continue;
      out.push({
        file: String(c.input?.file_path ?? '').replace(/\\/g, '/').split('/').pop(),
        offset: c.input?.offset ?? null,
        limit: c.input?.limit ?? null,
      });
    }
  }
  out.tools = tools;
  return out;
}

/**
 * LA MISURA CHE CONTA: il restringimento e' stato disfatto?
 *
 * Si uniscono la finestra imposta dall'hook e tutte le letture successive dello stesso
 * file, e si guarda quanta parte del file e' entrata comunque. Nei test reali su
 * compiti di modifica il risultato e' stato 100% due volte su due.
 */
function undone(narrowRec, reads, totalLines) {
  const name = String(narrowRec.path || '').split('/').pop();
  const spans = [[narrowRec.offset, narrowRec.offset + narrowRec.limit - 1]];
  let later = 0;
  for (const r of reads) {
    if (r.file !== name) continue;
    if (r.offset === null && r.limit === null) continue; // e' la lettura che l'hook ha ristretto
    const a = r.offset ?? 1;
    const b = r.limit === null ? totalLines : a + r.limit - 1;
    spans.push([a, Math.min(totalLines, b)]);
    later += 1;
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const covered = merged.reduce((n, [a, b]) => n + (b - a + 1), 0);
  return { laterReads: later, coveredLines: covered, totalLines, coverage: covered / totalLines };
}

const selected = CASES.filter((c) => ONLY === 'TUTTI' || c.stratum === ONLY);
console.error(`consultazione: ${selected.length} casi x 2 bracci = ${selected.length * 2} run`);
console.error(`modello ${MODEL}, tetto $${BUDGET} per run\n`);

let spent = 0;
for (const c of selected) {
  for (const arm of ['off', 'on']) {
    const cwd = join(WS, arm);
    const args = ['-p', c.q, '--model', MODEL, '--output-format', 'json',
      '--max-budget-usd', BUDGET,
      // Consultazione: leggere e cercare, mai scrivere. E' il regime sotto misura.
      '--allowedTools', 'Read Grep Glob',
      '--disallowedTools', 'Agent Task Write Edit Bash'];
    const t0 = Date.now();
    const r = spawnSync(CLAUDE, args, { cwd, encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
    const ms = Date.now() - t0;
    let j = {}; try { j = JSON.parse(r.stdout || '{}'); } catch { /* vuoto */ }
    const answer = (j.result || '').trim();
    const reads = j.session_id ? readsOf(transcriptFor(j.session_id)) : [];
    const rows = j.session_id ? ledger(cwd, j.session_id) : [];
    const narrowed = rows.filter((x) => x.narrowed === true);

    const rec = {
      test: 'consult', id: c.id, stratum: c.stratum, arm, model: MODEL,
      targetFile: c.file, trueLine: c.line,
      pass: c.must.every((re) => re.test(answer)),
      answer: answer.slice(0, 200),
      cost_usd: j.total_cost_usd ?? null,
      cache_create: j.usage?.cache_creation_input_tokens ?? null,
      cache_read: j.usage?.cache_read_input_tokens ?? null,
      out_tok: j.usage?.output_tokens ?? null,
      turns: j.num_turns ?? null, ms,
      tools: reads.tools ?? {},
      reads: reads.map((x) => ({ f: x.file, o: x.offset, l: x.limit })),
      hook: {
        readsLookedAt: rows.length,
        narrowings: narrowed.length,
        reasons: rows.reduce((a, x) => { if (x.reason) a[x.reason] = (a[x.reason] || 0) + 1; return a; }, {}),
        confidences: narrowed.map((x) => x.confidence),
        goalAges: rows.filter((x) => typeof x.goalAgeTurns === 'number').map((x) => x.goalAgeTurns),
        jevCalls: rows.filter((x) => typeof x.inputTokens === 'number').length,
        jevInputTokens: rows.reduce((n, x) => n + (x.inputTokens ?? 0), 0),
      },
      // la misura decisiva
      undone: narrowed.map((n) => ({ file: n.path, ...undone(n, reads, n.totalLines) })),
      // la finestra conteneva la riga vera?
      recall: narrowed.length
        ? narrowed.some((n) => String(n.path).endsWith(c.file.split('/').pop())
            && c.line >= n.offset && c.line <= n.offset + n.limit - 1)
        : null,
      session: j.session_id ?? null, exit: r.status,
    };
    appendFileSync(OUT, JSON.stringify(rec) + '\n');
    spent += rec.cost_usd ?? 0;
    const u = rec.undone[0];
    console.error(
      `  ${c.id}/${arm.padEnd(3)} $${(rec.cost_usd ?? 0).toFixed(3)}  ${String(rec.turns).padStart(2)} turni  ` +
      `pass=${String(rec.pass).padEnd(5)} guardate ${rec.hook.readsLookedAt} ristrette ${rec.hook.narrowings}` +
      (u ? `  RILETTO ${Math.round(u.coverage * 100)}% del file (+${u.laterReads} letture)` : '') +
      (rec.recall === null ? '' : `  recall ${rec.recall}`),
    );
    sleep(2500);
  }
}
console.error(`\nspesa ACTUAL $${spent.toFixed(4)}`);
