/**
 * lib.mjs — come si legge cosa e' successo in una run. Condiviso fra i due harness.
 *
 * Sta in un file solo perche' run.mjs e adversarial.mjs DEVONO misurare con lo stesso
 * codice: due copie della lettura del mastro sono due copie che possono divergere, e
 * una divergenza silenziosa fra l'esperimento e il suo controllo avversariale e'
 * esattamente l'errore che il controllo dovrebbe scoprire.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function transcriptFor(sid) {
  const base = join(process.env.USERPROFILE || '', '.claude', 'projects');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    const p = join(base, d, sid + '.jsonl');
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Il libro mastro dell'hook: una riga per ogni Read che ha guardato, ristretto O NO.
 *
 * E' la prova PRIMARIA, e sostituisce il marcatore nel transcript come fonte. Il
 * transcript dice solo cosa e' passato al modello; il mastro dice anche PERCHE'
 * l'hook ha rinunciato, che e' meta' di quello che questa batteria deve misurare.
 */
function ledgerFor(armDir, sid) {
  const p = join(armDir, '.squint', `session-${String(sid).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)}.jsonl`);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

/** Quali tool ha usato, quante volte ha riletto lo stesso file, e cosa dice il mastro. */
function inspect(path, armDir, sid) {
  const tools = {};
  const reads = [];
  const windows = [];
  if (path && existsSync(path)) {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
        for (const c of o.message.content) {
          if (c.type !== 'tool_use') continue;
          tools[c.name] = (tools[c.name] || 0) + 1;
          if (c.name === 'Read') {
            reads.push({
              file: String(c.input?.file_path ?? '').replace(/\\/g, '/').split('/').pop() ?? '',
              offset: c.input?.offset ?? null,
              limit: c.input?.limit ?? null,
            });
          }
        }
      }
    }
    // Il marcatore nel transcript resta come controllo incrociato del mastro. Accetta
    // entrambi i prefissi: il progetto a monte scrive `JEF`, questo pacchetto `squint`.
    const re = /(?:JEF|squint) narrowed this Read: (\S+) is (\d+) lines, showing (\d+)-(\d+) \(match at line (\d+), confidence ([\d.]+)\)/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      windows.push({ file: m[1], total: +m[2], from: +m[3], to: +m[4], picked: +m[5], conf: +m[6] });
    }
  }

  const ledger = ledgerFor(armDir, sid);
  const narrowed = ledger.filter((r) => r.narrowed === true);
  // Quante volte lo STESSO file e' stato letto piu' di una volta: il bersaglio di O1.
  const byFile = {};
  for (const r of reads) byFile[r.file] = (byFile[r.file] || 0) + 1;
  const rereads = Object.values(byFile).reduce((n, c) => n + Math.max(0, c - 1), 0);

  return {
    tools,
    reads,
    rereadCount: rereads,
    narrowings: narrowed.length,
    windows: narrowed.map((r) => ({ file: r.path, total: r.totalLines, from: r.offset, to: r.offset + r.limit - 1, picked: r.pickedLine, conf: r.confidence })),
    // Il marcatore visto nel transcript, per confronto col mastro.
    notesInTranscript: windows.length,
    // Perche' l'hook ha rinunciato, e quante volte per motivo.
    reasons: ledger.reduce((acc, r) => { if (r.reason) acc[r.reason] = (acc[r.reason] || 0) + 1; return acc; }, {}),
    // Quante chiamate a Jev sono partite davvero, e quanto sono costate in token.
    jevCalls: ledger.filter((r) => typeof r.inputTokens === 'number').length,
    jevInputTokens: ledger.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
    ledgerRows: ledger.length,
  };
}

function grade(c, answer) {
  if (Array.isArray(c.truths)) return c.truths.every((t) => new RegExp('\\b' + t + '\\b').test(answer));
  if (c.truth !== null && c.truth !== undefined) return new RegExp('\\b' + c.truth + '\\b').test(answer);
  return c.must.every((re) => re.test(answer));
}

export { transcriptFor, ledgerFor, inspect, grade };
