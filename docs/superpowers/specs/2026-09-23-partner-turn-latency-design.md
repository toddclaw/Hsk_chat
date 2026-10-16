# Making the partner turn fast without making it wrong

Design, 2026-09-23. Agreed with Todd the same day.

## The problem, measured

Reconstructed from `debug_log` over 30 days — 110 real partner turns, 93 with
usable wall-clock spans. The script that did it ships as `tools/turn-latency.js`
(Stage 0) so every claim below can be re-checked.

| | |
|---|---|
| median turn | **32.2s** |
| p75 / p90 / max | 58.2s / 101.5s / 566.4s |
| gate share of wall time | **61%**, median 27s per turn |
| attempts per turn | mean **2.81**; more than one on 71% of turns |

**The cost is multiplicative, and that is the whole story.** `gateFault()` runs
inside `turn()`'s retry loop, so a three-attempt turn pays three gates. Attacking
either factor alone leaves the other one intact.

What the 203 retries were for:

| cause | count | what it costs |
|---|---|---|
| vocabulary / sense repair | 97 (48%) | a generation; the gate is never reached |
| gate fault | 61 (30%) | a generation plus the gate round that found it |
| required-word retry | 44 (22%) | a generation plus a *wasted* gate round |
| echo | 1 | — |

Two further facts from the same window, both from `BACKLOG.md`, "The gate's
second arm is down a third of the time":

- The slow arm (`softBar` on `z-ai/glm-5.3-flash`) spends ~2.1k tokens thinking
  and answers in a **median of 19s** against a 25s timeout. It fails 34% of
  calls. This is the 61%.
- `checkSenseViolations()` in `index.html` is a **serial `for` loop of model
  calls**, one per ambiguous word, and it is the only phase with no timing in
  the log at all.

## Targets

Agreed with Todd:

- **Median under 10s, p90 under 20s.**
- **3–4x current spend** is acceptable to get there.
- **The stub stays.** Correctness never degrades to "show it anyway"; a turn
  that cannot be repaired is still 我不会说.

## Approach

Three were considered.

**A. Fix the gate only.** A fast second arm, run in parallel, lower timeout.
Drops the gate from ~12s to ~2s per attempt but leaves 2.81 attempts standing:
roughly **14s median**. Misses the target.

**B. Fix the gate, then stop paying for attempts serially. — chosen.** A plus
speculative candidates: generate 3 replies concurrently, validate locally, gate
the survivors in parallel, ship the first that passes. Per-attempt pass rate is
35% (110 accepted of 313 attempts), so three draws clear ~73% of turns in one
round and expected rounds fall 2.81 → ~1.4. Roughly **7s median** at ~3x
generation and ~2x gate calls. Generation is qwen and negligible; the gate is
$0.0004 a turn today.

**C. B plus reordering the soft checks.** Rejected on measurement — see below.

## Stages

Each stage ships on its own and is measured with `tools/turn-latency.js` before
the next one starts.

### Stage 0 — instrument the phases

Per-phase timings into `debug_log`: plan, generate, sense, gate, total, and the
attempt number each belongs to. Ship `tools/turn-latency.js` as the reader.

**This is first and it is not optional.** The gate is the only phase with
timings today and sense has none, so "the gate is 61%" is measured while "sense
is cheap" is an assumption. Three confident diagnoses in the session that
produced this document were overturned by measurement, twice after code had
already been written against them.

Acceptance: a run of `tools/turn-latency.js` reports a per-phase breakdown for
turns recorded after the change, and the phases sum to within 10% of the
measured total.

### Stage 1 — a fast second gate arm

Specified in full in `BACKLOG.md`, "The gate's second arm is down a third of the
time — needs a different model". The candidate must be a **cheap non-reasoning
model**: the entire failure is the reasoning budget, and an arm without one
cannot lose the race. It must be a *different model* from the fast arm, not
another prompt on qwen — a union needs two graders that disagree productively.

Acceptance, all three:

- union loose recall and specificity within a stated tolerance of the shipped
  pair (100% strict / 73% loose / 80% specificity) on the real-qwen corpus,
  scored with `tools/partner-corpus.js --grade` then `tools/partner-pairs.js`;
