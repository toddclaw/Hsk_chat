# Ghost Word Credit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ghost word leaves the ghost list after three correct uses on three
separate days, judged on the word itself rather than on the whole sentence.

**Architecture:** Two pure functions in `mistakes.js` decide the rule
(`ghostVerdict`, `ghostProgress`) and are tested in node. `index.html` supplies
segmentation and state, asks the existing measured `drillCheck` word prompt for
a per-word verdict inside the Ghost Words activity, and consults the new
progress map in exactly one place — `readiness().unused`. Nothing is stored:
progress is derived by scanning graded messages, the discipline the mistake
count already keeps.

**Tech Stack:** Plain ES5-in-modules / ES6-in-page JavaScript. No build step, no
bundler, no dependencies, no test framework. Node for unit suites, firefox +
geckodriver for the browser suite.

**Spec:** `docs/superpowers/specs/2026-09-10-ghost-word-credit-design.md`

## Global Constraints

- **No dependencies, no build step, no `package.json`.** Do not add any, in the
  app or the tests.
- **`VERSION` in `index.html` and `CACHE` in `sw.js` must move together** on any
  user-visible change. Current values: `VERSION = "v94 — 2026-09-09"` and
  `CACHE = "hsk-chat-v94"`. This plan bumps both to `v95` in Task 6.
- **No new files are created**, so `sw.js`'s `SHELL` array is unchanged.
- **No prompt string may be edited.** `HSKPrompt.drillCheck()` is reused
  character for character. Editing it would trigger CLAUDE.md's requirement for
  a counted A/B run against a real model.
- **`mistakes.js` must not reference `prompt.js`, `index.html` state, or the
  DOM.** It takes plain data and callbacks. It ends with the standard wrapper
  already at its foot; do not change that.
- **`PREFS_KEYS` in `sync.js` must never name `key` or `history`.**
  `test/sync.test.js` asserts this. Adding `ghostUses` is fine — it is a
  preference, not a secret.
- Tests are a `check(ok, label, detail)` counter with `process.exit(1)` at the
  end. Match that; do not introduce a framework.
- Run the whole suite with `sh test/run.sh`. A single suite with
  `node test/mistakes.test.js`.
- Constants: `GHOST_USES` default **3**, settable **1–6**. `GHOST_CHECK_MAX` =
  **3** words checked per message.
- Work on branch `feature/ghost-word-credit`. Do not commit to `main`.

---

### Task 1: The credit rule, in `mistakes.js`

**Files:**
- Modify: `mistakes.js` — add two functions after `credited()` (ends line 111),
  and add both to the `api` object at the foot of the file
- Test: `test/mistakes.test.js` — append a new section before the final
  summary/exit lines

**Interfaces:**
- Consumes: `dayKey(iso)`, already defined at `mistakes.js:28`
- Produces:
  - `HSKMistakes.ghostVerdict(grade, word)` → `"ok"` | `"wrong"` | `"none"`
  - `HSKMistakes.ghostProgress(turns, wordsOf)` → plain object,
    `{ [word]: { n: Number, last: String } }`, where `n` is progress and `last`
    is the most recently credited `dayKey`. `turns` is an array of message
    objects each with `created_at` and `grade`; `wordsOf(turn)` returns an array
    of word strings found in that turn.
  - `HSKMistakes.dayKey(iso)` → `String` (already exists; this task exports it)

- [ ] **Step 1: Write the failing tests**

Append to `test/mistakes.test.js`, immediately before the closing summary lines
(the block that prints `pass`/`fail` and calls `process.exit`):

```js
// --- ghost words ------------------------------------------------------------

// A graded user message. `ghost` is the per-word verdict map, omitted on the
// messages that predate the feature.
const gturn = (when, ok, ghost) => ({
  role: "user", text: "我说话", created_at: when,
  grade: ghost ? { ok: ok, errors: [], ghost: ghost } : { ok: ok, errors: [] }
});
const saysWord = () => ["说话"];

check(M.ghostVerdict({ ok: true, errors: [] }, "说话") === "ok",
  "no verdict and a clean sentence credits the word");
check(M.ghostVerdict({ ok: false, errors: [{ tag: "aspect-le" }] }, "说话") === "none",
  "no verdict and a failed sentence credits nothing");
check(M.ghostVerdict({ ok: false, ghost: { "说话": { used: true, ok: true } } },
  "说话") === "ok",
  "a correct word in a failing sentence credits: the verdict beats grade.ok");
check(M.ghostVerdict({ ok: true, ghost: { "说话": { used: true, ok: false } } },
  "说话") === "wrong",
  "a wrong word in a passing sentence is a failure: the verdict beats grade.ok");
check(M.ghostVerdict({ ok: true, ghost: { "说话": { used: false, ok: false } } },
  "说话") === "none",
  "a sentence that never reached for the word is neither credit nor failure");
check(M.ghostVerdict({ unreadable: true }, "说话") === "none",
  "an unreadable grade says nothing about any word");
check(M.ghostVerdict(null, "说话") === "none",
  "an ungraded message says nothing about any word");
check(M.ghostVerdict({ ok: true, ghost: { "米饭": { used: true, ok: false } } },
  "说话") === "ok",
  "a verdict about another word does not decide this one");

const gp = (turns) => M.ghostProgress(turns, saysWord);

check((gp([gturn("2026-09-01T10:00:00Z", true)])["说话"] || {}).n === 1,
  "one clean message is one credit");
check((gp([gturn("2026-09-01T10:00:00Z", true),
           gturn("2026-09-01T18:00:00Z", true)])["说话"] || {}).n === 1,
  "two credits on the same day count once");
check((gp([gturn("2026-09-01T10:00:00Z", true),
           gturn("2026-09-02T10:00:00Z", true),
           gturn("2026-09-03T10:00:00Z", true)])["说话"] || {}).n === 3,
  "three credits on three days count three");
check((gp([gturn("2026-09-01T10:00:00Z", true),
           gturn("2026-09-02T10:00:00Z", true),
           gturn("2026-09-03T10:00:00Z", false,
                 { "说话": { used: true, ok: false } })])["说话"] || {}).n === 1,
  "a wrong use demotes by one, it does not reset to zero");
check((gp([gturn("2026-09-01T10:00:00Z", false,
                 { "说话": { used: true, ok: false } })])["说话"] || {}).n === 0,
  "a demotion floors at zero rather than going negative");
check((gp([gturn("2026-09-01T10:00:00Z", true),
           gturn("2026-09-01T12:00:00Z", false,
                 { "说话": { used: true, ok: false } }),
           gturn("2026-09-01T14:00:00Z", true)])["说话"] || {}).n === 0,
  "a demotion followed by a same-day success does not re-earn that day");
check((gp([gturn("2026-09-03T10:00:00Z", true),
           gturn("2026-09-01T10:00:00Z", false,
                 { "说话": { used: true, ok: false } })])["说话"] || {}).n === 1,
  "the walk is ordered by timestamp, not by array order");
check((gp([gturn("2026-09-01T10:00:00Z", true)])["说话"] || {}).last === "2026-09-01",
  "last names the most recently credited day");
check(M.ghostProgress([{ role: "user", created_at: "2026-09-01T10:00:00Z",
                         grade: { ok: true, errors: [] } }],
  () => ["说话", "说话"])["说话"].n === 1,
  "a word repeated inside one message earns that message's single credit once");
check(Object.keys(gp([])).length === 0, "no messages is no progress");
check(M.dayKey("2026-09-01T10:00:00Z") === "2026-09-01",
  "dayKey is exported for the caller that needs today's key");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/mistakes.test.js`
