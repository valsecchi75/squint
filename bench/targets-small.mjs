/**
 * targets-small.mjs — i bersagli della taratura sulla fascia 150-400 righe (O6).
 *
 * LA DOMANDA: il pavimento delle 400 righe sta 2,5 volte sopra il punto di pareggio
 * del costo (156 righe, docs/optimizations.md O6). E' stato scelto da qualcosa? I 26
 * bersagli della taratura originale stanno tutti in file da 508 a 1307 righe: nessuno
 * ha mai chiesto se il chunking di un file da 250 righe - 25 chunk da 10 - produce una
 * scelta usabile come quello di un file da 1307 (131 chunk).
 *
 * Stesso metodo, stessa lingua, stesso harness (calibrate.mjs con questo modulo come
 * quarto argomento): (file, riga vera, obiettivo), scritti LEGGENDO IL CODICE il
 * 2026-09-21, mai chiesti a un modello. La riga vera e' la riga della dichiarazione
 * della funzione che implementa l'obiettivo. Dieci file, da 164 a 379 righe, tre-cinque
 * bersagli ciascuno.
 *
 * Costo dichiarato PRIMA di spendere: ~9.900 righe inviate in totale, a 16,8 token per
 * riga (21.932 / 1.307, docs/evidence.md §3) fanno ~166.000 token, cioe' ~$0,007 al
 * tasso pubblicato. ESTIMATED; l'ACTUAL sta nel JSON dei risultati (`inTok`).
 */

export const TARGETS = [
  // skill-roster.ts, 164 righe
  ['skill-roster.ts', 46, 'leggere il frontmatter YAML minimale di un file di skill'],
  ['skill-roster.ts', 128, 'costruire l elenco ordinato e senza duplicati delle skill disponibili'],
  ['skill-roster.ts', 154, 'estrarre il corpo del file di una skill tagliato a un numero di caratteri'],

  // pre-gate.ts, 171 righe
  ['pre-gate.ts', 58, 'comporre il testo della formula della chiamata evitata'],
  ['pre-gate.ts', 95, 'misurare la taglia di un task in caratteri e parole'],
  ['pre-gate.ts', 118, 'decidere se un task e abbastanza grande da meritare una chiamata'],
  ['pre-gate.ts', 165, 'verificare che un valore sconosciuto sia davvero un analisi di task'],

  // recheck.ts, 201 righe
  ['recheck.ts', 107, 'rifiutare un checkpoint che non e un intero entro il limite consentito'],
  ['recheck.ts', 127, 'costruire l esito di un recheck che non ha fatto nessuna chiamata'],
  ['recheck.ts', 150, 'eseguire un singolo recheck dalla validazione al routing'],

  // verify-format.ts, 223 righe
  ['verify-format.ts', 81, 'stabilire chi ha l ultima parola fra strumenti deterministici e Jev'],
  ['verify-format.ts', 130, 'riassumere in una riga le evidenze allegate'],
  ['verify-format.ts', 186, 'comporre il blocco di testo stampato dalla verifica'],

  // model-router.ts, 239 righe
  ['model-router.ts', 67, 'dire quale meta di una scelta di modello questa build puo applicare'],
  ['model-router.ts', 118, 'trovare la confidenza piu bassa fra le dimensioni che decidono FAST'],
  ['model-router.ts', 144, 'scegliere il tier di esecuzione e produrre la traccia delle ragioni'],

  // sanitize.ts, 257 righe
  ['sanitize.ts', 47, 'rimuovere dal testo libero le stringhe che sembrano segreti'],
  ['sanitize.ts', 105, 'rendere un percorso relativo al progetto con barre in avanti e senza segmenti di risalita'],
  ['sanitize.ts', 174, 'filtrare una lista di percorsi scartando URL ed esclusi e togliendo i duplicati'],
  ['sanitize.ts', 222, 'ripulire l intero stato prima che lasci la macchina'],

  // questions.ts, 293 righe
  ['questions.ts', 101, 'costruire le dieci domande di analisi con una dimensione ciascuna'],
  ['questions.ts', 169, 'costruire la scelta ampia fra tutte le skill piu le tre domande di gate'],
  ['questions.ts', 206, 'generare le coppie di domande a favore e contro per ogni ipotesi'],
  ['questions.ts', 273, 'costruire il secondo passaggio di riordino sulla lista ristretta di skill'],

  // repository-index.ts, 317 righe
  ['repository-index.ts', 63, 'decidere se un percorso puo entrare nell indice'],
  ['repository-index.ts', 93, 'raggruppare i file per directory ed estensione in un indice ordinato'],
  ['repository-index.ts', 157, 'percorrere il filesystem quando git non puo elencare i file'],
  ['repository-index.ts', 241, 'calcolare la chiave di freschezza della cache dell indice'],
  ['repository-index.ts', 282, 'caricare l indice dalla cache se fresca altrimenti ricostruirlo'],

  // state-store.ts, 365 righe
  ['state-store.ts', 51, 'rendere sicuro l identificatore di sessione usato come nome di file'],
  ['state-store.ts', 148, 'trovare lo stato di sessione scritto piu di recente'],
  ['state-store.ts', 181, 'scrivere lo stato di sessione in modo atomico tramite rinomina'],
  ['state-store.ts', 277, 'normalizzare il testo di un task per confrontarne l identita'],
  ['state-store.ts', 313, 'decidere se riusare l analisi gia memorizzata per lo stesso task'],

  // hook-read.ts, 379 righe
  ['hook-read.ts', 92, 'ricavare l ultimo messaggio scritto dall utente dal transcript'],
  ['hook-read.ts', 151, 'costruire il record di ledger di un restringimento'],
  ['hook-read.ts', 176, 'il punto di ingresso del hook che legge stdin e decide se restringere'],
];
