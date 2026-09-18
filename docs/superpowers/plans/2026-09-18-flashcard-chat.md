# Flashcard Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A two-step activity — press a button to get five to seven words drawn
from your own chat history and exported to Pleco or Anki, study them elsewhere,
then come back to a chat where the partner steers at exactly those words until
the ghost counter retires them.

**Architecture:** The word set is chosen by arithmetic over the learner's history
(`pace.js`, pure and node-testable), stored as pseudo-messages in the transcript
(the pattern `mistakes.js` already uses for drills, so no schema change), and
practised through the machinery Ghost Words already owns — `reuseFor()`,
`ghostRequired()`, and the per-word ghost verdict. A model call that arranges the
set thematically is the LAST task and ships only if a measurement earns it.

**Tech Stack:** No build step, no bundler, no dependencies, anywhere — including
the tests. Plain ES5-flavoured JavaScript in the extracted modules, plain node
for tests. Do not add a `package.json`.

**Spec:** `docs/superpowers/specs/2026-09-18-flashcard-chat-design.md` — read it
before Task 1. The plan argues from it and does not repeat its reasoning.

## Global Constraints

- **No dependencies, no build step, no `package.json`.** Not in the app, not in
  the tests, not in the tools.
- **Every extracted module ends with the same wrapper**, exactly:
  ```js
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKPace = api;
  ```
- **`VERSION` in `index.html` and `CACHE` in `sw.js` must move together** on every
  user-visible change. `VERSION` is at `index.html:1179` and currently reads
  `"v116 — 2026-09-18"`; `CACHE` is at `sw.js:10` and currently reads
  `"hsk-chat-v116"`. Tasks 4, 5, 6 and 8 each bump both. `test/release.test.js`
  fails if they disagree.
- **No new files under the page's load path.** Everything lands in `pace.js`,
  `prompt.js` and `index.html`, so `sw.js`'s `SHELL` array needs no edit. If you
  find yourself creating a new `.js` the page loads, stop — that is a
  deviation from the spec and it must also be added to `SHELL`.
- **Tests are plain node.** A `check(ok, label, detail)` counter, top-level
  statements, `process.exit(1)` at the end. No framework, no `describe`, no
  `it`. Copy the shape at the top of `test/pace.test.js`.
- **Run the whole suite with `sh test/run.sh`.** A single suite is
  `node test/pace.test.js`. `test/browser.test.js` needs firefox and geckodriver
  and exits 0 without them, so a green run on a bare machine does not mean the
  browser suite passed.
- **Chinese never reaches the learner unvalidated.** Every word this feature
  shows comes out of `S.base`, the level's own allowlist, so it is in-level by
  construction. Do not add a path where a model's output is displayed directly.
- **Ghost Words is not being changed.** Its pool filter
  (`index.html:6578`, `(e.from || 0) > S.level`) stays exactly as it is. Adding
  the `steer` flag to its `ACTIVITIES` row in Task 3 is the only edit it gets,
  and it is behaviour-preserving.
- **`S.ghostUses` is user-configurable.** Never hardcode 3.

---

### Task 1: The pool arithmetic

Pure functions in `pace.js` that turn a scan of the learner's history into a
ranked list of candidate words. No DOM, no clock, no network — today's date and
the scanned data come in as arguments, which is what makes them testable.

**Files:**
- Modify: `pace.js` (add constants near the top beside `DEFAULT_RATE`; add
  functions before the `var api = {` block at the end; add to `api`)
