# Retrieval Engine (gap-fill) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the learner's own stored corpus into gap-fill retrieval items — no model call, no network — and record each retrieval in a synced, append-only table.

**Architecture:** One new pure module, `retrieval.js`, mines stored messages for sentences, picks a target word and three rank-neighbour distractors, and returns items. `index.html` owns a new sheet that renders items and writes one row per word-day. `sync.js` gains converters and a probe flag for the new `retrievals` table, reusing the existing generic `pushVocab`/`pullVocab`.

**Tech Stack:** Plain ES5-style browser JS, no build step, no bundler, no dependencies — **anywhere, including tests**. Tests are plain `node test/<name>.test.js` with a `check(ok, label, detail)` counter. Postgres (Supabase) for the table.

**Spec:** `docs/superpowers/specs/2026-09-12-retrieval-engine-design.md` — read it before Task 1. The plan implements it; where the plan refines a signature, it says so.

## Global Constraints

- **No dependencies, no `package.json`, no build step.** Do not add any, in source or tests.
- **Every extracted module ends with exactly this wrapper:**
  ```js
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKRetrieval = api;
  ```
  wrapped in `(function (root) { "use strict"; ... })(typeof globalThis !== "undefined" ? globalThis : this);`
- **`retrieval.js` is pure**: no DOM, no `S`, no network, no `Date.now()`, no `crypto`, no `Math.random()`. Everything time-, lexicon- or randomness-dependent is passed in.
- **Constants:** `ROUND = 10`, `CANDIDATES = 4`, `MIN_WORDS = 4`. Exported from the module; never re-typed elsewhere.
- **A new file the page loads must be added in FOUR places** or the release test fails or the deploy 404s: `<script src>` in `index.html`, `SHELL` in `sw.js`, the `isShell` regex in `sw.js`, and `.github/publish-files`.
- **`VERSION` in `index.html` and `CACHE` in `sw.js` must move together.** This branch starts at v99. It ships as **v101**, NOT v102 or v100: `v100` is
already claimed by the unmerged branch `fix/story-activity-and-unbanked-slate`.
Two branches carrying the same `CACHE` name is not a cosmetic clash — `sw.js`'s
activate handler deletes every cache whose key differs from `CACHE`, which is
what clears stale runtime-cached files, so an identical name makes that sweep
match nothing. Check every unmerged branch's VERSION before choosing a number;
`release.test.js` only checks the two agree within one tree.
- **`PREFS_KEYS` in `sync.js` must never name `key` or `history`.** Nothing in this feature goes near either.
- **Commit style:** the repo uses Conventional Commits with a body explaining *why*. Run `sh test/run.sh` before every commit; `.githooks/pre-commit` runs it anyway and refuses a failing commit.
- **Branch:** `feat/retrieval-engine`, already created off `main`. Do not commit to `main`.
- **Test fixtures:** the spec says "fixtures in `test/fixtures.json`". This plan
  instead builds turns inline and loads the real `data/hsk1.json` lexicon, which
  is what `mistakes.test.js` and `validator.test.js` already do. Same house
  style, and the suite then fails if segmentation or validation changes under it.

---

### Task 1: `retrieval.js` — the day arithmetic

The counting half of the module: derive per-word counts from stored rows, and append a row under the one-per-word-per-day cap.

**Spec refinement:** the spec sketches `credit(rows, word, today, ok, face)`. This plan uses `credit(rows, entry)` where `entry` carries `id` and `created_at` from the caller. The module must not generate UUIDs or read the clock — that is what keeps it node-loadable and its tests deterministic.

**Files:**
- Create: `retrieval.js`
- Create: `test/retrieval.test.js`
- Modify: `test/run.sh:9` (add the new suite to the loop)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `HSKRetrieval.countsFrom(rows) -> { [word]: { n: number, days: { [day]: true } } }` — `n` is the count of **distinct days with `ok: true`**; `days` holds every day the word has a row, ok or not.
  - `HSKRetrieval.credit(rows, entry) -> rows'` — returns a NEW array with `entry` appended, or the original array unchanged if `rows` already holds a row for `entry.word` on `entry.day`. `entry` is `{ id, word, day, ok, face, created_at }`.
  - `HSKRetrieval.ROUND`, `HSKRetrieval.CANDIDATES`, `HSKRetrieval.MIN_WORDS`.

- [ ] **Step 1: Write the failing test**

Create `test/retrieval.test.js`:

```js
/* Retrieval engine: corpus mining and day-capped credit.
 * Run: node test/retrieval.test.js  — dependency-free, like every suite here. */
const R = require("../retrieval.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

const row = (word, day, ok, face) => ({
  id: word + "-" + day, word: word, day: day, ok: ok !== false,
  face: face || "gapfill", created_at: day + "T12:00:00Z"
});

// --- countsFrom -------------------------------------------------------------
const counts1 = R.countsFrom([row("苹果", "2026-09-01"), row("苹果", "2026-09-02")]);
check(counts1["苹果"].n === 2, "two ok days count two", JSON.stringify(counts1));

/* The merge-correctness claim from the design, tested as arithmetic: two
 * devices offline on the same day push two rows with different ids, and the
 * day must still count once. This is WHY the table has no unique constraint. */
const dup = [row("苹果", "2026-09-01"), Object.assign(row("苹果", "2026-09-01"), { id: "other-device" })];
check(R.countsFrom(dup)["苹果"].n === 1, "two devices, one day, counted once",
  JSON.stringify(R.countsFrom(dup)));

const missed = R.countsFrom([row("苹果", "2026-09-01", false)]);
check(missed["苹果"].n === 0, "a wrong answer adds nothing to n");
check(missed["苹果"].days["2026-09-01"] === true,
  "a wrong answer still occupies the day");

check(Object.keys(R.countsFrom([])).length === 0, "no rows, no counts");
check(Object.keys(R.countsFrom(null)).length === 0, "null rows do not throw");

// --- credit -----------------------------------------------------------------
const base = [row("苹果", "2026-09-01")];
const added = R.credit(base, row("苹果", "2026-09-02"));
check(added.length === 2, "a new day appends a row");
check(base.length === 1, "credit does not mutate the array it was given");

const capped = R.credit(base, Object.assign(row("苹果", "2026-09-01"), { id: "again" }));
check(capped.length === 1, "a second row for the same word-day is refused");

const cappedWrong = R.credit(base, Object.assign(row("苹果", "2026-09-01", false), { id: "again" }));
check(cappedWrong.length === 1,
  "the cap is symmetric: a wrong answer cannot re-open a banked day");

check(R.credit(base, row("香蕉", "2026-09-01")).length === 2,
  "a different word on the same day is fine");

// --- constants --------------------------------------------------------------
check(R.ROUND === 10 && R.CANDIDATES === 4 && R.MIN_WORDS === 4,
  "constants are exported, not re-typed by callers");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/retrieval.test.js`
Expected: FAIL — `Cannot find module '../retrieval.js'`

- [ ] **Step 3: Write the minimal implementation**

