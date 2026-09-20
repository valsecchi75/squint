# jev-narrow

**A Claude Code hook that hands the agent the part of a large file that answers your
question, instead of the whole file.**

When Claude reads a 1300-line file to find one function, all 1300 lines enter the context
and get re-sent with every later turn. This hook intercepts the read, asks a small,
cheap model which chunk actually answers what you asked, and rewrites the tool's `offset`
and `limit` before the file is opened.

```
you ask ──▶ Claude calls Read(report.ts) ──▶ [hook] ──▶ Read(report.ts, 781, 261)
                                               │
                                               └─▶ Jev: "which chunk answers this?"
                                                   c78 · confidence 0.93 · 1.5 s
```

**Measured on a paired A/B: −36% cost on the reads it fires on, 18 of 18 answers still
correct, and no separation at all on the files it cannot touch.** The full method,
including what was *not* measured, is in [docs/evidence.md](docs/evidence.md).

> **Alpha.** One author, one repository, one model. The mechanism is measured; its
> generality is not. Read [What this does not tell you](#what-this-does-not-tell-you)
> before relying on it.

---

## Why this works when prompt advice does not

This started as the salvage of a failed experiment. The original project prepended a
nine-line routing block to the prompt telling the agent which files to look at and which
to avoid. Preregistered A/B, repository frozen, control arm: **the effect came out
reversed** — the arm with the advice accumulated *more* context, and the noise was one
and a half to three times the effect.

The diagnosis is one sentence, and it is the whole reason this project exists:

> **A suggestion is ignorable by construction. A rewritten `limit` is not.**

Advice in the prompt asks the model to read less. This changes what the tool returns. The
saving does not depend on the model cooperating, or even noticing.

---

## Install

Requires **Node ≥ 20** and a [TypeSafe](https://docs.typesafe.ai) API key.

```bash
git clone https://github.com/valsecchi75/jev-narrow
cd jev-narrow
npm install
npm run install-hook        # builds, then merges the entry into .claude/settings.json
```

The key is read from the environment and from nowhere else:

```bash
# bash
export TYPESAFE_API_KEY=...
```
```cmd
:: cmd
set TYPESAFE_API_KEY=...
```

To install into a different project, point the installer at its settings file:

```bash
node dist/src/install.js install --settings /path/to/project/.claude/settings.json
```

To remove it:

```bash
npm run uninstall-hook
```

The installer **merges and never rewrites**: other hooks, permissions and keys are carried
through untouched, an uninstall removes only the entry it added, and a `settings.json` it
cannot parse is left alone rather than overwritten.

**One limitation, and it is reported rather than hidden.** The entry is added by
re-serialising the parsed file, so indentation and line endings are preserved but an
inline array or object gets expanded onto several lines. The JSON is equivalent and
nothing is lost, but a hand-formatted `settings.json` will show unrelated lines as changed
in a diff. When that happens the installer says `installed-reformatted` and prints a note
telling you to check it before committing. Preserving the original bytes exactly needs a
textual graft; that is a beta item.

### Check it works

```bash
JEV_NARROW_DEBUG=1 claude -p "Read src/big-file.ts and name the function that ..."
```

With debug on, the hook prints one line to stderr for every read — including the ones it
decided to leave alone, and why.

---

## What it costs

| | value | how |
|---|---:|---|
| per narrowing | **21.932** input tokens · **1.5 s** | ACTUAL, from the response |
| per narrowing, in money | **$0.00092** | ESTIMATED at the published rate |
| gross saving on a read it fires on | **$0.0197** | ACTUAL, from paired runs |
| **share of the gain spent on the call** | **4.7%** | derived |

---

## When it does nothing, which is often

The hook refuses far more often than it acts, and that is the design. It leaves the read
untouched when:

| condition | why |
|---|---|
| the file is under **400 lines** | the call would cost more than the narrowing saves |
| the file is over **80.000 bytes** | it would need splitting, and confidences from different sections are not comparable — measured upstream, that path loses the target 3 times in 11 |
| the agent already set `offset` or `limit` | that is its own decision about this file, and second-guessing it would also break the escape hatch |
| the transcript yields no goal | there is nothing to narrow *towards* |
| confidence is under **0.60** | see below — this is the one that matters |
| anything fails | no key, timeout, bad answer, unreadable file: the read proceeds as written |
| `narrow.enabled` is `false` | the hook still runs and still records why it did nothing |

**On the repository this was built against, the size gate alone leaves out five files in
six.** That ratio, not the −36%, is what a saving on a real working day is proportional
to. Measure your own before expecting much.

---

## The dangerous part

This is the only thing here that can **hide code**. A window that drops the answer is a
silent omission: the agent reads what it was handed and never learns the rest existed.

So recall is the only metric that counts, and it was measured on 26 hand-written targets
across five files:

| confidence floor | narrows | recall | targets lost |
|---|---:|---:|---:|
| 0.30 | 21/26 | 90% | 2 |
| 0.42 | 17/26 | **100%** | 0 |
| **0.60 — shipped** | **14/26** | **100%** | **0** |
| 0.70 | 10/26 | 100% | 0 |

All five failures scored **0.41 or below**; the worst was off by 305 lines. The upstream
project's single observed failure was at 0.42 — two independent samples, same ceiling.

The floor stays at 0.60 rather than dropping to 0.42 because lowering it buys three
narrowings out of 26 and moves the threshold to within 0.01 of the worst failure ever
seen. Five failures cannot estimate that margin.

**What that safety costs:** at 0.60 the hook refuses 12 of 26 targets, and **seven of them
would have produced a correct window**. Roughly half the available narrowings are given
up on purpose.

**One loss above the floor is on the record.** In an earlier round a window at confidence
**0.63** picked a line 133 off, and recall survived only because the window was clamped to
the end of the file. Across ~40 observed narrowings, that is one. It is pinned in a test
so whoever moves the threshold sees it first.

Every narrowing also tells the agent what happened and how to undo it:

> jev-narrow narrowed this Read: report.ts is 1307 lines, showing 781-1041 (match at line
> 911, confidence 0.93). Read it again with an explicit offset or limit to see any other
> part — nothing was removed from the file.

---

## What leaves your machine

Per narrowing, one request to `api.typesafe.ai` containing:

- **the file's contents**, split into numbered chunks — this is the point, and it is the
  thing to weigh before pointing it at a private repository;
- **the last thing you typed**, truncated to 600 characters and scrubbed;
- **the file's path**, relative to the project root, never absolute.

Never sent: your API key beyond the auth header, any file matching `.env`, `secrets/` or
`.git/`, any file you did not ask Claude to read.

**The scrub is a coarse net and its limit is stated rather than hidden.** It removes
common vendor key prefixes, long opaque strings and `key=value` pairs whose key looks like
a credential. **It will not catch a secret with no recognisable shape.** If your prompts
routinely contain such values, this hook is not for you.

The ledger stays local, in `.jev-narrow/`, and is gitignored.

---

## The ledger

Every read the hook **looked at** gets one JSONL line — narrowed or not.

```json
{"timestamp":"2026-09-20T15:04:11.482Z","sessionId":"...","path":"src/report.ts",
 "totalLines":1307,"narrowed":true,"offset":781,"limit":261,"pickedLine":911,
 "confidence":0.93,"exists":0.93,"linesAvoided":1046,"inputTokens":21935,"elapsedMs":1495}
```

The refusals are **the denominator**, and they are recorded for exactly that reason: a
ledger of successes only would report a 100% hit rate for a hook that fires on one file in
six.

`linesAvoided` is a count of **lines**, never converted to tokens. The hook knows what it
stopped from being read; it knows nothing about how those lines would tokenise. A
measurement multiplied by a guess is a guess.

---

## Configuration

Optional `.jev-narrow.json` in the project root. Every default is a measured value, and
`docs/evidence.md` says what measured it.

```json
{
  "narrow": {
    "enabled": true,
    "minLines": 400,
    "maxBytes": 80000,
    "minConfidence": 0.60,
    "windowDivisor": 5,
    "minWindow": 150,
    "maxChunks": 200,
    "chunkLines": 10,
    "minGoalChars": 12,
    "timeoutMs": 6000
  },
  "jev": { "model": "jev-latest", "host": "api.typesafe.ai" }
}
```

A missing, unreadable or malformed file is not an error: the affected fields fall back to
these defaults.

---

## What this does not tell you

- **One model.** Everything was measured on `claude-haiku-4-5`. The mechanism is
  model-independent in principle; the size of the effect is not.
- **One kind of task.** Every question was "find a function in a large file" — the case
  this is built for. Reads that skim rather than seek are not represented.
- **Small n.** Twelve pairs in the A/B, 26 targets in the calibration. The paired design
  is what lets that separate signal from noise; it is not enough to characterise a tail.
- **One repository.** The one-file-in-six eligibility rate is a property of that codebase.
- **Windows-first.** Developed and measured on Windows 11 with Node 24. Nothing in it is
  platform-specific, and nothing in it has been measured elsewhere.

---

## Credits

The policy, its six refusal conditions and its thresholds are a port of the Read hook of
**[BorisLeMeec/jev](https://github.com/BorisLeMeec/jev)** (MIT), whose author measured
them first and documented the reasoning behind each one. This project contributes an
independent TypeScript implementation, the ledger, the installer, and a fresh calibration
of the confidence floor on a different repository.

Decisions come from [Jev](https://docs.typesafe.ai), TypeSafe's System One model.

MIT. See [LICENSE](LICENSE).