Expected: FAIL — `TypeError: M.ghostVerdict is not a function`.

- [ ] **Step 3: Write the implementation**

In `mistakes.js`, insert after the closing brace of `credited()` (line 111) and
before the `/* How much of the history predates the current grader` comment:

```js
  /* The verdict on ONE ghost word in one sentence, in three values rather than
   * two.
   *
   * "none" and "wrong" have to be told apart because they do different things
   * to progress: a sentence that never reached for the word says nothing, while
   * one that reached for it and missed costs a day-credit. A boolean collapses
   * those, and collapsing them is what made ghost progress a ratchet that only
   * ever clicked forward.
   *
   * The fallback to grade.ok is what keeps every message written before this
   * feature -- and every message written outside the Ghost Words activity,
   * where no verdict is asked for -- counting exactly as it did. It is the
   * STRICTER of the two rules: the whole sentence has to be clean. It can never
   * return "wrong", because grade.ok === false says something in the sentence
   * was wrong and never that THIS word was, so a failed check and a legacy
   * transcript can demote nothing. */
  function ghostVerdict(grade, word) {
    if (!grade || grade.unreadable) return "none";
    var v = grade.ghost && grade.ghost[word];
    if (v && typeof v === "object") {
      if (v.used !== true) return "none";
      return v.ok === true ? "ok" : "wrong";
    }
    return grade.ok === true ? "ok" : "none";
  }

  /* How far along each word is, walked in timestamp order.
   *
   * At most one credit per word per calendar day -- the same rule and the same
   * dayKey() the drill already uses, for the reason RESEARCH.md gives there:
   * massed practice is what loses, so session length must not be able to move
   * the number. Within a day, write the word as often as you like; it is the
   * across-day interval that predicts whether the word is still there next
   * week.
   *
   * A credited day stays credited after a demotion, so failing and then
   * succeeding again the same day does not re-earn the day. That closes the
   * only same-day loop the rule has.
   *
   * Every word in one pass, not one pass per word: the per-word version is
   * O(words x messages) and both of those grow with use. `wordsOf` is a
   * callback because segmentation needs the live lexicon, which is index.html's
   * business -- the same split needsMigration() already uses.
   *
   * Derived by scanning, never stored, like every other count in this file. */
  function ghostProgress(turns, wordsOf) {
    var rows = (turns || []).slice().sort(function (a, b) {
      var x = String((a && a.created_at) || ""), y = String((b && b.created_at) || "");
      return x < y ? -1 : x > y ? 1 : 0;
    });
    var out = {}, credited = {};
    function slot(w) {
      if (!out[w]) { out[w] = { n: 0, last: "" }; credited[w] = {}; }
      return out[w];
    }
    rows.forEach(function (t) {
      var day = dayKey(t && t.created_at);
      var seen = {};
      (wordsOf(t) || []).forEach(function (w) {
        if (seen[w]) return;            // one message credits a word once
        seen[w] = true;
        var v = ghostVerdict(t && t.grade, w);
        if (v === "ok") {
          var s = slot(w);
          if (!credited[w][day]) { credited[w][day] = true; s.n++; s.last = day; }
        } else if (v === "wrong") {
          var f = slot(w);
          f.n = Math.max(0, f.n - 1);
        }
      });
    });
    return out;
  }
```

Then extend the `api` object at the foot of the file. Replace:

```js
  var api = { counts: counts, credited: credited,
              needsMigration: needsMigration,
              drillTagOf: drillTagOf, drillExampleOf: drillExampleOf,
              drillWordOf: drillWordOf,
              WINDOW_DAYS: WINDOW_DAYS, RECENT_SHOWN: RECENT_SHOWN };
```

with:

