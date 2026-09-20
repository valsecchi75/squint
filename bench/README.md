# bench

The harness that produced every number in [`../docs/evidence.md`](../docs/evidence.md).
It is here so the measurements can be re-run rather than believed.

> The scripts are commented in Italian, which is the working language of the project
> they came from. The measurements, the documents and the published results are in
> English. Nothing in the comments is load-bearing for running them.

## What each file does

| file | question it answers |
|---|---|
| `cases.mjs` | the 25 cases and their hand-written ground truth. Shared, so both harnesses ask the *same* questions. |
| `lib.mjs` | how a run is read back: transcript, ledger, grading. Shared for the same reason. |
| `run.mjs` | does the hook change what a session costs? Paired A/B, five strata. |
| `table.mjs` | the four numbers a user cares about: tokens, money, time, and the percentage. |
| `report.mjs` | the same data decomposed by whether the hook actually fired. |
| `adversarial.mjs` | can the result be broken? Reversed arm order, and a placebo hook. |
| `placebo-hook.mjs` | a sham hook: same gates, same window size, position chosen from a hash of the filename. |
| `adversarial-report.mjs` | did the result survive the two attacks? |
| `calibrate.mjs` | at what confidence does the window stop containing the answer? No Claude sessions — only Jev calls, so it costs cents. |
| `charts.mjs` | regenerates the three SVGs in `docs/img` from the raw data. |

## The design, and why it is shaped this way

**Paired.** The same question goes to both arms and the pair is the unit of analysis, so
each question is its own control. Two unpaired means need a large n to separate; a
couple of dozen pairs were enough here because the pairing removes the between-question
variance.

**Stratified, with two negative controls.** `SMALL` holds files under the line floor and
`HUGE` files over the byte ceiling — in both the hook *cannot* fire. If the arms separate
there, the effect measured on large files is not attributable to the narrowing and the
whole battery is void. They are not filler: they are what makes the rest believable.

**Ground truth written by hand.** Every target is a `(file, true line, goal)` triple read
out of the source by a person. Asking a model to produce the answer key and then grading
that model against it measures agreement, not correctness.

**A preregistered null.** If the mean paired delta is smaller than its standard deviation,
the result is null and gets written as null. That rule is at the top of `run.mjs` and is
not negotiable after seeing the data.

**An adversarial pass.** A result that has only ever been tested by the experiment
designed to find it has not been tested. `adversarial.mjs` runs two attacks whose
predictions are written down before the runs: reverse the arm order, and swap the hook
for one that compresses identically and understands nothing.

## The token metric, and a correction worth knowing about

The first version of `table.mjs` summed `cache_creation_input_tokens` and
`cache_read_input_tokens` and reported **null** — on data where the mechanism was working
perfectly. `cache_read` is the cached system prompt, tens of thousands of tokens identical
in both arms, and it multiplies whenever a session takes extra turns for reasons unrelated
to the file being read. That constant and that noise bury the signal.

The grandeur that squint can actually move is `cache_creation_input_tokens`: content the
model has not seen before, which is the file. That is what the tables report as
**new tokens read**, and `cache_read` is shown beside it rather than mixed into it.

## Running it

```bash
node bench/run.mjs <workspace> <out.jsonl> [strata] [reps] [firstRep]
node bench/table.mjs <out.jsonl> [--md]
node bench/report.mjs <out.jsonl>
node bench/adversarial.mjs <workspace> <adversarial.jsonl> [nCases]
node bench/adversarial-report.mjs <adversarial.jsonl> [battery.jsonl]
node bench/calibrate.mjs <srcDir> <calibration.json>
node bench/charts.mjs <battery.jsonl> <calibration.json> <outDir>
```

`<workspace>` holds `on/` and `off/` — and `placebo/` for the adversarial pass — with
**byte-identical sources**, differing only in `.claude/settings.json`. Verify the hashes
match before the first run; if they do not, nothing downstream means anything.

`ONLY=C4,D2` re-runs single cases, which is what the rule *"an invalid run is redone, not
adjusted"* needs in practice.

`CLAUDE_BIN` overrides the path to the Claude Code binary. `TYPESAFE_API_KEY` must be in
the environment for the ON arm to do anything.

### Three things that will void your battery if you do not check them

Each of these happened here, cost real money, and was caught only because the ledger
records refusals as well as narrowings.

1. **A `CLAUDE.md` above the arms.** Claude Code discovers project instructions in parent
   directories. Put the arms somewhere with no ancestor `CLAUDE.md`, or the agent will
   answer using files that are not in your corpus. Ours read the real project wiki.
2. **Delegation escapes the workspace.** Left free, a session may call the `Explore`
   subagent, which is not confined to the working directory — one run answered by citing
   a file from an unrelated project elsewhere on the disk. The harness passes
   `--disallowedTools "Agent Task"`, and the resulting limit is declared in the report:
   the numbers describe an agent working in-session.
3. **Two batteries, one output file.** A stopped job whose child kept running mixed its
   rows into a second run's output. `run.mjs` now takes a lock on the output file and
   refuses to start if one is held.

## What it costs

A run is roughly $0.02–$0.11 on `haiku`, depending on the stratum: targeted reads are
cheap, open-ended exploration is not. The calibration is cents, because it never starts a
session. Budget the A/B, not the calibration.
