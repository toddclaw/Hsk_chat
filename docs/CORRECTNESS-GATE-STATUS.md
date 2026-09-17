# Correctness gate — where this stands, and what to do next

Written 2026-09-16 at the end of a long session, for a reader starting cold.
`tools/grader-bench-results.md` is the full study, twenty-one rounds. This is the
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
| **production verdicts** (best) | 208 stored `messages.grade` on Todd's real sentences, blind-labelled | **83% recall, 86% specificity, 85% overall** |
| MuCGEC, repaired | advanced learner essays, human labels | 90% recall, 66% specificity |
| partner corpus, synthetic | 204 generated turns, Claude labels | see below — recall not measurable |
| partner corpus, real | 285 real turns, Claude labels | 43 positives, mixes two models |

**The student half is in decent shape.** 85% in production, and the
over-harshness MuCGEC suggested does not appear on real sentences.

**The partner half is not.** No grader has been *shown* to catch partner errors
better than any other — the synthetic corpus has 21 strict positives, one catch
is five points, and every paired test between the lens cascade, `glm-5.3-flash`
and Sonnet comes out p > 0.7. Specificity is well powered and does separate:
shipped qwen 96%, `glm-5.3-flash` 89%, cascade 81%, Sonnet 66%.

## The three things to do next, in order

### 1. Fix the no-edit verdict (30 minutes, no measurement needed)

Two of 208 production verdicts fault a sentence and return the identical
sentence as `better`. `grader-bench.js`'s `verdictOk()` already treats an
unchanged `better` as a pass; the app does not. The learner sees a ✗ with
nothing behind it. Make `index.html`'s `parseGrade()` agree — a verdict with no
edit and no usable tagged error is a pass.

### 2. Re-score the partner arms on real chat turns

`~/Documents/chat-export.json` + `real-partner-labels.json`. Use **chat,
focused, twenty and drill only** — story runs on `claude-sonnet-4.5`
(`index.html:1064`) and pooling it with qwen is what made round eighteen wrong.
Pool those with the 204 synthetic turns, which round nineteen shows are the same
distribution (3.3 wrong per 100 sentences against the real chat partner's 3.2).
That gives ~40 positives on the model the gate would actually judge, against the
21 that made rounds 12–16 unmeasurable.

Arms worth re-running are in `tools/partner-corpus-table.js`. The frontier as it
stands, all cheaper than Sonnet:

| | strict | loose | spec | $/turn |
|---|---|---|---|---|
| cascade ∪ `glm-soft` | 86% | 62% | 85% | $0.0017 |
| loose cascade ∪ `glm-nf` ∪ four-lens | 90% | 81% | 64% | $0.0023 |
| 2-of-3 vote | 65% | 50% | 92% | $0.0023 |

### 3. Then pick a bar and wire the gate

The bar is Todd's decision and everything waits on it:

- **"no outright errors"** → the qwen cascade or the two-member panel
- **"worth imitating"** → needs the stiltedness channel, which costs ~18 points
  of specificity for ~17 of recall

## Two findings worth reusing anywhere

1. **Ask a weak model to rewrite, not to judge.** Every lens and the shipped
   grader pass 你比昨天忙吗？ Asked to *rewrite* it natively, the same model at
   the same temperature returns 你今天比昨天忙吗？ — it can see the error it will
   not admit to. Diff the rewrite for a grounded fault proposal.
2. **Give it two sentences, not one.** Confirming a finding in the abstract
   caught 2 of 7; showing original and repair side by side caught 5 of 7. The
   abstract phrasing scored zero or near-zero on three separate probes.

## Four traps this study fell into. Do not repeat them.

- **Print the raw data and read it.** Three wrong numbers came from silent
  failures that all looked plausible: MuCGEC's 没有错误 marker parsed as a
  sentence, empty `content` while `reasoning` ate the token budget, and
  `judgeLens` swallowing API errors so a dead grader read as clean.
- **Ask what generated a row before pooling it.** Story runs on Sonnet, chat on
  qwen. Pooling them produced a headline that was exactly backwards.
- **Check the positive class can support the comparison** before running eleven
  arms against it.
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
| `tools/partner-corpus-table.js` | every arm and model from stored verdicts |
| `tools/label-calibrate.js` | what a Claude label is worth (93%, blind) |
| `~/Documents/chat-export.json` | real history — **outside the repo, no .gitignore here** |

Unlabelled and low priority: `tools/partner-corpus-2.json`, 1,002 synthetic
turns. More of a distribution that is already well represented.

## Not done

Nothing ships. No gate is wired. 42 explanation threads in the export are
unexamined. The `[[NEED:]]` and Latin-script issues found in the synthetic corpus
do not occur in real traffic and need no fixing.
