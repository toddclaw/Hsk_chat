# Flashcard Chat

**Asked for:** 2026-09-18. **Designed with the learner** the same day.

A two-step activity. Press a button and the app hands you five to seven words
drawn from your own history, exported to Pleco or Anki. You study them away from
the app. You come back and the partner steers the conversation at exactly those
words until the ghost counter retires them, with a marker strip showing how many
rounds are done.

## The problem

Reported, in the learner's words: *"I struggle to express myself because I forget
the words and grammar in Chinese. Once I'm reminded of the words I realize I can
actually express my thoughts."*

That is a retrieval failure, not a knowledge gap, and nothing in the app targets
it. The two activities that look closest both miss:

- **Ghost Words** practises words the app introduced from *above* your level —
  `readiness().unused` filters `S.learning` on `(e.from || 0) > S.level`
  (`index.html:6578`). The words going missing mid-sentence are the ones at or
  below your own level, which that filter excludes by construction. Worse, the
  learner has just lowered the pacing rate to one new word per 60 characters,
  which starves that pool further. Ghost Words is not being changed: it is doing
  a different job well.
- **The retrieval engine** (`retrieval.js`) builds gap-fill and dictation from
  sentences in your history. The word is already on screen; the task is
  recognition with the context supplied. Useful, and not the missing step.

The missing step is producing a word you already recognise, from your own intent,
under conversational time pressure.

## What the learner asked for, and what was rejected

The learner named the constraint first: everything must be chat, and a large
daily review queue is what makes Anki fail for them in practice.

Three cue mechanisms were offered. The learner chose **the partner steers me
there** — the conversation is built so the missing words are the natural answer —
over a word bank beside the composer, post-hoc feedback, or an on-demand lookup.

Three word pools were offered. The learner rejected all three and named a
fourth: *"I'd actually like an LLM to look at my recent progress and suggest some
words to study with flashcards and then come back and practice in chat."*

Three shapes for that were offered:

| | |
|---|---|
| A | arithmetic proposes candidates, a model composes the set |
| B | a model reads a progress summary and suggests words freely |
| C | no model: top five by staleness |

**A was chosen.** B is the literal reading of the request and is the one where
the model can suggest words you already own, words above your level, or words it
invented — every one of which needs a validation pass that A gets for free by
only ever letting the model choose *from* a validated list. CLAUDE.md's warning
about the grader's `used` array applies in full: a model asked to assess what you
are doing well has an obvious way to flatter you.

C is the fallback the A/B below has to beat, and if it is not beaten, C ships.

## Research basis

**Is immersion better than focused study?** The question has a false premise.
Nation's Four Strands gives roughly equal time to meaning-focused input,
meaning-focused output, language-focused learning (deliberate study) and fluency
development. Deliberate study has a ceiling of about a quarter of study time and
a floor that is not zero. Incidental acquisition is real and slow — this file's
sibling RESEARCH.md already records Nation & Wang (1999) at ~10 encounters with
no guarantee — and nobody has shown immersion alone reaching the 6,000–8,000 word
families Nation (2006) puts on comfortable independent reading, in a working
adult's time frame.

The old objection that deliberately-learned words are shallow has been tested and
largely lost: Elgort (2011) found masked priming effects for flashcard-trained
words, the signature of integration into the mental lexicon.

What deliberate study does **not** build is production under load, which is the
reported complaint. That is meaning-focused output, and it is what the second
step of this activity is for. The flashcards load; the chat fires.

**Semantic clustering is the trap, and a model walks into it by default.**
Tinkham (1997) and Waring (1997) both found semantically related sets — five
colours, five items of clothing — are learned *more slowly* than unrelated sets,
because similar words cross-associate and interfere. Tinkham also tested
**thematic** clusters, words linked by situation rather than category, and those
were learned *faster* than unrelated sets. A model asked for "five words to
study" produces the semantic arrangement unless told otherwise. This is the whole
reason the model call exists rather than approach C, and it is the thing the A/B
measures.

**Set size.** Nation's guidance for deliberate word-card study is 5–7 words per
set. The learner's own worry was that five is too easy; the arithmetic says
otherwise. The lists here are 300 / 497 / 988 / 1978 words cumulative for HSK
1–4, so HSK 2 to HSK 3 is 491 new words, and `HSKPace.toTarget()` exists to say
that only the commonest third of them buys the coverage that matters — 147 of 741
at the HSK 1 transition. Five words three times a week is 15/week, which covers
the useful part of a level transition in about ten weeks. Difficulty lives in the
second step regardless: five words at `S.ghostUses = 3` is fifteen correct
productions across at least three days.

**Learner-imposed need.** Hulstijn & Laufer's involvement load hypothesis
distinguishes learner-imposed from externally-imposed need and scores the former
higher. A set you pressed a button to receive is a different task from a queue
that accrued. RESEARCH.md line 417 already invokes Self-Determination Theory for
the same reason. The overwhelm the learner reports from Anki is a property of an
unbounded queue, not a failure of discipline, and the fixed small set is the
design response.