- Test: `test/pace.test.js` (append before the final `console.log`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `HSKPace.STALE_DAYS` → `30`
  - `HSKPace.SET_SIZE` → `5`
  - `HSKPace.SET_MAX` → `7`
  - `HSKPace.CANDIDATES_SHOWN` → `15`
  - `HSKPace.daysBetween(from, to)` → `Number`. Both args are `"YYYY-MM-DD"`
    day keys. Returns whole days from `from` to `to`, or `Infinity` if either is
    falsy or unparseable.
  - `HSKPace.flashcardPool(opts)` → `Array` of entry objects (the same
    `{w, p, d, f}` shape the wordlists hold), longest-useful-first, capped at
    `opts.n`.
    `opts` is `{ entries, seen, ghost, ghostUses, reserved, today, n }`:
    - `entries` — `Array` of the level's word entries, e.g. `S.base`
    - `seen` — `Object` mapping word to the `"YYYY-MM-DD"` day it last appeared
      anywhere in the history, read or written
    - `ghost` — `Object` mapping word to `{n, last}`, exactly what
      `HSKMistakes.ghostProgress()` returns
    - `ghostUses` — `Number`, `S.ghostUses`
    - `reserved` — `Set` of words locked by an in-flight set (Task 2 fills this;
      pass an empty `Set` until then)
    - `today` — `"YYYY-MM-DD"`
    - `n` — `Number`, how many candidates to return

- [ ] **Step 1: Write the failing tests**

Append to `test/pace.test.js`, immediately before the final
`console.log(\`\n${pass} passed, ${fail} failed\`);` line:

```js
// --- the flashcard pool -----------------------------------------------------
/* Fixtures rather than real data: the point of these functions is the
 * partition and the ordering, and a hand-built lexicon says what the
 * populations are supposed to be far more legibly than hsk2.json can. */
const FC = [
  { w: "苹果", p: "píngguǒ", d: "apple", f: 100 },
  { w: "医生", p: "yīshēng", d: "doctor", f: 200 },
  { w: "回答", p: "huídá", d: "answer", f: 300 },
  { w: "颜色", p: "yánsè", d: "colour", f: 400 },
  { w: "机场", p: "jīchǎng", d: "airport", f: 500 },
  { w: "从来", p: "cónglái", d: "never", f: 600 }
];
const TODAY = "2026-09-18";

check(P.daysBetween("2026-09-01", TODAY) === 17,
  "daysBetween counts whole days between two day keys",
  String(P.daysBetween("2026-09-01", TODAY)));
check(P.daysBetween("", TODAY) === Infinity,
  "a missing day key is infinitely old, never zero days old");
check(P.daysBetween(TODAY, TODAY) === 0, "the same day is zero days apart");

const fcPool = o => P.flashcardPool(Object.assign(
  { entries: FC, seen: {}, ghost: {}, ghostUses: 3,
    reserved: new Set(), today: TODAY, n: 10 }, o));

// Read but never written: seen in the history, never produced correctly.
check(fcPool({ seen: { "苹果": TODAY } }).map(e => e.w).join() === "苹果",
  "a word read today and never written is a candidate",
  fcPool({ seen: { "苹果": TODAY } }).map(e => e.w).join());
check(fcPool({ seen: {} }).length === 0,
  "a word never seen at all is not a candidate");

// Lapsed: produced before, but not recently.
check(fcPool({ seen: { "苹果": "2026-09-17" }, ghost: { "苹果": { n: 1 } } }).length === 0,
  "a word produced and seen yesterday is neither population");
check(fcPool({ seen: { "苹果": "2026-01-01" }, ghost: { "苹果": { n: 1 } } })
        .map(e => e.w).join() === "苹果",
  "a word produced once and unseen for months is lapsed");
check(fcPool({ seen: { "苹果": "2026-01-01" }, ghost: { "苹果": { n: 3 } } }).length === 0,
  "a word already owned is excluded however stale it is");
check(fcPool({ seen: { "苹果": "2026-01-01" }, ghost: { "苹果": { n: 3 } }, ghostUses: 6 })
        .map(e => e.w).join() === "苹果",
  "and ownership is judged against ghostUses, not a hardcoded 3");

/* The ordering the learner asked for: read-but-never-written first, lapsed
 * only as backfill. 医生 is commoner than 回答 and still comes second, which
 * is the whole point -- the populations do not interleave by frequency. */
const ordered = fcPool({
  seen: { "回答": TODAY, "颜色": TODAY, "医生": "2026-01-01", "机场": "2026-01-01" },
  ghost: { "医生": { n: 1 }, "机场": { n: 2 } }
});
check(ordered.map(e => e.w).join() === "回答,颜色,医生,机场",
  "read-never-written comes first, lapsed backfills, each commonest-first",
  ordered.map(e => e.w).join());

check(fcPool({ seen: { "回答": TODAY, "颜色": TODAY }, n: 1 })
        .map(e => e.w).join() === "回答",
  "n caps the list");
check(fcPool({ seen: { "回答": TODAY, "颜色": TODAY },
               reserved: new Set(["回答"]) }).map(e => e.w).join() === "颜色",
  "a reserved word is never offered");
check(P.flashcardPool({}).length === 0,
  "an empty options object yields an empty pool rather than throwing");
check(P.flashcardPool({ entries: FC, today: TODAY }).length === 0,
  "and a learner with no history gets no candidates");

/* Unranked words weigh nothing in the coverage arithmetic and sort last in
 * buildPool(); the same must hold here or the commonest-first promise is
 * broken by a word the corpus never saw. */
/* `unrankedPool`, not `unranked`: test/pace.test.js:155 already declares a
   top-level `const unranked` for toTarget()'s fixtures, and a second one in the
   same module scope is a SyntaxError. */
const unrankedPool = P.flashcardPool({
  entries: FC.concat([{ w: "叉子", p: "chāzi", d: "fork" }]),
  seen: { "叉子": TODAY, "从来": TODAY }, ghost: {}, ghostUses: 3,
  reserved: new Set(), today: TODAY, n: 10
});
check(unrankedPool.map(e => e.w).join() === "从来,叉子",
  "an unranked word sorts after every ranked one",
  unrankedPool.map(e => e.w).join());
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/pace.test.js`

Expected: FAIL. The first failure will be a `TypeError` —
`P.daysBetween is not a function`.

- [ ] **Step 3: Add the constants**

In `pace.js`, immediately after the existing `var FORCE_AFTER = 2;` line:

```js
  /* ------------------------------------------------------- flashcard sets
   *
   * A set of words to study away from the app and then produce in chat. The
   * constants are argued in RESEARCH.md, "Choosing a set of words to study
   * away from the app"; the two day counts are guesses and that section says
   * so. */
  var SET_SIZE = 5;            // Nation's word-card guidance is 5-7 per set
  var SET_MAX = 7;             // ...and this is the top of that range
  var STALE_DAYS = 30;         // unseen this long and a word counts as lapsed
  var RESERVE_DAYS = 30;       // a set untouched this long stops reserving
  var CANDIDATES_SHOWN = 15;   // how many the chooser picks from
```

- [ ] **Step 4: Add `daysBetween` and `flashcardPool`**

In `pace.js`, immediately before the `var api = {` block:

```js
  /* Whole days between two "YYYY-MM-DD" keys.
   *
   * A missing or unparseable key is Infinity, never 0. The callers all ask
   * "is this older than N", and answering 0 for a word with no recorded
   * sighting would say the freshest possible thing about the least evidence.
   *
   * UTC, like every other day key in this app: two devices in two timezones
   * have to agree, and mistakes.js records why a flight must not move a
   * learner's numbers. */
  function daysBetween(from, to) {
    var a = Date.parse(String(from || "") + "T00:00:00Z");
    var b = Date.parse(String(to || "") + "T00:00:00Z");
    if (isNaN(a) || isNaN(b)) return Infinity;
    return Math.round((b - a) / 86400000);
  }

  /* Candidate words for a flashcard set, best first.
   *
   * Two populations, in this order, and they do not interleave:
   *
   *   1. read but never written -- the partner has used it to you and you have
   *      never produced it. The reported complaint, directly.
   *   2. lapsed -- you produced it once and have not met it in STALE_DAYS.
   *      Backfill, so a learner whose partner has taught them everything still
   *      gets a full set.
   *
   * Both exclude words already owned (ghostN >= ghostUses, the one place a
   * production threshold is allowed to live) and words reserved by a set still
   * in flight. Each population is ordered commonest-first by the level list's
   * own `f`, with unranked words last -- unranked means the corpus never saw
   * them, which is exactly where they belong.
   *
   * Pure by construction, like retrieval.js: the history scan, the ghost map,
   * the reservations and today's date all arrive as arguments. */
  function flashcardPool(opts) {
    var o = opts || {};
    var seen = o.seen || {}, ghost = o.ghost || {};
    var uses = o.ghostUses || 3;
    var reserved = o.reserved instanceof Set ? o.reserved : new Set(o.reserved || []);
    var fresh = [], lapsed = [];
    (o.entries || []).forEach(function (e) {
      if (!e || !e.w) return;
      var day = seen[e.w];
      if (!day) return;                                  // never met at all
      if (reserved.has(e.w)) return;
      var n = (ghost[e.w] && ghost[e.w].n) || 0;
      if (n >= uses) return;                             // already yours
      if (n === 0) fresh.push(e);
      else if (daysBetween(day, o.today) >= STALE_DAYS) lapsed.push(e);
    });
    var byRank = function (a, b) {
      return ((a.f || UNRANKED) - (b.f || UNRANKED)) || a.w.localeCompare(b.w);
    };
    fresh.sort(byRank);
    lapsed.sort(byRank);
    return fresh.concat(lapsed).slice(0, o.n || CANDIDATES_SHOWN);
  }
```

Note `UNRANKED` is already declared in `pace.js` (`var UNRANKED = 999999;`) above
`weightOf()`. Both new functions sit below it, so it is in scope. Do not
re-declare it.

- [ ] **Step 5: Export them**

In `pace.js`, extend the `var api = {` literal. Add this line immediately after
the existing `FORCE_AFTER: FORCE_AFTER, shouldForce: shouldForce,` line:

```js
    SET_SIZE: SET_SIZE, SET_MAX: SET_MAX, STALE_DAYS: STALE_DAYS,
    RESERVE_DAYS: RESERVE_DAYS, CANDIDATES_SHOWN: CANDIDATES_SHOWN,
    daysBetween: daysBetween, flashcardPool: flashcardPool,
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node test/pace.test.js`

Expected: PASS, with the count risen by 15 from its previous value.

- [ ] **Step 7: Run the whole suite**

Run: `sh test/run.sh`

Expected: every suite passes. `pace.js` is loaded by `index.html` and by several
other suites, so a syntax error here fails far more than `pace.test.js`.

- [ ] **Step 8: Commit**

```bash
git add pace.js test/pace.test.js
git commit -m "feat: flashcard candidate pool arithmetic"
```

---

### Task 2: Reservation, so two sets never share a word

The learner named this: a second Flashcard Chat started while a first is
unfinished must not hand back words the first is still working on.

**Files:**
- Modify: `pace.js` (add functions beside `flashcardPool`; add to `api`)
- Test: `test/pace.test.js` (append before the final `console.log`)

**Interfaces:**
- Consumes: `HSKPace.daysBetween` and `HSKPace.RESERVE_DAYS` from Task 1.
- Produces:
  - `HSKPace.setRounds(words, ghost)` → `Number`. The minimum `ghostN` across
    `words`, which is how many complete rounds the set has banked. `0` for an
    empty or missing list.
  - `HSKPace.reservedWords(opts)` → `Set` of words.
    `opts` is `{ sets, ghost, ghostUses, today }`, where `sets` is an
    `Array` of `{ words, updated }` — `words` an `Array` of strings, `updated`
    the conversation's `updated_at` (an ISO timestamp or a `"YYYY-MM-DD"` key;
    only the first ten characters are read).

- [ ] **Step 1: Write the failing tests**

Append to `test/pace.test.js`, before the final `console.log`:

```js
// --- reservation ------------------------------------------------------------
check(P.setRounds(["苹果", "医生"], { "苹果": { n: 2 }, "医生": { n: 1 } }) === 1,
  "a set has banked as many rounds as its WEAKEST word",
  String(P.setRounds(["苹果", "医生"], { "苹果": { n: 2 }, "医生": { n: 1 } })));
check(P.setRounds(["苹果", "医生"], { "苹果": { n: 2 } }) === 0,
  "a word with no credits at all pins the set at zero");
check(P.setRounds([], {}) === 0, "an empty set has banked nothing");
check(P.setRounds(null, null) === 0, "and a missing set does not throw");

const res = o => P.reservedWords(Object.assign(
  { sets: [], ghost: {}, ghostUses: 3, today: TODAY }, o));

check(res({ sets: [{ words: ["苹果", "医生"], updated: TODAY }] }).has("苹果"),
  "an unfinished set started today reserves its words");
check(res({ sets: [{ words: ["苹果"], updated: TODAY }],
            ghost: { "苹果": { n: 3 } } }).size === 0,
  "a finished set reserves nothing");
check(res({ sets: [{ words: ["苹果"], updated: TODAY }],
            ghost: { "苹果": { n: 3 } }, ghostUses: 6 }).has("苹果"),
  "and finished is judged against ghostUses, not a hardcoded 3");
check(res({ sets: [{ words: ["苹果"], updated: "2026-01-01" }] }).size === 0,
  "a set abandoned past RESERVE_DAYS releases its words");
check(res({ sets: [{ words: ["苹果"], updated: "2026-09-18T11:00:00.000Z" }] }).has("苹果"),
  "an ISO timestamp works as well as a day key");
check(res({ sets: [{ words: ["苹果"], updated: TODAY },
                    { words: ["医生"], updated: TODAY }] }).size === 2,
  "several in-flight sets all reserve");
check(P.reservedWords({}).size === 0,
  "no sets at all reserves nothing and does not throw");

/* The two halves together: a word locked by an in-flight set must not come
 * back as a candidate for the next one. This is the learner's stated
 * requirement and it is the only place the two functions meet. */
const locked = P.reservedWords({
  sets: [{ words: ["回答"], updated: TODAY }], ghost: {}, ghostUses: 3, today: TODAY });
check(P.flashcardPool({ entries: FC, seen: { "回答": TODAY, "颜色": TODAY },
                        ghost: {}, ghostUses: 3, reserved: locked,
                        today: TODAY, n: 10 }).map(e => e.w).join() === "颜色",
  "a second set cannot repeat a word the first is still working on");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/pace.test.js`

Expected: FAIL with `P.setRounds is not a function`.

- [ ] **Step 3: Write the implementation**

In `pace.js`, immediately after `flashcardPool`:

```js
  /* How many complete rounds a set has banked: the minimum ghostN across its
   * words. A round is "every word in the set used correctly once", so the
   * weakest word is the set's progress -- and because the ghost counter takes
   * at most one credit per word per day, a round cannot close in under a day.
   *
   * Also the finished test, which is why this is one function and not two. */
  function setRounds(words, ghost) {
    var list = words || [], g = ghost || {};
    if (!list.length) return 0;
    var min = Infinity;
    list.forEach(function (w) {
      var n = (g[w] && g[w].n) || 0;
      if (n < min) min = n;
    });
    return min === Infinity ? 0 : min;
  }

  /* Words locked by a set that is still in flight, and therefore off limits to
   * the next set.
   *
   * Finished sets need no rule: their words sit at ghostN >= ghostUses, which
   * flashcardPool() already excludes as owned.
   *
   * The quiet period is the escape hatch, and without it the first set the
   * learner starts and never returns to would lock five words away for good.
   * A date comparison rather than an "abandon this set" button: nothing to
   * build, nothing to explain, and it heals itself. */
  function reservedWords(opts) {
    var o = opts || {}, out = new Set();
    (o.sets || []).forEach(function (s) {
      if (!s || !(s.words || []).length) return;
      if (setRounds(s.words, o.ghost) >= (o.ghostUses || 3)) return;   // finished
      if (daysBetween(String(s.updated || "").slice(0, 10), o.today) >= RESERVE_DAYS) return;
      s.words.forEach(function (w) { if (w) out.add(w); });
    });
    return out;
  }
```

- [ ] **Step 4: Export them**

In `pace.js`, extend the line added in Task 1 Step 5 so it reads:

```js
    daysBetween: daysBetween, flashcardPool: flashcardPool,
    setRounds: setRounds, reservedWords: reservedWords,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node test/pace.test.js`

Expected: PASS, 11 more checks than Task 1 left it at.

- [ ] **Step 6: Run the whole suite**

Run: `sh test/run.sh`

Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add pace.js test/pace.test.js
git commit -m "feat: reserve words held by an unfinished flashcard set"
```

---

### Task 3: The activity row, the marker readers, and the `steer` flag

The `ACTIVITIES` table entry that makes Flashcard Chat a conversation config,
the two functions that read the set back out of a transcript, and a small
behaviour-preserving refactor that lets an activity declare "the partner must
use a word from my reuse list" on its own row instead of `index.html` naming
Ghost Words twice.

**Files:**
- Modify: `prompt.js:343-411` (the `ACTIVITIES` literal)
- Modify: `pace.js` (add two marker readers beside `setRounds`; add to `api`)
- Test: `test/prompt.test.js` (append before its final summary line)
- Test: `test/pace.test.js` (append before the final `console.log`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `HSKPrompt.ACTIVITIES.flashcard` — a row with `label: "Flashcard Chat"`,
    `newWords: false`, `converse: true`, `reuse: "chosen"`, `steer: true`,
    `gen: "turn"`.
  - `HSKPrompt.ACTIVITIES.focused.steer` → `true` (added; Ghost Words behaves
    identically, the flag just states what `index.html` already hardcoded).
  - `HSKPace.flashcardsOf(msgs)` → `Array` of word strings, `[]` when the
    transcript holds no set. `msgs` is an array of message objects with `role`
    and `text`.
  - `HSKPace.flashcardThemeOf(msgs)` → `String`, `""` when absent.
  - `HSKPace.SET_SEP` → `","`

- [ ] **Step 1: Write the failing tests**

Append to `test/pace.test.js`, before the final `console.log`:

```js
// --- reading a set back out of a transcript ---------------------------------
const setMsgs = [
  { role: "flashcards", text: "苹果,医生,回答" },
  { role: "flashcardTheme", text: "a visit to the doctor" },
  { role: "user", text: "我去医院" }
];
check(P.flashcardsOf(setMsgs).join() === "苹果,医生,回答",
  "the chosen set is read back out of the transcript",
  P.flashcardsOf(setMsgs).join());
check(P.flashcardThemeOf(setMsgs) === "a visit to the doctor",
  "and so is the theme");
check(P.flashcardsOf([{ role: "user", text: "你好" }]).length === 0,
  "an ordinary chat holds no set");
check(P.flashcardThemeOf([]) === "" && P.flashcardsOf([]).length === 0,
  "an empty transcript yields an empty set and an empty theme");
check(P.flashcardsOf(null).length === 0, "and a missing transcript does not throw");
check(P.flashcardsOf([{ role: "flashcards", text: "" }]).length === 0,
  "an empty marker is an empty set, not a set containing one empty string");
check(P.flashcardsOf([{ role: "flashcards", text: "苹果, 医生 " }]).join() === "苹果,医生",
  "stray whitespace around a word is trimmed",
  P.flashcardsOf([{ role: "flashcards", text: "苹果, 医生 " }]).join());
```

Append to `test/prompt.test.js`, before its final summary line (find the
`console.log` that prints the pass/fail counts and insert above it):

```js
// --- Flashcard Chat ---------------------------------------------------------
const fcRow = P.ACTIVITIES.flashcard;
check(!!fcRow, "Flashcard Chat is a row in the ACTIVITIES table");
check(fcRow && fcRow.label === "Flashcard Chat", "and it is labelled for the menu");
check(fcRow && fcRow.newWords === false,
  "it introduces no new words, as Ghost Words and Drills do not");
check(fcRow && fcRow.reuse === "chosen",
  "its reuse list is the set the learner chose, not the unused list");
check(fcRow && fcRow.steer === true,
  "and it declares that the partner must work at a word from that list");
check(P.ACTIVITIES.focused.steer === true,
  "Ghost Words declares the same thing on its own row rather than in index.html");
check(P.ACTIVITIES.chat.steer !== true && P.ACTIVITIES.story.steer !== true,
  "ordinary chat and story time do not steer");
check(P.activityFor("flashcard") === fcRow,
  "activityFor resolves it by id");
check(typeof (fcRow && fcRow.note) === "string" && fcRow.note.length > 0,
  "and it explains itself in the activity note");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node test/pace.test.js && node test/prompt.test.js`

Expected: `pace.test.js` fails with `P.flashcardsOf is not a function`.

- [ ] **Step 3: Add the marker readers to `pace.js`**

Immediately after `reservedWords` in `pace.js`:

```js
  /* The set lives in the transcript as pseudo-messages, the way a drill's
   * category and example do (mistakes.js drillTagOf/drillExampleOf). That is
   * what makes it need no column: messages.role and messages.text already
   * sync, so there is no db/schema.sql change and no optional-column probe.
   *
   * Two markers rather than two fields on one, for the reason mistakes.js
   * gives: messages.text is the only string column that syncs, and packing two
   * values into it would need a delimiter to decode -- which is exactly the
   * problem SET_SEP solves for the word list and should not be solved twice.
   *
   * SET_SEP is the ASCII comma, which no Chinese word contains: the Chinese
   * comma is a different character (U+FF0C). */
  var SET_SEP = ",";

  function markerText(msgs, role) {
    for (var i = 0; i < (msgs || []).length; i++) {
      if (msgs[i] && msgs[i].role === role) return msgs[i].text || "";
    }
    return "";
  }

  function flashcardsOf(msgs) {
    return markerText(msgs, "flashcards").split(SET_SEP)
      .map(function (w) { return w.trim(); })
      .filter(function (w) { return w.length > 0; });
  }

  function flashcardThemeOf(msgs) { return markerText(msgs, "flashcardTheme"); }
```

Extend the `api` literal line from Task 2 Step 4 to read:

```js
    daysBetween: daysBetween, flashcardPool: flashcardPool,
    setRounds: setRounds, reservedWords: reservedWords,
    SET_SEP: SET_SEP, flashcardsOf: flashcardsOf,
    flashcardThemeOf: flashcardThemeOf,
