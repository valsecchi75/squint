/**
 * run.mjs — la batteria comparativa del Read narrowing di squint.
 *
 * PREREGISTRAZIONE (scritta prima di qualunque run a pagamento):
 *
 *   H1  Sullo strato LARGE il braccio ON costa meno del braccio OFF.
 *   H2  Sullo strato SMALL i due bracci NON si separano: l'hook non puo' scattare
 *       (file sotto le 400 righe) e quindi non deve ne' risparmiare ne' costare.
 *       Questo e' il CONTROLLO NEGATIVO: se ON e OFF si separassero qui, la
 *       differenza misurata su LARGE non sarebbe attribuibile al restringimento.
 *   H3  La qualita' non peggiora in nessuno strato.
 *   H4  Sullo strato HUGE (> 80.000 byte) l'hook RIFIUTA: zero restringimenti,
 *       motivo `file-too-large`, e i bracci non si separano. Secondo controllo
 *       negativo, su un cancello diverso da quello di H2.
 *   H5  Sullo strato EXPLORE la grandezza da misurare NON e' il risparmio ma il
 *       TASSO DI SCATTO: quante volte, su un compito aperto, avviene davvero una
 *       lettura idonea. Un tasso di zero e' un risultato, non un fallimento.
 *       AMBITO DICHIARATO: la delega a un subagent e' vietata (vedi --disallowedTools
 *       piu' sotto), quindi H5 parla di un agente che lavora IN SESSIONE. Non dice
 *       nulla su cosa succeda quando l'agente delega, e non deve pretendere di dirlo.
 *   H6  Sullo strato REPEAT, dove lo stesso file serve due volte, il braccio ON
 *       paga due chiamate a Jev sullo stesso file. Misura la dimensione del
 *       bersaglio dell'ottimizzazione O1 (cache della decisione).
 *
 *   Metrica primaria : delta di costo APPAIATO (stessa domanda, due bracci), in %.
 *   Unita' di analisi: la coppia, non la run.
 *   Cosa conta come NULLO: se la media dei delta appaiati e' minore della loro
 *       deviazione standard, il risultato e' NULLO e va scritto come nullo.
 *   Regola di arresto: il numero di ripetizioni e' fissato dagli argomenti e non si
 *       cambia dopo aver visto i dati.
 *   Ground truth: scritta a mano leggendo i file, mai chiesta a un modello.
 *
 * I bracci differiscono SOLO per .claude/settings.json. I sorgenti hanno hash
 * identico, verificato prima della prima run.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import { CASES } from './cases.mjs';
import { transcriptFor, inspect, grade } from './lib.mjs';

// The Claude Code binary. Override with CLAUDE_BIN when it is not on PATH.
const CLAUDE = process.env.CLAUDE_BIN ?? 'claude';
const WS = process.argv[2];   // directory holding the on/ and off/ arms
const OUT = process.argv[3];  // where to append the JSONL results
const STRATA = (process.argv[4] ?? 'LARGE,SMALL,EXPLORE').split(',');
const REPS = Number(process.argv[5] ?? 2);
// La ripetizione di partenza. Serve a spezzare la batteria in piu' invocazioni senza
// che le coppie si scontrino: `id + rep` e' la chiave del confronto appaiato.
const REP_FROM = Number(process.argv[6] ?? 1);

// I casi e la loro ground truth stanno in cases.mjs, perche' li usa anche il test
// avversariale (bench/adversarial.mjs) e i due harness DEVONO interrogare gli stessi
// identici casi. Lo spostamento e' stato verificato confrontando il JSON dell'elenco
// prima e dopo: 25 casi, identici.

// La lettura del transcript e del mastro sta in lib.mjs, condivisa con il test
// avversariale: vedi li' perche' non ne esistono due copie.

/**
 * Un lock sul file dei risultati.
 *
 * Esiste perche' e' gia' successo: due batterie sono finite a scrivere sullo stesso
 * JSONL e le coppie si sono mescolate. Un dato mescolato non si ripulisce dopo, perche'
 * non si distingue piu' quale run appartiene a quale configurazione.
 */
const LOCK = OUT + '.lock';
try {
  closeSync(openSync(LOCK, 'wx'));
} catch {
  console.error(`un'altra batteria sta gia' scrivendo su ${OUT} (lock: ${LOCK}). Esco senza toccare nulla.`);
  process.exit(1);
}
const releaseLock = () => { try { unlinkSync(LOCK); } catch { /* gia' andato */ } };
process.on('exit', releaseLock);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => { releaseLock(); process.exit(130); });

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Una run, con i suoi tentativi.
 *
 * Su Windows lo spawn ravvicinato di molti processi puo' fallire subito con
 * 0xC0000142 (STATUS_DLL_INIT_FAILED): il processo muore in millisecondi senza mai
 * arrivare all'API. Non e' un esito della misura, e' un crash dell'ambiente, quindi la
 * run SI RIFA' invece di entrare nei dati come uno zero. Il numero di tentativi e la
 * condizione di validita' sono scritti qui, prima dei dati, e non si rinegoziano.
 */