Create `retrieval.js`:

```js
/* The retrieval engine: the learner's own corpus, turned into questions whose
 * answer is known before they are asked.
 *
 * Gap-fill is the first face. Dictation, tone ID and scramble are the same
 * selection with a different presentation -- they call batch() and ignore
 * `candidates`.
 *
 * Pure by construction: no DOM, no network, no clock, no randomness of its
 * own. Segmentation, validation, today's date and the random source all come
 * in as arguments, which is what makes the items reproducible in a test.
 *
 * Loadable in the browser (window.HSKRetrieval) and in node (module.exports).
 */
(function (root) {
  "use strict";

  var ROUND = 10;        // items per round; see RESEARCH.md
  var CANDIDATES = 4;    // one target, three distractors
  var MIN_WORDS = 4;     // a shorter sentence minus a word is a guess, not a context

  /* The same UTC day key the ghost and drill counters bank in -- mistakes.js
   * says why local dates would let a flight move a learner's numbers. Four
   * characters of arithmetic, duplicated rather than imported: no module in
   * this repo requires another. */
  function dayOf(iso) { return String(iso || "").slice(0, 10); }

  /* n counts DISTINCT ok days. Two devices offline on the same day push two
   * rows, and that is the intended shape -- the table has no unique constraint
   * precisely so the second push is absorbed rather than rejected, which only
   * works if counting is by day here. */
  function countsFrom(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.word || !r.day) return;
      var c = out[r.word] || (out[r.word] = { n: 0, days: {} });
      if (c.days[r.day] === undefined) c.days[r.day] = false;
      if (r.ok && !c.days[r.day]) { c.days[r.day] = true; c.n++; }
    });
    Object.keys(out).forEach(function (w) {
      Object.keys(out[w].days).forEach(function (d) { out[w].days[d] = true; });
    });
    return out;
  }

  /* One row per word per day, in both directions. A wrong answer occupies the
   * day without adding to n: you cannot retry the same word for credit until
   * tomorrow, and you are not punished twice for one bad afternoon. RESEARCH.md
   * argues the symmetry under "Retiring a ghost word".
   *
   * No demotion arithmetic is needed anywhere: n is also the selector, so a
   * wrong answer leaves the count low and the word comes back sooner. */
  function credit(rows, entry) {
    var list = rows || [];
    if (!entry || !entry.word || !entry.day) return list;
    var taken = list.some(function (r) {
      return r && r.word === entry.word && r.day === entry.day;
    });
    return taken ? list : list.concat([entry]);
  }

  var api = {
    ROUND: ROUND, CANDIDATES: CANDIDATES, MIN_WORDS: MIN_WORDS,
    dayOf: dayOf, countsFrom: countsFrom, credit: credit
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKRetrieval = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/retrieval.test.js`
Expected: PASS, 0 failed

- [ ] **Step 5: Mutation-test the day cap**

DEVELOPING.md requires load-bearing logic to be mutation-tested. Temporarily change `return taken ? list : list.concat([entry]);` to `return list.concat([entry]);`.

Run: `node test/retrieval.test.js`
Expected: FAIL on "a second row for the same word-day is refused". Then revert the mutation and confirm PASS again.

- [ ] **Step 6: Add the suite to the runner**

In `test/run.sh`, add `test/retrieval.test.js` to the `for t in ...` list, after `test/mistakes.test.js`.

Run: `sh test/run.sh`
Expected: every suite passes, including the new one.

- [ ] **Step 7: Commit**

```bash
git add retrieval.js test/retrieval.test.js test/run.sh
git commit -m "feat: count a retrieval by the day it happened

One row per word per day, ok or not. n counts distinct ok days, so two
devices offline on the same day merge to one -- which is why the table
will carry no unique constraint. A wrong answer occupies the day and adds
nothing, and needs no demotion arithmetic: n is also the selector, so a
missed word comes back sooner on its own."
```

---

### Task 2: `retrieval.js` — harvesting sentences from the corpus

Turn stored messages into eligible sentences: the three sources, the day gate, sentence splitting, the length floor and the in-level filter.

**Files:**
- Modify: `retrieval.js`
- Modify: `test/retrieval.test.js`

**Interfaces:**
- Consumes: `dayOf()` from Task 1.
- Produces: `HSKRetrieval.sentences(opts) -> [{ text, kind, day, conversationId }]` where `kind` is one of `"partner"`, `"story"`, `"mine"`, `"correction"`. `opts` is `{ turns, starters, today, segment, validate }`. Task 3's `batch()` calls this; dictation and scramble will too.

- [ ] **Step 1: Write the failing tests**

Append to `test/retrieval.test.js`, above the final `console.log`:

```js
// --- sentences --------------------------------------------------------------
/* A real lexicon, not a stub: the suite should fail if segmentation or
 * validation changes under it, which is the whole point of feeding them in. */
const fs = require("fs");
const path = require("path");
const HSK = require("../validator.js");
const lex = HSK.buildLexicon(
  JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk1.json"), "utf8")));
const segment = t => HSK.segment(t, lex);
const validate = t => HSK.validate(t, lex).length === 0;

const TODAY = "2026-09-12";
const YDAY = "2026-09-11";
const at = day => day + "T09:00:00Z";

const partner = (text, day) => ({
  role: "assistant", text: text, created_at: at(day || YDAY), conversation_id: "c1"
});
const segmentTurn = (text, day) => ({
  role: "assistant", kind: "segment", text: text, created_at: at(day || YDAY), conversation_id: "c1"
});
const mine = (text, grade, day) => ({
  role: "user", text: text, grade: grade, created_at: at(day || YDAY), conversation_id: "c1"
});
const sents = (turns, over) => R.sentences(Object.assign(
  { turns: turns, starters: [], today: TODAY, segment: segment, validate: validate }, over || {}));

const LONG = "我今天下午在学校看见你的朋友了。";   // 8 word tokens, all HSK 1
const SHORT = "我很好。";                          // 3 word tokens, under MIN_WORDS

check(sents([partner(LONG)]).length === 1, "a partner sentence is eligible");
check(sents([partner(LONG)])[0].kind === "partner", "partner turns are tagged partner");
check(sents([segmentTurn(LONG)])[0].kind === "story", "a story segment is tagged story");
check(sents([partner(LONG, TODAY)]).length === 0,
  "nothing from today: retrieval needs a gap, or it tests the screen");
check(sents([partner(SHORT)]).length === 0,
  "a sentence under MIN_WORDS is a guess, not a context");
check(sents([partner("我喜欢咖啡。")]).length === 0,
  "an out-of-level sentence is dropped even though it was stored");

check(sents([mine(LONG, { ok: true, errors: [] })]).length === 1,
  "my own sentence counts when the grader passed it");
check(sents([mine(LONG, { ok: false, errors: [{ tag: "word-choice" }], better: "" })]).length === 0,
  "a sentence the grader failed is never asked back at me");
check(sents([mine("x", null)]).length === 0, "an ungraded sentence is not eligible");
check(sents([mine(LONG, { ok: true, errors: [] })], { starters: [LONG] }).length === 0,
  "a tapped starter is not my writing");

/* The one source that comes from a turn the rule above rejects. The sentence
 * the learner got wrong returns as the sentence they get asked about. */
const corrected = mine("我今天下午在学校看见你的朋友。",
  { ok: false, errors: [{ tag: "aspect-le" }], better: LONG });
check(sents([corrected]).length === 1, "the grader's correction is corpus");
check(sents([corrected])[0].kind === "correction", "a correction is tagged correction");
check(sents([corrected])[0].text === LONG, "the correction's text, not the learner's");

const two = partner("我今天下午在学校看见你的朋友了。你的朋友是谁呀？");
check(sents([two]).length === 2, "a message splits into sentences", JSON.stringify(sents([two])));
check(sents([two])[0].text === LONG, "the terminator stays with its sentence");
check(sents([partner(LONG)])[0].day === YDAY, "the source day rides along for display");
check(R.sentences({ turns: null, today: TODAY, segment: segment, validate: validate }).length === 0,
  "no turns, no sentences");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/retrieval.test.js`