```js
  var api = { counts: counts, credited: credited,
              needsMigration: needsMigration,
              ghostVerdict: ghostVerdict, ghostProgress: ghostProgress,
              dayKey: dayKey,
              drillTagOf: drillTagOf, drillExampleOf: drillExampleOf,
              drillWordOf: drillWordOf,
              WINDOW_DAYS: WINDOW_DAYS, RECENT_SHOWN: RECENT_SHOWN };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/mistakes.test.js`
Expected: PASS, with the count risen from 69 to 89.

- [ ] **Step 5: Run the whole suite**

Run: `sh test/run.sh`
Expected: every suite passes. Nothing consumes the new functions yet, so no
other suite should move.

- [ ] **Step 6: Commit**

```bash
git add mistakes.js test/mistakes.test.js
git commit -m "feat: what a ghost word has to do to count

Three values, not two: a sentence that never reached for the word
and one that reached and missed are different facts, and
collapsing them is what made progress a ratchet.

One credit a day, the drill's rule and the drill's dayKey -- what
predicts retention is the across-day interval, not how many
times you wrote it this afternoon.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The setting

**Files:**
- Modify: `index.html:1049` — add `GHOST_CHOICES` beside `DRILL_CHOICES`
- Modify: `index.html:1099` — add `ghostUses` to the `K` key map
- Modify: `index.html:1149` — add `ghostUses` to the `S` state defaults
- Modify: `index.html:561-567` — add the Settings markup after the `drillTurns`
  block
- Modify: `index.html:5852` — fill the new `<select>` where `drillTurns` is filled
- Modify: `index.html:5886` — read it back in `commitSettings()`
- Modify: `sync.js:253` — add `"ghostUses"` to `PREFS_KEYS`
- Test: `test/sync.test.js` — the existing prefs assertions cover the new key;
  add one naming it explicitly

**Interfaces:**
- Consumes: nothing from Task 1
- Produces: `S.ghostUses` (Number, 1–6, default 3) and the global constant
  `GHOST_CHOICES` (Array of Number), both read by Tasks 3, 4 and 5

- [ ] **Step 1: Write the failing test**

In `test/sync.test.js`, find the block asserting the contents of `PREFS_KEYS`
and add beside it:

```js
check(S.PREFS_KEYS.indexOf("ghostUses") !== -1,
  "the ghost-word threshold travels between devices like every other preference");
check(S.PREFS_KEYS.indexOf("key") === -1 && S.PREFS_KEYS.indexOf("history") === -1,
  "and adding it did not let the API key or the transcript into a prefs push");
```

If the local variable holding the module is not named `S` in that file, use
whatever name the file already uses — read the top of the file first.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/sync.test.js`
Expected: FAIL on "the ghost-word threshold travels between devices".

- [ ] **Step 3: Add the key to `sync.js`**

At `sync.js:253`, change:

```js
    "attempts", "drillTurns", "anki", "font", "starters", "script", "speechRate",
```

to:

```js
    "attempts", "drillTurns", "ghostUses", "anki", "font", "starters", "script", "speechRate",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/sync.test.js`
Expected: PASS.

- [ ] **Step 5: Add the constant, the key and the state**

At `index.html:1049`, after the `DRILL_CHOICES` line, add:

```js
const GHOST_CHOICES = [1, 2, 3, 4, 5, 6];         // correct uses to retire a ghost word
```

At `index.html:1099`, after the `drillTurns:"hsk1chat.drillTurns",` line, add:

```js
  ghostUses:"hsk1chat.ghostUses",
```

At `index.html:1149`, after the `drillTurns:` default, add:

```js
  ghostUses: store.get(K.ghostUses, 3),       // correct uses, on separate days, to retire a ghost word
```

- [ ] **Step 6: Add the Settings markup**

At `index.html:567`, immediately after the closing `</div>` of the `drillTurns`
note block and before the `<div class="row" ...>` that holds `#clearHistory`,
add:

```html
    <label for="ghostUses">Correct uses to retire a ghost word</label>
      <select id="ghostUses"></select>
      <div class="note">How many times you have to use a <b>Ghost Words</b> target
      correctly before it leaves the list. At most one counts per day, however often you
      write it — spacing is what makes a new word stick, and a day of practice is one
      day of practice. Getting it wrong costs you one back. Only the word itself is
      judged: a mistake elsewhere in the sentence still lands in your mistakes, but it
      does not withhold the credit.</div>
```

- [ ] **Step 7: Fill and read the select**

At `index.html:5852`, after the `$("#drillTurns").innerHTML = ...` statement, add:

```js
  $("#ghostUses").innerHTML = GHOST_CHOICES.map(n =>
    '<option value="' + n + '"' + (n === S.ghostUses ? " selected" : "") + ">" + n +
    (n === 3 ? " — default" : "") + "</option>").join("");
```

At `index.html:5886`, after the `S.drillTurns = ...` line, add:

```js
  S.ghostUses = Number($("#ghostUses").value) || 3; store.set(K.ghostUses, S.ghostUses);
```

- [ ] **Step 8: Run the whole suite**

Run: `sh test/run.sh`
Expected: every suite passes. `test/release.test.js` checks that every element
the page scripts reference exists in the markup, so a typo in an id fails here.

- [ ] **Step 9: Commit**

