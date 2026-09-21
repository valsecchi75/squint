<div align="center">

# squint

**Claude reads the part of the file that answers your question, not the whole file.**

[![beta](https://img.shields.io/badge/status-beta-blue)](#what-this-does-not-tell-you)
[![tokens](https://img.shields.io/badge/new%20tokens%20on%20reads%20it%20fires%20on-−47%25-3fb950)](#1-does-it-save-anything)
[![cost](https://img.shields.io/badge/cost%20on%20those%20reads-−37%25-3fb950)](#1-does-it-save-anything)
[![recall](https://img.shields.io/badge/target%20inside%20the%20window-19%20of%2019-3fb950)](#2-does-it-hide-code)
[![runs](https://img.shields.io/badge/measured%20on-184%20paired%20runs-3fb950)](#the-evidence)
[![tests](https://img.shields.io/badge/tests-108%20passing-3fb950)](#develop)
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
<summary><b>What the installer touches</b></summary>

<br>

It **merges, never rewrites**. Other hooks, permissions and keys are carried through
untouched; an uninstall removes only the entry it added; a `settings.json` it cannot
parse — or cannot read at all — is left alone rather than overwritten.

**The entry is spliced into your file's bytes, not re-printed.** A hand-formatted
`settings.json` — inline arrays, tabs, CRLF, no final newline, keys in your own order —
comes back with every line you wrote intact, and an uninstall returns it byte for byte.
The splice is never trusted on its own: the result is re-parsed and compared with the
merge it was supposed to produce, and on any disagreement the installer falls back to
re-serialising the whole file **and says so**:

```
squint · install · installed-reformatted · /path/.claude/settings.json
  note: your settings.json was hand-formatted and has been re-printed.
  The JSON is equivalent and nothing was lost, but unrelated lines will
  show as changed in a diff. Check it before committing.
```

The one known way to reach that fallback is a file with duplicate keys.

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
<summary><b>Same design on a second model — it transfers, and it is cleaner</b></summary>

<br>

`LARGE` and `SMALL` re-run unchanged on **`claude-opus-5`**: same cases, same hand-written
ground truth, same hash-verified arms. `[ACTUAL]` 30 runs, $4.17.

| | haiku (19 pairs) | **opus (10 pairs)** |
|---|---:|---:|
| fire rate on `LARGE` | 19/20 | **10/10** |
| new tokens read | −47.5% ±9.0% (5.3×) | **−40.2% ±8.4% (4.8×)** |
| **cost** | −36.8% ±13.3% (2.8×) | **−35.8% ±7.9% (4.5×)** |
| target inside the window | 19/19 | **10/10** |
| `SMALL` control | 0/10 fired, null | **0/5 fired, null** |
| cost per run | $0.0344 | $0.1390 |

**The cost saving is the same number twice** on models that differ fourfold in price. Opus
is also the cleaner instrument: half the spread on cost, a third on the control, so the
same effect separates at 4.5× the noise instead of 2.8×.

**One answer was lost on opus, and it is not what it looks like.** `install-settings.ts`,
true answer at line 493, window 416–565 — it *contained* the answer. The model returned
the function at line 464 instead, also inside the window. squint did not hide anything;
the model picked the neighbour. **A correct window is necessary, not sufficient.**

</details>

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
| you are **editing** code, not reading it | **2/31** |
| you search a knowledge base instead of naming the page | **0/21** |

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
10 windows and still answered 10 of 10, better than either real arm.

Two explanations survived that, so both were tested. Asking the same ten questions with
**every reading tool forbidden** scored **0 of 10** — the questions genuinely need the
file, so the quality column is not hollow. What the placebo was doing is **recovering**.

> A correct window does **not** preserve the answer — re-reading does. A correct window
> preserves the **saving**.

### 5. Real work: reading or editing?

Everything above is a benchmark — one question, one named file, one session. Real work was
tried too: four development tasks on a real codebase, and eight consultations over a
346-page documentation corpus written by other people. The result splits along a line that
was not in the design.

| what you are doing | reads seen | narrowed | narrowing undone? | cost |
|---|---:|---:|---|---|
| **editing code** | 31 | **2** | **yes — 100% of the file re-read** | null |
| **consulting a named page** | 3 | **2** | **no — 20% of the page read** | −27.4% ±22.2% |
| **consulting, page not named** | 21 | **0** | — | null |

**Editing undoes it.** An agent that modifies a file has to understand it, so it reads the
rest. Both narrowings were reversed within a turn or two — in one case the agent read the
*exact complement* of the window immediately.

**Consulting holds.** Ask about a named page and the window sticks: no follow-up reads,
a fifth of the page, both answers right.

**But only if the page is named.** Searching a knowledge base, squint fired **0 times in
21 reads** — 17 of them passed as `agent-set-window`, because an agent that finds a fact
with `Grep` then reads a 20-line slice. *The better your retrieval, the less there is to
narrow.*

> **If you keep a wiki or a second brain**, two things decide whether squint can help you.
> First, write **structured** notes: the gates (≥400 lines *and* <80,000 bytes) require an
> average line under 200 bytes, so headings, lists and tables pass while flowing prose
> **can never** pass — it hits the byte ceiling before the line floor. Second, squint only
> acts once the agent has already chosen a file; it does nothing for *finding* the page.
>
> On structured docs the locate step is actually **better** than on code — it would narrow
> **75%** of targets against 50%, with 100% recall on what it narrows. But its two failures
> scored 0.45 and **0.59** against a floor of **0.60**: a margin of **0.01**, where code has
> 0.19. Re-calibrate upward on your own corpus before trusting it there.

### 6. The failure this does not protect you from

The hook aims the window at **the last thing you typed**. Every measured session has one
user turn, so the goal is always about the read in progress. Real sessions are not like
that.

Tested offline: hand the locate step a goal belonging to a *different* function in the
same file, then check the window against what the read actually needs.

| | result |
|---|---:|
| windows containing what the read needed | **0 / 11** |
| expected by chance | ~22% |
| **cases where the hook would have narrowed anyway** | **11 / 11** |
| confidence in those cases | 0.60 – **0.98** |

Zero is *worse* than chance: a stale goal pulls the window deterministically away from
everything else in the file. **And the confidence floor cannot see it** — confidence
measures certainty about which chunk matches *this goal*, not whether the goal has
anything to do with the read.

How often that happens in real work is **not measured**. What is measured is that when it
happens, nothing stops it, and the ledger will record a confident narrowing that looks
exactly like a good one. Full write-up and the cheapest mitigation:
[`docs/evidence.md`](docs/evidence.md) §6.

---

### 7. The code audit before beta

Two defects, both found by reading the code and both confirmed by measurement before
being believed. Both were **orderings**, which is the kind of bug review finds and tests
do not.

| what was wrong | how it showed | after the fix |
|---|---|---:|
| the file was read **before** the hook asked whether it needed it | a 40 MB path under `Secrets/` was pulled into memory and refused afterwards: 43 ms → **89 ms** | 43 → **45 ms**, and an excluded path is now never opened at all |
| `squint off` wrote `.squint.json` wherever you were standing | run from a subdirectory it wrote `src/deep/.squint.json`, which the hook never reads — it printed `off` and narrowing stayed **on** | the CLI and the hook resolve the project root the same way |

The project rule is that `Secrets/` is *never read and never sent*. Only the second half
of that was true; now both are, and the test that guards it asks the hook to narrow a
path under `Secrets/` **that does not exist** — if it ever reads before deciding again,
the answer becomes "unreadable" instead of "excluded" and the test fails.

A third defect surfaced while writing the test for the second: walking up the tree for a
project marker finds `~/.claude`, which exists on every machine that has ever run Claude
Code, so any unmarked directory under home resolved to *home*. `squint off` would have
written `~/.squint.json` and disabled narrowing everywhere. Guarded and tested.

**One latent defect is recorded and left alone.** `lastUserMessage` takes any message
with the `user` role, and not all of them are typed by you — a compaction summary, a
message from another session, an interruption notice all arrive in that role. Measured
across every transcript on the development machine: **0 of 23** reads that squint could
have acted on carried such a goal. The hole is real in the code and unobserved in the
data, and at n=23 the upper bound is roughly 12%. It is written down rather than patched
on a guess.

**Correction, one day later: that count was wrong, and the defect is not rare.** The
detector did not know Claude Code's own label for a harness-written message. Re-measured
on 381 transcripts and **457 real reads**: **64 goals (14.0%) were never typed** — 40
were the body of a skill the harness had injected, 21 were a subagent's task
notification. On the reads whose file the hook would actually act on, 5 of 145 (3.4%).
The ledger now records who wrote the goal (`goalSource`) and how old it was
(`goalAgeTurns`); **nothing branches on either yet**, and what the data would support is
stated in [`docs/evidence.md`](docs/evidence.md) §6-ter.

**A second audit, the day after.** A ceiling on calls per session (default 50 — no real
session has made more than 1), the byte-for-byte installer above, and three more
orderings: a chunk count answered after the transcript was paid for, an installer that
took "cannot read" for "does not exist" and wrote anyway, and `squint off` replacing a
`.squint.json` it could not parse. All in [`docs/evidence.md`](docs/evidence.md)
§6-quater.

Fail-open was re-checked end to end against the compiled binary, not the source: six
refusal paths including an unparseable payload, all **exit 0, empty stdout, Read
untouched**. After the reorder a live call still narrows — `report.ts` to lines 481–741
around a target at 614, confidence 0.89 — and still refuses a *correct* pick at 0.49,
because the floor is 0.60 and that is the trade it is there to make.

---

## When it does nothing, which is often

The hook refuses far more often than it acts. That is the design, not a shortfall.

| it leaves the read alone when | why |
|---|---|
| the file is under **400 lines** | inherited, and **not justified by cost**: the break-even is ~156 lines ([`optimizations.md`](docs/optimizations.md) O6). The band below was then measured — 37 of 37 targets in 164–379-line files landed inside the window, with *smaller* pick errors than above ([`evidence.md`](docs/evidence.md) §2-bis) — so the floor is now justified by neither cost nor risk. It stays at 400 until it is deliberately moved: the one unmeasured cost is ~350 ms on every read of a small file |
| the session has already paid for **50 calls** | a bound on a runaway, not a tuned value: no measured session made more than 1. Recorded as `budget-spent`, never silent |
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
- **the last message that carried your role**, truncated to 600 characters and scrubbed.
  Measured on 457 real reads, 14% of the time that is not something you typed but
  something the harness injected under your name — most often the body of a skill, which
  begins with an absolute path. The scrub does not remove a username. See §7;
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
 "confidence":0.93,"exists":0.93,"linesAvoided":1046,"inputTokens":21935,"elapsedMs":1495,
 "goalAgeTurns":2,"goalSource":"user"}
```

`goalAgeTurns` is how many assistant turns separated your last message from this read;
`goalSource` says whether that message was typed by you or written by the harness under
your role. Both are recorded and **neither is acted on** — they exist so the distribution
can be seen before any rule is written against it.

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
    "timeoutMs": 6000,
    "maxCallsPerSession": 50
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
- **The goal can be stale — now measured, and it is the real defect.** 11 of 11 windows
  built from a stale goal hide what the read needs, at confidence up to 0.98. What is
  still unmeasured is how often that happens in real work. See §5 above.
- **Delegation is excluded, by choice.** A free agent calls a subagent that is not
  confined to the working directory — one run answered by citing a file from an unrelated
  project elsewhere on disk. The open-ended numbers therefore describe an agent working
  in-session.
- **Time is not improved.** −0.5% with a spread of 35.9%: null. squint buys tokens, not
  speed.
- **Two models now, not one.** The benchmark ran on `claude-haiku-4-5`; the same design
  was re-run unchanged on `claude-opus-5` (−35.8% ±7.9% cost against −36.8% ±13.3%, fire
  rate 10/10), and the real-work and consultation tests were opus throughout. The effect
  transfers. A third model is still unmeasured.
- **One kind of task.** "Find a function in a large file" is the case this is built for.
  Reads that skim rather than seek are not represented.
- **Small n where it is smallest.** Nineteen fired pairs carry the headline, four the
  oversize control, eight the open-ended rate. The paired design separates signal from
  noise at those sizes; it does not characterise a tail.
- **One repository.** The one-file-in-six eligibility rate is a property of that codebase.
- **The goal can also be a message you never wrote — and it is, 14% of the time.** A
  skill body, a subagent's notification or a compaction summary arrives with the `user`
  role and would be aimed at like any goal. Measured on 457 real reads: 64 such goals,
  5 of them on files the hook would have acted on. Recorded in the ledger, not yet
  guarded against. See §7.
- **Windows-first.** Developed and measured on Windows 11, Node 24. Nothing in it is
  platform-specific, and nothing in it has been measured elsewhere.

---

## Develop

```bash
npm run typecheck     # tsc --noEmit
npm test              # build, then node --test  (108 tests)
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

## Versions

Every version is a git tag. What each one changed is stated with the measurement that
motivated it, never without.

| version | date | what changed | tests |
|---|---|---|---:|
| **0.1.0-beta.2** | 2026-09-21 | A ceiling on Jev calls per session (`maxCallsPerSession`, 50, refusal `budget-spent`). The installer splices its entry into `settings.json` byte for byte and verifies the splice. The band below the 400-line floor calibrated: 37/37 targets inside the window ([§2-bis](docs/evidence.md)). The ledger records who wrote the goal: measured on 457 real reads, 14% of goals were written by the harness, not the user ([§6-ter](docs/evidence.md)). Three ordering defects fixed. | 108 |
| 0.1.0-beta.1 | 2026-09-21 | Beta. The hook decides before it reads: an excluded path is never opened (43 → 45 ms on a 40 MB file, was 89). `squint off` writes where the hook reads. The goal's age recorded in the ledger. | 85 |
| 0.1.0-alpha | 2026-09-20 | The hook, the ledger, the installer, `/squint`, and the evidence: 184 paired runs, −47% new tokens and −37% cost on the reads it fires on, the placebo and stale-goal controls. | 61 |

Beta means: measured, published, and used on one machine. Not yet: a third model, a
second repository, or a rule that acts on the stale-goal measurements.

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