Expected: FAIL — `R.sentences is not a function`

- [ ] **Step 3: Write the implementation**

Add to `retrieval.js`, above the `api` object:

```js
  /* Sentence boundaries. The same character class validator.js:191 already
   * uses to find a question, and a terminator stays with the sentence it ends.
   * Written as a match rather than a split with a lookbehind: this file has to
   * run in whatever browser the learner's phone shipped with. */
  function splitSentences(text) {
    return (String(text || "").match(/[^。！？!?\n]+[。！？!?]?/g) || [])
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  /* Every source is re-validated here, whatever it is.
   *
   * Not belt-and-braces. RESEARCH.md's "The grammar check writes Chinese of
   * its own" records that nothing validates or retries the Chinese a teaching
   * call writes -- only the partner's replies get validate-and-retry -- so a
   * correction can carry out-of-level words. And a learner who moves DOWN a
   * level has a history that is no longer in level at all. The check is
   * offline and free; the alternative is showing a word the app promised not
   * to show. */
  function sentences(opts) {
    var o = opts || {}, out = [];
    var starters = o.starters || [];
    (o.turns || []).forEach(function (t) {
      if (!t || !t.text) return;
      var day = dayOf(t.created_at);
      if (!day || day >= o.today) return;      // nothing from today
      var sources = [];
      if (t.role === "assistant") {
        sources.push({ text: t.text, kind: t.kind === "segment" ? "story" : "partner" });
      } else if (t.role === "user" && t.grade) {
        var own = starters.indexOf(String(t.text || "").trim()) === -1;
        if (t.grade.ok && own) sources.push({ text: t.text, kind: "mine" });
        /* Regardless of this turn's `ok`, and deliberately: the correction is
         * the grader's sentence, not the learner's. parseGrade() has already
         * blanked the corrections that are character-for-character the
         * sentence they correct. */
        if (t.grade.better) sources.push({ text: t.grade.better, kind: "correction" });
      }
      sources.forEach(function (src) {
        splitSentences(src.text).forEach(function (s) {
          var words = o.segment(s).filter(function (tok) { return tok.kind === "word"; });
          if (words.length < MIN_WORDS) return;
          if (!o.validate(s)) return;
          out.push({ text: s, kind: src.kind, day: day,
                     conversationId: t.conversation_id || null });
        });
      });
    });
    return out;
  }
```

Add `sentences: sentences` to the `api` object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node test/retrieval.test.js`
Expected: PASS, 0 failed

- [ ] **Step 5: Mutation-test the day gate**

Change `if (!day || day >= o.today) return;` to `if (!day) return;`.
Run: `node test/retrieval.test.js`
Expected: FAIL on "nothing from today". Revert and confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add retrieval.js test/retrieval.test.js
git commit -m "feat: harvest eligible sentences from the learner's corpus

Partner replies, story segments, sentences the grader passed, and the
grader's own corrections -- that last one from turns the ok rule rejects,
which is the point: the sentence you got wrong comes back as the sentence
you get asked about.

Everything is re-validated at generation time. Teaching Chinese is never
validated when it is written (RESEARCH.md), and a learner who drops a level
has a history that is no longer in level."
```

---

### Task 3: `retrieval.js` — `batch()`, the item generator

Target selection, distractors, and assembly into a round.

**Files:**
- Modify: `retrieval.js`
- Modify: `test/retrieval.test.js`

**Interfaces:**
- Consumes: `sentences()`, `countsFrom()`, the constants.
- Produces: `HSKRetrieval.batch(opts) -> [{ text, at, len, target, candidates, source }]`
  - `opts`: `{ turns, starters, counts, learning, mistakes, pool, today, size, segment, validate, random }`
  - `counts` is `countsFrom()`'s output. `learning` is `S.learning` rows (`{w, from, ...}`). `mistakes` is a flat array of word strings. `pool` is the active allowlist (`[{w, p, d, f}]`). `random` is `fn() -> [0,1)`.
  - `at` is the character index of the blank in `text`, `len` its length. `candidates` has `CANDIDATES` entries including the target, shuffled. `source` is the `{kind, day, conversationId}` from `sentences()`.

- [ ] **Step 1: Write the failing tests**

Append to `test/retrieval.test.js`, above the final `console.log`:

```js
// --- batch ------------------------------------------------------------------
/* A fixed sequence, not Math.random: a generator whose output cannot be pinned
 * is one you can only test for "did not throw". */
const seeded = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

const pool = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk1.json"), "utf8"));
const learning = w => ({ w: w, from: 2, seen: 6 });

const batch = over => R.batch(Object.assign({
  turns: [partner(LONG)], starters: [], counts: {}, learning: [learning("朋友")],
  mistakes: [], pool: pool, today: TODAY, size: R.ROUND,
  segment: segment, validate: validate, random: seeded([0.1, 0.4, 0.7, 0.2, 0.9])
}, over || {}));

const one = batch()[0];
check(!!one, "an item is generated from one eligible sentence");
check(one.target === "朋友", "the target is a word the learner is learning");
check(LONG.slice(one.at, one.at + one.len) === "朋友",
  "at/len point at the target inside the sentence", JSON.stringify(one));
check(one.candidates.length === R.CANDIDATES, "four candidates");
check(one.candidates.indexOf("朋友") !== -1, "the target is among the candidates");
check(new Set(one.candidates).size === R.CANDIDATES, "no duplicate candidates");
check(one.candidates.every(w => LONG.indexOf(w) === -1 || w === "朋友"),
  "no distractor is already visible in the sentence", JSON.stringify(one.candidates));
check(one.source.kind === "partner" && one.source.day === YDAY,
  "the item knows where it came from");

check(batch({ learning: [], mistakes: [] }).length === 0,
  "a sentence with no word worth practising is skipped, not filled with 的");
check(batch({ mistakes: ["朋友"], learning: [] })[0].target === "朋友",
  "a word from the mistake ledger is worth practising too");

/* The selector: fewest retrievals first, ties commonest-first. 朋友 has been
 * retrieved twice, 学校 not at all, so 学校 is the one to ask. */
const twoWords = { learning: [learning("朋友"), learning("学校")],
  counts: { "朋友": { n: 2, days: { "2026-09-01": true, "2026-09-02": true } } } };
check(batch(twoWords)[0].target === "学校", "the fewest-retrievals word wins");

/* 学校 has the fewest retrievals and would win -- but it has already been
 * answered today, so the day cap hands the item to 朋友 instead. */
const doneToday = {
  learning: [learning("朋友"), learning("学校")],
  counts: { "学校": { n: 0, days: { [TODAY]: true } }, "朋友": { n: 5, days: {} } }
};
check(batch(doneToday)[0].target === "朋友",
  "a word already answered today is not offered again");

const many = [];
for (let i = 0; i < 15; i++) many.push(partner(LONG, "2026-09-0" + ((i % 8) + 1)));
check(batch({ turns: many }).length <= R.ROUND, "a round is at most ROUND items");
const targets = batch({ turns: many, learning: [learning("朋友"), learning("学校")] })
  .map(it => it.target);
check(new Set(targets).size === targets.length, "no target is repeated in a round");

check(batch({ turns: [] }).length === 0, "an empty corpus yields an empty round");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/retrieval.test.js`
Expected: FAIL — `R.batch is not a function`