function runOnce(cwd, args) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    const r = spawnSync(CLAUDE, args, { cwd, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    const ms = Date.now() - t0;
    let j = {};
    try { j = JSON.parse(r.stdout || '{}'); } catch { /* lasciato vuoto */ }
    // Valida = il processo e' uscito pulito E ha prodotto una sessione con un costo.
    // Senza sessione non c'e' ne' transcript ne' mastro, quindi non c'e' misura.
    if (r.status === 0 && j.session_id && typeof j.total_cost_usd === 'number') return { j, ms, status: r.status, attempts: attempt };
    console.error(`  tentativo ${attempt}/3 non valido (exit ${r.status}, ${ms} ms) — rifaccio`);
    sleep(4000);
  }
  return { j: {}, ms: 0, status: -1, attempts: 3 };
}

// ONLY=C4,D2 rifa' singoli casi. Serve alla regola «una run invalida si rifa', non si
// aggiusta»: senza, rifare una coppia significherebbe rifare tutto lo strato.
const ONLY = (process.env.ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const selected = CASES.filter((c) => STRATA.includes(c.stratum) && (ONLY.length === 0 || ONLY.includes(c.id)));
const total = selected.length * 2 * REPS;
console.error(`batteria: ${selected.length} casi x 2 bracci x ${REPS} ripetizioni (da rep ${REP_FROM}) = ${total} run`);

let done = 0;
for (let rep = REP_FROM; rep < REP_FROM + REPS; rep++) {
  for (const c of selected) {
    for (const arm of ['off', 'on']) {
      const cwd = join(WS, arm);
      const args = ['-p', c.prompt, '--model', 'haiku', '--output-format', 'json'];
      // Lo strato EXPLORE lascia liberi i tool di ricerca: e' il suo scopo. `Bash` resta
      // permesso apposta - se l'agente preferisce `cat` a `Read`, l'hook non lo vede, e
      // quello E' un risultato da registrare.
      args.push('--allowedTools', c.free ? 'Read Grep Glob Bash' : 'Read Glob');
      // LA DELEGA E' VIETATA, e la ragione va detta perche' e' un limite del risultato.
      // Misurato: lasciata libera, la sessione chiama il subagent `Explore`, che NON e'
      // confinato alla directory di lavoro - in una run ha risposto citando un file di
      // un progetto scollegato altrove sul disco. Quella non e' una misura del corpus,
      // e' un harness che perde. Il vincolo vale IDENTICO nei due bracci, quindi non
      // sposta il confronto; sposta pero' cio' di cui il confronto parla, e il rapporto
      // deve dire che parla di un agente che lavora in sessione.
      args.push('--disallowedTools', 'Agent Task');
      const { j, ms, status, attempts } = runOnce(cwd, args);
      const answer = (j.result || '').trim();
      const seen = j.session_id
        ? inspect(transcriptFor(j.session_id), cwd, j.session_id)
        : { tools: null, reads: [], rereadCount: 0, narrowings: 0, windows: [], notesInTranscript: 0, reasons: {}, jevCalls: 0, jevInputTokens: 0, ledgerRows: 0 };
      // La finestra ha contenuto la riga vera? Solo dove una riga vera esiste.
      const truthLines = c.line !== undefined ? [c.line] : c.lineA !== undefined ? [c.lineA, c.lineB] : [];
      const recall = truthLines.length && seen.windows.length > 0
        ? truthLines.every((L) => seen.windows.some((w) => L >= w.from && L <= w.to))
        : null;
      const rec = {
        rep, id: c.id, stratum: c.stratum, arm,
        file: c.file ?? null, fileLines: c.lines ?? null, fileBytes: c.bytes ?? null,
        synthetic: c.synthetic ?? false,
        trueLine: c.line ?? null, trueLines: truthLines.length > 1 ? truthLines : null,
        pass: grade(c, answer), answer: answer.slice(0, 140),
        cost_usd: j.total_cost_usd ?? null,
        cache_create: j.usage?.cache_creation_input_tokens ?? null,
        cache_read: j.usage?.cache_read_input_tokens ?? null,
        out_tok: j.usage?.output_tokens ?? null,
        turns: j.num_turns ?? null, ms,
        tools: seen.tools, reads: seen.reads, rereadCount: seen.rereadCount,
        narrowings: seen.narrowings, windows: seen.windows, recall,
        notesInTranscript: seen.notesInTranscript, reasons: seen.reasons,
        jevCalls: seen.jevCalls, jevInputTokens: seen.jevInputTokens, ledgerRows: seen.ledgerRows,
        session: j.session_id ?? null, exit: status, attempts,
      };
      console.log(JSON.stringify(rec));
      appendFileSync(OUT, JSON.stringify(rec) + '\n');
      done += 1;
      console.error(`  [${done}/${total}] ${rec.id}/${arm}  $${(rec.cost_usd ?? 0).toFixed(4)}  pass=${rec.pass}  narrow=${rec.narrowings}`);
      // Una pausa fra un processo e l'altro. Senza, lo spawn ravvicinato esaurisce le
      // risorse di sessione di Windows e la run successiva muore prima di partire.
      sleep(2500);
    }
  }
}
