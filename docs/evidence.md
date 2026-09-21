# Evidence

Two rounds of measurement, both on 2026-09-20, on Claude Code build `2.1.110`, with
`claude-haiku-4-5` as the model under test and `jev-latest` as the decider.

- **Round one** — 12 pairs, three strata. Kept below, unchanged, so the second round can
  be checked against it rather than replacing it quietly.
- **Round two** — **100 runs** across five strata, a **30-run adversarial pass** built to
  break the result, a **10-run floor control** with all reading forbidden, and an offline
  probe of the one failure the battery cannot see. `[ACTUAL]` $3.4354 + $1.0052 + $0.2488,
  plus cents of Jev calls.
- **After beta, 2026-09-21** — no new sessions. A 37-target calibration of the band below
  the 400-line floor (§2-bis, `[ACTUAL]` 168.305 Jev input tokens, ~$0.007), an offline
  replay of 381 real transcripts for who wrote the goal and how old it was (§6-ter, free),
  and a second code audit (§6-quater).

**The short version, if you read nothing else.** The saving is real, survives having its
arm order reversed, and is attributable to the window being *aimed* rather than merely
*short* — a placebo that compresses identically saves nothing. The quality claim is
weaker than it looks: what preserves the answer when the window is wrong is the agent
**re-reading**, not the window being right. And there is one failure mode the whole
battery is blind to — a **stale goal** — which produces a confident, precise, wrong
window in 11 cases out of 11, at confidences up to 0.98. See §5 and §6.

Two labels are used throughout and never mixed. **ACTUAL** means read from a response or
a log. **ESTIMATED** means computed with a formula that is printed next to it. No
percentage appears without the baseline it is a percentage of.

The rule that decides what counts as a result was written before the runs and is not
negotiable after them: **if the mean paired delta is smaller than its standard deviation,
the result is null and is written as null.** It is at the top of
[`../bench/run.mjs`](../bench/run.mjs).

---

## 0. What was thrown away, and why

`[ACTUAL]` **11 sessions, $0.5661, discarded.** They are archived rather than deleted.
Four of the five causes were defects in the harness, not in squint, and each one would
have produced a plausible-looking number that meant nothing.

| what went wrong | how it was caught | what it would have done |
|---|---|---|
| The arms inherited a `CLAUDE.md` from a parent directory | a run answered by citing `wiki/tech-stack.md`, a file not in the corpus | the agent answers from the real project instead of the controlled corpus |
| The `Explore` subagent left the workspace | a run answered by citing a file in an unrelated project elsewhere on disk | the measurement describes no corpus at all |
| Two batteries wrote the same output file | rows from two configurations interleaved; 4 runs also died to a Windows spawn failure (`0xC0000142`) | pairs silently mixed across configurations, unrecoverable after the fact |
| The synthetic oversize files were inside the exploratory corpus | `file-too-large` appeared in the ledger of an `EXPLORE` run | the open-ended stratum stops being comparable to round one |
| One open-ended prompt made **both** arms refuse to work | one turn, no tools, "tell me which folder to start from" | a void pair counted as a measurement |

A fifth defect was found before any money was spent and is worth recording because it is
the kind that hides: **the harness looked for the wrong marker.** It searched the
transcript for `JEF narrowed this Read`, while this package writes `squint narrowed this
Read`. Every fired pair would have been classified as "hook did not fire". The fix
replaced the transcript marker with the hook's own **ledger** as the primary source —
which also turned out to see things the transcript cannot, including reads made inside a
subagent.

`[ACTUAL]` One run of the final battery was redone after a Windows spawn failure. The
harness retries a run that produces no session rather than recording a zero, because a
crash is not an outcome of the measurement.

---

## 1. Does it save anything?

A paired A/B. Three working directories with byte-identical sources — verified by hash
before the first run — differing **only** in `.claude/settings.json`. The same question
is asked in each, and the pair is the unit of analysis, so each question is its own
control.

Ground truth for each question is the exact name of a function, **written by hand from
reading the file**. The answer passes only if it contains that name.

### The table

**Large files, question about one thing, hook fired — 19 pairs.** This is the situation
squint is built for, and the only row that describes the mechanism.

| per run | without squint | with squint | difference | verdict |
|---|---:|---:|---:|---|
| **new tokens read** | 21.292 | **10.775** | **−47.5%** ±9.0% | separates, 5.3× the spread |
| **cost** | $0.0385 | **$0.0235** | **−36.8%** ±13.3% | separates, 2.8× the spread |
| **wall-clock time** | 15.8 s | 13.5 s | −0.5% ±35.9% | **null** |
| tokens served from cache | 61.991 | 64.053 | +6.9% ±33.5% | **null** |
| tokens written | 1.142 | 726 | −12.0% ±41.3% | **null** |
| answers correct | 17/19 | **18/19** | — | nothing lost |
| tokens spent at Jev | 0 | 14.965 | — | 19 calls in 19 sessions |

**All nineteen pairs move the same way, on both metrics.** Cost fell in 19 of 19; new
tokens fell in 19 of 19; and the window contained the true line in **19 of 19**.

| | | | | |
|---|---|---|---|---|
| A2 −50% | A3 −46% | A4 −24% | A5 −35% | A6 −6% |
| A7 −29% | A8 −37% | A9 −60% | A10 −27% | A1 −46% |
| A2 −49% | A3 −38% | A4 −24% | A5 −45% | A6 −40% |
| A7 −47% | A8 −41% | A9 −39% | A10 −16% | *(cost, per pair)* |

Confidences ranged 0.62 to 0.98, median 0.91.

### The three rows that make the first one believable

| population | pairs | cost delta | fired | verdict |
|---|---:|---:|---:|---|
| Large files, hook **did not** fire | 1 | −0.3% | 0/1 | **null** — same files, same question |
| **Small files** (< 400 lines) | 10 | +6.8% ±16.0% | **0/10** | **null** ✓ |
| **Huge files** (> 80.000 bytes) | 4 | +23.0% ±57.5% | **0/4** | **null** ✓ |

Two independent gates where the hook *cannot* act, and the arms do not separate at
either. Had they separated, the saving on large files would not have been attributable
to the narrowing. Answer quality on small files: 10/10 in both arms.

### Round one, kept for comparison

