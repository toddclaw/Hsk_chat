# Measuring the grader

Every ✓ and ✗ in this app comes from one model call that had never been scored
against anything. It drives the badge on each message, the mistake ledger, the
category counts, and which drill comes next. Seven rounds, in order, each
answering the question the one before it raised.

## Summary

**The grader is right about 80% of the time, and the only thing that has moved
that is asking several narrow questions instead of one broad one.**

**Round nineteen corrects round eighteen.** The real corpus mixes two models:
`STORY_MODEL` is `claude-sonnet-4.5` and everything else is qwen. Pooled, that
produced a partner "wrong 15.1% of the time" and a dominant 得 defect. Split, the
chat partner is wrong **3.2 times per 100 sentences** against the synthetic
corpus's **3.3** — the synthetic distribution was right all along — and 12 of the
13 得 errors belong to Sonnet, not qwen.

**Round seventeen retracts the recall half of rounds twelve through sixteen.**
The partner corpus has **21 strict positives**. One catch is five points of
recall, 95% intervals run ±19 points, and no paired test between the cascade,
`glm-5.3-flash` and Sonnet reaches significance — p = 0.727, 1.000 and 1.000.
The headline "the cascade beats Sonnet" was never measurable. What *is* well
powered is specificity, on 183 negatives, and it separates cleanly and says
something the recall race obscured: **Sonnet over-fires far more than anything
cheap.**

**Round fifteen answers the question the study was really for.** Eleven rounds of
prompting could not move qwen past 38%, and the conclusion drawn in round twelve
was that the model is the variable. It is the variable *for one call*. Given a
budget of forty-five calls instead of one — still a third of Sonnet's price —
the cheap model reaches **76% recall at 87% specificity**, past Sonnet on both.
The gap was never capability. It was how much work one call was being asked to do.

**Round thirteen makes it affordable.** `z-ai/glm-5.3-flash` scores 65% against
Sonnet's 70% and costs **$0.0003 a turn against $0.0041** — and it fires on 16% of
turns where Sonnet fires on 38%, with 73% of those firings justified against 49%.
On every axis that decides whether a gate is usable except raw recall, the cheap
Chinese-native model wins.

**Round twelve is the one that unsticks it.** Eleven rounds varied the prompt and
the model never moved. Swapped for `claude-sonnet-4.5`, partner recall goes from
38% to **75%** and four of the five stray 了/过 that survived every prompt are
caught. The cost is specificity: 96% → 66%, firing on 39% of all turns. **The
remaining problem changes character** — from a grader that cannot see the errors
to one calibrated too harshly, which this document has far better tools for.

**Round eleven found the cheapest of the repairs and the size of what is left.**
Reframing the grader from *a student at HSK 2 wrote this* to *the partner wrote
this and the learner will copy it* lifts partner recall from 24% to 38%, matches
the four-lens design at a fifth of its cost and twice its precision, and scores
identically on learner error. It is free. It is also nowhere near a gate.

**Round ten is the one that changes what to build.** Everything above is a fact
about learner error. On the partner's own Chinese — the correctness gate's actual
job — the shipped grader catches **24%** of outright errors and the four-lens
design **38%**. Neither is a gate. The nine rounds of tuning were measuring the
wrong distribution, and the thing they measured well does not carry.

**Round eight corrects the shape of that sentence, not its size.** A parsing
defect had been inflating specificity and deflating recall since round one. On
the repaired benchmark the grader is **90% recall and 66% specificity** — it
catches far more real errors than this document has been claiming and invents far
more false ones. Overall accuracy barely moves, which is why seven rounds went by
without noticing. Everything from round five onward ran on the *clean* set, which
never had the defect, so **the four-lens finding stands unchanged.**

| round | question | answer |
|---|---|---|
| 1 | how good is it? | 79% — about one verdict in five is wrong, in both directions |
| 2 | do prompt rewrites help? | no; and a stronger model looked like a different instrument |
| 3 | was that a real trade-off? | no — round 2's positive class was weak. Sonnet is simply better: 95% recall at 26× the cost |
| 4 | is the miss rate sampling variance? | no — blind spots. 41 of 43 sentences got 0 or 5 votes out of 5 |
| 5 | does decomposing into four specialists help? | **yes — 91% against 80%, p = 0.043, at a 26th of Sonnet's cost** |
| 6 | is the gain the naturalness question? | no — worth 4 points, p = 0.58 |
| 7 | is it separating verdict from categorisation? | no — a detector with no categorisation load scores the same 84% |
| 8 | is the benchmark itself sound? | **no — 14% of the paired set was a parsing defect. Round one's two numbers were wrong in opposite directions** |
| 9 | can Claude label the partner corpus? | yes — 93% against human ground truth, and the residual disagreement is definitional |
| 10 | **does any of it transfer to the partner's Chinese?** | **no. 90% recall on learner error becomes 24%. The four-lens design doubles that and stops at 38%** |
| 11 | is the drop the prompt's frame? | partly — telling it the partner wrote the text is worth 14 points (p = 0.065) and costs nothing on the learner side. Not the other 52 |
| 12 | **was it the model all along?** | **yes. Sonnet takes partner recall 38% → 75% and catches four of the five aspect errors nothing else could see. It over-fires badly, which is a different and easier problem** |
| 13 | do the Chinese labs' models do better? | **`glm-5.3-flash` gets 65% at a fourteenth of Sonnet's cost, with better specificity and precision. The two flagship reasoning models cost *more* than Sonnet, not less** |
| 14 | does softening the bar fix the over-firing? | on Sonnet yes — 13 points of specificity for 2 of recall. On `glm-5.3-flash` no, it costs 13 points of recall. **The bar belongs to the model, not to the prompt** |
| 15 | **can structure buy back the model?** | **yes, on the strict bar. A cascade of ~45 small qwen calls beats Sonnet on recall (76% vs 70%) and specificity (87% vs 74%) at a third of the cost. It does not close the gap on "worth imitating"** |
| 16 | can a stiltedness channel and a cheap panel close the rest? | the channel works; the panel arithmetic is sound. **But see round seventeen — the recall half of this answer was never measurable** |
| 17 | **are any of these recall numbers real?** | **no. 21 strict positives; one catch is 5 points. Every recall comparison in rounds 12–16 is inside the noise. Specificity is well powered and says something different** |
| 18 | **is the synthetic corpus even the right distribution?** | real turns are wrong 15.1% of the time against the synthetic 8.8% — **but see round nineteen, which is a correction, not a confirmation** |
| 19 | **was that comparing like with like?** | **no. The real corpus pools two models. Story time runs on Sonnet; chat runs on qwen. Split, the synthetic corpus is an excellent match for the chat partner — and Sonnet is the better writer, not the worse one** |
| 20 | what else is in the database? | **208 stored grader verdicts on the learner's own sentences, with error tags, already paid for. A benchmark for the student half that costs no API calls at all** |

What survives all seven: **diversity of lens.** Repetition doesn't help, wording
doesn't help, unloading the call doesn't help. Several passes each hunting a
different *kind* of fault do. Pooled, every single-lens arm is 280/340 (82%)
against the four-lens design's 130/142 (92%), p = 0.011.

That is an attention limit rather than a capability one — the same shape as the
reflexive 被 this work started from, which the model misses when asked "is this
correct?" and catches when asked whether the agent differs from the subject.

| design | catches wrong | clean | cost/sentence |
|---|---|---|---|
| shipped, one call | 80% | 43/43 | $0.000093 |
| naturalness framing | 84% | 43/43 | $0.000106 |
| detector + categoriser | 84% | 43/43 | $0.000081 |
| five-vote self-consistency | 84% | 43/43 | $0.000300 |
| **four specialists + integrator** | **91%** | **43/43** | $0.000184 |
| `claude-sonnet-4.5`, one call | 95% | 42/43 | $0.004820 |

**Nothing shipped yet.** Two things are unmeasured and both matter: whether four
lenses are needed or two would do, and whether any of this transfers to the
partner's Chinese, which is the correctness gate's actual job and a different
distribution from learner essay error.

Three conclusions in this document were drawn and then falsified by the next
round. They are corrected in place, with the correction next to the claim.

---

## Round one: how good is it?

`node tools/grader-bench.js --build && node tools/grader-bench.js --n 120` —
120 calls, well under a cent. Model `qwen/qwen3-235b-a22b-2507`, the
`TEACH_MODEL` the grader actually runs on.

Every ✓ and ✗ in this app comes from one model call that had never been scored
against anything. It drives the badge on each message, the mistake ledger, the
category counts, and which drill comes next. Here is its first number.

| | n | correct | |
|---|---|---|---|
| wrong sentences it faulted | 60 | **47 — 78%** | recall |
| correct sentences it passed | 60 | **48 — 80%** | specificity |
| overall | 120 | **95 — 79%** | |

**About one verdict in five is wrong, and it errs in both directions roughly
equally.** It is not simply lenient, which is what the 被 results had suggested
— it misses real errors and invents errors at about the same rate.

> **Corrected by round eight.** Both halves of that table were built on a
> contaminated benchmark. Repaired and re-run over all 240 items: **90% recall,
> 66% specificity, 78% overall.** The headline survives and the reading of it
> does not — the grader is not evenly wrong in both directions. It is good at
> spotting errors and bad at leaving correct sentences alone, which is the worse
> of the two failures for a gate that retries on a fault.

## The ground truth

