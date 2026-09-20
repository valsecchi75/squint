/**
 * calibrate-docs.mjs — la stessa taratura di calibrate.mjs, ma su PROSA.
 *
 * LA DOMANDA. Tutte le misure di docs/evidence.md sono state prese su codice. Ma il
 * caso in cui squint ha reso meglio - un file grande, una domanda mirata, UNA lettura -
 * non e' il caso del codice: e' il caso della CONSULTAZIONE. E una consultazione si fa
 * su documentazione, non su sorgenti. I test reali su compiti di sviluppo hanno mostrato
 * il perche' la distinzione conta: chi modifica un file lo rilegge tutto, e il
 * restringimento viene disfatto (2 volte su 2). Chi consulta una pagina, no.
 *
 * Questo script chiede se Jev sappia localizzare in un testo come sa fare in un
 * sorgente. Stessa strada del hook - stesso chunking, stesse domande, stessa policy -
 * su bersagli scritti a mano leggendo le pagine, mai chiesti a un modello.
 *
 * IL CORPUS E' DI TERZE PARTI, e non e' un dettaglio: le pagine di `docs/` in questo
 * repository le ho scritte io, e tarare la localizzazione su testi propri misura
 * anche quanto si scrive in modo prevedibile. Qui le cinque pagine vengono dai plugin
 * installati sulla macchina - scritte da altri, per altri scopi.
 *
 * UN VINCOLO SCOPERTO MISURANDO, e vale la pena averlo scritto qui. I due cancelli di
 * squint - almeno 400 righe E meno di 80.000 byte - insieme impongono che la riga media
 * stia sotto i 200 byte. Il codice sta a ~42 byte/riga e passa comodo; la prosa
 * discorsiva sta a ~206 e NON PUO' PASSARE MAI, perche' sbatte sul tetto dei byte prima
 * di arrivare al pavimento delle righe. Solo la documentazione strutturata - titoli,
 * elenchi, tabelle, blocchi di codice, ~20-60 byte/riga - sta dentro la banda. Le cinque
 * pagine qui sotto sono tutte di quel tipo, e questo limita a cosa si applica il
 * risultato.
 *
 *   node bench/calibrate-docs.mjs <radice del corpus> <out.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = process.argv[2];
const OUT = process.argv[3];
const DIST = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'src');
const mod = (n) => import(pathToFileURL(join(DIST, n)).href);
const { buildChunks, buildQuestions, windowFor, confidenceAccepted } = await mod('policy.js');
const { askJev } = await mod('jev.js');
const { loadConfig } = await mod('config.js');
const { narrow, jev } = loadConfig(process.cwd());

const BP = 'superpowers-dev/skills/writing-skills/anthropic-best-practices.md';
const CD = 'claude-plugins-official/plugins/plugin-dev/skills/command-development/SKILL.md';
const IC = 'claude-plugins-official/plugins/plugin-dev/skills/command-development/references/interactive-commands.md';
const MC = 'claude-plugins-official/plugins/plugin-dev/skills/command-development/references/marketplace-considerations.md';
const PH = 'superpowers-dev/docs/porting-to-a-new-harness.md';

/**
 * (pagina, riga vera, domanda). Scritti LEGGENDO le pagine.
 *
 * Le domande descrivono il CONTENUTO, non ripetono il titolo della sezione: una domanda
 * che riecheggia l'intestazione misura la ricerca per parola chiave, non la
 * localizzazione. Dove il titolo e la domanda si somigliano comunque, e' perche' il
 * titolo dice davvero cosa c'e' sotto, ed e' un caso legittimo.
 */
const TARGETS = [
  [BP, 157, 'quale forma grammaticale si raccomanda per il nome di una skill'],
  [BP, 190, 'in quale persona grammaticale va scritta la descrizione, e perche dipende da dove finisce quel testo'],
  [BP, 355, 'cosa fa un agente davanti a riferimenti annidati invece di leggere il file per intero'],
  [BP, 385, 'oltre quale lunghezza un file di riferimento dovrebbe avere un indice in cima'],

  [CD, 36, 'per chi e scritto il contenuto di un comando: per la persona che lo invoca o per il modello che lo esegue'],
  [CD, 142, 'il campo che limita quali strumenti un comando puo usare'],
  [CD, 180, 'il campo che documenta gli argomenti attesi per il completamento automatico'],
  [CD, 241, 'come si catturano gli argomenti uno per uno invece che tutti in blocco'],

  [IC, 224, 'quanto deve essere lunga l etichetta di un opzione da proporre'],
  [IC, 243, 'il campo che permette di scegliere piu opzioni insieme invece di una sola'],

  [MC, 68, 'come un comando verifica che gli strumenti esterni di cui ha bisogno siano installati'],
  [MC, 130, 'come un comando si comporta quando una funzione che gli servirebbe non e disponibile'],
  [MC, 298, 'come si evitano le collisioni di nome fra comandi di plugin diversi'],

  [PH, 88, 'l unica capacita che un harness deve avere per forza, senza la quale non si puo procedere'],
  [PH, 126, 'il caso in cui un harness nuovo non richiede di aggiungere nessun file'],
  [PH, 227, 'la forma di integrazione in cui l harness lancia un comando di shell all avvio e ne legge lo stdout'],
];