- median latency under 3s over at least 20 calls with the real prompt;
- zero empty completions in those 20 calls.

Explicitly **not** `reasoning: {effort: "low"}` on glm. It is fast (2.3s) and it
is a different grader, not a faster one: union specificity falls 80% → 62% and
it fires on every other turn with half its objections wrong. Recorded in
`RESEARCH.md` as a real operating point and rejected as a default.

### Stage 2 — run the two gate arms in parallel

`gateFault()` asks the fast arm and only reaches the slow one if the fast one
passed. Once both are fast, run them concurrently and union the verdicts: 4s
becomes 2s. Costs one extra call on the ~21% of turns where the first arm
faults, which is noise at these prices.

Keep the existing fail-open behaviour on both arms.

### Stage 3 — parallel sense checks

`Promise.all` over `checkSenseViolations()`'s loop. Failure still fails open per
word. Size the win with Stage 0's numbers first — if sense is 1% of wall, skip
it and say so.

### Stage 4 — speculative candidates

Generate K candidates concurrently from the same prompt (temperature is already
0.7–0.8, so they differ), run vocabulary locally on all of them, then gate the
survivors in parallel and ship the first that passes in draw order. If none
passes, fall back to the existing repair loop carrying the best fault evidence.

- K defaults to 3, behind a Settings switch like every other gate control.
- Expected rounds 2.81 → ~1.4 on the measured 35% per-attempt pass rate.
- The fallback path is unchanged, so the worst case is today's behaviour.

Acceptance: median under 10s and p90 under 20s on `tools/turn-latency.js`, with
the gate fault rate on shipped replies no higher than today's.

## Rejected: moving the required-word check above the gate

It was in the draft of this design and Todd questioned it. Measured over the
same 110 turns:

| | turns |
|---|---|
| require retry with no gate fault — **saves** a gate round | 20 |
| require retry **and** a gate fault — **costs** an extra generation | 21 |

Today's order gates before wedging, so a turn whose reply was going to fail the
gate never pays for a required-word retry. Reversing it spends a generation
wedging text the gate then rejects. After Stage 1 a gate round and a generation
both cost ~2s, so 20 saved against 21 spent is net zero.

It also puts pressure on the invariant that order exists to protect: the soft
checks keep their best answer and show it when the attempts run out, so with the
gate below them that kept answer reaches the screen ungated. Preserving the
invariant means gating the kept answer separately — more code in the fallback
path, for nothing.

There is no quality case either. The A/B in `RESEARCH.md`, "Telling the planner
which word the turn owes", found wedged turns grade clean 86% against un-wedged
83%: the require retry is not damaging the Chinese.

The latency case existed only while a gate round cost 12s. Stage 1 removes it.

## Invariants

None of these moves, at any stage:

- **Correctness never degrades to "show it anyway."** A turn that cannot be
  repaired becomes the stub.
- **Nothing reaches the screen ungated.** Whatever text is shown has passed the
  gate, including anything kept by a soft check.
- **The gate fails open.** A dead grader passes the turn rather than stopping
  the conversation — but Stage 0 makes it visible, which it is not today.
- **Corrected Chinese is never displayed.** `better` is repair guidance.
- **The benchmarked gate prompts ship character-for-character.**
  `test/prompt.test.js` asserts this and must keep passing.

## Risks

- **A faster arm that agrees with the first one buys nothing.** The union works
  because the arms disagree productively. `tools/partner-pairs.js` scores this
  for free once the verdicts exist; check it before shipping, not after.
- **Speculative candidates multiply a bad prompt.** If the partner is reaching
  for out-of-level words, three draws reach for them three times. Vocabulary is
  local and free so this costs no money, but it can raise the "no candidate
  passed" rate. Stage 0's numbers tell us whether it did.
- **Cost drift.** Add a spend assertion to the acceptance run rather than
  trusting the estimate: 3x generation is cheap in theory and the theory has
  been wrong here before.
- **The p90 and the max matter more than the median.** A 566s turn exists in the
  log. Report all three every time.
