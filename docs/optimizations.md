# Optimizations — what is on the table, what it would buy, and what it could break

Nothing here is implemented. This is the analysis that has to come before the choice, and
for most of these the analysis *is* the answer: **five of the eleven ideas are refuted by
data**, and three of those five were in the original list and looked obviously right.
Saying so is cheaper than building them.

The one thing on this page that turned out to be a real defect was not on the list at
all — it was found by reading the code, and then measured: **O9, the stale goal**.

Every figure is **ACTUAL** (read from a response or a log) or **ESTIMATED** (computed
with the formula printed beside it). No percentage appears without its baseline.

Two constants are used repeatedly, both from [`evidence.md`](evidence.md) §3:

| | value | provenance |
|---|---:|---|
| cost of one narrowing call, per line sent to Jev | `$7.039e-7` | ESTIMATED, `$0.00092 / 1307` |
| value of one line Claude does not read | `$1.883e-5` | ESTIMATED, `$0.0197 / (1307 − 261)` |

The ratio between them — **27×** — is the single most useful number on this page. Asking
Jev is cheap; the lines it saves are expensive. That is why most of these optimizations
are chasing very little.

---

## Summary

**Five of the eleven ideas are refuted by the data.** That is the main output of this
page. Three of the five were in the original list and looked reasonable.

| | idea | expected gain, measured | verdict |
|---|---|---|---|
| **O9** | the goal can be stale *(new)* | **measured: 11/11 windows hide what the read needs, at confidence up to 0.98** | **the real defect — instrument it first** |
| **O6** | re-measure the 400-line floor | the floor sits 2.5× above the cost break-even | **worth doing, ~$0.02** |
| **O8** | textual graft in the installer | byte-for-byte `settings.json` | **worth doing, the code exists** |
| **O11** | a per-session call ceiling *(new)* | bounds an unbounded worst case | **worth doing, ~10 lines** |
| **O2** | a second signal instead of a lower floor | **nothing a single threshold does not already give** | **refuted — drop it** |
| **O1** | cache the decision within a session | **0 calls saved in 50 sessions** | **refuted — the case never occurs** |
| **O5** | adaptive window | **none: confidence does not predict error (ρ = 0.01)** | **refuted — drop it** |
| **O3** | drop or use the `exists` noul | ~0.1% of one call; does not discriminate | **neither: leave it** |
| **O4** | skeleton payload | 3% of the gain, two new failure modes | **refuted — do not build** |
| **O7** | `squint key` beyond Windows | none | **document, do not build** |
| **O10** | what the agent does on the second read *(new)* | **answered: it re-reads with an explicit window** | **closed, and it closed O1** |

---

## O5 — the adaptive window. **The data refutes the premise.**

**The idea.** The window is always a fifth of the file, floored at 150 lines. Make it
adaptive: high confidence → narrower window, borderline confidence → wider one.

**Why it does not hold.** The idea assumes the pick gets more accurate as confidence
rises. On the 26 calibrated targets, above the 0.60 floor, it does not.

`[ACTUAL]` Rank correlation between confidence and pick error, above the floor, n = 14:
**ρ = 0.01**. Flat. If the premise held it would be strongly negative.

The errors, in order of rising confidence:

```
0.63→7  0.64→5  0.66→1  0.66→6  0.71→52  0.71→6  0.73→8
0.79→7  0.84→1  0.86→7  0.89→0  0.90→42  0.93→1  0.97→8
```

The two worst errors above the floor — **52 and 42 lines** — sit at confidence **0.71 and
0.90**, at the top of the range. By band:

| confidence | n | median error | worst error | recall |
|---|---:|---:|---:|---:|
| 0.90–1.00 | 3 | 8 | **42** | 3/3 |
| 0.80–0.90 | 3 | 1 | 7 | 3/3 |
| 0.70–0.80 | 4 | 8 | **52** | 4/4 |
| 0.60–0.70 | 4 | 6 | 7 | 4/4 |

A rule that narrowed the window at high confidence would have narrowed it on the two
targets where the pick was worst.

**How it would be measured, if someone wanted to revisit it.** The same calibration, on
enough targets that each confidence band has more than three. With n = 3 per band nothing
is estimable, and that is the honest reason to stop rather than a claim that no
relationship exists anywhere.

