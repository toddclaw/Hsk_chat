# Story time: choosing a story, and being asked about it

**Date:** 2026-08-28
**Status:** design complete — all four sections approved 2026-08-28. Ready for review,
then for the writing-plans step. Not yet implemented.
**Scope:** the story-time activity only. Chat and focused chat are untouched.

---

## The request

Four items, in the learner's words:

1. Ask more than one question.
2. A set of story options to choose from, level-appropriate, with a "make something up".
3. Ask for a story about something specific — "a story about the Monkey King".
4. Story time should not start generating the moment it is selected.

Stated priorities, in order, and they decide several of the trade-offs below:

1. A high-quality learning environment that is engaging and level-appropriate.
2. Good UX — quick to get into, without frustration.
3. Cost not exorbitant: ~$5/month.
4. Implementation and maintenance stay reasonable.

The $5 is **the whole app**, not story time alone, and the expected shape of use is about
**20 stories a month, with rereading** — rereading costs nothing, since it makes no model call.

The $0.10-a-story figure in `index.html` and the Settings note is **wrong**. Measured from the
learner's own spend rows: 9 story segments at a mean of 3.00 attempts each came to $0.4663,
which is about $0.017 a model call, $0.05 a segment and **$0.25 for a five-segment story**. At
20 stories that is the entire $5 with nothing left over, before a single question is asked.

Every one of those numbers is **pre-v67**. The bug fixed there dropped `S.known` from the
validation lexicon on any turn carrying a need, an offer or a cast — and a story turn always
carries a cast — so every segment was validated as if the learner's 222 ticked words were out
of level, manufacturing violations and forcing repairs. Two thirds of that bill is repair
traffic. The design below therefore routes calls by cost and **defers the expensive
measurement until a post-v67 baseline exists**, rather than optimising against numbers a bug
produced.

## What the pedagogy says

Recorded in full in `RESEARCH.md`, "Choosing a story, and being asked about it", with the
bibliography entries under "Choice, questions and narrow reading". Summarised here only as
far as it decides the design:

| Finding | What it decides |
|---|---|
| Autonomy motivates, but extensive-reading effects were **larger** with *limited* choice plus accountability | A curated menu **and** a free-text box, not one or the other. The questions are a benefit, not a tax. |
| Mid-text elaborative questions beat no questions on narrative recall (45.85 vs 36.81, p < 0.01) | Questions belong **between** segments, not only after the last one. |
| TPRS circling ladder: Yes/No → Either/Or → wh- → Why/How, ordered by *output* demanded | Question type is gated per level, like `LEVEL_STYLE` already gates grammar. At HSK 1, 因为 is out of level, so "why" is unanswerable. |
| Narrow reading: one topic, one cast, specialise early | The chooser offers "more about X" beside fresh ideas. The fixed cast keeps its justification. |

The honest caveats are in RESEARCH.md's "Where this is thin": the adjunct-question study is
not on beginners, TPRS's evidence is mostly practitioner literature, and none of it has been
measured in this app.

## Decisions taken