```bash
git add index.html sync.js test/sync.test.js
git commit -m "feat: a knob for how many uses retire a ghost word

Three by default, settable one to six. A setting rather than a
constant because the number is unmeasured -- the drill length
setting exists for the same reason and set the pattern.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire the threshold into the ghost list

At the end of this task the feature works on the fallback rule alone: no
per-word verdicts exist yet, so a ghost word needs three clean messages on three
days. Task 4 adds partial credit on top.

**Files:**
- Modify: `index.html:5383-5396` — `producedWords()` consults `ghostVerdict`
- Modify: `index.html` — add `ghostProgressMap()` and `ghostDayKey()` beside it
- Modify: `index.html:5437-5438` — `readiness().unused` consults the threshold
- Modify: `index.html:1760-1766` — `reuseFor()` prefers words with no credit today
- Test: `test/browser.test.js` — extend the Ghost Words section at line 1817

**Interfaces:**
- Consumes: `HSKMistakes.ghostVerdict`, `HSKMistakes.ghostProgress`,
  `HSKMistakes.dayKey` (Task 1); `S.ghostUses` (Task 2)
- Produces:
  - `ghostProgressMap()` → `{ [word]: { n, last } }` over all conversations
  - `ghostDayKey()` → `String`, today's `dayKey`
  - `readiness().unused` rows gain two fields: `ghostN` (Number) and
    `ghostToday` (Boolean). Rows are now shallow copies, not the `S.learning`
    objects themselves. Task 5's banner reads both fields.

- [ ] **Step 1: Write the failing test**

In `test/browser.test.js`, in the Ghost Words section, after the existing
`focusedReuse` checks (around line 1836), add:

```js
    /* The threshold. Messages are seeded straight into S.chatMsgs rather than
     * typed, because what is being tested is the arithmetic over a history,
     * and three days of real conversation is not something a browser test can
     * have. Graded clean and on three separate days: the fallback rule, which
     * is all that exists until the verdict lands in the next task. */
    const seedGhost = (days) => exec(
      "window.S.chatMsgs.ghosttest = " + JSON.stringify(days.map((d, i) => ({
        role: "user", text: "苹果", id: "g" + i,
        created_at: d, grade: { ok: true, errors: [] }
      }))) + "; return true;");

    await seedGhost(["2026-09-01T10:00:00Z"]);
    let gn = await exec(
      "return (window.ghostProgressMap()['\\u82f9\\u679c'] || {}).n || 0;");
    check(gn === 1, "one clean message is one ghost credit", String(gn));
    let still = await exec(
      "return window.readiness().unused.map(function (e) { return e.w; })" +
      ".indexOf('\\u82f9\\u679c') !== -1;");
    check(still === true,
      "and one credit does not retire the word: it is one of three");

    await seedGhost(["2026-09-01T10:00:00Z", "2026-09-01T18:00:00Z"]);
    gn = await exec(
      "return (window.ghostProgressMap()['\\u82f9\\u679c'] || {}).n || 0;");
    check(gn === 1, "two messages on one day are still one credit", String(gn));

    await seedGhost(["2026-09-01T10:00:00Z", "2026-09-02T10:00:00Z",
                     "2026-09-03T10:00:00Z"]);
    const gone = await exec(
      "return window.readiness().unused.map(function (e) { return e.w; })" +
      ".indexOf('\\u82f9\\u679c') === -1;");
    check(gone === true,
      "three credits on three days retires the word from the ghost list");

    await exec("delete window.S.chatMsgs.ghosttest; return true;");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/browser.test.js`
Expected: FAIL on "one clean message is one ghost credit" —
`window.ghostProgressMap is not a function`.

If firefox or geckodriver is missing this suite exits 0 without running. Check
the output actually contains the Ghost Words labels; a silent skip is not a
pass.

- [ ] **Step 3: Add the progress map**

In `index.html`, immediately after `producedWords()` (which ends at line 5396),
add:

```js
/* Today, as the same UTC dayKey the credit rule counts in. Local dates would
 * let a flight change a learner's numbers -- mistakes.js says why. */
function ghostDayKey() { return HSKMistakes.dayKey(new Date().toISOString()); }

/* How far along every word is, in one pass over every conversation.
 *
 * Segmentation happens here because it needs the live lexicon; mistakes.js gets
 * a callback and does the arithmetic. Words are de-duplicated per message there,
 * so this hands over whatever segment() found.
 *
 * ponytail: a full scan per call, and readiness() calls it on every render in
 * the Ghost Words activity -- the same ceiling the drill banner's own scan
 * already carries. Cache it behind a dirty flag if a long history ever makes a
 * render feel slow. */
function ghostProgressMap() {
  const turns = [];
  Object.keys(S.chatMsgs || {}).forEach(function (cid) {
    (S.chatMsgs[cid] || []).forEach(function (t) {
      if (t && t.role === "user" && t.grade) turns.push(t);
    });
  });
  return HSKMistakes.ghostProgress(turns, function (t) {
    return HSK.segment(t.text, S.lex)
      .filter(function (tok) { return tok.kind === "word"; })
      .map(function (tok) { return tok.text; });
  });
}
```

- [ ] **Step 4: Relax `producedWords()` to the shared rule**

At `index.html:5383`, replace the whole function:

```js
function producedWords() {
  const out = new Set();
  const scan = function (list) {
    (list || []).forEach(function (t) {
      if (t.role !== "user") return;
      if (!t.grade || !t.grade.ok) return;
      HSK.segment(t.text, S.lex).forEach(function (tok) {
        if (tok.kind === "word") out.add(tok.text);
      });
    });
  };
  Object.keys(S.chatMsgs || {}).forEach(function (cid) { scan(S.chatMsgs[cid]); });
  return out;
}
```

with:

```js
/* Words the learner has written and been credited for at least once.
 *
 * The whole-sentence gate that used to live here (`t.grade.ok`) has moved into
 * HSKMistakes.ghostVerdict(), which still applies it -- but defers to a
 * per-word verdict where one exists. So a word used correctly in a sentence
 * that was wrong somewhere else now counts, which it never did before. The
 * change can only ADD words: everything that credited before still credits. */