**What it risks.** The narrowing direction is the one that hides code. Trading recall for
compression on a relationship measured at ρ = 0.01 is trading a certainty for a guess.

---

## O6 — the 400-line floor. **Not set by cost. Possibly set by nothing.**

**What is known.** 40 of 230 files pass the gate on the repository this was built
against; 6 of 29 in `.jef/src`. That is a coverage measurement, not a justification of
400.

**Where the cost break-even actually is.** With the two constants above, and the window
rule `max(150, ⌊L/5⌋)`:

```
break-even:  kJev · L = kClaude · (L − 150)
             L = kClaude · 150 / (kClaude − kJev) = 156 lines      [ESTIMATED]
```

| lines | window | share read | call cost | gross saving | net |
|---:|---:|---:|---:|---:|---:|
| 151 | 150 | 99% | $0.00011 | $0.00002 | **−$0.00009** |
| 200 | 150 | 75% | $0.00014 | $0.00094 | +$0.00080 |
| 300 | 150 | 50% | $0.00021 | $0.00283 | +$0.00261 |
| **400 — shipped** | 150 | 38% | $0.00028 | $0.00471 | +$0.00443 |
| 750 | 150 | 20% | $0.00053 | $0.01130 | +$0.01077 |
| 1307 | 261 | 20% | $0.00092 | $0.01970 | +$0.01878 |

**On cost alone the floor should be about 156 lines, not 400.** The band from 156 to 400
is being refused at a positive expected value.

**So why not lower it?** Because cost is not the binding constraint — risk is, and the
risk in that band **has never been measured by anyone**. All 26 calibration targets sit
in files of 508 to 1307 lines. Nobody has asked whether a 300-line file's chunking
produces a usable choice, and there is reason to think it might not: chunks are
`max(chunkLines, ⌈L/maxChunks⌉)` = 10 lines on a small file, so a 300-line file becomes
30 chunks of 10 lines, and a 1307-line file becomes 131. Whether a Choice over 30 short
chunks behaves like one over 131 longer ones is an open question, not a safe assumption.

**How to measure it.** Extend the calibration corpus downward: 20–30 hand-written targets
in files of 150 to 400 lines, run `bench/calibrate.mjs` against them, and compare recall
and pick error against the existing band. `[ESTIMATED]` cost, at 21.932 input tokens per
call and the published rate: **$0.0166 for 26 more targets** — the same as the round
already run. This is the cheapest item on the list and it retires a number nobody has
ever justified.

**What it risks.** Lowering the floor puts a Jev call on the path of many more Reads. The
latency is paid on every one of them, saving or not, and the p95 of the local hook leg is
a user-visible cost that the money figures do not capture.

---

## O3 — the `exists` noul. **It does not separate, and it does not cost anything either.**

**The claim to test:** `exists` is asked in every request and used by nobody. Either make
it the second signal O2 wants, or stop paying for it.

**As a safety signal it fails, on our own sample and not only upstream's.**
`[ACTUAL]`, 26 targets:

| | n | `exists` mean | `exists` range |
|---|---:|---:|---:|
| windows that contained the target | 21 | 0.84 | 0.51 – 0.95 |
| windows that lost the target | 5 | 0.77 | **0.29 – 0.95** |

The ranges overlap completely: a window that lost its target scored 0.95. For comparison,
the confidence on the same sample:

| | n | confidence mean | confidence range |
|---|---:|---:|---:|
| windows that contained the target | 21 | 0.64 | 0.18 – 0.97 |
| windows that lost the target | 5 | 0.29 | **0.22 – 0.41** |

Confidence has a clean ceiling on the failures at 0.41. `exists` has none. This confirms
the upstream finding on an independent sample and closes the first half of O3.

**As a cost, it is not worth removing.** The question text is roughly 120 characters
against a request of `[ACTUAL]` 21.932 input tokens dominated by the file itself.
`[ESTIMATED]` removing it saves about **0.1%** of one call, or `$0.0000013`. Jev output
is not billed at the time of writing, so the answer costs nothing either.

