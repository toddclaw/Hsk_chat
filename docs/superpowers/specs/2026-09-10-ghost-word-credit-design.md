# Ghost word credit: spaced repetition, judged per word

**Date:** 2026-09-10
**Status:** approved design, not yet planned or built.
**Scope:** how a ghost word stops being a ghost. Three changes to one accounting
path — a repetition threshold, a once-per-day spacing rule, and a per-word
verdict that replaces the whole-sentence one. One new setting. The Ghost Words
activity's prompt, the partner, the validator and every other activity are
untouched.

Two items raised alongside this are **not** in scope and are recorded at the end:
the Pleco launch confirmation (nothing to build) and the migrate button's
non-terminating loop (its own branch, its own investigation).

---

## The request

Two complaints, from the session of 2026-09-10 and from BACKLOG.md's "ghost
words: partial credit grader":

1. One use of a ghost word retires it. That is too easy. Each word should take
   N uses.
2. The grader passes a ghost word only when the whole sentence is clean. In the
   learner's words: "I use a word correctly, but I screw up something else and
   therefore the grader does not pass."

The two pull in opposite directions on purpose. More repetitions are required,
and each repetition is judged fairly on the word alone rather than on everything
around it. Neither change is worth shipping without the other: raising the bar
while keeping whole-sentence grading would make the list nearly immovable, and
relaxing the grading while keeping a threshold of one would make it trivial.

The BACKLOG item's second half — *"I really want to restate the sentence
correctly based on the grader feedback, I'd like some way to keep trying"* — is
a retry affordance, a different feature, and is left in the backlog.

## What already exists

`producedWords()` (`index.html:5383`) scans every stored message and returns a
`Set` of the words the learner has written. A message contributes its words only
when `t.grade.ok` — and `parseGrade()` (`index.html:3147`) recomputes `ok` as
zero errors across all seventeen tags plus every category clean. So one mistake
anywhere in a sentence withholds credit from every word in it. That is complaint
2, exactly.

`readiness().unused` (`index.html:5437`) is the ghost list: words introduced from
above the learner's level that are absent from that Set, sorted commonest-first.
`reuseFor("focused")` (`index.html:1760`) takes its first six as the activity's
targets, the banner shows them, and `turn()` makes the first one a required word.
Membership is binary — present in the Set or not — which is complaint 1.

Three pieces of existing machinery answer most of this without new invention.

**`HSKMistakes.credited()`** (`mistakes.js:90`) is already the partial-credit
rule for drills, and its comment states the principle in the general form:
"judged on the thing being drilled and not on the whole sentence."

**`HSKPrompt.drillCheck()`** (`prompt.js:922`) has a word arm that needs no tag
at all. It asks two questions about one word — was it attempted, and was the
attempt correct — with an explicit instruction to ignore every other part of the
sentence. RESEARCH.md measures that arm at 39/39 on `used` and 27/27 on `ok`.
Its own comment records why it is a separate call rather than a field on
`grade()`: fused into the seventeen-tag verdict, the partial-credit case came
back wrong 9 times in 15, and it cost the tag ledger accuracy as well.

**The per-calendar-day credit rule** in `mistakes.js:216`, with `dayKey()` at
`mistakes.js:28`. The drill already caps credit at one per category per day and
derives the day set by scanning. Ghost credit reuses both the rule and the
helper.

## Pedagogy

### Massing and spacing do different jobs, in that order

The first draft of this design had no spacing rule, on the reasoning that a
ghost word is a *new* word with no track record of mistakes, so the
backsliding argument that drives the drill's spacing cap does not apply to it.
That reasoning is sound as far as it goes, and incomplete. The literature splits
the two: massed repetition helps initial encoding, spaced repetition drives
retention. They are sequential, not competing.

So both apply, at different scales. Within a day, repeated production of a new
word is the encoding work and is not artificially limited — write it as often as
you like. Across days, only the first correct use of a word counts, because that
is the interval that predicts whether the word is still there next week.

**D1. One credit per ghost word per calendar day.** `GHOST_USES` correct uses on
`GHOST_USES` separate days retires a word. This is the drill's existing rule
(RESEARCH.md, *Drilling a mistake category*) applied to a second feature, using
the same `dayKey()` helper, for a reason the drill's own write-up states: session
length must not be able to move the number, or the metric becomes a thing to farm
rather than a thing to earn.

This is a flat one-day Leitner interval, not an expanding one. Expanding
intervals — a retired word returning at 7 days, then 30, for a retention check —
are the pedagogically better answer and were considered and declined here as a
materially larger build: the ghost list would become a scheduler, the banner
would need a due/not-due story, and an empty due-list would need a fallback so
the activity never shows nothing. That remains the obvious upgrade and is the
first thing to reach for if words retire faster than the learner actually
retains them.

### One correct use is not proof, and one slip is not refutation