function producedWords() {
  const out = new Set();
  const scan = function (list) {
    (list || []).forEach(function (t) {
      if (t.role !== "user" || !t.grade) return;
      HSK.segment(t.text, S.lex).forEach(function (tok) {
        if (tok.kind === "word" &&
            HSKMistakes.ghostVerdict(t.grade, tok.text) === "ok") out.add(tok.text);
      });
    });
  };
  Object.keys(S.chatMsgs || {}).forEach(function (cid) { scan(S.chatMsgs[cid]); });
  return out;
}
```

- [ ] **Step 5: Put the threshold on the ghost list**

In `readiness()`, add the map beside the existing locals. At `index.html:5402`,
change:

```js
  const usable = usableWords(), mine = producedWords();
```

to:

```js
  const usable = usableWords(), mine = producedWords();
  const prog = ghostProgressMap(), today = ghostDayKey();
```

Then at `index.html:5437`, replace the `unused` entry:

```js
    unused: S.learning.filter(e => (e.from || 0) > S.level && !mine.has(e.w))
      .sort((a, b) => (freq.get(a.w) || Infinity) - (freq.get(b.w) || Infinity))
```

with:

```js
    /* Not `!mine.has(e.w)` any more: one correct use is a start, not a finish.
     * A word leaves this list after S.ghostUses credits on S.ghostUses separate
     * days, and a wrong use gives one back. The threshold lives HERE and
     * nowhere else -- the coverage bars above deliberately keep none, because
     * RESEARCH.md's Production section is an argument about gauges and this is
     * the list it recommends instead.
     *
     * Shallow copies, not the S.learning rows themselves: the banner needs the
     * progress alongside the word, and writing it onto the stored row would put
     * a derived number into persisted state. */
    unused: S.learning.filter(e => (e.from || 0) > S.level &&
        ((prog[e.w] && prog[e.w].n) || 0) < S.ghostUses)
      .sort((a, b) => (freq.get(a.w) || Infinity) - (freq.get(b.w) || Infinity))
      .map(e => Object.assign({}, e, {
        ghostN: (prog[e.w] && prog[e.w].n) || 0,
        ghostToday: !!(prog[e.w] && prog[e.w].last === today)
      }))
```

- [ ] **Step 6: Prefer words today's practice can move**

At `index.html:1760`, replace `reuseFor()`:

```js
function reuseFor(activity) {
  if (HSKPrompt.activityFor(activity).reuse === "unused") {
    const r = readiness();
    return ((r && r.unused) || []).slice(0, 6);
  }
  return S.learning.filter(HSKPace.isNew).slice(-6);
}
```

with:

```js
function reuseFor(activity) {
  if (HSKPrompt.activityFor(activity).reuse === "unused") {
    const r = readiness();
    /* Words already credited today go last. At most one credit a day counts, so
     * without this a learner who practised well yesterday opens the activity to
     * six words that cannot move until tomorrow, and the activity quietly has
     * nothing to offer. Still shown when there are not six others -- practising
     * them is harmless and an empty banner would be worse. A stable sort, so
     * commonest-first survives inside each group. */
    return ((r && r.unused) || []).slice()
      .sort((a, b) => (a.ghostToday ? 1 : 0) - (b.ghostToday ? 1 : 0))
      .slice(0, 6);
  }
  return S.learning.filter(HSKPace.isNew).slice(-6);
}
```

- [ ] **Step 7: Run the browser suite to verify it passes**

Run: `node test/browser.test.js`
Expected: PASS, including the four new Ghost Words labels.

- [ ] **Step 8: Run the whole suite**

Run: `sh test/run.sh`
Expected: every suite passes.

- [ ] **Step 9: Commit**

```bash
git add index.html test/browser.test.js
git commit -m "feat: one use is a start, not a finish

The ghost list now asks for S.ghostUses credits on separate days
instead of a single clean message. The threshold lives on the
list and nowhere else: the coverage bars keep none, because
RESEARCH.md's argument against a production target is an
argument about gauges and this is the list it recommends in
their place.

reuseFor() puts words already credited today last, or a learner
who practised yesterday opens the activity to six words that
cannot move until tomorrow.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Ask the grader about the word

**Files:**
- Modify: `index.html:3205-3246` — `gradeTurn()`, after the existing drill-target
  block and before `nameDrillWords()`
- Modify: `index.html:1049` — add `GHOST_CHECK_MAX` beside `GHOST_CHOICES`
- Test: `test/browser.test.js` — extend the Ghost Words section

**Interfaces:**
- Consumes: `HSKPrompt.drillCheck` (unchanged), `reuseFor` (Task 3),
  `HSK.segment`, `callModel`, `teachingModel`, `jsonIn`, `levelLabel`
- Produces: `grade.ghost` — `{ [word]: { used: Boolean, ok: Boolean } }` — read
  by `HSKMistakes.ghostVerdict` from Task 1

- [ ] **Step 1: Write the failing test**

In `test/browser.test.js`, in the Ghost Words section after Task 3's checks, add:

```js
    /* The per-word verdict. callModel is stubbed to answer the drillCheck
     * question and nothing else: the grade call asks for a much bigger object,
     * so it is answered separately by looking at what the prompt contains. */
    await exec(
      "window.__ghostCalls = [];" +
      "window.callModel = function (msgs) {" +
      "  var p = msgs[0].content;" +
      "  if (p.indexOf('{\\\"used\\\":true,\\\"ok\\\":true}') !== -1) {" +
      "    window.__ghostCalls.push(p);" +
      "    return Promise.resolve('{\\\"used\\\":true,\\\"ok\\\":true}');" +
      "  }" +
      "  return Promise.resolve('{\\\"ok\\\":false,\\\"meant\\\":\\\"\\\"," +
      "\\\"better\\\":\\\"\\u6211\\u5403\\u82f9\\u679c\\\",\\\"cats\\\":{}," +
      "\\\"errors\\\":[{\\\"tag\\\":\\\"aspect-le\\\",\\\"note\\\":\\\"x\\\"}]}');" +
      "}; return true;");
    await exec("window.S.grader = true; window.newChat('focused'); return true;");
    const turnObj = await exec(
      "var t = { role: 'user', text: '\\u82f9\\u679c', id: 'gt1'," +
      " created_at: '2026-09-05T10:00:00Z' };" +
      "window.S.history.push(t);" +
      "return window.gradeTurn(t).then(function () { return t.grade; });");
    check(turnObj && turnObj.ghost && turnObj.ghost["苹果"] &&
          turnObj.ghost["苹果"].ok === true,
      "a ghost target present in the message gets its own verdict",
      JSON.stringify(turnObj && turnObj.ghost));
    check(turnObj && turnObj.ok === false,
      "and the whole-sentence grade still says the sentence was wrong");
    check(await exec("return window.HSKMistakes.ghostVerdict(" +
      JSON.stringify(turnObj) + ", '\\u82f9\\u679c');") === "ok",
      "so the word credits even though the sentence did not");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/browser.test.js`
Expected: FAIL on "a ghost target present in the message gets its own verdict" —
`grade.ghost` is `undefined`.

- [ ] **Step 3: Add the cap constant**

At `index.html:1050`, after the `GHOST_CHOICES` line added in Task 2, add:

```js
const GHOST_CHECK_MAX = 3;                        // ghost words verdicted per message
```

- [ ] **Step 4: Read the targets before the await**

In `gradeTurn()`, at `index.html:3212`, the block that reads the drill state
before the first `await` currently ends:

```js
    const tag = currentActivity() === "drill" ? drillTag() : "";
    const eg = tag ? drillExample() : "";
    const word = tag ? drillWord() : "";
```

Add two lines after it:

```js
    /* Same reason as the three above: read BEFORE the await. Switching activity
     * mid-grade must not attach this conversation's ghost targets to another
     * one's verdict. */
    const ghosting = currentActivity() === "focused";
    const ghostTargets = ghosting ? reuseFor("focused").map(e => e.w) : [];
```

- [ ] **Step 5: Ask the question**

In `gradeTurn()`, immediately after the drill-target `if (g && check) { … }`
block (ends `index.html:3242`) and before `if (g) await nameDrillWords(...)`,
insert:

```js
    /* Ghost Words asks the drill's question about its own targets: was this
     * word attempted, and was it right, judged apart from everything else in
     * the sentence. Same prompt, same word arm, no tag -- reused character for
     * character, so no A/B run is owed for it.
     *
     * Only here. Putting it on every chat message would put a model call on the
     * grader's hot path, which BACKLOG.md names as the binding cost constraint
     * on the whole app; outside this activity the whole-sentence fallback in
     * HSKMistakes.ghostVerdict() does the job for free.
     *
     * Only for targets the sentence actually contains, and at most
     * GHOST_CHECK_MAX of them: the banner shows six, a real sentence reaches
     * for one or two, and the cap is what stops a word-salad message costing
     * six calls.
     *
     * Its own try per word, like the drill check above: a failed question must
     * leave the grade -- and the other words' answers -- standing. A word with
     * no entry falls back to the whole-sentence verdict, so a failure can never
     * demote anything. */
    if (g && ghosting && ghostTargets.length) {
      const inMsg = new Set(HSK.segment(turnObj.text, S.lex)
        .filter(tok => tok.kind === "word").map(tok => tok.text));
      for (const w of ghostTargets.filter(x => inMsg.has(x)).slice(0, GHOST_CHECK_MAX)) {
        try {
          const v = jsonIn(await callModel([{ role: "user",
            content: HSKPrompt.drillCheck({ text: turnObj.text,
              label: levelLabel(), drillWord: w }) }], 120, teachingModel()));
          if (v) {
            g.ghost = g.ghost || {};
            g.ghost[w] = { used: v.used === true, ok: v.ok === true };
          }
        } catch (e) { console.warn("[ghost check] " + ((e && e.message) || e)); }
      }
    }
```

- [ ] **Step 6: Run the browser suite to verify it passes**

Run: `node test/browser.test.js`
Expected: PASS, including the three new labels.

- [ ] **Step 7: Run the whole suite**

Run: `sh test/run.sh`
Expected: every suite passes.

- [ ] **Step 8: Commit**

```bash
git add index.html test/browser.test.js
git commit -m "feat: judge the ghost word, not the sentence around it

drillCheck's word arm, reused character for character -- the
same question the drill already asks, about the words Ghost
Words is pushing. A word used correctly in a sentence that went
wrong elsewhere now counts, and the other mistake still lands
under its own tag: nothing forgiven, only attributed.

Capped at three words a message and confined to this one
activity, because the alternative is a model call on every chat
message the grader sees.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Show the progress

**Files:**
- Modify: `index.html:2194-2205` — `ghostBanner()`
- Modify: `index.html:4230-4238` — the starters-strip note for the activity
- Modify: `index.html:5503-5510` — the progress panel's "never used" row
- Modify: `index.html:615-617` — the Settings note pointing at that row
- Test: `test/browser.test.js` — extend the Ghost Words section

**Interfaces:**
- Consumes: `readiness().unused` rows with `ghostN` and `ghostToday` (Task 3);
  `S.ghostUses` (Task 2)
- Produces: no new interfaces

- [ ] **Step 1: Write the failing test**

In `test/browser.test.js`, in the Ghost Words section, add:

```js
    await exec("window.S.chatMsgs.ghosttest = " + JSON.stringify([{
      role: "user", text: "苹果", id: "gb1",
      created_at: "2026-09-01T10:00:00Z", grade: { ok: true, errors: [] }
    }]) + "; window.newChat('focused'); window.renderAll(); return true;");
    const banner = await exec("return document.querySelector('#log').innerHTML;");
    check(/1\s*\/\s*3/.test(banner),
      "the banner shows how far along a ghost word is, not just its name",
      banner.slice(0, 400));
    await exec("delete window.S.chatMsgs.ghosttest; return true;");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node test/browser.test.js`
Expected: FAIL on "the banner shows how far along a ghost word is".

- [ ] **Step 3: Rewrite the banner**

At `index.html:2194`, replace `ghostBanner()`:

```js
  function ghostBanner() {
    if (currentActivity() !== "focused") return "";
    const targets = reuseFor("focused");
    if (targets && targets.length) {
      return '<div class="hint"><b>Ghost Words</b><br>Try to use these words in your replies:<br>' +
        '<b style="color:var(--accent);font-size:22px">' +
        targets.slice(0, 6).map(e => e.w).join(" ") + '</b><br>' +
        '<span style="color:var(--dim)">The partner will ask questions that need them.</span></div>';
    }
    return '<div class="hint"><b>Ghost Words</b><br>No unused words yet.<br>' +
      'Turn on <b>Introduce words from the next level</b> in Settings → Learning, ' +
      'chat for a while, then switch back here.</div>';
  }
