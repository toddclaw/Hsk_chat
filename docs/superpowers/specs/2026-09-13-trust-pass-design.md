# The trust pass: design

**Date:** 2026-09-13
**Status:** agreed, not started
**Plan:** `docs/superpowers/plans/2026-09-13-trust-pass.md`

## What this is

`BACKLOG.md` ranks work by learner value per unit of build. This is a different
axis, asked for directly: *clean things up, finish some research questions, and
make sure we are not standing on shaky ground.*

Shaky ground here means one of three things, and nothing else qualifies:

1. **A measuring instrument that is broken**, so numbers already published are
   wrong and nobody can tell which.
2. **A test that looks like it covers something and does not**, so a green suite
   is evidence of nothing in that area.
3. **A claim in the tree that is not true**, in a comment, a constant, or a doc.

Explicitly *not* in scope: new features, new activities, and any measurement that
costs real model budget. Those are the existing ranking's job.

## The five items, and why these five

### 1. The retrievals migration may never have reached the live database

v101 shipped a `retrievals` table. `db/schema.sql` has to be run by hand against
Supabase, exactly like the `side`/`secret` columns whose absence turned every
story into a chat in v100.

This one degrades rather than failing — `schemaHasRetrievals` (`sync.js:625`)
probes once and gap-fill keeps working locally. That is what makes it dangerous:
there is no error anywhere. And because **the retrieval count is also the word
selector**, a second device with no rows asks the same words for ever.

The owner believes it has been run. Believing is not the same as knowing, and the
check is one read-only query.

### 2. The out-of-level guarantee has no regression test in traditional script

The app's core promise is that no word above the learner's level reaches them.
v101 fixed a real violation of it — `gapPool()` was sourcing candidates from
`S.base`, which is always simplified, so 33.5% of gap-fill buttons in traditional
mode were simplified words.

That fix has **no regression test**. `gapPool()` lives at `index.html:5088`, which
no node suite can reach, and no browser case seeds `hsk1chat.script = "trad"`
(verified: no occurrence in `test/browser.test.js`). Reverting the fix would leave
the suite green.

A test that cannot fail is not covering the thing it appears to cover, and of
everything in this file, this is the one guarding the property that *is* the
product.

### 3. `judge()` does not exist, and has been printing zeros

`tools/story-ab.js:868` calls `judge(before, after)` to label each story segment
CONTINUES / RESTARTS / UNRELATED. No such function is defined in the file — only
`clarity()` and `castCall()` are. The call throws a `ReferenceError`, the
surrounding `.catch` writes it into the label, and `CONT`, `RESTART` and `UNREL`
print as **zero for every arm**, with no error on the console.

So any continuity figure that harness printed since the break was zero by
accident rather than by measurement. Task 13's topic arms escape this because
they were run with `--nojudge`.

This is the worst kind of broken instrument: it fails silently and its output is
plausible.

### 4. An empty completion throws away the evidence of why it was empty

About one completion in eight comes back empty on some routes. `turn()` retries
once (`index.html:1883-1888`), which is a workaround, not a diagnosis.

`callModel` already captures `finish_reason` — but at `index.html:1679`, *after*
the empty check throws at `1675`. So the one case where the reason matters is
precisely the case where it is discarded. OpenRouter routes one model id to
several providers and names the provider in the response, so the first question
is whether the empties concentrate in one, and today the data to answer that is
thrown away on every occurrence.

Three fields, captured on a path that already exists.

### 5. The 90-character segment target — and the answer is not what the backlog says

`prompt.js:565` asks for 九十个汉字. `index.html:1096` justifies it as two credits
at `DEFAULT_RATE = 45`, under `CREDIT_CAP = 3`. `test/pace.test.js:213` pins
`SEG = 90`. Measured output is 55–83 on `qwen`, 112–168 on capable models.

The backlog files this as *"segments run short of 90"*. Worked through against
`pace.js`, that framing is wrong in two ways, and both matter:

| segment chars | credits per 5-segment story | crosses `CREDIT_CAP` | discards earnings |
| --- | --- | --- | --- |
| 55 | 6 | no | no |
| 83 | 9 | no | no |
| **90 (the target)** | **10** | no | no |
| 112 | 12 | no | no |
| 168 | 15 | yes | no |
| 180 | 15 | yes | yes, 1 char |
| 200 | 15 | yes | yes, 21 chars |

First, **the shipped configuration is not the one that runs short.** `STORY_MODEL`
is `anthropic/claude-sonnet-4.5` (`index.html:1064`), which produces 112–168 and
therefore earns 12–15 credits against a design target of 10 — above it, not below.
The 55–83 figures are `qwen`, which is not the shipped story model.

Second, **nothing discards earnings anywhere in the measured range.** Leftover
characters carry between segments, so the low end recovers more than the
per-segment arithmetic suggests, and the discard rule in `earn()` (`pace.js:64`)
does not bite until ~180 — above the top of anything measured.

So the honest resolution is that the invariant the 90 protects **holds across the
entire measured range**, and the number itself is not load-bearing. The defect is
in the *test*, which pins a value no model produces, and in the comment, which
implies a fragility that the arithmetic does not support.

This is a research question that can be closed with arithmetic, for no model
spend. It deliberately does **not** change `prompt.js`: CLAUDE.md requires a
counted A/B before any prompt edit ships, and no evidence here calls for one.

## Ordering

Items 1–4 are independent and can be done in any order or in parallel. Item 5
touches `test/pace.test.js` and `RESEARCH.md` only.

The one ordering constraint worth stating is the one this pass **excludes**: the
measurement-lab rebuild (`judge()` → place names → wider seed set → re-run the A/B
series) has to happen in that order, because a re-run before the place-name fix
pays for results a known contaminant can invert. Item 3 here is the first step of
that sequence; the rest is deliberately out of scope and stays in `BACKLOG.md`.

## What "done" looks like

- The migration is confirmed present or run, and the answer is written down.
- Reverting the `gapPool()` fix turns the suite red.
- `judge()` returns real labels, and the entries that depended on it say which
  published numbers were affected.
- An empty completion logs its `finish_reason`, `native_finish_reason` and
  provider.
- `test/pace.test.js` asserts the invariant across 55–168 instead of pinning 90,
  and RESEARCH.md records why the number is not load-bearing.
- `BACKLOG.md` reflects every one of the above, including the two entries this
  pass closes outright.

## Out of scope, and staying in BACKLOG.md

Place names past the validator; the eight-seed weakness; the HSK 2/5/7–9
prompt-mode gaps; the Ghost Words A/B (needs a simulated learner); the `used`
array for transfer; every activity in the ranking; the `loadGoalList` race and
`run.sh`'s retry, which is a real item but touches `boot()` and wants its own
change.