**D2. `GHOST_USES` defaults to 3, settable 1–6.** Three is the bottom of the
window in which most semantic gain lands (RESEARCH.md, *How many encounters a
word needs*), and under D1 it now means at least three separate days. It is a
*productive* threshold; the literature behind `PROMOTE_AT = 6` is about
*receptive* encounters, so this number is not derived from those studies and must
not be presented as though it were. It is a setting rather than a constant
precisely because it is unmeasured — the drill length setting exists for the same
reason and establishes the pattern.

**D3. A wrong use demotes progress by one day-credit, floored at zero. It does
not reset to zero.** Until now failure was free: reaching for 说话 and getting it
wrong simply did not count, so progress was a ratchet that only clicked forward
and the learner could grind a word out eventually regardless of how many attempts
missed. That is the asymmetry against Anki, where a lapse demotes the card.

Full reset was rejected. With a threshold as low as three, one slip on day three
would send the word back to nothing, and RESEARCH.md already warns against this
shape of rule in the mistake count: a design that punishes the outcome the
feature exists to produce. Demote-by-one is the proportionate version and is what
many Leitner implementations actually do.

A demotion can only come from a real per-word verdict (`used: true, ok: false`).
The whole-sentence fallback in D5 cannot produce one — `grade.ok === false` says
something in the sentence was wrong, never that *this word* was wrong — so
messages written before this feature, and messages written outside the Ghost
Words activity, can never demote anything. Conservative by construction.

### The gauge keeps no threshold

**D4. The production coverage bars are unchanged.** RESEARCH.md's **Production**
section argues at length that there is no defensible target for production — the
receptive/productive gap is supposed to exist, it widens with proficiency, and
not every word ever becomes productive. That argument is about *ratios on a
gauge* and it stands. The ghost list is not a gauge; it is the list that section
itself recommends in its place. A threshold on the list is compatible with no
threshold on the bar, and that distinction is what RESEARCH.md must be updated to
say.

## Design

### D5. One credit rule, shared

`HSKMistakes.ghostVerdict(grade, word)` joins `credited()` in `mistakes.js` and
returns one of three values:

| value | when |
| --- | --- |
| `"ok"` | a per-word verdict says `used && ok`; or no verdict exists and `grade.ok` |
| `"wrong"` | a per-word verdict says `used && !ok` |
| `"none"` | a verdict says `!used`; or no verdict and `!grade.ok`; or the grade is unreadable |

Three values rather than a boolean because D3 needs failure distinguished from
silence. The fallback half of the `"ok"` row is what keeps every message written
before this feature — and every message written outside the Ghost Words activity
— counting exactly as it does today. Nothing is migrated and nothing is
re-graded.

It lives in `mistakes.js` rather than `index.html` because that is where the
partial-credit rule already lives, and because it is the part of this work worth
testing in node.

### D6. The verdict: `grade.ghost`

A sibling of the existing `grade.target`, keyed by word:

```js
grade.ghost = { "说话": { used: true, ok: true },
                "参加": { used: true, ok: false } }
```

Written in `gradeTurn()` (`index.html:3205`), immediately after the grade lands
and beside the existing drill-target block, in **its own `try`** — a failed check
must leave the grade standing, which is what that block already does and why.

**D7. Asked only in the Ghost Words activity, only about ghost targets actually
present in the message, capped at 3 words per message.** The prompt is
`HSKPrompt.drillCheck({ label, text, drillWord: w })` with no `drillTag` — the
measured word arm, reused character for character. Because no prompt string
changes, CLAUDE.md's A/B requirement is not triggered.

Which words are present is decided by `HSK.segment()` against the current
lexicon, the same segmentation `producedWords()` already uses, intersected with
`reuseFor("focused")`. The cap bounds the cost: the banner shows six targets, a
real sentence reaches for one or two, and three is the ceiling on a message that
reaches for more.

Cost is one ~120-token call per checked word, on messages in one activity — not
on the grader's hot path generally. This is a real spend and should be watched on
the cost line after it ships.

### D8. Counting: a walk, not a tally

Progress for one word is derived by walking that word's messages in timestamp
order. Nothing is stored, matching the discipline `mistakeCounts()` already
keeps: a running tally beside the messages would be a second source of truth to
drift.

The walk is `HSKMistakes.ghostProgress(turns, word)`, beside `ghostVerdict()`.
`index.html` decides *which* turns contain the word — segmentation needs the
live lexicon and belongs there — and hands over a flat array; `mistakes.js` does
the arithmetic and stays free of everything above it, the same split
`needsMigration()` already uses.

```
progress = 0
credited = {}                       // dayKey -> true
for each user message containing the word, oldest first:
    switch ghostVerdict(message.grade, word):
      "ok":    day = dayKey(message.created_at)
               if not credited[day]: credited[day] = true; progress++
      "wrong": progress = max(0, progress - 1)
      "none":  nothing
retired = progress >= GHOST_USES
```

A day already credited stays credited after a demotion, so failing and then
succeeding again on the same day does not re-earn that day. Conservative, and it
closes the only same-day loop the rule has.

