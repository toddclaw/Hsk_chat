# Mistakes Drills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `drill` activity that practises the grammar categories the grader keeps flagging, and change the mistake count so failures age out and spaced drill passes subtract.

**Architecture:** The drill is an ordinary conversation, so it reuses the grader, sync and `windowed()` wholesale. The chosen category is stored as a `{role: "drill"}` pseudo-message the way story time stores its topic, so no database migration is needed. The only new logic is the counting arithmetic, which moves out of `index.html` into a testable `mistakes.js`.

**Tech Stack:** No build step, no bundler, no dependencies — anywhere, including tests. Plain ES5-style browser JS in the module files, plain `node` test scripts.

**Spec:** `docs/superpowers/specs/2026-09-07-mistakes-drills-design.md`

## Global Constraints

- **No dependencies, no `package.json`, no build step.** Do not add any.
- Every extracted module ends with exactly: `if (typeof module !== "undefined" && module.exports) module.exports = api; else root.HSKMistakes = api;`
- Tests are plain node: a `check(ok, label, detail)` counter, `console.log` totals, `process.exit(1)` on failure. No framework, no fixtures directory beyond what exists.
- `VERSION` in `index.html` and `CACHE` in `sw.js` **must move together**. This branch bumps both once, in Task 2, from `v87` to `v88`.
- Any file the page loads must appear in `sw.js`'s `SHELL` **and** its `isShell` regex.
- `PREFS_KEYS` in `sync.js` must never contain `key` or `history`.
- The drill prompt must never contain an example of a wrong form. RESEARCH.md, "Sharpening a prompt rule by naming the failure": doing so took a failure rate from 0/8 to 3/8.
- Run `sh test/run.sh` before every commit. The pre-commit hook runs it anyway and refuses a red commit.
- `browser.test.js` is known to flake on a single `waitFor` ceiling roughly one run in three. It retries once internally. A failure naming a *different* call site on the retry is the flake, not a regression — re-run before investigating.

---

### Task 1: `mistakes.js` — the counting module

**Files:**
- Create: `mistakes.js`
- Create: `test/mistakes.test.js`

**Interfaces:**
- Consumes: nothing. Pure arithmetic over plain objects.
- Produces: `HSKMistakes.counts(chatMsgs, opts)` → array of `{tag, n, failures, credits, eg, better, note}` sorted by `n` descending then `tag` ascending. `opts` is `{tagLabels, now, windowDays}`; `now` is milliseconds and defaults to `Date.now()`, `windowDays` defaults to `HSKMistakes.WINDOW_DAYS`. Also exports `WINDOW_DAYS` (90) and `drillTagOf(msgs)` → string.

- [ ] **Step 1: Write the failing test**

Create `test/mistakes.test.js`:

```js
/* Mistake counting. Run: node test/mistakes.test.js */
const M = require("../mistakes.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

const LABELS = { "measure-word": "measure word", "aspect-le": "了" };
const NOW = Date.parse("2026-09-07T12:00:00Z");
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();

// A graded user message that got `tag` wrong.
const wrong = (tag, when, text) => ({
  role: "user", text: text || "我说错了", created_at: when,
  grade: { ok: false, better: "正确的说法", errors: [{ tag: tag, note: "the rule" }] }
});
// A graded user message the grader passed.
const right = when => ({
  role: "user", text: "我说对了", created_at: when, grade: { ok: true, errors: [] }
});
const drillMarker = tag => ({ role: "drill", text: tag });

const counts = (chatMsgs, over) =>
  M.counts(chatMsgs, Object.assign({ tagLabels: LABELS, now: NOW }, over || {}));
const find = (rows, tag) => rows.filter(r => r.tag === tag)[0];

// --- the window -------------------------------------------------------------
check(find(counts({ c1: [wrong("measure-word", daysAgo(1))] }), "measure-word").n === 1,
  "a failure inside the window counts");
check(counts({ c1: [wrong("measure-word", daysAgo(91))] }).length === 0,
  "a failure older than 90 days does not count");
check(find(counts({ c1: [wrong("measure-word", daysAgo(89))] }), "measure-word").n === 1,
  "89 days old still counts");
check(counts({ c1: [wrong("measure-word", "not a date")] }).length === 0,
  "an unparseable date never counts");

// --- credits ----------------------------------------------------------------
const twoSameDay = {
  c1: [wrong("measure-word", daysAgo(5)), wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"), right(daysAgo(1)), right(daysAgo(1))]
};
check(find(counts(twoSameDay), "measure-word").credits === 1,
  "two passes on one calendar day credit once",
  JSON.stringify(find(counts(twoSameDay), "measure-word")));

const twoDays = {
  c1: [wrong("measure-word", daysAgo(5)), wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"), right(daysAgo(2)), right(daysAgo(1))]
};
check(find(counts(twoDays), "measure-word").credits === 2,
  "passes on two calendar days credit twice");
check(find(counts(twoDays), "measure-word").n === 0,
  "and two credits cancel two failures");

// --- the floor --------------------------------------------------------------
const overCredited = {
  c1: [wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"), right(daysAgo(3)), right(daysAgo(2)), right(daysAgo(1))]
};
check(find(counts(overCredited), "measure-word").n === 0,
  "more credits than failures floors at zero, never negative",
  String(find(counts(overCredited), "measure-word").n));
check(find(counts(overCredited), "measure-word").failures === 1,
  "the raw failure count is still reported alongside");

// --- attribution ------------------------------------------------------------
check(find(counts({
  c1: [wrong("measure-word", daysAgo(5))],
  c2: [right(daysAgo(1))]
}), "measure-word").credits === 0,
  "a pass outside any drill credits nothing");

const twoTags = {
  c1: [wrong("measure-word", daysAgo(5)), wrong("aspect-le", daysAgo(5))],
  c2: [drillMarker("measure-word"), right(daysAgo(1))]
};
check(find(counts(twoTags), "measure-word").n === 0 &&
      find(counts(twoTags), "aspect-le").n === 1,
  "a drill on one tag credits only that tag");
check(find(counts({
  c1: [wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"), wrong("measure-word", daysAgo(1))]
}), "measure-word").credits === 0,
  "a failed sentence inside a drill earns no credit");

// --- housekeeping -----------------------------------------------------------
check(counts({ c1: [wrong("no-such-tag", daysAgo(1))] }).length === 0,
  "unknown tags are ignored");
check(counts({ c1: [{ role: "assistant", text: "hi", created_at: daysAgo(1) }] }).length === 0,
  "the partner's messages are never graded against the learner");
check(counts({ c1: [drillMarker("measure-word"), right(daysAgo(1))] }).length === 0,
  "a tag with credits but no failures in the window is not listed");

const ordered = counts({
  c1: [wrong("aspect-le", daysAgo(3)), wrong("aspect-le", daysAgo(2)),
       wrong("measure-word", daysAgo(1))]
});
check(ordered[0].tag === "aspect-le" && ordered[1].tag === "measure-word",
  "rows are ordered by count, commonest first",
  ordered.map(r => r.tag + ":" + r.n).join(" "));

// --- the example shown back -------------------------------------------------
const eg = find(counts({
  c1: [wrong("measure-word", daysAgo(9), "旧的句子"), wrong("measure-word", daysAgo(1), "新的句子")]
}), "measure-word");
check(eg.eg === "新的句子", "the example shown is the most recent one, by date", eg.eg);

const egAcross = find(counts({
  zzz: [wrong("measure-word", daysAgo(1), "新的句子")],
  aaa: [wrong("measure-word", daysAgo(9), "旧的句子")]
}), "measure-word");
check(egAcross.eg === "新的句子",
  "and is the most recent across conversations regardless of key order", egAcross.eg);

// --- drillTagOf -------------------------------------------------------------
check(M.drillTagOf([drillMarker("aspect-le"), right(daysAgo(1))]) === "aspect-le",
  "drillTagOf reads the marker");
check(M.drillTagOf([right(daysAgo(1))]) === "",
  "drillTagOf is empty for an ordinary conversation");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/mistakes.test.js`
Expected: FAIL — `Cannot find module '../mistakes.js'`

- [ ] **Step 3: Write the implementation**

Create `mistakes.js`:

```js
/* Which grammar categories the learner keeps getting wrong, and how close they
 * are to being drilled away.
 *
 * Two rules, both from the spaced-practice literature (RESEARCH.md, "Drilling
 * a mistake category"):
 *
 *   - a failure counts only while it is recent, so improving without drilling
 *     still makes the number fall;
 *   - a drill pass subtracts, but at most one a day, because a drill session is
 *     massed practice by construction and massed practice is what loses.
 *
 * Derived by scanning the graded messages, never stored. A running tally kept
 * beside them would be a second source of truth to drift -- the same reasoning
 * that kept the original count in index.html a scan.
 *
 * Loadable in the browser (window.HSKMistakes) and in node (module.exports).
 */
(function (root) {
  "use strict";

  var WINDOW_DAYS = 90;      // how long a mistake stays on the books
  var DAY = 86400000;

  /* UTC, not local. Two devices in two timezones have to agree on whether a
   * pass fell on the same day as another, and the stored timestamp is already
   * UTC ISO. Local dates would let a flight change a learner's numbers. */
  function dayKey(iso) { return String(iso || "").slice(0, 10); }

  /* The category this conversation drills, or "" for an ordinary chat. Stored
   * as a pseudo-message the way story time stores its topic, so it needs no
   * column of its own and syncs with the transcript. */
  function drillTagOf(msgs) {
    for (var i = 0; i < (msgs || []).length; i++) {
      if (msgs[i] && msgs[i].role === "drill") return msgs[i].text || "";
    }
    return "";
  }

  function counts(chatMsgs, opts) {
    opts = opts || {};
    var labels = opts.tagLabels || {};
    var now = opts.now || Date.now();
    var cutoff = now - (opts.windowDays || WINDOW_DAYS) * DAY;
    var byTag = {};
    var creditDays = {};

    function slot(tag) {
      if (!byTag[tag]) {
        byTag[tag] = { tag: tag, n: 0, failures: 0, credits: 0,
                       eg: "", better: "", note: "", at: -Infinity };
      }
      return byTag[tag];
    }

    Object.keys(chatMsgs || {}).forEach(function (cid) {
      var msgs = chatMsgs[cid] || [];
      var drill = drillTagOf(msgs);
      msgs.forEach(function (t) {
        if (!t || t.role !== "user" || !t.grade) return;
        var when = Date.parse(t.created_at || "");
        /* NaN fails this comparison, so an unparseable timestamp is excluded
         * rather than counted as epoch-zero and silently aged out. */
        var recent = when >= cutoff;

        (t.grade.errors || []).forEach(function (e) {
          if (!e || !labels[e.tag] || !recent) return;
          var s = slot(e.tag);
          s.failures++;
          /* The most recent instance is the one worth showing back, by date --
           * not by whichever conversation Object.keys happened to yield last. */
          if (when >= s.at) {
            s.at = when;
            s.eg = t.text || "";
            s.better = t.grade.better || "";
            s.note = e.note || "";
          }
        });

        if (drill && labels[drill] && t.grade.ok) {
          if (!creditDays[drill]) creditDays[drill] = {};
          creditDays[drill][dayKey(t.created_at)] = true;
        }
      });
    });

    Object.keys(creditDays).forEach(function (tag) {
      if (byTag[tag]) byTag[tag].credits = Object.keys(creditDays[tag]).length;
    });

    return Object.keys(byTag).map(function (tag) {
      var s = byTag[tag];
      s.n = Math.max(0, s.failures - s.credits);
      delete s.at;
      return s;
    }).sort(function (a, b) {
      return b.n - a.n || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
    });
  }

  var api = { counts: counts, drillTagOf: drillTagOf, WINDOW_DAYS: WINDOW_DAYS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKMistakes = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/mistakes.test.js`
Expected: PASS, `0 failed`

- [ ] **Step 5: Add the suite to the runner**

In `test/run.sh`, add `test/mistakes.test.js` to the list of suites, beside `test/pace.test.js`, matching the surrounding style exactly.

- [ ] **Step 6: Run the whole suite**

Run: `sh test/run.sh`
Expected: every suite passes, `mistakes.test.js` among them.

- [ ] **Step 7: Commit**

```bash
git add mistakes.js test/mistakes.test.js test/run.sh
git commit -m "feat: mistakes.js, counting with an aging window and spaced credit"
```

---

### Task 2: Wire the page to `mistakes.js`

**Files:**
- Modify: `index.html` — the `<script>` block at 937-944, `mistakeCounts()` at ~4916, `renderMistakes()` at ~4937, `VERSION` at 1009
- Modify: `sw.js` — `CACHE` at 10, `SHELL` at 14, `isShell` at 19

**Interfaces:**
- Consumes: `HSKMistakes.counts` from Task 1.
- Produces: `mistakeCounts()` in `index.html`, unchanged in name and call sites, now returning rows that also carry `failures` and `credits`.

- [ ] **Step 1: Load the module**

In `index.html`, add after the `pace.js` line (941):

```html
<script src="mistakes.js"></script>
```

- [ ] **Step 2: Replace the counting body**

Replace the whole of `mistakeCounts()` (from `function mistakeCounts() {` through its closing brace) with:

```js
function mistakeCounts() {
  return HSKMistakes.counts(S.chatMsgs, { tagLabels: HSKPrompt.TAG_LABEL });
}
```

Replace the comment block above it (the one beginning "Counted across every conversation") with:

```js
/* Counted across every conversation, not just the open one: a recurring mistake
 * is recurring precisely because it spans them. The arithmetic -- the aging
 * window, the one-credit-a-day cap -- lives in mistakes.js so it can be tested
 * without a browser. */
const MISTAKES_SHOWN = 3;
```

- [ ] **Step 3: Show only categories that still have a count**

In `renderMistakes()`, change:

```js
  const all = mistakeCounts();
```

to:

```js
  const all = mistakeCounts().filter(m => m.n > 0);
```

- [ ] **Step 4: Add the file to the service worker**

In `sw.js`, add `"./mistakes.js"` to `SHELL` after `"./pace.js"`, and add `mistakes\.js` to the `isShell` regex alternation after `pace\.js`. Both are required: `SHELL` alone leaves the regex misrouting the request, and `cache.addAll` is all-or-nothing so a missing path breaks install entirely.

- [ ] **Step 5: Bump the version in both files**

`index.html` line 1009: `const VERSION   = "v88 — 2026-09-07";`
`sw.js` line 10: `const CACHE = "hsk-chat-v88";`

- [ ] **Step 6: Run the suite**

Run: `sh test/run.sh`
Expected: PASS. `release.test.js` is what proves the version bump and the `SHELL` entry are both present — if it fails here, one of Steps 4 or 5 is incomplete.

- [ ] **Step 7: Commit**

```bash
git add index.html sw.js
git commit -m "refactor: mistake counting moves to mistakes.js"
```

---

### Task 3: The drill-length setting

**Files:**
- Modify: `index.html` — `ATTEMPT_CHOICES` at 1014, the `K` map at ~1057, the `S` initializer at ~1110, settings markup at ~541, the settings populate at ~5252, the settings save at ~5285
- Modify: `sync.js` — `PREFS_KEYS` at 251
- Modify: `test/sync.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `S.drillTurns` (number, 3-10, default 6) and `DRILL_CHOICES`.

- [ ] **Step 1: Write the failing test**

In `test/sync.test.js`, beside the existing `PREFS_KEYS` assertions, add:

```js
check(SY.PREFS_KEYS.indexOf("drillTurns") !== -1,
  "drillTurns syncs -- it is a preference, not a per-device counter");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/sync.test.js`
Expected: FAIL — "drillTurns syncs"

- [ ] **Step 3: Add the key to PREFS_KEYS**

In `sync.js`, add `"drillTurns"` to the `PREFS_KEYS` array, after `"attempts"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/sync.test.js`
Expected: PASS

- [ ] **Step 5: Add the constant and state**

In `index.html`, after `ATTEMPT_CHOICES` (line 1014):

```js
const DRILL_CHOICES = [3, 4, 5, 6, 7, 8, 9, 10];  // sentences in one drill
```

In the `K` map, add: `drillTurns:"hsk1chat.drillTurns",`

In the `S` initializer, beside `attempts`:

```js
  drillTurns: store.get(K.drillTurns, 6),     // sentences in one mistake drill
```

- [ ] **Step 6: Add the markup**

In `index.html`, after the "Tries before giving up" block (ends ~line 544):

```html
    <label for="drillTurns">Sentences in a drill</label>
      <select id="drillTurns"></select>
      <div class="note">How many sentences one <b>Mistakes</b> drill asks you for. Longer
      is more practice, not more credit — a category counts down by at most one a day
      however much you drill it, because spacing is what makes a correction stick.</div>
```

- [ ] **Step 7: Populate and save it**

In the settings populate, after the `#attempts` block:

```js
  $("#drillTurns").innerHTML = DRILL_CHOICES.map(n =>
    '<option value="' + n + '"' + (n === S.drillTurns ? " selected" : "") + ">" + n +
    (n === 6 ? " — default" : "") + "</option>").join("");
```

In the settings save, beside the `S.attempts` line:

```js
  S.drillTurns = Number($("#drillTurns").value) || 6; store.set(K.drillTurns, S.drillTurns);
```

- [ ] **Step 8: Run the suite and commit**

Run: `sh test/run.sh`
Expected: PASS

```bash
git add index.html sync.js test/sync.test.js
git commit -m "feat: drill length is a setting, 3-10, default 6"
```

---

### Task 4: The activity and its prompt

**Files:**
- Modify: `prompt.js` — `TAGS` at ~728, the exports at ~941, `ACTIVITIES` at 321, `activityRules()` at 407
- Modify: `test/prompt.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `HSKPrompt.ACTIVITIES.drill`, `HSKPrompt.TAG_ZH` (tag → Chinese name of the structure), and an `activityRules({activity: "drill", drillTag: "<tag>", convert: fn})` branch returning one rule string.

- [ ] **Step 1: Write the failing test**

In `test/prompt.test.js`, add:

```js
// --- the mistakes drill -----------------------------------------------------
check(!!P.ACTIVITIES.drill, "there is a drill activity");
check(P.ACTIVITIES.drill.gen === "turn" && P.ACTIVITIES.drill.converse === true,
  "the drill is an ordinary back-and-forth, not segments");
