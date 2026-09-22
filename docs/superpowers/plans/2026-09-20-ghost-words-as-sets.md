# Ghost Words as a Chosen Set — Implementation Plan

> **Built 2026-09-20 as v125.** All seven tasks done, all three decisions as
> written. One thing the plan missed, recorded in `BACKLOG.md`:
> `flashcardTargets()` looked entries up in `S.base` alone, and every ghost word
> is from above the level, so a set would have reached the banner and the export
> with no pinyin and no gloss. `S.learning` and `S.extra` are in the lookup now.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ghost Words becomes Flashcard Chat drawing from a different pool. You
press a button, get five words the app has taught you and you have never written,
export them if you want, and practise that fixed set across three days with a
day strip, a completion message and a conversation titled with its own words —
instead of a drifting live list with no set, no round, no finish and nothing to
export.

**Backlog item:** `BACKLOG.md`, "Ghost Words should be Flashcard Chat with a
different pool" (asked for 2026-09-19, after two weeks of using both).

**Read first:** `docs/superpowers/specs/2026-09-18-flashcard-chat-design.md` and
`docs/superpowers/plans/2026-09-18-flashcard-chat.md`. This plan builds nothing
new — it points the machinery that plan built at a second pool — so its design
reasoning is the design reasoning here, and is not repeated.

**Shape of the diff: deletion.** `ghostBanner()`, `ghostFinishedHere()` and the
`reuse: "unused"` branch of `reuseFor()` all go. What arrives is one chooser
over a different pool, one marker role, and a label read from a table.

---

## Decisions taken here

The backlog entry closes with two open questions. Both are answered below rather
than left for the implementer; argue with them before Task 1, not during it.

**1. Five words, the same `SET_SIZE` as Flashcard Chat, and the live six goes.**
The set size is what makes a day countable — `setRounds()` is `min(ghostN)`
across the set — and a list that changes as words are credited has no minimum to
take. Nation's word-card guidance (5–7, `RESEARCH.md`, "Why the set is small")
is what `SET_SIZE = 5` and `SET_MAX = 7` already encode, and there is no reason
the number should differ by which shelf the words came off. Nothing keeps the
six-at-a-time behaviour: a second mode would be a second set of edge cases in
the banner, the strip, the completion state and the title, in exchange for a
behaviour the learner has just said he does not want.

**2. Reservation is shared, and it costs nothing.** `inFlightSets()` scans every
conversation for a set marker; teach it the second role and a word being worked
on in either activity is held back from both. In practice the two pools barely
touch — Ghost Words draws from `S.learning` entries with `from > S.level` and
Flashcard Chat from `S.base` — so this is mostly insurance against the case that
does cross them: a word introduced above level that becomes in-level when the
learner promotes. Insurance that is one argument wide is worth buying.

**3. A distinct `role: "focus"` marker, not a second use of `"flashcards"`.**
Sharing the role would give Ghost Words every downstream consumer for free, and
would also make `activityOf()` infer "flashcard" for a Ghost Words conversation
whose `activity` row was lost. That inference is the whole point of the marker —
see "Ghost Words and 20 Questions have no marker in their own transcript" in
`BACKLOG.md`, which this closes — so the roles stay distinct and the *reading*
is what gets generalised, in one function.

---

## Architecture

```
pace.js
  markerText(msgs, role)        exists
  flashcardsOf(msgs)            exists -- "flashcards" only, activityOf's witness
  focusOf(msgs)                 NEW    -- "focus" only, the same witness for ghost
  setWordsOf(msgs)              NEW    -- either marker: what every consumer reads

prompt.js
  ACTIVITIES.focused.reuse      "unused" -> "chosen"        (one word)

index.html
  reuseFor()                    the "unused" branch deleted
  flashcardWords()              body -> HSKPace.setWordsOf(S.history)
  inFlightSets()                reads both markers
  ghostCandidates()             NEW: readiness().unused minus reserved
  renderFlashcardControl()      chooser picks its pool by activity
  startFlashcardsWith()         writes "focus" or "flashcards" by activity
  flashcardBanner()             title and copy from ACTIVITIES[...].label
  ghostBanner()                 DELETED
  ghostFinishedHere()           DELETED
```

Everything else — `flashcardTargets()`, `flashcardRounds()`, `flashcardDone()`,
`flashcardDayDone()`, `renderFlashcardSetControl()`, `exportCards()`, the title,
the per-word grader check, `ghostProgress()` — is untouched, because all of it
already reads the set rather than the activity.

**Tech stack:** No build step, no bundler, no dependencies, anywhere —
including the tests. Plain ES5-flavoured JavaScript in the extracted modules,
plain node for the tests. Do not add a `package.json`.

