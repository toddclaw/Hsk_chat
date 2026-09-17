# Correctness gate — where this stands, and what to do next

Written 2026-09-16, updated 2026-09-17 with rounds twenty-two and -three, for a reader
starting cold.
`tools/grader-bench-results.md` is the full study, twenty-three rounds. This is the
short version and the next three moves.

## The goal

Todd wants one trusted grader for his sentences and the partner's, across every
activity. The trigger: the partner writes Chinese with errors, and the app then
tells him those same constructions are wrong — which undercuts the premise that
the Chinese on screen is worth imitating.

## Decided with him. Do not re-litigate.

- **Never display model-corrected Chinese.** `better` skips the vocabulary
  validator and leaks out-of-level words. A correction is repair *guidance* fed
  into a retry loop, never text on screen.
- **Retry rather than fall back**, past ten attempts if needed.
- **Gate every chat session**, not only Ghost Words.

## What is measured

| benchmark | what it is | result |
|---|---|---|
| **production verdicts** | 208 stored `messages.grade` on Todd's real sentences, blind-labelled | **83% recall, 86% specificity, 85% overall** |
| **real partner turns** | 222 turns from the database, qwen activities only | **`nativeFrame` 86% strict recall, 87% specificity** |
| MuCGEC, repaired | advanced learner essays, human labels | 90% recall, 66% specificity |
| partner corpus, synthetic | 204 generated turns, Claude labels | superseded — wrong KIND of error, see round 22 |

**The student half is in decent shape.** 85% in production, and the
over-harshness MuCGEC suggested does not appear on real sentences.

**The partner half now has an answer too** (round twenty-two). Re-scored on 222
real qwen turns instead of the synthetic corpus, every arm scores two to four
times higher than rounds 12-16 reported, and the axis that separates them flips
from recall to over-firing:

| | strict recall | loose recall | spec | fires | $/turn |
|---|---|---|---|---|---|
| **`nativeFrame` (qwen)** | 86% 18/21 | 61% | **87%** | 29% | **$0.00011** |
| `softBar` glm-5.3-flash | 100% 20/20 | 60% | 86% | 28% | $0.00030 |
| `shipped` (qwen) | 86% 18/21 | 58% | 80% | 32% | $0.00011 |
| `decomposed` four-lens | 95% 20/21 | 85% | 67% | 50% | $0.00035 |
| lens cascade | 95% 20/21 | 88% | 50% | 62% | $0.00141 |

**Pair two arms rather than improve one** (round twenty-three). Two prompt
ideas both failed — giving the four lenses the native frame cost 10 points of
recall for nothing, and deleting the cascade's six judgement lenses made
over-firing worse, so the rewrite proposer is where that comes from. But the
arms already measured combine for free, and two combinations beat every single
one (`tools/partner-pairs.js`):

| | strict | loose | spec | fires | $/turn |
|---|---|---|---|---|---|
| `softBar`/glm alone | 100% | 60% | 86% | 28% | $0.00030 |
| **`nativeFrame` OR `softBar`/glm** | **100%** | **73%** | **80%** | 37% | $0.00041 |
| `decomposed` alone | 95% | 85% | 67% | 50% | $0.00035 |
| **`decomposed` OR `softBar`/glm** | **100%** | **90%** | 62% | 55% | $0.00065 |

Both catch every outright error in the corpus. The choice between them is how
many retries are tolerable, which is the bar question below.

A union needs two graders that disagree productively, and two prompts on one
model do not: `decomposed OR nativeFrame` is no better than `decomposed` alone.
The cheap qwen arm and the reasoning model are what make it work.

**Strict recall is not comparable between the two corpora.** The two label
passes drew the wrong/unnatural line in different places. A second blind pass
over 50 real turns (`real-qwen-relabel.json`) found 31 of 34 stored-clean turns
clean — nothing was missed — but moved 4 turns from `unnatural` up to `wrong`.
Quote the loose bar across corpora, or the real corpus on its own.

## The three things to do next, in order

### 1. ~~Fix the no-edit verdict~~ — already shipped

`parseGrade()` has treated a fault with an identical `better` as a pass since
`8daea99` (2026-09-09), and it is in `main`. The two bad rows the audit found
are historical: one predates the fix, and one came from a browser still running
a cached old client.

