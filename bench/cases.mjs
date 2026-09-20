/**
 * cases.mjs — i casi della batteria e la loro ground truth, in un file solo.
 *
 * Stanno qui, e non dentro run.mjs, perche' li usano DUE harness: la batteria
 * comparativa (run.mjs) e il test avversariale (adversarial.mjs), che deve interrogare
 * gli STESSI identici casi o non prova niente. Il contenuto e' quello che ha prodotto i
 * numeri di docs/evidence.md, spostato senza modifiche: lo spostamento e' stato
 * verificato confrontando il JSON dell'elenco prima e dopo — 25 casi, identici.
 *
 * LA GROUND TRUTH E' SCRITTA A MANO leggendo i file, mai chiesta a un modello. Far
 * produrre la chiave di correzione al modello che poi si corregge misura l'accordo fra
 * il modello e se stesso, non la correttezza.
 *
 * La forma delle domande e' IMPERATIVA ("Leggi il file X e dimmi...") e non
 * interrogativa. La prima esecuzione della batteria usava la forma interrogativa e
 * l'agente, con il solo Read permesso, non riusciva a localizzare il file e rinunciava:
 * quella tornata e' stata fermata e rifatta, non corretta a posteriori.
 */

const askIn = (path, what) =>
  `Leggi il file ${path} e dimmi il nome esatto della funzione che ${what}. Rispondi SOLO con il nome della funzione, nient altro.`;
const ask = (file, what) => askIn(`src/${file}`, what);

/** Due bersagli distanti nello stesso file: e' cosi' che nasce una seconda lettura. */
const askTwo = (file, a, b) =>
  `Leggi il file src/${file} e dimmi i nomi esatti di DUE funzioni: quella che ${a}, e quella che ${b}. ` +
  `Rispondi SOLO con i due nomi separati da una virgola, nient altro.`;