## Global Constraints

- **No new file on the page's load path**, so `sw.js`'s `SHELL` needs no edit.
- **`VERSION` in `index.html` and `CACHE` in `sw.js` move together**, on the
  task that first changes behaviour and again at the end if more lands after it.
  `VERSION` is at `index.html:1198`, `CACHE` at `sw.js:10`.
  `test/release.test.js` fails if they disagree.
- **`S.ghostUses` is user-configurable (1–6). Never hardcode 3.** Same for
  `HSKPace.SET_SIZE`.
- **The pool filter is the definition of a ghost word** and does not change:
  `S.learning` entries with `(e.from || 0) > S.level` and fewer than
  `S.ghostUses` credits. Ghost Words is still "words the app taught you that you
  have never written"; only the *set* is new.
- **Chinese never reaches the learner unvalidated.** Every word either chooser
  offers comes out of the learner's own lists, so it is in-level or
  deliberately-above-level by construction. Do not add a path where a model's
  output is displayed directly.
- **Tests are plain node:** a `check(ok, label, detail)` counter, top-level
  statements, `process.exit(1)` at the end. `sh test/run.sh` runs everything.
  `test/browser.test.js` needs firefox and geckodriver and exits 0 without them,
  so a green run on a bare machine does not mean the browser suite passed.
- **Markers must be skipped by every transcript reader.** A new role means
  `MARKER_ROLES` (`index.html:2633`) and the prompt-side windowing both have to
  know it exists, or it will be sent to the model as a message.

---

### Task 1: One reader for both markers

**Files:**
- Modify: `pace.js` (beside `flashcardsOf`, `pace.js:281`; add to `api`)
- Test: `test/pace.test.js`

**Interfaces:**
- `HSKPace.FOCUS_ROLE` → `"focus"` and `HSKPace.SET_ROLE` → `"flashcards"`.
  Named because three files write them and a typo in a string literal is silent.
- `HSKPace.focusOf(msgs)` → `Array` of words from the `"focus"` marker, same
  parsing as `flashcardsOf`.
- `HSKPace.setWordsOf(msgs)` → `Array`. Whichever set marker the transcript
  carries, `[]` for neither. This is what every consumer reads.

- [x] **Step 1: Write the failing tests**

Append to `test/pace.test.js`:

- `focusOf` splits on `SET_SEP`, trims, and drops empties — the same cases
  `flashcardsOf` is already asserted on;
- `setWordsOf` returns the flashcard set for a flashcard transcript, the focus
  set for a Ghost Words one, and `[]` for a plain chat;
- `flashcardsOf` still returns `[]` for a transcript carrying only a `focus`
  marker — `activityOf()` depends on it being able to tell them apart, which is
  the reason this is three functions and not one;
- `reservedWords()` holds back words from a `focus` set exactly as it does a
  flashcard one (pass both kinds in `sets` and assert the union).

- [x] **Step 2: Implement**

`focusOf` is `flashcardsOf` with a different role argument. `setWordsOf` is
`focusOf(msgs)` when a focus marker is present, else `flashcardsOf(msgs)`.
`reservedWords()` needs no change at all — it takes `{words}` objects, and Task 3
is what feeds it both kinds.

**Verification:** `node test/pace.test.js` passes, existing assertions included.

---

### Task 2: The activity reads a set instead of computing one

**Files:**
- Modify: `prompt.js` (`ACTIVITIES.focused`, `prompt.js:353`)
- Modify: `index.html` — `reuseFor()` (`index.html:2201`), `flashcardWords()`
  (`index.html:6745`), `MARKER_ROLES` (`index.html:2633`), `activityOf()`
  (`index.html:3230`)
- Test: `test/prompt.test.js`, `test/browser.test.js` (Task 6)

- [x] **Step 1: The table**

`ACTIVITIES.focused.reuse` becomes `"chosen"`. Leave `steer: true` and leave the
rules text alone: "带着话题往这些词的方向走" is the stronger steering instruction
Ghost Words has always had, it is still exactly right for a chosen set, and
changing a prompt is a measurement this task has not earned.

`test/prompt.test.js` asserts the table; update the row's expectation and add one
that both steering activities now reuse `"chosen"`.

- [x] **Step 2: The reader**

- `flashcardWords()` → `HSKPace.setWordsOf(S.history)`. Every consumer of it —
  `flashcardTargets()`, the banner, the composer gate, the title — now works for
  both activities with no further edit. **Do not rename it**; the name is on
  thirty call sites and a rename is a bigger diff than the feature.