### 2. ~~Re-score the partner arms on real chat turns~~ — done, round twenty-two

`tools/real-qwen.js` builds the corpus (it joins the labelled turns to the
activity column on their text); `tools/partner-corpus-table.js` prints every arm
against synthetic, real and pooled. The answer is above.

### 3. Pick a bar and wire the gate

The only thing left, and the bar is Todd's — he copies the partner's Chinese as
his main learning channel, so a miss costs him a wrong sentence in his own
writing and a false alarm costs him a retry. Those are not symmetric for him:

| bar | arm | catches | retries |
|---|---|---|---|
| fewest retries | `softBar`/glm | every error, 60% of the stiltedness | 28% of turns |
| **balanced** | `nativeFrame` OR `softBar`/glm | every error, 73% | 37% of turns |
| most imitable | `decomposed` OR `softBar`/glm | every error, 90% | 55% of turns |

At the balanced setting roughly **one partner turn in three is regenerated and
one regeneration in three is spent on Chinese that was already fine** — a pause
he will feel, not a wrong answer he will see. That is the trade to put to him.

Whatever ships needs the retry loop built around it: the gate never displays a
correction (`better` leaks out-of-level vocabulary), it regenerates.

## Two findings worth reusing anywhere

1. **Ask a weak model to rewrite, not to judge.** Every lens and the shipped
   grader pass 你比昨天忙吗？ Asked to *rewrite* it natively, the same model at
   the same temperature returns 你今天比昨天忙吗？ — it can see the error it will
   not admit to. Diff the rewrite for a grounded fault proposal.
2. **Give it two sentences, not one.** Confirming a finding in the abstract
   caught 2 of 7; showing original and repair side by side caught 5 of 7. The
   abstract phrasing scored zero or near-zero on three separate probes.

## Five traps this study fell into. Do not repeat them.

- **Print the raw data and read it.** Three wrong numbers came from silent
  failures that all looked plausible: MuCGEC's 没有错误 marker parsed as a
  sentence, empty `content` while `reasoning` ate the token budget, and
  `judgeLens` swallowing API errors so a dead grader read as clean.
- **Ask what generated a row before pooling it.** Story runs on Sonnet, chat on
  qwen. Pooling them produced a headline that was exactly backwards.
- **Check the positive class can support the comparison** before running eleven
  arms against it.
- **Ask what LABELLED a row before pooling it, too.** Two passes carrying the
  same rubric put the wrong/unnatural line in different places, and the strict
  bar moved three-fold across corpora because of it. This is round nineteen's
  trap wearing different clothes.
- **A rate match is not a distribution match.** The synthetic corpus matched the
  real partner on errors per 100 sentences and not on what kind of error, and
  eleven arms were raced on the difference.
- **`max_tokens` is not a cost control.** You pay for tokens generated. Set it
  low and a reasoning model returns empty `content` with everything in
  `reasoning`, which reads exactly like API flakiness.

## Where things live

| | |
|---|---|
| `tools/grade-audit.js` | blind audit of production verdicts — **best benchmark, free to re-run** |
| `tools/pull-chats.js` | pull the history; `role`, `grade`, `explain_chat`, `conversations.activity` |
| `tools/partner-corpus.js` | generate and score partner turns |
| `tools/partner-lens.js` | the lens cascade's prompts, pure and testable |
| `tools/partner-corpus-table.js` | every arm and model, synthetic / real / pooled |
| `tools/partner-pairs.js` | every PAIR of arms, unioned and intersected — free, no API calls |
| `tools/real-qwen.js` | builds the real qwen corpus — joins labels to the activity column |
| `tools/label-calibrate.js` | what a Claude label is worth (93%, blind) |
| `~/Documents/chat-export.json` | real history — **outside the repo, no .gitignore here** |
| `~/Documents/real-qwen.json` | 222 qwen partner turns + `-labels` + `-relabel`, also outside |

Unlabelled and low priority: `tools/partner-corpus-2.json`, 1,002 synthetic
turns. More of a distribution that is already well represented.

## Not done

Nothing ships. No gate is wired — but the arm is chosen and the bar is the only
open question. 42 explanation threads in the export are
unexamined. The `[[NEED:]]` and Latin-script issues found in the synthetic corpus
do not occur in real traffic and need no fixing.