**Verdict: leave it exactly as it is** — recorded, not acted on, and documented as such.
Removing it would be churn on a file that carries a measured comment explaining why it is
there, and the saving is below the precision of the rate it is computed from.

---

## O11 — a per-session ceiling on calls *(not in the original list)*

**The gap.** There is no cap of any kind. `hook.ts` calls Jev on every eligible Read, for
the life of the session. A session that reads 40 large files pays `[ESTIMATED]`
40 × 21.932 = **877.280 input tokens** to Jev, and there is nothing in the code that
would stop 400.

**Expected gain.** It does not make the good case better; it bounds the bad one. The
ceiling only matters when something has gone wrong — a loop, an agent re-reading the same
tree, a repository of unusually large files.

**How to measure it.** From the ledger, across real sessions: the distribution of
narrowing calls per session. The cap belongs somewhere past the observed p99, which
cannot be chosen before that distribution exists.

**What it risks.** A cap that fires mid-session makes two otherwise identical sessions
behave differently, and the second half of a session silently stops narrowing. That must
be a *recorded* refusal reason (`budget-spent`), not a silent pass-through, or it becomes
exactly the kind of invisible behaviour the ledger exists to prevent.

---

## O9 — the goal can be stale *(not in the original list)*

**This is the largest unmeasured risk in the design, and the benchmark cannot see it.**

`lastUserMessage()` takes the last **user** turn from the transcript, truncated to 600
characters, and that string becomes `goal` — the thing the whole narrowing is aimed at.
In a real session the user's last message can be many tool calls back and about something
else entirely: you ask about the parser, the agent works for twenty turns, then reads
`report.ts` for its own reasons, and the hook narrows that read towards *the parser*.

The window would then be centred on the wrong thing, at whatever confidence Jev happens
to return, and the agent would receive a fifth of `report.ts` with a note saying nothing
was removed from the file.

**It has now been measured, and it is worse than the wording above suggested.**
`[ACTUAL]`, 11 pairs across five files ([`bench/stale-goal.mjs`](../bench/stale-goal.mjs)):
hand the locate step a goal belonging to a *different* function in the same file, then
check the window against the line the read actually needs.

| | result |
|---|---:|
| windows containing what the read needed | **0 / 11** |
| expected by chance (window = a fifth of the file) | ~22% |
| **cases where the hook would have narrowed anyway** | **11 / 11** |
| confidence in those cases | 0.60 – **0.98**, median 0.84 |

**Zero is worse than chance**, because a stale goal does not place the window randomly —
it pulls it deterministically *away* from everything else in the file. And the confidence
floor, the only safety gate squint has, is **structurally blind**: it measures certainty
about which chunk matches *this goal*, not whether the goal has anything to do with the
read in progress.

**What is still unmeasured** is how often the situation arises in real work. The battery
cannot say: every session in it has one user turn.

**The mitigation, and why it is a measurement before it is a policy.** The hook already
parses the transcript, so it can cheaply record **how old the goal is** — the number of
assistant turns between the user's message and the read — in the ledger. Once that
distribution exists on real sessions, a refusal above some distance becomes a decision
someone can defend. Guessing the cut-off now would replace a blind gate with an arbitrary
one.

**What a fix would risk.** Any richer notion of "what is being worked on now" means
sending more of the transcript to a third party, and the transcript is the user's own
words. The current rule is at least easy to state in the README's "what leaves your
machine".

---

## O10 — what the agent does on the second read *(not in the original list)*

When the window misses, the note invites the agent to read again with an explicit offset.
`preflight` then passes with `agent-set-window`. That is correct behaviour, but nobody has
measured **what the agent actually asks for**: a targeted second window, or the whole file
with a large `limit` — which would make the narrowing a pure loss, paying a Jev call and
then reading everything anyway.

**Answered, and the answer closed O1.** `[ACTUAL]` Across the battery, twelve reads in the
ON arm were re-reads of an already-read file. **Seven arrived with an explicit `offset`**
and were passed through as `agent-set-window`; none produced a second call. The
adversarial pass showed the same behaviour from the other side: given a *wrong* window,
the placebo arm went from 1.1 reads to 1.8 and from 2.2 turns to 3.1 — it recovered by
re-reading, and the recovery cost as much as the compression saved.

