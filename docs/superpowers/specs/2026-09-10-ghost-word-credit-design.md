# Ghost word credit: repeated use, judged per word

**Date:** 2026-09-10
**Status:** approved design, not yet planned or built.
**Scope:** how a ghost word stops being a ghost. Two changes to one accounting
path — a repetition threshold, and a per-word verdict that replaces the
whole-sentence one. One new setting. The Ghost Words activity's prompt, the
partner, the validator and every other activity are untouched.

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

Two pieces of existing machinery answer most of this without new invention.

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

That is the question complaint 2 needs, already written and already measured,
about a word rather than a structure.

## Pedagogy, and one place we knowingly depart from it

RESEARCH.md's **How many encounters a word needs** settles `PROMOTE_AT = 6` for
*receptive* encounters, from a literature that ranges 6 to 10+ and agrees on no
number. Most semantic gain lands between three and seven exposures.

RESEARCH.md's **Drilling a mistake category** goes further and argues that
massed practice is the condition that loses: a drill session is massed practice
by construction, so credit there is *spaced* — one per category per calendar day
— and ten passes in one sitting are worth what one is.

**D1. No spacing rule on ghost credit. N distinct messages, however close
together.** This was offered against the drill precedent and declined by the
controller. The cost is stated plainly rather than hidden: with no spacing rule,
N short messages in one minute retire a word, and N is the only thing standing
between the ghost list and being farmed. The spaced version remains the obvious
upgrade if the list turns out to clear faster than the learner actually improves.

**D2. `GHOST_USES` defaults to 3, settable 1–6.** Three is the bottom of the
semantic-gain window and the point at which one lucky sentence no longer clears
a word. It is a *productive* threshold, and the literature above is about
receptive encounters, so it is not derived from those studies and must not be
presented as though it were. It is a setting rather than a constant precisely
because it is unmeasured: the drill length setting exists for the same reason and
establishes the pattern.

**D3. The production coverage bars keep no threshold.** RESEARCH.md's
**Production** section argues at length that there is no defensible target for
production — the receptive/productive gap is supposed to exist, it widens with
proficiency, and not every word ever becomes productive. That argument is about
*ratios on a gauge* and it stands. The ghost list is not a gauge; it is the list
that section itself recommends in its place. A threshold on the list is
compatible with no threshold on the bar, and that distinction is what
RESEARCH.md must be updated to say.

## Design

### D4. One credit rule, shared

`HSKMistakes.ghostCredit(grade, word)` joins `credited()` in `mistakes.js`:

> If the grade carries a per-word verdict for this word, that verdict decides.
> Otherwise fall back to `grade.ok`.

Both halves matter. The verdict half is complaint 2. The fallback half is what
keeps every message written before this feature — and every message written
outside the Ghost Words activity — counting exactly as it does today. Nothing is
migrated and nothing is re-graded.

It lives in `mistakes.js` rather than `index.html` because that is where the
partial-credit rule already lives, and because it is the part of this work worth
testing in node.

### D5. The verdict: `grade.ghost`

A sibling of the existing `grade.target`, keyed by word:

```js
grade.ghost = { "说话": { used: true, ok: true },
                "参加": { used: true, ok: false } }
```

Written in `gradeTurn()` (`index.html:3205`), immediately after the grade lands
and beside the existing drill-target block, in **its own `try`** — a failed check
must leave the grade standing, which is what that block already does and why.

**D6. Asked only in the Ghost Words activity, only about ghost targets actually
present in the message, capped at 3 words per message.** The prompt is
`HSKPrompt.drillCheck({ label, text, drillWord: w })` with no `drillTag` — the
measured word arm, reused character for character. Because no prompt string
changes, CLAUDE.md's A/B requirement is not triggered.

Which words are present is decided by `HSK.segment()` against the current
lexicon, the same segmentation `producedWords()` already uses, intersected with
`reuseFor("focused")`. The cap bounds the cost: the banner shows six targets, a
real sentence reaches for one or two, and three is the ceiling on a message that
reaches for more.

Cost is one ~120-token call per checked word, on messages in one activity —
not on the grader's hot path generally. This is a real spend and should be
watched on the cost line after it ships.

### D7. Counting: `productionCounts()`

`producedWords()` becomes a thin wrapper over a single scan that returns counts
instead of membership:

- `productionCounts()` → `Map` of word → number of messages that credited it,
  using `HSKMistakes.ghostCredit()` for the per-message decision.
- `producedWords()` → the keys with a count of 1 or more.

One message credits a given word at most once, however many times it appears in
that message.

Every existing consumer of `producedWords()` — the read and produce coverage
bars, the goal panel, `usedWords()`, `neverUsedWords()`, `readiness().used`,
`newHave` — is untouched by D7 and sees the same Set it always did. The single
behavioural change reaching them is D4's relaxed credit rule, which can only
*add* words: a sentence that credited before still credits.

**D8. Only `readiness().unused` consults the threshold**, filtering on
`count < S.ghostUses` instead of `!mine.has(e.w)`. That is the ghost list and the
progress panel's corresponding row, and nothing else.

### D9. The setting

`GHOST_CHOICES = [1, 2, 3, 4, 5, 6]`, default 3, rendered as a Settings →
Learning dropdown beside "Correct sentences to finish a drill", stored under a
new `K.ghostUses`, and added to `PREFS_KEYS` in `sync.js:251` so it travels
between devices like every other preference. It is a preference, not a secret,
so the `PREFS_KEYS` prohibition that `test/sync.test.js` enforces does not apply
to it.

### D10. What the learner sees

- **The banner** (`index.html:2194`) shows each target with its progress —
  `说话 1/3` — rather than a bare list. Without it a word that has been used
  twice looks identical to one never used, and the activity silently stops
  explaining itself. This is the change that makes D1 and D2 legible at all.
- **The progress panel's "never used" row** (`index.html:5503`) is no longer
  literally true and is relabelled to name the threshold.
- **RESEARCH.md's Production section** names that row and argues it carries no
  threshold. It now carries one, for the reason given in D3, and that section is
  rewritten as part of this work rather than after it. CLAUDE.md requires the
  document to move with the constant.

## Error handling

The check is a model call and will fail. Every failure mode degrades to today's
behaviour rather than to a wrong answer:

- **The call throws or returns unparseable JSON.** No entry is written for that
  word, `ghostCredit()` falls through to `grade.ok`, and the message is judged
  exactly as it is judged today. Logged to the console like the drill target
  check beside it.
- **The grader is off.** No grades exist, so no ghost credit exists, and the list
  behaves as it does today with the grader off.
- **A message graded before this feature.** No `ghost` key, fallback applies.
- **`used: false`.** The learner wrote a sentence that never reached for the
  word. No credit, which is the point of asking `used` at all.

## Testing

- `test/mistakes.test.js` — `ghostCredit()` directly: verdict wins over
  `grade.ok`; a correct word in a failing sentence credits; a wrong word in a
  passing sentence does not; `used: false` does not credit; an absent verdict
  falls back both ways; an unreadable grade credits nothing.
- `test/browser.test.js` — a ghost word survives one correct use and leaves the
  list on the third; the banner shows a progress count; a correct ghost word in
  an otherwise-wrong sentence still advances it.
- No new file, so `sw.js`'s `SHELL` is unchanged. `VERSION` and `CACHE` move
  together, as on every user-visible change.
- No A/B run: no prompt string is edited (D6).

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

**Retrying a sentence after grader feedback.** Stays in BACKLOG.md.
