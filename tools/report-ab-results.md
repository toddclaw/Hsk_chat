# Does the progress report invent progress?

`node tools/report-ab.js --runs 12` — 288 calls per run at that size, about $0.03.
Model `qwen/qwen3-235b-a22b-2507`, the teaching model `writeReport()` actually uses.

Four synthetic briefs, name-free: `good`, `bad`, `empty`, and `lopsided` — a
learner with 60 graded messages, 50 of them clean, **no outstanding mistake
categories**, and every activity but chat untouched.

## What shipped because of this

One change: the brief's label for the message count, in `prompt.js`.

```
- messages graded: 60, of which the whole sentence was correct: 50
+ sentences they wrote themselves and had checked: 60, of which the whole sentence was correct: 50
```

| | invented deficits | on `lopsided` |
|---|---|---|
| shipped label | **45/48 (94%)** | **9/12** |
| `oldlabel` (the old wording) | 35/48 (73%) | 2/12 |

Reproduced in three runs after the change, with the arm inverted so it now runs
the *old* wording — if a future edit erodes the gain, `oldlabel` catching up is
how it shows.

## The counter the plan specified never fired

The plan's primary counter was **fidelity**: did the report state a number the
brief does not contain? On the first run it scored **48/48 across all four
arms** — a perfect tie, which read as "nothing to fix here".

It was measuring the wrong thing. Three of the four `lopsided` reports in that
same run contained a flat falsehood:

> "So far, you haven't written any sentences yet, even though you've practiced
> many messages." — `guarded`, against a brief showing 60 graded and 50 clean

> "While you've practiced many individual words and phrases, turning them into
> complete sentences will help you move forward." — `zeroes`

> "you haven't written full sentences outside the app yet" — `plain`

Invented **numbers** are not the failure mode. Invented **deficits** are, and
they are worse: a learner told they have not done the thing they have been
doing all fortnight stops trusting the report. A third counter was added for
this. The cause is structural rather than random — the prompt demands a
paragraph on what to work on next, and `lopsided` has nothing true to put
there, so the model manufactures a gap. Naming the author of the sentences
gives it one less plausible gap to reach for.

## Explicit zeroes did not earn their keep

The spec records carrying an explicit `0` for untouched activities as the thing
that stops a model inventing them. The measurement does not support it:

| | invented deficits | fidelity |
|---|---|---|
| `zeroes` (shipped) | 45/48 | 47/48 |
| `omit` (zero keys deleted) | 45/48 | 48/48 |

A dead tie, and `omit` was marginally ahead before the label change (36/48 vs
33/48). **The assumption is unsupported.** It is not refuted either — nothing
got worse. The behaviour was left as it is because that is the no-diff option
and removing it touches `report.js`, its tests and the brief's contract for no
measured gain. Worth deleting if anyone is simplifying that file for other
reasons; not worth a change of its own.

## The guard sentence does earn its keep

Cutting "Every number you state must come from the figures above…" (`plain`)
cost 22/48 vs 33/48 on invented deficits and 42/48 vs 46/48 on fidelity, before
the label change. Afterwards the gap narrowed to 43/48 vs 45/48. It is one
sentence and it never scored worse. Kept.

## What was tried and not shipped

`nodeficit` added an instruction forbidding the model to describe as missing
anything the figures show they did, and permitting paragraph 2 to be about
going deeper. At n=24 it scored a perfect 24/24 and looked like the answer. At
n=48 it scored 44/48 against the shipped 45/48. The 24/24 was noise. Not
shipped — it is a longer prompt that buys nothing.

## Two cautions for whoever re-runs this

**Arm order is not stable below about n=48.** Two consecutive n=24 runs put
`zeroes` at 19/24 then 15/24, and `guarded` at 16/24 then 19/24 — opposite
conclusions from the same code. Only the fixture effect was consistent at that
size. This is DEVELOPING.md's "compare arms only within a run", met in the wild.

**`specificity` is undefined for `empty`,** which is why it reads 0/12 on every
arm. That fixture has no tags and no non-zero activity, so there is no hook a
report could name. It is not a failure; do not tune against it.

## Residual, unfixed

`lopsided` still invents a deficit about a quarter of the time (9/12 on the best
shipped arm). A learner who is doing well, with no outstanding mistakes, is the
hardest case for a prompt that must produce a "what to focus on next"
paragraph. Nothing measured here closes it. Making paragraph 2 genuinely
optional is the obvious next thing to try and was not tried.
