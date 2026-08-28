# Story time: choosing a story, and being asked about it

**Date:** 2026-08-28
**Status:** in progress — decisions below are settled and section 1 is approved.
Sections 2–4 are named but **not yet designed**; do not implement from this file yet.
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

At about $0.10 a story, priority 3 is roughly 50 stories a month. That is the budget any
extra per-story model call has to fit inside.

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
| D7 | Approach: the story's **cast is declared up front** rather than discovered as it goes | Chosen against priority 1: a declared cast is stable across segments, which is the narrow-reading property, and no name costs repair attempts in segment 1. See "Approaches considered". |

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

## 2. The topic and its cast — *not yet designed*

Must settle:

- Where the declared-cast call goes (story model or the cheaper teaching model) and what it
  costs against the 50-stories-a-month budget.
- The shape of the declared cast on the topic message, and how it reaches `lexWith()`.
- The `[[NEED:]]` carry-forward: needs from earlier messages *in this conversation* staying
  legal for later segments. This is a live bug today, independent of topics — a recurring
  needed word costs repair attempts in every later segment, and `STORY_ATTEMPTS = 5`.
- What happens when the topic is one the level genuinely cannot carry.

## 3. The questions — *not yet designed*

Must settle:

- The per-level question ladder in `prompt.js` and how it relates to `LEVEL_STYLE`.
- The third story prompt phase. Today, answering the single question is met by story time's own
  rules — 只讲故事，不要问学生问题，也不要在故事里跟学生说话 with `converse: false` — so the
  partner is instructed not to talk to the learner at the moment they are answering it. This is
  a current defect, not a new requirement.
- Whether the partner reacts to the answer before asking the next.

## 4. Data, `prompt.js`, and the measurement — *not yet designed*

Must settle:

- The option pool per level, its sampling, and the tests that hold each option to its level.
- `db/schema.sql` and `sync.js` changes for `messages.kind`.
- **The A/B.** Items 1 and 3 both edit the story rules, and CLAUDE.md requires a counted run
  against a real model before a prompt edit ships. `tools/story-ab.js` is the existing harness.
  This is real money and needs the learner's key and explicit go-ahead to spend.

---

## Deliberately out of scope

- The item/drill activities (sub-project A2).
- Changing `STORY_SEGMENTS`, `DEFAULT_RATE`, `CREDIT_CAP` or any other researched constant.
  The backlog entry on segments running short of 90 characters is not settled here.
- Retrofitting the three legacy conversations recorded as `activity: "chat"` that are really
  stories.

## Open questions

- Does a declared cast actually reduce repair attempts in segment 1, or does the model reach
  for undeclared names anyway? Measurable with `tools/story-ab.js`; not yet measured.
- Does the question phase get used at all once it is offered? Unmeasurable without telemetry
  the app deliberately does not have.