- [ ] **Step 3: Write the implementation**

Add to `retrieval.js`, above the `api` object:

```js
  function shuffle(list, random) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* Three wrong candidates that are obviously wrong make the task free of
   * information. The lists already carry what is needed to do better: a
   * frequency rank. Nearest ranks, then a random three out of that window --
   * pure nearest-rank would hand the same word the same three distractors
   * every time it came round.
   *
   * No part-of-speech data exists anywhere in this app, so rank proximity is
   * the whole of the similarity model. The blank renders fixed-width, so
   * length does not have to match and is not a cue either way. */
  function distractors(target, sentence, pool, random) {
    var seen = {};
    seen[target] = true;
    var eligible = (pool || []).filter(function (e) {
      if (!e || !e.w || seen[e.w]) return false;
      return sentence.indexOf(e.w) === -1;
    });
    var tf = null;
    (pool || []).forEach(function (e) { if (e.w === target && e.f) tf = e.f; });
    var ranked = tf === null
      ? shuffle(eligible, random)
      : eligible.slice().sort(function (a, b) {
          return Math.abs((a.f || Infinity) - tf) - Math.abs((b.f || Infinity) - tf);
        });
    var window = ranked.slice(0, tf === null ? CANDIDATES - 1 : (CANDIDATES - 1) * 4);
    return shuffle(window, random).slice(0, CANDIDATES - 1).map(function (e) { return e.w; });
  }

  /* Fewest retrievals first, ties commonest-first.
   *
   * Not weakest-first tiers, and not random. Random mostly blanks 的 and 我;
   * tiers sound better than they behave, because a target only exists if an
   * eligible sentence happens to contain it, so a mistake-ledger tier can be
   * empty while feeling like it should be full. Fewest-retrievals spreads
   * practice across the words the learner is actually working on and makes the
   * stored count load-bearing -- it is the selector, not a score. */
  function pickTarget(tokens, worth, counts, rank, today, used) {
    var best = null;
    tokens.forEach(function (tok, i) {
      if (tok.kind !== "word" || !worth[tok.text] || used[tok.text]) return;
      var c = counts[tok.text] || { n: 0, days: {} };
      if (c.days[today]) return;                  // one retrieval a day, each way
      var r = rank[tok.text];
      if (r === undefined) r = Infinity;
      if (!best || c.n < best.n || (c.n === best.n && r < best.rank)) {
        best = { word: tok.text, n: c.n, rank: r, index: i };
      }
    });
    return best;
  }

  function batch(opts) {
    var o = opts || {}, counts = o.counts || {}, used = {};
    var worth = {}, rank = {};
    (o.learning || []).forEach(function (e) { if (e && e.w) worth[e.w] = true; });
    (o.mistakes || []).forEach(function (w) { if (w) worth[w] = true; });
    (o.pool || []).forEach(function (e) { if (e && e.w && e.f) rank[e.w] = e.f; });

    var size = o.size || ROUND;
    /* Shuffled, so a round is not always the ten oldest sentences in the
     * history -- which after a month would be the same ten every time. */
    var pool = shuffle(sentences(o), o.random);
    var items = [];
    for (var i = 0; i < pool.length && items.length < size; i++) {
      var s = pool[i];
      var tokens = o.segment(s.text);
      var hit = pickTarget(tokens, worth, counts, rank, o.today, used);
      if (!hit) continue;                          // skip the sentence, do not fall back
      var before = 0;
      for (var k = 0; k < hit.index; k++) before += tokens[k].text.length;
      used[hit.word] = true;
      items.push({
        text: s.text, at: before, len: hit.word.length, target: hit.word,
        candidates: shuffle(
          [hit.word].concat(distractors(hit.word, s.text, o.pool, o.random)), o.random),
        source: { kind: s.kind, day: s.day, conversationId: s.conversationId }
      });
    }
    return items;
  }
```

Add `batch: batch` to the `api` object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node test/retrieval.test.js`
Expected: PASS, 0 failed

- [ ] **Step 5: Mutation-test the selector and the no-fallback rule**

Two mutations, one at a time, reverting after each:
1. In `pickTarget`, drop the `c.days[today]` guard → expect FAIL on "a word already answered today is not offered again".
2. In `batch`, change `if (!hit) continue;` to fall back to the first word token → expect FAIL on "a sentence with no word worth practising is skipped".

Run after each: `node test/retrieval.test.js`

- [ ] **Step 6: Commit**

```bash
git add retrieval.js test/retrieval.test.js
git commit -m "feat: generate gap-fill items from harvested sentences

Target is the fewest-retrievals word among the words the learner is
actually working on, ties commonest-first, and a sentence with no such word
is skipped rather than blanking 的. Distractors are rank neighbours drawn at
random from a window, so the same word does not get the same three wrong
answers forever.

random is injected throughout: a generator whose output cannot be pinned is
one you can only test for 'did not throw'."
```

---

### Task 4: the table and its sync

`db/schema.sql`, the converters and probe flag in `sync.js`, and their tests.

**Files:**
- Modify: `db/schema.sql` (after the `vocab_known` table at line 141, and in the RLS blocks near lines 164 and 186)
- Modify: `sync.js`
- Modify: `test/sync.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `HSKSync.retrievalToRow(entry, userId) -> row | null`
  - `HSKSync.rowsToRetrievals(rows) -> entries`
  - `HSKSync.mergeRetrievals(local, remote) -> entries` — union by `id`.
  - `HSKSync.retrievalsSupported() -> boolean`
  - `HSKSync.pushRetrievals(rows)` / `HSKSync.pullRetrievals(userId)`

