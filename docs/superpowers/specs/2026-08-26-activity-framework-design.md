# Activity framework (sub-project A)

**Date:** 2026-08-26
**Status:** design approved, not yet planned
**Scope:** dialogue activities only. The item/drill path is A2 and is not designed here.

---

## Why this is only part of the request

The original request was one feature list: spaced repetition, an activity selector
replacing the header's level and model pickers, goal tracking with a progress bar,
a weekly metrics report, and speaking practice. That is five subsystems, not one
feature, and one spec covering them would not be buildable.

Agreed decomposition:

| | Sub-project | Depends on | Note |
|---|---|---|---|
| **A** | Activity framework — selector, level/model demoted, chat + focused chat + story time | — | This document |
| **A2** | Item-session path — result rows, session screen | A | Hosts dictation, word rescue, tone drills, focused drills |
| **B** | Mistake ledger + weekly report | grades (already stored) | Pure aggregation over `messages.grade` |
| **C** | SRS scheduling + word rescue | A2, B | The genuinely new data model |
| **D** | Goals + progress bar | `HSKPace.coverage`/`toTarget` | Needs a word target per goal — a research question |
| **E** | Speaking | A2 | Spike first; no `SpeechRecognition` exists in the codebase |

## The distinction that shapes everything: dialogue vs item

The seven requested activities do not divide into "chat" and "not chat". They divide
by whether prior turns belong in the model's context.

| Activity | Prior turns as context? | Path |
|---|---|---|
| Chat | Yes | Dialogue (A) |
| Focused chat | Yes | Dialogue (A) |
| Story time | Yes — the questions are *about* the story | Dialogue (A) |
| Word rescue | No — item 4 must not see item 3 | Item (A2) |
| Focused drills | No | Item (A2) |
| Dictation | No, and the generated sentence must stay hidden until answered | Item (A2) |
| Tone drills | Not text turns at all | Item (A2) |

For the item activities `windowed()` (`index.html:1399`) is not merely unnecessary,
it is wrong — it would feed the model a growing transcript of unrelated attempts.
Dictation additionally cannot use the transcript model at all, since rendering the
target sentence spoils the exercise.

The item activities' durable output is a **result row** (which word or tag, right or
wrong, when), not a transcript. Nobody re-reads a dictation session. Result rows are
append-only and need **no tombstone**, because an individual drill result is never
deleted — so the deletion-monotonicity hazard that makes conversation sync genuinely
hard does not arise for them. That is A2's design and is not settled here.

---

## 1. Data model

### `activity` on `conversations`

```sql
alter table public.conversations add column if not exists activity text;
```

Nullable. `NULL` means `"chat"`, so every conversation written before this change
reads back correctly with no migration — the same treatment `conversation_id`
already gets via `LEGACY_ID` and `grade` already gets by being nullable.

This is the third optional column, and it joins the existing probe. `probeSchema()`
(`sync.js:386`) selects each optional column once per session and watches for
`PGRST204` / `42703`, so an un-migrated database degrades to activity-less
conversations instead of failing every push.

### The merge trap

`mergeConversations` (`sync.js:147`) rebuilds the merged object **field by field**
rather than spreading:

```js
var merged = {
  id: newer.id, title: newer.title,
  created_at: existing.created_at || incoming.created_at,
  ...
};
```

A field not added there is silently dropped on every sync. The activity would
survive locally and vanish the moment a second device merged.

It must also **not** be newest-wins the way `title` is. An activity is fixed when
the conversation is created and never changes, so it resolves:

```js
activity: existing.activity || incoming.activity || "chat"
```

`conversationToRow` and `rowToConversation` carry it likewise.

### What does *not* change

- **Not in `PREFS_KEYS`.** The activity lives on the conversation row; there is no
  preference to sync. This also avoids touching the list `test/sync.test.js` guards
  against ever naming `key` or `history`.
- **No column on `messages`.** Messages already carry `conversation_id`, so B's
  mistake ledger joins through it to learn that a grade came from focused chat. One
  column, not two. This matters for B's correctness — a dictation typo is a
  transcription slip, not a grammar error, and must not enter the top-mistakes tally.

### The activity contract lives in `prompt.js`

Not a new module. `prompt.js` already owns `LEVEL_STYLE`, `LENGTHS` and `STARTERS`,
and what an activity does is mostly add rules to the system prompt. No new file
means no new `sw.js` `SHELL` entry to forget and no new suite — `prompt.test.js`
extends.