[MuCGEC](https://github.com/HillZhang1999/MuCGEC) (Apache-2.0; Zhang et al.,
*MuCGEC: a Multi-Reference Multi-Source Evaluation Dataset for Chinese
Grammatical Error Correction*, [NAACL 2022](https://aclanthology.org/2022.naacl-main.227/)).
7,063 sentences by learners of Chinese, each corrected by three annotators and
reviewed by a senior one — 2.3 references per sentence. Its dev set, 1,137
sentences, is in the repo as plain TSV: `id ⇥ source ⇥ ref1 ⇥ ref2…`.

**The dev set is 100% erroneous.** 0 of 1,137 sentences are left unedited by
every annotator. A benchmark of only-wrong sentences is useless here: a grader
that fails everything scores 100% on it, and over-harshness is a live failure
mode rather than a hypothetical — the grader's own prompt has to warn it *"do
not manufacture a problem to have something to teach"*, and 80% specificity says
the warning is not enough.

So the pairing that makes this work: **the source is a wrong sentence and its
references are the same sentence written correctly, by a human.** One corpus,
both directions, no model anywhere in the labelling.

## Fit, and where it breaks down

These are essay sentences by advanced learners, not HSK 2 chat messages:

| | raw dev set |
|---|---|
| median length | 36 characters (p90 85, max 239) |
| stays inside HSK 2 vocabulary | 1.1% |
| stays inside HSK 3 | 2.7% |
| stays inside HSK 4 | 13.0% |

Filtering to pairs where **both halves** validate at HSK 4 or below gives 120
pairs at a median of 19 characters — far closer to a chat message. Below that
the corpus runs out: 9 pairs at HSK 2, 13 at HSK 3. The built benchmark is 240
items, 18 at HSK 2, 26 at HSK 3, 196 at HSK 4. Each item is graded **at its own
level**, because the grader prompt names the level and judging a sentence at the
wrong one tests a different prompt.

(It was 140 pairs until round eight found that 20 of them were a parsing defect.)

Three limits to keep in view:

1. **Still not the app's distribution.** HSK 4 essay prose is nearer than the raw
   corpus but is not an HSK 2 learner writing 我昨天去公园了.
2. **Not the partner's Chinese at all.** The correctness gate has to judge fluent
   model output with occasional structural oddity. Nothing here measures that.
3. **The two numbers are not equally trustworthy.** The wrong half is definitely
   wrong — three annotators edited it. The right half is a *minimal human fix*,
   which is correct but not necessarily graceful: 我不够朋友, 那个是多么有意思啊
   and 这是我的最后一封信，分开不是容易的事情 were all flagged, and a grader that
   calls those unnatural is not obviously mistaken. **Specificity is a floor, not
   an estimate.** Recall is the number to trust.

The corpus gives no error *tags* — MuCGEC has corrections, the older CGED shared
task has four coarse types, and neither maps to this app's seventeen. Since the
tags drive the mistake ledger and drill selection, that part stays unmeasured
until something is hand-labelled.

## Both failure directions

```
missed (wrong, called correct)
  除了母亲以外，父亲对我的影响也不少。
  我也来介绍一下儿我的家吧。我家有四口人。

false alarms (correct, called wrong)
  我不愿意这么过分地喜欢歌手。      ← the annotator's own 的/地 fix
  就与一个人的生命有关。
  我不够朋友。
```

The first false alarm is worth dwelling on: the pair is 过分**的**喜欢 →
过分**地**喜欢, and the grader faulted the corrected version. That is the
de-particle distinction the app has a dedicated tag for.

## What this does not settle

The reflexive 被 that started this work — 我的手表被我放在桌子上了 — comes back
"Natural." from this grader 3/3, and the enumerated judge in
`ghost-grammar-ab.js` catches it on the same model. That remains the strongest
evidence that the framing, not the model, is the ceiling: asked *"is this
correct?"* it is at 79%; asked *"is the agent after 被 the same as the subject,
is the verb intransitive"* it is right.

The benchmark exists so the next change is scored rather than argued. Candidates,
in order of expected value:

1. Rewrite the grader prompt toward enumerated failure modes and re-score.
2. Try a stronger grading model — already a separate setting from the chat model,
   so it costs one line to test.
3. Few-shot examples from the corpus — treat with suspicion: `RESEARCH.md` has
   already measured that a wrong form in a prompt gets reproduced.

Fine-tuning is the wrong shape for this project: static files, no build step, no
backend, the learner's own OpenRouter key. A fine-tune needs a hosted endpoint
and that is a different application.

## Round two: four candidate graders

`--arm shipped|checklist|correctionFirst`, 120 items each, plus the shipped
prompt on a stronger model.

| arm | | recall | specificity | overall |
|---|---|---|---|---|
| `shipped` | control | 48/60 80% | 45/60 75% | 93/120 **78%** |
| `checklist` | tags as a pre-decision list | 44/57 77% | 50/60 83% | 94/117 **80%** |
| `correctionFirst` | rewrite, then compare | 46/60 77% | 50/60 83% | 96/120 **80%** |
| `shipped` on `claude-sonnet-4.5` | | 57/59 **97%** | 30/57 **53%** | 87/116 75% |

The control replicated at 93/120 against the first run's 95/120 (p = 0.876), so
the benchmark is stable enough to read.

**Neither prompt rewrite improved discrimination.** Both moved about eight points
of specificity and lost about three of recall, for an overall change that is not
significant (p = 0.64 and p = 0.75). That is sliding along the same trade-off
curve, not getting better at the job. The enumerated checklist — the change with
the actual hypothesis behind it, since enumerating failure modes is what caught
the reflexive 被 — did not reproduce that gain on general learner error.

**The stronger model is a different instrument, not a better one.** Sonnet
catches 57 of 59 genuinely wrong sentences against qwen's 48 of 60 (p = 0.008),
and flags half the correct ones (p = 0.013). Overall it scores *worse*.

Except the specificity half of that is largely the benchmark's fault, exactly as
flagged above. Its false alarms:

```
我不愿意这么过分地喜欢歌手。          ← the annotator's own 的→地 fix
如果父母本身的行为已经是很差，…       ← 已经是很差 left unrepaired
这是我的最后一封信，分开不是容易的事情。
但将来还是愿意做一个母亲，…多教我的孩子点事情。
```

These are minimal fixes: the annotator repaired the error they were annotating
and left the rest of the sentence alone. 过分地喜欢歌手 is still not what a
native speaker would say. **A judge flagging them is not obviously wrong**, which
means Sonnet's 53% is not evidence that Sonnet is over-harsh — it may be evidence
that the positive class is not very positive. Recall is measured against three
annotators agreeing a sentence is broken, and stays trustworthy.

## Round three: a positive class that is actually positive

The conclusion drawn from round two — *"the two jobs want opposite operating
points, use two models"* — **was wrong, and this round is why.** It rested on
MuCGEC's minimal fixes being a fair positive class, which the round-two write-up
itself warned they were not, and then reasoned from them anyway.

Rebuilt: MuCGEC's wrong half tightened to sentences **every** annotator edited,
and the right half replaced with text written to be correct. Two positive
sources, scored apart rather than pooled, because they are not equally clean.

| arm | catches wrong | passes this app's own | passes Tatoeba |
|---|---|---|---|
| `shipped` | 35/43 81% | **43/43 100%** | 36/43 84% |
| `checklist` | 34/43 79% | 43/43 100% | 38/43 88% |
| `correctionFirst` | 31/40 78% | 43/43 100% | 38/43 88% |
| `claude-sonnet-4.5` | **40/42 95%** | **42/43 98%** | 30/43 70% |

**Sonnet's 53% specificity was the benchmark, not Sonnet.** On text written to be
correct at level it is 98% — against 53% on minimal fixes, p < 0.000001.

Pooled recall across both builds: Sonnet **97/101 (96%)** against shipped
**83/103 (81%)**, p = 0.0008, at one extra false alarm in 43 (p = 1.0, no
difference). There is no trade-off to navigate. Sonnet is better at both jobs.

Its single false alarm is this repo's own HSK 2 partner sample —
我今天很忙。上午我去了商店，买了一些水果。你今天做什么了？ — where 上午 sits
ahead of the subject. Acceptable Chinese, so a marginal call rather than an error.

The Tatoeba column is crowd-sourcing showing through: 很少人这么认为 wants
很少**有**人, and Sonnet flagging 30% of that set is mostly Sonnet being right.
Which is the reason the two positive sources are reported apart.

**All three prompt rewrites are dead.** None beat the shipped prompt on anything,
and all three are indistinguishable from it on clean text. The gain was never in
the wording.

### What is left is cost, not accuracy

Sonnet runs **$0.00486 a call**, about 26× a qwen call. As both grader and gate
that is two calls an exchange — roughly **410 exchanges a month** against the
app's ~$4 budget. As the grader alone it is pennies at any realistic volume.

## Round four: self-consistency does not work here

A Sonnet call costs about 26x a qwen call, so five qwen votes cost a fifth of
one Sonnet call. If the shipped grader's misses were sampling variance -- it runs
at temperature 0.7 -- voting would recover most of them for almost nothing.

`--vote 5 --n 43`, 430 calls, $0.026.

```
how many of 5 calls faulted each sentence
              0   1   2   3   4   5
  wrong       7   1   0   1   0  34
  app-clean  43   0   0   0   0   0
```

**41 of 43 sentences got either zero votes or all five.** Two showed any
disagreement at all. These are blind spots, not variance.

| rule | recall | false alarms on clean |
|---|---|---|
| any of 5 faulted | 36/43 84% | 0/43 |
| majority of 5 | 35/43 81% | 0/43 |
| single call (round three) | 35/43 81% | 0/43 |
| `claude-sonnet-4.5`, one call | **40/42 95%** | 1/43 |

Majority voting is indistinguishable from one call. The most permissive rule buys
**one sentence** for five times the cost, where Sonnet buys fourteen for 5.4x
that again. The cheap route out of the budget problem is not available.

The clean half came back 43/43 unflagged at every threshold, so the cheap model
is at least *stably* right about good Chinese.

### What it structurally cannot see

The seven missed by all five calls have a character:

```
除了母亲以外，父亲对我的影响也不少。      少 for 小
我也来介绍一下儿我的家吧。                一下儿 for 一下
我很高兴她给我这个她做的礼物。            modifier order
我知道哪去睡觉                            哪 for 哪儿, and the order
```

The first is a **homophone substitution**, the failure mode this app exists to
catch -- the learner types pinyin and picks from a candidate list, and the grader
prompt carries a paragraph warning it about exactly this. Missed 5/5.

The rest are misplaced modifiers, 儿化 and phrase-internal word order. Every one
reads fluently at a glance, which is the same shape as the reflexive 被: errors
that do not look wrong unless you are specifically checking the structure. The
model is not sampling past them. It does not see them.

**Scope:** this measured the grader against learner essay errors. The gate's job
is the partner's Chinese, and there is no equivalent blind-spot map for that.

## Round five: decomposition works, at a 26th of the price

Four specialists — word, grammar, order, natural — each asked ONE narrow
question, run in parallel, then an integrator that reconciles their reports into
the app's verdict shape without re-judging. Precedent: this repo already found
that fusing the drill check into the grader's answer gave 9-wrong-in-15 and
splitting it gave 15/15.

Same items, same model, `--arm decomposed` against `--arm shipped`, n=100:

| | catches wrong | passes hand-written | passes Tatoeba | cost/sentence |
|---|---|---|---|---|
| `shipped` | 79/99 80% | 43/43 | 86/100 | $0.000093 |
| **`decomposed`** | **90/99 91%** | **43/43** | 74/100 | $0.000184 |
| `claude-sonnet-4.5` (n=43) | 95% | 42/43 | 70% | $0.004820 |

p = 0.043 on the same items; pooled with the n=43 run, 130/142 against 114/142,
**p = 0.0098**. Twice the cost of one call and **26x cheaper than Sonnet**, for
accuracy that is not distinguishable from it. Both jobs on the decomposed grader
fit about 10,900 exchanges a month in the app's ~$4 budget, against 410 on
Sonnet.

**No over-flagging.** The obvious risk of four checks each primed to find a fault
is that they find one; every specialist fired 0/43 on hand-written text. Tatoeba
falls to 74%, but Sonnet scores 70% there and Tatoeba is known-noisy, so being
stricter on it is probably being right.

### One specialist is doing almost all the work

Of 90 correct catches, **89 had `natural` firing**. Exactly one was caught
without it, by `word`. `grammar` and `order` never caught anything on their own.

`natural` is also not doing what its prompt says. It is told to look *only* at
idiom and explicitly not at anything ungrammatical, and it fires on 90 of 100
sentences whose faults are mostly grammatical. It has become a general "does this
read wrong" detector — and a well-calibrated one: 0/43 on hand-written text,
25/100 on noisy Tatoeba.

The reading at the time: *"would a native speaker say it this way?" is a
better-calibrated question than "is this correct?", and most of the 11-point gain
is that question rather than the decomposition around it.* **Round six tested
that directly and it is wrong** -- the question alone is worth four points and
fails a significance test. See round six for what the breakdown actually meant. The other three specialists
still earn their place for CATEGORISATION — the four `cats` and seventeen tags
drive the mistake ledger and drill selection, and detection alone does not
produce them — but they are not what is finding the errors.

That makes a one-call naturalness-framed grader the obvious next arm, at a
quarter of the decomposed cost. Untested.

### A retraction from round five's own first run

At n=43 this was reported as fixing six of the seven blind spots "including the
homophone case". At n=100 除了母亲以外，父亲对我的影响也不少 (少 for 小) is
**missed again**. Same sentence, same arm, different sample: it is borderline
rather than fixed, and the earlier claim rested on one draw. The nine still
missed at n=100 include it, the 一下儿 case and 女服务员回去后，我们一起笑了起来,
which no configuration has ever caught.

## Round six: it was not the question, and the retraction points somewhere better

Round five read the specialist breakdown -- 89 of 90 catches had `natural`
firing -- and concluded the gain was the QUESTION, "would a native speaker say
it this way?" beating "is this correct?". This arm tests exactly that: the same
framing as a single call, JSON contract and seventeen tags untouched, so the only
variable is what is asked.

Same items, same model, n=100:

| | catches wrong | passes hand-written | passes Tatoeba | cost/sentence |
|---|---|---|---|---|
| `shipped` | 79/99 80% | 43/43 | 86/100 | $0.000093 |
| `naturalFraming` | 82/98 84% | 43/43 | 83/100 | $0.000106 |
| `decomposed` | **90/99 91%** | 43/43 | 74/100 | $0.000184 |

`naturalFraming` against `shipped`: **p = 0.58**. Against `decomposed`: p = 0.14.
`decomposed` against `shipped`: p = 0.043.

**The hypothesis is not supported.** The question is worth about four points and
nothing that survives a significance test. The decomposition is worth eleven and
does. Round five's reading was wrong.

### Why the specialist breakdown misled

`natural` firing on 89 of 90 catches does not mean `natural` *alone* would catch
them, and this arm is the proof. The difference between the two is not the
question. It is everything else the call is being asked for at the same time.

In the decomposed design each specialist answers one binary — found, and a
one-line note — in a 200-token budget, and produces nothing else. In
`naturalFraming` the same question arrives bundled with `meant`, `better`, four
`cats` and a tagged `errors` array, and the verdict degrades.

That looked like the drill-check finding again -- the target check fused into the
grader's answer came back wrong 9 times in 15, split into its own call 15/15 --
and the conclusion drawn was that *separating the verdict from the categorisation
is what buys the accuracy.* **Round seven tested that directly and it is also
wrong**: a detector carrying no categorisation load at all scores 84%, identical
to this arm. See round seven.

### Which suggests a cheaper design than either

If the mechanism is separation rather than breadth, four specialists are more
than the job needs. One detection call answering nothing but "is there a fault
here", then a categorisation call only when the first says yes, should reach
decomposed accuracy at close to `naturalFraming` cost -- two calls on a faulty
sentence, one on a clean one, and most sentences are clean.

Untested. It is the obvious next arm and it is cheap.

## Round seven: it was not separation either. It is diversity of lens.

Round six concluded that separating the verdict from the categorisation is what
buys the accuracy. This arm tests that directly: one detector answering nothing
but "is there a fault here", then a categorisation call only when it says yes.
Verdict and tagging fully separated, one lens.

| | design | catches wrong | clean | cost/sentence |
|---|---|---|---|---|
| `shipped` | 1 call, general Q, full contract | 79/99 80% | 43/43 | $0.000093 |
| `naturalFraming` | 1 call, naturalness Q, full contract | 82/98 84% | 43/43 | $0.000106 |
| `split` | detector + categoriser, no contract on the verdict | 84/100 84% | 43/43 | **$0.000081** |
| `decomposed` | 4 narrow Qs in parallel + integrator | **90/99 91%** | 43/43 | $0.000184 |

`split` against `naturalFraming`: **p = 1.000**. Identical. Removing the entire
categorisation load from the verdict call changed **nothing**.

**So round six was wrong too.** Separation is not the mechanism.

### What three failed explanations leave

Four experiments, each removing one candidate:

| what was varied | result | |
|---|---|---|
| the same call, five times | 84% | repetition does not help |
| the question's framing | 84% | wording does not help |
| verdict split from categorisation | 84% | separation does not help |
| **four different narrow questions** | **91%** | this does |

Every single-lens arm lands in 80–84% whatever is done to it. Pooled across all
of them, 280/340 (82%) against the four-lens design's 130/142 (92%),
**p = 0.011**.

The mechanism that survives is **diversity of lens**: several passes each looking
for a different kind of fault beat one pass however it is framed, however much
load is taken off it, and however many times it is repeated. Attention, not
capability and not contamination — the model can see these errors when asked
about that class of error specifically, and cannot when asked to look at
everything at once.

**Honest limit:** `decomposed` against `split` alone is p = 0.199, not
significant at n=100. The claim rests on the pooled comparison and on four arms
pointing the same way, not on any single pairwise test. Worth a larger run before
it is treated as settled.

### What this changes about what to build

`split` is the cheapest arm measured — $0.000081 a sentence, below even the
shipped single call, because a clean sentence costs one small call and most
sentences are clean. But it buys nothing over the current grader that survives a
significance test.

`decomposed` is the one with the evidence. Twice the cost of the shipped call,
26x cheaper than Sonnet, and it is the only design that moved.

Two open questions worth a run each before wiring anything in: whether four
lenses are needed or two or three would do, and whether the same gain appears on
the partner's Chinese, which is the gate's actual job and a different
distribution from learner essay error.

## Round eight: the benchmark had a hole in it

Seven rounds of measurement, and nobody had looked at the ground truth by eye.
Printing the items to hand-label them made it obvious within a screen: **twenty
of the 280 items were the literal string 没有错误** — "no error".

That is not a sentence. It is MuCGEC's marker for *this annotator found nothing
to correct*, sitting in the reference column where a corrected sentence goes.
`--build` took the first reference that differed from the source and validated at
HSK 4; the marker satisfies both conditions, because 没有 and 错误 are ordinary
HSK vocabulary. So it entered the benchmark as a correct sentence.

**It poisoned the pair in both directions at once.**

- The marker became a `right` item. The grader passed all 7 of the 7 sampled —
  it *is* well-formed Chinese. Seven free specificity points for judging a
  string that no learner would ever type.
- Its source became a `wrong` item — a sentence a human annotator had just
  declared error-free. The grader was scored as missing an error on all 7, and
  looking at them, it was right every time:

  > 除了母亲以外，父亲对我的影响也不少。
  > 这样一个月很快过去了。
  > 还要提一个事。

The fix drops the whole row rather than just the marker. If the annotators
disagreed about whether there is an error *at all*, the pair is not ground truth,
whatever the other annotator wrote. 120 pairs survive of 140.

### What it was worth

Rescoring every stored run with the defective pairs removed, then re-running the
shipped grader over all 240 repaired items:

| | recall | specificity | overall |
|---|---|---|---|
| round one, as published | 78% | 80% | 79% |
| round one, defect dropped from the stored run | 89% | 77% | 83% |
| **fresh run, repaired benchmark, all 240** | **90% (107/119)** | **66% (79/120)** | **78% (186/239)** |
| round two `checklist`, defect dropped | 83% | 81% | 82% |
| round two `correctionFirst`, defect dropped | 87% | 81% | 84% |
| round three Sonnet, defect dropped | 98% | 43% | 71% |

**The overall number is almost unchanged and the two numbers inside it swapped
places.** Every arm gains ~10 points of recall and loses some specificity,
because every arm was being charged for the same seven sentences it had judged
correctly and credited for the same seven it never had to judge.

Three things follow.

1. **"Wrong in both directions equally" was an artefact.** The grader leans
   harsh. For a gate that retries whenever it sees a fault, over-harshness is the
   expensive direction: the cost lands on Chinese that was already fine.
2. **Sonnet's profile is the same shape, further along.** 98% recall, 43%
   specificity. The round-three conclusion that it is "simply better" holds for
   catching errors and inverts for leaving good sentences alone.
3. **Rounds five through seven are untouched.** They ran on
   `grader-bench-clean.json`, which sources its positive class from Tatoeba and
   this repo's own samples and contains zero markers. The four-lens result —
   91% against 80% — stands exactly as published.

The cheap lesson: **print the ground truth and read it.** Seven rounds of
arithmetic on top of a corpus nobody had looked at.

## Round nine: how good is Claude's labelling?

The correctness gate's real job is the partner's Chinese, and there is no corpus
of that with human labels — the partner is a model, its output is fresh, and
nobody has annotated it. The labels have to come from Claude.

That discards the one property that made this benchmark worth building: no model
anywhere in the labelling. Before spending Claude's judgement on partner Chinese,
it gets scored on Chinese a human already judged.

### Keeping it blind

`tools/label-calibrate.js`. The benchmark is 120 *pairs* that differ by a
character or two, so showing both halves together measures nothing. Each pair is
split — one half to batch A, one to batch B, which side chosen by a fixed-seed
shuffle — and the truth column is never written to the blind file. Batch A came
out 61 wrong / 59 right, which the labeller did not know either.

120 sentences, judged one pass, no grader prompt and no per-item deliberation
budget:

| | n | correct | |
|---|---|---|---|
| wrong sentences faulted | 61 | **56 — 92%** | recall |
| correct sentences passed | 59 | **55 — 93%** | specificity |
| overall | 120 | **111 — 93%** | |

**93%, against the shipped grader's 78% on the same repaired corpus.** Sonnet
reaches higher recall than this (98%) and pays 43% specificity for it; the
labelling is a few points behind on catching errors and fifty ahead on not
inventing them, which is the trade a labeller wants and a grader does not.

### The nine misses are not perception failures

Every one was read back against its pair, and they fall into two kinds.

**Four are references that are still awkward** — the annotator made a minimal fix
and left the sentence ungainly, and the label said "correct" anyway:

> 如果父母本身的行为已经是**很差**…
> 我希望我会见到**些个**住在北京的人儿。
> 中国也就这几年慢慢开始**减少吸烟者运动**。

This is the limitation the document already names — *specificity is a floor, not
an estimate* — arriving from the other side. The labeller was penalised for
agreeing with it.

**Five are optional stylistic improvements** the annotator chose to make:

| passed as correct | the human's edit |
|---|---|
| 我们要保护这个地球的自然 | …的自然**环境** |
| 我从上个星期到九月份在上海 | …**一直**在上海 |
| 帮自己的回收计划 | 帮自己**国家**的回收计划 |
| 他们不仅对我来说是非常好的老师 | **对我来说**他们不仅是… |

Not one is a grammatical error. They are a good writer improving a fine sentence.

**So on outright errors the labelling looks near-clean, and the disagreement
lives entirely at the boundary where "wrong" is a matter of degree.** That
boundary is precisely what the partner corpus has to be careful about, and it is
the argument for labelling partner turns on two axes rather than one: `wrong`
(a native speaker would call it an error) and `unnatural` (grammatical, but not
what anyone would write). Collapsing them is what put four of these nine misses
where they are.

### What it licenses

At 93% with errors that are definitional rather than perceptual, a Claude-labelled
partner corpus can distinguish an 84% grader from a 91% one — attenuated, so it
wants more items than a human-labelled set would, and it cannot certify anything
finer than a few points. Good enough to answer the transfer question. Not good
enough to tune against at the margin.

Batch B is untouched, 120 items, and stays that way as a held-out check if the
labelling is ever suspected of drifting.

## Round ten: it does not transfer

Nine rounds on MuCGEC, and the question underneath all of them was whether any of
it describes the job. The correctness gate does not judge learner essays. It
judges `qwen/qwen3-235b-a22b-2507` writing Chinese to an HSK 2 student, which is
fluent, short, ordinary, and wrong in a different way and at a different rate.

No corpus of that exists, so one was generated: `tools/partner-corpus.js`, 34
conversations of 6 turns through `HSKPrompt.build()` at HSK 2 and 3 across chat,
focused and story, learner side simulated, no personal names. **204 partner
turns, $0.014.** Labels are Claude's — round nine is what licenses that — on the
two axes the label set was designed around, plus a third the design did not
anticipate.

### What the partner actually does

| | n | rate |
|---|---|---|
| outright wrong | 18 | **8.8%** |
| grammatical but not what anyone would write | 32 | 15.7% |
| English left in the reply | 3 | 1.5% |
| clean | 151 | 74.0% |

**One partner turn in eleven is outright wrong, and one in four is not worth
imitating.** That is the premise of this whole line of work confirmed with a
number: the Chinese on screen is not reliably good enough to copy.

The third row was not planned for. Rule 4 of the partner prompt forbids English
outright, and three turns have it anyway — 我喜欢散步，especially in the park,
and 光头强说话很 funny. It is not a matter of degree the way naturalness is, so
it scores inside the strict bar.

### The two graders on it

204 turns, each judged at its own level, by the same code
`tools/grader-bench.js` runs — exported rather than copied, so a reworded
duplicate cannot answer this about a grader that does not exist.

| | recall, strict | recall, loose | specificity | fires on | justified |
|---|---|---|---|---|---|
| shipped, one call | **24%** (5/21) | 13% (7/53) | 97% | 11/204 | 45% |
| four specialists | **38%** (8/21) | 38% (20/53) | 88% | 30/204 | 27% |
| *(the same two on learner error)* | *90%* | — | *66%* | — | — |

**90% recall becomes 24%.** The four-lens design still wins — it finds two thirds
more, and it is the only arm that moves at all on the awkward-but-grammatical
middle, 38% against 13%. But it wins a race that neither arm finishes. A gate
built on the best measured design today would pass roughly six of every ten
partner errors straight to the screen.

### Why, and it is not subtlety

The thirteen outright errors the four-lens grader passed are not delicate. Five
of them are the same error:

> 你最喜欢看什么节目**了**？
> 你见过真的熊猫**了**吗？
> 熊猫**吃过**竹子**了**，它们每天吃很多竹子。
> 你今天晚上吃什么**了**？
> 我在家**听懂了**一首中文歌。

Stray and misplaced 了/过 — *aspect*, the single most drilled thing at HSK 2, and
one of the seventeen tags the app already carries. Elsewhere: 我**带**了眼镜 for
戴, 我妈妈也做饭很好, 米饭很饱, 煮面条不怕.

**The shipped grader passed all thirteen as well.** Two designs that differ by
four model calls and eleven points on MuCGEC agree exactly on what they cannot
see here, which says the failure is upstream of the design. The likely cause is
the prompt's frame: `grade()` is written to judge *a learner's sentence at their
level*, and it is being handed fluent, native-shaped, on-topic text. The model
appears to answer the question it was really asked — *is this the Chinese of
someone at HSK 2?* — for which the answer is yes, and the stray 了 never comes
up. Untested, and the obvious next probe.

### A defect found in passing

Of the false alarms, two of ten are the four-lens grader faulting **the app's own
`[[NEED:词|pīn yīn|english]]` markup** — the mechanism rule 8 gives the partner
for introducing a new word. A gate wired in today would retry the partner for
obeying its own instructions, indefinitely, since the ladder has no rung that
drops the markup. That is a bug in the gate design, not in the grader, and it is
cheap to fix by stripping the markup before grading — but only because the corpus
was read by eye. No summary statistic would have shown it.

## Round eleven: the frame is worth fourteen points of the sixty-six

Round ten's guess: `grade()` opens *"You are grading one sentence written by a
student of Chinese at HSK 2 … the student wrote it THEMSELVES, so it may well be
wrong"*. That frame is measured-necessary on the learner's half — without it the
model assumes correctness and passes everything. Handed the partner's fluent,
on-level, native-shaped text, it may be answering a different question: not *is
this correct* but *is this the Chinese of someone at HSK 2*, for which the answer
is yes and the stray 了 never comes up.

"The frame" is two claims, so two arms, everything else held constant — same
tags, same categories, same JSON, same naturalness note:

- **`nativeFrame`** — the writer is the app's conversation partner, *"the learner
  reads it and copies it, so it has to be Chinese a native speaker would actually
  write"*; fluency explicitly separated from correctness; no level anywhere; `ok`
  becomes *true only if a native speaker would write this exactly as it stands*.
- **`noLevel`** — still a student, only the level anchor removed. If this alone
  recovers the recall, the student framing was never the problem.

### On the partner corpus

| arm | recall (strict) | specificity | fires on | justified | calls |
|---|---|---|---|---|---|
| shipped | 24% (5/21) | 97% | 11 | 45% | 1 |
| `noLevel` | 30% (6/20) | 98% | 9 | 67% | 1 |
| **`nativeFrame`** | **38% (8/21)** | **96%** | 16 | **50%** | **1** |
| four specialists | 38% (8/21) | 88% | 30 | 27% | 5 |

**The answer is yes, partly, and no, not mostly.** McNemar over the whole corpus,
`shipped` against `nativeFrame`: 9 items uniquely right against 2, **p = 0.065**.
Suggestive; not established. Three explanations in this document have been
believed at this confidence and then falsified, so it is recorded as a lead.

`noLevel` is 4 against 1, **p = 0.375** — nothing. **The level anchor is not the
problem; the student identity is the part doing the work.**

### Why it matters anyway: it is free

The goal is *one* judge for the learner's sentences and the partner's. A reframe
that fixed the partner and broke the learner would be no use. Re-run over all 240
repaired MuCGEC items:

| | recall | specificity |
|---|---|---|
| shipped | 90% (107/119) | 66% (79/120) |
| `nativeFrame` | 90% (106/118) | 68% (81/120) |

**Identical.** Dropping the level and naming the real writer costs nothing on the
half of the problem the level was there to serve — which is itself worth knowing,
since the level in the grader prompt has never been measured to earn its place.

So `nativeFrame` is strictly the better prompt today: level with the four-lens
design on recall, eight points better on specificity, **twice its precision, and
one model call against five.**

### The two repairs are complementary, which is the lead worth following

`nativeFrame` and the four-lens design both catch 8 of 21. Head to head, each is
uniquely right on **8 items** the other misses — p = 1.000, as unrelated as two
arms can be. They are not competing designs; they are finding different things.
Combining them is the obvious next probe and has not been run.

### What neither of them touches

Four of the five stray 了/过 from round ten survive every arm:

> 你见过真的熊猫**了**吗？ · 熊猫**吃过**竹子**了** · 你今天晚上吃什么**了**？ ·
> 我在家**听懂了**一首中文歌

`nativeFrame` catches one of them, `noLevel` a different one, the four-lens
design none. **Aspect is not a framing problem and not an attention-budget
problem.** It is the largest identified block of the remaining gap and it wants
its own lens, which is the one thing round ten's list proposed that has not yet
been tried.

## Round twelve: it was the model

Eleven rounds varied what the grader was asked. One thing was held constant
throughout: `qwen/qwen3-235b-a22b-2507`, because that is the app's `TEACH_MODEL`
and it is cheap.

This repo has hit that wall before. Story time went through six prompt strategies
in a row, all failing, before the variable that mattered turned out to be the
model. Round three already showed the same shape here — Sonnet reads as a
different instrument on learner error, 98% recall against qwen's 90% — and it had
never been pointed at the partner corpus.

`node tools/partner-corpus.js --grade --arm nativeFrame --model anthropic/claude-sonnet-4.5`.
192 of 204 turns returned; 12 failed on the API and are dropped, not retried.
About $0.92 at round three's measured $0.0048 a sentence.

| arm / model | recall, strict | recall, loose | specificity | fires on | justified (loose) |
|---|---|---|---|---|---|
| shipped, qwen | 24% | 13% | 97% | 5% | 64% |
| `nativeFrame`, qwen | 38% | 25% | 96% | 8% | 81% |
| four specialists, qwen | 38% | 38% | 88% | 15% | 67% |
| **`nativeFrame`, Sonnet** | **75% (15/20)** | **76% (39/51)** | 66% | **39%** | 53% |

**Recall doubles, and the block that would not move moves.** Four of the five
stray 了/过 that survived every prompt arm are caught:

| | qwen | Sonnet |
|---|---|---|
| 你最喜欢看什么节目**了**？ | caught | caught |
| 你见过真的熊猫**了**吗？ | passed | **caught** |
| 熊猫**吃过**竹子**了** | passed | **caught** |
| 我在家**听懂了**一首中文歌 | passed | **caught** |
| 你今天晚上吃什么**了**？ | passed | passed |

And 19 of the 31 awkward-but-grammatical turns qwen waved through. On the *worth
imitating* bar — the standard actually asked for — Sonnet is 76% recall against
qwen's 25%.

### The bill comes as over-firing

Specificity falls from 96% to 66%. Sonnet faults **35 turns labelled clean**, and
they were read rather than counted. A handful are defensible and the label set
has no box for them: two are the app's own `[[NEED:]]` markup, two are the
partner breaking character to explain it is an AI, one is an internal
contradiction (我家里只有一个孩子。我妹妹喜欢香蕉。) that was noticed during
labelling and deliberately left unflagged as coherence rather than grammar.

**The other twenty-nine or so are simply correct sentences.**

> 我吃米饭和蔬菜。你爱吃米饭吗？
> 小明在公园散步。他看见一只小狗在草地上跑。
> 我最喜欢跑步，因为简单又方便。你跑步吗？

That is the failure mode `grade()`'s own prompt has always warned about — *"do
not manufacture a problem to have something to teach"* — arriving at last in a
model strong enough to take the instruction above it seriously. `nativeFrame`
says *ok is true only if a native speaker would write this exactly as it stands*,
and Sonnet, unlike qwen, actually obeys a bar that strict.

**So the over-firing is most likely a bar problem, not a judgement problem**, and
a bar is a line of prompt. That is a far more tractable position than round ten's:
the instrument can see the errors, and what is left is telling it how much to
forgive.

### What it costs

$0.0048 a turn. Gating only the partner's half of a 30-turn session is about
**$0.14 a session** — real but not prohibitive, and it buys the thing the gate
exists for. Qwen at $0.0001 a turn cannot do the job at any price, which makes
this the first arm where cost is a decision rather than an excuse.

### What to try next, in order

1. **Soften the bar.** Same model, same frame, an `ok` line that forgives what a
   native speaker *could* write rather than demanding what they *would*. The
   cheapest experiment in this document and it addresses 29 of the 35 false
   alarms directly.
2. **Then the aspect lens, on Sonnet.** One of five still escapes.
3. **Strip `[[NEED:]]` before grading.** Now twice measured as a false alarm
   source, on two different models.
4. **Retry the 12 dropped turns** before quoting 75% to two significant figures.

## Round thirteen: the Chinese labs, and a lesson about list prices

Round twelve established that the model is the variable. It did not establish
that the model has to be Sonnet. A model trained predominantly on Chinese is a
different bet from a stronger general one, and the obvious candidates are cheap.

The catalogue was pulled live rather than recalled, which mattered: every model
below postdates this assistant's training data, and the version numbers guessed
from memory would all have been wrong.

| arm / model | recall, strict | recall, loose | specificity | fires on | justified | $/turn | $/session |
|---|---|---|---|---|---|---|---|
| shipped, qwen3-235b | 24% | 13% | 97% | 5% | 64% | $0.00011 | $0.003 |
| `nativeFrame`, qwen3-235b | 38% | 25% | 98% | 8% | 81% | $0.00011 | $0.003 |
| four specialists, qwen3-235b | 38% | 38% | 93% | 15% | 67% | $0.00035 | $0.011 |
| **`nativeFrame`, `glm-5.3-flash`** | **65% (13/20)** | **46%** | **94%** | **16%** | **73%** | **$0.00030** | **$0.009** |
| `nativeFrame`, `claude-sonnet-4.5` | 70% (14/20) | 73% | 74% | 38% | 49% | $0.00410 | $0.123 |

**`glm-5.3-flash` gets 93% of Sonnet's recall for 7% of its money**, and it is the
better instrument on the two axes a retry loop actually feels: it fires on less
than half as many turns, and three quarters of those firings are justified
against Sonnet's half. Sonnet keeps a real lead on the *worth imitating* bar —
73% against 46% — so if that is the standard the gate adopts, the money buys
something. At the strict bar it does not.

$0.009 for the partner's half of a 30-turn session is **three times what the
present, useless grader costs**, which makes this the cheapest decision in the
document rather than the expensive one it looked like at the end of round twelve.

### List price is not price

`z-ai/glm-5.3` and `qwen/qwen3.8-max-0902` list at $1.40 and $2.00 per M input —
a third and a half of Sonnet's. Estimated from that, both looked like bargains.

Both are **reasoning** models. Measured on one turn of this corpus:

| model | reasoning tokens | completion tokens | $/turn | vs Sonnet |
|---|---|---|---|---|
| qwen3-235b-a22b-2507 | 0 | 54 | $0.00011 | 0.03× |
| `glm-5.3-flash` | ~2,200 chars | 611 | $0.00030 | 0.07× |
| `claude-sonnet-4.5` | 0 | 72 | $0.00410 | 1× |
| `glm-5.3` | ~7,000 chars | 2,292 | $0.01034 | **2.5×** |
| `qwen3.8-max-0902` | ~11,400 chars | 3,895 | $0.02515 | **6×** |

**The two flagships cost two and a half and six times what Sonnet does.** The
per-token price said the opposite. For a one-line JSON verdict, what you pay is
set almost entirely by how long the model thinks before answering, and that is
not in the price list. Neither has been scored yet; at $2.11 and $5.13 for a full
run they are the only measurements in this document that need a budget decision
rather than a rounding error.

### A harness defect the raw body exposed

The first `glm-5.3-flash` run returned 131 of 204 turns; `glm-5.3` failed 43 of
its first 54. Both read as API flakiness, and a retry loop had already been added
for exactly that. It was not flakiness.

`callModel` asked for `max_tokens: 600`. A reasoning model spends its completion
budget thinking *before* emitting content, so OpenRouter returned the thinking in
`reasoning` and `content` empty — which `callModel` raises as "empty reply" and
the retry loop then dutifully repeated four times at full input cost.

The cap is now 4,000 everywhere. **It is not a cost control**: you pay for tokens
generated, and a non-reasoning model still stops at about sixty. Only truncation
changes. Every result before round thirteen was produced on non-reasoning models
and is unaffected.

Third time in this document that a number was wrong until someone printed the
raw thing and looked at it: 没有错误 in round eight, `[[NEED:]]` in round ten,
an empty `content` field here.

## Round fourteen: a softer bar helps the model that was over-firing and hurts the one that was not

Round twelve's diagnosis: Sonnet's specificity collapse is a bar problem, because
`nativeFrame` says *ok is true only if a native speaker would write this exactly
as it stands* and a strong model obeys a clause that strict. *Exactly as it
stands* condemns every sentence the grader would merely have phrased differently.

`softBar` is `nativeFrame` with that one clause replaced and **nothing else**
changed — same frame, same tags, same categories, same JSON. The replacement
moves the question from *is this what I would write* to *would a learner copying
this be copying a mistake*, and says outright that plainer is not a fault.

| model | bar | recall, strict | recall, loose | specificity | fires on | justified |
|---|---|---|---|---|---|---|
| `glm-5.3-flash` | `nativeFrame` | **65%** | **46%** | 94% | 16% | 73% |
| `glm-5.3-flash` | `softBar` | 52% | 32% | 98% | 10% | 85% |
| `claude-sonnet-4.5` | `nativeFrame` | 70% | **73%** | 74% | 38% | 49% |
| `claude-sonnet-4.5` | `softBar` | **68%** | 62% | **86%** | 26% | 61% |

**On Sonnet the trade is good and on `glm-5.3-flash` it is bad**, from one
identical edit.

- Sonnet keeps its recall — 70% → 68%, two points — and gains **twelve points of
  specificity**. It fires on 51 turns instead of 75, and a quarter more of those
  firings are justified. That is the round-twelve hypothesis confirmed: it was
  over-firing because it was told to, and telling it otherwise stops it.
- `glm-5.3-flash` loses **thirteen points of recall** for four of specificity. It
  was never over-firing: at 94% specificity it produced nine false alarms on the
  whole corpus against Sonnet's thirty-eight. The fix was applied to the model
  that did not have the disease, and all it did was give it permission to miss
  things.

### The general shape

**A prompt clause is not good or bad on its own; it is calibration, and
calibration is relative to what the model does without it.** The same sentence
that rescues an over-strict judge makes a nearly-calibrated one lax. Nothing in
the wording distinguishes the two cases, which is why this had to be run twice.

This is the fourth prompt "repair" in this document to be measured rather than
assumed, and the third to come out different from expected. DEVELOPING.md's
worked example — a fix that made its failure eight times likelier — is the same
lesson; so is `LEVEL_STYLE`'s grammar ban, where the redundant half turned out to
be doing other work.

### It also tells you what the bar means

On the loose bar Sonnet drops 73% → 62%, and that is not a defect. `softBar`
explicitly forgives sentences that are *plainer, shorter or less graceful*, which
is most of what the `unnatural` label covers. It does what it says.

So the two bars now have to be chosen between rather than reported side by side:

- **If the standard is "no outright errors",** `softBar` on Sonnet is the best
  arm measured — 68% recall at 86% specificity — and `nativeFrame` on
  `glm-5.3-flash` is a fourteenth of the price for 65% at 94%.
- **If the standard is "worth imitating",** which is what this work was asked
  for, `nativeFrame` on Sonnet is the only arm above 50% (73%), it costs
  $0.12 a session, and it retries two turns in five.

Nothing softens that choice, and it is not a technical one.

## Round fifteen: structure, bought with the budget nobody was spending

The standing conclusion after round twelve was that the model is the variable.
That conclusion was drawn while every arm in the document spent **one** model
call per turn, or five at the most. One Sonnet call costs what thirty-seven qwen
calls cost. The budget had never been spent.

`tools/partner-lens.js` and `judgeLens()` in `grader-bench.js`.

| | recall, strict | recall, loose | specificity | fires on | $/turn | $/session |
|---|---|---|---|---|---|---|
| shipped, qwen | 24% | 13% | 97% | 5% | $0.00011 | $0.003 |
| `nativeFrame`, qwen | 38% | 25% | 98% | 8% | $0.00011 | $0.003 |
| four specialists, qwen | 38% | 38% | 93% | 15% | $0.00035 | $0.011 |
| `nativeFrame`, Sonnet | 70% | **73%** | 74% | 38% | $0.00410 | $0.123 |
| **the cascade, qwen** | **76% (16/21)** | 53% | **87%** | 24% | $0.00141 | $0.042 |

**On the strict bar the cheap model now wins on all three axes at once** — six
points more recall than Sonnet, thirteen more specificity, at 34% of the price.
On the *worth imitating* bar Sonnet keeps a clear lead, 73% against 53%, and
nothing here closes it.

### What the cascade is

Per sentence, not per turn — partner turns run to 2.7 sentences and the errors
are single characters:

1. **A regex**, for Latin script. 3 of the 21 strict positives, free.
2. **Seven lenses**, drawn twice each at temperature 0.8. The lenses come from
   reading the eighteen labelled errors, not from the app's grade-sheet
   categories: aspect, complement, order, collocation, function word, negation,
   homophone. Four of the eighteen are aspect particles; `grammar` and `order`,
   two of the shipped four, had already been measured to catch nothing alone.
3. **A rewrite proposer**, which is the thing that mattered — below.
4. **Two free filters.** A finding must quote characters that are literally in
   the sentence, and must offer a repair that differs from what it quoted.
5. **One confirm call per surviving finding**, at temperature 0, each blind to
   the others.

### The rewrite proposer, which is the actual finding

Asked to JUDGE 你比昨天忙吗？ — a comparison missing its first term — all seven
lenses, a blunt "is anything wrong here", and the shipped grader all answer no.

Asked to REWRITE it as a native speaker would, the same model at the same
temperature returns 你今天比昨天忙吗？ Correct, and supplied without ever
conceding the original was wrong.

**The error is visible to the model; the judgement is not.** Rewriting is
generation, which is what it is good at; *is this wrong?* invites the agreeable
answer, and a small model gives it. Diffing the rewrite against the original
turns one generation call into a grounded fault proposal that required no
judgement at all.

The same asymmetry appeared independently at the other end of the cascade.
Measured on fourteen findings the cascade really produced, hand-labelled by
whether the original was wrong:

| confirm phrasing | catches real | false confirms |
|---|---|---|
| judge the span in the abstract | 2/7 | 0/7 |
| would a teacher mark it | 3/7 | 0/7 |
| count the mistakes in it | 2/7 | 0/7 |
| **show both sentences, ask which** | **5/7** | 2/7 |

Every abstract phrasing agrees that 我不每天散步 is fine. Put 我不是每天散步
beside it and the model picks the correction. **Twice, at opposite ends of the
pipeline, the way to get a judgement out of a weak model was to stop asking for
one and give it two concrete things to compare.**

### Four things that went wrong on the way, all of them instructive

- **Temperature is not one setting.** At 0.8 the lenses propose freely and
  wrongly; at 0 they go silent — 米饭很饱 and 你比昨天忙吗 drew nothing from any
  of the seven. The halves want opposite settings: propose at 0.8, confirm at 0.
  The first cascade ran both at 0.7 and was worse at each.
- **The first adjudicator was the broad question again.** It saw every finding on
  a sentence at once and decided which were real — the exact shape this document
  exists to argue against. It vetoed all three true findings on P187 and
  confirmed five false ones on P118. Splitting it one-per-finding is most of the
  difference between 62% and 76%.
- **A filter that was right in general was wrong in Chinese.** Requiring the
  repair to differ from the quoted span catches a lens answering yes to its own
  question. It also throws away every *deletion* — and the commonest fault in
  Chinese model text is a redundant character. The aspect lens found the 了 in
  熊猫吃过竹子了 exactly right and was discarded for writing an empty fix.
- **Judging the repair is not judging the diagnosis.** `collocation` diagnosed
  米饭很饱 correctly — "rice cannot be full" — and was overruled because its
  suggested repair, 很饱人, was bad. The confirm step must ask about the original,
  with the repair as context and nothing more.

### What it does not do

53% on the *worth imitating* bar against Sonnet's 73%. The cascade is built out
of questions about faults, and most of what the `unnatural` label covers is not a
fault — it is a sentence that is correct and stilted. There is no lens for that,
and the rewrite proposer's findings in that territory are exactly the ones the
confirm step is designed to reject. If the gate's standard is *worth imitating*,
this does not yet replace Sonnet; if it is *no outright errors*, it beats it
outright and costs a third as much.

## Round sixteen: a second bar for stiltedness, and a panel of cheap models

Round fifteen left one gap: 53% on *worth imitating* against Sonnet's 73%. Every
proposer in the cascade hunts faults, and 唱歌节目, 快乐的歌, 动物电视 and
真兔子 are not faults. They are well-formed, and none of them is what a person
says. Two things were tried against that, and they turn out to be the same
finding twice.

### The stiltedness channel needs no new proposer

The rewrite already surfaces these — 快乐的歌 comes back as 好听的歌 on the first
draw — and the strict confirm then correctly throws them out, because they are
not mistakes. So the same finding is asked a *second* question instead.

Measured on sixteen sentences, eight labelled unnatural and eight clean:

| phrasing | catches stilted | false flags |
|---|---|---|
| "would a native ever say A?" | **0/8** | 0/8 |
| "which would come out of their mouth?" | 5/8 | 2/8 |
| **"does A sound foreign or textbook?"** | 4/8 | **0/8** |

The first is the abstract question, and it flags nothing at all — **the third
time in this cascade that asking this model to judge one thing on its own
returned nothing**, after the seven lenses on 你比昨天忙吗 and the four confirm
phrasings. The pattern is now the most reliable thing in the document.

Wired in as a second confirm channel on rewrite findings only:

| | recall, strict | recall, loose | specificity | fires on | $/turn |
|---|---|---|---|---|---|
| cascade, strict bar | 76% | 53% | 87% | 24% | $0.00141 |
| **cascade, loose bar** | **81%** | **70%** | 69% | 41% | $0.00160 |
| Sonnet, `nativeFrame` | 70% | 73% | 74% | 38% | $0.00410 |

**Seventeen points of loose recall for eighteen of specificity**, which lands the
cheap cascade almost exactly on Sonnet's operating point — 70%/69% against
73%/74% — at 39% of the price. That is not an improvement on Sonnet so much as a
reproduction of it for a third of the money.

### The panel

Verga et al. find a panel of small judges from different providers beats one
large judge. Both members were already measured on every turn, so every
combination below is exact arithmetic over stored verdicts and cost nothing.

| panel | strict | loose | spec | fires | $/turn | $/session |
|---|---|---|---|---|---|---|
| Sonnet alone | 70% | 73% | 74% | 38% | $0.00410 | $0.123 |
| cascade ∪ `glm-soft` | 86% | 62% | **85%** | 27% | $0.00171 | $0.051 |
| cascade ∪ `glm-nf` | 85% | 65% | 81% | 31% | $0.00171 | $0.051 |
| loose cascade ∪ `glm-nf` | **90%** | 77% | 66% | 45% | $0.00190 | $0.057 |
| **loose cascade ∪ `glm-nf` ∪ four-lens** | **90%** | **81%** | 64% | 47% | $0.00225 | $0.067 |
| loose cascade + `glm-nf` + four-lens, 2 of 3 | 65% | 50% | **92%** | 19% | $0.00225 | $0.067 |

**The three-way union beats Sonnet on both recall bars at once — 90% against 70%,
81% against 73% — for 55% of its cost.** It pays ten points of specificity for
it. The two-member union at the top of the table goes the other way: eighty-six
percent of outright errors caught *and* eleven points better specificity than
Sonnet, at 42% of the price.

There is no single winner here, and that is the useful part. The panel gives a
*frontier* rather than a model:

- **catch the most** — three-way union, 90%/81%, fires on 47% of turns
- **balanced** — cascade ∪ `glm-soft`, 86%/62%, fires on 27%
- **interrupt least** — 2 of 3, 65%/50% at 92% specificity, fires on 19%

All three cost less than Sonnet, and the choice between them is the retry
budget, which is a product decision.

## Round seventeen: the corpus cannot answer the question it was built for

Two runs of the same cascade, same corpus, same prompts, nothing changed between
them but the dice: **76% and 62%.** That is not a regression. It is the
measurement, seen twice.

The partner corpus is 204 turns sampled at the partner's natural error rate,
which was the right decision for round ten and leaves **21 strict positives**.
One catch is five points of recall.

| grader | strict recall | 95% CI |
|---|---|---|
| shipped `nativeFrame`, qwen | 8/21 — 38% | [21%, 59%] |
| the cascade, qwen | 13/21 — 62% | [41%, 79%] |
| `nativeFrame`, `glm-5.3-flash` | 13/20 — 65% | [43%, 82%] |
| `nativeFrame`, Sonnet | 14/20 — 70% | [48%, 85%] |

**Every interval overlaps every other interval.** Paired on the positives, where
the comparison actually lives:

| | caught only by A | only by B | p |
|---|---|---|---|
| cascade vs Sonnet | 3 | 5 | 0.727 |
| cascade vs `glm-5.3-flash` | 2 | 2 | 1.000 |
| `glm-5.3-flash` vs Sonnet | 4 | 5 | 1.000 |
| cascade vs shipped `nativeFrame` | 7 | 2 | 0.180 |

Nothing is established. Not "the cascade beats Sonnet", not "GLM matches
Sonnet", not round twelve's "Sonnet doubles partner recall" — the last of those
is the one that redirected the whole study, and it rests on 14 catches against 8.

### What survived, and it is the more useful half

Specificity runs on 183 negatives, and there the intervals barely touch:

| grader | specificity | 95% CI |
|---|---|---|
| shipped `nativeFrame`, qwen | 175/183 — 96% | [92%, 98%] |
| `nativeFrame`, `glm-5.3-flash` | 163/183 — 89% | [84%, 93%] |
| the cascade, qwen | 148/183 — 81% | [75%, 86%] |
| `nativeFrame`, Sonnet | 117/178 — 66% | [58%, 72%] |

**Sonnet over-fires more than every cheap option, decisively.** At the partner's
8.8% error rate that is the expensive direction: it fires on 38% of turns and
the retry loop pays for all of them. That finding has the sample size the recall
race never had, and it points the same way as round fourteen's — the strong
model needs restraining, the weak ones need provoking.

The methodological point is older than this document: **a balanced benchmark was
abandoned in round ten for good reasons, and nobody asked what the unbalanced one
could still resolve.** Sampling at the natural rate made the base rate visible
and the positive class useless. Both were true from the first run.

### A defect that made it worse, and one that made it visible

`judgeLens` caught every internal API failure and continued with one fewer
opinion. For a detector that is exactly wrong: a turn whose every call failed
returned "clean", indistinguishable from a turn that was clean, and the run
printed no error marks. Raising the worker count from 14 to 20 was enough — the
cascade scored **24%**, of which 5 of 21 catches were the regex. The model half
was dead and the harness said nothing.

Making failures loud immediately surfaced the real constraint: at ~45 calls a
turn, twelve workers is 540 requests in flight, and 164 of 204 turns failed on
rate limits. At five workers, zero failures.

That is the third silent-failure defect in this study — `没有错误` parsed as a
sentence, `content` empty while `reasoning` filled, and now a swallowed
exception. All three produced numbers that looked entirely reasonable.

### What would fix it

More positives, and the generator costs $0.014 per 204 turns.

At the natural 8.8% rate, ~100 strict positives needs ~1,100 turns — pennies to
generate and a great deal of hand-labelling. The cheaper route is **stratified**:
generate ~1,000 turns, run the cheap graders over all of them, then label every
flagged turn plus a random sample of the unflagged, and weight the strata. That
buys most of the positives for a fraction of the reading, and the specificity
estimate stays unbiased because the unflagged sample is random.

Until then, **no grader in this document has been shown to catch partner errors
better than any other.** The cost and specificity columns are real. The recall
column is a coin landing somewhere between 40% and 85%.

## Round eighteen: the real thing, from the app's own database

Everything measured so far is the partner replying to a *simulated* learner.
`tools/pull-partner.js` takes the partner's real turns out of the `messages`
table — `role = assistant` only, the learner's own sentences never read — and
they are a different distribution in every way that matters.

**308 assistant rows over 23 days. 23 of them (7%) are the literal strings
我不会说 or 我不知道** — the app's failure path, not partner generation, and
excluded before labelling. That 7% is a finding for the app rather than the
grader: one partner turn in fourteen is a stub.

The remaining 285 were labelled as a complete census, no sampling.

| | real | synthetic |
|---|---|---|
| outright wrong | **15.1%** (43/285) | 8.8% (18/204) |
| grammatical but not worth imitating | 19.3% | 15.7% |
| clean | 65.6% | 74.0% |
| mean length | **62 characters** | 32 |
| mean sentences per turn | **5.0** | 2.7 |
| carries `[[NEED:]]` markup | **0%** | 3% |
| Latin script left in | **0%** | 2.5% |

**The partner is wrong nearly twice as often in real use as the synthetic corpus
said, and a third of its turns are not worth copying.** Todd's premise was
understated, not overstated.

### Three corrections this forces on earlier rounds

1. **The regex earns nothing.** Round fifteen credited it with 3 of 21 strict
   positives — 14% recall, free. Real traffic has **no Latin script at all**. A
   measurable part of the cascade's score came from a failure mode that does not
   occur.
2. **The `[[NEED:]]` false alarm barely matters.** Flagged twice as a defect
   worth fixing; it appears in 0% of real turns.
3. **Turns are twice as long and carry 5 sentences.** The cascade charges per
   sentence, so its real cost is roughly double what round fifteen measured, and
   a whole-turn grader is diluted across nearly twice as much text.

### What the partner actually gets wrong

| | share of the 43 errors |
|---|---|
| **missing 得 after a verb** (他跑很快, 小明踢球踢很好, 他们做很认真) | **13 — 30%** |
| 很多时间 for 很长时间 | 2 |
| reflexive 被 | 2 |
| everything else | 26 |

**Thirty percent of all real partner errors are one defect**, and it is barely
present in the synthetic corpus. A single lens — *does this verb need 得 before
its adjective?* — addresses more real error than the four-lens design's entire
taxonomy.

And the reflexive 被, which this whole document opens with:

> `grader-bench.js`, header: *"it returned "Natural." three times out of three
> for 我的手表被我放在桌子上了 — a reflexive 被 that no native speaker writes"*
>
> The real logs: **我的手机被我不小心放错了地方。** and
> **我的书被我放在桌子上了。**

The sentence that started the investigation was not a curiosity found while
testing something else. The partner writes it to Todd, in production.

### What this corpus is worth

43 strict positives against the synthetic corpus's 21 — twice the power, on the
right distribution, and a census rather than a sample. **It should replace
`partner-corpus.json` as the benchmark.** Every arm in rounds 12–17 needs
re-scoring against it before any of them are compared again, and the synthetic
corpus's remaining use is as a cheap place to develop, not to decide.

The 1,002 additional synthetic turns generated for stratification remain
unlabelled and are now the lower priority: more of the wrong distribution is
worth less than 285 of the right one.

## Round nineteen: two models in one corpus

Round eighteen treated 285 real turns as one population. They are not.
`index.html:1064` — `STORY_MODEL = "anthropic/claude-sonnet-4.5"`. Story time
runs on Sonnet; chat, focused and the rest run on qwen. The corpus was pooling a
long-form activity on one model with short-form chat on another.

Split on the story cast (小明, 小红, 小白 — `STORY_NAMES`, a proxy, since the
pull did not take a conversation id):

| | turns | sentences | wrong/turn | **wrong per 100 sentences** | unnatural per 100 sentences |
|---|---|---|---|---|---|
| story — **Sonnet** | 67 | 830 | 31.3% | **2.5** | **0.6** |
| chat — **qwen** | 218 | 693 | 10.1% | **3.2** | 7.2 |
| synthetic — qwen | 204 | 543 | 8.8% | **3.3** | — |

Story turns are 161 characters to chat's 38. **A per-turn rate compares a
paragraph against a sentence**, and that is the whole of round eighteen's
headline: 31.3% against 10.1% is four times the text, not three times the error.

### Three things round eighteen got backwards

1. **The synthetic corpus was right.** 3.3 errors per 100 sentences against the
   real chat partner's 3.2; 8.8% per turn against 10.1%; 32 characters against
   38. It is an excellent model of the chat partner, and the claim that it was
   "the wrong distribution" was an artefact of the Sonnet admixture.
2. **The 得 defect is Sonnet's, not qwen's.** 12 of the 13 instances are story
   turns. For the chat partner it is 1 error in 22. A 得 lens would be aimed at
   the wrong model.
3. **Sonnet writes better, not worse.** Slightly fewer errors per sentence
   (2.5 against 3.2) and **twelve times fewer unnatural ones** (0.6 against
   7.2). The capable model chosen for story time after six prompt strategies
   failed is doing exactly what it was chosen for.

### What survives round eighteen

- **The reflexive 被 is in production, and it is qwen's.** Both instances —
  我的手机被我不小心放错了地方 and 我的书被我放在桌子上了 — are chat turns. The
  sentence this entire document opens with is the chat partner's, in Todd's own
  logs.
- **7% of assistant rows are the stub 我不会说 or 我不知道.** Unchanged, and still
  a generation failure no grader addresses.
- **Zero Latin script, zero `[[NEED:]]`.** So the regex still earns nothing real,
  and the `[[NEED:]]` false alarm still does not matter.
- **43 labelled positives**, which is still twice the synthetic corpus's 21 — but
  only 22 of them belong to the model the chat gate would judge.

### The methodological point, for the third time

Round ten sampled at the natural rate and made the positive class unusable.
Round seventeen found that out. Round eighteen then replaced one unexamined
population with another, and the new one was two populations wearing a coat.

**Ask what generated each row before pooling it.** The app's own settings page
has a dropdown labelled "Model for story time"; nothing about the data itself
made the split visible, and the number it produced looked entirely plausible.

## Round twenty: the activity column, and a benchmark that was already paid for

Round nineteen split the real corpus by guessing at the story cast. The column
exists: `conversations.activity`, alongside `level`, `side` and `kind`.
`tools/pull-chats.js` replaces `pull-partner.js` and takes the lot — both roles,
the grader's stored verdict, the explanation thread, the translation, and the
activity that decides which model wrote a row.

**545 messages across 98 conversations.** The guess was a good one:

| activity | model | turns | wrong / 100 sentences | unnatural / 100 sentences |
|---|---|---|---|---|
| chat | qwen | 94 | **3.6** | **8.2** |
| focused | qwen | 55 | 3.2 | 5.9 |
| twenty | qwen | 42 | 2.7 | 8.1 |
| drill | qwen | 31 | **0.0** | 4.8 |
| story | **Sonnet** | 60 | 2.5 | **0.5** |

Pooled by model: Sonnet 2.5 wrong and 0.5 unnatural per 100 sentences, qwen 3.1
and 6.9. Round nineteen's proxy gave 2.5/0.6 and 3.2/7.2 — close enough that the
correction stands unchanged, and now it rests on a column instead of a character
name.

Two new things fall out. **Chat is qwen's worst activity on both axes**, and it
is the main one — a gate wired for chat is aimed at the right place. And **drill
produces no errors at all**, which is what a heavily constrained output looks
like.

### 208 verdicts nobody had looked at

`messages.grade` stores what the grader said about the learner's own sentence:
`ok`, `meant`, `better`, `cats`, `errors` with tags. There are **208 of them**,
all on `role=user`, accumulated over 23 days of real use.

**That is a benchmark for the student half of the grader that costs nothing to
run.** Every verdict is a judgement on a real sentence by the real prompt at the
real level, already made and already stored. Labelling the 208 sentences by hand
and scoring the stored verdicts against them needs no API calls at all — and
unlike MuCGEC it is exactly the distribution the app faces, and unlike the
partner corpus the labels would be about a human's writing, which is what the
whole grader was built for.

First look, unlabelled:

- **44% of the learner's sentences were faulted** (91 of 208).
- The tag distribution is dominated by `unnatural` (71), then `wrong-word` (46),
  `word-order-adverbial` (17), `wrong-character` (15), `aspect-le` (12).
- The corrections read well. 我也错说 → 我也说错了, 起来 → 起床, 星期七 → 星期日,
  我说对不对吗 → 我说得对不对 are all right, and all four are the kind of thing
  the MuCGEC benchmark said the grader gets wrong one time in five.

Whether that impression survives labelling is the next measurement, and it is
free. **Do that before anything else** — it is the only benchmark in this
document that is simultaneously real, on-distribution, human-authored on the
side being judged, and already bought.

42 explanation threads came with it, unexamined.

## What to measure next

The positive class is now the binding constraint: it cannot distinguish a judge
that is over-harsh from one that is right about sentences the annotators left
awkward. Fixing it needs correct sentences that are *good*, not merely repaired —
the app's own `STARTERS` and `LEVEL_STYLE` samples are hand-written, validated and
at level, and native-written text at level would do.

Until then, recall is the number to tune the gate on and specificity is the number
to tune the grader on, and they should stop being treated as one problem.

Round eight sharpens that: at 66% specificity on repaired MuCGEC, roughly one
correct sentence in three is called faulty. A gate that retries on every fault
would spend most of its retries on Chinese that was already fine — so the
partner corpus has to be sampled at its **natural error rate**, not balanced.
The rate itself is the finding. A balanced corpus would measure the grader and
say nothing about what the gate would actually do.

Round ten then resets the order of work. Tuning the grader further against MuCGEC
is measuring a distribution the gate never sees. In order:

1. ~~Test the frame.~~ Done — round eleven. Worth 14 points, free on the learner
   side. `nativeFrame` is the best prompt measured.
2. ~~Is it the model?~~ Done — round twelve. Yes. Sonnet doubles partner recall
   to 75% and breaks the aspect block. **The open question is no longer whether
   the grader can see partner errors. It is what it costs and how harshly it
   fires.**
3. ~~Do the Chinese labs do better?~~ Done — round thirteen. `glm-5.3-flash` is
   the new baseline: 65% recall, 94% specificity, $0.0003 a turn.
4. **Soften the bar**, now on `glm-5.3-flash` as well as Sonnet. Sonnet's 35
   false alarms are mostly correct sentences failing an `ok` line that demands
   what a native speaker *would* write; one line of prompt, and it is the whole
   remaining gap on the specificity side.
5. **Score `glm-5.3` and `qwen3.8-max-0902`** if the budget is wanted — $2.11 and
   $5.13, and they must beat a model costing a thirty-fourth and an
   eighty-fourth as much to be worth anything.
4. **The aspect lens, and `nativeFrame` + four lenses** — both now questions
   about Sonnet, not qwen, and both smaller than they looked.
5. **Strip `[[NEED:]]` before grading.** Measured as a false-alarm source on two
   models now.
6. **Then wire a gate** — and the design decision it needs is no longer technical
   but economic: $0.0048 a partner turn against $0.0001, for a judge that works.

The corpus is 204 turns and the differences worth detecting are large, so it can
carry several more arms before sample size binds. Batch B of the calibration set
stays held out.

## Other corpora surveyed

- **[HSK Dynamic Composition Corpus](http://hsk.blcu.edu.cn/Login)** (BLCU) —
  the canonical HSK-specific one, 10,740 exam compositions from 1992–2005, ~4M
  characters, error-annotated. Free but behind a web login with a 500-item
  download cap. 500 would be plenty; it needs a human to fetch it.
  [Overview](http://yuyanziyuan.blcu.edu.cn/en/info/1043/1501.htm).
- **[TOCFL Learner Corpus](https://aclanthology.org/L18-1363.pdf)** — 33,835
  annotated errors across 2,837 essays from the Taiwanese proficiency exam,
  publicly released. Traditional characters, which suits the app's `trad` mode.
- **[YACLC](https://arxiv.org/pdf/2112.15043)** (BLCU) — 32K Lang-8 sentences
  with both grammatical and fluency annotation. The fluency layer is the
  interesting part: it is the "understandable but not native" middle verdict,
  which is exactly where the grader and the grammar check disagreed in
  `explain-verdict-ab-results.md`.
- **NaSGEC / FCGEC** — native-speaker errors, not learner. Wrong distribution
  for this app.
- **[Evaluating LLMs' GEC performance in learner Chinese](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0312881)**
  (PLOS ONE) — prior art on exactly this question; worth reading before
  rewriting the prompt.

## Reproducing

`--build` refetches the dev set and refilters; `grader-bench.json` carries its
own licence and citation. Nothing here runs in `test/run.sh` — it makes network
calls and costs money. Sampling is done in **pairs**, so a short run stays
balanced; sampling items independently would let a run come out 60/40 and move
the headline without the grader changing at all.