| population | pairs | mean cost delta | spread | verdict |
|---|---:|---:|---:|---|
| Large files, hook fired | 9 | −37.3% | 10.4% | separates, 3.6× |
| Large files, hook did not fire | 3 | +1.0% | 12.3% | null |
| Large files, everything together | 12 | −27.7% | 20.1% | separates, 1.4× |
| Small files — negative control | 6 | −2.5% | 6.3% | null ✓ |

Round one also established, by re-measuring after the `narrow.timeoutMs` fix, a fire rate
of 11/12 and a delta where it fires of −36.0%. **Round two's −36.8% on 19 pairs sits
inside round one's interval on a sample twice the size.** The two rounds were run hours
apart, on different arm directories, with a harness whose instrumentation had been
rebuilt in between.

### A correction to how tokens were counted

The first version of the token table summed `cache_creation_input_tokens` and
`cache_read_input_tokens` and reported **null** — on data where the mechanism was working.
`cache_read` is the cached system prompt, `[ACTUAL]` 58.395 tokens identical in both arms,
and it multiplies whenever a session takes extra turns for reasons unrelated to the file.
That constant and that noise bury the signal.

What squint can actually move is `cache_creation_input_tokens`: content the model has not
seen before, which is the file. That is what **new tokens read** means above, and
`cache_read` is shown beside it rather than mixed into it.

**This matters beyond bookkeeping.** A reader who measures "total input tokens" on their
own repository and sees nothing has not disproved the mechanism — they have measured a
quantity the mechanism does not touch.

---

## 2. Does it hide code?

This is the only metric that matters, and compression is worthless without it. A window
that drops the answer is a **silent omission**: the agent reads what it was handed and
never learns the rest existed.

### The calibration, now run twice

26 targets — `(file, true line, goal)` — across five files of 508 to 1307 lines, **written
by hand from reading the code** and never asked of a model. Each one calls the same locate
step the hook uses and records whether the window the hook *would have produced* contains
the true line. No Claude sessions are involved, so it costs cents: `[ACTUAL]` 395.703
input tokens in round two, latencies 349–4069 ms.

**The same 26 targets were run twice, hours apart.** That was not the plan; it is the
single most useful thing in this section, because it says how much of a threshold
estimate is signal.

| | round one | round two |
|---|---:|---:|
| windows containing the target | 21/26 | 22/26 |
| outcomes that flipped between rounds | — | **1 of 26** |
| mean drift in confidence | — | **0.04** (max 0.13) |
| targets where the chosen line was **identical** | — | **24 of 26** |

The locate step is close to deterministic. One target flipped —
`install-settings.ts:633`, whose pick moved from 142 lines off to 8 — and everything else
reproduced. A threshold tuned on one of these rounds would be tuned on nearly the same
data as the other.

### Where the floor belongs, on 52 observations

`[ACTUAL]` Pooling both rounds: **43 of 52 windows contained the target.** The nine
failures scored, worst first: **0.41, 0.36, 0.34, 0.34, 0.33, 0.24, 0.23, 0.22, 0.21**.

| confidence floor | narrows | recall | targets lost | coverage | margin above worst failure |
|---|---:|---:|---:|---:|---:|
| 0.30 | 44/52 | 89% | 5 | 85% | −0.11 |
| 0.40 | 35/52 | 97% | 1 | 67% | −0.01 |
| 0.42 | 34/52 | **100%** | 0 | 65% | +0.01 |
| 0.50 | 31/52 | **100%** | 0 | 60% | **+0.09** |
| **0.60 — shipped** | **26/52** | **100%** | **0** | **50%** | **+0.19** |
| 0.70 | 20/52 | 100% | 0 | 38% | +0.29 |

**The ceiling of failure has not moved.** Round one's worst was 0.41, round two's 0.36,
upstream's single observed failure 0.42. Three independent samples put it in the same
place, and 0.41 remains the worst of 52.

**Why the floor stays at 0.60.** Dropping to 0.42 buys 8 more narrowings out of 52 and
leaves **0.01** between the floor and the worst failure ever seen. Nine failures cannot
estimate that margin. The gain is modest, the way of being wrong is hiding code, and the
two are not commensurable.

**0.50 is the defensible middle, and it is on the record rather than adopted.** It buys 5
narrowings out of 52 at 100% recall with a **0.09** margin. Moving a shipped threshold is
not something this round was designed to justify, so it has not been moved.

**What the floor costs, stated plainly.** At 0.60 the hook refuses 26 of 52 targets, and
**18 of those would have produced a correct window**. Half the available narrowings are
the price of the margin. That is a declared trade-off, not a hidden defect.

### Accuracy of the pick

Over 52 observations the chosen line sat a **median of 8 lines** from the true one,
minimum 0, maximum 305. Above the 0.60 floor: **median 6, maximum 52** (n=26). The window
is 150 lines or a fifth of the file, centred on the pick, so it forgives roughly ±75 —
past the worst error seen above the floor, and nowhere near the outliers below it.

### Two signals that were tested and do not work

Round two recorded the **full probability distribution** over chunks, not just its
maximum, so two long-standing ideas could be settled with data instead of intuition.

| | correct windows (n=22) | windows that lost the target (n=4) | separates? |
|---|---:|---:|---|
| confidence | 0.20 – 0.97 | 0.21 – 0.36 | overlaps, but the failures have a **ceiling** |
| **gap** (top chunk − second) | 0.04 – 0.97 | 0.00 – 0.27 | **no** — a correct window scored 0.04 |
| `exists` noul | 0.55 – 0.95 | 0.30 – 0.94 | **no** — a lost target scored 0.94 |

The `gap` idea was that confidence says how *probable* the top chunk is but not how
*isolated* it is. Measured, it adds nothing: every two-signal rule of the form
`conf ≥ a AND gap ≥ g`, or `conf ≥ 0.60 OR gap ≥ g`, lands on the same
(narrowings, recall) frontier that a single lower threshold already reaches —
`conf ≥ 0.60 OR gap ≥ 0.30` gives 15/26 with zero losses, and so does `conf ≥ 0.50`
with one parameter instead of two.

The `exists` noul is confirmed unusable on our own sample, independently of upstream: a
window that lost its target scored **0.94**. It stays recorded and unused, because it
rides in the same request and costs `[ESTIMATED]` about 0.1% of it.

---

## 2-bis. The floor re-measured below 400 lines: the chunking holds