```js
var ACTIVITIES = {
  chat:    { label: "Chat",         rules: null,  reuse: null,     gen: "turn" },
  focused: { label: "Focused chat", rules: [...], reuse: "unused", gen: "turn" },
  story:   { label: "Story time",   rules: [...], reuse: null,     gen: "segments" }
};
```

Three fields, because three is what actually varies.

- `rules` — extra entries appended to the existing `rules` array in `build()`.
  Numbering is by array position already, so insertion cannot collide.
- `reuse` — where the words the partner should work in come from. `null` keeps
  today's behaviour (`S.learning.filter(isNew).slice(-6)`); `"unused"` swaps in
  `readiness().unused`.
- `gen` — the generation strategy. `"segments"` is the only new turn-loop code in A.

---

## 2. UI

Model and level are **not** symmetric. Model already has a complete Settings home —
`#modelChat`, a browse-and-star button, and a separate teaching-model picker
(`index.html:437-444`) — so the header's `#model` duplicates it. Level has no
Settings home at all. So this is delete-one, build-one.

### Header

```html
<header>
  <select id="activity" title="Activity"></select>
  <button id="levelChip" title="Vocabulary level" aria-label="Level: HSK 1, open settings">HSK 1</button>
  <button id="btnPy" title="Pinyin">拼</button>
  <button id="btnChats" title="Conversations">💬</button>
  <button id="btnVocab" title="Vocabulary">词</button>
  <button id="btnSet" title="Settings">⚙</button>
</header>
```

- **Model: deletion only.** Remove `#model`, its `onchange` (`3711`) and its fill
  (`3011`). `fillModels()` keeps populating `#modelChat`; the two-way guard at
  `3707` simplifies to one side.
- **Level: a move.** The `<select id="level">` markup moves into the Settings
  section holding script and pacing. The id does not change, so `fillLevels()`
  (`2937`), the `onchange` (`3689`) and the sync-back at `3766` keep working —
  only the parent element differs.
- **`#levelChip` displays the level and opens Settings.** Level drives everything
  the partner says; making it invisible mid-conversation was judged a real
  regression, and a chip honours the request (the *selector* is gone from the chat
  page) while keeping the fact on screen. It is a `<button>`, not a styled `<span>`
  — it navigates, so it must be focusable and announced. Its `aria-label` carries
  the level, since the visible text alone ("HSK 1") does not say what it does.

### Behaviour

- **Switching activity starts a new conversation**, silently. The previous chat is
  one tap away under 💬, so a confirm dialog would be friction on a reversible
  action.
- **The selector is disabled while `S.busy`**, the same gate `#send` has.
- **The chat list must show the activity** or mixed session types are
  indistinguishable. `renderChats()` (`4296`) builds `.cmeta` as
  `"12 messages · 3 Jan"`; it becomes `"Story time · 12 messages · 3 Jan"`.
- **Starters render for `chat` only.** `renderStarters()` (`3452`) offers openers
  for the *learner*, which is right for chat and wrong for the other two: focused
  chat should open on a word-bearing prompt and story time should not wait for the
  learner to speak.

That last point has a consequence: **`turn()` cannot currently be called without a
preceding user message.** `send()` drives every generation today. Focused chat and
story time need a partner-first opening turn. `windowed()` returns `[]` and
`saidNow` is `""` in that case — both harmless — but nothing exercises that path
today and the browser suite must.

---

## 3. The three activities

**Chat** — baseline, unchanged.

**Focused chat** — swaps the reuse list for `readiness().unused` (`index.html:3535`),
which is already computed: words the app taught the learner that they have never
once written, sorted commonest-first. Adds one rule telling the partner to *make
openings* for those words rather than use them if they happen to fit. Opens
partner-first. No topic picker: the words themselves pull the conversation
somewhere, and a hand-authored topic taxonomy per level would need maintaining and
would conflict with the word goal whenever the two disagreed.

**Story time** — the only activity needing new machinery.

### Why a story is generated in segments

Not for validation cost — that was the first justification considered and it is the
weaker one. The real reason is that **`earn()`, `CREDIT_CAP` and `SLATE` are
per-turn quantities derived from graded-reader research** (RESEARCH.md,
"Constrained input"), and a story as one long turn breaks all three.

