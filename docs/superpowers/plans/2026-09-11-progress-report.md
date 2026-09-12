# Progress Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A button in Settings → Learning that reads the learner's whole history and writes back a short piece of prose — what went well, what to focus on, and what changed since last time.

**Architecture:** A new pure module `report.js` aggregates the history into a compact **brief** object; the same function run twice (once over all history, once cut at the last report's timestamp) produces the delta with no second code path. The brief plus a capped sample of the learner's own sentences goes to the teaching model, which writes the English prose. One short Chinese line is composed from HSK 1 templates rather than generated, so it costs no tokens and cannot hallucinate.

**Tech Stack:** Plain ES5-style JavaScript in the browser, no build step, no bundler, no dependencies anywhere including tests. Node runs the test suites directly.

**Spec:** `docs/superpowers/specs/2026-09-11-progress-report-design.md`

## Global Constraints

Copied from CLAUDE.md and the spec. Every task's requirements implicitly include this section.

- **No build step, no bundler, no `package.json`, no dependencies — anywhere, including tests.** Do not add any.
- **Every extracted module ends with the same wrapper.** `report.js` must end with:
  ```js
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKReport = api;
  ```
- **Tests are plain node**, no framework: a `check(ok, label, detail)` counter, `process.exit(1)` at the end. Write new tests the same way. Run everything with `sh test/run.sh`; one suite with `node test/report.test.js`.
- **`.githooks/pre-commit` runs the whole suite and refuses a failing commit.** Every commit step in this plan therefore runs the suite whether you ask it to or not.
- **Any file the page loads must appear in `sw.js` TWICE** — the `SHELL` array (`sw.js:15`) and the `isShell` regex (`sw.js:20`). `cache.addAll` is all-or-nothing: one missing path and the worker never installs and offline support disappears silently.
- **`VERSION` in `index.html` and `CACHE` in `sw.js` must move together.** `release.test.js` enforces both this and the `SHELL` rule.
- **Prompt changes need a real-model A/B with counted outcomes before shipping** (Task 8). The suite can only check that the words you wrote are in the string.
- **Names contaminate a vocabulary measurement.** 王, 李 and 明 are all above HSK 1. Run measurement fixtures name-free.
- **`PREFS_KEYS` in `sync.js` must never name `key` or `history`.** `test/sync.test.js` asserts this.
- **Constants, fixed by the spec:** `FLOOR = 10` new graded messages, `WINDOW_DAYS = 14` fallback window, `SAMPLES = 3` quoted sentences.
- **Activity ids are exactly:** `chat`, `focused`, `drill`, `story`, `twenty` (`prompt.js:322-381`).
- **The browser suite cannot see page-level `const`s.** `S` is unreachable from the WebDriver sandbox. Seed through `localStorage` and `go(base)`, the idiom the suite already uses everywhere.
- **Do not commit to `main`.** Work stays on `feature/progress-report`.

---

## File Structure

| File | Responsibility |
|---|---|
| `report.js` (create) | Pure aggregation: history in, brief out. Plus sample selection and the Chinese line. No DOM. |
| `test/report.test.js` (create) | Node suite for everything in `report.js`. |
| `prompt.js` (modify) | `report()` prompt builder, exported on the `HSKPrompt` api. |
| `test/prompt.test.js` (modify) | Asserts the prompt string carries what it must. |
| `index.html` (modify) | Script tag, state keys, brief assembly from live state, the model call, the button and sheet. |
| `sw.js` (modify) | `report.js` in `SHELL` and in `isShell`; `CACHE` bump. |
| `sync.js` (modify) | Two new `PREFS_KEYS` entries. |
| `test/sync.test.js` (modify) | Asserts the new keys sync. |
| `test/browser.test.js` (modify) | End-to-end: press the button, assert render, persistence, and failure behaviour. |
| `tools/report-ab.js` (create) | Real-model measurement, two counters, four arms. |
| `README.md` (modify) | Documents the feature for the human reader. |

---

### Task 1: `report.js` — graded turns and the all-time brief

**Files:**
- Create: `report.js`
- Create: `test/report.test.js`

**Interfaces:**
- Consumes: nothing. First task.
- Produces: `HSKReport.gradedTurns(chatMsgs, since)` → array of message objects sorted oldest-first. `HSKReport.brief(input)` → brief object. `HSKReport.FLOOR` (10), `HSKReport.WINDOW_DAYS` (14), `HSKReport.SAMPLES` (3).

The `brief(input)` input object — every caller must supply all of these:

```js
{
  chatMsgs: {},      // conversation id -> array of messages (S.chatMsgs)
  chats: [],         // conversation rows, each may carry .id and .activity (S.chats)
  learning: [],      // S.learning: the words the app has taught, however long ago
  tags: [],          // HSKMistakes.counts() output: array of {tag, n, eg, better, ...}
  ghost: {},         // ghostProgressMap() output: word -> {n, last}
  ghostUses: 3,      // S.ghostUses, the retirement threshold
  level: 1, goalLevel: 4,
  coverage: { read: 0, use: 0 },   // fractions 0..1, from readiness()
  minutes: 0,        // whole minutes on task
  since: null,       // ISO string, or null for all time
  now: Date.now()
}
```

The brief it returns:

```js
{
  since: null,                  // echoes input.since
  level: 1, goalLevel: 4,
  coverage: { read: 0, use: 0 },
  minutes: 0,
  messages: { graded: 0, clean: 0 },
  words: { met: 0 },            // NOT time-filtered: a word taught stays taught
  ghost: { credits: 0, retired: 0, working: 0 },
  tags: [],                     // top 3 slots, each {tag, n, eg, better}
  activities: { chat: 0, focused: 0, drill: 0, story: 0, twenty: 0 }
}
```

- [ ] **Step 1: Write the failing test**

Create `test/report.test.js`:

```js
/* Progress report aggregation. Run: node test/report.test.js */
const R = require("../report.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

const NOW = Date.parse("2026-09-11T12:00:00Z");
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();

// A graded user message. `ok` is the whole-sentence verdict.
const turn = (when, ok, text) => ({
  role: "user", text: text || "我吃饭", created_at: when,
  grade: { ok: ok, errors: [] }
});

// The input brief() needs, with sensible empties. Override what a test cares about.
const input = (over) => Object.assign({
  chatMsgs: {}, chats: [], learning: [], tags: [], ghost: {}, ghostUses: 3,
  level: 1, goalLevel: 4, coverage: { read: 0, use: 0 },
  minutes: 0, since: null, now: NOW
}, over || {});

// --- graded turns ----------------------------------------------------------

check(R.gradedTurns({ a: [turn(daysAgo(1), true)] }).length === 1,
  "a graded user message is a graded turn");
check(R.gradedTurns({ a: [{ role: "assistant", text: "x", created_at: daysAgo(1) }] })
  .length === 0, "the partner's messages are not");
check(R.gradedTurns({ a: [{ role: "user", text: "x", created_at: daysAgo(1) }] })
  .length === 0, "and neither is an ungraded message: nothing is known about it");
check(R.gradedTurns({ a: [turn(daysAgo(1), true)], b: [turn(daysAgo(2), true)] })
  .length === 2, "turns are gathered across every conversation");
check(R.gradedTurns({ a: [turn(daysAgo(1), true, "new")],
                      b: [turn(daysAgo(9), true, "old")] })[0].text === "old",
  "and returned oldest first, whatever order the conversations came in");

// --- the all-time brief ----------------------------------------------------

const b1 = R.brief(input({
  chatMsgs: { a: [turn(daysAgo(1), true), turn(daysAgo(2), false),
                  turn(daysAgo(3), true)] }
}));
check(b1.messages.graded === 3, "every graded message counts", JSON.stringify(b1.messages));
check(b1.messages.clean === 2, "and the clean ones are counted separately");
check(b1.since === null, "an all-time brief echoes a null baseline");
check(R.brief(input({ learning: [{ w: "苹果" }, { w: "说话" }] })).words.met === 2,
  "words the app has taught are counted, however long ago it taught them");

// --- explicit zeroes -------------------------------------------------------

check(b1.activities.story === 0 && b1.activities.twenty === 0 &&
      b1.activities.drill === 0,
  "an untouched activity is a zero, never an absent key: a model handed a gap fills it",
  JSON.stringify(b1.activities));
check(Object.keys(b1.activities).length === 5,
  "all five activities are always present", JSON.stringify(b1.activities));

const b2 = R.brief(input({
  chats: [{ id: "a", activity: "focused" }, { id: "b", activity: "story" },
          { id: "c", activity: "focused" }],
  chatMsgs: { a: [turn(daysAgo(1), true)], b: [turn(daysAgo(1), true)],
              c: [turn(daysAgo(1), true)] }
}));
check(b2.activities.focused === 2 && b2.activities.story === 1 &&
      b2.activities.chat === 0,
  "conversations are counted by their activity", JSON.stringify(b2.activities));

// --- ghost words -----------------------------------------------------------

const b3 = R.brief(input({
  ghost: { "苹果": { n: 3, last: "2026-09-10" },
           "说话": { n: 1, last: "2026-09-09" },
           "可以": { n: 0, last: "" } },
  ghostUses: 3
}));
check(b3.ghost.credits === 4, "ghost credits are summed across every word",
  JSON.stringify(b3.ghost));
check(b3.ghost.retired === 1, "a word at the threshold is retired");
check(b3.ghost.working === 1,
  "a word part-way there is in progress; one at zero is neither");

// --- tags ------------------------------------------------------------------

const b4 = R.brief(input({
  tags: [{ tag: "aspect-le", n: 5, eg: "a", better: "b", note: "n" },
         { tag: "measure-word", n: 3, eg: "c", better: "d", note: "n" },
         { tag: "order", n: 2, eg: "e", better: "f", note: "n" },
         { tag: "tone", n: 1, eg: "g", better: "h", note: "n" }]
}));
check(b4.tags.length === 3, "at most three categories reach the brief",
  JSON.stringify(b4.tags));
check(b4.tags[0].tag === "aspect-le", "commonest first, as counts() already sorted them");
check(b4.tags[0].note === undefined,
  "and only the fields the prompt uses: the note is the grader talking to the learner, not to us",
  JSON.stringify(b4.tags[0]));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node test/report.test.js`
Expected: FAIL — `Cannot find module '../report.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `report.js`:

```js
/* What the learner has actually done, reduced to something a model can read.
 *
 * Everything here is derived by scanning and never stored, like mistakes.js.
 * The app is already full of GAUGES -- coverage bars, the mistake ledger, the
 * not-yet-yours row -- so the job of this module is not to produce another
 * number. It is to produce a small, complete, honest object, so the prose
 * written from it can be specific without being invented.
 *
 * No DOM. Segmentation and the live lexicon are index.html's business; what
 * arrives here is already counted. */
(function (root) {
  "use strict";

  /* New graded messages needed before "since you last checked" can say anything.
   * Ten is roughly one sitting, which is the smallest unit about which anything
   * true can be said. Below it the report widens rather than showing an empty
   * delta -- see WINDOW_DAYS. */
  var FLOOR = 10;

  /* What the report covers when FLOOR is not met. Two weeks of ordinary use:
   * long enough that the fallback is never empty, short enough to still be
   * recent. */
  var WINDOW_DAYS = 14;

  /* Sentences quoted back at the learner. Three is enough to show evidence
   * without the prompt turning into a transcript -- and the cap is the whole
   * reason prompt size does not grow with history. */
  var SAMPLES = 3;

  /* Every activity, always, so the brief can carry an explicit zero for the
   * ones untouched. Kept in step with prompt.js ACTIVITIES by report.test.js. */
  var ACTIVITY_IDS = ["chat", "focused", "drill", "story", "twenty"];

  var TAGS_SHOWN = 3;

  /* Graded user messages across every conversation, oldest first.
   *
   * Ungraded messages contribute nothing: the grader being off, or a message
   * still in flight, is not evidence about the learner either way. Same rule
   * mistakes.js applies, for the same reason. */
  function gradedTurns(chatMsgs, since) {
    var out = [];
    Object.keys(chatMsgs || {}).forEach(function (cid) {
      (chatMsgs[cid] || []).forEach(function (t) {
        if (!t || t.role !== "user" || !t.grade) return;
        if (since && String(t.created_at || "") < since) return;
        out.push(t);
      });
    });
    return out.sort(function (a, b) {
      var x = String(a.created_at || ""), y = String(b.created_at || "");
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }

  function brief(input) {
    input = input || {};
    var since = input.since || null;
    var turns = gradedTurns(input.chatMsgs, since);

    var clean = 0;
    turns.forEach(function (t) { if (t.grade && t.grade.ok === true) clean++; });

    var activities = {};
    ACTIVITY_IDS.forEach(function (id) { activities[id] = 0; });
    (input.chats || []).forEach(function (c) {
      var id = (c && c.activity) || "chat";
      if (activities[id] === undefined) return;   // an id we do not know is not invented
      activities[id]++;
    });

    var ghost = { credits: 0, retired: 0, working: 0 };
    var need = input.ghostUses || 0;
    Object.keys(input.ghost || {}).forEach(function (w) {
      var n = (input.ghost[w] && input.ghost[w].n) || 0;
      ghost.credits += n;
      if (need && n >= need) ghost.retired++;
      else if (n > 0) ghost.working++;
    });

    /* Only the fields the prompt actually uses. `note` is the grader talking to
     * the learner about one sentence; passing it on invites the report to
     * repeat advice it has no basis to repeat. */
    var tags = (input.tags || []).slice(0, TAGS_SHOWN).map(function (s) {
      return { tag: s.tag, n: s.n, eg: s.eg, better: s.better };
    });

    return {
      since: since,
      level: input.level || 1,
      goalLevel: input.goalLevel || 1,
      coverage: input.coverage || { read: 0, use: 0 },
      minutes: input.minutes || 0,
      messages: { graded: turns.length, clean: clean },
      /* Deliberately NOT cut by `since`: a word the app taught six months ago is
       * still a word it taught. Filtering it would make the since-brief claim
       * the learner had un-met words. */
      words: { met: (input.learning || []).length },
      ghost: ghost,
      tags: tags,
      activities: activities
    };
  }

  var api = { gradedTurns: gradedTurns, brief: brief,
              FLOOR: FLOOR, WINDOW_DAYS: WINDOW_DAYS, SAMPLES: SAMPLES,
              ACTIVITY_IDS: ACTIVITY_IDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/report.test.js`
Expected: PASS, every check green.

- [ ] **Step 5: Add the suite to the runner**

In `test/run.sh`, add `test/report.test.js` to the `for t in ...` list, after `test/mistakes.test.js`.

- [ ] **Step 6: Run the whole suite**

Run: `sh test/run.sh`
Expected: every suite passes, `report.test.js` among them.

- [ ] **Step 7: Commit**

```bash
git add report.js test/report.test.js test/run.sh
git commit -m "feat: reduce a history to something a model can read"
```

---

### Task 2: The cutoff and the floor

**Files:**
- Modify: `report.js`
- Modify: `test/report.test.js`

**Interfaces:**
- Consumes: `HSKReport.brief`, `HSKReport.gradedTurns`, `HSKReport.FLOOR`, `HSKReport.WINDOW_DAYS` from Task 1.
- Produces: `HSKReport.baselineFor(chatMsgs, lastAt, now)` → `{ since: <ISO string>, fellBack: <bool> }`. Callers pass `since` straight into `brief()`.

The delta is **the same `brief()` run twice** — once with `since: null`, once with the baseline. There is deliberately no `delta()` function: subtraction of two briefs would be a second code path that could drift from the first.

- [ ] **Step 1: Write the failing test**

Append to `test/report.test.js`, before the `console.log` summary:

```js
// --- the baseline ----------------------------------------------------------

// 12 graded messages, one a day, days 1..12 back.
const many = {};
many.a = [];
for (let i = 1; i <= 12; i++) many.a.push(turn(daysAgo(i), true));

const bl1 = R.baselineFor(many, daysAgo(20), NOW);
check(bl1.since === daysAgo(20) && bl1.fellBack === false,
  "plenty of new messages since the last report: that report is the baseline",
  JSON.stringify(bl1));

const bl2 = R.baselineFor(many, daysAgo(3), NOW);
check(bl2.fellBack === true,
  "too few since the last report: fall back rather than show an empty delta",
  JSON.stringify(bl2));
check(bl2.since === new Date(NOW - R.WINDOW_DAYS * 86400000).toISOString(),
  "and the fallback covers exactly WINDOW_DAYS", JSON.stringify(bl2));

const bl3 = R.baselineFor(many, null, NOW);
check(bl3.since === null && bl3.fellBack === false,
  "no previous report at all is not a fallback: it is the first report, and it covers everything",
  JSON.stringify(bl3));

check(R.baselineFor({}, daysAgo(30), NOW).fellBack === true,
  "an empty history falls back too, rather than reporting on nothing");

// The floor is a count of messages, not a span of time. Three days away from
// the app and three days of hard practice must not produce the same answer.
const busy = { a: [] };
for (let i = 0; i < 15; i++) busy.a.push(turn(daysAgo(1), true));
check(R.baselineFor(busy, daysAgo(2), NOW).fellBack === false,
  "one hard day clears the floor, though barely any time has passed");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node test/report.test.js`
Expected: FAIL — `R.baselineFor is not a function`

- [ ] **Step 3: Write the implementation**

In `report.js`, add above `brief()`:

```js
  /* Which moment the report's "since you last checked" section counts from.
   *
   * The baseline is the last report, unless too little has happened since for
   * that to say anything -- in which case the report widens to WINDOW_DAYS and
   * says so. The floor is a COUNT of graded messages rather than a span of
   * time on purpose: three days away from the app and three days of hard
   * practice are not the same event, and a clock cannot tell them apart.
   *
   * A learner with no previous report is not falling back. Their first report
   * covers everything, which is exactly right. */
  function baselineFor(chatMsgs, lastAt, now) {
    if (!lastAt) return { since: null, fellBack: false };
    if (gradedTurns(chatMsgs, lastAt).length >= FLOOR) {
      return { since: lastAt, fellBack: false };
    }
    return {
      since: new Date((now || Date.now()) - WINDOW_DAYS * 86400000).toISOString(),
      fellBack: true
    };
  }
```

Add `baselineFor: baselineFor,` to the `api` object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/report.test.js`
Expected: PASS, every check green — the earlier ones still among them.

- [ ] **Step 5: Commit**

```bash
git add report.js test/report.test.js
git commit -m "feat: a quiet week widens the window instead of reporting nothing"
```

---

### Task 3: Picking the sentences to quote

**Files:**
- Modify: `report.js`
- Modify: `test/report.test.js`

**Interfaces:**
- Consumes: `HSKReport.gradedTurns`, `HSKReport.SAMPLES` from Task 1.
- Produces: `HSKReport.pickSamples(turns, tags)` → array of at most `SAMPLES` objects `{ text, ok, tag }`, where `tag` is `""` for a clean sentence and the error tag for a flawed one.

Selection is deterministic in JS, driven by the numbers — never by the model. The model is shown evidence; it does not choose its own.

- [ ] **Step 1: Write the failing test**

Append to `test/report.test.js`, before the `console.log` summary:

```js
// --- samples ---------------------------------------------------------------

// A graded message carrying a specific error tag.
const flawed = (when, tag, text) => ({
  role: "user", text: text, created_at: when,
  grade: { ok: false, errors: [{ tag: tag, note: "n" }] }
});

const sTurns = R.gradedTurns({ a: [
  turn(daysAgo(9), true, "旧的好句子"),
  turn(daysAgo(1), true, "新的好句子"),
  flawed(daysAgo(2), "aspect-le", "我吃饭了吗"),
  flawed(daysAgo(8), "measure-word", "一个书")
] });
const picks = R.pickSamples(sTurns, [{ tag: "aspect-le", n: 4 }]);

check(picks.length <= R.SAMPLES, "never more than SAMPLES sentences",
  JSON.stringify(picks));
check(picks.some(p => p.text === "新的好句子" && p.ok === true),
  "the most recent clean sentence is quoted: it is the win",
  JSON.stringify(picks));
check(picks.some(p => p.text === "我吃饭了吗" &&
                      p.tag === "aspect-le"),
  "so is a recent sentence in the category they miss most",
  JSON.stringify(picks));
check(!picks.some(p => p.text === "旧的好句子"),
  "the older clean sentence loses to the newer one: recent evidence or none",
  JSON.stringify(picks));
check(R.pickSamples([], [{ tag: "aspect-le", n: 4 }]).length === 0,
  "no history is no samples, not a crash");
check(R.pickSamples(sTurns, []).length > 0,
  "no mistake categories at all still yields the clean sentence");
check(R.pickSamples(sTurns, [{ tag: "aspect-le", n: 4 }])
  .every(p => typeof p.text === "string" && typeof p.ok === "boolean"),
  "every sample is shaped the same, so the prompt builder needs no special cases");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node test/report.test.js`
Expected: FAIL — `R.pickSamples is not a function`

- [ ] **Step 3: Write the implementation**

In `report.js`, add after `brief()`:

```js
  /* The learner's own sentences, chosen BY the numbers rather than by the model.
   *
   * A report that says "your 了 sentences are landing now" is worth reading;
   * the same report without an example is a horoscope. But letting the model
   * pick its own evidence out of a transcript is how a report starts quoting
   * sentences that prove nothing -- so the choosing happens here, in code, and
   * the model receives a fixed, small set.
   *
   * These are the learner's OWN words. A sentence they wrote may contain words
   * above their level and will be shown as written: the out-of-level guarantee
   * is about what the partner GENERATES, and this is neither generated nor the
   * partner's. */
  function pickSamples(turns, tags) {
    var list = (turns || []).slice().reverse();   // newest first
    var out = [], seen = {};

    function take(t, tag) {
      if (!t || seen[t.text]) return;
      seen[t.text] = true;
      out.push({ text: t.text, ok: t.grade.ok === true, tag: tag || "" });
    }

    // The win: the most recent sentence the grader passed whole.
    take(list.filter(function (t) { return t.grade.ok === true; })[0], "");

    // The focus: the most recent sentence in each category they miss most.
    (tags || []).forEach(function (s) {
      if (out.length >= SAMPLES) return;
      take(list.filter(function (t) {
        return (t.grade.errors || []).some(function (e) {
          return e && e.tag === s.tag;
        });
      })[0], s.tag);
    });

    // Whatever is left over, newest first, so a quiet history still shows something.
    list.forEach(function (t) { if (out.length < SAMPLES) take(t, ""); });

    return out.slice(0, SAMPLES);
  }
```

Add `pickSamples: pickSamples,` to the `api` object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/report.test.js`
Expected: PASS, every check green — the earlier ones still among them.

- [ ] **Step 5: Commit**

```bash
git add report.js test/report.test.js
git commit -m "feat: the numbers choose the evidence, not the model"
```

---

### Task 4: The Chinese line

**Files:**
- Modify: `report.js`
- Modify: `test/report.test.js`

**Interfaces:**
- Consumes: the brief from Task 1.
- Produces: `HSKReport.chineseLine(brief)` → a string of Chinese, always non-empty.

Composed from templates whose every word is HSK 1, so it is valid **by construction** at every level the app offers and costs zero tokens. Step 1's test is what actually enforces that claim, by running the real validator over every template at HSK 1.

- [ ] **Step 1: Write the failing test**

Append to `test/report.test.js`, before the `console.log` summary. Note the extra requires at the top of this block — put the two `require` lines with the existing one at the top of the file:

```js
// --- the Chinese line ------------------------------------------------------
// (add to the top of the file, beside the existing require:)
//   const V = require("../validator.js");
//   const HSK1 = require("../data/hsk1.json");

// Every line the module can produce, at HSK 1, checked against the real
// allowlist. This is what makes "valid by construction" a fact rather than a
// claim -- there is no runtime validation anywhere in this path, so if a
// template ever drifts above HSK 1 this is the only thing that will notice.
/* validate() returns an ARRAY of violations -- empty means legal. It does not
 * return an object with .ok; that mistake costs an afternoon. */
const lex1 = V.buildLexicon(HSK1);
const violations = (line) => V.validate(line, lex1);
const lines = [
  R.chineseLine(R.brief(input())),
  R.chineseLine(R.brief(input({ ghost: { "苹果": { n: 3, last: "x" } },
                                ghostUses: 3 }))),
  R.chineseLine(R.brief(input({
    chatMsgs: { a: [turn(daysAgo(1), true), turn(daysAgo(2), true)] } }))),
  R.chineseLine(R.brief(input({ minutes: 45 })))
];
lines.forEach(function (line, i) {
  const v = violations(line);
  check(v.length === 0, "Chinese line " + i + " is inside HSK 1: " + line,
    JSON.stringify(v.map(x => x.text)));
});
check(lines.every(l => l && l.length > 0),
  "there is always a line, even for a learner who has done nothing yet");
check(new Set(lines).size > 1,
  "and it is not the same sentence every time, or it is decoration rather than feedback");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node test/report.test.js`
Expected: FAIL — `R.chineseLine is not a function`

- [ ] **Step 3: Write the implementation**

All four templates below were run through the real validator against
`data/hsk1.json` while this plan was written, and all four come back with zero
violations. 词, 句话, 句子, 一起, 次 and 得 are all ABOVE HSK 1 and were rejected —
which is why the lines read as they do. Do not "improve" the wording without
re-running the test.

In `report.js`, add after `pickSamples()`:

```js
  /* One line of Chinese, composed rather than generated.
   *
   * Every word below is HSK 1, so the line is legal at every level the app
   * offers and needs no validator at runtime, no repair loop, no fallback, and
   * no second model call. report.test.js checks the claim against the real HSK 1
   * allowlist, which is the only thing standing between a future edit and a
   * line that breaks the app's one guarantee.
   *
   * Digits rather than Chinese numerals: 一..十 would need their own
   * spelling-out code for 12, and the learner reads digits fluently from the
   * first day.
   *
   * Chosen by what the learner actually did, so it is feedback and not
   * decoration -- the most specific true thing first. */
  function chineseLine(b) {
    b = b || {};
    var ghost = (b.ghost && b.ghost.retired) || 0;
    var clean = (b.messages && b.messages.clean) || 0;
    var minutes = b.minutes || 0;

    if (ghost > 0) return "你学了 " + ghost + " 个新的字。很好！";
    if (clean > 0) return "你说对了 " + clean + " 个。很好！";
    if (minutes > 0) return "你今天学中文了。很好！";
    return "我们学中文吧！";
  }
```

Add `chineseLine: chineseLine,` to the `api` object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/report.test.js`
Expected: PASS. If a template fails validation, fix the **template**, never the test — the test is the guarantee.

- [ ] **Step 5: Run the whole suite and commit**

```bash
sh test/run.sh
git add report.js test/report.test.js
git commit -m "feat: one line of Chinese that cannot be wrong"
```

---

### Task 5: `HSKPrompt.report()`

**Files:**
- Modify: `prompt.js`
- Modify: `test/prompt.test.js`

**Interfaces:**
- Consumes: the brief (Task 1) and samples (Task 3), as data.
- Produces: `HSKPrompt.report(opts)` → prompt string. `opts` is `{ brief, sinceBrief, samples, fellBack, label }` where `label` is the level label string (e.g. `"HSK 2"`), `brief` is the all-time brief, `sinceBrief` is the brief since the baseline, and `samples` is `pickSamples()`'s output.

- [ ] **Step 1: Write the failing test**

Find the end of `test/prompt.test.js` and add before its summary block:

```js
// --- the progress report ---------------------------------------------------

const rBrief = {
  level: 2, goalLevel: 4, coverage: { read: 0.93, use: 0.7 }, minutes: 120,
  messages: { graded: 40, clean: 30 }, words: { met: 40 },
  ghost: { credits: 9, retired: 2, working: 3 },
  tags: [{ tag: "aspect-le", n: 5, eg: "我吃饭吗", better: "我吃饭了吗" }],
  activities: { chat: 4, focused: 2, drill: 0, story: 0, twenty: 0 }
};
const rp = HSKPrompt.report({
  brief: rBrief, sinceBrief: rBrief, fellBack: false, label: "HSK 2",
  samples: [{ text: "我吃饭", ok: true, tag: "" }]
});

check(rp.indexOf("HSK 2") !== -1, "the report prompt names the level");
check(rp.indexOf("aspect-le") !== -1 || rp.indexOf("了") !== -1,
  "and the categories being missed");
check(rp.indexOf("我吃饭") !== -1,
  "and quotes the learner's own sentence as evidence");
check(/TAUGHT THEM SO FAR: 40/.test(rp),
  "words taught are stated once, outside both time blocks: teaching is not an event in a window",
  rp.slice(0, 400));
/* The one instruction that matters. A report that invents progress is worse
 * than no report: it is misinformation about the learner's own learning. */
check(/must come from|only.*numbers.*above|do not invent/i.test(rp),
  "and forbids stating any number the brief does not contain", rp.slice(0, 400));
check(rp.indexOf("drill") !== -1 && rp.indexOf("0") !== -1,
  "quiet activities appear with an explicit zero rather than being left out");

const rpFell = HSKPrompt.report({
  brief: rBrief, sinceBrief: rBrief, fellBack: true, label: "HSK 2", samples: []
});
check(rpFell !== rp,
  "a fallen-back report is told so: it must not claim to cover 'since last time'");
check(/two weeks|14 days|recent/i.test(rpFell),
  "and is told what it does cover instead", rpFell.slice(0, 400));
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node test/prompt.test.js`
Expected: FAIL — `HSKPrompt.report is not a function`

- [ ] **Step 3: Write the implementation**

In `prompt.js`, add near `drillCheck()`:

```js
  /* The progress report.
   *
   * English, not Chinese: this is metalanguage about the learner's Chinese, and
   * "you are improving at aspect-le but still drop it in questions" is not
   * expressible inside HSK 2. The one Chinese line the report carries is
   * composed in report.js from HSK 1 templates and never generated here.
   *
   * The brief is rendered as plain labelled lines rather than JSON. A model
   * asked for warm, specific prose writes better from prose than from a data
   * structure, and the numbers are equally checkable either way.
   *
   * Explicit zeroes for quiet activities, not omissions: a model handed a gap
   * fills it. That is an assumption and tools/report-ab.js measures it -- see
   * the `zeroes` and `omit` arms. */
  function report(opts) {
    opts = opts || {};
    var b = opts.brief || {}, s = opts.sinceBrief || {};

    function block(x, name) {
      var acts = Object.keys(x.activities || {}).map(function (k) {
        return k + " " + x.activities[k];
      }).join(", ");
      return name + ":\n" +
        "- messages graded: " + ((x.messages || {}).graded || 0) +
        ", of which the whole sentence was correct: " + ((x.messages || {}).clean || 0) + "\n" +
        "- new words used correctly enough times to own: " + ((x.ghost || {}).retired || 0) +
        "; part-way there: " + ((x.ghost || {}).working || 0) + "\n" +
        "- minutes practising: " + (x.minutes || 0) + "\n" +
        "- conversations by activity: " + acts + "\n";
    }

    var tags = (b.tags || []).length
      ? (b.tags || []).map(function (t) {
          return "- " + t.tag + ", " + t.n + " outstanding. They wrote 「" +
            t.eg + "」 where 「" + t.better + "」 was wanted.";
        }).join("\n")
      : "- none outstanding.";

    var samples = (opts.samples || []).length
      ? (opts.samples || []).map(function (p) {
          return "- 「" + p.text + "」 — " +
            (p.ok ? "correct" : "not correct" + (p.tag ? " (" + p.tag + ")" : ""));
        }).join("\n")
      : "- none yet.";

    return "You are writing a short progress report for a student of Chinese at " +
      (opts.label || "their level") + ". Write to them directly, as \"you\".\n\n" +
      /* Outside both blocks on purpose: a word the app taught is not something
       * that happened during a window, so putting it inside the since-block
       * would read as "they met 40 words this fortnight". */
      "WORDS THE APP HAS TAUGHT THEM SO FAR: " + ((b.words || {}).met || 0) + "\n\n" +
      block(b, "ALL TIME") + "\n" +
      block(s, opts.fellBack
        ? "THE LAST TWO WEEKS (they have not practised much since their last report, " +
          "so this covers a recent window instead)"
        : "SINCE THEIR LAST REPORT") + "\n" +
      "MISTAKE CATEGORIES STILL OUTSTANDING:\n" + tags + "\n\n" +
      "SENTENCES THEY WROTE:\n" + samples + "\n\n" +
      "Write three short paragraphs:\n" +
      "1. What has gone well. Name something specific and quote one of their " +
      "sentences above if it supports the point.\n" +
      "2. What is worth focusing on next. One or two things, not a list.\n" +
      "3. One concrete thing to do in their next conversation.\n\n" +
      "Every number you state must come from the figures above. Do not invent " +
      "progress, and do not estimate. If a figure is zero, either say so plainly " +
      "or say nothing about it — never describe it as progress. Warm and direct, " +
      "no headings, no bullet points, no preamble.";
  }
```

Add `report: report,` to the `api` object at the bottom of `prompt.js` (the object beginning `drillCheck: drillCheck,` around line 1185).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/prompt.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prompt.js test/prompt.test.js
git commit -m "feat: ask for prose, forbid invented numbers"
```

---

### Task 6: Wiring into the app

**Files:**
- Modify: `index.html` (script tag; `K`; `S`; `TEACH_PROMPTS` at :1665; `defaultTeachPrompt`; new functions)
- Modify: `sw.js` (`SHELL` at :15 and `isShell` at :20)
- Modify: `sync.js` (`PREFS_KEYS` at :251)
- Modify: `test/sync.test.js`

**Interfaces:**
- Consumes: `HSKReport.brief`, `baselineFor`, `pickSamples`, `chineseLine`; `HSKPrompt.report`.
- Produces: `window.reportInput(since)` → the `brief()` input assembled from live state. `window.writeReport()` → async, returns `{ ok: true }` or `{ ok: false, why: "..." }`, and on success stores the report. `S.report` (string) and `S.reportAt` (ISO string).

**This task must land the `sw.js` edit in the same commit as the `<script>` tag.** `release.test.js` asserts that every file the page loads is precached, so a commit with the script tag and not the `SHELL` entry cannot pass the pre-commit hook.

- [ ] **Step 1: Write the failing test**

In `test/sync.test.js`, find the `PREFS_KEYS` assertions and add:

```js
check(S.PREFS_KEYS.indexOf("report") !== -1,
  "the report syncs, so re-reading it on another device costs no call");
check(S.PREFS_KEYS.indexOf("reportAt") !== -1,
  "and so does its timestamp, or the delta baseline differs per device");
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node test/sync.test.js`
Expected: FAIL on both new checks.

- [ ] **Step 3: Add the keys and the script tag**

In `sync.js:251`, add `"report", "reportAt",` to `PREFS_KEYS` after `"ghostUses",`.

In `index.html`, beside the other module script tags, add:
```html
<script src="report.js"></script>
```

In `sw.js:15`, add `"./report.js",` to `SHELL` after `"./mistakes.js",`.
In `sw.js:20`, add `report\.js` to the `isShell` alternation after `mistakes\.js`.

In `index.html`'s `K` map (around :1108), add:
```js
  report:"hsk1chat.report", reportAt:"hsk1chat.reportAt",
```

In `S` (around :1160), add:
```js
  report:  store.get(K.report, ""),           // the last progress report, as written
  reportAt: store.get(K.reportAt, ""),        // when it was written; the delta baseline
```

- [ ] **Step 4: Run the suite to verify sync and release pass**

Run: `node test/sync.test.js && node test/release.test.js`
Expected: both PASS. If `release.test.js` fails, the `sw.js` edit is missing or in only one of its two places.

- [ ] **Step 5: Assemble the brief from live state**

In `index.html`, near `readiness()` (around :5501), add:

```js
/* Everything report.js needs, gathered from live state in one place.
 *
 * Segmentation and the lexicon are this file's business, so the ghost map and
 * the mistake counts are computed HERE and handed over already counted --
 * report.js stays pure and node-testable, which is the whole reason it is a
 * separate file. */
function reportInput(since) {
  const r = readiness();
  return {
    chatMsgs: S.chatMsgs, chats: S.chats, learning: S.learning,
    tags: HSKMistakes.counts(S.chatMsgs, { tagLabels: TAG_LABEL,
                                           errorClassTags: ERROR_CLASS_TAGS }),
    ghost: ghostProgressMap(), ghostUses: S.ghostUses,
    level: S.level, goalLevel: S.goalLevel,
    coverage: { read: (r && r.read) || 0, use: (r && r.use) || 0 },
    minutes: Math.round((HSKTime.totals(S.time).total || 0) / 60000),
    since: since || null, now: Date.now()
  };
}
```

Check the real names before writing this: `TAG_LABEL` and `ERROR_CLASS_TAGS` are how `renderMistakes()` calls `HSKMistakes.counts()` — copy that call site exactly. Likewise confirm what `readiness()` actually returns for the two coverage fractions and what `S.time` is called; use the real names, and if `readiness()` returns `null` (no next level) the `|| 0` fallbacks above must still hold.

- [ ] **Step 6: Write the report**

In `index.html`, below `reportInput()`:

```js
/* One model call, and the stored report replaced only if it succeeds.
 *
 * A failed call must leave the previous report standing: a timeout should cost
 * the learner a retry, not last week's report. Everything that can refuse
 * before spending a call does so -- a learner with no graded messages gets a
 * note, not an invented report about nothing. */
async function writeReport() {
  const all = HSKReport.brief(reportInput(null));
  if (!all.messages.graded) {
    return { ok: false, why: "Chat for a while first — there is nothing to report on yet." };
  }
  const base = HSKReport.baselineFor(S.chatMsgs, S.reportAt || null, Date.now());
  const since = HSKReport.brief(reportInput(base.since));
  const samples = HSKReport.pickSamples(
    HSKReport.gradedTurns(S.chatMsgs, base.since), all.tags);
  let text;
  try {
    text = await callModel([{ role: "user", content: teachPromptFor("report", {
      brief: all, sinceBrief: since, samples: samples,
      fellBack: base.fellBack, level: levelLabel()
    }) }], 700, teachingModel());
  } catch (e) {
    return { ok: false, why: "That did not go through — " + ((e && e.message) || e) };
  }
  if (!text || !text.trim()) return { ok: false, why: "The model sent nothing back." };
  S.report = text.trim() + "\n\n" + HSKReport.chineseLine(since);
  S.reportAt = new Date().toISOString();
  store.set(K.report, S.report);
  store.set(K.reportAt, S.reportAt);
  return { ok: true };
}
```

- [ ] **Step 7: Register the prompt**

In `TEACH_PROMPTS` (`index.html:1665`), add a sixth entry:

```js
  { key: "report",       kind: "report",    own: true,
    label: "Progress report" }
```

In `defaultTeachPrompt()` (around :1705), add before the final `return`:

```js
  if (spec.kind === "report") {
    return HSKPrompt.report({ brief: vars.brief, sinceBrief: vars.sinceBrief,
                              samples: vars.samples, fellBack: vars.fellBack,
                              label: vars.level });
  }
```

Note `teachPromptFor()`'s custom-prompt branch only substitutes `{text}`, `{level}`, `{recent}` and `{context}`. A user-edited report prompt therefore gets `{level}` and nothing else — which is correct and needs no change, since the brief has no sensible single-placeholder form.

- [ ] **Step 8: Run the whole suite**

Run: `sh test/run.sh`
Expected: every suite passes.

- [ ] **Step 9: Commit**

```bash
git add index.html sw.js sync.js test/sync.test.js
git commit -m "feat: gather the history and ask for the report"
```

---

### Task 7: The button and the sheet

**Files:**
- Modify: `index.html` (Learning section markup around :600; a new sheet; handlers)
- Modify: `test/browser.test.js`

**Interfaces:**
- Consumes: `writeReport()`, `S.report`, `S.reportAt` from Task 6.
- Produces: `#btnReport`, `#reportSheet`, `#reportBody`, `#reportWrite`, `#reportClose`, and `window.openReport()`.

- [ ] **Step 1: Add the markup**

In the Learning section, after the `#nextProgress` block (`index.html:600`):

```html
      <button id="btnReport" type="button" style="margin-top:14px; width:100%">Progress report</button>
      <div class="note">Reads everything you have done and writes back a few paragraphs —
      what is going well, what is worth working on, and what has changed since last time.
      Opening it is free; writing a new one is one API call.</div>
```

Beside the other sheets (after `#explainSheet`, around :940):

```html
<div class="sheet" id="reportSheet"><div class="card">
  <h2>Progress report</h2>
  <div id="reportBody"></div>
  <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
    <button id="reportClose" class="primary">Done</button>
    <button id="reportWrite" class="quiet" type="button">Write a new report</button>
  </div>
</div></div>
```

- [ ] **Step 2: Add the handlers**

Beside the other sheet handlers (around :5846):

```js
/* Opening is free: the stored report is shown as-is, and only the button
 * inside the sheet spends a call. Re-reading last week's report should not
 * cost anything, and the delta baseline must move only when a report is
 * actually written. */
function openReport() {
  const body = $("#reportBody");
  body.innerHTML = S.report
    ? '<div class="note">Written ' + escapeHtml(S.reportAt.slice(0, 10)) + "</div>" +
      HSKMd.render(S.report)
    : '<div class="note">No report yet. Write one below.</div>';
  openSheet("#reportSheet");
}
$("#btnReport").onclick = openReport;
$("#reportClose").onclick = () => closeSheet("#reportSheet");
$("#reportSheet").addEventListener("click", e => {
  if (e.target === $("#reportSheet")) closeSheet("#reportSheet");
});
$("#reportWrite").onclick = async () => {
  const btn = $("#reportWrite");
  btn.disabled = true;
  btn.textContent = "Writing…";
  const r = await writeReport();
  btn.disabled = false;
  btn.textContent = "Write a new report";
  /* A failure leaves the previous report exactly where it was and says why
   * underneath it. The old report is the more valuable of the two. */
  if (!r.ok) {
    $("#reportBody").insertAdjacentHTML("beforeend",
      '<div class="note" style="color:var(--bad)">' + escapeHtml(r.why) + "</div>");
    return;
  }
  openReport();
};
```

- [ ] **Step 3: Write the failing browser test**

In `test/browser.test.js`, after the ghost-words section, add:

```js
    /* ------------------------------------------------ progress report */

    /* Seeded through localStorage and a reload: the WebDriver sandbox cannot
     * see a page-level `const`, so S is unreachable and the seed has to go in
     * the same door S.learning does. */
    await exec(`
      var m = JSON.parse(localStorage.getItem("hsk1chat.chatMsgs") || "{}");
      m.reporttest = [{ id: "r1", role: "user", text: "\\u6211\\u5403\\u996d",
        created_at: "2026-09-05T10:00:00.000Z",
        grade: { ok: true, cats: {}, errors: [] } }];
      localStorage.setItem("hsk1chat.chatMsgs", JSON.stringify(m));
      localStorage.removeItem("hsk1chat.report");
      localStorage.removeItem("hsk1chat.reportAt");
      return true;`);
    await go(base);
    await waitFor("window.writeReport", "the app");

    await exec(`document.querySelector('#btnSet').click(); return true;`);
    await waitFor("document.querySelector('#setSheet').classList.contains('open')",
      "Settings for the report button");
    await exec(`document.querySelector('#btnReport').click(); return true;`);
    await waitFor("document.querySelector('#reportSheet').classList.contains('open')",
      "the report sheet");
    check(/No report yet/.test(await exec(
      "return document.querySelector('#reportBody').innerText;")),
      "with nothing written yet, the sheet says so rather than spending a call");

    await exec(
      "window.callModel = function () { return Promise.resolve('You are doing well.'); };" +
      "return true;");
    await exec("document.querySelector('#reportWrite').click(); return true;");
    await waitFor(
      "/You are doing well/.test(document.querySelector('#reportBody').innerText)",
      "the written report", 20000);
    check(await exec("return JSON.parse(localStorage['hsk1chat.report'] || '\"\"');")
      .then(s => /You are doing well/.test(s)),
      "and it persists, so re-reading it later is free");
    check(/很好/.test(await exec(
      "return document.querySelector('#reportBody').innerText;")),
      "with its Chinese line, composed rather than generated");

    /* The behaviour most likely to regress quietly: a failed call must leave
     * last week's report standing. */
    await exec(
      "window.callModel = function () { return Promise.reject(new Error('boom')); };" +
      "return true;");
    await exec("document.querySelector('#reportWrite').click(); return true;");
    await waitFor("/boom/.test(document.querySelector('#reportBody').innerText)",
      "the failure note", 20000);
    check(/You are doing well/.test(await exec(
      "return document.querySelector('#reportBody').innerText;")),
      "a failed call keeps the previous report rather than blanking it");

    await exec(`
      var m = JSON.parse(localStorage.getItem("hsk1chat.chatMsgs") || "{}");
      delete m.reporttest;
      localStorage.setItem("hsk1chat.chatMsgs", JSON.stringify(m));
      return true;`);
    await go(base);
```

Match the surrounding code's exact helper names (`exec`, `waitFor`, `go`, `base`, `check`) — read a neighbouring section before writing, and mirror how it awaits and asserts.

- [ ] **Step 4: Run the browser suite**

Run: `node test/browser.test.js`
Expected: PASS. If it times out in the story-time section rather than yours, that is the known race — `run.sh` retries it once, and BACKLOG.md's "Resist raising the ceiling again" entry explains why raising the timeout is the wrong first move.

- [ ] **Step 5: Run the whole suite and commit**

```bash
sh test/run.sh
git add index.html test/browser.test.js
git commit -m "feat: a button that reads everything and writes back"
```

---

### Task 8: Measuring the prompt

**Files:**
- Create: `tools/report-ab.js`
- Create: `tools/report-ab-results.md`

**Interfaces:**
- Consumes: `HSKPrompt.report` (Task 5).
- Produces: a results file. No app code depends on this task, but **shipping without it violates CLAUDE.md.**

Two counters, because DEVELOPING.md says one would be trusted too easily. Four arms, chosen to test this design's own assumptions rather than to survey wordings.

- [ ] **Step 1: Read the existing harness**

Run: `head -80 tools/drill-word-ab.js` and `sed -n '1,40p' tools/grade-target-ab.js`

Copy its shape: how it reads the key from outside the repo, how it counts, how it prints. The key lives in a file **outside the repo** and is read into a variable — never pasted into a command line, a file in the tree, or a message.

- [ ] **Step 2: Write the fixtures and the counters**

The fixtures are synthetic briefs, not real history, and **name-free** — 王, 李 and
明 are all above HSK 1 and contaminate any vocabulary measurement. The empty and
bad ones matter most: "you barely showed up this week" is the hardest thing for
an encouragement prompt to say honestly, and the likeliest place to find
invented praise.

```js
const HSKPrompt = require("../prompt.js");
const HSKReport = require("../report.js");

const mk = (o) => Object.assign({
  level: 2, goalLevel: 4, coverage: { read: 0.9, use: 0.6 }, minutes: 0,
  messages: { graded: 0, clean: 0 }, words: { met: 0 },
  ghost: { credits: 0, retired: 0, working: 0 }, tags: [],
  activities: { chat: 0, focused: 0, drill: 0, story: 0, twenty: 0 }
}, o);

const FIXTURES = {
  good: mk({ minutes: 210, messages: { graded: 40, clean: 34 }, words: { met: 55 },
    ghost: { credits: 11, retired: 2, working: 3 },
    tags: [{ tag: "aspect-le", n: 2, eg: "我吃饭吗", better: "我吃饭了吗" }],
    activities: { chat: 6, focused: 4, drill: 1, story: 2, twenty: 0 } }),
  bad: mk({ minutes: 40, messages: { graded: 12, clean: 3 }, words: { met: 55 },
    ghost: { credits: 1, retired: 0, working: 1 },
    tags: [{ tag: "aspect-le", n: 6, eg: "我吃饭吗", better: "我吃饭了吗" },
           { tag: "measure-word", n: 4, eg: "一个书", better: "一本书" },
           { tag: "order", n: 3, eg: "我饭吃", better: "我吃饭" }],
    activities: { chat: 3, focused: 0, drill: 0, story: 0, twenty: 0 } }),
  empty: mk({}),
  lopsided: mk({ minutes: 300, messages: { graded: 60, clean: 50 }, words: { met: 55 },
    activities: { chat: 20, focused: 0, drill: 0, story: 0, twenty: 0 } })
};

/* Did it state a figure the brief does not contain? Numbers are the checkable
 * part of a hallucination: everything the report may legitimately say a number
 * about is in the brief, so a number that is not there was invented. Years and
 * small ordinals in prose ("the first thing") are excluded -- they are not
 * claims about the learner. */
function fidelity(out, brief) {
  const allowed = new Set(JSON.stringify(brief).match(/\d+/g) || []);
  const stated = (out.match(/\b\d+\b/g) || []).filter(n => Number(n) > 2);
  const invented = stated.filter(n => !allowed.has(n));
  // Describing an untouched activity as something they did is the other half.
  const claimed = Object.keys(brief.activities).filter(a =>
    brief.activities[a] === 0 &&
    new RegExp("(you|your)[^.]{0,40}" + a, "i").test(out));
  return { ok: invented.length === 0 && claimed.length === 0, invented, claimed };
}

/* Did it say anything only THIS learner could be told? A prompt tuned hard
 * against hallucination retreats into warmth that would fit anyone. */
function specificity(out, brief) {
  const hooks = brief.tags.map(t => t.tag)
    .concat(brief.tags.map(t => t.better))
    .concat(Object.keys(brief.activities).filter(a => brief.activities[a] > 0));
  return { ok: hooks.some(h => h && out.toLowerCase().indexOf(String(h).toLowerCase()) !== -1),
           hooks };
}
```

- [ ] **Step 3: Write the arms**

Four arms, chosen to test this design's own assumptions rather than to survey
wordings. `zeroes` and `guarded` are the shipped behaviour; each is paired with
the variant that removes the thing the spec assumes is helping.

```js
const ARMS = {
  // Does carrying explicit zeroes stop the model inventing activity? The spec
  // asserts it does. This is the arm that finds out.
  zeroes: (f) => HSKPrompt.report({ brief: f, sinceBrief: f, samples: [],
                                    fellBack: false, label: "HSK 2" }),
  omit: (f) => {
    const thin = JSON.parse(JSON.stringify(f));
    Object.keys(thin.activities).forEach(k => {
      if (thin.activities[k] === 0) delete thin.activities[k];
    });
    return HSKPrompt.report({ brief: thin, sinceBrief: thin, samples: [],
                              fellBack: false, label: "HSK 2" });
  },
  // Does the guard sentence move fidelity, or does it only make us feel safer?
  guarded: (f) => HSKPrompt.report({ brief: f, sinceBrief: f, samples: [],
                                     fellBack: false, label: "HSK 2" }),
  plain: (f) => HSKPrompt.report({ brief: f, sinceBrief: f, samples: [],
                                   fellBack: false, label: "HSK 2" })
    .replace(/Every number you state must come from[\s\S]*?never describe it as progress\. /, "")
};
```

Three repeats per fixture per arm, counted per arm. Follow
`tools/drill-word-ab.js` for the call loop, the key handling, and the printing.

- [ ] **Step 4: Run it against the real model**

```bash
node tools/report-ab.js
```

- [ ] **Step 5: Write up the result**

Create `tools/report-ab-results.md` with the counted outcomes per arm per fixture, and a one-paragraph conclusion. **If `zeroes` does not beat `omit`, say so** and simplify the prompt accordingly — the spec records explicit zeroes as an assumption, not a finding, and a measurement that contradicts it is the measurement doing its job.

If either shipped arm loses, change the prompt in `prompt.js` to the winner and re-run Task 5's tests.

- [ ] **Step 6: Commit**

```bash
git add tools/report-ab.js tools/report-ab-results.md prompt.js
git commit -m "test: measure whether the report invents progress"
```

---

### Task 9: Release

**Files:**
- Modify: `index.html` (`VERSION` at :1052)
- Modify: `sw.js` (`CACHE` at :10)
- Modify: `README.md`

- [ ] **Step 1: Bump the version**

Both, together, in one commit — `release.test.js` asserts they match. Read the current values first and increment: `VERSION = "v97 — <today>"` and `CACHE = "hsk-chat-v97"` if the branch is at v96.

- [ ] **Step 2: Document it in README.md**

Add to the Settings table (around :345):

```
| **Progress report** | reads your whole history and writes back a few paragraphs; opening it is free, writing a new one is one call |
```

And a short section near the progress-panel documentation explaining the delta and the floor: the baseline is your last report, unless too little has happened since, in which case it covers the last two weeks and says so. Note that reports are not kept — see BACKLOG.md, "My own progress data, over time, shown to me", for the archive that was deliberately not built.

- [ ] **Step 3: Run the whole suite**

Run: `sh test/run.sh`
Expected: everything passes, `release.test.js` included.

- [ ] **Step 4: Commit**

```bash
git add index.html sw.js README.md
git commit -m "feat: v97 — the progress report"
```

- [ ] **Step 5: Finish the branch**

Use `superpowers:finishing-a-development-branch`.

---

## Notes for whoever executes this

**Line numbers drift.** Every `index.html` line number above is from HEAD at
planning time. Tasks 6 and 7 both insert into `index.html`, so numbers in later
tasks will be stale by the time you reach them. Locate edits by the quoted
surrounding text, which every step supplies; treat the numbers as hints.

**Check the real API before calling it.** Three places above tell you to: the
validator's exports (Task 4), the `HSKMistakes.counts()` call site and
`readiness()`'s coverage fields (Task 6), and the browser suite's helpers
(Task 7). These were read at planning time but not exhaustively verified; a
wrong guess there is a wasted cycle, and the real call sites are a grep away.

**The pre-commit hook runs the whole suite** including the browser tests. That
is slow but it is also why every "commit" step above needs no separate "run the
tests" step before it.
