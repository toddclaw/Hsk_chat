# The retrieval engine, with gap-fill as its first face

**Date:** 2026-09-12
**Status:** approved design, not yet planned or built.
**Scope:** one new module that turns the learner's stored corpus into retrieval
items, one new synced table that records those retrievals, and one screen —
gap-fill — that consumes both. The partner, the validator, the grader, the
prompt table and every existing activity are untouched.

Explicitly **not** in scope, and each is a later face of the same module:
dictation, tone ID, scramble, and retranslation. This document fixes the API
they will call and says nothing else about them.

---

## The request

BACKLOG.md's first ranked item: *"The retrieval engine, with gap-fill as its
first face."* The argument there is that four separate backlog entries describe
one machine. The app already stores a personal corpus — every partner message,
every story segment, every sentence the learner has written — and uses it only
for coverage arithmetic. Point a retrieval task at it and the task costs no
model call, no network and no new data, because **the right answer is known
before the question is asked**. That is the property none of the generative
activities have.

Gap-fill is first because Folse (2006) beat one original-sentence exercise with
three fill-in-the-blanks on the same words: the number of retrievals drives
retention, not the depth of any single one. Gap-fill is the cheapest retrieval
that exists, and building it is what makes the other faces small.

## What already exists

- **The corpus.** `S.chatMsgs` holds every turn of every conversation, synced,
  grouped by `conversation_id`. Assistant turns carry `kind` (segment vs.
  question); user turns carry `grade`.
- **Segmentation.** `HSK.segment(text, lex)` (`validator.js:103`) splits any
  string into `{kind, text}` tokens against the active lexicon.
- **Validation.** `HSK.validate()` decides whether a string is inside the
  level. It is free and offline.
- **The corrected sentence.** `parseGrade()` (`index.html:3210`) stores
  `better`, and already blanks the self-identical corrections the grader
  produces (RESEARCH.md, "When the correction is the sentence").
- **Day-keyed credit.** `HSKMistakes.dayKey()` (`mistakes.js:28`) and
  `ghostDayKey()` (`index.html:5581`) are the UTC day the ghost and drill
  counters both bank in.
- **The pattern for a pure module.** `ghostProgressMap()` (`index.html:5595`)
  hands `mistakes.js` a segmentation callback and gets arithmetic back. No
  module in this repo requires another; `index.html` does all the wiring.
- **Sheets.** `.sheet` / `.sheethead` markup, used by the report, vocab, pool
  and model sheets.
- **Generic table sync.** `pushVocab(table, rows)` and `pullVocab(table,
  userId)` (`sync.js:417`) are already generic over the table name.
- **Starter exclusion.** `ownWriting(t)` (`index.html:5560`) is how the app
  already tells the learner's own text from a tapped starter.

## Decisions

Each was taken deliberately; the reasoning matters more than the choice.

**1. Gap-fill is reachable from the activity dropdown but is not an activity.**
Every key in `HSKPrompt.ACTIVITIES` (`prompt.js:321`) is a conversation config,
and `newChat()` (`index.html:2622`) will create a chat for any id that table
knows. A `gapfill` row would therefore be a conversation waiting to be started
against a prompt that does not exist. `fillActivities()` (`index.html:4356`)
instead appends one extra `<option value="__gapfill">` after the real rows; its
handler opens the sheet and restores the select to the current activity. It
reads as a peer in the menu and is structurally a button.

**2. A retrieval is counted per word, in its own table, never as ghost credit.**
`GHOST_USES` counts *days on which the learner produced the word in a graded
sentence*. RESEARCH.md's "Retiring a ghost word" is explicit that this is a
productive threshold and is not derived from the receptive studies behind
`PROMOTE_AT = 6`. A tap in gap-fill is recognition. Letting it feed that counter
would not merely fill the counter faster, it would change what the counter
means — and would make a tap game the fast way to retire a ghost word, which is
the hazard BACKLOG.md flags.