const results = [];
for (const [file, trueLine, goal] of TARGETS) {
  const src = readFileSync(join(SRC, file), 'utf8');
  const lines = src.split('\n');
  const bytes = Buffer.byteLength(src);
  const { chunks, criteria } = buildChunks(lines, narrow);

  const state = {
    goal,
    file: {
      path: file,
      chunks: Object.fromEntries(Object.entries(chunks).map(([id, c]) => [id, { start_line: c.startLine, text: c.text }])),
    },
  };
  const r = await askJev(state, buildQuestions(criteria), jev, narrow.timeoutMs, process.env);
  if (r.status !== 'ok') {
    results.push({ file, trueLine, goal, status: r.status, reason: r.reason, elapsedMs: r.elapsedMs });
    console.log(`${file.split('/').pop()}:${trueLine}  FALLITA (${r.reason})`);
    continue;
  }

  const where = r.answers['where'];
  const exists = r.answers['exists'];
  const chosen = chunks[where?.choice];
  const picked = chosen?.startLine ?? null;
  const w = picked ? windowFor(picked, lines.length, narrow) : null;
  const probs = where?.probabilities ?? {};
  const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);

  const rec = {
    file, trueLine, goal,
    totalLines: lines.length, bytes, bytesPerLine: Math.round(bytes / lines.length),
    conf: where?.confidence ?? null,
    top1: sorted[0]?.[1] ?? null,
    gap: sorted.length > 1 ? sorted[0][1] - sorted[1][1] : null,
    exists: exists?.noul ?? null,
    picked,
    lineError: picked ? Math.abs(picked - trueLine) : null,
    window: w,
    accepted: where ? confidenceAccepted(where.confidence, narrow) : false,
    recall: w ? trueLine >= w.offset && trueLine <= w.offset + w.limit - 1 : null,
    inTok: r.usage.inputTokens,
    elapsedMs: r.elapsedMs,
  };
  results.push(rec);
  console.log(
    `${file.split('/').pop().padEnd(30)}:${String(trueLine).padStart(4)}  conf ${rec.conf?.toFixed(2)}  ` +
    `${rec.accepted ? 'RESTRINGE' : 'rinuncia '}  scelta ${picked} (err ${rec.lineError})  recall ${rec.recall}`,
  );
}

writeFileSync(OUT, JSON.stringify(results, null, 2));

// --- il verdetto ------------------------------------------------------------
const ok = results.filter((r) => r.conf != null);
const acc = ok.filter((r) => r.accepted);
const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : 'n/a');
const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

console.log('\n' + '='.repeat(72));
console.log('LA PROSA SI LOCALIZZA COME IL CODICE?');
console.log('='.repeat(72));
console.log(`  bersagli riusciti: ${ok.length}/${TARGETS.length}`);
console.log(`  recall su TUTTI (indipendente dal pavimento): ${ok.filter((r) => r.recall).length}/${ok.length}  (${pct(ok.filter((r) => r.recall).length, ok.length)})`);
console.log(`  l hook AVREBBE RISTRETTO: ${acc.length}/${ok.length}  (${pct(acc.length, ok.length)})`);
console.log(`  recall sui soli restringimenti: ${acc.filter((r) => r.recall).length}/${acc.length}`);
const fails = ok.filter((r) => !r.recall);
if (fails.length) console.log(`  confidenza massima fra i fallimenti: ${Math.max(...fails.map((r) => r.conf)).toFixed(2)}`);
console.log(`  errore della scelta: mediana ${med(ok.map((r) => r.lineError))} righe, massimo ${Math.max(...ok.map((r) => r.lineError))}`);
console.log(`  confidenze: min ${Math.min(...ok.map((r) => r.conf)).toFixed(2)}  mediana ${med(ok.map((r) => r.conf)).toFixed(2)}  max ${Math.max(...ok.map((r) => r.conf)).toFixed(2)}`);
console.log(`  densita delle pagine: ${med(ok.map((r) => r.bytesPerLine))} byte/riga (il codice sta a ~42)`);
console.log(`\n  [ACTUAL] ${ok.reduce((n, r) => n + r.inTok, 0).toLocaleString('it-IT')} token in ingresso, ` +
  `latenze ${Math.min(...ok.map((r) => r.elapsedMs))}-${Math.max(...ok.map((r) => r.elapsedMs))} ms`);
console.log('\n  Confronto col codice (docs/evidence.md §2, 52 osservazioni su due tornate):');
console.log('    recall complessivo 43/52 (83%)  ·  al pavimento 0,60 restringe 26/52 (50%) con recall 100%');