```

with:

```js
  function ghostBanner() {
    if (currentActivity() !== "focused") return "";
    const targets = reuseFor("focused");
    if (targets && targets.length) {
      /* Each word with its own count, and a tick on the ones already credited
       * today. Both are load-bearing rather than decoration: at most one use a
       * day counts, so a word that has had its credit will not move however
       * much more you write it, and a counter that silently refuses to move is
       * the exact failure drillWhyNot() was written to fix. */
      const chips = targets.slice(0, 6).map(e =>
        '<span style="display:inline-block;margin:0 10px 4px 0' +
          (e.ghostToday ? ';opacity:.55' : '') + '">' + escapeHtml(e.w) +
        '<span style="font-size:14px;color:var(--dim)"> ' +
          (e.ghostN || 0) + "/" + S.ghostUses +
          (e.ghostToday ? " ✓" : "") + "</span></span>").join("");
      return '<div class="hint"><b>Ghost Words</b><br>Try to use these words in your replies:<br>' +
        '<b style="color:var(--accent);font-size:22px">' + chips + '</b><br>' +
        '<span style="color:var(--dim)">The partner will ask questions that need them. ' +
        'One use counts per day, and only the word itself is judged — a mistake ' +
        'elsewhere in the sentence does not cost you the credit. ✓ means today is ' +
        'already banked.</span></div>';
    }
    return '<div class="hint"><b>Ghost Words</b><br>No unused words yet.<br>' +
      'Turn on <b>Introduce words from the next level</b> in Settings → Learning, ' +
      'chat for a while, then switch back here.</div>';
  }