| # | Decision | Rationale |
|---|---|---|
| D1 | The **partner** asks the questions, not the learner asking more | The learner could already ask anything in phase two; the gap was the partner asking once and stopping. |
| D2 | Learner-driven, **no fixed count** — "Ask me another" for as long as wanted | Same bargain `storyStep()` already argues for: driven by the learner, not looped. Adds no tuned constant. |
| D3 | Questions offered **between segments and after**, never imposed | The adjunct-question finding, without turning the activity into a drill you cannot skip (priority 2). |
| D4 | A topic's out-of-level name is **legalised for the story and glossed**, on the same bargain as the cast | 孙悟空 is named by the app's own prompt, exactly as 小明/小红/小白 are. The guarantee is unchanged: nothing arrives unannounced. |
| D5 | Options are **hand-written per level** in `prompt.js`, sampled so the chooser is not identical every visit | Free, offline, instant, and `test/prompt.test.js` can hold each option to its level. |
| D6 | The chooser offers **"more about X"** for topics already read, beside fresh ideas | Narrow reading. Past topics are readable from the conversation list, so it costs little. |
| D7 | Approach: the story's **cast is declared up front** rather than discovered as it goes | Chosen against priority 1: a declared cast is stable across segments, which is the narrow-reading property, and the name is glossed before reading rather than sprung mid-paragraph. **Qualified in section 2**: the carry-forward, not the call, is what makes a free-text topic possible at all. |
| D8 | Every new per-level table is written for **all seven levels** at once, and the question ladder is **checked against the wordlists by test** | The existing convention: `LEVEL_STYLE` and `STARTERS` are both complete 1–7, and their `\|\| [1]` fallbacks are safety nets rather than working paths. A ladder filled in only to HSK 2 would leave HSK 3–7 on yes/no questions with nothing reporting it. |
| D9 | The **asking** and **discussing** turns run on the **teaching model**, not the story model | A comprehension question about a story already written is a far easier job than writing graded narrative, and `qwen3-235b` is ~37x cheaper per call. Conditional on the cheap question experiment: if it cannot ask in-level, ladder-conformant questions, it moves back. |
| D10 | The expensive topic A/B is **trimmed and deferred** until a post-v67 attempt-rate baseline exists | Three arms of 8 stories at the real price is ~$6, more than a month's whole budget, and the pre-v67 attempt rate is known to be inflated by a fixed bug. |

## Approaches considered

**1. Topic as a message, names via `[[NEED:]]` carried forward.** Least machinery: one message
role, one prompt phase, one lexicon widening; no schema change, no extra call. Names arrive ad
hoc on first mention and could drift between segments.

**2. Declared cast up front (chosen).** Approach 1 plus one call when the topic is chosen,
returning the story's cast, stored on the topic message and legalised for every segment like
`STORY_NAMES`. Costs a call and a wait before segment 1; the chooser can say what you are
about to meet. Still needs approach 1's carry-forward, because the model will reach for words
it did not declare.

**3. Curated options only.** No free text, each option shipping a hand-written cast verified by
test. Nothing to measure, no risk — but item 3 does not get built. Rejected.

Approach 2 is a superset of 1, not an alternative to it: **both** the declared cast and the
`[[NEED:]]` carry-forward are in scope.

---

## 1. The activity's states — *approved*

Four states. The strip at the bottom of the screen is the whole UI for all of them.

| State | Reached when | Strip shows |
|---|---|---|
| **Choosing** | story conversation with no topic message yet | the chooser: sampled curated ideas, "more about *X*" for past topics, a free-text box, "make something up" |
| **Telling** | topic chosen, fewer than `STORY_SEGMENTS` segments told | **Read on (3 of 5)** · **Ask me about it** |
| **Told** | `STORY_SEGMENTS` segments told | **Ask me about it** |
| **Talking** | any time after the first question | nothing — the learner types; **Ask me another** stays available |

`startActivity()` (`index.html:2158`) stops calling `storyStep()`. Selecting Story time lands
in *choosing*. That is item 4.

### The derivation has to give way

`storyTold()` (`index.html:3068`) counts assistant turns **before the first learner turn**, and
the comment above it says why: sync only round-trips the columns `db/schema.sql` names, so a
stored position would come back from another device missing.

Interleaved questions (D3) break that outright — the learner now answers mid-story, so learner
turns appear between segments and the count stops at the first one. It is not rescuable by
cleverness: a question and a segment are both assistant turns, and nothing already stored tells
them apart (`introduced` is absent on plenty of legitimate segments too).

So: **one new synced column, `messages.kind`** (`"segment" | "question"`), added the way
CLAUDE.md prescribes — `add column if not exists` in `db/schema.sql`, probed once per session
so an un-migrated database degrades rather than fails. It is immutable per message, so two
devices can never disagree about it.

The **topic** does not need the column. It becomes a `role: "topic"` message, which
`sync.js:34` already passes through untouched (only `notice` is dropped) and `windowed()`
already excludes, so it reaches the model as a line in the system prompt rather than as a turn
in the conversation.

---

## 2. The topic and its cast — *approved*

### The cast call goes to the story model

Priced against OpenRouter's live table rather than from memory, for a call of roughly 250
input and 100 output tokens:

| | input | output | one cast call |
|---|---|---|---|
| `anthropic/claude-sonnet-4.5` (story) | $3.00/M | $15.00/M | **$0.0023** |
| `qwen/qwen3-235b-a22b-2507` (teaching) | $0.09/M | $0.35/M | **$0.00006** |

Cost does not decide it: even the expensive option is about 2% of a $0.10 story, a dime a year
at 50 stories a month. The argument for the **story model** is consistency — the cast it
declares is the cast it will reach for when writing. A cast declared by a different model is a
guess about what a third party would name its characters, and where the two disagree the story
is back to using names nobody announced.

### The cast is stored as the topic message's `needs`

No new storage. A declared cast is exactly the `needs` shape already on every message,
`{w, p, d}`, so the cast *is* the topic message's needs: no schema change, it syncs on the path
that already works, and `lexWith()` already takes needs as its extra argument.

### Which makes the cast and the carry-forward one mechanism

If a turn's lexicon includes the needs from every earlier message in **this conversation**, the
declared cast flows into every segment automatically — it is simply the earliest such message.
One function, `needsSoFar(upTo)`, feeds both `turn()` and `renderMessage()`.

Scoped to messages up to and including the one being rendered, **not** the whole conversation:
a name declared in segment 3 must not retroactively un-flag it in segment 1. That is the exact
bug class fixed in v67 — rendering disagreeing with what validation allowed — and it must not
be reintroduced one layer up.

### Two limits

- **The cast is capped**, at 3 for HSK 1–2, per level thereafter (see "Scaling" below). A topic
  must not be able to hand the learner eight new words before segment 1.
- **Cast names do not spend pacing credits**, for the same reason the existing `STORY_NAMES` do
  not: `validator.js` already holds that personal names are not vocabulary.

### A topic the level cannot carry

Gets no special handling. The cast is legalised and glossed, everything else goes through the
validator exactly as now, and a Monkey King story at HSK 1 comes out as 孙悟空 plus simple
sentences. If that reads thin it is a prompt problem to measure, not a refusal to engineer.

### What the call actually buys

Recorded because it was surfaced while designing this section and it qualifies D7. With the
carry-forward alone, the model's own `[[NEED:孙悟空|…]]` on first mention is already legal in
that reply and in every later segment. **The carry-forward is what makes the Monkey King
possible; the call is not.** What the call buys:

1. The name is glossed **before** reading starts rather than sprung mid-paragraph.
   Pre-teaching the unknown words in a text is ordinary practice, and this is priority 1.
2. Cover for the times the model does not wrap a name it should have.
3. The chooser can say what the learner is about to meet.

(1) justifies it. Shipping the carry-forward first and adding the call later is a defensible
cheaper path and needs no rework, since both write to the same place.

## Scaling with the learner's level

Asked while section 2 was being reviewed: does moving to HSK 3 and 4 need architectural
provision now, or is it later work? Three-way split.

**Free already.** Story complexity needs no story-specific work. The story rules compose on top
of `LEVEL_STYLE`, which already unlocks 把, 结果补语 and 因为…所以 at HSK 3, and 被, 越来越 and
multi-clause sentences at HSK 4. Moving up makes the stories more complex on its own.

**Nailed down now, because a partial table is silently wrong.** The question ladder gets rows
for all seven levels. Filling only HSK 1–2 and copying the `|| [1]` fallback would leave an
HSK 6 learner on yes/no questions with nothing reporting it.

**Nailed down now, and free.** The cast cap (section 2) becomes a per-level number rather than
the constant 3, so a higher level can carry a fuller cast.

**Later, and it is content rather than architecture.** The story-idea pools above HSK 2.
`storyIdeasFor(level)` from day one means adding them is adding rows, exactly as `STARTERS`
works. Ship all seven thin and grow the ones actually reached.

### The ladder is checked, not asserted

The permitted question types at a level are not a matter of taste: a type is permitted exactly
when the level carries the vocabulary to **answer** it. 谁/什么/哪儿 are HSK 1, so wh- questions
are answerable there; 因为 is HSK 2, so "why" is not answerable at HSK 1 however simply it is
asked.