**Spacing lives outside the app.** Pleco and Anki already schedule well, and
BACKLOG.md has already parked an in-app SRS as not-wanted. What neither of them
can do is choose what goes in, because neither has seen the conversations. That
is the division of labour this feature implements.

## The pool

Derived by scanning history, never stored, for the reason `mistakes.js` gives at
the top of its file: a stored tally is a second source of truth to drift.

Two populations, in this order. The order is the learner's, and it is right —
the first population is the reported complaint and the second is insurance
against it running dry.

1. **Read, never written.** Words the partner has used to you, in any
   conversation, that you have never produced. These never "lapse" because you
   never had them; they are the recognise-but-cannot-say gap directly.
2. **Lapsed.** Words that appear in your history — written by you or read from
   the partner — but not within `STALE_DAYS`.

Both are then filtered to in-level words you do not already own — "own" meaning
`ghostN >= S.ghostUses`, the same threshold `readiness().unused` uses and the
only place in the app a production threshold is allowed to live — and ordered
commonest-first by the level list's `f` rank. A read-never-written word has
`ghostN` of 0 by definition, so the filter is a no-op on population 1 and
load-bearing on population 2. `S.learning` rows carry no
frequency of their own, so the rank is looked up through the level list, exactly
as `readiness().unused` already does.

The data all exists: `HSK.segment(text, S.lex)`, `S.chatMsgs` across every
conversation, `producedWords()` at `index.html:6369`, and `ghostProgressMap()` at
`index.html:6447`, which already yields per-word `{n, last}`. Last-*seen* is the
same scan widened to assistant rows.

## Reservation: overlapping sets must not repeat words

Raised by the learner, and it needs a rule rather than a hope. A second Flashcard
Chat started while a first is unfinished must not hand back words the first is
still working on.

**A word is out of the candidate pool if it belongs to an in-flight set.**
In-flight is derived, not stored: scan `S.chatMsgs` for `role: "flashcards"`
markers, compute `min(ghostN)` over each set's words, and any set below
`S.ghostUses` reserves its words.

Finished sets need no rule at all. Their words sit at `ghostN >= S.ghostUses`, so
the "do not already own" filter has already dropped them.

**Abandonment escape.** Reserve-until-finished would lock words away permanently
the first time a set is started and never returned to. So a set stops reserving
once its conversation has been quiet for `RESERVE_DAYS`. One date comparison, no
new state, no "abandon this set" button to build, and it self-heals.

## The activity

One `ACTIVITIES` row in `prompt.js`, two phases — the way story time is one
activity with phases rather than two activities.

```
flashcard: {
  label: "Flashcard Chat",
  newWords: false,          // as Ghost Words and Drills, and for the same reason
  converse: true,
  reuse: "chosen",
  ...
}
```

**Phase 1 — choose.** Opening the activity with no stored set shows a button, not
a chat. The learner asked for a button rather than an automatic fire. Pressing it
runs the pool arithmetic, hands the top ~15 candidates to the model, and shows
the returned 5–7 words with a one-line English theme and the existing Anki and
Pleco export buttons (`index.html:1018`). Those buttons today export the 词
panel, which is the wrong list and the right plumbing.

**Phase 2 — practise.** With a set stored, the activity is a chat. The set is the
`reuse` list; `ghostRequired()` picks the target the same way it does for Ghost
Words; words retire on the existing ghost counter. When the set completes, phase
1 returns.

**Storage.** The set is a pseudo-message in the transcript, `role: "flashcards"`,
following `drillTagOf()` / `drillExampleOf()` / `drillWordOf()` in `mistakes.js`.
No new column, no schema change, and it syncs with the conversation for free.

## Progress markers

Rounds are derived: **`min(ghostN)` across the set**. All words credited once
means round one is done. The ghost counter caps at one credit per word per day,
so a round cannot close in under a day.

```
Day 1 ✓   Day 2 ✓   Day 3 · 3/5
```

The current round shows partial progress, so a session that lands three of five
is not invisible. At `min(ghostN) >= S.ghostUses` the strip reads **Activity
Complete!** and the phase-1 button returns.

Bound to `S.ghostUses`, never hardcoded to 3. That setting is already
user-changeable, and a strip reading "Day 3" while Settings says 5 is precisely
the quiet disagreement this codebase has been bitten by before.

**A stated limitation.** If three words are credited Monday and two Tuesday,
"Day 1 ✓" appears on Tuesday. The marker measures the set, not the calendar. This
is deliberate — it is a completion tracker, not a diary — and is recorded here so
that a later reader does not mistake it for a bug.

## The model call

`HSKPrompt.flashcardSet()`, built like `drillWord()`: its own small call, JSON
out, **teaching model, not partner model**. RESEARCH.md's drill-word table is
unambiguous about this class of job — the partner model refused 0/6 when it
should have refused and scored 21/39 on the verdict, against 27/27 and 37/39 for
the teaching model.

In: ~15 candidates with pinyin and gloss, which list entries already carry as `p`
and `d`. Out: `{ "words": [...], "theme": "..." }`.

The load-bearing rule in the prompt is the anti-clustering one: pick words that
could occur together in **one situation**, never words from one **category**.
Tinkham's finding stated as a constraint rather than hoped for.