check(P.ERROR_TAGS.every(t => !!P.TAG_ZH[t]),
  "every error tag has a Chinese name for the drill prompt to use",
  P.ERROR_TAGS.filter(t => !P.TAG_ZH[t]).join(" "));

const drillRules = P.activityRules({ activity: "drill", drillTag: "measure-word" });
check(drillRules.length === 1, "a drill emits exactly one rule");
check(drillRules[0].indexOf(P.TAG_ZH["measure-word"]) !== -1,
  "and it names the structure being practised", drillRules[0]);

/* RESEARCH.md, "Sharpening a prompt rule by naming the failure": putting a
 * wrong form in a prompt primed the model to reproduce it, 0/8 to 3/8. The
 * TAGS table's examples all contain one, so the drill prompt must not reach
 * for them. */
const wrongForms = ["三个书", "很高兴了", "他不有钱", "他比我很高", "我看音乐"];
check(wrongForms.every(w => drillRules[0].indexOf(w) === -1),
  "and contains no example of a wrong form");
check(P.activityRules({ activity: "drill", drillTag: "" }).length === 0,
  "no category chosen means no drill rule at all");
check(P.activityRules({ activity: "drill", drillTag: "no-such-tag" }).length === 0,
  "an unknown category emits no rule rather than a broken one");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/prompt.test.js`
Expected: FAIL — "there is a drill activity"

- [ ] **Step 3: Add the Chinese structure names**

In `prompt.js`, extend each `TAGS` row with a fourth column — the Chinese name of the structure. The existing three columns are read positionally by `grade()` (`r[0]`, `r[1]`, `r[2]`), so appending a fourth changes nothing there.

```js
  /* The fourth column is the Chinese name of the structure, used ONLY by the
   * drill prompt. The third column cannot serve: every example in it contains
   * a wrong form, and RESEARCH.md measured that putting one in a prompt primes
   * the model to reproduce it. */
  var TAGS = [
    ["measure-word",           "measure word",             "三个书 → 三本书",        "量词"],
    ["aspect-le",              "了",                        "很高兴了 → 很高兴",      "了"],
    ["aspect-guo",             "过",                        "我去过了那儿吗 → 我去过那儿吗", "过"],
    ["aspect-zhe",             "着",                        "他站着了 → 他站着",      "着"],
    ["aspect-zai",             "在 / 正在",                 "我在吃饭了 → 我在吃饭",  "在／正在"],
    ["negation-bu-mei",        "不 vs 没",                  "他不有钱 → 他没有钱",    "不和没"],
    ["de-particles",           "的 / 地 / 得",              "他说的很好 → 他说得很好", "的、地、得"],
    ["word-order-adverbial",   "adverbial word order",      "我去商店昨天 → 我昨天去商店", "状语的位置"],
    ["word-order-attributive", "attributive word order",    "朋友的我 → 我的朋友",    "定语的位置"],
    ["comparison-bi",          "比 comparison",             "他比我很高 → 他比我高",  "比字句"],
    ["ba-construction",        "把 construction",           "我把书看 → 我把书看完了", "把字句"],
    ["bei-construction",       "被 construction",           "书被我看 → 书被我看完了", "被字句"],
    ["connective",             "connectives",               "因为下雨，我不去 → 因为下雨，所以我不去", "关联词"],
    ["wrong-word",             "wrong word",                "我看音乐 → 我听音乐",    "用词"],
    ["wrong-sense",            "right word, wrong sense",   "我很开车 → 我常开车",    "词的意思"],
    ["wrong-character",        "wrong character",           "我的马妈 → 我的妈妈",    "同音字"],
    ["unnatural",              "unnatural phrasing",        "给我水 → 请给我一杯水",  "地道的说法"]
  ];
```

Below the existing `TAG_LABEL` construction, add:

```js
  var TAG_ZH = {};
  TAGS.forEach(function (r) { TAG_ZH[r[0]] = r[3]; });