So the second read is a **targeted explicit window**, not a repeat. That is the good case
for correctness and the bad case for a cache, and it is why O1 is refuted rather than
deferred.

---

## O7 — `squint key` outside Windows. **Document, do not build.**

`persistKey()` calls `setx` on `win32` and, everywhere else, prints the `export` line for
the user to add to their own profile. `[ACTUAL]` that is 4 lines of behaviour and it is
declared in a comment, not hidden.

**Expected gain: none.** No cost, no recall, no latency.

**What building it would risk.** Editing a shell profile is a destructive write to a file
the tool does not own, on platforms the author cannot test, to save one paste. The
failure mode — a corrupted `.zshrc` — is worse than the inconvenience it removes.

**Recommendation:** state the limit in the README next to the `key` command, and leave the
code alone. A declared partial feature is not a defect.

---

## O8 — the installer reformats a hand-written `settings.json`. **Worth doing.**

`install.ts` writes with `serialize()` and reports `installed-reformatted` when the
original was not already canonical. It declares the damage rather than hiding it, which
is the right fallback — but it is a fallback.

**Expected gain.** A hand-formatted `settings.json` survives install and uninstall
byte-for-byte. This matters more than it sounds: the file holds the user's permissions
and other hooks, and an install that rewrites all of it makes every unrelated line show up
in a diff.

**The code already exists and is tested.** `.jef/src/install-settings.ts` has the textual
graft — the JSON scanner, `graftHookGroup`, `graftRemoveOne`, and crucially
`verifiedGraft`, which re-parses the grafted text and compares it against the expected
object, falling back to the structural writer when they differ. `[ACTUAL]` that is **281
lines** to port into a package whose `src` is currently **1.558 lines** — a 18% increase.

**How to measure it.** Not statistically: as a property. A corpus of real `settings.json`
formattings — 2-space, 4-space, tabs, CRLF, no trailing newline, entries in unusual order
— install, uninstall, assert the bytes are identical to the original. Byte-for-byte tests
of exactly this shape already exist upstream and port with the code.

**What it risks.** A hand-rolled scanner splicing text into the file that controls the
user's permissions and hooks. A bug corrupts it. `verifiedGraft` is the mitigation and it
is the reason this is worth doing at all: the graft is never trusted, only its verified
output, and anything unverified falls back to today's behaviour.

---

## O4 — the skeleton payload. **Correctly ranked last.**

**The idea.** Instead of sending the whole file in chunks, send a skeleton — declarations,
signatures, imports — pick a region from that, then send only that region.

**Expected gain.** `[ESTIMATED]` a skeleton of a TypeScript file is roughly 15% of its
lines, so a first pass over `report.ts` would cost ~3.300 input tokens instead of 21.932,
and a second pass over the chosen fifth another ~4.400: **~7.700 against 21.932, a 65%
cut** in Jev input. At the constants above that is `$0.00064` saved per narrowing.

**Put beside what it costs, that is the whole problem.** $0.00064 is **3%** of the
$0.0197 gross saving the narrowing produces. The optimization targets the cheap side of a
27:1 ratio.

**What it risks, and this is the real objection.** Two things, either of which is
disqualifying on its own:

1. **A skeleton cannot answer body questions.** "Where is the retry backoff computed" is
   invisible in a list of signatures. The first pass would pick a region by name
   similarity and the second pass would never see the right code — and the failure is
   silent, which is the one failure mode this project treats as non-negotiable.
2. **It makes the package language-dependent.** `buildChunks` is a line-slicer that knows
   nothing about any language and therefore works on every file. A skeleton extractor is
   a TypeScript parser, or a regex that pretends to be one.

Plus a second round trip on the critical path of every Read, against a 6.000 ms budget
where the observed p50 is already ~1.500 ms.

**Recommendation: do not build this.** Not "after O1" — the ratio says the target is not
worth the two risks, whatever O1 turns out to be worth.

---

## O1 — cache the decision. **The duplicate call does not happen.**

**The idea.** A read pays ~14.000 input tokens at Jev. If the same file is read twice in
one session with the same goal, that is paid twice. Cache on `(file hash, normalised
goal)` and the second call disappears.

