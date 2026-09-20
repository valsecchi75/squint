# bench

The harness that produced every number in [`../docs/evidence.md`](../docs/evidence.md).
It is here so the measurements can be re-run rather than believed.

## What each file does

| file | question it answers |
|---|---|
| `run.mjs` | does the hook change what a session costs? Paired A/B, stratified. |
| `report.mjs` | reads `run.mjs` output and applies the null rule: the spread beside the difference, always. |
| `calibrate.mjs` | at what confidence does the window stop containing the answer? No Claude sessions — only Jev calls, so it costs cents. |

## The design, and why it is shaped this way

**Paired.** The same question goes to both arms and the pair is the unit of analysis, so
each question is its own control. Two unpaired means need a large n to separate; twelve
pairs were enough here because the pairing removes the between-question variance.

**Stratified, with a negative control.** `SMALL` holds files under the size gate, where the
hook *cannot* fire. If the arms separate there, the effect measured on large files is not
attributable to the narrowing and the whole battery is void. It is not filler: it is the
thing that makes the rest believable.

**Ground truth written by hand.** Every target is a `(file, true line, goal)` triple read
out of the source by a person. Asking a model to produce the answer key and then grading
that model against it measures agreement, not correctness.

**A preregistered null.** If the mean paired delta is smaller than its standard deviation,
the result is null and gets written as null. That rule is at the top of `run.mjs` and is
not negotiable after seeing the data.

## Running it

```bash
node bench/run.mjs <workspace> <out.jsonl> [strata] [reps]
node bench/report.mjs <out.jsonl>
node bench/calibrate.mjs <repo-with-source> <out.json>
```

`<workspace>` holds two directories, `on/` and `off/`, with **byte-identical sources** and
differing only in `.claude/settings.json`. Verify the hashes match before the first run;
if they do not, nothing downstream means anything.

`CLAUDE_BIN` overrides the path to the Claude Code binary. `TYPESAFE_API_KEY` must be in
the environment for the ON arm to do anything.

## What it costs

A run is roughly $0.03–$0.06 on `haiku`. The calibration is cents, because it never starts
a session. Budget the A/B, not the calibration.