```

- [ ] **Step 4: Add the activity row to `prompt.js`**

In the `ACTIVITIES` literal, add `steer: true,` to the `focused` row —
immediately after its `newWords: false,` line — and add this new row
immediately after the closing brace of the `focused` row, before `drill:`:

```js
    flashcard: {
      label: "Flashcard Chat",
      /* Two steps. The learner presses a button, gets five to seven words out
       * of their own history, and studies them in Pleco or Anki; then they
       * come back and this rule makes the partner build a conversation those
       * words are the natural answer to.
       *
       * The instruction is Ghost Words' -- the same job, a different pool --
       * and deliberately the same words, because that string is what the
       * ghost-grammar A/B was run against. A paraphrase here would be an
       * unmeasured prompt change for no reason. */
      rules: [
        "学生刚刚用卡片学了下面这些词，现在要练习自己说出来。" +
        "请你带着话题往这些词的方向走，问一些必须用到这些词才好回答的问题，" +
        "让学生自己说出来。如果学生没有用这些词，继续问，直到他们用到。"
      ],
      names: null,
      reuse: "chosen",
      gen: "turn",
      converse: true,
      /* Practice of what the learner has just studied. A word they have never
       * seen is a second thing to get wrong in a sentence that is already
       * hard -- the same reasoning as Ghost Words above. */
      newWords: false,
      /* The partner does not merely prefer these words, it is required to work
       * at one. Declared here rather than branched on in turn() and
       * gradeTurn(), which is why Ghost Words now says it too. */
      steer: true,
      note: "Flashcard Chat: get five words from your own history, study them " +
        "in Pleco or Anki, then come back and use them in conversation."
    },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node test/pace.test.js && node test/prompt.test.js`

Expected: both PASS.

- [ ] **Step 6: Run the whole suite**

Run: `sh test/run.sh`

Expected: all pass. `test/prompt.test.js` asserts properties of the whole
`ACTIVITIES` table in places, so a malformed row shows up there first.

- [ ] **Step 7: Commit**

```bash
git add pace.js prompt.js test/pace.test.js test/prompt.test.js
git commit -m "feat: Flashcard Chat activity row and set markers"
```

---

### Task 4: Wiring the activity into the app

Everything `index.html` needs for the activity to exist, be selectable, store a
set and steer the partner at it. No chooser UI yet — that is Task 5 — so after
this task selecting Flashcard Chat gives an empty conversation with a disabled
composer. That is the correct intermediate state and it is what Step 8 verifies.

**Files:**
- Modify: `index.html:2586-2587` (`MARKER_ROLES`)
- Modify: `index.html:2162-2184` (`reuseFor`)
- Modify: `index.html:2216`, `2241` (`turn()`'s `isFocused` / `required`)
- Modify: `index.html:3883-3884` (`gradeTurn`'s `ghosting` / `ghostTargets`)
- Modify: `index.html:3088-3094` (`activityOf`)
- Modify: `index.html:3163` (`startActivity`)
- Modify: `index.html:6033-6037` (`renderComposer`)
- Modify: `index.html:1179` (`VERSION`) and `sw.js:10` (`CACHE`)
- Modify: `index.html` — add the new functions listed below near
  `readiness()` (around line 6600), after `ghostProgressMap()`

**Interfaces:**
- Consumes: `HSKPace.flashcardsOf`, `HSKPace.flashcardThemeOf`,
  `HSKPace.flashcardPool`, `HSKPace.reservedWords`, `HSKPace.setRounds`,
  `HSKPace.CANDIDATES_SHOWN`, `HSKPrompt.ACTIVITIES.flashcard` (Tasks 1–3).
- Produces (all in `index.html`, all callable from the browser console, which is
  how Task 5 and Task 6 and `browser.test.js` reach them):
  - `flashcardWords()` → `Array<string>` — this conversation's set
  - `flashcardTheme()` → `String`
  - `flashcardRounds()` → `Number` — complete rounds banked by this set
  - `flashcardDone()` → `Boolean` — `flashcardRounds() >= S.ghostUses`
  - `lastSeenMap()` → `Object` mapping word to `"YYYY-MM-DD"`
  - `inFlightSets()` → `Array<{words, updated}>`
  - `flashcardCandidates()` → `Array` of entries from `S.base`
  - `flashcardTargets()` → `Array<{w, p, d, ghostN, ghostToday}>`
  - `startFlashcardsWith(words, theme)` → `undefined`

- [ ] **Step 1: Add the state functions**

In `index.html`, immediately after `ghostProgressMap()` (it ends around line
6459 with `}`), insert:

```js
/* ------------------------------------------------------- Flashcard Chat */

/* This conversation's chosen set, and the theme the chooser named it. Read out
 * of the transcript markers, so a set survives a reload and syncs with the
 * conversation without a column of its own. */
function flashcardWords() { return HSKPace.flashcardsOf(S.history); }
function flashcardTheme() { return HSKPace.flashcardThemeOf(S.history); }
function flashcardRounds() { return HSKPace.setRounds(flashcardWords(), ghostProgressMap()); }
function flashcardDone() { return flashcardRounds() >= S.ghostUses; }

/* The last UTC day each word appeared anywhere in the history, in either
 * direction. Read counts as well as written: the first of the two populations
 * flashcardPool() builds is "the partner used this at me and I have never used
 * it back", which cannot be seen from the learner's messages alone.
 *
 * ponytail: segments every message in every conversation on each call, which is
 * strictly more work than ghostProgressMap()'s user-only scan. Called once when
 * the chooser button is pressed, never in a render loop. Cache it behind the
 * same guard as mistakeCounts() if a long history ever makes the button feel
 * slow. */
function lastSeenMap() {
  const out = {};
  Object.keys(S.chatMsgs || {}).forEach(function (cid) {
    (S.chatMsgs[cid] || []).forEach(function (t) {
      if (!t || !t.text) return;
      if (t.role !== "user" && t.role !== "assistant") return;   // skip markers
      const day = String(t.created_at || "").slice(0, 10);
      if (!day) return;
      HSK.segment(t.text, S.lex).forEach(function (tok) {
        if (tok.kind !== "word") return;
        if (!out[tok.text] || out[tok.text] < day) out[tok.text] = day;
      });
    });
  });
  return out;
}

/* Every Flashcard Chat's set, with the conversation's own updated_at so
 * reservedWords() can tell an active set from an abandoned one. */
function inFlightSets() {
  const out = [];
  (S.chats || []).forEach(function (c) {
    if (!c || c.deleted) return;
    const words = HSKPace.flashcardsOf(S.chatMsgs[c.id] || []);
    if (words.length) out.push({ words: words, updated: c.updated_at });
  });
  return out;
}

/* Candidates for a NEW set: the pool arithmetic over live state, with every
 * word an unfinished set is still working on held back. */
function flashcardCandidates() {
  const today = HSKMistakes.dayKey(new Date().toISOString());
  const ghost = ghostProgressMap();
  return HSKPace.flashcardPool({
    entries: S.base, seen: lastSeenMap(), ghost: ghost, ghostUses: S.ghostUses,
    reserved: HSKPace.reservedWords({ sets: inFlightSets(), ghost: ghost,
                                      ghostUses: S.ghostUses, today: today }),
    today: today, n: HSKPace.CANDIDATES_SHOWN
  });
}

/* The stored set as the shape reuseFor() hands out everywhere else: the word,
 * its pinyin and gloss for the banner, its ghost count, and whether today's
 * credit is already banked. Same fields readiness().unused carries, so the
 * banner, the partner targeting and gradeTurn()'s per-word verdict all read one
 * shape whichever activity produced it. */
function flashcardTargets() {
  const prog = ghostProgressMap();
  const today = HSKMistakes.dayKey(new Date().toISOString());
  const byWord = new Map(S.base.map(e => [e.w, e]));
  return flashcardWords().map(function (w) {
    const e = byWord.get(w) || { w: w };
    return { w: w, p: e.p, d: e.d,
             ghostN: (prog[w] && prog[w].n) || 0,
             ghostToday: !!(prog[w] && prog[w].last === today) };
  });
}

/* Choosing the set is what starts the chat. The markers go in the transcript,
 * then the partner opens -- the same withholding story time, 20 Questions and
 * drills all use: nothing is generated, and nothing is spent, until the learner
 * has chosen. */
function startFlashcardsWith(words, theme) {
  if (!words || !words.length || flashcardWords().length) return;
  const at = new Date().toISOString();
  S.history.push({ role: "flashcards", text: words.join(HSKPace.SET_SEP),
                   id: newMessageId(), created_at: at });
  if (theme) S.history.push({ role: "flashcardTheme", text: theme,
                              id: newMessageId(), created_at: at });
  persist();
  renderAll();
  renderStarters();
  openingTurn();
}
```

- [ ] **Step 2: Teach the existing readers about the new markers**

Four edits, each one line.

`index.html:2586-2587`, `MARKER_ROLES` — add the two new roles:

```js
const MARKER_ROLES = new Set(["topic", "drill", "drillEg", "drillWord",
                              "drillTip", "drillEnd",
                              "flashcards", "flashcardTheme"]);
```

`index.html:3088-3094`, `activityOf` — infer the activity from the marker, the
way story and drill already do. Add one line after the `drillTagOf` line:

```js
  if (HSKMistakes.drillTagOf(msgs)) return "drill";
  if (HSKPace.flashcardsOf(msgs).length) return "flashcard";
```

`index.html:3163`, `startActivity` — do not open with the partner speaking,
because there is nothing to speak about until a set exists:

```js
  if (act.gen !== "segments" && id !== "chat" && id !== "twenty" &&
      id !== "drill" && id !== "flashcard") openingTurn();
```

`index.html:6033-6037`, `renderComposer` — the composer is disabled until a set
is chosen, exactly as a drill's is until a category is:

```js
    (currentActivity() === "drill" && (!drillTag() || drillDone())) ||
    (currentActivity() === "flashcard" && !flashcardWords().length);
