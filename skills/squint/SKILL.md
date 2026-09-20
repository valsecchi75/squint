---
name: squint
description: Inspect and control squint, the Read-narrowing hook. Use when the user types /squint, or asks whether squint is on, why a file was or was not narrowed, how much it has saved, or wants to turn it on or off for this project.
disable-model-invocation: true
---

# squint

The narrowing hook has no interface of its own: it runs inside every `Read` and then gets
out of the way. This skill is how a person asks it what it has been doing.

`SQUINT_CLI` below is the path this skill was installed with. Run it with `node`.

## What the user asked for

Match the argument after `/squint`:

| argument | run |
|---|---|
| *(nothing)* | `node "SQUINT_CLI" report` then `node "SQUINT_CLI" doctor` |
| `report` | `node "SQUINT_CLI" report` |
| `doctor`, `status`, `check` | `node "SQUINT_CLI" doctor` |
| `on` / `off` | `node "SQUINT_CLI" on` / `off` |
| `key` | Tell the user to run `node "SQUINT_CLI" key` **in their own terminal** — it prompts for a secret, and a prompt inside a tool call cannot be answered. Do not run it yourself. |
| anything else | `node "SQUINT_CLI"` with no argument, which prints the usage |

## Rules

1. **Report the output, do not re-interpret it.** The numbers come from a ledger that
   records every read the hook looked at, narrowed or not. If the tool says 3 of 19 reads
   were narrowed, say 3 of 19 — not "it is working well".

2. **Never print the API key**, never echo it, never read the file the user stores it in.
   If the key is missing, the answer is the command that sets it, not the key.

3. **`lines not read` is a count of lines, not tokens.** Do not multiply it by anything to
   produce a token or money figure. The hook does not know how those lines would tokenise,
   and a measurement multiplied by a guess is a guess.

4. **The reads left alone are the denominator, not failures.** `file-too-small`,
   `low-confidence` and `agent-set-window` are the hook working as designed. Present them
   that way.

5. When asked **why a particular file was not narrowed**, read the reason from the report
   rather than guessing. The five that matter:
   - `file-too-small` — under 400 lines, the call would cost more than it saves
   - `file-too-large` — over 80 KB, it would need splitting, and split confidences are not
     comparable, so it refuses rather than risk hiding code
   - `low-confidence` — the model was not sure enough to hide the rest of the file
   - `agent-set-window` — you already asked for a specific range
   - `unavailable` — no key, a timeout, or an unusable answer; the read went through whole

6. Keep it to a handful of lines. The detail is in the tool output, which the user can see.