So `test/prompt.test.js` asserts that every type a level permits has its answer vocabulary in
that level's own `data/hsk<N>.json`. The table stays explicit and readable, but it is checked
against the data rather than against the author's judgment — which is what keeps the rows
nobody has reached yet from being quietly wrong on arrival.

## 3. The questions — *approved*

### What the wordlists said, and how it changed the ladder

Three findings from running candidate questions through `validate()` at HSK 1:

```
小明什么时候去商店？   HSK 1 OK    (什么 + 时候, both listed)
小明去商店还是去学校？ HSK 1 OK    -- but only because 还 + 是 are separately legal
小明为什么很高兴？     HSK 1 FAIL  -- 为 is above HSK 1
```

**The TPRS ladder inverts in Chinese.** Its order is Yes/No, then Either/Or, then wh-. But
谁/什么/哪儿/几/多少/怎么样 are all HSK 1 while 还是 is HSK 2: Chinese wh- questions are in-situ,
with no inversion and no auxiliary, and the question words are among the commonest in the
language. wh- therefore comes *before* either/or here. The ordering has to be taken from this
language's data, not from the English-derived ladder.

**The validator cannot protect the learner here.** 还是 passes at HSK 1 because 还 and 是 are
separately legal — DEVELOPING.md's "two legal words in a row are indistinguishable from a
compound". So the ladder must be **stricter than the validator**, which is exactly what a table
buys over letting validation decide.

**为什么 is genuinely out at HSK 1**, so the finding with the strongest evidence behind it —
why-questions aiding narrative recall — is unavailable at the level where it would help most.
It arrives at HSK 2.

### The ladder

| Level | Types the partner may use | Words the asking form needs |
|---|---|---|
| 1 | yes/no; who, what, where, how many, when, 怎么样 | 吗, 谁, 什么, 哪儿, 几, 多少, 时候, 怎么样 |
| 2 | + either/or; **why** | 还是, 为什么, 因为 |
| 3 | + reason and contrast chains; retell one part | 虽然, 但是, 要是, 所以 |
| 4 | + compare; predict what comes next | 比, 越来越, 觉得 |
| 5–7 | + inference, opinion with justification, evaluate | thin for now, grown on arrival (D8) |

Each row names the words its asking form needs, and `test/prompt.test.js` asserts every one of
them is an **entry** in that level's `data/hsk<N>.json`, not merely segmentable. That is what
catches 还是 at HSK 1. Where a form is genuinely compositional (什么 + 时候) the pieces are
listed instead, so the compositional judgment is explicit and reviewable rather than hidden.

### Three story phases, not two

`build()` gains a third phase: **telling**, **asking**, **discussing**.

- *asking* extends today's `storyQuestion`. Now usable mid-story, and told to ask about
  你刚才读的那一段 — the segment just read, which is what circling does.
- *discussing* is new, and fixes a live defect: today the learner's answer is met by story
  time's own rules, 只讲故事，不要问学生问题 with `converse: false`, so the partner is
  instructed not to talk to them at the moment they are answering its question.

The *discussing* rules: say whether the answer was right, restate it correctly in words the
learner has, then **stop**. It does not ask another — that is the "Ask me another" control,
which keeps D2's learner control and matches the one-tap-per-step bargain the rest of the
activity makes.

Questions carry `kind: "question"`, so they never count toward `STORY_SEGMENTS`, and they still
skip `settlePace` as `storyStep()` already does: a question earns no slate.

## 4. Data, `prompt.js`, and the measurement — *approved*

### The topic is just a string

Which collapses three features into one mechanism. A curated option, a free-text entry and
"make something up" differ only in what the string is:

| Entry point | Topic string | Cast call? |
|---|---|---|
| Curated idea | that idea's text | yes |
| Free text | what was typed, English or Chinese, verbatim | yes |
| Make something up | empty — no topic line in the prompt | **no** |

So the default path costs nothing extra and behaves exactly as story time does today. The
prompt line is 学生想听一个关于「X」的故事, with X passed through unaltered.

### `STORY_IDEAS[level]`

A flat list of strings, all seven levels per D8, four sampled per chooser render.
`test/prompt.test.js` checks every level has a pool and that entries are non-empty and
distinct.