/** Ogni caso porta la riga vera: serve a dire se la finestra l'ha contenuta. */
const CASES = [
  // --- LARGE: >= 400 righe e < 80 KB, l'hook PUO' scattare -------------------
  // A1-A6 sono identici alla batteria precedente, perche' i numeri nuovi devono
  // essere confrontabili con quelli vecchi. A7-A10 sono nuovi.
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
  { id: 'A7', stratum: 'LARGE', file: 'report.ts', lines: 1307, truth: 'formatReport', line: 1168,
    prompt: ask('report.ts', 'trasforma il modello del report nella stringa finale da stampare') },
  { id: 'A8', stratum: 'LARGE', file: 'cli.ts', lines: 1040, truth: 'parseArgs', line: 136,
    prompt: ask('cli.ts', 'interpreta gli argomenti passati sulla riga di comando') },
  { id: 'A9', stratum: 'LARGE', file: 'install-settings.ts', lines: 737, truth: 'graftJefHooks', line: 493,
    prompt: ask('install-settings.ts', 'innesta le voci degli hook nel testo grezzo preservando la formattazione') },
  { id: 'A10', stratum: 'LARGE', file: 'escalation.ts', lines: 507, truth: 'countEscalationSteps', line: 428,
    prompt: ask('escalation.ts', 'conta quanti passi di escalation il task ha gia fatto') },

  // --- SMALL: sotto le 400 righe, l'hook NON PUO' scattare (controllo) -------
  { id: 'B1', stratum: 'SMALL', file: 'typesafe-client.ts', lines: 313, truth: 'abortAfter', line: 223,
    prompt: ask('typesafe-client.ts', 'produce una promessa che scade dopo un timeout') },
  { id: 'B2', stratum: 'SMALL', file: 'load-config.ts', lines: 347, truth: 'normalizeConfig', line: 165,
    prompt: ask('load-config.ts', 'valida e normalizza la configurazione grezza') },
  { id: 'B3', stratum: 'SMALL', file: 'state-store.ts', lines: 365, truth: 'redactUnderKey', line: 73,
    prompt: ask('state-store.ts', 'oscura un valore in base al nome della chiave che lo contiene') },
  { id: 'B4', stratum: 'SMALL', file: 'sanitize.ts', lines: 257, truth: 'normalizePath', line: 105,
    prompt: ask('sanitize.ts', 'riduce un percorso assoluto a uno relativo alla radice del progetto') },
  { id: 'B5', stratum: 'SMALL', file: 'repository-index.ts', lines: 317, truth: 'repositoryStamp', line: 241,
    prompt: ask('repository-index.ts', 'produce l impronta con cui si decide se la cache dell indice e ancora valida') },

  // --- HUGE: > 80.000 byte, l'hook deve RIFIUTARE, non restringere -----------
  // SINTETICI, e dichiarati tali: nessun file reale di .jef/src supera gli 80.000
  // byte (il piu' grande, report.ts, ne ha 57.433). Sono concatenazioni di sorgenti
  // reali del corpus, cosi' la domanda resta identica a quella dello strato LARGE.
  { id: 'H1', stratum: 'HUGE', file: 'big/huge-a.ts', lines: 2353, bytes: 103688, truth: 'executorMatches', line: 617,
    synthetic: true,
    prompt: askIn('big/huge-a.ts', 'confronta il modello deciso dal routing con quello che ha davvero eseguito') },
  { id: 'H2', stratum: 'HUGE', file: 'big/huge-b.ts', lines: 2586, bytes: 109086, truth: 'detectSettingsFormat', line: 260,
    synthetic: true,
    prompt: askIn('big/huge-b.ts', 'rileva l indentazione e i fine riga usati nel file di impostazioni') },

  // --- EXPLORE: nessun file indicato, tool liberi, caso realistico -----------
  // La ground truth qui non e' un nome ma un INSIEME di cose che la risposta deve
  // contenere: un compito esplorativo non ha una risposta di una parola.
  //
  // C1 e C2 sono identici alla tornata precedente. C3 e C4 sono nuovi ed evitano
  // deliberatamente le parole che l'altra volta hanno convocato una skill.
  { id: 'C1', stratum: 'EXPLORE', free: true, truth: null,
    must: [/model-router/i, /complexity/i, /risk/i],
    prompt: 'In questo progetto, quale modulo decide il tier di esecuzione e su quali grandezze si basa? Rispondi in massimo tre righe, nominando il file e le grandezze.' },
  { id: 'C2', stratum: 'EXPLORE', free: true, truth: null,
    must: [/sanitize/i, /(secrets|\.env)/i],
    prompt: 'In questo progetto, come si evita di mandare segreti al servizio esterno? Rispondi in massimo tre righe, nominando il file responsabile.' },
  { id: 'C3', stratum: 'EXPLORE', free: true, truth: null,
    must: [/timeout/i, /(load-config|typesafe-client)/i],
    prompt: 'In questo progetto, dove vengono decisi i timeout delle chiamate al servizio esterno, e quanti valori distinti esistono? Rispondi in massimo tre righe, nominando i file.' },
  // `[RIFATTO]` La prima formulazione — «cosa fa salire un task a un tier superiore e
  // dove e' scritta quella logica» — ha fatto rinunciare l'agente in ENTRAMBI i bracci:
  // una riga, zero tool, la richiesta di sapere da quale cartella partire. Coppia nulla,
  // archiviata, e la domanda riscritta sulla forma di C1, che invece funziona. Non e'
  // un aggiustamento dei dati: e' una domanda che non ha mai prodotto una misura.
  { id: 'C4', stratum: 'EXPLORE', free: true, truth: null,
    must: [/escalation/i, /(tier|livello)/i],
    prompt: 'In questo progetto, quale funzione decide se un task va portato a un tier superiore, e su quali grandezze si basa? Rispondi in massimo tre righe, nominando il file e le grandezze.' },

  // --- REPEAT: due bersagli DISTANTI nello stesso file, una sola sessione ----
  // Perche' funziona: la finestra e' un quinto del file. Un secondo bersaglio a
  // centinaia di righe di distanza non ci sta dentro, quindi il braccio ON deve
  // leggere una seconda volta - e oggi paga una seconda chiamata a Jev identica.
  // Il braccio OFF legge una volta sola e ha gia' entrambe le risposte.
  { id: 'D1', stratum: 'REPEAT', file: 'report.ts', lines: 1307, truths: ['buildLatency', 'adoptionLines'],
    lineA: 420, lineB: 1088,
    prompt: askTwo('report.ts',
      'raccoglie le latenze dai record e ne costruisce le statistiche',
      'compone le righe di testo che descrivono l adozione del routing') },
  { id: 'D2', stratum: 'REPEAT', file: 'cli.ts', lines: 1040, truths: ['measureTaskSize', 'renderExecutor'],
    lineA: 179, lineB: 788,
    prompt: askTwo('cli.ts',
      'misura la dimensione del task in caratteri e parole',
      'produce il testo del sottocomando executor') },
  { id: 'D3', stratum: 'REPEAT', file: 'install-settings.ts', lines: 737, truths: ['buildJefHookCommand', 'uninstallFromSettings'],
    lineA: 100, lineB: 660,
    prompt: askTwo('install-settings.ts',
      'compone la stringa di comando che lancia l hook',
      'toglie le voci degli hook dal file di impostazioni') },
  { id: 'D4', stratum: 'REPEAT', file: 'pipeline.ts', lines: 629, truths: ['taskIdOf', 'runAnalysis'],
    lineA: 131, lineB: 419,
    prompt: askTwo('pipeline.ts',
      'deriva un identificatore stabile del task',
      'esegue l analisi completa di un task dall inizio alla fine') },
];


export { CASES, ask, askIn, askTwo };