- `reuseFor()`: delete the `reuse === "unused"` branch entirely, with its long
  comment. The bug that comment records — a credited word dropping out of the
  live six mid-conversation — cannot happen to a fixed set, which is the
  strongest single argument for this whole change and belongs in the commit
  message.
- `MARKER_ROLES`: add `"focus"`.
- `activityOf()`: add `if (HSKPace.focusOf(msgs).length) return "focused";`
  beside the flashcard line. This closes "Ghost Words and 20 Questions have no
  marker in their own transcript" for Ghost Words.

**Verification:** `node test/prompt.test.js` passes. The app will be visibly
broken between here and Task 4 — Ghost Words has no chooser yet, so it shows an
empty set. Do not ship a version bump from this task.

---

### Task 3: The pool, and the chooser that offers it

**Files:**
- Modify: `index.html` — `inFlightSets()` (`index.html:6800`),
  `renderFlashcardControl()` (`index.html:6349`), `startFlashcardsWith()`
  (`index.html:6845`); add `ghostCandidates()` beside `flashcardCandidates()`

**Interfaces:**
- `ghostCandidates()` → `Array` of entries, the same shape
  `flashcardCandidates()` returns: `readiness().unused`, minus
  `HSKPace.reservedWords(...)`, capped at `HSKPace.CANDIDATES_SHOWN`.

- [x] **Step 1: Reservation sees both kinds**

`inFlightSets()` reads `HSKPace.setWordsOf()` instead of `flashcardsOf()`. One
word, and it is what makes decision 2 true.

- [x] **Step 2: The pool**

`readiness().unused` is already sorted commonest-first and already carries
`ghostN` and `ghostToday`, so `ghostCandidates()` is a filter and a slice. It
does **not** go through `flashcardPool()`: that function's two populations
(never-written, and written-but-stale) are about words the learner has met in
conversation, and a ghost word is by definition one they have never written.
Reuse the constants, not the arithmetic.

- [x] **Step 3: The chooser picks its pool**

`renderFlashcardControl()` takes the candidate list from the activity:
`currentActivity() === "focused" ? ghostCandidates() : flashcardCandidates()`.
Everything else in phase 1 — the note, the "Choose 5 words" button,
`HSKPace.SET_SIZE`, the `!S.grader` branch, the empty-pool branch — is shared.

Two strings differ and both must be right for the activity, because the empty
case is where a learner is most likely to be stuck:

- Flashcard Chat, empty: today's wording, unchanged.
- Ghost Words, empty: the existing "No unused words yet. Turn on **Introduce
  words from the next level** in Settings → Learning, chat for a while, then
  switch back here." — which is the one piece of `ghostBanner()` worth keeping,
  because it names the setting that fills the pool.
- Ghost Words with `!S.grader`: the flashcard wording is about the grader
  building the list, which is true here too (credits come from graded messages).
  Reuse it.

- [x] **Step 4: Writing the marker**

`startFlashcardsWith(words, theme)` writes `HSKPace.FOCUS_ROLE` when the current
activity is `"focused"` and `HSKPace.SET_ROLE` otherwise. The theme marker stays
flashcard-only for now — nothing chooses a theme for Ghost Words, and an unused
marker is a marker to keep correct for nothing.

**Verification:** manual, in the app: Ghost Words offers a chooser, pressing it
writes a `focus` marker, and `reuseFor("focused")` returns the five chosen words.

---

### Task 4: One banner for both activities

**Files:**
- Modify: `index.html` — `flashcardBanner()` (`index.html:2881` area), delete
  `ghostBanner()` (`index.html:2834` area) and `ghostFinishedHere()`
  (`index.html:6678`), and their call sites in `renderConversation()`

- [x] **Step 1: Parameterise the title**

`flashcardBanner()` returns `""` unless the activity has `reuse === "chosen"`.
Its heading becomes `HSKPrompt.ACTIVITIES[currentActivity()].label`, so it reads
"Flashcard Chat" or "Ghost Words" without a branch. The completion copy says
"Start a new " + that label.

The export buttons stay for both. A ghost set is exactly the kind of list Pleco
and Anki are good at, and the backlog entry asks for it in as many words.

- [x] **Step 2: Delete**

- `ghostBanner()` and both of its call sites.
- `ghostFinishedHere()`: it exists so a word that finishes mid-conversation does
  not vanish from a live list. A chosen set cannot lose a word, so the function
  has nothing left to do. Check there is no other caller before deleting.

- [x] **Step 3: Bump and verify**