**Measured, and the answer is a count, not an estimate.** `[ACTUAL]` Across **50 sessions**
with the hook on, spanning every stratum:

| | |
|---|---:|
| sessions that made **0** calls to Jev | 19 |
| sessions that made **exactly 1** | 31 |
| sessions that made **2 or more** | **0** |
| **calls a cache would have eliminated** | **0** |

The `REPEAT` stratum was built specifically to force the situation — eight sessions, each
asked for two functions hundreds of lines apart in one file — and it did produce re-reads:
twelve reads of an already-read file across the battery. **Seven of them arrived with an
explicit `offset`.** `preflight` passes those untouched with reason `agent-set-window`, and
no call is made.

**Why the premise fails.** The narrowing note tells the agent it can read again with an
explicit offset, and the agent does exactly that. The escape hatch that exists for
*correctness* already prevents the duplicate call that the cache was meant to remove. The
optimization and the feature were aimed at the same thing, and the feature got there
first.

**What would change this.** A session where the agent re-reads the same file with **no**
window — a different goal, a fresh turn, a compaction that lost the note. None occurred in
50 sessions. If the ledger ever shows a session with two calls, this becomes worth
revisiting; until then the measured gain is zero calls and zero dollars.

**What it would have risked, recorded because it is the interesting part.** Keying on the
file's *content hash* is mandatory, not optional: `offset` and `limit` are line numbers,
so a single inserted line makes a cached window point at the wrong code — silently. And
normalising the goal is where the real danger sits: "find the parser" and "find the parser
tests" must not collide. A cache that is safe enough would have had to key on the exact
goal string, which is the case that never occurred anyway.

---

## O2 — a second signal instead of a lower floor. **The signal carries nothing.**

**The idea.** At the 0.60 floor the hook refuses half the available narrowings, and many
of those refusals would have produced a correct window. Rather than lower the threshold —
which was rejected because it would leave 0.01 between the floor and the worst failure
ever seen — add a **second signal**: the *gap* between the top chunk's probability and the
runner-up, which says how *isolated* the pick is, something a scalar confidence does not.

**Measured.** Round two of the calibration recorded the full distribution over chunks, not
just its maximum. `[ACTUAL]`, 26 targets:

| | correct windows (n=22) | windows that lost the target (n=4) | separates? |
|---|---:|---:|---|
| confidence | 0.20 – 0.97 | 0.21 – 0.36 | overlaps, but failures have a **ceiling** |
| **gap** (top − second) | 0.04 – 0.97 | 0.00 – 0.27 | **no** — a correct window scored 0.04 |

A correct window with a gap of 0.04 is fatal to the idea: the runner-up was essentially
tied, and the pick was right anyway. Chunks are contiguous slices of one file, so the
second-most-likely chunk is often the one next door, holding the other half of the same
function — ambiguity there is not doubt, it is a function straddling a boundary.

**Every two-signal rule lands on a frontier the single threshold already reaches:**

| rule | narrows | targets lost |
|---|---:|---:|
| `conf ≥ 0.60` (shipped) | 12/26 | 0 |
| `conf ≥ 0.60 OR gap ≥ 0.30` | 15/26 | 0 |
| **`conf ≥ 0.50`** | **15/26** | **0** |
| `conf ≥ 0.42 AND gap ≥ 0.20` | 16/26 | 0 |
| `conf ≥ 0.42` | 17/26 | 0 |

The best two-parameter rule found reaches exactly what `conf ≥ 0.50` reaches with one
parameter. **Recommendation: drop the second signal.** If the floor is ever to move, the
honest lever is the threshold itself — and 0.50 is the defensible value, at 100% recall
over 52 pooled observations with a **0.09** margin above the worst failure, against 0.01
at 0.42.

**Why it is not being moved here.** A threshold nobody re-measured must not be quietly
changed, and this round was designed to measure the hook, not to justify a new default.
The data to move it now exists and is in `evidence.md` §2; the decision is separate.

**What it risks.** Any rule fitted on nine observed failures is fitted on nine points. The
reason the floor can be discussed at all is that three independent samples — upstream's,
round one's, round two's — put the failure ceiling in the same place (0.42, 0.41, 0.36).
That agreement, not the size of the sample, is the evidence.