```

- [ ] **Step 3: Point `reuseFor` at the chosen set**

`index.html:2162`. The function currently opens with a single `if`. Add the new
branch immediately before it, so the whole head of the function reads:

```js
function reuseFor(activity) {
  /* Flashcard Chat's list is the set the learner chose and studied, read
   * straight out of the transcript -- not a ranking over anything, which is
   * what makes it stable for the whole conversation. */
  if (HSKPrompt.activityFor(activity).reuse === "chosen") return flashcardTargets();
  if (HSKPrompt.activityFor(activity).reuse === "unused") {
```

Everything below is unchanged.

- [ ] **Step 4: Make `turn()` and `gradeTurn()` read the `steer` flag**

`index.html:2216` — replace the `isFocused` line:

```js
  const steers = HSKPrompt.activityFor(currentActivity()).steer === true;
```

`index.html:2241` — replace the `required` assignment. The comment above it
should change with it:

```js
  // After enough declined offers the top word becomes a condition of the reply.
  // In a steering activity -- Ghost Words, Flashcard Chat -- "required" is the
  // first target that can still earn a credit today, which each row declares
  // with `steer: true` rather than being named here.
  const required = steers ? ghostRequired(reuse) :
    (offer.length && HSKPace.shouldForce(b.declines)) ? offer[0].w : "";
```

Check for any other use of `isFocused` in `turn()` with
`grep -n "isFocused" index.html` and replace each with `steers`. There should be
exactly the two occurrences above.

`index.html:3883-3884` — replace the `ghosting` and `ghostTargets` lines so the
per-word verdict follows the same flag:

```js
    const ghosting = HSKPrompt.activityFor(currentActivity()).steer === true;
    const ghostTargets = ghosting ? reuseFor(currentActivity()).map(e => e.w) : [];
```

This is the line `reuseFor`'s own comment warns about: a word that falls out of
this list stops getting its own per-word verdict and falls back to the
whole-sentence gate, so one mistake anywhere costs the credit. Do not add
filtering or reordering here.

- [ ] **Step 5: Bump the version**

`index.html:1179`:

```js
const VERSION   = "v117 — 2026-09-18";
```

`sw.js:10`:

```js
const CACHE = "hsk-chat-v117";
```

- [ ] **Step 6: Run the whole suite**

Run: `sh test/run.sh`

Expected: all pass. `test/release.test.js` is the one that checks `VERSION` and
`CACHE` agree, and `test/browser.test.js` boots the real page — a syntax error
in `index.html` fails there and nowhere else.

- [ ] **Step 7: Verify by hand in the browser**

Open `index.html` (or the local preview the repo normally uses). In the console:

```js
startActivity("flashcard");
currentActivity();          // "flashcard"
flashcardWords();           // []
document.querySelector("#input").disabled;   // true
startFlashcardsWith(["苹果", "医生"], "at the doctor");
currentActivity();          // still "flashcard" -- now inferred from the marker
flashcardWords();           // ["苹果", "医生"]
flashcardRounds();          // 0
reuseFor("flashcard").map(e => e.w);   // ["苹果", "医生"]
```

Expected: the values in the comments. The partner should also generate an
opening turn after `startFlashcardsWith`, and the two marker messages must NOT
appear as bubbles in the log.

- [ ] **Step 8: Commit**

```bash
git add index.html sw.js
git commit -m "feat: wire Flashcard Chat into the app state"
```

---

### Task 5: The chooser, and exporting the set

Phase 1. The learner opens Flashcard Chat and gets a button; pressing it picks
the top `SET_SIZE` candidates by arithmetic and offers them for export. The model
call that arranges them thematically is Task 8 and is not needed for this to be
a complete, usable feature.

**Files:**
- Modify: `index.html:4063-4084` (`cardWords`, `ankiCsv`, `plecoTsv`)
- Modify: `index.html:6945-6955` (`exportCards` and the two button handlers)
- Modify: `index.html:6291-6293` (`renderStarters`'s activity dispatch)
- Modify: `index.html` — add `renderFlashcardControl` beside
  `renderDrillControl` (around line 6250)
- Modify: `index.html:1179` (`VERSION`) and `sw.js:10` (`CACHE`)

**Interfaces:**
- Consumes: `flashcardCandidates()`, `flashcardWords()`, `startFlashcardsWith()`,
  `flashcardTargets()` from Task 4; `HSKPace.SET_SIZE` from Task 1.
- Produces:
  - `renderFlashcardControl(box)` → `undefined`. Called by `renderStarters()`
    with the starters strip element.
  - `ankiCsv(words)` / `plecoTsv(words)` — now take an optional array of entry
    objects and fall back to `cardWords()` when it is omitted, so every existing
    caller is unchanged.
  - `exportCards(kind, words)` — same, `words` optional.

- [ ] **Step 1: Parameterise the two export builders**

`index.html:4068-4084`. Replace the three functions with:

```js
// Words the app introduced are exactly the ones worth drilling, so they go on
// cards alongside the ones you added yourself. Flashcard Chat passes its own
// chosen set instead -- same file formats, a different five words.
function cardWords() {
  return S.extra.concat(S.learning);
}

function ankiCsv(words) {
  const q = t => '"' + String(t || "").replace(/"/g, '""') + '"';
  return "#separator:comma\n#html:true\n" + (words || cardWords()).map(e =>
    q(e.w) + "," + q([e.p, e.d, e.s].filter(Boolean).join("<br>"))).join("\n") + "\n";
}

// Pleco's flashcard import format: headword, pinyin, definition, tab separated.
function plecoTsv(words) {
  const clean = t => String(t || "").replace(/[\t\r\n]+/g, " ");
  return (words || cardWords()).map(e =>
    [clean(e.w), clean(e.p), clean([e.d, e.s].filter(Boolean).join(" // "))].join("\t")).join("\n") + "\n";
}
```

- [ ] **Step 2: Let `exportCards` take a word list**

`index.html:6945-6955`. Replace the function and the two handlers with:

```js
function exportCards(kind, words) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === "anki") deliver(ankiCsv(words), "hsk-chat-" + stamp + ".csv", $("#expAnki"));
  else deliver(plecoTsv(words), "hsk-chat-" + stamp + ".txt", $("#expPleco"));
}
$("#expAnki").onclick = () => exportCards("anki");
$("#expPleco").onclick = () => exportCards("pleco");
```

Keep the existing line that computes `stamp` if it differs from the above —
the only change this step requires is the new `words` parameter being threaded
through to `ankiCsv` and `plecoTsv`.

- [ ] **Step 3: Write the chooser**

In `index.html`, immediately after `renderDrillControl` ends (around line 6252),
insert:

```js
/* Phase 1. No set yet, so no chat: a button, and what pressing it will do.
 *
 * A button rather than firing on open, which the learner chose: the whole point
 * of the activity is that the list is one you asked for. Hulstijn & Laufer's
 * learner-imposed need, and RESEARCH.md's Self-Determination note, both in
 * "Choosing a set of words to study away from the app".
 *
 * Nothing here can show an out-of-level word: every candidate came out of
 * S.base, which is the level's own allowlist. */
function renderFlashcardControl(box) {
  if (S.busy) return;
  if (flashcardWords().length) return renderFlashcardSetControl(box);

  const candidates = flashcardCandidates();
  const note = document.createElement("div");
  note.className = "note";
  if (!candidates.length) {
    note.textContent = "No words to study yet. Chat for a while — this list is " +
      "built from words the partner has used with you, and words you have not " +
      "met in a month.";
    box.appendChild(note);
    return;
  }
  note.textContent = "Get " + HSKPace.SET_SIZE + " words from your own history, " +
    "study them in Pleco or Anki, then come back and use them here.";
  box.appendChild(note);

  const go = document.createElement("button");
  go.className = "story";
  go.textContent = "Choose " + HSKPace.SET_SIZE + " words";
  go.onclick = () => startFlashcardsWith(
    candidates.slice(0, HSKPace.SET_SIZE).map(e => e.w), "");
  box.appendChild(go);
}

/* Phase 1's other half: the set is chosen, so offer it for export. Stays on the
 * strip for the whole conversation -- "what were my five words again" is a
 * question the learner will have on day two and day three, by which time the
 * chooser's message has scrolled away. */
function renderFlashcardSetControl(box) {
  const targets = flashcardTargets();
  const note = document.createElement("div");
  note.className = "note";
  const theme = flashcardTheme();
  note.textContent = (theme ? theme + " — " : "") +
    targets.map(e => e.w).join("、");
  box.appendChild(note);

  const anki = document.createElement("button");
  anki.textContent = "Export for Anki";
  anki.onclick = () => exportCards("anki", targets);
  box.appendChild(anki);

  const pleco = document.createElement("button");
  pleco.textContent = "Export for Pleco";
  pleco.onclick = () => exportCards("pleco", targets);
  box.appendChild(pleco);
}
```

- [ ] **Step 4: Dispatch to it**

`index.html:6293`. Add one line after the drill dispatch:

```js
  if (currentActivity() === "drill") return renderDrillControl(box);
  if (currentActivity() === "flashcard") return renderFlashcardControl(box);
```

- [ ] **Step 5: Bump the version**

`index.html:1179` → `const VERSION   = "v118 — 2026-09-18";`
`sw.js:10` → `const CACHE = "hsk-chat-v118";`

- [ ] **Step 6: Run the whole suite**

Run: `sh test/run.sh`

Expected: all pass. If `test/browser.test.js` fails on a missing element, the
dispatch in Step 4 is firing before `flashcardCandidates()` can run — check that
Task 4's functions are defined above `renderFlashcardControl` in the file.

- [ ] **Step 7: Verify by hand in the browser**

You need some history for candidates to exist. In the console:

```js
startActivity("flashcard");
flashcardCandidates().map(e => e.w);   // some words, or [] on a fresh profile
```

Then, in the UI: the starters strip shows a note and a **Choose 5 words** button
(or the no-words note). Press it. Expected: the strip changes to the five words
plus **Export for Anki** and **Export for Pleco**, the composer becomes enabled,
and the partner writes an opening turn that works toward the first word.

Press **Export for Pleco**. Expected: a share sheet or a download of a `.txt`
holding exactly those five words with pinyin and gloss, tab separated — not the
whole 词 panel.

- [ ] **Step 8: Commit**

```bash
git add index.html sw.js
git commit -m "feat: Flashcard Chat chooser and per-set export"
```

---

### Task 6: The marker strip

"Day 1 ✓ Day 2 ✓ Day 3 · 3/5", then **Activity Complete!**. The learner asked
for this so progress and completion are visible.

**Files:**
- Modify: `index.html:2771-2801` (the banner block inside `renderConversation`)
- Modify: `index.html:6294-6310` (`fillActivities`'s note)
- Modify: `index.html:1179` (`VERSION`) and `sw.js:10` (`CACHE`)

**Interfaces:**
- Consumes: `flashcardTargets()`, `flashcardRounds()`, `flashcardDone()`,
  `flashcardTheme()` from Task 4.
- Produces: `flashcardBanner()` → `String` of HTML, `""` when the activity is not
  Flashcard Chat. Defined inside `renderConversation` beside `ghostBanner()` and
  `drillBanner()`, and appended to the same string those two feed.

- [ ] **Step 1: Write the banner**

Inside `renderConversation`, immediately after `ghostBanner()`'s closing brace
(around line 6300 — it ends with the "No unused words yet" return), insert:

```js
  /* Flashcard Chat's banner, like the two beside it: what you are working on
   * stays on screen for the whole conversation.
   *
   * Rounds are derived -- min(ghostN) across the set, HSKPace.setRounds() --
   * rather than counted anywhere, so a reload cannot lose one and two devices
   * cannot disagree. A round is "every word used correctly once", and the ghost
   * counter takes at most one credit per word per day, so a round cannot close
   * in under a day.
   *
   * Which is why the label says Day and can lag the calendar: credit three
   * words on Monday and two on Tuesday and "Day 1" ticks on Tuesday. It
   * measures the SET, not the diary. Stated in the spec as a limitation rather
   * than fixed, because counting practice days instead would be a third notion
   * of progress on screen beside n/N and the round. */
  function flashcardBanner() {
    if (currentActivity() !== "flashcard") return "";
    const targets = flashcardTargets();
    if (!targets.length) return "";
    const rounds = flashcardRounds(), goal = S.ghostUses;
    const strip = [];
    for (let i = 1; i <= goal; i++) {
      if (i <= rounds) {
        strip.push('<span style="margin-right:12px">Day ' + i + ' ✓</span>');
      } else if (i === rounds + 1) {
        const got = targets.filter(e => (e.ghostN || 0) >= i).length;
        strip.push('<span style="margin-right:12px;color:var(--accent)">Day ' + i +
          " · " + got + "/" + targets.length + "</span>");
      } else {
        strip.push('<span style="margin-right:12px;opacity:.45">Day ' + i + "</span>");
      }
    }
    const chips = targets.map(e =>
      '<span style="display:inline-block;margin:0 10px 4px 0' +
        (e.ghostToday ? ';opacity:.55' : '') + '">' + escapeHtml(e.w) +
      '<span style="font-size:14px;color:var(--dim)"> ' +
        (e.ghostN || 0) + "/" + goal + (e.ghostToday ? " ✓" : "") +
      "</span></span>").join("");
    const theme = flashcardTheme();
    return '<div class="hint"><b>Flashcard Chat</b>' +
      (theme ? " — " + escapeHtml(theme) : "") + "<br>" +
      (flashcardDone()
        ? '<b style="color:var(--accent);font-size:20px">Activity Complete!</b><br>' +
          '<span style="color:var(--dim)">All ' + targets.length + ' words used ' +
          'correctly on ' + goal + ' separate days. Start a new Flashcard Chat ' +
          'for the next set.</span><br>'
        : "Use these words in your replies:<br>") +
      '<b style="color:var(--accent);font-size:22px">' + chips + "</b><br>" +
      '<span style="color:var(--dim)">' + strip.join("") + "</span><br>" +
      '<span style="color:var(--dim)">One use counts per day, and only the word ' +
      'itself is judged — a mistake elsewhere in the sentence does not cost ' +
      'you the credit.</span></div>';
  }
```

- [ ] **Step 2: Append it where the other two banners are used**

Find where `ghostBanner()` and `drillBanner()` are concatenated into the hint
HTML — `grep -n "ghostBanner()" index.html` finds both the definition and the
single use. Add `flashcardBanner()` to that same expression, after
`drillBanner()`. It returns `""` for every other activity, exactly as the other
two do, so no guard is needed around it.

- [ ] **Step 3: Give the activity picker its note**

`index.html:6294`, in `fillActivities`, after the `if (cur === "focused") {…}`
block closes, add:

```js
  /* Same reasoning as Ghost Words' strip above: this line is visible while the
   * banner has scrolled away, and "which five words was this" is the question
   * it would otherwise leave unanswered. */
  if (cur === "flashcard") {
    const targets = flashcardTargets();
    if (targets.length) {
      note = (flashcardDone() ? "Complete — " : "Day " + (flashcardRounds() + 1) + " — ") +
        targets.map(e => e.w + " " + (e.ghostN || 0) + "/" + S.ghostUses).join("、");
    }
  }
```

- [ ] **Step 4: Bump the version**

`index.html:1179` → `const VERSION   = "v119 — 2026-09-18";`
`sw.js:10` → `const CACHE = "hsk-chat-v119";`

- [ ] **Step 5: Run the whole suite**

Run: `sh test/run.sh`

Expected: all pass.

- [ ] **Step 6: Verify by hand in the browser**

With a Flashcard Chat that has a set, in the console:

```js
S.ghostUses;          // note the value, the strip must have this many days
flashcardRounds();    // 0 on a fresh set
```

Expected on screen: a banner reading **Flashcard Chat**, the words with `0/N`
counts, and a strip `Day 1 · 0/5  Day 2  Day 3` with days 2 and 3 dimmed.

Now change the setting: Settings → Learning → **Correct uses to retire a ghost
word** → 5. Expected: the strip redraws with five days, not three. This is the
check that nothing hardcoded 3.

- [ ] **Step 7: Commit**

```bash
git add index.html sw.js
git commit -m "feat: Flashcard Chat day markers and completion"
```

---

### Task 7: Measure whether the model call is worth making

The feature is complete and shippable after Task 6. This task decides whether
Task 8 happens at all. CLAUDE.md requires a counted run against a real model
before any prompt ships, and RESEARCH.md records four cases in this study where
a prompt fix moved the number the wrong way.

**Files:**
- Create: `tools/flashcard-set.js`
- Create: `tools/flashcard-set-results.md` (written by you, from the run's output)
- Modify: `RESEARCH.md` (the subsection under "Choosing a set of words to study
  away from the app")

**Interfaces:**
- Consumes: `HSKPace.SET_SIZE`, `HSKPace.CANDIDATES_SHOWN`, and the prompt
  builder from Task 8 Step 3 — which means **Task 8 Step 3 must be done first**.
  Do that one step, then come back here. Nothing else from Task 8 is needed and
  nothing in the app changes until Task 7 has decided.

- [ ] **Step 1: Do Task 8 Step 3 only**

Write `HSKPrompt.flashcardSet()` exactly as Task 8 Step 3 specifies, and export
it. Do not write Task 8's test, do not touch `index.html`, do not bump the
version. Commit nothing yet.

- [ ] **Step 2: Write the tool**

Create `tools/flashcard-set.js`:

```js
/* Does telling the model to group a flashcard set THEMATICALLY change what it
 * returns? That is the only question, and the whole justification for spending
 * a model call here rather than taking the top five by arithmetic.
 *
 * Tinkham (1997) and Waring (1997) both measured semantic sets -- five colours,
 * five foods -- as SLOWER to learn than unrelated sets, while thematic sets
 * (one situation, not one category) are faster. A model asked for five words to
 * study returns the semantic arrangement by default. RESEARCH.md, "Choosing a
 * set of words to study away from the app".
 *
 * Run:
 *   OPENROUTER_KEY_FILE=<path> node tools/flashcard-set.js --pools 12
 *
 * Writes every returned set to stdout WITHOUT its arm, so the clustering
 * judgement can be made blind -- this file records two label passes carrying
 * the same rubric drawing the line in different places. The arm key is printed
 * at the very end, after the sets. */
const fs = require("fs");
const path = require("path");
const os = require("os");

const HSKPrompt = require("../prompt.js");
const HSKPace = require("../pace.js");

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_FILE = process.env.OPENROUTER_KEY_FILE ||
  path.join(os.homedir(), "Documents", "openrouter_key.txt");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const POOLS = Number(arg("pools", 12));
const LEVEL = Number(arg("level", 2));
/* The TEACHING model, because that is what the app calls. RESEARCH.md's
 * drill-word table is why: on the partner model the same class of job refused
 * 0/6 when it should have refused and scored 21/39 on the verdict, against
 * 27/27 and 37/39 here. */
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }

const list = JSON.parse(fs.readFileSync(
  path.join(__dirname, "../data/hsk" + LEVEL + ".json"), "utf8"));

/* Sliding windows over the frequency-ordered list. A real candidate pool is
 * commonest-first and locally similar in rank, which is exactly what a window
 * is -- flashcardPool() sorts by `f` and takes the head. Not the real thing,
 * and the honest limitation to write up: a pool built from one learner's
 * history would be sparser across the frequency range than these are. */
function pools(n) {
  const size = HSKPace.CANDIDATES_SHOWN, out = [];
  const step = Math.max(1, Math.floor((list.length - size) / n));
  for (let i = 0; out.length < n && i + size <= list.length; i += step) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

/* The two arms. `plain` is `thematic` with the two rules deleted and nothing
 * else changed -- built by string surgery on the shipped prompt rather than by
 * a second hand-written prompt, so the arms cannot drift apart in some other
 * way and quietly become a different comparison. */
const THEMATIC_RULES = [
  "Pick words that could all turn up in ONE situation -- a visit to the " +
  "doctor, a train journey, cooking dinner -- so the student can build " +
  "sentences that hang together.\n\n",
  "Do NOT pick words from one category. Five colours, five foods or five " +
  "items of clothing are HARDER to learn together, not easier.\n\n"
];

function promptFor(arm, entries) {
  const full = HSKPrompt.flashcardSet({ entries: entries });
  if (arm === "thematic") return full;
  let out = full;
  THEMATIC_RULES.forEach(r => {
    if (out.indexOf(r) === -1) {
      console.error("FATAL: the prompt no longer contains the rule this arm " +
        "deletes. The A/B would compare two identical prompts.\n" + r);
      process.exit(1);
    }
    out = out.replace(r, "");
  });
  return out;
}

async function call(text) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: text }],
                           max_tokens: 300, temperature: 0.7,
                           usage: { include: true } })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body.error && body.error.message) || ("HTTP " + r.status));
  const txt = body.choices && body.choices[0] && body.choices[0].message &&
              body.choices[0].message.content;
  return { text: String(txt || ""), cost: (body.usage && body.usage.cost) || 0 };
}

