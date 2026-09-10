Runs of `tools/drill-word-ab.js` at HSK 3, 3 repeats. Two counters: which word a
mistake is about (11 hand-written fixtures, 9 with a single culprit and 2 with
none), and whether `drillCheck()` given that word judges honestly (13 fixtures
over 行 / 听说 / 认识). See RESEARCH.md, "Drilling a word rather than a category".

**The headline is the model, not the prompt.** The same prompts and the same
fixtures were run against the partner model and against the teaching model,
which is the one the app actually calls for both of these questions
(`teachingModel()`, index.html 3094 and 3114). Nothing else changed.

### 1. qwen/qwen3-235b-a22b-2507 — the teaching model, what the app uses

```
counter 1 -- which word (99 scored):
arm       n     wrong right   right right
model     33    33/33  100%   33/33  100%
nonote    33    33/33  100%   33/33  100%
regex     33    27/33  82%    9/33  27%

arm       named a word    refused when it should
model     27/27  100%     6/6  100%
nonote    27/27  100%     6/6  100%
regex     21/27  78%      6/6  100%

disagreements on `wrong`:
  [regex  wrong-word] 我每天晚上看音乐。  got {"wrong":"听","right":""} want ["看"]
  [regex  wrong-word] 我每天做公共汽车上班。  got {"wrong":"坐","right":""} want ["做"]
  (x3 runs, identical -- the regex is deterministic)

counter 2 -- drillCheck given the word (78 scored):

  shipped:
  kind    n    used right    ok right
  good    12   12/12  100%   12/12  100%
  bad     18   18/18  100%   16/18  89%
  dodge   9    9/9  100%     9/9  100%
  both fields right: 37/39  95%

  reworded:
  kind    n    used right    ok right
  good    12   12/12  100%   12/12  100%
  bad     18   18/18  100%   15/18  83%
  dodge   9    9/9  100%     9/9  100%
  both fields right: 36/39  92%

disagreements:
  [shipped   bad   行] 我觉得这个东西很行。  got {"used":true,"ok":true} want {"used":true,"ok":false}
  [reworded  bad   行] 我觉得这个东西很行。  (x3)

cost $0.0044 for 177 calls
```

The single remaining failure is the weakest fixture in the set: 很行 is marginal
rather than plainly wrong, so that row may be the ground truth's fault and not
the model's. Everything else is exact.

### 2. qwen/qwen3-30b-a3b-instruct-2507 — the partner model, for contrast

```
counter 1 -- which word (99 scored):
arm       n     wrong right   right right
model     33    27/33  82%    29/33  88%
nonote    33    27/33  82%    27/33  82%
regex     33    27/33  82%    9/33  27%

arm       named a word    refused when it should
model     27/27  100%     0/6  0%
nonote    27/27  100%     0/6  0%
regex     21/27  78%      6/6  100%

counter 2 -- drillCheck given the word (78 scored):

  shipped:
  kind    n    used right    ok right
  good    12   12/12  100%   12/12  100%
  bad     18   18/18  100%   0/18  0%
  dodge   9    9/9  100%     9/9  100%
  both fields right: 21/39  54%

  reworded:
  bad     18   18/18  100%   1/18  6%
  both fields right: 22/39  56%

cost $0.0031 for 207 calls
```

Two failures, both total, both invisible in the aggregate:

- **It never refuses.** 0/6. Every refusal fixture is `unnatural`, where the
  correction restructures the sentence and no one word is at fault. Asked
  anyway, it answers confidently: 给我水 → 请给我一杯水 returns
  `{"wrong":"水","right":"一杯水"}`, which would send the learner to drill 水.
- **Every wrong use of the drilled word scores `ok:true`.** 0/18, including
  我认识他明天要来 and 我听说了这本书. `used` is perfect at 39/39 on both models;
  it is the correctness half that collapses.

**The aggregate `wrong` column is 82% for all three arms on this model, and that
number means nothing.** The model scores 27/27 on real words and 0/6 on
refusals; the regex scores 21/27 and 6/6. Identical totals, opposite
behaviours. The split by "named a word" against "refused when it should" is
what makes them distinguishable, and it is the only reason the refusal failure
was caught at all.

### 3. A hypothesis that was wrong, kept so nobody retries it

The word arm inherits `"Ignore every other part of it -- other grammar, wrong
words, whether the sentence is natural"` from the structural check. Asking about
a word while instructing the model to ignore wrong words reads like exactly the
contradiction RESEARCH.md blames for 用词 scoring 1/3 as a tag, and it was the
obvious cause of the 0/18.

It is not. Reworded to "the grammar, the OTHER words", on the partner model:
**0/18 against 1/18**. On the teaching model the rewording is slightly *worse*,
16/18 against 15/18. The clause is not load-bearing in either direction, so
`drillCheck()` keeps one wording for both arms. The `reworded` arm stays in the
harness as the record of a null result.

### 4. What the note contributes: nothing measurable

`nonote` strips the grader's English note from the extraction prompt. On the
teaching model both arms are 33/33 on both fields; on the partner model they
tie on `wrong` and the note is worth 2/33 on `right`. The call reads the
student/corrected sentence pair, not the prose, so extraction quality does not
depend on how well the grader happened to word its note.

That also rules the free baseline out. A regex pulling the first quoted CJK run
out of the note gets 21/27 and cannot answer `right` at all (9/33), because a
note that says `use '听'` quotes the *correction* rather than the error. It is
cheap and it is wrong in the direction that matters.
