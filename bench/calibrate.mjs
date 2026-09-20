/**
 * calibrate.mjs — taratura del pavimento di confidenza `narrow.minConfidence`.
 *
 * LA DOMANDA: a quale confidenza la finestra smette di contenere la riga giusta?
 *
 * Il pavimento 0,60 arriva da monte e poggia su UN solo fallimento osservato (0,42).
 * La nostra replica ne ha visto un secondo a 0,63, sbagliato di 133 righe. Due punti
 * non sono una taratura. Questo script ne produce abbastanza per disegnare la curva.
 *
 * METODO: chiama direttamente il passo di localizzazione — stesse domande, stesso
 * chunking, stessa policy del hook — su 26 coppie (obiettivo, riga vera) scritte a mano
 * leggendo i file, mai chieste a un modello. Nessuna sessione Claude: solo chiamate a
 * Jev, che costano centesimi. Per ogni bersaglio registra confidenza, riga scelta e se
 * la finestra CHE IL HOOK AVREBBE PRODOTTO contiene la riga vera.
 *
 * Il risultato non e' "quale soglia da' piu' restringimenti" — quella e' zero — ma
 * "quale soglia separa le finestre buone da quelle che perdono il bersaglio".
 *
 * OLTRE ALLA CONFIDENZA, questo script registra la DISTRIBUZIONE COMPLETA sui chunk.
 * La confidenza scalare dice quanto il primo chunk e' probabile; non dice quanto e'
 * ISOLATO. Due distribuzioni con la stessa confidenza — una con un secondo chunk
 * quasi altrettanto probabile, una senza — non sono lo stesso grado di certezza, e
 * oggi l'hook non sa distinguerle. I campi `top1`, `top2` e `gap` esistono per poter
 * rispondere con i dati, non a naso.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = process.argv[2];   // la directory dei sorgenti su cui tarare
const OUT = process.argv[3];   // dove scrivere il JSON dei risultati
// I moduli di squint stesso, non quelli di un altro progetto: questa taratura deve
// poter girare da un clone del pacchetto. La versione precedente importava da
// `<repo>/.jef/dist`, una directory che nel repository pubblicato non esiste.
//
// `fileURLToPath` e non `.pathname`: su un percorso con spazi - e su Windows ce ne
// sono, "Program Files" per cominciare - `.pathname` li lascia codificati come %20 e
// il caricamento fallisce su una directory che esiste.
const DIST = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'src');

const mod = (name) => import(pathToFileURL(join(DIST, name)).href);
const { buildChunks, buildQuestions, windowFor } = await mod('policy.js');
const { askJev } = await mod('jev.js');
const { loadConfig } = await mod('config.js');

const { narrow, jev } = loadConfig(process.cwd());

/** (file, riga vera, obiettivo). Scritti leggendo il codice, mai chiesti a un modello. */
const TARGETS = [
  ['report.ts', 388, 'calcolare un percentile scegliendo un valore osservato invece di interpolare fra due'],
  ['report.ts', 420, 'raccogliere le latenze dai record e costruirne le statistiche'],
  ['report.ts', 614, 'confrontare il modello deciso dal routing con quello che ha davvero eseguito'],
  ['report.ts', 751, 'calcolare la dispersione delle dimensioni dei task'],
  ['report.ts', 912, 'inserire i separatori delle migliaia in un numero da stampare'],
  ['report.ts', 1088, 'comporre le righe di testo che descrivono l adozione del routing'],
  ['report.ts', 1168, 'trasformare il modello del report nella stringa finale da stampare'],

  ['cli.ts', 136, 'interpretare gli argomenti passati sulla riga di comando'],
  ['cli.ts', 282, 'spiegare per quali ragioni e stato scelto un certo tier'],
  ['cli.ts', 370, 'raccogliere le evidenze deterministiche dagli argomenti'],
  ['cli.ts', 679, 'mostrare l esito di un controllo deterministico gia eseguito'],
  ['cli.ts', 897, 'produrre il testo del rapporto sui token spesi'],
  ['cli.ts', 1013, 'punto di ingresso che smista i sottocomandi'],

  ['install-settings.ts', 100, 'comporre la stringa di comando che lancia l hook'],
  ['install-settings.ts', 229, 'togliere la mappa degli hook quando non resta nessuna voce'],
  ['install-settings.ts', 378, 'trovare la posizione testuale di un valore dentro il JSON grezzo'],
  ['install-settings.ts', 493, 'innestare le voci degli hook nel testo preservando la formattazione'],
  ['install-settings.ts', 633, 'scrivere il file delle impostazioni aggiungendo gli hook'],

  ['pipeline.ts', 131, 'derivare un identificatore stabile del task'],
  ['pipeline.ts', 216, 'costruire lo stato compatto da mandare al servizio esterno'],
  ['pipeline.ts', 337, 'stimare quanto contesto e stato risparmiato'],
  ['pipeline.ts', 419, 'eseguire l analisi completa di un task dall inizio alla fine'],

  ['escalation.ts', 69, 'dire se un tier e superiore a un altro'],
  ['escalation.ts', 188, 'decidere se il task va portato a un livello superiore'],
  ['escalation.ts', 428, 'contare quante volte si e gia saliti di livello'],
  ['escalation.ts', 468, 'applicare l escalation e produrne il record'],
];