```

- [ ] **Step 4: Update the starters-strip note**

At `index.html:4231`, replace:

```js
  if (cur === "focused") {
    const targets = reuseFor("focused");
    if (targets && targets.length) {
      note = "Focus words: " + targets.slice(0, 6).map(e => e.w).join("、") +
        " — tap words in chat for pinyin/meaning";
    } else {
```

with:

```js
  if (cur === "focused") {
    const targets = reuseFor("focused");
    if (targets && targets.length) {
      /* The same n/N the banner shows. This strip is visible while the banner
       * has scrolled away, and "why is 苹果 still here" is the question it
       * would otherwise leave unanswered. */
      note = "Focus words: " + targets.slice(0, 6).map(e =>
          e.w + " " + (e.ghostN || 0) + "/" + S.ghostUses).join("、") +
        " — tap words in chat for pinyin/meaning";
    } else {
```

- [ ] **Step 5: Relabel the progress panel row**

At `index.html:5503`, replace:

```js
    (r.unused.length
      ? "<tr><td>never used</td><td>" + r.unused.length + " of the " + r.met +
        " the app taught you — try " +
```

with:

```js
    (r.unused.length
      ? "<tr><td>not yet yours</td><td>" + r.unused.length + " of the " + r.met +
        " the app taught you — used correctly fewer than " + S.ghostUses +
        " times — try " +
```

- [ ] **Step 6: Fix the Settings note that names the old row**

At `index.html:615`, replace:

```html
      <div class="note" style="margin-top:8px">Words you have never written yourself (the <b>never used</b> row below) are exactly
      what <b>Ghost Words</b> activity is for — switch to it in the header and the partner will
      lead you toward them.</div>
```

with:

```html
      <div class="note" style="margin-top:8px">Words you have not yet used enough times to own (the <b>not yet yours</b> row below) are exactly
      what <b>Ghost Words</b> activity is for — switch to it in the header and the partner will
      lead you toward them.</div>
```

- [ ] **Step 7: Run the browser suite to verify it passes**

Run: `node test/browser.test.js`
Expected: PASS, including the new banner label.

If an existing assertion in that suite matched the literal string
`never used`, update it to the new wording rather than reverting the copy.

- [ ] **Step 8: Run the whole suite**

Run: `sh test/run.sh`
Expected: every suite passes.

- [ ] **Step 9: Commit**

```bash
git add index.html test/browser.test.js
git commit -m "feat: say how far along each ghost word is

A bare list of words cannot explain why a word you used
correctly this morning is still sitting there. The count and the
already-banked tick are what make the day rule and the demotion
legible at all.

'never used' was no longer true of the panel row, so it says
what it now means.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Docs and release

**Files:**
- Modify: `RESEARCH.md` — new subsection after "Drilling a mistake category";
  rewrite part of "Production"
- Modify: `README.md:1172` area — one line about the Pleco dialog
- Modify: `BACKLOG.md` — new entry for expanding intervals
- Modify: `index.html:1043` — `VERSION` to `v95`
- Modify: `sw.js:10` — `CACHE` to `hsk-chat-v95`

**Interfaces:**
- Consumes: everything above
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Add the RESEARCH.md subsection**

After the "Drilling a mistake category" section and before "## Production", add:

```markdown
## Retiring a ghost word

**Informed by the literature; the numbers themselves are not measured.**
`GHOST_USES = 3` by default (settable 1–6), at most one credit per word per
calendar day, and a wrong use costs one credit back.

The Ghost Words activity targets words the app taught and the learner has never
written. Until v95 a single clean message retired one, which is the bottom of
every estimate in "How many encounters a word needs" read at its most generous
— and read about *production*, where that literature is about *reception*.

**Massing and spacing do different jobs, in that order.** A ghost word is a new
word with no track record of error, so the backsliding argument that drives the
drill's spacing cap does not apply to it in the same way. That is true and
incomplete: the literature splits repetition by purpose, with massed repetition
helping initial encoding and spaced repetition driving retention. Both apply, at
different scales. Within a day, repeated production is the encoding work and is
not limited — write the word as often as you like. Across days, only the first
correct use counts, because that is the interval that predicts whether the word
survives the week.

The per-day cap is therefore the same rule, and the same `dayKey()`, as the
drill's, and it is here for the same reason recorded there: session length must
not be able to move the number.

**Why 3.** It is the bottom of the window in which most semantic gain lands
(three to seven exposures), and under the day rule it now means three separate
days rather than three sentences in a row. It is a *productive* threshold and is
not derived from the receptive studies behind `PROMOTE_AT = 6`; it is a setting
rather than a constant precisely because it is unmeasured.

**Why a slip costs one and not everything.** Until v95 failure was free: a wrong
use of a ghost word simply did not count, so progress was a ratchet that only
clicked forward and a learner could grind out a word regardless of how many
attempts missed. Anki demotes a lapsed card, and something had to. Full reset
was rejected: at a threshold of three, one slip on day three would send the word
back to nothing, which is the shape of rule this document already warns against
for the mistake count — punishing the outcome the feature exists to produce.
Demote-by-one is the proportionate version.

**Flat intervals, not expanding ones.** This is a one-day Leitner interval.
Expanding intervals — a retired word returning at 7 days, then 30, as a
retention check — are the better answer and were declined as a scheduler rather
than a threshold. See BACKLOG.md.
```

- [ ] **Step 2: Amend the Production section**

In "## Production", after the paragraph beginning "What is actionable is a
**list, not a gauge**", append:

```markdown
That distinction is load-bearing and survives v95, which put a threshold on the
list. The argument above is an argument about **gauges**: there is no defensible
percentage of production to aim at, so the coverage bars carry no target and
still do. The list is the instrument this section recommends *instead* of a
gauge, and "have you used this word enough times to own it" is a question about
one word rather than a ratio over all of them. The threshold lives on the list
and nowhere else — see "Retiring a ghost word".
```

- [ ] **Step 3: Note the Pleco dialog in README.md**

At `README.md:1172`, the bullet describing "Look up in Pleco" ends with "Works
on both platforms." Append to that bullet:

```markdown
  iOS Safari asks "Open in Pleco?" before it launches, every time. That
  confirmation belongs to the browser and a web page has no way to suppress it —
  there is nothing in this app to turn off.
```

- [ ] **Step 4: Add the backlog entry**

Append to `BACKLOG.md`:

```markdown
---

## Ghost words retire and never come back

**Found:** designing the ghost-word credit rule, 2026-09-10.

`GHOST_USES` credits on separate days retire a word from the ghost list
permanently. That is a flat one-day Leitner interval and it covers initial
encoding only. Nothing ever re-checks the word, so a word owned in September and
forgotten by November shows as owned forever.

Expanding intervals were considered and declined during design as a scheduler
rather than a threshold: the ghost list would need a due/not-due state per word,
the banner would need to show it, and a day with nothing due would need a
fallback so the activity never opens empty. The scheduling itself is cheap and
needs no stored state — every credit already carries a message timestamp, so a
due date is a pure function of the credit history, the same way the count is.

**What would settle it:** decide whether Ghost Words is an *acquisition*
activity that should hand finished words off, or a *review* activity that should
keep them. If the latter, the interval ladder is the small part and the empty-day
fallback is the design work.
```

- [ ] **Step 5: Bump the version in both files**

At `index.html:1043`:

```js
const VERSION   = "v95 — 2026-09-10";
```

At `sw.js:10`:

```js
const CACHE = "hsk-chat-v95";
```

- [ ] **Step 6: Run the whole suite**

Run: `sh test/run.sh`
Expected: every suite passes. `test/release.test.js` is the one that fails if
`VERSION` and `CACHE` disagree or if a loaded file is missing from `SHELL`.

- [ ] **Step 7: Commit**

```bash
git add RESEARCH.md README.md BACKLOG.md index.html sw.js
git commit -m "docs: why three uses, and why a slip costs one

RESEARCH.md gains the reasoning behind GHOST_USES and the
demotion, and its Production section says explicitly that the
no-threshold argument is about gauges -- the list it recommends
instead now carries one.

The Pleco dialog is iOS Safari's and cannot be suppressed from a
page; README says so before someone tries again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification before calling this done

- [ ] `sh test/run.sh` — every suite green, browser suite actually ran (its
      labels appear in the output; it exits 0 silently without firefox and
      geckodriver).
- [ ] `grep -n "never used" index.html` returns only matches that are still
      true after Task 5's relabel.
- [ ] `grep -n VERSION index.html; grep -n CACHE sw.js` — both say v95.
- [ ] Open the app, switch to Ghost Words, and confirm the banner shows `0/3`
      against each target before any practice.
