# Correctness gate — where this stands, and what to do next

Written 2026-09-16, current to 2026-09-18 and v114, for a reader starting cold.
`tools/grader-bench-results.md` is the full study, twenty-seven rounds;
`RESEARCH.md` has the pedagogy and `DEVELOPING.md` the pipeline. This is the
short version.

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

## What shipped, and what it is worth

All of this is on `chore/grader-benchmark`, v114.

| | what it does | measured |
|---|---|---|
| **the gate** (v105) | two graders judge every partner reply; a fault is repaired, never shown | 100% of outright errors, 71% of the merely-stilted, 86% specificity |
| **the planner** (v114) | decides what to say and checks it fits the level, before writing | rescues 57/69 turns against 46/69, p = 0.01; mean tries 4.1 → 3.3 |
| **the repair ladder** (v113) | a different strategy on each gate failure, never the same twice | no effect (p = 0.58); shipped for the one property that needs no statistics |
| **the diagnostic log** (v110) | console.log to `debug_log`, read with `tools/pull-debug.js` | found two live bugs within a day |

`DEVELOPING.md`, "What a partner turn goes through", is the pipeline and the
reason for its order.

## What is measured

| benchmark | what it is | result |
|---|---|---|
| **production verdicts** | 208 stored `messages.grade` on Todd's real sentences | **85% overall** (83% recall, 86% specificity) |
| **real partner turns** | 222 turns from the database, qwen activities only | union: **100% strict recall, 73% loose, 80% specificity** |
| **replayed turns** | 282 fresh turns from Todd's real learner input | union replicates: 100% / 71% / 86% |
| **repair A/B** | 95 real learner turns, full pipeline, three arms | planner **p = 0.01** conditioned, **0.09** overall |
| MuCGEC | advanced learner essays, human labels | 90% recall, 66% specificity — leans harsh, does not reproduce on real sentences |
| synthetic partner corpus | 204 generated turns | **superseded** — matched real traffic on error RATE, not KIND |

**The arm is `nativeFrame` OR `softBar`/glm-5.3-flash.** Free prompt on the
teaching model first, reasoning model only on what the first passed. Pairing two
graders beat improving either one, and a union needs graders that disagree
productively — two prompts on one model did not.

## The three things to do next, in order

### 1. Read the production log

Everything now writes to `debug_log` and **nothing has counted it yet**: how
often the gate fires, how often the planner re-plans, how often a turn still
ends in the stub, and whether the 15% brevity cost shows up in real
conversation. `node tools/pull-debug.js --hours 24`. Free, and it is the only
measurement here taken on the shipped system rather than a replay of it.

### 2. The turns with no affordable plan

**27% of turns get no plan at all** — three re-plans find nothing and the turn
falls through, usually to 我不会说. These are the hardest turns and they are
exactly what the repair strategies were built for. The two ideas were measured
as rivals and are complementary: planning picks affordable content, strategies
handle content that is not affordable at all. Wiring the metalinguistic
strategies into the *planner's* failure path is the obvious next move and has
never been tried.

### 3. Message tombstones

`deleted_at` is on `conversations` and not on `messages`, so "Try again" and
"Dismiss" remove a message locally that the next sync pulls straight back. Todd
hit this in real use. Needs a small SQL block and a merge rule.

## Four findings worth reusing anywhere

1. **Ask a weak model to rewrite, not to judge.** Every lens and the shipped
   grader pass 你比昨天忙吗？ Asked to *rewrite* it natively, the same model at
   the same temperature returns 你今天比昨天忙吗？ — it can see the error it will
   not admit to. Diff the rewrite for a grounded fault proposal.
2. **Give it two sentences, not one.** Confirming a finding in the abstract
   caught 2 of 7; showing original and repair side by side caught 5 of 7. The
   abstract phrasing scored zero or near-zero on three separate probes.
3. **Pair two arms rather than improve one.** Two prompt ideas both failed, but
   every pair of already-measured arms scores for free off stored verdicts and
   two pairs beat every single arm. A union needs graders that disagree
   productively — two prompts on one model do not.
4. **Move the constraint to the front.** When a constraint keeps being violated,
   ask whether the decision that violates it happens before anything checks. The
   partner was choosing what to say and only then discovering it could not say
   it; planning first beat six rounds of arguing about wording afterwards.

## Six traps this study fell into. Do not repeat them.

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
- **Check the treatment was applied before quoting the effect.** The repair
  ladder engaged on 6 of 40 turns and the planner on 69 of 95; on the rest both
  arms ran identical code and the comparison was measuring temperature against
  itself. Condition on the turns the treatment could touch.
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
| `tools/replay-partner.js` | fresh partner turns of the right kind, from real learner turns |
| `tools/repair-ab.js` | the whole pipeline offline: plan, validate, sense, gate, repair |
| `tools/pull-debug.js` | read `debug_log` off the phone — `--hours`, `--grep`, `--prune` |
| `tools/real-qwen.js` | builds the real qwen corpus — joins labels to the activity column |
| `tools/label-calibrate.js` | what a Claude label is worth (93%, blind) |
| `~/Documents/chat-export.json` | real history — **outside the repo, no .gitignore here** |
| `~/Documents/real-qwen.json` | 222 qwen partner turns + `-labels` + `-relabel`, also outside |

Unlabelled and low priority: `tools/partner-corpus-2.json`, 1,002 synthetic
turns. More of a distribution that is already well represented.

## Not done

Nothing has been measured **on the shipped system**. Every number here comes
from a replay or a stored verdict; the pipeline as it actually runs — planner,
gate, ladder, six tries — has never been counted end to end, and `debug_log` has
been recording it since v110. That is step 1 above and it is free.

42 explanation threads in the export are still unexamined. The `[[NEED:]]` and
Latin-script issues found in the synthetic corpus do not occur in real traffic
and need no fixing.
