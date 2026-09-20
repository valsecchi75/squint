/**
 * placebo-hook.mjs — un hook FINTO, che comprime esattamente quanto squint e non
 * capisce niente.
 *
 * A COSA SERVE. Il risultato principale e' «restringere la lettura fa risparmiare il
 * 35% e non perde risposte». Quel risultato ha due ingredienti che la misura non
 * separa: la lettura e' piu' CORTA, e la parte che resta e' quella GIUSTA. Se il
 * risparmio venisse dalla lunghezza e le risposte sopravvivessero comunque, allora
 * qualunque troncamento andrebbe bene e squint non starebbe comprando niente con la
 * chiamata a Jev.
 *
 * Questo hook isola l'ingrediente. Applica gli STESSI cancelli di squint e produce una
 * finestra della STESSA dimensione, ma la posiziona senza mai guardare l'obiettivo: la
 * sceglie da un hash del percorso del file, che e' stabile fra le run e scorrelato da
 * cio' che l'utente ha chiesto.
 *
 * Le due previsioni, scritte prima di vedere i dati:
 *   P1  Sul COSTO il placebo deve assomigliare a squint. Comprime uguale.
 *   P2  Sulle RISPOSTE il placebo deve crollare. Se non crolla, le domande della
 *       batteria erano rispondibili senza leggere il punto giusto, e la riga
 *       «nessuna risposta persa» non dimostra quello che sembra dimostrare.
 *
 * Non fa rete, non legge configurazione, non ha una chiave. Fail-open come l'originale.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// Gli stessi numeri di DEFAULT_CONFIG in src/types.ts. Copiati apposta invece che
// importati: il placebo non deve poter cambiare quando cambia squint, altrimenti il
// confronto smette di essere fra due cose fisse.
const MIN_LINES = 400, MAX_BYTES = 80_000, WINDOW_DIVISOR = 5, MIN_WINDOW = 150;

const read = async () => {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks).toString('utf8');
};

try {
  const payload = JSON.parse((await read()) || '{}');
  const toolInput = payload.tool_input ?? {};
  const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
  const projectRoot = process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();

  if (payload.tool_name !== 'Read' || filePath === '') process.exit(0);
  if (toolInput.offset !== undefined || toolInput.limit !== undefined) process.exit(0);

  const data = readFileSync(filePath, 'utf8');
  const lines = data.split('\n');
  if (lines.length < MIN_LINES) process.exit(0);
  if (Buffer.byteLength(data, 'utf8') > MAX_BYTES) process.exit(0);

  const window = Math.max(MIN_WINDOW, Math.floor(lines.length / WINDOW_DIVISOR));
  if (window >= lines.length) process.exit(0);

  // LA POSIZIONE, e questo e' tutto il punto: viene dal percorso, non dall'obiettivo.
  // Deterministica, cosi' due run dello stesso caso ricevono la stessa finestra e il
  // confronto appaiato regge; e uniforme sugli offset leciti, cosi' non e'
  // sistematicamente in cima ne' in mezzo - due posizioni che su un file di codice
  // beccherebbero il bersaglio troppo spesso per caso.
  const span = lines.length - window;
  const h = createHash('sha256').update(basename(filePath)).digest();
  const offset = 1 + (h.readUInt32BE(0) % (span + 1));

  const note =
    `squint narrowed this Read: ${basename(filePath)} is ${lines.length} lines, showing ${offset}-${offset + window - 1} ` +
    `(match at line ${offset + Math.floor(window / 2)}, confidence 0.99). ` +
    'Read it again with an explicit offset or limit to see any other part - nothing was removed from the file.';

  try {
    const dir = join(projectRoot, '.squint');
    mkdirSync(dir, { recursive: true });
    const sid = String(payload.session_id ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
    appendFileSync(join(dir, `session-${sid}.jsonl`), JSON.stringify({
      narrowed: true, placebo: true, offset, limit: window,
      pickedLine: offset + Math.floor(window / 2), confidence: 0.99,
      linesAvoided: lines.length - window, inputTokens: 0, elapsedMs: 0,
      timestamp: new Date().toISOString(), sessionId: sid,
      path: basename(filePath), totalLines: lines.length,
    }) + '\n', 'utf8');
  } catch { /* il mastro non puo' costare una lettura */ }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { file_path: filePath, offset, limit: window } },
    additionalContext: note,
  }));
} catch {
  // Fail-open, come l'originale: qualunque errore lascia passare la lettura intatta.
}
process.exit(0);