**What no test can check** is whether "a day at the market" is HSK 1-appropriate. That is
authorial judgment. The vocabulary guarantee comes from the validator downstream as always;
the pool only decides what gets *suggested*, and a badly judged suggestion produces a story
that is merely dull, not one that breaks the level.

"More about *X*" comes from scanning local story conversations for their topic messages. No new
storage, and it degrades to nothing on a fresh device.

### `messages.kind`

Four pieces: `add column if not exists` in `db/schema.sql`; the round-trip in `sync.js`'s
`messageToRow` / `rowToMessage`; the once-per-session probe so an un-migrated database degrades
rather than fails; a `test/sync.test.js` case. The migration is run by hand in the Supabase SQL
editor — until then the column is absent, pushes strip it, and the only symptom is another
device miscounting the segment badge.

### Which model answers which call

| Call | Model | Per call | Monthly, at 20 stories |
|---|---|---|---|
| Story segment | story (`claude-sonnet-4.5`) | ~$0.017 x attempts | dominates; see below |
| Declared cast | story | $0.0023 | $0.05 |
| Asking a question | teaching (`qwen3-235b`) | ~$0.0002 | ~$0.02 |
| Discussing an answer | teaching | ~$0.0002 | ~$0.02 |
| Chat, translation, explain | teaching | — | ~$0.01 |

Everything except the segments themselves is noise. **The whole budget question is the mean
attempt count on story segments**, which is why D10 defers the expensive measurement until it
has been re-observed on v67:

| Mean attempts | 20 stories x 5 segments | Fits $5? |
|---|---|---|
| 3.0 (pre-v67, measured) | ~$5.10 | no |
| 1.5 | ~$2.55 | yes, with room |

That number costs nothing to produce — it is read out of the learner's own `attempts` values
after a few stories on v67.

### The measurement

**The question experiment — run it, pennies.** Questions are single short turns, so 20 per
level across levels 1-4 costs about $0.15 on the story model and far less on the teaching one.
It counts two things: the question validates in-level, and it is of a type the ladder permits
at that level. This is what decides D9.

**The topic experiment — trimmed, deferred.** Two arms rather than three (topic against no
topic), six stories each, ~$3 at the pre-v67 price and less after. It counts out-of-level
tokens per segment and attempts per segment. It can change the design: the real risk is that a
free-text topic drags the model toward vocabulary the level cannot carry, and if it does, D4
is revisited. The backlog's standing warning applies — eight seeds is the weak point of every
prompt measurement in this repo, and six is fewer.

### Files touched

`index.html`, `prompt.js`, `db/schema.sql`, `sync.js`, `test/prompt.test.js`,
`test/sync.test.js`, `test/browser.test.js`, `tools/story-ab.js`, and `VERSION` with `CACHE`
together. No new file the page loads, so `sw.js`'s `SHELL` is unchanged.

## Deliberately out of scope

- The item/drill activities (sub-project A2).
- Changing `STORY_SEGMENTS`, `DEFAULT_RATE`, `CREDIT_CAP` or any other researched constant.
  The backlog entry on segments running short of 90 characters is not settled here.
- Retrofitting the three legacy conversations recorded as `activity: "chat"` that are really
  stories.
- **Correcting the "$0.10 a story" figure** in `index.html`'s `STORY_MODEL` comment and the
  Settings note. It is wrong (section 4), but the right replacement needs the post-v67 attempt
  rate, which does not exist yet. Tracked in `BACKLOG.md`.

## Open questions

- **What is the mean attempt count per story segment on v67?** Everything about the budget
  hangs on it (section 4), and it is free to obtain: read the `attempts` values off the
  learner's own messages after a few stories. Nothing here should be optimised until it exists.
- Does a free-text topic drag the model toward vocabulary the level cannot carry? The trimmed
  topic experiment answers it, and a bad answer revisits D4.
- Can the teaching model ask in-level, ladder-conformant questions? The cheap question
  experiment answers it, and a bad answer reverses D9.
- Does the question phase get used at all once offered? Unmeasurable without telemetry the app
  deliberately does not have.