**Correction to the spec.** The design says to reuse the generic
`pushVocab(table, rows)` / `pullVocab(table, userId)`. Do not. Those two throw on
any error, and the whole point of the probe is that an un-migrated database must
degrade rather than fail — a thrown error there would put the sync status into a
retry loop for the session. The retrieval table needs the same shape
`pullConversations()` uses (`sync.js:488`): catch, test with the existing
`isMissingSchema(error)` helper, set the flag, return empty.

- [ ] **Step 1: Write the failing tests**

Append to `test/sync.test.js`, above its final summary block (match the file's existing `check()` helper name and style):

```js
// --- retrievals -------------------------------------------------------------
const entry = { id: "r1", word: "朋友", day: "2026-09-11", ok: true,
                face: "gapfill", created_at: "2026-09-11T09:00:00Z" };

const rrow = S.retrievalToRow(entry, "u1");
check(rrow.user_id === "u1" && rrow.word === "朋友" && rrow.day === "2026-09-11" &&
      rrow.ok === true && rrow.face === "gapfill" && rrow.id === "r1",
  "a retrieval round-trips into a row", JSON.stringify(rrow));
check(S.retrievalToRow({ word: "" }, "u1") === null, "a row with no word is refused");
check(S.rowsToRetrievals([rrow])[0].id === "r1", "and back again");

/* Union by id, never a counter: two devices offline on the same day produce
 * two rows, both survive the merge, and countsFrom() counts the day once. */
const other = Object.assign({}, entry, { id: "r2" });
check(S.mergeRetrievals([entry], [other]).length === 2,
  "two devices, same word-day, both rows kept");
check(S.mergeRetrievals([entry], [entry]).length === 1, "the same row twice is one row");
check(S.mergeRetrievals([], null).length === 0, "an empty merge does not throw");
check(S.mergeRetrievals(null, [entry]).length === 1, "a null local side still takes the remote");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/sync.test.js`
Expected: FAIL — `S.retrievalToRow is not a function`

- [ ] **Step 3: Add the table to `db/schema.sql`**

After the `vocab_known` table definition:

```sql
-- Retrievals: one row per word, per day, per face.
--
-- Deliberately NOT a counter column. Two devices each incrementing an integer
-- offline resolve to one of the two values and the other retrieval is gone.
-- Rows merge by union on id, and the count is derived: the number of distinct
-- days a word was answered correctly. Two devices that both record the same
-- word on the same day therefore produce two rows and still count one day,
-- which is why there is NO unique constraint here -- a constraint would reject
-- the second device's push instead of absorbing it.
--
-- Append-only: nothing is ever deleted, so this is the one user-data table
-- that needs no tombstone.
--
-- `face` ships in this first migration although only gap-fill writes it today.
-- Same reasoning as conversations.title above: adding a column later means
-- whoever runs this deployment applying SQL by hand again, and "which face
-- produced this retrieval" is exactly what the tone-ID and dictation
-- evaluations will ask.

create table if not exists public.retrievals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  day text not null,
  ok boolean not null,
  face text not null default 'gapfill',
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists retrievals_user_word_idx on public.retrievals (user_id, word);
```

In the RLS section, alongside the other tables:

```sql
alter table public.retrievals enable row level security;

drop policy if exists "own rows" on public.retrievals;
create policy "own rows" on public.retrievals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

(Match the exact `create policy` wording used by `vocab_known` a few lines above — copy it rather than paraphrasing.)

- [ ] **Step 4: Write the converters and the probe in `sync.js`**

After `rowsToVocab()`:

```js
  /* ------------------------------------------------------- retrievals */

  /* Append-only rows, merged by union on id. See db/schema.sql for why this is
   * rows and not a count, and why there is no unique constraint. */
  function retrievalToRow(e, userId) {
    if (!e || !e.id || !e.word || !e.day) return null;
    return { id: e.id, user_id: userId, word: e.word, day: e.day,
             ok: !!e.ok, face: e.face || "gapfill",
             created_at: e.created_at, updated_at: new Date().toISOString() };
  }

  function rowsToRetrievals(rows) {
    return (rows || []).filter(function (r) { return r && r.id && r.word && r.day; })
      .map(function (r) {
        return { id: r.id, word: r.word, day: r.day, ok: !!r.ok,
                 face: r.face || "gapfill", created_at: r.created_at };
      });
  }

  function mergeRetrievals(local, remote) {
    var byId = new Map();
    (local || []).forEach(function (e) { if (e && e.id) byId.set(e.id, e); });
    (remote || []).forEach(function (e) { if (e && e.id && !byId.has(e.id)) byId.set(e.id, e); });
    return Array.from(byId.values());
  }
```

Add all three to the module's exported `api` object.

Next to the other schema flags (`sync.js:450`), add:

```js
  var schemaHasRetrievals = null;
```

and next to `secretSupported()`:

```js
  function retrievalsSupported() { return schemaHasRetrievals !== false; }
```

Add `retrievalsSupported` to the exports.

Then the two calls, modelled exactly on `pullConversations()` / `pushConversations()`
(`sync.js:488-539`) and using the `isMissingSchema(error)` helper that already
lives at `sync.js:485`:

```js
  /* Probed once per session, like every other optional table. A project whose
   * owner has not run the migration keeps a working gap-fill -- it just does
   * not travel between devices -- because whoever runs the deployment may not
   * be the person reading the screen.
   *
   * Its own flag, never folded into another. sync.js already records what one
   * flag standing for two facts cost: a failed push switched off conversation
   * syncing for a whole session while the status line still said "Synced". */
  async function pullRetrievals(userId) {
    var r = await client.from("retrievals").select("*").eq("user_id", userId);
    if (r.error) {
      if (isMissingSchema(r.error)) { schemaHasRetrievals = false; return []; }
      throw r.error;
    }
    schemaHasRetrievals = true;
    return r.data || [];
  }

  async function pushRetrievals(rows) {
    if (!rows.length || schemaHasRetrievals === false) return;
    var r = await client.from("retrievals").upsert(rows);
    if (r.error) {
      if (isMissingSchema(r.error)) { schemaHasRetrievals = false; return; }
      throw r.error;
    }
  }
```

Export both.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node test/sync.test.js`
Expected: PASS, 0 failed — and the count is higher than before by the number of checks you added

- [ ] **Step 6: Confirm the secrets assertion still holds**

Run: `node test/sync.test.js` and confirm the existing checks that `PREFS_KEYS` names neither `key` nor `history` still pass. Nothing in this task should touch `PREFS_KEYS`.

- [ ] **Step 7: Commit**

```bash
git add db/schema.sql sync.js test/sync.test.js
git commit -m "feat: sync retrievals as append-only rows

One row per word per day per face, merged by union on id. A counter column
would lose a retrieval every time two devices were offline together, which
is also why the table carries no unique constraint: the second device's row
is absorbed, and the count is by distinct day anyway.

Nothing is ever deleted here, so this is the one user-data table with no
tombstone. Its schema probe is its own flag, independent of the others."
```

---

### Task 5: wire the module and its state into the page

Load `retrieval.js`, hold the rows in `S`, persist them, and push/pull them.

**Files:**
- Modify: `index.html` — `<script>` block at line 987-996; `K` at line 1112; `S` near line 1194; `syncQueue` at line 1254; push block near line 2809; pull block near line 2869 and merge near 2905
- Modify: `sw.js` — `SHELL` (line 14) and the `isShell` regex (line 20)
- Modify: `.github/publish-files`

**Interfaces:**
- Consumes: `HSKRetrieval.*` (Tasks 1-3), `HSKSync.retrievalToRow` / `rowsToRetrievals` / `mergeRetrievals` / `retrievalsSupported` (Task 4).
- Produces: `S.retrievals` (array of entries), `K.retrievals` (`"hsk1chat.retrievals"`), `retrievalCounts()` and `recordRetrieval(word, ok)` in `index.html` for Task 6.

- [ ] **Step 1: Load the module in all four places**

`index.html`, after the `mistakes.js` tag (line 992):
```html
<script src="retrieval.js"></script>
```

`sw.js` `SHELL`: add `"./retrieval.js"` after `"./mistakes.js"`.

`sw.js` `isShell` regex: add `retrieval\.js` to the alternation, after `mistakes\.js`.

`.github/publish-files`: add `retrieval.js` after `mistakes.js`.

- [ ] **Step 2: Run the release test to verify all four landed**

Run: `node test/release.test.js`
Expected: PASS. If it fails with "asset: retrieval.js is pre-cached by the worker" or "publish list covers retrieval.js", one of the four is missing — this test exists because a diff never shows it.

- [ ] **Step 3: Add the state**

`K`, after the `ghostUses` line:
```js
  retrievals:"hsk1chat.retrievals",
```

`S`, after the `learning` line:
```js
  /* Retrieval rows: one per word per day per face, append-only. Counts are
   * derived by HSKRetrieval.countsFrom() and never stored -- a derived number
   * in persisted state is how two displays of the same fact start disagreeing. */
  retrievals: store.get(K.retrievals, []),
```

`syncQueue` (line 1254): add `retrievals: false,` before `prefs: false`.

- [ ] **Step 4: Add the two helpers**

Next to `ghostDayKey()` (`index.html:5581`):

```js
/* Counts, derived on demand. Cheap: this list is one row per word per day, not
 * a scan of every message the way ghostProgressMap() is. */
function retrievalCounts() { return HSKRetrieval.countsFrom(S.retrievals); }

/* One row per word per day, in both directions -- the cap lives in
 * HSKRetrieval.credit(), so the tap handler cannot get it wrong. The id and
 * the timestamp are generated HERE because the module is pure and may not
 * reach for crypto or the clock. */
function recordRetrieval(word, ok, face) {
  const before = S.retrievals;
  S.retrievals = HSKRetrieval.credit(before, {
    id: crypto.randomUUID(), word: word, day: ghostDayKey(), ok: !!ok,
    face: face || "gapfill", created_at: new Date().toISOString()
  });
  if (S.retrievals === before) return false;         // already banked today
  store.set(K.retrievals, S.retrievals);
  queueSync("retrievals");
  return true;
}
```

- [ ] **Step 5: Wire push and pull**

In the push block, after the `vocab_known` line (`index.html:2811`):
```js
    if (q.retrievals) {
      await HSKSync.pushRetrievals(
        S.retrievals.map(e => HSKSync.retrievalToRow(e, syncUser.id)).filter(Boolean));
    }
```

In the pull block, add `HSKSync.pullRetrievals(syncUser.id)` to the `Promise.all` array and a matching name to the destructured list, then next to the other merges (`index.html:2907`):
```js
    S.retrievals = HSKSync.mergeRetrievals(S.retrievals, HSKSync.rowsToRetrievals(retrievalRows));
    store.set(K.retrievals, S.retrievals);
```

- [ ] **Step 6: Run the whole suite**

Run: `sh test/run.sh`
Expected: everything passes, browser suite included.

- [ ] **Step 7: Commit**

```bash
git add index.html sw.js .github/publish-files
git commit -m "feat: hold and sync retrieval rows

S.retrievals is the stored rows; the count is always derived. The id and
the timestamp are minted here rather than in the module, which is what lets
the module stay pure enough for node to load it.

A new file the page loads has to be named in four places -- script tag,
SHELL, the isShell regex and the publish list -- or the worker never
installs and the deploy 404s. release.test.js checks three of them."
```

---

### Task 6: the gap-fill sheet

The dropdown entry, the sheet, the round, the summary, and the empty states.

**Files:**
- Modify: `index.html` — markup near the other sheets (after `vocabSheet`, line 948); `fillActivities()` at line 4356; the activity `<select>` change handler; new render functions near the other sheet renderers
- Modify: `test/browser.test.js`

**Interfaces:**
- Consumes: `HSKRetrieval.batch()`, `retrievalCounts()`, `recordRetrieval()`, `openSheet()` / `closeSheet()` (`index.html:5832`), `usableWords()`, `S.base`, `S.learning`, `mistakeCounts()`, `starterTexts()`, `ghostDayKey()`.
- Produces: a working screen. Nothing downstream depends on it.

- [ ] **Step 1: Add the markup**

After the `vocabSheet` block, following the existing `.sheet` / `.card` / `.sheethead` pattern exactly (copy `vocabSheet`'s header markup and change the ids):

```html
<div class="sheet" id="gapSheet"><div class="card">
  <div class="sheethead">
    <b>Gap-fill</b><span id="gapProgress" class="secnote"></span>
    <button id="gapX" class="sheetx" type="button" aria-label="Close gap-fill" title="Close">✕</button>
  </div>
  <div id="gapBody"></div>
</div></div>
```

Wire close the way `poolSheet` does (`index.html:5924-5949`): the ✕, and a click on the backdrop.

- [ ] **Step 2: Add the dropdown entry**

In `fillActivities()` (`index.html:4356`), after the `ACTIVITIES` options are built, append one more:

```js
  /* Not a row in HSKPrompt.ACTIVITIES, deliberately. Every key in that table is
   * a conversation config, and newChat() will happily create a chat for any id
   * it knows -- a gapfill row would be a conversation waiting to be started
   * against a prompt that does not exist. This is a menu item that behaves like
   * a button: it opens the sheet and puts the select back where it was. */
  $("#activity").insertAdjacentHTML("beforeend",
    '<option value="__gapfill">Gap-fill</option>');
```

In the `#activity` change handler, before anything else:

```js
  if (e.target.value === "__gapfill") { fillActivities(); openGapFill(); return; }
```

(`fillActivities()` re-selects the real current activity, which is what restores the select.)

- [ ] **Step 3: Build the round**

Near the other sheet renderers:

```js
/* One round, built once when the sheet opens. Rebuilt only by "Again": an item
 * list that regenerated on every render would change under the learner's thumb
 * between reading the sentence and tapping. */
let gapRound = null, gapAt = 0, gapRight = 0;

function gapItems() {
  return HSKRetrieval.batch({
    turns: Object.keys(S.chatMsgs || {}).reduce((all, cid) =>
      all.concat((S.chatMsgs[cid] || []).map(t =>
        Object.assign({}, t, { conversation_id: cid }))), []),
    starters: starterTexts(),
    counts: retrievalCounts(),
    learning: S.learning,
    mistakes: mistakeCounts().reduce((ws, m) =>
      ws.concat((m.words || []).map(w => w.word)), []),
    pool: S.base,
    today: ghostDayKey(),
    size: HSKRetrieval.ROUND,
    segment: t => HSK.segment(t, S.lex),
    validate: t => HSK.validate(t, S.lex).length === 0,
    random: Math.random
  });
}

function openGapFill() {
  gapRound = gapItems(); gapAt = 0; gapRight = 0;
  renderGapFill();
  openSheet("#gapSheet");
}
```

- [ ] **Step 4: Render an item, the summary and the empty states**

```js
/* The blank is fixed-width whatever the target's length, so character count
 * leaks nothing -- which is also why distractors need not match length.
 *
 * Pinyin is suppressed on the blank and kept on the rest of the sentence: with
 * the global pinyin toggle on, a reading over the blank hands over the answer.
 * Same reason there is no audio and no translate control in this sheet. Audio
 * belongs to dictation, where hearing it IS the task. */
function renderGapFill() {
  const body = $("#gapBody"), prog = $("#gapProgress");
  if (!gapRound) return;
  if (!gapRound.length) { prog.textContent = ""; body.innerHTML = gapEmpty(); return; }
  if (gapAt >= gapRound.length) {
    prog.textContent = "";
    body.innerHTML = '<div class="hint"><b>' + gapRight + " / " + gapRound.length +
      "</b><br>" + gapRound.length + " word" + (gapRound.length === 1 ? "" : "s") +
      ' practised.<br><button id="gapAgain" class="primary">Again</button></div>';
    $("#gapAgain").onclick = () => openGapFill();
    return;
  }
  const it = gapRound[gapAt];
  prog.textContent = (gapAt + 1) + "/" + gapRound.length;
  // Render the sentence in three pieces so the blank is never pinyin-annotated.
  // renderChinese() is the app's existing token renderer; the blank is plain.
  body.innerHTML =
    '<div class="gapsentence">' + gapText(it.text.slice(0, it.at)) +
      '<span class="gapblank" id="gapBlank">____</span>' +
      gapText(it.text.slice(it.at + it.len)) + '</div>' +
    '<div class="note">from ' + gapSourceLabel(it.source) + '</div>' +
    '<div class="gapchoices">' + it.candidates.map((w, i) =>
      '<button class="gapchoice" data-w="' + escapeHtml(w) + '" type="button">' +
      escapeHtml(w) + '</button>').join("") + '</div>';
  Array.from(body.querySelectorAll(".gapchoice")).forEach(b => {
    b.onclick = () => answerGap(b.dataset.w, b);
  });
}

/* The app's own token renderer, so a word in the sheet looks like the same word
 * in a bubble. tokenSpan() emits data-py and the global pinyin CSS does the
 * rest -- which is exactly why the blank is NOT a token span: with no data-py
 * there is nothing for the pinyin rule to annotate, and the answer cannot leak
 * through the toggle.
 *
 * needs is null and flagLatin false: nothing here is a required word, and
 * everything here has already passed validate(). */
function gapText(part) {
  return HSK.segment(part, S.lex)
    .map(tok => tokenSpan(tok, null, false)).join("");
}

/* Three cases, named separately. A single "nothing to practise" covering all
 * three is the failure drillWhyNot() was written to fix. */
function gapEmpty() {
  const older = Object.keys(S.chatMsgs || {}).some(cid =>
    (S.chatMsgs[cid] || []).some(t => HSKRetrieval.dayOf(t.created_at) < ghostDayKey()));
  if (!older) {
    return '<div class="hint"><b>Nothing to practise yet</b><br>' +
      'Gap-fill asks about sentences you met on an earlier day — chat today, ' +
      'come back tomorrow.</div>';
  }
  const counts = retrievalCounts(), today = ghostDayKey();
  const learningWords = (S.learning || []).map(e => e.w);
  const allDone = learningWords.length > 0 && learningWords.every(w =>
    counts[w] && counts[w].days[today]);
  if (allDone) {
    return '<div class="hint"><b>Done for today</b><br>' +
      'Every word you are working on has had its retrieval. One a day is the ' +
      'point — come back tomorrow.</div>';
  }
  return '<div class="hint"><b>No words to practise</b><br>' +
    'Gap-fill asks about words you are currently learning. Turn on ' +
    '<b>Introduce words from the next level</b> in Settings → Learning, ' +
    'chat for a day, then come back.</div>';
}

function gapSourceLabel(src) {
  const what = src.kind === "story" ? "a story"
    : src.kind === "mine" ? "something you wrote"
    : src.kind === "correction" ? "a correction"
    : "your chat";
  return what + " · " + src.day;
}

/* Correct: fill the blank and move on after a beat. Wrong: show the answer and
 * wait for a tap -- the learner needs time to read what they missed. Exactly
 * one row is written either way, and only if today is still open for that word. */
function answerGap(word, btn) {
  const it = gapRound[gapAt];
  const right = word === it.target;
  Array.from($("#gapBody").querySelectorAll(".gapchoice")).forEach(b => {
    b.disabled = true;
    if (b.dataset.w === it.target) b.classList.add("ok");
  });
  if (!right) btn.classList.add("bad");
  $("#gapBlank").textContent = it.target;
  $("#gapBlank").classList.add(right ? "ok" : "bad");
  recordRetrieval(it.target, right);
  if (right) gapRight++;
  if (right) setTimeout(() => { gapAt++; renderGapFill(); }, 900);
  else $("#gapBody").insertAdjacentHTML("beforeend",
    '<div style="margin-top:12px"><button id="gapNext" class="primary">Next</button></div>'),
    $("#gapNext").onclick = () => { gapAt++; renderGapFill(); };
}
```

Add CSS beside the other sheet styles: `.gapsentence` at ~24px with generous line height; `.gapblank` as an inline-block with a bottom border and a fixed `min-width` of about 3em; `.gapchoices` a flex-wrap row; `.gapchoice` using the existing `--tap` minimum height so every candidate is a comfortable target; `.ok` green, `.bad` red, using the existing `--ok` / `--bad` variables.

**Known and accepted:** the visible words are `tokenSpan()` output, so the
tap-to-gloss popover may open on them. Harmless — those words are not the
answer — and it is why the blank is a plain span rather than a token.

- [ ] **Step 5: Verify by hand in a browser**

Serve the directory (`python3 -m http.server 8000`), open it, and check, in order:
1. The activity dropdown lists Gap-fill last; selecting it opens the sheet and the dropdown snaps back to the previous activity.
2. With no history, the empty state says "chat today, come back tomorrow".
3. With seeded history (see the next step for the seeding snippet), an item renders, the blank is fixed-width, and turning on the pinyin toggle annotates the sentence but **not** the blank.
4. A correct tap goes green and advances; a wrong tap reveals the answer and waits for Next.
5. Answering the same word twice on the same day writes only one row: check `JSON.parse(localStorage.getItem("hsk1chat.retrievals")).length` before and after.

- [ ] **Step 6: Add one browser test**

In `test/browser.test.js`, following the existing seeding pattern (`localStorage.setItem` before a reload, then DOM assertions through `exec`), add a case that:
- seeds `hsk1chat.chatMsgs` with one assistant turn dated yesterday whose text is `我今天下午在学校看见你的朋友了。`, and `hsk1chat.learning` with `[{"w":"朋友","from":2,"seen":6}]`;
- reloads, selects `__gapfill` in `#activity`, and waits for `#gapSheet.open`;
- asserts `#gapBlank` exists and its text is `____`;
- asserts exactly four `.gapchoice` buttons;
- clicks the button whose text is `朋友` and asserts `hsk1chat.retrievals` gains exactly one row with `ok: true`;
- asserts that the pinyin toggle being on leaves `#gapBlank` without a pinyin annotation — this is the leak the design calls out, and it is the only place it can be checked automatically.

- [ ] **Step 7: Run the whole suite**

Run: `sh test/run.sh`
Expected: all suites pass. Note that `browser.test.js` exits 0 where firefox or geckodriver is missing — if it prints a skip, the new case did **not** run, and it has to be run on a machine that has them before this task is done.

- [ ] **Step 8: Commit**

```bash
git add index.html test/browser.test.js
git commit -m "feat: gap-fill, the retrieval engine's first face

A sheet, not an activity: every key in ACTIVITIES is a conversation config,
and a gapfill row would be a chat waiting to be started against a prompt
that does not exist. The dropdown entry is a menu item that behaves like a
button.

The blank is fixed-width so character count leaks nothing, and pinyin is
suppressed on it -- with the global toggle on, a reading over the blank is
the answer. Same reason there is no audio here: that is dictation's face.

The empty state names which of the three preconditions is missing, rather
than saying 'nothing to practise' and leaving the learner to guess."
```

---

### Task 7: release and the documents that travel with it

**Files:**
- Modify: `index.html:1064` (`VERSION`)
- Modify: `sw.js:10` (`CACHE`)
- Modify: `RESEARCH.md`
- Modify: `BACKLOG.md`

- [ ] **Step 1: Bump the version in both files**

`index.html`: `const VERSION   = "v101 — 2026-09-13";`  (the ship date, not the plan's date)
`sw.js`: `const CACHE = "hsk-chat-v101";`

- [ ] **Step 2: Verify the release test enforces the pairing**

Run: `node test/release.test.js`
Expected: PASS. Then temporarily bump only `sw.js` to v102 and re-run — expect FAIL on "VERSION and CACHE are the same release". Revert to v101 and confirm PASS.

- [ ] **Step 3: Record the constants in RESEARCH.md**

Add a section after "Retiring a ghost word" (it is the section this one argues against merging with):

```markdown
## What a retrieval counts, and why it is not a ghost credit

**Informed by the literature; the numbers are not measured.** `ROUND = 10`,
`CANDIDATES = 4`, and a sentence is eligible from the day after it was met.

Folse (2006) beat one original-sentence exercise with three fill-in-the-blanks
on the same words: the number of retrievals drives retention, not the depth of
any single one. That is the argument for gap-fill existing at all, and it is
also the argument for keeping the rounds short and frequent rather than long.

**Why a retrieval is counted separately from `GHOST_USES`.** That counter means
*days on which the learner produced the word in a graded sentence*, and the
section above is explicit that it is a productive threshold not derived from
the receptive studies behind `PROMOTE_AT`. A tap in gap-fill is recognition.
Feeding it into the ghost count would not fill the counter faster, it would
change what the counter means — and would make a tap game the fast way to
retire a ghost word.

**Why four candidates.** Recall-versus-recognition is genuinely mixed: one
study found multiple choice produced *more* productive retrieval than cued
recall, and format comparisons find no significant difference in outcome. Four
candidates and one tap is therefore as well-evidenced as typing through an IME,
and is one gesture instead of ten.

**Why nothing from today.** Retrieval after a gap is the mechanism. A sentence
read four minutes ago tests the screen, not memory. It is the same UTC
`dayKey()` the ghost and drill counters use, for the same reason.

**Why the count is also the selector.** The word with the fewest retrievals is
the next one asked, so a wrong answer — which banks the day without adding to
the count — brings the word back sooner. No demotion arithmetic exists anywhere
in this path, and none is needed.

These are unmeasured. If round length or candidate count turns out to matter,
measure it and change this section with the code.
```

- [ ] **Step 4: Update BACKLOG.md**

- In "Order of work", move item 1 out of **Next** and note that the engine shipped in v101, leaving items 2 and 3 as the next two.
- In "One retrieval engine, and the activities that fall out of it", replace "What would settle it" with what was built: the module name, the three functions, and the fact that dictation, tone ID and scramble now need only a presentation over `batch()`.
- In the Dictation entry, replace "Build it as a face of the retrieval engine above" with the concrete call: `HSKRetrieval.batch()`, ignore `candidates`, hide `text`, play it with `speak()`.

**Note:** BACKLOG.md has uncommitted changes in the working tree that predate this branch. Stage only the hunks belonging to this feature (`git add -p`), and leave the rest alone.

- [ ] **Step 5: Run the whole suite**

Run: `sh test/run.sh`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add index.html sw.js RESEARCH.md
git add -p BACKLOG.md
git commit -m "docs: v101 — the retrieval engine, and the numbers it introduced

ROUND, CANDIDATES and the day gate go in RESEARCH.md with the argument for
each, including the one that matters most: a retrieval is counted separately
from GHOST_USES because that counter means days the learner PRODUCED a word,
and a tap is recognition. Merging them would redefine the counter and make a
tap game the fast way to retire a ghost."
```

---

## Verification before calling this done

Per `superpowers:verification-before-completion` — evidence, not assertion:

1. `sh test/run.sh` passes in full, on a machine with firefox and geckodriver, and the browser suite's output shows the new gap-fill case actually ran rather than the suite skipping.
2. The four registration points for `retrieval.js` are all present (`node test/release.test.js` covers three; check `sw.js`'s `isShell` regex by eye).
3. `VERSION` and `CACHE` both read v101, and no other unmerged branch claims that number.
4. In a browser with sync on against a database that has **not** had the migration applied: gap-fill still opens, still records locally, and the sync status does not go into a failure loop. This is the degrade-don't-fail requirement and no test covers it.
5. Answering the same word twice in one day leaves exactly one row in `hsk1chat.retrievals`.