Date: 2026-09-21. The 400-line floor was inherited, and [`optimizations.md`](optimizations.md)
O6 showed it is **not set by cost** — the break-even is about 156 lines. What remained
was a risk nobody had measured: every calibration target above sits in a file of 508 to
1307 lines, cut into 51–131 chunks. A 250-line file becomes 25 chunks of 10 lines, and
whether a Choice over that behaves like one over 131 was an open question.

**The test.** 37 new targets in ten files of **164 to 379 lines**, written by hand from
reading the code on 2026-09-21 ([`bench/targets-small.mjs`](../bench/targets-small.mjs)),
run through the same `calibrate.mjs` and the same policy as the hook. Raw data in
[`data/calibration-small.json`](data/calibration-small.json). Cost declared before
spending: `[ESTIMATED]` ~166.000 input tokens, ~$0.007. `[ACTUAL]` **168.305 input
tokens**, 4.549 per call, latencies 302–921 ms, median **350 ms**.

| | 508–1307 lines (26 targets, round two) | **164–379 lines (37 targets)** |
|---|---:|---:|
| chunks per file | 51–131 | **17–38** |
| windows containing the target | 22/26 | **37/37** |
| narrowings at the 0.60 floor | 12/26 | 24/37 |
| recall above the floor | 12/12 | **24/24** |
| pick error, median, all targets | 8 lines | **5 lines** |
| pick error above the floor, median / worst | 6 / 42 | **4 / 16** |
| worst error anywhere | 305 (below the floor) | 57 (at 0.42, below the floor) |
| input tokens per call | 15.219 | 4.549 |
| latency, median | 613 ms | 350 ms |
| share of the file the window reads | 20–29% | 39–91%, median 58% |

The floor curve on the new band, for comparison with §2:

| confidence floor | narrows | recall | worst error among them |
|---|---:|---:|---:|
| 0.42 | 32/37 | 100% | 57 |
| 0.50 | 28/37 | 100% | 16 |
| **0.60 — shipped** | **24/37** | **100%** | **16** |
| 0.70 | 23/37 | 100% | 16 |

**What this establishes.** The risk objection is not supported by this sample. Fewer,
shorter chunks did not produce a worse choice: the pick error is *smaller* than on large
files, above the floor and overall, and no window lost its target. One caveat is stated
rather than hidden: recall is easier here by construction, because the 150-line minimum
window covers 39–91% of a file this size. The pick error is the number that this does not
flatter, and it is median 4, worst 16 above the floor.

**What it does not establish.** That the floor should move, and to where. The cost table
in O6 says the band from 156 to 400 lines has positive expected value; this section says
the band is not riskier than the one above it; what neither says is whether a call of
~350 ms on every eligible Read is worth a saving of 25% of a 200-line file. Per ERR-028 a
threshold is not moved in the round that measured it. **`minLines` stays at 400 in this
commit**, and the data to decide otherwise now exists.

Two smaller observations, recorded because they were not predicted. The floor refuses
unevenly across the band — 6/7 targets pass it under 200 lines, 10/17 between 200 and
300, 8/13 above — and all three targets in `hook-read.ts` were refused (0.27–0.43) on
correct or near-correct picks, the same shape §2 reports as the cost side of the floor.

---

## 3. What it costs to run

`[ACTUAL]` Across 31 narrowing calls in the battery, one call averaged **14.408 input
tokens**, ranging 8.565 to 21.968. The whole 100-run battery sent **446.659 tokens** to
Jev.

**This corrects a figure published after round one.** That round reported 21.932 tokens
per call. That number is real, but it is the cost on `report.ts`, the largest file in the
corpus. Measured across the files an agent actually opens, the average is **14.408**, or
63% of it.

`[ESTIMATED]` At the published input rate, 14.408 tokens is **$0.00060** per narrowing,
against a gross saving of about **$0.0150** on the read it fires on — the call consumes
**4.0%** of the gain. Two constants follow, and they are used throughout
[`optimizations.md`](optimizations.md):

| | value | formula |
|---|---:|---|
| cost per line **sent to** Jev | `$7.039e-7` | `$0.00092 / 1307` |
| value per line **not read by** Claude | `$1.883e-5` | `$0.0197 / (1307 − 261)` |

The ratio is **27:1**. Asking Jev is cheap; the lines it saves are expensive. That ratio
is the reason most optimizations of the Jev side are chasing very little.

Output from Jev is not billed at the time of writing. The rate carries no effective date
on the published page, which is why every figure derived from it is labelled ESTIMATED
rather than ACTUAL.

---

## 4. How often it can fire at all

`[ACTUAL]` On the TypeScript repository this was developed against, the size gate
(≥ 400 lines **and** < 80.000 bytes) is satisfied by **40 of 230** readable files — about
**one file in six**.

**That ratio is an upper bound, and round two measured how far below it reality sits.**

| situation | eligible reads that were narrowed |
|---|---:|
| you name a large file and ask for one thing | **19/20** |
| you ask for **two** things far apart in the same file | **2/8** |
| you ask an open-ended question and name no file | **1/8** |

### 4-bis. The open-ended test — round one, which produced nothing

Round one put two open-ended questions to both arms and got **no comparison**: one run
delegated the whole job to a subagent, another invoked a skill and stopped to ask for a
git repository, and across four runs **not one narrowing was observed**.

**Part of that finding was an instrument error.** The observation was made by searching
the transcript for the narrowing note. A subagent's reads do not appear there. When round
two's ledger-based instrument watched the same situation, it recorded a delegated run in
which the hook looked at **five** reads and narrowed one. The claim "not one narrowing
happened" was made with a tool that could not have seen one.

### 4-ter. The open-ended test — round two, with delegation blocked

Round two ran four open-ended questions, twice each. Delegation was **forbidden**
(`--disallowedTools "Agent Task"`), identically in both arms, because a free session calls
the `Explore` subagent and that subagent is not confined to the working directory. The
limit is therefore declared rather than hidden: **these numbers describe an agent working
in-session.**

| | without squint | with squint |
|---|---|---|
| tools chosen | Read×11, Glob×7, Grep×6, Skill×1, Bash×1 | Read×10, Glob×5, Grep×5, Bash×2 |
| reads the hook looked at | — | **8** |
| why it did not narrow | — | `file-too-small`×4, `low-confidence`×3 |
| **narrowings** | — | **1** |