function parseJson(raw) {
  const s = String(raw || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

(async function main() {
  const ARMS = ["thematic", "plain"];
  const rows = [], score = {};
  ARMS.forEach(a => { score[a] = { inPool: 0, returned: 0, sets: 0, bad: 0, cost: 0 }; });

  const ps = pools(POOLS);
  for (let i = 0; i < ps.length; i++) {
    for (const arm of ARMS) {
      const ok = new Set(ps[i].map(e => e.w));
      let raw = "", err = "";
      try {
        const r = await call(promptFor(arm, ps[i]));
        raw = r.text; score[arm].cost += r.cost;
      } catch (e) { err = e.message; }
      const j = parseJson(raw);
      const words = ((j && j.words) || []).map(w => String(w || "").trim());
      const good = words.filter(w => ok.has(w));
      /* Print the raw thing and count what did not come back. Three wrong
       * numbers in this study came from a silent failure that looked clean:
       * 没有错误 parsed as a sentence, `content` empty while `reasoning` filled
       * the budget, and a swallowed exception that made a dead grader look
       * fine. */
      if (err || !j || !good.length) {
        score[arm].bad++;
        console.error("--- pool " + i + " / " + arm + " returned nothing usable");
        console.error(err ? "ERROR: " + err : JSON.stringify(raw).slice(0, 400));
        continue;
      }
      score[arm].sets++;
      score[arm].returned += words.length;
      score[arm].inPool += good.length;
      rows.push({ arm: arm, pool: i, words: good, theme: (j && j.theme) || "" });
    }
  }

  /* Shuffled and unlabelled. Judge each set thematic / semantic / neither
   * BEFORE reading the key at the bottom. */
  for (let i = rows.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    const t = rows[i]; rows[i] = rows[k]; rows[k] = t;
  }

  console.log("\n## Sets, unlabelled — judge these before reading the key\n");
  rows.forEach((r, i) => {
    console.log(String(i).padStart(3) + "  " + r.words.join("、") +
      (r.theme ? "   [" + r.theme + "]" : ""));
  });

  console.log("\n## Counts\n");
  console.log("| arm | sets | words returned | in pool | unusable | $ |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  ARMS.forEach(a => {
    const s = score[a];
    console.log("| " + a + " | " + s.sets + " | " + s.returned + " | " +
      s.inPool + " (" + (s.returned ? Math.round(s.inPool / s.returned * 100) : 0) +
      "%) | " + s.bad + " | " + s.cost.toFixed(4) + " |");
  });

  console.log("\n## Key — read only after labelling\n");
  rows.forEach((r, i) => console.log(String(i).padStart(3) + "  " + r.arm));
})();
```

- [ ] **Step 3: Run it**

Run: `OPENROUTER_KEY_FILE=<path> node tools/flashcard-set.js --pools 12 > tools/flashcard-set-raw.txt`

Expected: 24 calls, a few cents. The file holds the unlabelled sets, the counts
table, and the arm key at the bottom. Any unusable response prints its raw text
to stderr, where you will see it.

- [ ] **Step 4: Label the sets blind**

Read only the "Sets, unlabelled" section. For each, write down one of:

- **thematic** — the words could turn up in one situation (a doctor's visit, a
  train journey, cooking dinner)
- **semantic** — the words are one category (five foods, five colours, five
  items of clothing)
- **neither** — no discernible relation

Then, and only then, read the key at the bottom and total each arm.

- [ ] **Step 5: Write up the result**

Create `tools/flashcard-set-results.md` holding the counts table, your labels,
and the totals. Then add a subsection to RESEARCH.md under "Choosing a set of
words to study away from the app" — that section already names this A/B as the
thing that decides, so it needs the answer.

Report the in-pool rate honestly too. It is the number that says whether the
validation in Task 8 Step 5 is load-bearing or theatre.

**The decision rule, fixed before the run:** if `thematic` does not produce
materially more thematic sets than `plain`, **Task 8 does not happen.** Revert
the `flashcardSet()` function from Step 1, ship what Task 6 left, and record the
null result — RESEARCH.md has a "Things that did not work" section for exactly
this, and this repo has four recorded cases of a prompt fix moving the number
the wrong way.

- [ ] **Step 6: Commit**

```bash
git add tools/flashcard-set.js tools/flashcard-set-results.md RESEARCH.md prompt.js
git commit -m "test: A/B the thematic instruction for flashcard sets"
```

---

### Task 8: The model call — ONLY if Task 7 earned it

**Do not start this task if Task 7's measurement was null.** Re-read Task 7
Step 5 before beginning. `HSKPrompt.flashcardSet()` already exists from Task 7
Step 1; this task adds its test, the pure function that validates a reply, and
the wiring.

**Files:**
- Modify: `prompt.js` (`flashcardSet`, already written in Task 7 Step 1)
- Modify: `pace.js` (add `chooseSet` beside `flashcardPool`; add to `api`)
- Modify: `index.html` — `renderFlashcardControl`'s button handler
- Test: `test/prompt.test.js`, `test/pace.test.js`
- Modify: `index.html:1179` (`VERSION`) and `sw.js:10` (`CACHE`)

**Interfaces:**
- Consumes: `flashcardCandidates()`, `startFlashcardsWith()` from Task 4;
  `callModel(messages, maxTokens, model)`, `jsonIn(text)`, `teachingModel()`,
  all existing in `index.html`.
- Produces:
  - `HSKPrompt.flashcardSet(opts)` → `String`. `opts` is `{ entries }`, an
    `Array` of candidate entries with `w`, `p` and `d`.
  - `HSKPace.chooseSet(candidates, reply)` → `Array<string>`. `candidates` is
    the entry array; `reply` is the model's parsed JSON (or `null`). Returns
    between `SET_SIZE` and `SET_MAX` words, every one of them from
    `candidates`.

- [ ] **Step 1: Write the failing tests**

Append to `test/pace.test.js`, before the final `console.log`:

```js
// --- validating what the chooser model sends back ---------------------------
const cand = [
  { w: "苹果", f: 100 }, { w: "医生", f: 200 }, { w: "回答", f: 300 },
  { w: "颜色", f: 400 }, { w: "机场", f: 500 }, { w: "从来", f: 600 },
  { w: "叉子", f: 700 }, { w: "啤酒", f: 800 }
];
check(P.chooseSet(cand, { words: ["医生", "回答"] }).slice(0, 2).join() === "医生,回答",
  "the model's own picks come first");
check(P.chooseSet(cand, { words: ["医生", "熊猫"] }).indexOf("熊猫") === -1,
  "a word that was not in the candidate list is dropped");
check(P.chooseSet(cand, { words: ["医生"] }).length === P.SET_SIZE,
  "too few valid words backfills to SET_SIZE from the head of the candidates",
  String(P.chooseSet(cand, { words: ["医生"] }).length));
check(P.chooseSet(cand, { words: ["医生"] })[1] === "苹果",
  "and the backfill is commonest-first, taking the candidates in order",
  P.chooseSet(cand, { words: ["医生"] }).join());
check(P.chooseSet(cand, null).join() === cand.slice(0, P.SET_SIZE).map(e => e.w).join(),
  "a dead or malformed call yields the arithmetic top five",
  P.chooseSet(cand, null).join());
check(P.chooseSet(cand, { words: [] }).length === P.SET_SIZE,
  "and so does an empty words array");
check(P.chooseSet(cand, { words: cand.map(e => e.w) }).length === P.SET_MAX,
  "a model that returns everything is capped at SET_MAX",
  String(P.chooseSet(cand, { words: cand.map(e => e.w) }).length));
check(P.chooseSet(cand, { words: ["医生", "医生", "回答"] }).filter(w => w === "医生").length === 1,
  "a word returned twice appears once");
check(P.chooseSet([], { words: ["医生"] }).length === 0,
  "no candidates means no set, whatever the model said");
check(P.chooseSet(null, null).length === 0, "and neither argument is required");
```

Append to `test/prompt.test.js`, before its final `console.log`:

```js
// --- Flashcard Chat: the set chooser ----------------------------------------
const fcPrompt = P.flashcardSet({ entries: [
  { w: "苹果", p: "píngguǒ", d: "apple" },
  { w: "医生", p: "yīshēng", d: "doctor" }
] });
check(fcPrompt.indexOf("苹果") !== -1 && fcPrompt.indexOf("医生") !== -1,
  "every candidate reaches the prompt");
check(fcPrompt.indexOf("píngguǒ") !== -1 && fcPrompt.indexOf("apple") !== -1,
  "with its pinyin and gloss, so the model can group by meaning");
/* Character for character, because tools/flashcard-set.js benchmarked these
 * two strings and a measurement is worth nothing if what ships is a
 * paraphrase. The same assertion the two gate prompts already carry -- and
 * tools/flashcard-set.js builds its control arm by DELETING these exact
 * strings, so a reworded prompt does not merely lose the measurement, it
 * makes the tool exit with a fatal error. */
check(fcPrompt.indexOf(
  "Pick words that could all turn up in ONE situation") !== -1,
  "the thematic rule ships exactly as it was measured");
check(fcPrompt.indexOf(
  "Do NOT pick words from one category. Five colours, five foods or five " +
  "items of clothing are HARDER to learn together, not easier.") !== -1,
  "and so does the anti-semantic-clustering rule beside it");
check(P.flashcardSet({}).length > 0,
  "an empty candidate list still yields a prompt rather than throwing");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node test/pace.test.js`

Expected: FAIL with `P.chooseSet is not a function`.

Run: `node test/prompt.test.js`

Expected: PASS already — `flashcardSet()` was written in Task 7 Step 1. If it
fails on the two character-for-character checks, the prompt was edited after the
A/B was run and the measurement no longer describes what ships. Restore the
measured strings; do not adjust the test to match the prompt.

- [ ] **Step 3: The prompt (already done in Task 7 Step 1 — reproduced here in full)**

In `prompt.js`, immediately after `drillWord`:

```js
  /* Which five to seven of the candidates make a set worth studying together.
   *
   * The model is NOT asked what the learner should study -- the arithmetic in
   * pace.js has already answered that, from data a model cannot see and would
   * have every reason to flatter. It is asked to ARRANGE a list it is handed,
   * which is the one job here arithmetic cannot do.
   *
   * The anti-clustering rule is the whole reason this call exists. A model
   * asked for five words to study returns a semantic set by default -- five
   * colours, five foods -- and Tinkham (1997) and Waring (1997) both measured
   * semantic sets as SLOWER to learn than unrelated ones, while thematic sets
   * (one situation, not one category) are faster. RESEARCH.md, "Choosing a set
   * of words to study away from the app". Measured in tools/flashcard-set.js,
   * which builds its control arm by deleting these two rules verbatim -- so do
   * not reword them without re-running it. */
  function flashcardSet(opts) {
    var o = opts || {};
    var list = (o.entries || []).map(function (e) {
      return e.w + " (" + (e.p || "") + ", " + (e.d || "") + ")";
    }).join("\n");
    return "A student of Chinese is about to study a few words as flashcards, " +
      "then practise using them in conversation. Choose which ones.\n\n" +
      "The candidates, commonest first:\n" + list + "\n\n" +
      "Pick between 5 and 7 of them.\n\n" +
      "Pick words that could all turn up in ONE situation -- a visit to the " +
      "doctor, a train journey, cooking dinner -- so the student can build " +
      "sentences that hang together.\n\n" +
      "Do NOT pick words from one category. Five colours, five foods or five " +
      "items of clothing are HARDER to learn together, not easier.\n\n" +
      "Reply with only this JSON object, no prose and no code fence:\n" +
      '{"words":[],"theme":""}\n\n' +
      "words -- the chosen words, copied from the list above character for " +
      "character. A word you did not copy from that list is wrong even when it " +
      "is a better word.\n" +
      "theme -- the situation they share, in ENGLISH, five words or fewer.";
  }
```

Add `flashcardSet: flashcardSet,` to `prompt.js`'s `api` literal beside the
other prompt builders.

- [ ] **Step 4: Write `chooseSet`**

In `pace.js`, immediately after `flashcardPool`:

```js
  /* What the app actually uses, out of what the model actually said.
   *
   * Intersected with the candidates and never trusted. The prompt says copy
   * character for character; a word that is not in the list is a rewrite, and
   * the app's whole promise is that nothing out of level reaches the screen.
   * Because the candidates came out of the level's own allowlist, this one
   * filter is the entire out-of-level guarantee for this feature.
   *
   * Then backfilled from the head of the candidates, which are already
   * commonest first. So a refusal, a truncated answer, a malformed one or a
   * dead call all degrade to "the top SET_SIZE by arithmetic" rather than to
   * an empty set -- the same fail-open rule the gate, the planner and the
   * missing-table path follow. A learner must never be unable to start a
   * session because a model was slow.
   *
   * Here rather than in the click handler so it can be tested in node at all:
   * the three interesting cases are a hallucinated word, a short answer and no
   * answer, and none of them is reachable from a browser without breaking the
   * network on purpose. */
  function chooseSet(candidates, reply, size, max) {
    var list = candidates || [];
    var ok = new Set(list.map(function (e) { return e && e.w; }));
    var want = size || SET_SIZE, cap = max || SET_MAX;
    var out = [];
    ((reply && reply.words) || []).forEach(function (w) {
      var s = String(w || "").trim();
      if (ok.has(s) && out.indexOf(s) === -1 && out.length < cap) out.push(s);
    });
    for (var i = 0; i < list.length && out.length < want; i++) {
      if (list[i] && out.indexOf(list[i].w) === -1) out.push(list[i].w);
    }
    return out;
  }
```

Extend the `api` literal line so it reads:

```js
    SET_SEP: SET_SEP, flashcardsOf: flashcardsOf,
    flashcardThemeOf: flashcardThemeOf, chooseSet: chooseSet,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node test/pace.test.js && node test/prompt.test.js`

Expected: both PASS.

- [ ] **Step 6: Call it from the chooser**

In `index.html`, replace `renderFlashcardControl`'s button and handler (written
in Task 5 Step 3) with:

```js
  const go = document.createElement("button");
  go.className = "story";
  go.textContent = "Choose " + HSKPace.SET_SIZE + " words";
  go.onclick = async () => {
    if (S.busy) return;
    go.disabled = true;
    /* The call can take several seconds on a slow connection, and a button that
     * does nothing visible reads as a hang -- the same reason turn() has a
     * status line. */
    go.textContent = "想一想…";
    let reply = null, theme = "";
    try {
      reply = jsonIn(await callModel(
        [{ role: "user", content: HSKPrompt.flashcardSet({ entries: candidates }) }],
        300, teachingModel()));
      theme = String((reply && reply.theme) || "").trim().slice(0, 40);
    } catch (e) { /* chooseSet falls back to the arithmetic on a null reply */ }
    startFlashcardsWith(HSKPace.chooseSet(candidates, reply), theme);
  };
  box.appendChild(go);
```

- [ ] **Step 7: Bump the version**

`index.html:1179` → `const VERSION   = "v120 — 2026-09-18";`
`sw.js:10` → `const CACHE = "hsk-chat-v120";`

- [ ] **Step 8: Run the whole suite**

Run: `sh test/run.sh`

Expected: all pass.

- [ ] **Step 9: Verify the failure path by hand**

This is the step that matters most, because a fail-open path that does not fail
open is invisible until the day it is needed. `chooseSet`'s unit tests cover the
arithmetic; this covers the wiring around it. In the browser console, on a fresh
Flashcard Chat and BEFORE pressing the button:

```js
const real = callModel;
callModel = () => { throw new Error("simulated dead model"); };
```

Press **Choose 5 words**. Expected: five words appear anyway, no theme shown, no
error dialog, the chat starts and the partner writes its opening turn.

Start another fresh Flashcard Chat and repeat with:

```js
callModel = async () => "I'm sorry, I can't help with that.";
```

Expected: the same — five words by arithmetic. Then restore:

```js
callModel = real;
```

- [ ] **Step 10: Commit**

```bash
git add prompt.js pace.js index.html sw.js test/prompt.test.js test/pace.test.js
git commit -m "feat: group a flashcard set thematically"
```

---

## After the last task

Run `sh test/run.sh` one final time and confirm firefox was present, so
`browser.test.js` actually ran rather than exiting 0 on a bare machine. Then use
`superpowers:finishing-a-development-branch` to decide how the work integrates.

The branch is `feat/flashcard-chat`. Per CLAUDE.md, merging without deleting the
branch leaves any stacked PR pointing at a merged branch — GitHub only retargets
on delete.