This is the first task that leaves the app coherent. Bump `VERSION` and `CACHE`
together, run `sh test/run.sh`, and drive it by hand once: choose a set, write
one of the words, watch the count move on the strip (v123) and the day strip in
the banner.

---

### Task 5: Conversations that predate the set

A Ghost Words conversation started before this change carries no marker, so
`setWordsOf()` returns `[]` and the activity would show a chooser over a
transcript with history in it — and, worse, a composer disabled by
`renderComposer()`'s `flashcard && !flashcardWords().length` rule, which would
make an old conversation unusable.

**Files:**
- Modify: `index.html` — `renderComposer()`, `renderFlashcardControl()`

- [x] **Step 1: Implement**

A set-based activity with no marker **and** a non-empty transcript is a legacy
conversation: leave the composer open, show one note on the strip saying this
conversation predates word sets and that a new Ghost Words will pick one, and
offer no chooser inside it. No writes, no migration, no backfill — the
transcript is evidence of what happened and the app does not rewrite those.

The partner steers at nothing in such a conversation (`reuseFor()` returns the
empty set), which is the honest outcome: nobody knows what six words it was
targeting, because that was exactly the problem.

- [x] **Step 2: Verification**

Browser test in Task 6. By hand: open an old Ghost Words conversation, confirm
you can still type in it and that it says why there is no set.

---

### Task 6: Tests

**Files:**
- Modify: `test/browser.test.js` (the flashcard block is the model; the Ghost
  Words block above it changes)

- [x] **Step 1: Rewrite the Ghost Words browser block**

The existing block asserts the live-six behaviour and has to go with it. What
replaces it, following the flashcard block almost line for line:

- the chooser appears for a fresh Ghost Words conversation, over words from
  `readiness().unused` and not from `flashcardCandidates()`;
- pressing it writes a `focus` marker and `reuseFor("focused")` returns exactly
  those words;
- the banner reads "Ghost Words", not "Flashcard Chat", and carries both export
  buttons;
- the per-word counts are on the strip above the composer;
- a word credited mid-conversation stays in the set — the regression the deleted
  `reuse: "unused"` branch spent a long comment on;
- a second set does not re-offer a word the first is still working on, **across
  activities**: start a Ghost Words set, then open Flashcard Chat and assert its
  candidates exclude those words (decision 2, and the only place it is visible);
- a legacy Ghost Words transcript (seeded through `localStorage`, no marker,
  with messages) keeps its composer enabled.

- [x] **Step 2: Verification**

`sh test/run.sh`, everything green, browser suite included.

---

### Task 7: Close it out

- [x] **Step 1: Documentation**

- `RESEARCH.md`, "Retiring a ghost word": the activity now practises a chosen
  set of `SET_SIZE`, so the reasoning in "Why the set is small" and "Why a list
  you ask for is a different task from a queue you owe" (both under "Choosing a
  set of words to study away from the app") now governs Ghost Words too. Say
  which parts transfer and which do not — the ghost pool is *not* a list the
  learner asked for in Hulstijn & Laufer's sense until this change gives them
  the button, which is an argument *for* the change and should be recorded as
  one.
- `BACKLOG.md`: strike this entry, and strike "Ghost Words and 20 Questions have
  no marker in their own transcript" for the Ghost Words half (20 Questions is
  untouched and stays open). Note that the Ghost Words chat title comes free, as
  that entry predicted.
- `README.md`: the Ghost Words section describes a live list of six. Rewrite it
  as the set activity it now is, in the learner's language.
- `docs/superpowers/specs/2026-09-18-flashcard-chat-design.md`: one line saying
  a second activity now rides this design, with a pointer here. The spec claims
  the machinery generalises; this is the evidence.

- [x] **Step 2: Version and verify**

Bump `VERSION` and `CACHE` together if Task 4's bump is no longer the last
user-visible change, then:

```sh
sh test/run.sh
```

Everything green, `test/release.test.js` included. Commit on a branch.

---

## What this plan deliberately does not do

- **No theme for Ghost Words.** Flashcard Chat's optional theme marker is a
  model call that arranges a set; the ghost pool is ranked by frequency and has
  no such call. Add it if the flashcard version proves itself.
- **No change to the ghost pool's definition or its ranking.** Commonest-first
  over `readiness().unused` is what the activity has always offered; this plan
  moves *when* the six become five and stop moving, not *which* words they are.
- **No prompt change.** `ACTIVITIES.focused.rules` is measured wording and stays
  character for character; only the `reuse` key moves.
- **No migration of old conversations.** They keep their transcripts and lose
  their targeting, which they never recorded in the first place.
- **No second mode.** The drifting six is deleted, not kept behind a setting.
