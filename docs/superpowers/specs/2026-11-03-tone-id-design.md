# Tone ID: play a word, name every tone in it

**Date:** 2026-11-03
**Status:** design awaiting approval. Nothing built.
**Scope:** one new pure module that splits tone-marked pinyin into syllables and
applies sandhi, one sheet that plays a word and takes one answer per syllable,
and a face-aware correction to `retrieval.js`'s day cap. The partner, the
validator, the grader, the prompt table and every existing activity are
untouched. No model call, no network, no new table.

Explicitly **not** in scope: dictation, scramble and retranslation, which are
the remaining faces of the same engine. This document fixes the pinyin API they
may reuse and says nothing else about them.

---

## The request

BACKLOG.md's Order of work #3, nominated by Todd on 2026-11-01 after he retired
*"Let me rewrite a sentence the grader failed"* — the grader already shows a
corrected version in the chat window, so that gap was largely closed already.

Tone ID has the best transfer evidence of anything on the ranked list, and it is
the only item here whose evidence is about *production* while costing nothing to
run. Wang, Spence, Jongman & Sereno (1999) trained American learners to identify
Mandarin tones in eight 40-minute sessions: identification improved 21%, and it
generalised to new words (+18%) and to voices never heard in training (+25%),
still present at a six-month follow-up. Wang, Jongman & Sereno (2003) recorded
the same trainees before and after and had native listeners judge what they
said: **production improved 18% after perception-only training**, with nobody
correcting their pronunciation.

The app cannot hear the learner. It turns out not to matter: perceptual training
is the intervention with the transfer evidence, and it is exactly the one this
app can run for free.

## What already exists

- **The pinyin.** Every `data/hsk<N>.json` entry carries `p`, the pinyin with
  tone marks — `wǒ`, `wǒmen`, `xiànzài`. It is the **citation** form.
- **Audio.** `speak(text, btn)` (`index.html:3955`) and `zhVoice()`
  (`index.html:3944`). `zhVoice()` takes the *first* Chinese voice it finds and
  ignores the rest; `speechSynthesis.getVoices()` commonly returns several.
- **The voice warning.** `#voiceNote` (`index.html:775`, filled at 7709) already
  tells the learner when no Chinese voice is installed, with the iOS path to fix
  it. Tone ID is the first activity that is *impossible* without one.
- **The retrieval engine.** `retrieval.js` — `countsFrom(rows)`,
  `credit(rows, entry)`, `batch()`, `ROUND = 10`, `CANDIDATES = 4`.
- **The retrievals table.** Synced, with a real `face text not null default
  'gapfill'` column (`db/schema.sql:169`). `retrievalToRow()` and
  `rowsToRetrievals()` (`sync.js:276`) both carry `face` through. **The table
  was built for exactly this.**
- **The credit writer.** `creditRetrieval(word, ok, face)`
  (`index.html:6872`) already takes a `face` and defaults it to `"gapfill"`.
- **The sheet pattern.** `openGapFill()` / `renderGapFill()` / `closeGapFill()`
  (`index.html:5977`+), and `.sheet` / `.sheethead` markup.
- **The menu pattern.** `fillActivities()` (`index.html:5291`) appends
  `<option value="__gapfill">` after the real activity rows; the handler
  (`index.html:7441`) opens the sheet and restores the select. A retrieval face
  reads as a peer in the menu and is structurally a button, because every key in
  `HSKPrompt.ACTIVITIES` is a *conversation* config and a `toneid` row there
  would be a conversation waiting on a prompt that does not exist.

## Decisions

All five product decisions were settled by Todd on 2026-11-03. Two went against
the recommendation offered; he took the larger build knowingly.

**1. An item is a whole word, and the learner answers every syllable's tone.**
Not single-syllable-only, which was the recommendation. This trains tone
*sequences* rather than isolated categories, and it keeps the full list in play:
single-syllable scope would have cut HSK 1 from 300 words to 137. It is also
what puts sandhi back in scope — see decision 3.

**2. Neutral is a real answer, on every syllable.** The answer set is five:
1, 2, 3, 4, neutral. 的, 了, 吗 and the rest stay in. This is the majority of
the problem rather than an edge case: **20% of HSK 1 words contain a neutral
syllable** (60 of 300), against 3% affected by sandhi. A four-way drill would
have quietly taught that Mandarin has four tones.

**3. Sandhi is the lesson, not an exclusion.** The drill expects what the voice
actually says: 你好 is answered **2-3**, not the 3-3 the file stores. Todd
settled this by testing rather than arguing — he played 你好 and 不是 through
iOS in Notes and heard sandhi correctly applied. That is what makes it safe: the
question was never which form is *correct*, which is documented, but whether the
audio matches it.

> **The evidence is iOS system voices only.** The rule must **degrade, never
> punish**: if a voice speaks a citation tone instead, the learner who answers
> what they heard must not be marked wrong. See decision 6.

**4. A round is 20 items by default, and it is a SETTING.** The backlog entry is
firm that any dose number here is a guess and belongs in Settings the way
`GHOST_USES` is settable 1–6. Todd chose 20 over gap-fill's `ROUND = 10`: a tone
item is quicker than a gap-fill item — listen, tap — so 20 still fits under two
minutes while doubling the retrievals, which is the mechanism the evidence
credits. The literature's dose is eight sessions of forty minutes and nothing
says it scales down linearly.

