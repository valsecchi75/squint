/**
 * system-goal.mjs — cosa fa il hook quando il goal l'ha scritto il sistema.
 *
 * IL FATTO (evidence §6-ter): su 457 Read reali, 64 volte (14%) il messaggio che il hook
 * prende come goal non l'ha scritto l'utente: e' il corpo di una skill iniettata
 * (`Base directory for this skill: …`) o la notifica di un subagent. L'intuizione da
 * validare e': «rifiutare i goal `system` toglie mire sbagliate al prezzo del 3% dei
 * restringimenti». Vale solo se, con un goal di sistema, il hook RESTRINGE DAVVERO. Se
 * Jev risponde con confidenza bassa, il pavimento a 0,60 lo ferma gia' e la regola
 * comprerebbe poco.
 *
 * LE PREDIZIONI, scritte prima di lanciare:
 *
 *   P1  Recall ≈ caso. La finestra e' un quinto del file (o 150 righe), il goal non
 *       c'entra col bersaglio: la riga vera ci finisce dentro per caso, ~20% sui file
 *       grandi, ~50% sui piccoli.
 *
 *   P2  LA DOMANDA CHE DECIDE. Quante volte conf ≥ 0,60, cioe' il hook avrebbe
 *       ristretto? Sullo stale goal di §6 fu 11/11: un goal ben formato su tutt'altro
 *       produce confidenza alta. Un corpo di skill e' un goal ben formato su
 *       tutt'altro. Previsione: sopra il 50%. Se e' sotto il 20%, il pavimento vede
 *       gia' quasi tutto e la regola non vale il suo prezzo.
 *
 * COSA CONTA COME «giustificata»: la regola e' giustificata se, sui goal di sistema,
 * la quota di restringimenti che perdono il bersaglio (narrows AND NOT recall) supera
 * il prezzo noto della regola, 5/145 = 3,4% dei restringimenti su goal utente.
 *
 * I GOAL sono tre forme reali, ricostruite da testo pubblico (nessun transcript
 * privato lascia la macchina): il corpo della skill di squint stessa; il corpo della
 * skill /jef, che parla PROPRIO del codice del corpus e quindi e' il caso piu'
 * insidioso; una task-notification nella forma esatta vista nei transcript. Ognuno e'
 * tagliato a 600 caratteri e passato da `scrub`, come fa il hook.
 *
 * Nessuna sessione Claude: solo chiamate a Jev, centesimi.
 *
 *   node bench/system-goal.mjs <srcDir> <out.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CASES } from './cases.mjs';

const SRC = process.argv[2];
const OUT = process.argv[3];
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist', 'src');
const mod = (n) => import(pathToFileURL(join(DIST, n)).href);
const { buildChunks, buildQuestions, windowFor, confidenceAccepted } = await mod('policy.js');
const { askJev } = await mod('jev.js');
const { loadConfig } = await mod('config.js');
const { scrub } = await mod('ledger.js');
const { narrow, jev } = loadConfig(process.cwd());

const stripFrontmatter = (t) => t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
const skillBody = (path) => `Base directory for this skill: /home/user/.claude/skills\n\n${stripFrontmatter(readFileSync(path, 'utf8'))}`;

const GOALS = {
  'skill-squint': skillBody(join(ROOT, 'skills', 'squint', 'SKILL.md')),
  'skill-jef': skillBody(join(ROOT, '..', '..', '.claude', 'skills', 'jef', 'SKILL.md')),
  'task-notification':
    '<task-notification>\n<task-id>b1ulror9i</task-id>\n<tool-use-id>toolu_017tFnj61sRxuM2akVysduoq</tool-use-id>\n' +
    '<output-file>/tmp/claude/tasks/b1ulror9i.output</output-file>\n<status>completed</status>\n' +
    '<summary>Background command "npm test" completed (exit code 0)</summary>\n</task-notification>',
};
// Come il hook: 600 caratteri, poi lo scrub.
for (const k of Object.keys(GOALS)) GOALS[k] = scrub(GOALS[k].slice(0, 600));

const targets = CASES.filter((c) => (c.stratum === 'LARGE' || c.stratum === 'SMALL') && c.line !== undefined);
const results = [];
for (const c of targets) {
  const lines = readFileSync(join(SRC, c.file), 'utf8').split('\n');
  const { chunks, criteria } = buildChunks(lines, narrow);
  for (const [kind, goal] of Object.entries(GOALS)) {
    const state = {
      goal,
      file: { path: c.file, chunks: Object.fromEntries(Object.entries(chunks).map(([id, ch]) => [id, { start_line: ch.startLine, text: ch.text }])) },
    };
    const r = await askJev(state, buildQuestions(criteria), jev, narrow.timeoutMs, process.env);
    if (r.status !== 'ok') {
      results.push({ id: c.id, file: c.file, trueLine: c.line, goalKind: kind, status: r.status, reason: r.reason });
      console.log(`${c.id} ${kind}  FALLITA (${r.reason})`);
      continue;
    }
    const where = r.answers['where'];
    const chosen = chunks[where?.choice];
    const picked = chosen?.startLine ?? null;
    const w = picked ? windowFor(picked, lines.length, narrow) : null;
    const recall = w ? c.line >= w.offset && c.line <= w.offset + w.limit - 1 : null;
    const narrows = w !== null && where !== undefined && confidenceAccepted(where.confidence, narrow);
    const rec = {
      id: c.id, stratum: c.stratum, file: c.file, totalLines: lines.length, trueLine: c.line, goalKind: kind,
      conf: where?.confidence ?? null, picked, window: w, recall, narrows,
      chance: w ? w.limit / lines.length : null,
      inTok: r.usage.inputTokens, elapsedMs: r.elapsedMs,
    };
    results.push(rec);
    console.log(`${c.id.padEnd(4)} ${kind.padEnd(18)} conf ${rec.conf?.toFixed(2)}  scelta ${picked}  recall ${recall}  restringe ${narrows}`);
  }
}

const ok = results.filter((r) => r.status === undefined);
const byKind = {};
for (const r of ok) {
  const k = (byKind[r.goalKind] ??= { n: 0, recall: 0, narrows: 0, narrowsLost: 0, chance: 0 });
  k.n++; if (r.recall) k.recall++; if (r.narrows) k.narrows++; if (r.narrows && !r.recall) k.narrowsLost++; k.chance += r.chance;
}
console.log('\nper forma di goal:');
for (const [k, v] of Object.entries(byKind)) {
  console.log(`  ${k.padEnd(18)} recall ${v.recall}/${v.n} (caso atteso ${(100 * v.chance / v.n).toFixed(0)}%)  restringe ${v.narrows}/${v.n}  restringe E perde il bersaglio ${v.narrowsLost}/${v.n}`);
}
const tot = ok.length, nar = ok.filter((r) => r.narrows).length, lost = ok.filter((r) => r.narrows && !r.recall).length;
console.log(`\ntotale: restringe ${nar}/${tot} (${(100 * nar / tot).toFixed(0)}%)  restringe e perde ${lost}/${tot} (${(100 * lost / tot).toFixed(0)}%)  token ${ok.reduce((n, r) => n + r.inTok, 0)}`);
writeFileSync(OUT, JSON.stringify({ goals: GOALS, results }, null, 2));
console.log(`scritto ${OUT}`);