Every cost difference in this stratum is **null**: −13.8% with a spread of 35.8%. One
pair came in at −49% **with zero narrowings**, which is the clearest possible
demonstration that these deltas are exploration variance and not mechanism.

**The answer-quality column here is unusable, and saying why is more useful than the
column.** It reads 7/8 against 5/8. Of the three apparent losses: one run was **void** —
the agent declined the task, wrote no tools and left an empty ledger — and two are
**grading artifacts** on one case whose answer correctly named `shouldEscalate` in
`escalation.ts` but did not contain the literal word the regex wanted. That case fails in
the *without-squint* arm too. On the cases where both arms did the work and the grader
means something, quality was **5/5 in both arms**.

**What this establishes.** On an open-ended question, over a corpus of 29 real source
files, an in-session agent produced an eligible, narrowable read **once in eight
sessions**. The −36.8% is real and it applies to a slice of a working day that is
**small**, and now measured rather than unknown.

### 4-quater. Two targets in one file — and the answer to the caching idea

Eight sessions asked for two functions hundreds of lines apart in the same file. The
hypothesis being tested was that squint pays for the same decision twice.

`[ACTUAL]` **Across all 50 sessions with squint on, zero made more than one call to Jev.**
Nineteen made none, thirty-one made exactly one. **A cache would have eliminated 0 calls.**

The reason is visible in the ledger. Twelve reads in the ON arm were re-reads of a file
already read, and seven of them arrived **with an explicit offset** — the escape hatch the
narrowing note offers the agent. `preflight` passes those untouched with reason
`agent-set-window`, and no call is made. The feature that was going to be optimised away
is already prevented by a line in the note.

The other half of this stratum is a genuine limitation: **6 of 8 sessions were not
narrowed at all**, three of them refused for `low-confidence`. A goal naming two distant
targets produces an ambiguous choice, and squint declines. Safe, and worth nothing.

### 4-quinquies. Oversize files, and a ceiling nobody put there

The hook refuses files over 80.000 bytes, and the ledger confirms it: `file-too-large` on
every ON run, zero narrowings, arms not separated.

While measuring it, the platform answered a question that had not been asked. The
without-squint arm received this, verbatim:

> `File content (30523 tokens) exceeds maximum allowed tokens (25000). Use offset and
> limit parameters to read specific portions of the file, or search for specific content
> instead of reading the whole file.`

`[ACTUAL]` 103.688 bytes measured as 30.523 tokens — 3.40 bytes per token — so Claude Code's
own ceiling of 25.000 tokens falls at roughly **84.900 bytes**. squint's `maxBytes` is
**80.000**. The two nearly coincide: **squint refuses just before the platform refuses on
its own**, and tells the agent nothing the platform would not have told it.

The oversize files were **synthetic**, and declared as such: no real file in the corpus
exceeds 57.433 bytes, so two were built by concatenating real sources. Two of the four
without-squint runs in the first repetition also stalled on a security prompt triggered by
Windows-path strings inside those synthetic files; those runs were rerun, not adjusted.

---

## 5. Trying to break it

A result that has only been tested by the experiment designed to find it has not been
tested. Two attacks were built, their predictions written down before the runs, and both
were run on the same ten large-file cases: 30 runs, `[ACTUAL]` $1.0052.

### Attack 1 — was it just the running order? **No.**

Every pair in the main battery runs `off` first and `on` second. Prompt caching is state
that persists between runs, so if the first run pays to build the cache and the second
reads it back at a tenth of the price, the "saving" would be the advantage of going
second and would appear with no hook at all.

The attack runs `on` **first**.

| | main battery (`off` → `on`) | reversed (`on` → `off`) |
|---|---:|---:|
| new tokens | −47.5% ±9.0% (n=19) | **−37.4% ±20.9%** (n=10) |
| cost | −36.8% ±13.3% (n=19) | **−30.2% ±17.0%** (n=10) |
| verdict | separates, 2.8× | **separates, 1.8×** |

**The saving survives reversal.** It is not an artifact of the order.

**But it shrinks, and that is worth saying.** −30.2% against −36.8%, with a wider spread.
Running second does appear to be worth something. The honest reading is that the true
effect lies somewhere around **−30% to −37%**, and the single headline figure sits at the
optimistic end of its own range.

### Attack 2 — was it the compression, or the *aim*? **The aim.**

A third arm mounts a sham hook ([`placebo-hook.mjs`](../bench/placebo-hook.mjs)): same
gates, same window size, position chosen from a **hash of the filename** — it never sees
the goal. If the saving comes from the window being *shorter*, the placebo should
reproduce it.

Before the runs, the geometry gave a prediction: the window is a fifth of the file, so a
blind window should contain the target about **2 times in 10**. Measured: **2 of 10**,
exactly.

| per run | without squint | **squint** | **placebo** |
|---|---:|---:|---:|
| Reads issued | 1.1 | **1.1** | **1.8** |
| turns | 2.2 | **2.2** | **3.1** |
| new tokens read | 21.715 | **13.463** | 16.847 |
| cost | $0.0380 | **$0.0263** | $0.0362 |
| paired cost delta vs. off | — | **−30.2% ±17.0%** | **−4.9% ±32.5% → null** |
| target inside the window | — | 8/10 | **2/10** |
| **answers correct** | 9/10 | 9/10 | **10/10** |

**Two findings, and they pull in opposite directions.**

**The cost saving is attributable to the aim, not to the compression.** The placebo
compresses identically by construction and saves **nothing** — its delta is null. The
reason is in the Read count: the agent notices the window does not contain what it needs
and **reads again**, 1.8 times instead of 1.1, 3.1 turns instead of 2.2. The recovery
consumes the whole saving. Cutting the file in a random place is not a cheap version of
cutting it in the right place; it is not a saving at all.

**The "no answers lost" claim is weaker than it looks, and this is the finding to take
away.** The placebo missed the target in 8 of 10 windows and still answered **10 of 10**
correctly — better than either real arm. So the quality column does **not** demonstrate
that the window was right. It demonstrates that **the escape hatch works**: the note tells
the agent it can re-read with an explicit offset, and the agent does.

That reframes what the recall figure in §2 is for. Recall says the window contained the
answer. It does **not** carry the weight of "and otherwise the answer would have been
lost", because the measured behaviour when the window is wrong is *recovery at extra
cost*, not a wrong answer. On this corpus, with these questions, and with an agent that
is allowed to read again.