**5. Credit goes in its own counter, touching nothing else.** Tone rounds do not
feed ghost-word retirement and do not enter the pacing arithmetic. This follows
what gap-fill already shipped: `GHOST_USES` means *days the learner produced the
word in a graded sentence*, and a tap is recognition — feeding it in would not
fill the counter faster, it would change what the counter means and make a tap
game a road to retiring a word. Tone ID is weaker still: the learner classifies
a tone and need not even identify the word. But it **is** counted, because
whether the activity gets used is the question shipping it exists to answer.

**6. Accept both forms where the drill cannot know what the voice did.**
Decisions 3 and the iOS-only caveat force this, and it is the one decision this
document adds rather than inherits. For a syllable whose sandhi form differs
from its citation form, **both answers are correct**. The sandhi form is what the
sheet *teaches* — it is shown in the reveal, and the summary names the rule —
but a learner who hears a citation tone and says so is not punished for a voice
the app did not choose. This costs nothing: the detector is needed either way,
and it is the only option that cannot teach something false on an untested
device.

## Architecture

### `pinyin.js` — a new pure module

The first real piece of work, and it is a module with a test suite rather than
an afternoon. Asking for every syllable's tone requires knowing where the
syllables are, and **the stored pinyin is unspaced**: `wǒmen`, `xiànzài`,
`shénme`. Worse, a neutral syllable carries **no mark at all**, so counting tone
marks does not tell you which syllable is neutral — `wǒmen` has one mark and two
syllables.

Two approaches were considered:

- **A syllable parser over the stored `p`.** `p` is the authority for that word.
  Pinyin syllables are a finite set, so a longest-match split works, with its
  own tests for the boundaries that are genuinely ambiguous.
- **Per-character lookup** against the HSK 7–9 reference dictionary, reusing
  data already shipped — but **wrong on polyphones** (了 le / liǎo, 行 xíng /
  háng, 不 bù / bú), which is exactly the population a tone drill cares about.

**The parser wins**, because the compound's own pinyin is the ground truth and
the alternative is wrong where it matters most.

Pure: no DOM, no `S`, no network, no clock, no randomness.

```
HSKPinyin.split(p)        -> ["wǒ", "men"]        | null if it cannot be split
HSKPinyin.tones(p)        -> [3, 0]               | 0 means neutral
HSKPinyin.sandhi(tones)   -> [2, 3]               | the spoken sequence
HSKPinyin.SYLLABLES       -> the legal-syllable set, for the tests
```

`split()` returning `null` rather than guessing is load-bearing: a word it
cannot parse is **excluded from the pool**, never shown with a wrong answer key.

### The sandhi rules

To be verified against the data in Task 2, not trusted from this document:

| rule | example |
|---|---|
| 3 before 3 becomes 2 | 你好 `nǐ hǎo` → *ní hǎo* |
| 不 is bù, but bú before a 4th tone | 不是 `bù shì` → *bú shì* |
| 一 is yī alone; yí before 4th; yì before 1st, 2nd, 3rd | 一个 → *yí gè*; 一天 → *yì tiān* |

Three consecutive third tones are genuinely ambiguous and depend on phrasing.
**Enumerate any such words actually present in the lists and exclude them**
rather than writing a general rule for a case that may not occur below HSK 6.

### The face-aware day cap — a correction to `retrieval.js`

`credit()` keys its one-row-per-day cap on **word + day, ignoring `face`**, and
`countsFrom()` ignores `face` entirely. Reusing the table as-is would therefore
break decision 5 in two ways: a gap-fill credit on 我 would consume the tone
slot for 我 the same day, and a tone tap would raise the `n` that **selects**
gap-fill's words.

The fix is small and **backward-compatible**, because every row already carries a
face — `creditRetrieval` defaults it, both sync converters default it, and the
column defaults it:

- `credit(rows, entry)` keys the cap on **word + day + face**.
- `countsFrom(rows, face)` filters when `face` is given and pools when it is not,
  so `retrievalCounts()` keeps its present meaning until its caller is updated.

No new table, no schema change, no migration.

### The sheet

A fifth face in the activity menu (`__toneid`), its own sheet, built on
`openGapFill`'s shape. Per item: play the word, show five buttons per syllable,
reveal on answer, advance. Gap-fill deliberately has **no audio** — the comment
at `renderGapFill()` says audio belongs to the face where hearing it *is* the
task. This is that face.

**Talker variability is the active ingredient, and must be built in from the
start.** The effective protocol is *high*-variability training — four talkers,
not one — and low-variability is the arm that underperforms. So the sheet cycles
**every** installed Chinese voice and varies the rate, rather than calling
`zhVoice()`. This is a few lines and it is the difference between the two arms.
It remains synthetic speech with canonical tones, which is a ceiling no amount
of cycling clears; that ceiling is accepted, and the alternatives that would
break it were examined and ruled out (OpenRouter has two speech models, neither
exposing a voice parameter; Pleco's URL scheme has no audio action and its
recordings live in its own sandbox).

**No Chinese voice means no activity.** Every other activity degrades on a
device without one. This cannot: the menu entry must say so and the sheet must
explain rather than play silence.

## What this does not do

- No model call, no network, no cost. Nothing to A/B.
- No new synced table and no schema change.
- No change to how any existing activity behaves, with one exception: once
  `retrievalCounts()` filters by face, gap-fill's word selection stops counting
  tone taps — which is the decision, not a side effect.
- No reading of `side`, no change to the partner, the grader or the validator.

## What would settle whether it was worth building

The entry is explicit: nothing here needs measuring against a model, because
there is no model in this path. **Build it and find out whether it is used** —
that is what the `face: "toneid"` rows are for. If it is used, the constants it
needs (`ROUND` default, the voice-cycling policy) go into RESEARCH.md with the
citations above, and a change to any of them updates that file too.
