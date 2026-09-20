<div align="center">

# squint

**Claude reads the part of the file that answers your question, not the whole file.**

[![alpha](https://img.shields.io/badge/status-alpha-orange)](#what-this-does-not-tell-you)
[![tokens](https://img.shields.io/badge/new%20tokens%20on%20reads%20it%20fires%20on-−47%25-3fb950)](#1-does-it-save-anything)
[![cost](https://img.shields.io/badge/cost%20on%20those%20reads-−37%25-3fb950)](#1-does-it-save-anything)
[![recall](https://img.shields.io/badge/target%20inside%20the%20window-19%20of%2019-3fb950)](#2-does-it-hide-code)
[![runs](https://img.shields.io/badge/measured%20on-130%20paired%20runs-3fb950)](#the-evidence)
[![tests](https://img.shields.io/badge/tests-61%20passing-3fb950)](#develop)
[![node](https://img.shields.io/badge/node-%E2%89%A520-blue)](#install)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

---

A 1300-line file read to find one function puts all 1300 lines in the context — and
context is re-sent with every later turn, so you pay for it again and again.

This is a `PreToolUse` hook. It intercepts the read, asks a small fast model which chunk
actually answers what you asked, and **rewrites the tool's `offset` and `limit`** before
the file is opened.

```
you ask ──▶ Claude calls Read(report.ts) ──▶ [hook] ──▶ Read(report.ts, 781, 261)
                                               │
                                               └──▶ Jev: "which chunk answers this?"
                                                    c78 · confidence 0.93 · 1.5 s
```

Claude is then told exactly what happened, and how to undo it:

> squint narrowed this Read: report.ts is 1307 lines, showing 781-1041 (match at line
> 911, confidence 0.93). Read it again with an explicit offset or limit to see any other
> part — nothing was removed from the file.

---

## Why this works when telling the model to read less does not

This project is the salvage of a failed experiment.

The original attempt prepended a nine-line routing block to the prompt, naming the files
to look at and the ones to avoid. Preregistered A/B, repository frozen, control arm.
**The effect came out reversed**: the arm with the advice accumulated *more* context
(36,980 tokens against 34,024), and the noise was 1.5 to 3.4 times the effect.

The diagnosis is one sentence, and it is the reason this repository exists:

> **A suggestion is ignorable by construction. A rewritten `limit` is not.**

Advice asks the model to read less. This changes what the tool hands back. The saving
does not depend on the model cooperating, or on it noticing.

---

## Install

Needs **Node ≥ 20**, Claude Code, and a [TypeSafe](https://docs.typesafe.ai) API key.

**Four commands.** Clone anywhere you keep tools — the clone is not your project, and
squint is not installed *into* a project's source.

```bash
git clone https://github.com/valsecchi75/squint
cd squint
npm install
npm run install-hook          # turns it on for EVERY project you open
```

Then the key. `squint key` asks for it once and stores it in your **user** environment, so
every terminal and every Claude Code session inherits it:

```bash
node dist/src/bin.js key
```

squint never stores the key itself, never logs it, and never prints it back — not even a
prefix, because a prefix in a log is still a leak. If you would rather set it by hand:

```cmd
setx TYPESAFE_API_KEY "your-key"
```
```bash
export TYPESAFE_API_KEY=your-key       # in ~/.bashrc or ~/.zshrc
```

Open a **new** terminal so the variable is picked up, then `cd` to any project and use
Claude Code normally. There is nothing to run per project.

<details>
<summary><b>Turning it on for one project instead of all of them</b></summary>

<br>

`npm run install-hook` writes to your user settings (`~/.claude/settings.json`), which is
what makes it apply everywhere. To scope it to a single project:

```bash
node dist/src/install.js install --project /path/to/your/project
node dist/src/install.js install --settings /exact/path/to/settings.json
```

`uninstall` takes the same flags and removes it from the same place.

**Do not install it into the clone of this repository.** Claude Code reads the settings of
the project you are *working in*, which is never this one, so the entry would sit there
doing nothing. That used to be the default and it was wrong; the default is now your user
settings.

</details>

Remove it with `npm run uninstall-hook`. The uninstall is a command you can actually run,
not a paragraph in a README.

<details>
<summary><b>What the installer touches, and the one thing it gets wrong</b></summary>

<br>

It **merges, never rewrites**. Other hooks, permissions and keys are carried through
untouched; an uninstall removes only the entry it added; a `settings.json` it cannot parse
is left alone rather than overwritten.

**The limitation, reported rather than hidden.** The entry is added by re-serialising the
parsed file. Indentation and line endings are preserved, but an inline array or object
gets expanded onto several lines. The JSON is equivalent and nothing is lost — but a
hand-formatted `settings.json` will show unrelated lines as changed in a diff. When that
happens the installer says so:

```
squint · install · installed-reformatted · /path/.claude/settings.json
  note: the entry was added, but your settings.json was hand-formatted and has
  been re-printed. The JSON is equivalent and nothing was lost - but unrelated
  lines will show as changed in a diff. Check it before committing.
```

Preserving the original bytes exactly needs a textual graft. That is a beta item.

</details>

### Check it is working

```bash
node dist/src/bin.js doctor
```

```
squint · doctor

  [ok] Node >= 20         found 24.14.0
  [ok] built              dist/src/hook.js is present
  [ok] TYPESAFE_API_KEY   present in the environment
  [ok] hook registered    /home/you/.claude/settings.json

  Ready. Open a project and use Claude Code normally.
```

For the reads themselves, `SQUINT_DEBUG=1` makes the hook print one line per read —
**including the ones it decided to leave alone, and why**.

---

## `/squint`, inside Claude Code

Installing also adds a `/squint` command, because a hook with no surface is a hook you
cannot debug. When a read is not narrowed you want to know whether the key is missing, the
file was too small, or the model was unsure — and "nothing happened" looks identical in
all three.

| | |
|---|---|
| `/squint` | what it has done here, then whether anything is misconfigured |
| `/squint report` | the ledger for this project |
| `/squint doctor` | the four checks above |
| `/squint off` · `/squint on` | stop and resume narrowing **here**, without uninstalling |

```
squint · report · /home/you/projects/api

  sessions            1
  reads looked at     1
  of those, narrowed  0  (0%)
  lines not read      0   ACTUAL, a line count - never converted to tokens
  Jev input tokens    21,944   ACTUAL, what the decisions cost

  left alone, and why  (these are the denominator, not failures)
       1  low-confidence
```

That is a real report from a real session, and it is worth reading twice. **One read, no
narrowing, and 21,944 tokens spent on the decision anyway.** The hook asked, the model was
not sure enough, and it left the file alone — the safe outcome, and not a free one. The
report says so rather than showing you a saving you did not get.

`off` is not an uninstall: the hook stays registered and keeps recording that it was asked
and declined. Those are different things to want.

---

## The evidence

Everything below was measured on 2026-09-20, Claude Code `2.1.110`, model
`claude-haiku-4-5`. Raw data: [`docs/calibration.json`](docs/calibration.json). Method and
caveats: [`docs/evidence.md`](docs/evidence.md).

Round two: **100 paired runs** across five strata, plus a **30-run adversarial pass**
built to break the result. Raw data is published, not summarised:
[`docs/data/battery.jsonl`](docs/data/battery.jsonl),
[`docs/data/adversarial.jsonl`](docs/data/adversarial.jsonl),
[`docs/calibration.json`](docs/calibration.json). The harness is
[`bench/`](bench/README.md). **11 sessions were discarded and the reasons are written
down** — see [`docs/evidence.md`](docs/evidence.md) §0.

What was analysed and deliberately **not** built:
[`docs/optimizations.md`](docs/optimizations.md) — five of eleven ideas refuted by the
data, including two that looked obviously right.

Two labels, never mixed. **ACTUAL** = read from a response or a log. **ESTIMATED** =
computed with a formula printed beside it. No percentage appears without its baseline.

### 1. Does it save anything?

A **paired** A/B: two working directories with byte-identical sources, differing only in
`.claude/settings.json`. The same question goes to both, and the pair is the unit of
analysis — so every question is its own control.

![Paired A/B results](docs/img/ab.svg)

**Large files, one question, hook fired — 19 pairs.** The only row that describes the
mechanism.

| per run | without squint | with squint | difference | verdict |
|---|---:|---:|---:|---|
| **new tokens read** | 21,292 | **10,775** | **−47.5%** ±9.0% | separates, 5.3× the spread |
| **cost** | $0.0385 | **$0.0235** | **−36.8%** ±13.3% | separates, 2.8× the spread |
| **wall-clock time** | 15.8 s | 13.5 s | −0.5% ±35.9% | **null** |
| answers correct | 17/19 | **18/19** | — | nothing lost |
| tokens spent at Jev | 0 | 14,965 | — | 19 calls, 19 sessions |

Cost fell in **19 of 19** pairs, new tokens fell in **19 of 19**, and the window contained
the true line in **19 of 19**.

**The rows that make that one believable** are the ones where the hook cannot act:

| population | pairs | cost delta | fired | verdict |
|---|---:|---:|---:|---|
| Large files, hook did not fire | 1 | −0.3% | 0/1 | **null** |
| **Small files** (< 400 lines) | 10 | +6.8% ±16.0% | **0/10** | **null ✓** |
| **Huge files** (> 80,000 bytes) | 4 | +23.0% ±57.5% | **0/4** | **null ✓** |

Two independent gates, no separation at either. Had they separated, the saving on large
files would not have been attributable to the narrowing.

**Time does not improve, and the badge does not claim it does.** squint buys tokens, not
speed: it adds a ~1.5 s call and removes reading time, and the net is indistinguishable
from zero.

**The saving moves the bill, it does not delete it.** The ~10,500 tokens Claude does not
read become ~15,000 tokens read by Jev. They cost far less — the ratio is about 27:1 —
but they are a second vendor and a second invoice.

> **Measure `cache_creation_input_tokens`, not total input tokens.** Summing them with
> `cache_read` reports *null* on data where the mechanism works perfectly: `cache_read` is
> the cached system prompt, tens of thousands of tokens identical in both arms, and it
> moves for reasons that have nothing to do with the file. See
> [`docs/evidence.md`](docs/evidence.md) §1.

<details>
<summary><b>Round one — 12 pairs, kept so the second round can be checked against it</b></summary>

<br>

| population | pairs | mean delta | spread | verdict |
|---|---:|---:|---:|---|
| **Large files, hook fired** | 9 | **−37.3%** | 10.4% | separates, 3.6× |
| Large files, hook did not fire | 3 | +1.0% | 12.3% | null |
| Large files, all together | 12 | −27.7% | 20.1% | separates, 1.4× |
| **Small files — negative control** | 6 | **−2.5%** | 6.3% | **null ✓** |

**The row never to quote alone is the third.** `−27.7%` averages two populations that
behave in opposite ways and describes neither.

Round one's post-fix figure was **−36.0%** where it fires. Round two's **−36.8%** on 19
pairs sits inside that interval, hours later, on rebuilt instrumentation.

</details>

<details>
<summary><b>The bug this battery found, and the before/after</b></summary>

<br>

Of 12 eligible reads the hook fired on 9. The three misses were not prudent refusals — the
ledger recorded them as failed calls at **3006** and **3003 ms**: the timeout itself. One
success had landed at **2920 ms**, 80 ms short of failing.

A borrowed number was the cause. The narrowing request carries the file (~22,000 input
tokens); the small classification call it inherited its timeout from carries a compact
state (~8,000). One threshold over two distributions was discarding a quarter of the
narrowings.

| | timeout 3000 | timeout 6000 |
|---|---:|---:|
| fired, of eligible reads | 9/12 | **11/12** |
| aggregate delta | −27.7% (sd 20.1%) | **−33.8%** (sd 13.3%) |
| pairs in the same direction | no, two directions | **all twelve** |
| delta where it fired | −37.3% | −36.0% |
| timeouts | 2 | **0** |
| successful latencies | 1142–2920 ms | 1115–**1767** ms |

**A caveat that has to be stated.** The delta *where it fires* does not move. The fix does
not make the mechanism better, it makes it **more often available**. And the second
round's latencies are all under 1767 ms while the first had three above 1861 — a change in
the tail a timeout cannot produce. Part of the improvement is network or load conditions,
and with one round per condition it is not separable. What is established is narrower: a
3000 ms threshold **was being hit**, and is not any more.

</details>

### 2. Does it hide code?

This is the only metric that counts. Compression without recall is worthless, because a
window that drops the answer is a **silent omission** — the agent reads what it was handed
and never learns the rest existed.

![Confidence calibration](docs/img/calibration.svg)

26 targets — `(file, true line, goal)` — across five files of 508 to 1307 lines, with the
goals **written by hand from reading the code** and never asked of a model.

| confidence floor | narrows | recall | targets lost | coverage |
|---|---:|---:|---:|---:|
| 0.30 | 21/26 | 90% | 2 | 81% |
| 0.40 | 18/26 | 94% | 1 | 69% |
| 0.42 | 17/26 | **100%** | 0 | 65% |
| 0.50 | 16/26 | **100%** | 0 | 62% |
| **0.60 — shipped** | **14/26** | **100%** | **0** | 54% |
| 0.70 | 10/26 | 100% | 0 | 38% |

**All five failures scored 0.41 or below**, the worst off by 305 lines. The upstream
project's single observed failure was at **0.42** — two independent samples, same ceiling.

The floor stays at 0.60 rather than dropping to 0.42 because lowering it buys three
narrowings out of 26 and puts the threshold within 0.01 of the worst failure ever seen.
Five failures cannot estimate that margin.

**What the safety costs, plainly:** at 0.60 the hook refuses 12 of 26 targets, and **seven
of those would have produced a correct window**. Roughly half the available narrowings are
given up on purpose.

**One loss above the floor is on the record.** In an earlier round a window at confidence
**0.63** picked a line 133 off; recall survived only because the window was clamped to the
end of the file. Across ~40 observed narrowings, that is one. It is pinned in a test, so
whoever moves the threshold meets it first.

**Accuracy of the pick:** median error **8 lines**, minimum 0. The window is 150 lines or a
fifth of the file, centred on the pick, so it forgives about ±75.

### 3. What it costs, and what it is proportional to

![What the saving is proportional to](docs/img/coverage.svg)

| | value | label |
|---|---:|---|
| per narrowing, across 31 calls | 14,408 input tokens · 1.5 s | ACTUAL |
| per narrowing, in money | $0.00060 | ESTIMATED |
| gross saving on a read it fires on | $0.0150 | ACTUAL |
| **share of the gain spent on the call** | **4.0%** | derived |

> Round one published **21,932** tokens per call. That figure is real but it is the cost
> on the *largest* file in the corpus. Measured across the files an agent actually opens,
> the average is **14,408** — 63% of it.

**The size gate alone leaves out five files in six** (40 eligible of 230 on the repository
this was built against). And eligibility is only the ceiling. Round two measured how often
an eligible read actually happens:

| what you are doing | reads narrowed |
|---|---:|
| you name a large file and ask for one thing | **19/20** |
| you ask for **two** things far apart in the same file | **2/8** |
| you ask an open-ended question and name no file | **1/8** |

**That last row is the honest headline for a working day.** The −37% is real and it
applies to a narrow situation. On open-ended work, over 29 real source files, an
in-session agent produced a narrowable read once in eight sessions.

### 4. Trying to break it

A result only ever tested by the experiment built to find it has not been tested. Two
attacks, predictions written before the runs, 30 runs on the same ten cases.

**Attack 1 — was it just the running order?** Every pair in the battery runs `off` first.
Prompt caching persists between runs, so the "saving" could be the advantage of going
second. Re-run with `on` first:

| | forward (`off` → `on`) | **reversed** (`on` → `off`) |
|---|---:|---:|
| new tokens | −47.5% ±9.0% | **−37.4% ±20.9%** |
| cost | −36.8% ±13.3% | **−30.2% ±17.0%** |

**It survives — and it shrinks.** Running second is worth something. The true effect is
somewhere around **−30% to −37%**, and the headline sits at the optimistic end of it.

**Attack 2 — was it the compression, or the aim?** A third arm mounts a sham hook: same
gates, **same window size**, position picked from a hash of the filename. It never sees
the goal. Predicted hit rate from geometry, written down first: 2 in 10. Measured: 2 in 10.

| per run | without squint | **squint** | **placebo** |
|---|---:|---:|---:|
| Reads issued | 1.1 | **1.1** | **1.8** |
| turns | 2.2 | **2.2** | **3.1** |
| cost vs. without | — | **−30.2%** | **−4.9% → null** |
| target inside the window | — | 8/10 | 2/10 |
| answers correct | 9/10 | 9/10 | **10/10** |

**The saving comes from the aim, not the compression.** The placebo compresses identically
and saves *nothing*: the agent sees the window lacks what it needs and reads again — 1.8
reads instead of 1.1 — and the recovery eats the entire gain.

**And "no answers lost" is weaker than it looks.** The placebo missed the target in 8 of
10 windows and still answered 10 of 10, better than either real arm. The quality column
does not prove the window was right; it proves **the escape hatch works**. That is a
genuine property — squint tells the agent how to undo it, and the agent does — but it is
not the property the number appears to claim.

---

## When it does nothing, which is often

The hook refuses far more often than it acts. That is the design, not a shortfall.

| it leaves the read alone when | why |
|---|---|
| the file is under **400 lines** | inherited, and **not justified by cost**: the break-even is ~156 lines ([`optimizations.md`](docs/optimizations.md) O6). What 400 buys is margin against a risk nobody has measured below 508 lines |
| the file is over **80,000 bytes** | it would need splitting, and confidences from different sections are not comparable — measured upstream, that path loses the target 3 times in 11. Claude Code's own ceiling (25,000 tokens ≈ 84,900 bytes) sits just above it |
| the agent already set `offset` or `limit` | that is its own decision about this file, and overriding it would break the escape hatch too |
| the transcript yields no goal | there is nothing to narrow *towards* |
| confidence is under **0.60** | see [§2](#2-does-it-hide-code) |
| the path looks like `.env`, `secrets/`, `.git/` | it must never leave the machine |
| anything fails | no key, timeout, bad answer, unreadable file — the read proceeds as written |

Failure is always **fail-open**. The exit code is always 0 and `permissionDecision` is
never emitted: this narrows, it never blocks.

---

## What leaves your machine

Per narrowing, one request to `api.typesafe.ai` carrying:

- **the file's contents**, split into numbered chunks — this is the point, and the thing to
  weigh before pointing it at a private repository;
- **the last thing you typed**, truncated to 600 characters and scrubbed;
- **the file's path**, relative to the project root, never absolute.

Never sent: your key beyond the auth header, any file matching `.env` / `secrets/` /
`.git/`, any file you did not ask Claude to read.

**The scrub is a coarse net and its limit is stated, not hidden.** It removes common vendor
key prefixes, long opaque strings, and `key=value` pairs whose key looks like a credential.
**It will not catch a secret with no recognisable shape.** If your prompts routinely carry
such values, this hook is not for you.

The ledger stays local in `.squint/` and is gitignored.

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

`linesAvoided` counts **lines**, never converted to tokens. The hook knows what it stopped
from being read; it knows nothing about how those lines would tokenise. A measurement
multiplied by a guess is a guess.

---

## Configuration

Optional `.squint.json` in the project root. Every default is a measured value, and
[`docs/evidence.md`](docs/evidence.md) says what measured it.

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

- **In free-form work it rarely fires: once in eight sessions.** Everything headline above
  is the case where Claude reads a *named* large file. That case is not most of a working
  day, and now the gap is measured rather than guessed.
- **The goal can be stale, and the battery cannot see it.** The hook aims the window at
  the last thing *you* typed. Every measured session has exactly one user turn, so the
  goal is always fresh. In a real session it can be twenty turns back and about something
  else, and the window would be aimed at it anyway. **This is the largest risk in the
  design and it is unmeasured.**
- **Delegation is excluded, by choice.** A free agent calls a subagent that is not
  confined to the working directory — one run answered by citing a file from an unrelated
  project elsewhere on disk. The open-ended numbers therefore describe an agent working
  in-session.
- **Time is not improved.** −0.5% with a spread of 35.9%: null. squint buys tokens, not
  speed.
- **One model.** All of it ran on `claude-haiku-4-5`. The mechanism is model-independent in
  principle — it changes what the tool returns, not what the model decides — but the size
  of the effect is not.
- **One kind of task.** "Find a function in a large file" is the case this is built for.
  Reads that skim rather than seek are not represented.
- **Small n where it is smallest.** Nineteen fired pairs carry the headline, four the
  oversize control, eight the open-ended rate. The paired design separates signal from
  noise at those sizes; it does not characterise a tail.
- **One repository.** The one-file-in-six eligibility rate is a property of that codebase.
- **Windows-first.** Developed and measured on Windows 11, Node 24. Nothing in it is
  platform-specific, and nothing in it has been measured elsewhere.

---

## Develop

```bash
npm run typecheck     # tsc --noEmit
npm test              # build, then node --test  (61 tests)
npm run build
```

`src/policy.ts` is pure: it imports types and nothing else, and a test asserts that against
the file's own source. A policy that reads a file to decide whether to spend a call has
already spent something.

```
src/policy.ts     the refusal ladder, chunking, window — no I/O
src/hook.ts       stdin → decision → updatedInput, fail-open throughout
src/jev.ts        one call, raced against its own budget
src/ledger.ts     JSONL, path shortening, the scrub
src/config.ts     .squint.json, fail-open
src/install.ts    merge into .claude/settings.json, and back out
src/cli.ts        doctor, report, on/off, key - the dispatcher is a pure function
src/bin.ts        the executable, so cli.ts never has to spawn a process to test
```

---

## Credits

The policy, its six refusal conditions and its thresholds are a port of the Read hook of
**[BorisLeMeec/jev](https://github.com/BorisLeMeec/jev)** (MIT), whose author measured them
first and documented the reasoning behind each one. This repository contributes an
independent TypeScript implementation, the ledger, the installer, and a fresh calibration
of the confidence floor on a different codebase.

Decisions come from [Jev](https://docs.typesafe.ai), TypeSafe's System One model.

Measurement, adversarial testing and this write-up: **[agent1.it](https://agent1.it)**.

MIT — see [LICENSE](LICENSE).
