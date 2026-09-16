# How good is the grader? 79%

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

Filtering to pairs where **both halves** validate at HSK 4 or below gives 140
pairs at a median of 19 characters — far closer to a chat message. Below that
the corpus runs out: 10 pairs at HSK 2, 26 at HSK 3. The built benchmark is 280
items, 18 at HSK 2, 26 at HSK 3, 236 at HSK 4. Each item is graded **at its own
level**, because the grader prompt names the level and judging a sentence at the
wrong one tests a different prompt.

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

## What to measure next

The positive class is now the binding constraint: it cannot distinguish a judge
that is over-harsh from one that is right about sentences the annotators left
awkward. Fixing it needs correct sentences that are *good*, not merely repaired —
the app's own `STARTERS` and `LEVEL_STYLE` samples are hand-written, validated and
at level, and native-written text at level would do.

Until then, recall is the number to tune the gate on and specificity is the number
to tune the grader on, and they should stop being treated as one problem.

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