**3. The count is synced, and shaped as rows rather than a counter.** See
Storage below. The short version: two devices incrementing an integer offline
resolve to one of the two values and lose the other retrieval.

**4. The target is the fewest-retrievals word among words worth practising.**
Not random (which mostly blanks 的 and 我), and not strict weakest-first tiers.
Tiers sound better than they behave: a target only exists if some *eligible*
corpus sentence contains it, so a mistake-ledger tier can be empty while feeling
like it should be full, and a small ledger repeats hard. Fewest-retrievals
spreads practice across the words the learner is actually learning and makes the
new table load-bearing — it is the selector, not a score.

**5. Nothing from today.** Retrieval after a gap is the mechanism; asking about
a sentence read four minutes ago tests the screen, not memory.

**6. A fixed round of ten.** A known end, a progress indicator and a summary.
Bounded means the learner knows what they signed up for.

**7. Corrections are corpus, and everything is re-validated.** RESEARCH.md's
"The grammar check writes Chinese of its own" records that nothing validates or
retries the Chinese a teaching call writes — only the partner's replies get
validate-and-retry. So corrections can carry out-of-level words. Running
`validate()` over every candidate sentence at generation time costs one offline
call and also covers a case the "it was in-level when it was written" argument
misses: a learner who moves *down* a level has a history that is no longer
in-level.

## The module

`retrieval.js`, following the repo's wrapper convention exactly:

```js
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.HSKRetrieval = api;
```

Three pure functions, no DOM, no `S`, no network, no clock:

```js
HSKRetrieval.batch({
  turns,      // stored messages, any conversation
  starters,   // starter texts to exclude, as ownWriting() does
  counts,     // { word: { n, days: {dayKey: true} } }
  learning,   // S.learning rows
  mistakes,   // words the grader has flagged
  pool,       // active allowlist, for distractors
  today,      // dayKey string, passed in — never derived
  size,       // ROUND
  segment,    // fn(text) -> tokens
  validate,   // fn(text) -> bool
  random      // fn() -> [0,1)
}) -> [{ text, at, len, target, candidates, source }]

HSKRetrieval.credit(rows, word, today, ok, face) -> rows'   // at most one row per word-day
HSKRetrieval.countsFrom(rows) -> counts                     // distinct ok days per word
```

`ROUND = 10` and `CANDIDATES = 4` are exported from the module alongside them,
the way `HSKPace` exports its own constants — so the numbers RESEARCH.md
justifies have exactly one home in the code, and a test can name them rather
than repeat them.

Three properties of that signature are the design rather than bookkeeping:

- **`random` is injected.** Distractor choice and shuffling are random, and a
  generator whose output cannot be pinned is one you can only test for "did not
  throw". With a stub, the suite asserts exact items against a fixture.
- **`segment`, `validate` and `today` come in from outside.** That is what keeps
  the module loadable by node, and it mirrors how `mistakes.js` is already fed.
- **`credit()` is separate from `batch()`.** The day cap is arithmetic over
  stored rows and belongs where it can be tested against a fabricated calendar,
  not inside a tap handler.

**An item is face-agnostic except for one field.** `text`, `at`, `len`, `target`
and `source` are what dictation, tone ID and scramble need; `candidates` is
gap-fill's alone. Keeping that boundary visible is how the claim "this build
makes the other faces small" gets checked rather than asserted.

## Corpus and item generation

**Eligible sources**, unioned, each tagged for display:

1. Assistant turns — partner replies and story segments alike. `kind`
   distinguishes them in the source line, not in eligibility.
2. Learner turns where `t.grade.ok` and `ownWriting(t)` — the same bar
   `producedWords()` uses, so a starter is never mistaken for the learner's
   text and a flagged sentence never becomes an item.
3. `t.grade.better`, the grader's correction, where non-empty — **regardless of
   that turn's `ok`**, since the correction is the grader's sentence rather than
   the learner's. This is the one source that comes from a turn rule 2 rejects,
   and it is the point: the sentence the learner got wrong returns as the
   sentence they get asked about.

**Then, in order:**

