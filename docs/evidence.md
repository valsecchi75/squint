# Evidence

Every number here was measured on 2026-09-20, on Claude Code build `2.1.110`, with
`claude-haiku-4-5` as the model under test and `jev-latest` as the decider. Raw data is
in `calibration.json` beside this file.

Two labels are used throughout and never mixed. **ACTUAL** means read from a response
or a log. **ESTIMATED** means computed with a formula that is printed next to it. No
percentage appears without the baseline it is a percentage of.

---

## 1. Does it save anything?

A paired A/B. Two working directories with byte-identical sources, differing **only** in
`.claude/settings.json`: one registers the hook, the other is `{}`. The same question is
asked in both, and the pair is the unit of analysis, so each question is its own control.

Ground truth for each question is the exact name of a function, written by hand from
reading the file. The answer passes only if it contains that name.

### The headline

| population | pairs | mean cost delta | within-pair spread | verdict |
|---|---:|---:|---:|---|
| **Large files, hook fired** | 9 | **−37.3%** | 10.4% | separates, 3.6× the spread |
| Large files, hook did not fire | 3 | +1.0% | 12.3% | **null** |
| Large files, everything together | 12 | −27.7% | 20.1% | separates, 1.4× |
| **Small files — negative control** | 6 | **−2.5%** | 6.3% | **null** ✓ |

**Answer quality: 18/18 correct in both arms, in every stratum.** Nothing was lost.

**The row that makes the rest believable is the last one.** Files under 400 lines cannot
be narrowed by construction, so the arms must not separate there. They do not. If they
had, the saving on large files would not have been attributable to the narrowing.

**The row never to quote on its own is the third.** `−27.7%` averages two populations
that behave in opposite ways and describes neither.

### Where the misses came from, and the fix

Of 12 eligible reads the hook fired on 9. The three misses were not prudent refusals: the
ledger recorded them as failed calls with `elapsedMs` of **3006** and **3003** — the
timeout itself. One success had landed at **2920 ms**, 80 ms short of failing.

The cause was a borrowed number. The narrowing request carries the file (~22.000 input
tokens), while the small classification call it inherited its timeout from carries a
compact state (~8.000). One threshold over two distributions was discarding a quarter of
the narrowings. `narrow.timeoutMs` is now its own value at **6000 ms**, twice the largest
observed success.

| | timeout 3000 | timeout 6000 |
|---|---:|---:|
| fired, on eligible reads | 9/12 | **11/12** |
| aggregate delta | −27.7% (sd 20.1%) | **−33.8%** (sd 13.3%) |
| pairs in the same direction | no, two directions | **all twelve** |
| delta where it fired | −37.3% | −36.0% |
| timeouts observed | 2 | **0** |
| successful latencies | 1142–2920 ms | 1115–**1767** ms |

**A caveat that has to be stated.** The delta *where it fires* does not move (−37.3% vs
−36.0%): the fix does not make the mechanism better, it makes it **more often
available**. And the second round's latencies are all under 1767 ms while the first had
three above 1861 — a change in the tail that a timeout cannot produce. Part of the
improvement is therefore network or load conditions, and with one round per condition it
is not separable. What is established is narrower and does not depend on that: a 3000 ms
threshold **was being hit**, and is not any more.

---

## 2. Does it hide code?

This is the only metric that matters, and compression is worthless without it. A window
that drops the answer is a **silent omission**: the agent reads what it was handed and
never learns the rest existed.

### The calibration

26 targets — `(file, true line, goal)` — across five files of 508 to 1307 lines. The goals
were **written by hand from reading the code** and never asked of a model. Each one calls
the same locate step the hook uses, and records whether the window the hook *would have
produced* contains the true line.

`[ACTUAL]` 395.703 input tokens, `[ESTIMATED]` $0.0166 at the published rate, latencies
362–1870 ms.

**21 of 26 windows contained the target. All five that did not scored 0.41 or below.**

| confidence floor | narrows | recall | targets lost | coverage |
|---|---:|---:|---:|---:|
| 0.30 | 21/26 | 90% | 2 | 81% |
| 0.40 | 18/26 | 94% | 1 | 69% |
| 0.42 | 17/26 | **100%** | 0 | 65% |
| 0.50 | 16/26 | **100%** | 0 | 62% |
| **0.60 — shipped** | **14/26** | **100%** | **0** | 54% |
| 0.70 | 10/26 | 100% | 0 | 38% |

The five failures, by confidence: **0.41** (off by 305 lines), **0.34** (127), **0.24**
(117), **0.23** (212), **0.22** (142). The upstream project's single observed failure was
at **0.42**. Two independent samples put the ceiling of failure in the same place.

**Why the floor stays at 0.60 rather than dropping to 0.42.** Lowering it buys three more
narrowings out of 26 and moves the floor to within 0.01 of the worst failure ever seen.
Five failures cannot estimate that margin. The gain is small, the way of being wrong is
hiding code, and the two are not commensurable.

**What the floor costs, stated plainly.** At 0.60 the hook refuses 12 of 26 targets, and
**seven of those would have produced a correct window**. The price of the safety margin is
roughly half the narrowings that were available. That is a declared trade-off, not a
hidden defect.

**One loss above the floor exists and is on the record.** In an earlier, smaller round a
window at confidence **0.63** picked a line 133 off, and recall survived only because the
window was clamped to the end of the file. Across roughly 40 observed narrowings that is
**one** above 0.60. It is kept in a test so that whoever moves the threshold sees it.

### Accuracy of the pick

Over the 26 targets the chosen line sat a **median of 8 lines** from the true one, with a
minimum of 0. The window is 150 lines or a fifth of the file, centred on the pick, so it
forgives roughly ±75 — comfortably past the typical error and nowhere near the outliers.

---

## 3. What it costs to run

`[ACTUAL]` One narrowing call averages **21.932 input tokens** and **1.5 s**.
`[ESTIMATED]` At the published input rate that is **$0.00092** per narrowing, against a
gross saving of about **$0.0197** on the read it fires on — the call consumes **4.7%** of
the gain.

Output from Jev is not billed at the time of writing. The rate carries no effective date
on the published page, which is why every figure derived from it is labelled ESTIMATED
rather than ACTUAL.

---

## 4. How often it can fire at all

`[ACTUAL]` On the TypeScript repository this was developed against, the size gate
(≥ 400 lines **and** < 80.000 bytes) is satisfied by **40 of 230** readable files — about
**one file in six**.

**This is the number to weight the saving by.** A −36% on the reads it fires on is not
−36% on a working day. On a repository of small modules the saving approaches zero by
construction, and the honest thing to do is measure your own ratio before enabling it.

---

## 5. What was not measured

- **Only one model.** Everything here ran on `claude-haiku-4-5`. The mechanism is
  model-independent in principle — it changes what the tool returns, not what the model
  decides — but the size of the effect is not.
- **Only one kind of task.** Every question is "find a function in a large file", which is
  the case the hook is built for. Reads that skim rather than seek are not represented.
- **Small n.** Twelve pairs in the A/B, 26 targets in the calibration. Enough for the
  paired design to separate signal from noise, not enough to characterise a tail.
- **The `exists` noul is recorded and ignored.** Upstream measured it unreliable (0.26 and
  0.31 on windows that were correct). It is written to the ledger in case a future
  calibration finds a use, and nothing branches on it today.
