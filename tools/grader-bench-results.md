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