- Drop anything whose `created_at` day key is today's.
- Split into sentences on `[。！？!?\n]`, keeping the terminator with the
  sentence it ends. `validator.js:191` already carries that character class.
- Drop sentences with fewer than four word tokens. A three-word sentence minus
  one word is not a context, it is a guess.
- Drop any sentence that fails `validate()` against the current lexicon.
- Choose the target: a `kind === "word"` token that is in `S.learning` or in the
  mistake ledger, has no row for today, and has the lowest `n` in `counts`. Ties
  break commonest-first by `f`.
- **If no such word exists in the sentence, skip the sentence.** There is no
  fallback to "any content word": the app has no part-of-speech data, so a
  fallback tier would mostly blank function words, and the corpus is large
  enough not to need it.
- Choose three distractors: the nearest `f` ranks in the active allowlist,
  excluding the target and every word already in the sentence. Where the target
  has no `f`, fall back to same-level words at random.
- Shuffle the four candidates with the injected `random`.

One item per sentence, and no target repeated within a round.

**The blank renders fixed-width** (`____`) whatever the target's length, so
character count leaks nothing. That is also why distractors need not match the
target's length.

## Storage and sync

One row per word, per day, per face:

```sql
create table if not exists public.retrievals (
  id uuid primary key,                    -- client-generated
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  day text not null,                      -- UTC dayKey, "2026-09-12"
  ok boolean not null,
  face text not null default 'gapfill',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
```

RLS scoped to `auth.uid()`, the same policy shape as every other user-data
table.

- **Rows, not a counter.** `n` is derived: the count of distinct days on which
  that word was answered correctly. Two devices offline on the same day produce
  two rows and still count one day, so **no unique constraint is added** — a
  constraint would reject the second device's push instead of absorbing it.
- **Nothing is ever deleted, so no tombstone is needed.** This is the one place
  the sync rules relax, and only because the table is append-only.
- **A wrong answer writes `ok: false`.** It occupies that word's day — you
  cannot retry the same word for credit until tomorrow, the symmetry
  RESEARCH.md argues for in "Retiring a ghost word" — but adds nothing to `n`.
  **No demote-by-one machinery is needed**: because `n` is also the selector, a
  wrong answer leaves the count low and the word resurfaces sooner. The
  correction lives in the ordering, not in an arithmetic penalty.
- **`face` ships in the first migration** although only `gapfill` writes it.
  `db/schema.sql` already records the reasoning for `conversations.title`:
  adding a column later means whoever runs the deployment applying SQL by hand
  again, which is the expensive kind of change. "Which face produced this
  retrieval" is exactly what the tone-ID and dictation evaluations will ask.
- **Sync reuses `pushVocab` / `pullVocab`**, which are already generic over the
  table name. New: converters and a `schemaHasRetrievals` probe flag, kept
  independent of the other flags per the rule `sync.js:450` already enforces —
  a project that ran one migration and not another must not lose unrelated
  features as collateral. When the probe fails, `retrievalsSupported()` goes
  false and gap-fill keeps working locally for the session: it degrades rather
  than failing.
- `PREFS_KEYS` is untouched. Nothing here goes near `key` or `history`.

## Surface and flow

```
┌ Gap-fill                    3/10  ✕ ┐
│                                     │
│   你昨天 ____ 了什么好吃的？          │
│   from a story · Tuesday             │
│                                     │
│   [  吃  ]  [  做  ]  [  买  ]  [ 看 ] │
└─────────────────────────────────────┘
```

- Correct: the blank fills green, and the round advances after a beat.
- Wrong: the tapped candidate goes red, the right word is revealed, and the
  round waits for a tap. The learner needs time to read the answer they missed.
- Either way exactly one row is written, and only if that word has no row today.
- Candidate buttons respect the existing `--tap` minimum and carry labels for
  screen readers.

**One leak to close:** the app has a global pinyin toggle, and pinyin over the
blanked span hands over the answer. Pinyin stays on the rest of the sentence and
is suppressed for the blank. For the same reason there is no audio and no
translation control in this sheet — both would read the answer aloud. Audio
belongs to dictation, where hearing it *is* the task.