**Validation.** Returned words are intersected with the candidate list; anything
else is discarded. The model therefore cannot introduce an out-of-level word,
because the candidates came from a validated list to begin with.

**Fail open.** If fewer than five survive, backfill from the head of the
candidates. A dead, slow or malformed call degrades to approach C — the top five
by arithmetic — rather than blocking the activity. Same rule as the gate, the
planner and the missing-table path.

## Constants

| name | value | where | why |
|---|---|---|---|
| `SET_SIZE` | 5 | `pace.js` | Nation's 5–7 for deliberate word-card study; the low end because the learner reports overwhelm as the failure mode |
| `SET_MAX` | 7 | `pace.js` | top of Nation's range; the model may return up to this many |
| `STALE_DAYS` | 30 | `pace.js` | a month without an encounter is the working definition of lapsed. Not measured; see "What is not evidenced" |
| `RESERVE_DAYS` | 30 | `pace.js` | a set untouched this long stops reserving its words |
| `CANDIDATES_SHOWN` | 15 | `pace.js` | how many the model chooses from — enough for a thematic set to exist, small enough to keep the call cheap |

No Settings row for `SET_SIZE` yet. The learner raised the "five is too easy"
worry and the arithmetic above answers it; a Settings row is a three-line add if
the worry survives contact with the feature. Adding it speculatively is the thing
this repo's CLAUDE.md and the ponytail discipline both argue against.

## Where the code goes

- **`pace.js`** — the pool arithmetic, the staleness scan and the reservation
  filter. It is already the vocabulary-selection module (`buildPool`, `slate`,
  `isNew`), already node-testable, and using it means no new file and therefore
  no new `sw.js` `SHELL` entry to forget.
- **`prompt.js`** — the `ACTIVITIES` row and `flashcardSet()`.
- **`index.html`** — the phase-1 panel, the marker strip, the export wiring, and
  `reuseFor()` gaining the `"chosen"` branch beside its existing `"unused"` one.
- **`test/pace.test.js`**, **`test/prompt.test.js`** — as below.
- `VERSION` in `index.html` and `CACHE` in `sw.js` move together.

## Build order

The arithmetic version must be working and usable before anything depends on a
model:

1. Pool + reservation in `pace.js`, with tests.
2. The `ACTIVITIES` row and the `reuseFor()` branch.
3. Phase 1 panel with the top five by arithmetic, and the export wired to it.
   **This is a shippable feature on its own** — it is approach C.
4. Marker strip and completion.
5. The A/B below.
6. The model call, only if the A/B earns it.

## Measurement before the model call ships

CLAUDE.md requires a counted run against a real model for any prompt change, and
RESEARCH.md records four cases in this study where a prompt fix moved the number
the wrong way. `tools/flashcard-set.js`, two arms over real candidate pools drawn
from the learner's own history:

| arm | |
|---|---|
| A | with the thematic / anti-semantic instruction |
| B | "pick five useful words" |

Counted: how many returned words were actually in the candidate list, and whether
each set is thematically or semantically clustered. The second is a judgement, so
it is blind-labelled — RESEARCH.md already records two label passes carrying the
same rubric drawing the line in different places.

**If A and B come out the same, approach C ships and the call is deleted.** The
measurement has to be allowed to have that outcome.

## Testing

Plain node, `check(ok, label, detail)`, no framework, per CLAUDE.md.

`test/pace.test.js`:

- read-never-written comes before lapsed in the returned order
- a word produced correctly is absent from both populations
- a word last seen inside `STALE_DAYS` is not lapsed; outside it, is
- words in an in-flight set are absent from a second set's candidates
- a set whose conversation has been quiet past `RESERVE_DAYS` releases its words
- a finished set's words are absent without needing the reservation rule
- an empty history yields an empty pool rather than throwing
- ordering is commonest-first by the level list's `f`, with unranked words last

`test/prompt.test.js`:

- the `flashcard` row exists with `newWords: false` and `reuse: "chosen"`
- `flashcardSet()`'s prompt contains the anti-semantic-clustering instruction
  character-for-character as benchmarked, the same assertion the gate prompts
  already carry
- a response naming a word outside the candidate list drops that word
- a response with fewer than five valid words backfills from the candidates
- a malformed or empty response yields the arithmetic top five

## What is not evidenced

- **`STALE_DAYS = 30` is a guess.** No measurement here supports 30 over 14 or
  60. It is a starting value and should be revisited once there is real usage.
- **Whether the thematic instruction survives contact with the model.** That is
  what the A/B is for, and the honest prior from this repo is that it might not.
- **Whether the two-step shape is actually followed.** The design assumes the
  learner leaves, studies, and returns. If the flashcard step is skipped, phase 2
  degenerates into Ghost Words pointed at a different pool — which is still
  useful, but it is not the feature that was designed and the measurement would
  not notice.
- **Set overlap across levels.** If the learner moves up mid-set, the stored set
  may contain words the new level's list orders differently. The words remain
  in-level (the lists nest) so nothing breaks, but the pool ordering assumptions
  were not thought through for that case.