```

Add `TAG_ZH: TAG_ZH,` to the exported object beside `TAG_LABEL`.

- [ ] **Step 4: Add the activity row**

In `ACTIVITIES`, after the `focused` entry:

```js
    drill: {
      label: "Mistakes",
      /* Built per-category in activityRules(), the way story time's phase
       * rules and 20 Questions' role rules are -- the text depends on which
       * category was chosen, which a static array cannot express. */
      rules: null,
      names: null,
      reuse: null,
      gen: "turn",
      converse: true,
      note: "Mistakes: practice a category the grader keeps flagging. " +
        "Pick one below; the partner asks questions that need it in the answer."
    },
```

- [ ] **Step 5: Add the rule branch**

In `activityRules()`, add a branch beside the `twenty` one:

```js
    } else if (opts.activity === "drill") {
      /* Elicitation, not explanation. Ghost Words already showed that asking
       * the partner to steer the conversation so a target must appear in the
       * learner's OWN answer is what produces practice -- a partner that
       * merely mentions the structure is input, not production.
       *
       * Names the structure and never a wrong form: RESEARCH.md, "Sharpening
       * a prompt rule by naming the failure". */
      var zh = opts.drillTag ? TAG_ZH[opts.drillTag] : null;
      if (zh) {
        rules.push(convert("学生今天要练习「") + convert(zh) + convert("」。") +
          convert("请你问一些问题，让学生必须用这个说法来回答。一次只问一个问题，问题要短。") +
          convert("学生说对了，就说很好，再问下一个。") +
          convert("学生说得不对，就用正确的说法说一次，然后再问一个差不多的问题。") +
          convert("不要用英文，也不要讲语法规则。"));
      }
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node test/prompt.test.js`
Expected: PASS

- [ ] **Step 7: Run the suite and commit**

Run: `sh test/run.sh`

```bash
git add prompt.js test/prompt.test.js
git commit -m "feat: the drill activity and its elicitation prompt"
```

---

### Task 5: The chooser, the control and the session

**Files:**
- Modify: `index.html` — `startActivity()` at ~2429, the hint branch at ~2154, `renderComposer()` at ~4586, the control dispatch at ~4732, and new functions beside `renderStoryChooser()` at ~4610
- Modify: `prompt.js` — pass `drillTag` through from the caller (see Step 3)

**Interfaces:**
- Consumes: `HSKMistakes.drillTagOf` (Task 1), `HSKPrompt.TAG_LABEL` and `ACTIVITIES.drill` (Task 4), `S.drillTurns` (Task 3).
- Produces: `drillTag()`, `startDrillWith(tag)`, `drillDone()`, `drillPassed()`, `renderDrillChooser(box)`, `renderDrillControl(box)`.

- [ ] **Step 1: Read the chosen category off the transcript**

Beside `storyTopic()` (~3493) add:

```js
/* The category this conversation drills, "" before one is chosen. Read off the
 * transcript rather than held in a variable, same as storyTopic(). */
function drillTag() { return HSKMistakes.drillTagOf(S.history); }

/* Attempts used and passed so far. An attempt is a graded message of the
 * learner's, pass or fail -- counting only passes would mean a bad run never
 * ends. */
function drillTold() { return S.history.filter(t => t.role === "user").length; }
function drillPassed() {
  return S.history.filter(t => t.role === "user" && t.grade && t.grade.ok).length;
}
function drillDone() { return drillTold() >= S.drillTurns; }
```

- [ ] **Step 2: Start a drill**

Beside `setStoryTopic()`:

```js
/* Choosing a category is what starts the drill: the marker goes in the
 * transcript, then the partner opens. Nothing is generated -- and nothing is
 * spent -- until the learner has picked, the same withholding story time and
 * 20 Questions use. */
function startDrillWith(tag) {
  if (!tag || drillTag()) return;
  S.history.push({ role: "drill", text: tag, id: newMessageId(),
                   created_at: new Date().toISOString() });
  persist();
  renderStarters();
  openingTurn();
}
```

- [ ] **Step 3: Feed the tag to the prompt builder**

At both call sites that build prompt options (the `storyTopic:` lines at 1401 and 1433), add a sibling line:

```js
      drillTag: currentActivity() === "drill" ? drillTag() : "",
```

Use the same indentation as the `storyTopic:` line beside it in each case. At 1433 the surrounding block reads from `c` rather than the live helpers — check what its neighbours do and match; `drillTag()` reads `S.history`, which that path has available.

- [ ] **Step 4: Withhold the opening turn until a category is chosen**

At ~2429, change:

```js
  if (act.gen !== "segments" && id !== "chat" && id !== "twenty") openingTurn();
```

to:

```js
  if (act.gen !== "segments" && id !== "chat" && id !== "twenty" && id !== "drill") openingTurn();
```

- [ ] **Step 5: The empty-log hint**

In the hint branch at ~2154, add before the `else`:

```js
    } else if (currentActivity() === "drill") {
      hintText = drillTag() ? 'Write a sentence in Chinese.'
                            : 'Pick a mistake to practice, below.';
```

- [ ] **Step 6: Disable the composer when there is nothing to write into**

In `renderComposer()`, extend `listening`:

```js
  const listening = (currentActivity() === "story" && !anyStoryQuestion() &&
    !(S.history.some(t => t.role === "user") || storyTold() > STORY_SEGMENTS)) ||
    (currentActivity() === "twenty" && !(c && c.side)) ||
    (currentActivity() === "drill" && (!drillTag() || drillDone()));
```

- [ ] **Step 7: The chooser and the control**

Beside `renderStoryChooser()`:

```js
/* The prioritized list of mistake categories, with the learner's own numbers --
 * the same rows Settings shows, given a screen and made tappable. The example
 * and its correction are shown HERE and never sent to the model: RESEARCH.md,
 * "Sharpening a prompt rule by naming the failure". */
function renderDrillChooser(box) {
  if (!S.grader) {
    box.innerHTML = '<div class="note">Checking is off, so nothing is being logged ' +
      'to practice. Turn the grader on in Settings.</div>';
    return;
  }
  const all = mistakeCounts();
  const open = all.filter(m => m.n > 0);
  if (!open.length) {
    box.innerHTML = '<div class="note">' + (all.length
      ? "Nothing outstanding — every category you have drilled is clear."
      : "Nothing logged yet. Messages you send are checked as you go.") + "</div>";
    return;
  }
  open.slice(0, 5).forEach(m => {
    const b = document.createElement("button");
    b.className = "story";
    b.textContent = HSKPrompt.TAG_LABEL[m.tag] + " (" + m.n + ")";
    b.title = m.eg + (m.better ? " → " + m.better : "");
    b.onclick = () => startDrillWith(m.tag);
    box.appendChild(b);
  });
}

/* Before a category is chosen this is the chooser; after it, a progress line.
 * There is no "next" button -- the learner advances a drill by writing, unlike
 * story time where the partner does the producing. */
function renderDrillControl(box) {
  if (S.busy) return;
  if (!drillTag()) return renderDrillChooser(box);
  const note = document.createElement("div");
  note.className = "note";
  const label = HSKPrompt.TAG_LABEL[drillTag()] || drillTag();
  note.textContent = drillDone()
    ? label + " — done. " + drillPassed() + " of " + drillTold() + " passed."
    : label + " — " + (drillTold() + 1) + " of " + S.drillTurns;
  box.appendChild(note);
}
```

- [ ] **Step 8: Dispatch to it**

At ~4732, add beside the other two:

```js
  if (currentActivity() === "drill") return renderDrillControl(box);
```

Note on spec D8: the design proposed generalizing this dispatch onto the activity row. Do **not** do that here — `ACTIVITIES` lives in `prompt.js`, which holds no DOM references and must stay loadable in node, so a render function cannot live on those rows. The three sites that branch per activity (control, composer gating, hint text) each carry different logic, so a shared table would serve only one of them. A third explicit branch is the smaller change; flag this back to Todd as a spec correction rather than a silent deviation.

- [ ] **Step 9: Run the suite**

Run: `sh test/run.sh`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add index.html prompt.js
git commit -m "feat: the mistakes chooser, and a drill that ends"
```

---

### Task 6: Browser coverage

**Files:**
- Modify: `test/browser.test.js`

**Interfaces:**
- Consumes: everything above, through the page.

- [ ] **Step 1: Write the test**

Add a scenario matching the file's existing style — seed `localStorage` before load, drive the page with `exec`, assert with `check`. Seed one conversation holding a graded message with a `measure-word` error dated today, open the drill activity, and assert the chooser offers that category; then click it and assert the marker landed and the composer is enabled.

```js
    /* The chooser lists the learner's own categories, and choosing one writes
     * the marker that everything else reads off. */
    await go(base);
    await exec(`
      localStorage.setItem("hsk1chat.chats", JSON.stringify([
        { id: "c-drill", title: "seed", activity: "chat",
          created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      ]));
      localStorage.setItem("hsk1chat.msgs.c-drill", JSON.stringify([
        { id: "m1", role: "user", text: "我有三个书",
          created_at: new Date().toISOString(),
          grade: { ok: false, better: "我有三本书",
                   errors: [{ tag: "measure-word", note: "use 本 for books" }] } }
      ]));
      return true;`);
    await go(base);
    await exec(`document.querySelector('#activity').value = "drill";
                document.querySelector('#activity').dispatchEvent(new Event("change"));
                return true;`);
    await waitFor(`document.querySelectorAll('#starters button').length > 0`,
      "the drill chooser to appear");
    const drillBtn = await exec(`
      var b = document.querySelectorAll('#starters button');
      for (var i = 0; i < b.length; i++) {
        if (b[i].textContent.indexOf("measure word") === 0) return b[i].textContent;
      }
      return "";`);
    check(drillBtn.indexOf("measure word") === 0,
      "the chooser offers the category the grader logged", drillBtn);
    check(drillBtn.indexOf("(1)") !== -1,
      "with the learner's own count beside it", drillBtn);
    check(await exec(`return document.querySelector('#input').disabled;`) === true,
      "and the composer is closed until a category is chosen");
```

Match the surrounding suite's exact helper names and seeding idiom — read the two scenarios either side before writing, since `go`, `exec` and the storage key names must be used exactly as they appear there. If the seeding keys differ from the guesses above, the neighbouring tests are authoritative.

- [ ] **Step 2: Run it**

Run: `node test/browser.test.js`
Expected: PASS. Needs firefox and geckodriver; without them the suite exits 0 without running, which is **not** a pass — confirm the scenario actually executed.

- [ ] **Step 3: Commit**

```bash
git add test/browser.test.js
git commit -m "test: the drill chooser end to end"
```

---

### Task 7: RESEARCH.md

**Files:**
- Modify: `RESEARCH.md`

- [ ] **Step 1: Add the section**

Add a section "Drilling a mistake category", placed after "How many encounters a word needs" since it argues from the same literature. It must record:

- **What the constants are:** `MISTAKE_WINDOW_DAYS = 90`, one credit per tag per calendar day, default drill length 6 (settable 3-10).
- **Why credit is spaced, not counted:** a drill session is massed practice by construction; the spaced arm beat the massed arm on error correction specifically in Kim & Webb's delayed post-test, and Suzuki & DeKeyser found the same for proceduralization.
- **Why one pass does not clear a category:** backsliding is well attested and L2 development is U-shaped, so a single correct production is not evidence the error is gone.
- **What is not evidenced:** 90 days has no citation behind it, and no study sets the per-day cap at one. Both are the knobs to turn if the feature feels wrong, and turning either means updating this file.
- **What is not counted:** correct spontaneous use in free conversation, which is better evidence than any drill pass, because the grader reports failures only. Cross-reference the BACKLOG item.

Add the five sources to the Bibliography in the file's existing citation format.

- [ ] **Step 2: Run the suite and commit**

```bash
git add RESEARCH.md
git commit -m "docs: the pedagogy behind the drill constants"
```

---

### Task 8: The prompt A/B — required before merge

**Files:**
- Create: `tools/drill-ab.js`

CLAUDE.md is explicit that a prompt edit ships only after an A/B against the real model with counted outcomes, and that the answer is regularly the opposite of the obvious one. Task 4 added a new prompt. This task is the gate.

- [ ] **Step 1: Read the precedent**

Read `tools/story-ab.js` and DEVELOPING.md's worked examples for the harness shape and how outcomes are counted. Note the BACKLOG item "`judge()` is undefined in `tools/story-ab.js`" — do not copy that bug forward.

- [ ] **Step 2: Write the runner**

`tools/drill-ab.js` takes a tag, runs N partner turns per arm at a fixed level, and counts, per turn, whether **the reply requires the target structure in the learner's answer**. Arms:

- **A:** the drill rule from Task 4.
- **B:** no drill rule — the ordinary chat prompt with the same history.

Read the OpenRouter key from the file outside the repo into a variable. Never paste it into a command line, a file in the tree, or a message.

- [ ] **Step 3: Run it name-free**

Run at least 10 turns per arm. Seed no person names: CLAUDE.md notes 王, 李 and 明 are all above HSK 1 and contaminate any vocabulary measurement.

- [ ] **Step 4: Record the outcome**

Write the counted result into RESEARCH.md under "Measurements we ran", in the format the existing entries use — arms, N, counts, and what was decided. If arm A does not beat arm B, the prompt is wrong and Task 4 needs revisiting; say so rather than shipping it.

- [ ] **Step 5: Commit**

```bash
git add tools/drill-ab.js RESEARCH.md
git commit -m "measure: the drill prompt against an unguided partner"
```

---

## Done when

- `sh test/run.sh` is green, including the new `mistakes.test.js` and the browser scenario
- `VERSION` and `CACHE` both read `v88`, and `mistakes.js` is in `SHELL` and `isShell`
- The A/B in Task 8 is recorded in RESEARCH.md with counted outcomes
- PR #31 is out of draft