**The caveat that has to be stated.** The placebo ran third in each triple, the position
Attack 1 suspects is advantaged. That bias works **against** the conclusion drawn here:
the placebo had the comfortable slot and still failed to save. And ten cases is ten cases.

### Attack 3 — could the questions be answered without reading at all? **No.**

The placebo answering 10 of 10 while missing 8 of 10 windows left two explanations
standing, with opposite consequences: either the agent **recovers**, or the questions
were answerable **without the file**, in which case the whole quality column measures the
model rather than the mechanism.

The same ten questions were asked with every reading tool forbidden — no `Read`, no
`Grep`, no `Glob`, no `Bash`. `[ACTUAL]` **0 of 10 correct**, $0.2488.

| condition | answers correct | what it means |
|---|---:|---|
| nothing may be read | **0/10** | the questions genuinely require the file |
| the window is wrong (placebo) | 10/10 | the agent re-reads and recovers |
| the window is right (squint) | 18/19 | answers preserved, and the saving kept |

**So the recovery explanation is the right one, and the quality column is not hollow.**
The precise statement the data supports is narrower than the headline and worth having in
one sentence:

> A correct window does **not** preserve the answer — recovery does that. A correct
> window preserves the **saving**.

### What survived, and what did not

| claim | status after the attacks |
|---|---|
| new tokens fall on reads it fires on | **holds** — reversed order, −37.4%, separates |
| cost falls on reads it fires on | **holds, at a lower figure** — −30.2% reversed vs −36.8% forward |
| the saving comes from the narrowing | **holds, and is now attributable** — identical compression with a blind aim saves nothing |
| time improves | never claimed; null in both the battery and the attack |
| no answers are lost | **holds but does not discriminate** — the placebo loses none either |
| the window being *correct* is what preserves the answer | **not established** — recovery, not recall, is doing the work |


---

## 1-bis. The same design on a second model: it transfers, and it is cleaner

Everything in §1 ran on `claude-haiku-4-5`. That was listed under "what was not
measured", because a mechanism can be model-independent in principle — it changes what
the tool returns, not what the model decides — and still have an effect size that is not.
So `LARGE` and `SMALL` were re-run unchanged on **`claude-opus-5`**: same cases, same
hand-written ground truth, same arms, hash-verified. `[ACTUAL]` 30 runs, $4.17.

| | haiku (19 fired pairs) | **opus (10 fired pairs)** |
|---|---:|---:|
| fire rate on `LARGE` | 19/20 | **10/10** |
| **new tokens read** | −47.5% ±9.0% — separates 5.3× | **−40.2% ±8.4% — separates 4.8×** |
| **cost** | −36.8% ±13.3% — separates 2.8× | **−35.8% ±7.9% — separates 4.5×** |
| wall-clock time | −0.5% ±35.9% — null | +9.7% ±23.1% — null |
| target inside the window | 19/19 | **10/10** |
| answers correct | 17/19 → 18/19 | 10/10 → **9/10** |
| `SMALL` control — fired | 0/10 ✓ | **0/5 ✓** |
| `SMALL` control — cost | +6.8% ±16.0% — null | **+1.9% ±4.7% — null** |
| cost per run | $0.0344 | $0.1390 |

**The cost saving is the same number twice: −36.8% and −35.8%**, measured hours apart on
models that differ fourfold in price. The token saving is smaller on opus (−40.2% against
−47.5%), which is what one would expect from a model that writes more per turn: the file
is a smaller share of what enters the context.

**Opus is the cleaner instrument.** Its spread is half as wide on cost (7.9% against
13.3%) and a third as wide on the negative control (4.7% against 16.0%), so the same
effect separates at **4.5×** the noise instead of 2.8×. A more deterministic model makes
a paired A/B easier to read, not harder.

### The one answer that was lost, and why it is not what it looks like

`[ACTUAL]` On opus the ON arm answered 9 of 10 against the OFF arm's 10 of 10 — the first
quality regression in the whole project. It is worth stating exactly, because the safety
claim of this package rests on recall:

> `A9` · `install-settings.ts`, 738 lines. True answer `graftJefHooks` at line **493**.
> The window was **416–565** and **contained it** (`recall: true`). The model answered
> `graftHookGroup` — the function at line **464**, also inside the window.

**squint did not hide the answer; it was in the window, and the model picked the
neighbour.** Both candidates were visible, with their doc comments. This is a distinct
failure from the one the confidence floor guards against, and it means something the
earlier rounds could not show:

> **A correct window is necessary, not sufficient.** Recall says the answer was available.
> It does not say the model used it.

One observation. It is recorded rather than explained away, and it is the reason the
quality column is reported beside recall instead of in place of it.

Raw data: [`data/battery-opus.jsonl`](data/battery-opus.jsonl). Re-run the comparison with
`node bench/compare-models.mjs docs/data/battery.jsonl docs/data/battery-opus.jsonl`.

---

## 5-bis. Real work: it depends on whether you are *reading* or *editing*

Everything above is a benchmark. Sections 1 to 5 ask one question per session and read one
named file. Real work is not like that, so it was tried: four development tasks on a real
TypeScript codebase, and eight consultations on a 346-page documentation corpus written by
third parties. `[ACTUAL]` $6.69 + $4.07, all paired, all hash-verified.

**The result splits cleanly along a line that was not in the design, and it is the most
useful thing on this page for deciding whether to install squint.**

| | reads the hook saw | narrowed | was the narrowing undone? | cost |
|---|---:|---:|---|---|
| **Editing code** (4 tasks) | 31 | **2** | **yes, 2 of 2 — 100% of the file re-read** | null |
| **Consulting docs, page named** (4) | 3 | **2** | **no, 0 of 2 — 20% of the file read** | −27.4% ±22.2% |
| **Consulting docs, page not named** (4) | 21 | **0** | — | null |

### Editing: the narrowing is undone

An agent that modifies a file has to understand it, so it reads the rest. Both narrowings
in the development tasks were completely reversed, and the ledger shows how:

```
APP1   hook gives    742-939   of 991
       agent reads     1-200, 200-499, 500-749, 935-991
       union           1-991   = 100%

P4     hook gives      1-208   of 1041
       agent reads   208-1041  ← the exact complement, the very next turn
       union           1-1041  = 100%
```

The same content entered the context either way, split across more reads, plus a Jev call
paid for nothing. In APP1 the ON arm's `cache_read` went **up 9.7%**: the narrowing did not
remove context, it added turns.