`settlePace` (`index.html:2047`) converts a reply's Han characters into new-word
credits at `DEFAULT_RATE = 45`, capped at `CREDIT_CAP = 3` with the remainder
**discarded** (`pace.js:66`). A 600-character story should carry roughly thirteen
new words at the graded-reader rate; as one turn it gets three and throws the rest
away. The activity most entitled to graded-reader density is the one place the cap
silently removes it.

Segmenting restores it without touching a researched constant. Each segment is one
`turn()` call, so each earns its own credits and gets its own slate of three.

### Segment size

Roughly **90–135 Han characters**. Above 135 (`3 × DEFAULT_RATE`) a segment crosses
`CREDIT_CAP` and wastes the remainder; far below 45 it earns nothing. About 90
banks two credits per segment and keeps the pipeline full. Taking K = 5 segments as
the working assumption (see Open Questions — it is not measured), a story runs to
~500 characters and carries roughly ten new words.

**The exact figure must be justified in RESEARCH.md when picked**, per the trigger
tightened in CLAUDE.md on 2026-08-26.

### Two phases, and the second is free

- **Phase 1** generates K segments back to back, each through the existing `turn()`
  repair loop, each rendered as it lands, each stored as its own assistant message.
  `windowed()` then supplies segments 1–3 as context when generating segment 4, so
  coherence comes from existing machinery.
- **Phase 2** — the comprehension questions — is the existing chat loop with the
  story in context and one added prompt rule. Learner answers are graded by the
  grader that already runs on every message.

### Failure handling

`turn()` falls back to a canned line after `S.attempts`, which is survivable for a
chat turn and nonsense mid-narrative. A segment that exhausts its attempts instead
keeps its best attempt, renders with the existing `failed` marker, and generation
continues to the next segment.

### `S.replyLength` does not apply to story time

RESEARCH.md notes reply length is deliberately level-neutral so the two axes
compose. A story fixes its own segment length rather than adding a third axis to
that interaction.

---

## 4. Testing

- **`prompt.test.js`** — every activity's rule text validates against its own
  level's allowlist (the rule the existing samples and starters follow, and which
  several drafts failed); rule numbering stays gap-free with activity rules active,
  extending the test that already covers script/offer/required/reuse together; the
  three activities produce distinct prompts.
- **`sync.test.js`** — `activity` survives the row round-trip; survives
  `mergeConversations` specifically (the field-by-field trap); resolves
  `existing || incoming` rather than newest-wins; and a `NULL` activity reads back
  as `"chat"`.
- **`pace.test.js`** — the segment arithmetic: K segments of L characters earn the
  credits claimed and never cross `CREDIT_CAP` into discarded remainder.
- **`browser.test.js`** — switching activity opens a new conversation; the chat list
  shows the activity; starters render for chat only; `#levelChip` tracks Settings;
  the partner-first opening turn works with an empty history.

## 5. Release

`VERSION` in `index.html` and `CACHE` in `sw.js` move together — this is
user-visible. No new files, so `sw.js`'s `SHELL` is unchanged. A schema change ships
in `db/schema.sql` as `add column if not exists`.

---

## Deliberately out of scope

- The item/drill path (A2), and with it dictation, word rescue, tone drills and
  focused drills.
- Spaced repetition (C). `S.learning.seen` counts exposures with `PROMOTE_AT = 6`;
  that is exposure counting, not a schedule with a due date. A real addition, not a
  rename.
- Goals and the progress bar (D). `HSKPace.coverage`/`toTarget` already answer
  "what share of this text do I cover" and "how many more words to reach it" — the
  open question is a word target per goal, which is research, not code.
- The weekly report (B).
- Speaking (E).

## Open questions

- **Segment count K per story.** Five is the working assumption behind the ~500
  character figure; not measured.
- **Prompt A/B for the two new activities.** CLAUDE.md requires a real-model A/B
  with counted outcomes before a prompt edit ships, and both focused chat and story
  time are prompt edits. `tools/prompt-ab.js` is the harness. Note the in-app
  counters are keyed `S.stats[effectiveMode()]` — measuring an activity's prompt
  separately means keying them by mode *and* activity.
- **Whether focused chat and focused drills stay distinct.** Both steer at words or
  mistakes the ledger flagged. The difference may be conversation-versus-exercise,
  or may be nothing. Revisit when A2 and B exist.