const results = [];
for (const [file, trueLine, goal] of TARGETS) {
  const src = readFileSync(join(SRC, file), 'utf8');
  const lines = src.split('\n');
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
    console.log(`${file}:${trueLine}  FALLITA (${r.reason})`);
    continue;
  }
  const where = r.answers['where'];
  const exists = r.answers['exists'];
  const chosen = chunks[where?.choice];
  const picked = chosen?.startLine ?? null;
  const w = picked ? windowFor(picked, lines.length, narrow) : null;

  // La distribuzione, non solo il suo massimo. `gap` e' il secondo segnale che la
  // confidenza scalare non porta: quanto il primo chunk stacca il secondo.
  const probs = where?.probabilities ?? {};
  const sorted = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  const top1 = sorted[0]?.[1] ?? null;
  const top2 = sorted[1]?.[1] ?? null;
  // Il secondo chunk e' ADIACENTE al primo? Due chunk vicini che si dividono la
  // probabilita' non sono un'ambiguita': sono una funzione a cavallo del taglio, e
  // la finestra li contiene entrambi. Senza questa distinzione `gap` punirebbe il
  // caso piu' innocuo che esista.
  const idx = (k) => Number(String(k).replace(/^c/, ''));
  const secondAdjacent = sorted.length > 1 ? Math.abs(idx(sorted[0][0]) - idx(sorted[1][0])) === 1 : null;

  const rec = {
    file, trueLine, goal,
    totalLines: lines.length,
    conf: where?.confidence ?? null,
    top1, top2, gap: top1 !== null && top2 !== null ? top1 - top2 : null,
    secondAdjacent,
    nChunks: Object.keys(probs).length,
    probabilities: probs,
    exists: exists?.noul ?? null,
    picked,
    lineError: picked ? Math.abs(picked - trueLine) : null,
    window: w,
    // Il fatto che conta: la finestra che il hook AVREBBE prodotto contiene la riga vera?
    recall: w ? trueLine >= w.offset && trueLine <= w.offset + w.limit - 1 : null,
    inTok: r.usage.inputTokens,
    elapsedMs: r.elapsedMs,
  };
  results.push(rec);
  console.log(
    `${file}:${trueLine}  conf ${rec.conf?.toFixed(2)}  gap ${rec.gap === null ? 'n/a' : rec.gap.toFixed(2)}  ` +
    `scelta ${picked} (err ${rec.lineError})  finestra ${w ? w.offset + '-' + (w.offset + w.limit - 1) : 'n/a'}  recall ${rec.recall}`,
  );
}

writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`\n${results.length} bersagli scritti in ${OUT}`);
