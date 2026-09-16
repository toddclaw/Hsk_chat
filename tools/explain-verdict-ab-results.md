# The grader and the grammar check disagreed, and the learner had to pick

`node tools/explain-verdict-ab.js --runs 3` — 15 sentences × 2 arms × 3, plus one
real grade each. About half a cent. Model `qwen/qwen3-235b-a22b-2507`, the
`TEACH_MODEL` both calls actually use.

Both run on the same student sentence and answer the same question in different
shapes: the grader in four booleans and a tag list, driving the ✓/✗ on the
message; the grammar check in prose, opening with one of three verdict lines.
Each derived its answer independently. The sheet is opened **by** the badge, so
a disagreement is not an abstraction — it is a red cross that opens onto the word
"Natural." with nothing to say which to believe.

## What shipped because of this

`explain()` is handed the grader's stored verdict, the rules it named and the
correction it offered, and told to explain that rather than form its own.
No extra model call: the grade is already on the turn.

| | opens with the grader's verdict |
|---|---|
| `independent` — each judges for itself | 39/45 **87%** |
| `handed` — the verdict is given | 45/45 **100%** |

## 87% overstates the agreement

Both disagreements sat on the two sentences that were a judgement call. Every
clear-cut sentence agreed 3/3; both borderline ones disagreed 3/3.

```
给我水。                grader: unidiomatic   independent: "Natural." ×3
我很喜欢学习中文语言。      grader: not correct   independent: "unidiomatic" ×3
```

The explain prompt says so itself — *"most sentences a learner worries about are
in this middle case rather than outright broken"* — so a fixture weighted toward
clear-cut sentences understates the rate for the sentences someone actually opens
the sheet for. Round one carried one borderline sentence in ten and scored 90%;
widening to five in fifteen moved it to 87%, and every point of disagreement in
both rounds was a borderline sentence. The honest reading is not "they agree 87%
of the time" but **"they agree on the easy ones and disagree on the ones you
would ask about."**

## The second disagreement is severity, not substance

Worth separating, because it changes what the fix is doing:

```
[independent] Understandable, but not how a native speaker would say it.
              我很喜欢学习中文。
              "中文语言" is redundant -- "中文" already means "Chinese language".

[handed]      Not correct.
              我很喜欢学习中文。
              The word 中文 already means 'Chinese language', so adding 语言 is redundant.
```

Same diagnosis, same correction, different severity. So the pre-fix experience
was rarely "two unrelated answers" — it was a ✗ on the message over a sheet
saying "understandable", which is confusing without being contradictory.

**The handoff resolves every disagreement in the grader's favour, including the
ones where the grader is the harsher and arguably worse judge** — 中文语言 is
redundant and perfectly understandable, and the middle verdict is defensible.
That is the right architecture anyway: the grader's verdict is what feeds the
mistake ledger, the category counts and drill selection, so a sheet that
overrode it would be disagreeing with the thing that shapes what the learner
practises next. But it is a real trade, and the sheet now inherits the grader's
harshness along with its consistency.

Disagreement is still permitted — the check must open with the given verdict and
may then say plainly that it disagrees and why. A silently substituted verdict is
the confusing case; an argued one teaches something.

## A defect the counts scored as correct

One of the first round's thirty handed replies:

```
Understandable, but not how a native speaker would say it.
请给我一杯水。
...even if grammatically correct.
Natural.
```

The shape instructions for all three verdicts were still in the prompt when the
verdict was already decided, so the model read the "Natural." branch and obeyed
it on the way out — planting a contradicting verdict at the foot of the sheet
built to stop verdicts contradicting. The dead text had been looked at and
judged harmless.

The opening-line score counted that reply **correct**. Only reading the replies
caught it, which is why the harness prints every one. Fixed by pruning the
prompt to the branch that applies; 0/45 handed replies end on a verdict line
since.

## What this does not fix

Nothing here makes either judge *right*. On 我的手表被我放在桌子上了 — the
reflexive 被 from the reported defect — the grader returned **"Natural." 3/3**,
and the check agreed in both arms. The two are now perfectly consistent and both
wrong.

Several other fixture sentences the grader passed are ones it might have been
expected to fault: 我要一个咖啡 (measure word), 我不能说中文 (能 for 会),
昨天的天气非常地好 (地). Not adjudicated here — that would need a judged run of
its own — but the direction is consistent with the 被 result: the grader, asked
"is this correct?", is lenient.

That is the finding that matters for the partner-reply correctness gate.
`ghost-grammar-ab.js` caught the same 被 sentence only with a judge whose failure
modes were **enumerated** ("the agent after 被 is the same as the subject", "the
verb is intransitive and cannot passivise"). The general framing does not catch
it. So the gate cannot simply reuse `grade()` as written, and the reworked
version has to be measured against the 50-plus real partner replies in
`ghost-grammar-ab-results.json`, which already carry independent verdicts.