**Beware the cost column here.** The negative control — a refactor where the hook made
**zero** calls and **zero** narrowings — still came out at **−22.1% cost, −27.3% tokens**,
because the two arms chose different designs (one put a shared type guard in a 698-line
file, the other created a 9-line one). That is the noise floor of a single development
pair: **anything under about 22% on one pair is not attributable to anything.**

### Consulting: it holds

Ask a question about a *named* page and the narrowing sticks. Two narrowings, **zero**
subsequent reads of the same file, 20% of the page read instead of all of it, both answers
correct, target inside the window both times.

### But only if the page is named

When the agent has to find the page among 346, squint never fires. Of 21 reads it looked
at: **`agent-set-window` 17**, `file-too-small` 4. An agent that locates a fact with `Grep`
then reads a 20-line slice — and squint passes explicit windows through by design.

> **The better your retrieval, the less there is to narrow.** This is not a defect; it is
> the same escape hatch working. But it means a well-indexed second brain is the case where
> squint helps *least*, and a bare "open this page and answer" is where it helps most.

`[ACTUAL]` One of the eight consultations failed in **both** arms — 42 turns, $0.94 — a
question the agent could not resolve. It is counted, not excluded.

---

## 5-ter. Does prose locate as well as code? Better — with less margin

The locate step was calibrated a third time, on **16 hand-written targets across five
documentation pages written by third parties** (plugin docs installed on the machine, not
this project's own writing). Same method as §2, `[ACTUAL]` 204.405 input tokens, cents.

| | code (52 obs.) | documentation (16 obs.) |
|---|---:|---:|
| recall overall | 43/52 — 83% | 14/16 — **88%** |
| **would narrow at the 0.60 floor** | 26/52 — 50% | **12/16 — 75%** |
| recall on what it narrows | 100% | **100%** |
| median pick error | 8 lines | **7 lines** |
| **worst failure** | 0.41 | **0.59** |

**Structured prose locates better than code and clears the floor half again as often.**

**And the safety margin is nearly gone.** The two failures scored 0.45 and **0.59** against
a floor of **0.60** — a margin of **0.01**, where code has 0.19. The argument that rejected
lowering the floor to 0.42 for code applies here in reverse: on documentation the shipped
floor is only just sufficient, on two observed failures. Anyone running squint over a
knowledge base should re-calibrate upward on their own corpus, not downward.

### The gate is calibrated for code, and prose exposes it

Requiring **≥400 lines** *and* **<80.000 bytes** together imposes something never written
down: **the average line must be under 200 bytes.**

| | lines | bytes | bytes/line | can it ever pass? |
|---|---:|---:|---:|---|
| TypeScript source | 10.393 | 441.150 | **42** | yes, wide band |
| structured docs (headings, tables, code blocks) | 1.156 | 69.700 | **60** | yes |
| flowing prose (`wiki/product/decisions.md`) | 651 | 133.819 | **206** | **never** |

At 206 bytes per line a page hits the byte ceiling *before* reaching the line floor. That
is not a threshold to retune — it is a geometric impossibility, and it comes from
calibrating on code.

`[ACTUAL]` eligibility measured across six corpora: TypeScript source 6/29 (21%), our own
wiki **0/20**, this project's docs 9/65 (14%), bundled skills 11/73 (15%), user skills
17/83 (20%), installed plugins **203/1257 (16%)**.

**Documentation is about as eligible as code — roughly one page in six — except where the
writing is flowing prose, where it is never eligible.** Our own wiki scores zero partly
because it enforces line caps.

---

## 6. The failure the battery cannot see — measured separately, and it is real

Every session in the battery has exactly **one user turn**, so the goal the hook aims at
is always fresh and always about the read in progress. A real session does not look like
that. `lastUserMessage()` takes the last thing *you* typed; the agent then works for many
turns and reads a file for reasons of its own, and the window is aimed at your old
question anyway.

This was listed as the largest unmeasured risk. It is no longer unmeasured.

**The test.** Two targets in the same file. Hand the locate step the goal belonging to the
first, and check the window against the line the read actually needs — the second. Eleven
such pairs across five files, offline, `[ACTUAL]` cents.
([`bench/stale-goal.mjs`](../bench/stale-goal.mjs), raw data in
[`data/stale-goal.json`](data/stale-goal.json).)

| | result |
|---|---:|
| windows that contained what the read actually needed | **0 / 11** |
| expected by chance, given a window of a fifth of the file | ~22% |
| **pairs where the hook would have narrowed anyway** | **11 / 11** |
| confidence in those cases | 0.60 – **0.98**, median 0.84 |
| **pairs where it would have hidden what was needed** | **11 / 11** |

**Zero, which is worse than chance.** A window aimed at a stale goal is not randomly
placed — it is deterministically pulled *away* from whatever else the file contains.

**And the confidence floor sees none of it.** Confidence answers "how sure am I which
chunk implements *this goal*", not "does this goal have anything to do with the read in
progress". A stale but well-formed goal produces a confident, precise, wrong window — one
of them at **0.98**. The only safety gate squint has is structurally blind to this class
of error.

**What this does and does not establish.** It is a worst case by construction: the stale
goal is a fully-formed question about a *different function in the same file*, which is
about the most misleading input possible. It does **not** measure how often that
situation arises in real work — nothing here does. What it establishes is that **when it
arises, nothing stops it**, and the ledger will record a confident narrowing that looks
exactly like a good one.

**The cheapest mitigation is not a better threshold.** It is knowing how old the goal is:
the hook already reads the transcript, so it can count the assistant turns between the
user's message and the read, record that distance in the ledger, and — once the
distribution is known — decline when it is large. That is a measurement first and a
policy second, and it has not been built.

One of the twelve pairs failed on a `timeout after 6000 ms`, which is the current budget.
It is reported rather than retried, because a timeout is the fail-open path working.

---

## 6-bis. The audit before beta: two ordering defects, found and fixed

Date: 2026-09-21. A read-through of the whole source before declaring beta. Nothing here
was believed until it was measured, including the things that were obvious from the code.

### The file was read before the hook asked whether it needed it

`main()` called `readFileSync` and then `preflight`. Two of the refusals preflight makes —
`agent-set-window` and `excluded-path` — need nothing from the file at all.

Measured by giving the hook a small and a large file on each of those paths, best of
three runs each:

| path | 1 KB / 2 KB | 40 MB | reading? |
|---|---:|---:|---|
| `Secrets/…` (excluded) | 43 ms | **89 ms** | yes |
| explicit `offset`/`limit` set by the agent | 39 ms | **89 ms** | yes |

The project rule is that an excluded path is **never read and never sent**. The second
half held — nothing left the machine — and the first did not.

Fixed by splitting the ladder into four stages that touch progressively more: the tool
call alone, then `stat` for the size gate, then the file, then the transcript. Same
refusal reasons in the same order, so no Read changes its outcome.

| path | 1 KB / 2 KB | 40 MB |
|---|---:|---:|
| `Secrets/…` (excluded) | 43 ms | **45 ms** |
| explicit `offset`/`limit` | 44 ms | **39 ms** |

The transcript moved last because it is the most expensive read of the four: **29 ms on
an 8.2 MB session**, and worth nothing on a Read that was never going to be narrowed.

The test that guards this asks the hook to narrow a path under `Secrets/` **that does not
exist**. A hook that reads before deciding cannot answer `excluded-path` — it would have
to say the file is unreadable — so the old order cannot come back silently.

### `squint off` wrote its config where you were standing

The hook reads `.squint.json` from `CLAUDE_PROJECT_DIR`. The CLI wrote it to
`process.cwd()`. Run from a subdirectory:

```
$ cd src/deep && squint off
squint · off · …/src/deep/.squint.json      <-- the hook never reads this
```

It printed `off` and narrowing stayed on. A switch that lies about being off is worse
than one that fails. `report` had the same split and answered "No reads recorded yet"
from any subdirectory.

Fixed by giving the CLI the same notion of a project root the hook has:
`CLAUDE_PROJECT_DIR` when set, otherwise walk up for a marker.

**And that fix had a bug the test caught.** The marker list included `.claude` — which
exists in the *home directory* of every machine that has ever run Claude Code. Any
unmarked directory under home therefore resolved to home itself, and `squint off` would
have written `~/.squint.json`, disabling narrowing for every project at once. Home is now
excluded from the walk. A second, smaller one followed: Windows hands out 8.3 short names,
so `C:/Users/ALICEJ~1` and `C:/Users/alice.jones` are one directory that a string
compare calls two. Both paths are resolved before comparison.

### One latent defect, recorded and not fixed

`lastUserMessage` accepts any message carrying the `user` role. Several kinds are written
by the system rather than typed: a compaction continuation, a message relayed from another
session, an interruption notice, a `Caveat:` preamble. Any of them would be aimed at as
though it were a goal — the same failure as §6, but with a specific and detectable trigger.

Counted across every transcript on the development machine, at each Read squint could
have acted on:

| | |
|---|---:|
| reads with no explicit window (where squint can fire) | 23 |
| of those, carrying a goal the user actually typed | **23** |
| carrying a system-written goal | **0** |

Real in the code, unobserved in the data. At n = 23 the upper bound is roughly 12% (rule
of three), which is not small — but a guard written against zero observations is a guess,
and §6 is on this page precisely because thresholds chosen that way do not survive. It is
written down instead.

`[CORRECTION 2026-09-21]` **The count above was wrong, and the ~12% bound was closer to
the truth than the zero.** The detector behind it did not know Claude Code's own label for
a harness-written message (`isMeta`). Re-measured with it on 381 transcripts and 457
reads: **64 of 457 (14.0%)** carried a goal the user never typed. The table is in
§6-ter; the number here is kept so the correction can be seen.

### Fail-open, re-checked against the binary

Six paths driven through the compiled `dist/src/hook.js` with payloads on stdin, including
one that is not JSON. Every one: **exit 0, empty stdout, the Read untouched**, and no part
of the excluded file in either stream.

After the reorder, a live call still narrows: `.jef/src/report.ts` (1.306 lines) to lines
481–741 for a target hand-located at 614, confidence 0.89, 21.893 input tokens, 1.576 ms.
A second target at 388 was picked at line 371 — **a correct pick** — and refused anyway at
confidence 0.49 against the 0.60 floor. That is the floor doing the job it was calibrated
for, and it is the cost side of it.

---

## 6-ter. Who wrote the goal, and how old it was, on 457 real reads

Date: 2026-09-21. §6 measured what a stale goal *does* (0/11) and could not say how often
one arises. §6-bis counted system-written goals and found none in 23. Both questions now
have a distribution, from an offline replay rather than a guess.

**The method.** [`bench/goal-source.mjs`](../bench/goal-source.mjs) reads every Claude
Code transcript on the development machine — 381 files — and walks each one with the
**same fold the hook uses** (`foldGoal` / `finishGoal`, imported from `dist/`, not
copied). At every `Read` the agent issued without an explicit window it records the goal
the hook would have seen at that moment, who wrote it, and how many assistant turns old
it was. No call is made and nothing personal is written: the published file
([`data/goal-source.json`](data/goal-source.json)) holds counts and turn ages only.

One ordering fact first, because it decides how the ages read. `[ACTUAL]` The assistant
line carrying the `tool_use` is written to the transcript **70 ms before** the hook fires
(a battery session: transcript line at 16:34:05.496, ledger record at 16:34:05.566). The
hook therefore always counts that turn, and **`goalAgeTurns` is never 0 at a Read**; the
replay counts it the same way.

**Who wrote the goal.** `[ACTUAL]`, 457 reads with a goal of at least 12 characters:

| the message the goal came from | reads | share |
|---|---:|---:|
| typed by the user | 393 | 86.0% |
| a skill body injected by the harness (`Base directory for this skill: …`) | **40** | 8.8% |
| a task notification from a subagent | **21** | 4.6% |
| an image attachment | 3 | 0.7% |
| **written by the system, total** | **64** | **14.0%** |

On the subset whose file would pass the size gates today — 145 reads of files that still
exist, at or over 400 lines and under 80.000 bytes — the share is **5 of 145 (3.4%)**, all
five skill bodies. The other 59 sat on files the hook would have refused for size, so the
14% is the rate at which the *goal* is wrong and the 3.4% is the rate at which the hook
would have *acted* on it, on this machine's history.

A skill body deserves its own line. It begins with an absolute path — which carries the
username — followed by the skill's prose, and the first 600 characters of that would have
gone to TypeSafe as "the last thing you typed". The README's statement of what leaves the
machine is wrong for these 40 reads, and the scrub does not remove a username.

**How old the goal was.** `[ACTUAL]`, assistant turns between the user's message and the
Read, all 457:

| | p50 | p90 | p99 | max |
|---|---:|---:|---:|---:|
| all reads | 2 | 32 | 91 | 147 |
| files that pass the size gates today | 2 | 6 | — | 13 |

Histogram, all reads: 1–5 turns **300** · 6–20 **96** · 21–50 **31** · over 50 **30**.
The median read happens two turns after the user spoke; one read in ten happens more than
thirty turns later, in a session that has long moved on. On the eligible subset the tail
is shorter, at a maximum of 13.

**What now exists that did not.** The ledger records `goalSource` beside `goalAgeTurns`,
so the same two distributions accumulate on every machine squint runs on, not only this
one. **Nothing branches on either field.** What the data would support, stated so the
decision can be made rather than implied: refusing a `system` goal is not a threshold but
a label — a skill body or a task notification is never the user's request, by
construction — and on this history it would have cost 64 of 457 opportunities and 5 of
145 eligible ones. A cut-off on age is a threshold, and the distribution above is the
first one anybody could set it against.

**What is still not measured.** Whether a system-written goal produces a *wrong* window as
reliably as a stale one does in §6. It is a goal about something else by construction, so
the expectation is yes, and the expectation has not been tested.

---

## 6-quater. The second audit: a ceiling, a graft, and three more orderings

Date: 2026-09-21, after the beta commit. The three open items of
[`optimizations.md`](optimizations.md) judged worth doing, plus a second pass of review
over code the previous pass had already read.

### O11 — a ceiling on calls per session. Done.

`narrow.maxCallsPerSession`, default **50**, checked immediately before the call — after
every free gate, so that a `budget-spent` line in the ledger means exactly one thing:
this Read would otherwise have paid. Counting earlier would have turned a `file-too-small`
into a `budget-spent` and lost the reason. Only calls that answered are counted: a refusal
carries no `inputTokens` and a timeout never learned its cost.

The distribution the cap was to be chosen against exists in the published data.
`[ACTUAL]` Across **75 sessions** with the hook on — 50 in the battery, 15 on opus, 10 in
the adversarial pass — the maximum number of calls in one session is **1**. Fifty is
therefore a bound on a runaway, not a tuned value: `[ESTIMATED]` at the ceiling a session
has spent at most 50 × 21.932 = 1.096.600 input tokens, about $0.046 on the largest file
measured. Five tests pin the semantics, including that refusals do not count and that the
count is per session, not per project.

### O8 — the textual graft. Done.

The scanner, `graftHookGroup`, `graftRemoveGroup` and `verifiedGraft` ported from the JEF
installer into `install.ts` (+230 lines), with the hand-written fixtures that were written
for them: inline arrays, inline objects, arbitrary key order, another hook already
present, two spaces, four spaces, a tab, LF, CRLF, with and without a final newline.
**Every combination round-trips byte for byte**, and every line the install did not add
survives the *install* verbatim, not only the uninstall. The fallback is unchanged and
still speaks: a file with duplicate keys — where `JSON.parse` keeps the last and a
textual scan finds the first — fails verification and is reported `installed-reformatted`.

### Three more orderings, found in review

1. **A chunk count was answered after the transcript was paid for.** The "fewer than two
   chunks" refusal needs only the file, and sat after the transcript read. Moved before
   it. Unreachable with the default config (400 lines is at least 40 chunks), so this is
   the ladder's principle kept rather than a measured cost.
2. **The installer treated every read failure as "the file is missing".** A directory at
   the settings path, or a permission denied, fell into the create-from-scratch branch and
   went on to write. Only `ENOENT` may do that now; anything else is `corrupt`, which is
   the rule the same function already applied to unparseable JSON — what was not read is
   not overwritten. Tested with a directory at the path.
3. **`squint off` replaced a `.squint.json` it could not parse.** The parse failed, the
   config started from `{}`, and the user's file — a trailing comma away from valid — was
   overwritten with `{"narrow":{"enabled":false}}` without a word. It is now left alone
   and reported `corrupt` with exit 1, the installer's own rule applied to the config file.

Two things were reviewed and left as they are. `squint install` copies the `/squint`
skill even when the settings file is corrupt; the copy is idempotent and the exit code
already says the install failed. And a message made only of a `<local-command-stdout>`
wrapper resets the goal to empty rather than keeping the previous typed one — that
discards a goal, which is the safe direction, and keeping it would aim at something older.

`npm test`: **108 tests**, from 85.

---

## 7. What was not measured

- **Two models, not one — and a third is still unmeasured.** The battery ran on
  `claude-haiku-4-5` and the same design was re-run unchanged on `claude-opus-5` (§1-bis).
  The mechanism is model-independent in principle — it changes what the tool returns, not
  what the model decides — and the size of the effect held across both. Nothing says it
  holds on a third.
- **Only one repository.** One TypeScript codebase, 29 files. The eligibility ratio that
  the whole saving scales by is a property of *your* repository, not of squint.
- **Delegation.** The open-ended numbers describe an agent working in-session, because a
  free agent's subagent leaves the working directory and stops measuring the corpus.
  What squint does across a delegated session is recorded in the ledger and not
  characterised.
- **A stale goal — now measured, see §6, and it is the worst thing on this page.**
  What is still *not* measured is how often it happens in real work. The battery cannot
  say, because every session in it has one user turn.
- **How often the goal is a message you never wrote.** Zero times in 23 real
  opportunities (§6-bis), which at that n bounds it near 12% rather than establishing it
  is rare. `[CORRECTED 2026-09-21]` Now measured: **64 of 457** real reads, 14.0%, and
  5 of 145 on files the hook would act on (§6-ter). What remains unmeasured is whether
  those goals produce a wrong window as reliably as a stale one does.
- **Whether the 400-line floor should move.** The band below it is now measured
  (§2-bis: 37/37, smaller pick errors than above) and its cost curve was already known.
  What is not measured is whether users accept ~350 ms on every read of a 200-line file
  for a 25% saving on it. The floor is unchanged.
- **Small n where it is smallest.** Nineteen fired pairs carry the headline. Four pairs
  carry the oversize control. Eight carry the open-ended rate. The paired design separates
  signal from noise at these sizes; it does not characterise a tail.