`producedWords()` keeps its current signature and meaning — the words with at
least one `"ok"` — so every existing consumer sees the Set it always did: the
read and produce coverage bars, the goal panel, `usedWords()`,
`neverUsedWords()`, `readiness().used`, `newHave`. The only behavioural change
reaching them is D5's relaxed credit rule, which can only *add* words: a sentence
that credited before still credits.

**D9. Only `readiness().unused` consults the threshold**, filtering on
`progress < S.ghostUses`. That is the ghost list and the progress panel's
corresponding row, and nothing else.

### D10. Targets prefer words with no credit today

`reuseFor("focused")` keeps taking six, but sorts words that have not yet been
credited today ahead of words that have, then commonest-first as now. Without
this, a learner who practised well yesterday opens the activity to six words that
cannot move until tomorrow, and the activity quietly has nothing to offer. With
it, today's six are the ones today's practice can actually advance.

Words already credited today are still shown when there are not six others —
practising them is harmless, and an empty banner would be worse.

### D11. The setting

`GHOST_CHOICES = [1, 2, 3, 4, 5, 6]`, default 3, rendered as a Settings →
Learning dropdown beside "Correct sentences to finish a drill", stored under a
new `K.ghostUses`, and added to `PREFS_KEYS` in `sync.js:251` so it travels
between devices like every other preference. It is a preference, not a secret, so
the `PREFS_KEYS` prohibition that `test/sync.test.js` enforces does not apply to
it.

### D12. What the learner sees

- **The banner** (`index.html:2194`) shows each target with its progress —
  `说话 1/3` — and marks the ones already credited today, because under D1 more
  uses of those today change nothing and a counter that silently refuses to move
  is the exact failure `drillWhyNot()` was written to fix. This is the change
  that makes D1, D2 and D3 legible at all.
- **The progress panel's "never used" row** (`index.html:5503`) is no longer
  literally true and is relabelled to name the threshold.
- **RESEARCH.md** gains the D1–D3 reasoning: a *Ghost words* subsection covering
  the massing/spacing split, `GHOST_USES`, and the demote-by-one rule; and its
  **Production** section is rewritten per D4 to distinguish the gauge from the
  list. CLAUDE.md requires the document to move with the constants, and this is
  the part of the work most likely to be skipped.

## Error handling

The check is a model call and will fail. Every failure mode degrades to today's
behaviour rather than to a wrong answer:

- **The call throws or returns unparseable JSON.** No entry is written for that
  word, `ghostVerdict()` falls through to `grade.ok`, and the message is judged
  exactly as it is judged today. In particular a failed check can never demote.
  Logged to the console like the drill target check beside it.
- **The grader is off.** No grades exist, so no ghost credit exists, and the list
  behaves as it does today with the grader off.
- **A message graded before this feature.** No `ghost` key, fallback applies.
- **`used: false`.** The learner wrote a sentence that never reached for the
  word. `"none"` — no credit and no demotion, which is the point of asking `used`
  at all.
- **A message with no `created_at`.** `dayKey()` returns `""`, which is a single
  shared bucket. Such a message can therefore contribute at most one credit
  across the whole history rather than one per message. Deliberate: undercounting
  is the safe direction, and every message written by this app carries the field.

## Testing

- `test/mistakes.test.js` — `ghostVerdict()` directly: verdict beats `grade.ok`
  both ways; a correct word in a failing sentence is `"ok"`; a wrong word in a
  passing sentence is `"wrong"`; `used: false` is `"none"`; an absent verdict
  falls back both ways; an unreadable grade is `"none"`.
- `test/mistakes.test.js` — `ghostProgress()`: two credits on one day count
  once; a demotion floors at zero;
  a demotion followed by a same-day success does not re-earn the day; ordering is
  by timestamp and not by conversation.
- `test/browser.test.js` — a ghost word survives one correct use, shows a
  progress count in the banner, and leaves the list on the third credited day; a
  correct ghost word in an otherwise-wrong sentence still advances it.
- No new file, so `sw.js`'s `SHELL` is unchanged. `VERSION` and `CACHE` move
  together, as on every user-visible change.
- No A/B run: no prompt string is edited (D7).

## Out of scope

**The Pleco launch confirmation.** The dialog is iOS Safari's own confirmation
for opening a custom URL scheme, raised for the `plecoapi://` link at
`index.html:4200`. A web page cannot suppress it; there is no app-side
`confirm()` to remove. Nothing to build. README's flashcards section gains one
line so this is not rediscovered.

**The migrate button reprocesses the same messages forever.** Its own branch and
its own investigation, because the cause needs confirming rather than assuming.
The standing hypothesis: `nameDrillWords()` (`index.html:3182`) sets `e.word`
only when the model names a word found in the text, but "no single word" is a
documented and correct answer for that prompt — so those errors keep matching
`needsMigration()` (`mistakes.js:132`) on every subsequent scan, and each run
re-spends on the same residue.

**Expanding review intervals.** Declined in D1, with the reasoning recorded
there. Worth its own backlog entry.

**Retrying a sentence after grader feedback.** Stays in BACKLOG.md.