**The round ends** on a summary: score, words practised, and "Again" for a fresh
batch. If the corpus cannot fill ten, the round is however many it found and
says so rather than padding.

**The empty state names which precondition is missing**, distinguishing three
cases: no history older than today; history exists but holds no words you are
currently learning; every eligible word is already done for today. A single
"nothing to practise" covering all three is the failure `drillWhyNot()` was
written to fix.

**Known consequence:** by construction, gap-fill is empty on a new account and
stays empty until there is a day-old history containing words the learner is
learning. That is the day gate and the target rule working as designed, and it
is why the empty state has to be specific.

**Skipped deliberately:** tapping the revealed word for its gloss (the `#pop`
popover would do it, but it is a second interaction model inside a sheet whose
job is one tap), and a typed-answer mode (BACKLOG.md argues the tap version is
as well-evidenced and is one gesture instead of ten; it can become a setting if
it is ever missed).

## Tests

`test/retrieval.test.js`, plain node, `check(ok, label, detail)` counter,
fixtures in `test/fixtures.json`, `process.exit(1)` at the end — the same shape
as every other suite. The cases worth writing are the ones where a silent wrong
answer is plausible:

- today's sentences excluded, yesterday's not;
- an out-of-level `better` correction dropped by the `validate()` filter;
- a sentence with no practice-worthy word produces no item rather than a 的 item;
- target is the fewest-retrievals word, ties commonest-first;
- a word already answered today is not offered again;
- distractors are rank-neighbours, never a word already in the sentence, always
  four candidates including the target;
- `credit()` writes at most one row per word-day, `ok: false` included;
- `countsFrom()` counts **distinct** ok days, so two devices' duplicate rows for
  one day count once.

That last case is the merge-correctness claim from Storage, tested as arithmetic
rather than trusted. Per DEVELOPING.md's "mutation-test anything load-bearing",
the day cap and the target ordering get mutated and the suite confirmed red.

`test/sync.test.js` gains a round-trip for the new converters and keeps
asserting that `PREFS_KEYS` names neither `key` nor `history`.

**No model measurement is required**, and that is worth stating because
CLAUDE.md's rule normally would demand one: there is no model call anywhere in
this path, so there is no prompt whose behaviour could surprise us. The A/B
discipline does not apply to arithmetic over a corpus.

## Release mechanics

Enforced by `release.test.js`, and invisible in a diff:

- `retrieval.js` gets a `<script>` tag in `index.html`;
- `retrieval.js` is added to `SHELL` in `sw.js` — `cache.addAll` is
  all-or-nothing, so one missing path means the worker never installs and
  offline support disappears silently;
- `VERSION` in `index.html` and `CACHE` in `sw.js` both move to v101.

## Documents that change with the code

- **RESEARCH.md** — a new section for the constants introduced here: round
  length 10, four candidates, the "nothing from today" gate, and the argument
  for keeping a retrieval count separate from `GHOST_USES`. Folse (2006) moves
  across from BACKLOG.md's bibliography. These are constants a later feature
  could collide with without editing, which is what that file is for.
- **db/schema.sql** — the table and its RLS policy, `if not exists` throughout.
- **BACKLOG.md** — item 1 becomes built; items 4, 5 and 6 (tone ID, dictation,
  scramble) point at the engine's actual API rather than the idea of it.

## Out of scope, recorded

- **Distractors from the mistake ledger.** BACKLOG.md's "interesting version" —
  a wrong candidate the learner has actually confused before. Needs no new data,
  but it is a second selection rule and the first one should be seen working.
- **Expanding intervals.** A retired word returning at 7 then 30 days is a
  scheduler, declined in BACKLOG.md for that reason, and unchanged by this.
- **The other four faces.** Dictation, tone ID, scramble, retranslation. Only
  retranslation needs a model; the rest are presentation over the same `batch()`.
