# 20 Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `twenty` activity: the student either thinks of something for the
model to guess (`side: "answerer"`) or guesses what the model thought of
(`side: "guesser"`), with no question counter and no app-side win detection.

**Architecture:** A fifth `HSKPrompt.ACTIVITIES` entry (`gen: "turn"`,
`converse: false`) plus a role branch in `HSKPrompt.build()` parallel to the
existing `storyPhase` branch. Role and secret live on the conversation object
(`c.side`, `c.secret`), fixed once at chooser time exactly like `activity`/
`level`, and reach the model only through `systemPrompt()`. The chooser reuses
story time's slot in `renderStarters()` and its `openingTurn()` gate in
`startActivity()`.

**Tech Stack:** Vanilla JS, no build step. Node's `assert`-free `check()`
harness for tests (`test/prompt.test.js`, `test/sync.test.js`).

**Spec:** `docs/superpowers/specs/2026-09-03-twenty-questions-design.md`

## Global Constraints

- No build step, no bundler, no dependency, anywhere — including tests (CLAUDE.md).
- `VERSION` in `index.html` and `CACHE` in `sw.js` must move together (CLAUDE.md, D-independent).
- The secret is never rendered anywhere in the UI — not the title, not the meta
  line, not a debug panel. Only `systemPrompt()` reads it (design D3).
- The secret needs no new legalization mechanism: it is drawn from `S.base`, so
  the model is already allowed to say it (design D4).
- No question counter, no automatic win/lose detection — the model narrates
  and the student ends a round by starting a new chat (design D1).
- `db/schema.sql` changes are `add column if not exists`, matching the existing
  convention (design section 2).
- `PREFS_KEYS` in `sync.js` must never name `key` or `history` (CLAUDE.md) —
  unaffected by this feature, but no task here may touch that list.
- A prompt change needs a real-model A/B before shipping (CLAUDE.md) — this
  plan implements the design; the A/B is a follow-up the design's own "Open
  questions" section already calls out as expected, not a gap in this plan.

---

## Task 1: `GUESS_POOL` and `pickSecret` in prompt.js

**Files:**
- Modify: `prompt.js:267` (insert after the `STORY_NAMES` array, before the
  `QUESTION_SHAPES` comment)
- Modify: `prompt.js:785-798` (api export)
- Test: `test/prompt.test.js`

**Interfaces:**
- Produces: `HSKPrompt.GUESS_POOL` (array of plain word strings, no per-level
  tagging), `HSKPrompt.pickSecret(base, rng)` — `base` is an array of `{w,...}`
  entries (e.g. `S.base`), `rng` is an optional `() => number in [0,1)`
  defaulting to `Math.random`. Returns a word string, or `null` if `base` is
  empty.

- [ ] **Step 1: Write the failing test**

Append to `test/prompt.test.js` (before the final `console.log` block):

```js
/* The secret pool for 20 Questions: concrete, guessable nouns, not tagged per
 * level -- membership is checked against the student's own cumulative
 * wordlist at pick time instead. */
check(Array.isArray(P.GUESS_POOL) && P.GUESS_POOL.length >= 30,
  "GUESS_POOL has a real number of entries", P.GUESS_POOL && P.GUESS_POOL.length);
check(new Set(P.GUESS_POOL).size === P.GUESS_POOL.length,
  "GUESS_POOL has no duplicates");
check(P.GUESS_POOL.every(function (w) { return typeof w === "string" && w.length; }),
  "every entry is a non-empty string");

var hsk1Words = new Set(JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "hsk1.json"), "utf8")
).map(function (e) { return e.w; }));
var hsk1Hits = P.GUESS_POOL.filter(function (w) { return hsk1Words.has(w); });
check(hsk1Hits.length >= 15,
  "HSK 1 alone already clears a real chunk of the pool -- an empty " +
  "intersection is not a realistic case at any level", hsk1Hits.length);

// pickSecret: filter to the student's own words, fall back if the
// intersection is empty, and never throw on an empty base.
var base1 = [{ w: "苹果" }, { w: "猫" }, { w: "水" }];   // 水 is not in GUESS_POOL
var zeroRng = function () { return 0; };
check(P.pickSecret(base1, zeroRng) === "苹果" || P.pickSecret(base1, zeroRng) === "猫",
  "pickSecret only ever returns a word actually in the base", P.pickSecret(base1, zeroRng));
check(["苹果", "猫", "水"].indexOf(P.pickSecret(base1, zeroRng)) !== -1,
  "and it is one the caller actually offered");

var baseNoOverlap = [{ w: "水" }, { w: "空气" }];   // neither is in GUESS_POOL
check(P.pickSecret(baseNoOverlap, zeroRng) === "水",
  "an empty intersection falls back to any word in base, not a throw");

check(P.pickSecret([], zeroRng) === null,
  "an empty base returns null rather than throwing");

var manyRng = function () { return 0.999999; };
check(P.pickSecret([{ w: "苹果" }], manyRng) === "苹果",
  "rng is clamped to a real index even near 1");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/prompt.test.js`
Expected: FAIL — `P.GUESS_POOL` is `undefined`, `Array.isArray(undefined)` is
false, and `P.pickSecret` throws `P.pickSecret is not a function`.

- [ ] **Step 3: Write minimal implementation**

Insert into `prompt.js`, immediately after the `STORY_NAMES` array (currently
ends at line 267 with `];`) and before the `QUESTION_SHAPES` comment:

```js
  /* The secret pool for `guesser` mode: concrete, guessable nouns. No
   * per-level tagging -- an uncurated random word from the raw allowlist can
   * be ungoessable (因为, 应该, 如果), so membership is checked against the
   * student's own cumulative wordlist (S.base) at PICK time instead of
   * asserted up front. Measured against the real data/hsk<N>.json files, HSK 1
   * alone already yields well over half of this pool, so an empty
   * intersection is not a realistic case at any level -- pickSecret() still
   * falls back to any word in base if it ever is one, rather than throwing. */
  var GUESS_POOL = [
    "苹果", "猫", "狗", "书", "老师", "医院", "电脑", "手机", "椅子", "桌子",
    "车", "飞机", "火车", "水果", "衣服", "雨",
    "咖啡", "鱼", "鸟", "床", "门", "花", "足球", "裤子",
    "香蕉", "西瓜", "房子", "伞", "自行车", "公园", "太阳", "山", "树",
    "窗户", "眼镜", "帽子", "星星"
  ];

  /* base: an array of {w,...} entries, e.g. S.base. rng: () => [0,1), so a
   * test can pin the draw. Filters to what the student actually has, falls
   * back to the raw base if that intersection is empty, and returns null only
   * when there is truly nothing to draw from. */
  function pickSecret(base, rng) {
    var r = rng || Math.random;
    var have = {};
    (base || []).forEach(function (e) { have[e.w] = true; });
    var pool = GUESS_POOL.filter(function (w) { return have[w]; });
    if (!pool.length) pool = (base || []).map(function (e) { return e.w; });
    if (!pool.length) return null;
    return pool[Math.min(pool.length - 1, Math.floor(r() * pool.length))];
  }
```

Add to the `api` object near the end of `prompt.js` (alongside `STORY_NAMES`):

```js
              GUESS_POOL: GUESS_POOL, pickSecret: pickSecret,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/prompt.test.js`
Expected: PASS, all checks including the new ones.

- [ ] **Step 5: Commit**

```bash
git add prompt.js test/prompt.test.js
git commit -m "feat: add 20 Questions secret pool and picker"
```

---

## Task 2: `twenty` activity and role branch in `HSKPrompt.build()`

**Files:**
- Modify: `prompt.js:291-331` (`ACTIVITIES`)
- Modify: `prompt.js:412-425` (the `phase` if/else-if chain in `build()`)
- Test: `test/prompt.test.js`

**Interfaces:**
- Consumes: nothing new from Task 1 except `pickSecret`/`GUESS_POOL` being
  present (not called from `build()` itself — the caller picks the secret
  once, at chooser time; `build()` only ever reads `opts.secret`).
- Produces: `HSKPrompt.ACTIVITIES.twenty` (`{label, rules: null, names: null,
  reuse: null, gen: "turn", converse: false, note}`), and `build()` accepting
  `opts.side` (`"answerer" | "guesser" | undefined`) and `opts.secret`
  (string) when `opts.activity === "twenty"`.

- [ ] **Step 1: Write the failing test**

Append to `test/prompt.test.js`:

```js
/* 20 Questions: a role branch parallel to storyPhase, per D6. Neither role's
 * text is held to the level allowlist -- same rule as every other activity's
 * `rules`, which already use 英文/语法. */
check(!!P.ACTIVITIES.twenty, "activity twenty exists");
check(P.ACTIVITIES.twenty.gen === "turn", "twenty generates one turn at a time");
check(P.ACTIVITIES.twenty.converse === false,
  "twenty suppresses the ordinary chat turn-taking rules -- a yes/no exchange isn't that shape");
check(P.ACTIVITIES.twenty.names === null, "twenty has no cast");

var noSide = P.build({ level: 1, label: "HSK 1", length: "short", activity: "twenty" });
check(noSide.indexOf("你负责猜") === -1 && noSide.indexOf("你心里想的是") === -1,
  "with no side chosen yet, neither role's rule appears");

var answerer = P.build({ level: 1, label: "HSK 1", length: "short",
                         activity: "twenty", side: "answerer" });
check(answerer.indexOf("学生心里想了一个东西，你负责猜") !== -1,
  "answerer: the model is told it is the one guessing");
check(answerer.indexOf("大概二十个问题以内") !== -1,
  "and given the roughly-twenty budget to narrate against");
check(answerer.indexOf("你心里想的是") === -1,
  "and not handed a secret it never got");

var guesser = P.build({ level: 1, label: "HSK 1", length: "short",
                        activity: "twenty", side: "guesser", secret: "苹果" });
check(guesser.indexOf("你心里想的是「苹果」") !== -1,
  "guesser: the model is told its own secret");
check(guesser.indexOf("只回答「是」或「不是」") !== -1,
  "and told to answer only yes/no");
check(guesser.indexOf("学生心里想了一个东西") === -1,
  "and not given the answerer's rule instead");

var guesserNoSecret = P.build({ level: 1, label: "HSK 1", length: "short",
                                activity: "twenty", side: "guesser" });
check(guesserNoSecret.indexOf("你心里想的是") === -1,
  "guesser with no secret yet adds no rule at all, rather than leaking a literal undefined");

// The conversational turn-taking rules must actually leave the prompt.
var twentyPrompt = P.build({ level: 1, label: "HSK 1", length: "short",
                             activity: "twenty", side: "answerer" });
check(twentyPrompt.indexOf(ASK_RULE) === -1,
  "twenty drops the ask-a-new-question rule -- the round has its own shape");

// Script conversion reaches the secret exactly like every other app-authored
// rule -- it is Chinese vocabulary data, not learner-typed English like a
// story topic.
var guesserTrad = P.build({ level: 1, label: "HSK 1", length: "short",
                            activity: "twenty", side: "guesser", secret: "苹果",
                            script: "trad", convert: function (t) { return t.replace(/苹果/g, "蘋果"); } });
check(guesserTrad.indexOf("蘋果") !== -1,
  "the secret is passed through the same convert() as the rest of the rule");

// Rule numbering must survive the role branch, same as every other activity.
var twentyNums = twentyPrompt.split("\n").map(function (l) {
  return (/^(\d+)\. /.exec(l) || [])[1];
}).filter(Boolean).map(Number);
check(JSON.stringify(twentyNums) === JSON.stringify(twentyNums.map(function (_, i) { return i + 1; })),
  "twenty: rule numbering is gap-free and in order", JSON.stringify(twentyNums));
```

Also extend the existing activity-contract loop to cover `twenty`:

```js
const ACT_IDS = ["chat", "focused", "story", "twenty"];
```

(This is a one-line edit to the existing `ACT_IDS` declaration, not a new
block — find it above the `for (const id of ACT_IDS)` loop.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/prompt.test.js`
Expected: FAIL — `P.ACTIVITIES.twenty` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `prompt.js`, add to the `ACTIVITIES` object, after the `story` entry:

```js
    twenty: {
      label: "20 Questions",
      /* Role-dependent, not activity-dependent -- handled by the branch in
       * build() below, same shape as storyPhase. */
      rules: null,
      names: null,
      reuse: null,
      gen: "turn",
      /* A yes/no-question exchange isn't the answer-then-share-then-ask shape
       * these rules assume; see the role branch in build(). */
      converse: false,
      note: "20 Questions: think of something and let the partner guess it, " +
        "or guess what the partner is thinking of."
    }
```

In `build()`, change the `phase` if/else-if chain:

```js
    if (phase === "asking") {
      var ladder = questionTypesFor(opts.level);
      rules.push(convert("现在问学生一个关于他刚才读的那一段的问题，一次只问一个。") +
        convert("问题要短，用简单的话。") +
        convert("可以问这样的问题：") + QUESTION_SHAPES
          .filter(function (q) { return ladder.types.indexOf(q.type) !== -1; })
          .map(function (q) { return convert(q.shape); }).join("、") + convert("。"));
    } else if (phase === "discussing") {
      rules.push(convert("学生在回答你刚才的问题。先说他答得对不对，") +
        convert("再用学生会的词把对的答案说一次。说完就停，不要再问新的问题。"));
    } else if (opts.activity === "twenty" && opts.side === "answerer") {
      rules.push(convert("学生心里想了一个东西，你负责猜。一次只问一个是非问题") +
        convert("（能用「是不是」、「对不对」、「有没有」回答的那种），") +
        convert("大概二十个问题以内猜出来，一边猜一边说这是第几个问题。"));
    } else if (opts.activity === "twenty" && opts.side === "guesser" && opts.secret) {
      var secret = convert(opts.secret);
      rules.push(convert("你心里想的是「") + secret + convert("」。学生问你是非问题，") +
        convert("只回答「是」或「不是」（可以简单地多说一点，但是不要自己说出这个东西是什么）。") +
        convert("如果学生猜对了，或者说不猜了，你才可以说出「") + secret + convert("」。"));
    } else {
      (act.rules || []).forEach(function (r) { rules.push(convert(r)); });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/prompt.test.js`
Expected: PASS, all checks.

- [ ] **Step 5: Commit**

```bash
git add prompt.js test/prompt.test.js
git commit -m "feat: add twenty activity with role-branched rules"
```

---

## Task 3: `side`/`secret` sync — schema, round-trip, merge, push

**Files:**
- Modify: `db/schema.sql:103` (insert after the `level` column's `alter table`)
- Modify: `sync.js` — `conversationToRow`, `rowToConversation`,
  `mergeConversations`, the `schemaHas*` flags, `probeSchema`,
  `pushConversations`, and the second `Object.assign(api, {...})` block
- Test: `test/sync.test.js`

**Interfaces:**
- Produces: `HSKSync.sideSupported()`, `HSKSync.secretSupported()` (mirroring
  `activitySupported`/`levelSupported`). `conversationToRow`/
  `rowToConversation` carry `side`/`secret`; `mergeConversations` keeps
  whichever side actually has a value (not newest-wins, same rule as
  `activity`/`level`).

- [ ] **Step 1: Write the failing test**

Append to `test/sync.test.js`, immediately after the existing `level` block
(after the `mergedLevNull` check, before the `storyModel` check):

```js
/* side is the fifth optional column: which role the STUDENT took in a 20
 * Questions conversation. Behaves exactly like activity/level: fixed at
 * creation, NULL when the column or the row predates it. */
const convS = { id: "e1", title: "T", side: "guesser",
                created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" };
const rowS = Sync.conversationToRow(convS, "u1");
check(rowS.side === "guesser", "conversationToRow carries the side");
check(Sync.rowToConversation(rowS).side === "guesser", "and it survives the round trip");
check(Sync.rowToConversation({ id: "e2", created_at: "x", updated_at: "x" }).side === null,
  "a row with no side column reads back as no side, not a guessed default");

const mergedSide = Sync.mergeConversations(
  [{ id: "f1", title: "local", side: "answerer", updated_at: "2026-01-02T00:00:00Z" }],
  [{ id: "f1", title: "remote", side: "answerer", updated_at: "2026-01-03T00:00:00Z" }]);
check(mergedSide[0].side === "answerer", "side survives a merge -- it is not dropped");

// Same rule as activity/level: a newer row that lost the column must not erase ours.
const mergedSideNull = Sync.mergeConversations(
  [{ id: "f2", side: "guesser", updated_at: "2026-01-01T00:00:00Z" }],
  [{ id: "f2", side: null, updated_at: "2026-01-09T00:00:00Z" }]);
check(mergedSideNull[0].side === "guesser",
  "a newer row with no side does not erase the one we have");

/* secret is the sixth optional column, present only for a guesser round.
 * This only checks it moves -- design D3 (never rendered) is index.html's job. */
const convSec = { id: "e3", title: "T", side: "guesser", secret: "苹果",
                  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const rowSec = Sync.conversationToRow(convSec, "u1");
check(rowSec.secret === "苹果", "conversationToRow carries the secret");
check(Sync.rowToConversation(rowSec).secret === "苹果", "and it survives the round trip");
check(Sync.rowToConversation({ id: "e4", created_at: "x", updated_at: "x" }).secret === null,
  "a row with no secret column reads back as no secret");

const mergedSecret = Sync.mergeConversations(
  [{ id: "f3", secret: "猫", updated_at: "2026-01-01T00:00:00Z" }],
  [{ id: "f3", secret: null, updated_at: "2026-01-09T00:00:00Z" }]);
check(mergedSecret[0].secret === "猫",
  "a newer row with no secret does not erase the one we have");

// The schema file must actually declare both, or the push fails against a real db.
check(/add column if not exists side text/.test(schema),
  "db/schema.sql adds the side column");
check(/add column if not exists secret text/.test(schema),
  "db/schema.sql adds the secret column");
```

In the async IIFE at the bottom of the file, extend the Scenario 1 conversation
push check (right after the existing `convCalls1` checks, still inside
Scenario 1, before the `// --- Scenario 2` comment):

```js
  check(convCalls1[0] && convCalls1[0].keys.indexOf("side") !== -1 &&
        convCalls1[0].keys.indexOf("secret") !== -1,
    "and the twenty-questions columns ride along with activity/level");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/sync.test.js`
Expected: FAIL — `rowS.side` is `undefined`, `db/schema.sql` has no `side`/
`secret` column yet.

- [ ] **Step 3: Write minimal implementation**

In `db/schema.sql`, after the `level` column's `alter table` (currently line
103, `alter table public.conversations add column if not exists level int;`):

```sql

-- Which role the STUDENT took in a 20 Questions conversation ("answerer" —
-- the student thinks of something and the model guesses — or "guesser" — the
-- model thinks of something and the student guesses), and, only for a
-- guesser round, what the model is thinking of. Fixed at creation like
-- activity and level. secret is read by nothing except the prompt sent to
-- the model -- it is never shown to the student, so an un-migrated database
-- degrading to no secret just means the chooser reappears on that device.

alter table public.conversations add column if not exists side text;
alter table public.conversations add column if not exists secret text;
```

In `sync.js`, `conversationToRow()`:

```js
  function conversationToRow(c, userId) {
    if (!c || !c.id) return null;
    return {
      id: c.id,
      user_id: userId,
      title: c.title || null,
      activity: c.activity || "chat",
      level: c.level || null,
      side: c.side || null,
      secret: c.secret || null,
      created_at: c.created_at,
      updated_at: c.updated_at || new Date().toISOString(),
      deleted_at: c.deleted ? (c.deleted_at || new Date().toISOString()) : null
    };
  }
```

`rowToConversation()`:

```js
  function rowToConversation(row) {
    return {
      id: row.id,
      title: row.title || "",
      activity: row.activity || "chat",
      level: row.level || null,
      side: row.side || null,
      secret: row.secret || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted: !!row.deleted_at,
      deleted_at: row.deleted_at || null
    };
  }
```

`mergeConversations()`, inside the `merged` object literal:

```js
      var merged = {
        id: newer.id, title: newer.title,
        activity: existing.activity || incoming.activity || "chat",
        level: existing.level || incoming.level || null,
        // Same rule as activity/level: fixed at creation, so whichever side
        // actually has a value wins, never whichever is newer.
        side: existing.side || incoming.side || null,
        secret: existing.secret || incoming.secret || null,
        created_at: existing.created_at || incoming.created_at,
        updated_at: newer.updated_at,
        deleted: !!(existing.deleted || incoming.deleted),
        deleted_at: existing.deleted_at || incoming.deleted_at || null
      };
```

The `schemaHas*` flags:

```js
  var schemaHasConversations = null;   // null = not probed yet
  var schemaHasConvId = null;
  var schemaHasGrade = null;
  var schemaHasActivity = null;
  var schemaHasLevel = null;
  var schemaHasKind = null;
  var schemaHasSide = null;
  var schemaHasSecret = null;

  function conversationsSupported() { return schemaHasConversations !== false; }
  function gradesSupported() { return schemaHasGrade !== false; }
  function activitySupported() { return schemaHasActivity !== false; }
  function levelSupported() { return schemaHasLevel !== false; }
  function sideSupported() { return schemaHasSide !== false; }
  function secretSupported() { return schemaHasSecret !== false; }
```

`probeSchema()`:

```js
  async function probeSchema() {
    if (schemaHasGrade === null) {
      var r = await client.from("messages").select("grade").limit(1);
      schemaHasGrade = !(r.error && isMissingSchema(r.error));
    }
    if (schemaHasKind === null) {
      var k = await client.from("messages").select("kind").limit(1);
      schemaHasKind = !(k.error && isMissingSchema(k.error));
    }
    if (schemaHasActivity === null) {
      var a = await client.from("conversations").select("activity").limit(1);
      schemaHasActivity = !(a.error && isMissingSchema(a.error));
    }
    if (schemaHasLevel === null) {
      var l = await client.from("conversations").select("level").limit(1);
      schemaHasLevel = !(l.error && isMissingSchema(l.error));
    }
    if (schemaHasSide === null) {
      var s = await client.from("conversations").select("side").limit(1);
      schemaHasSide = !(s.error && isMissingSchema(s.error));
    }
    if (schemaHasSecret === null) {
      var sec = await client.from("conversations").select("secret").limit(1);
      schemaHasSecret = !(sec.error && isMissingSchema(sec.error));
    }
    return { conversations: conversationsSupported(), grade: gradesSupported(),
             activity: activitySupported(), level: levelSupported(),
             side: sideSupported(), secret: secretSupported() };
  }
```

`pushConversations()`:

```js
  async function pushConversations(rows) {
    if (!rows.length || schemaHasConversations === false) return;
    var drop = [];
    if (schemaHasActivity === false) drop.push("activity");
    if (schemaHasLevel === false) drop.push("level");
    if (schemaHasSide === false) drop.push("side");
    if (schemaHasSecret === false) drop.push("secret");
    var payload = drop.length
      ? rows.map(function (r) {
          var copy = {};
          Object.keys(r).forEach(function (k) {
            if (drop.indexOf(k) === -1) copy[k] = r[k];
          });
          return copy;
        })
      : rows;
    var r = await client.from("conversations").upsert(payload);
    if (r.error) {
      if (isMissingSchema(r.error) &&
          (schemaHasActivity !== false || schemaHasLevel !== false ||
           schemaHasSide !== false || schemaHasSecret !== false)) {
        schemaHasActivity = false;
        schemaHasLevel = false;
        schemaHasSide = false;
        schemaHasSecret = false;
        return pushConversations(rows);
      }
      if (isMissingSchema(r.error)) { schemaHasConversations = false; return; }
      throw r.error;
    }
  }
```

In the second `Object.assign(api, {...})` block, add next to `levelSupported`:

```js
    activitySupported: activitySupported,
    levelSupported: levelSupported,
    sideSupported: sideSupported,
    secretSupported: secretSupported,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/sync.test.js`
Expected: PASS, all checks including the new ones, and the pre-existing
`convCalls1[0]` check for `activity`/`level` still passes unchanged.

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql sync.js test/sync.test.js
git commit -m "feat: sync side and secret columns for 20 Questions"
```

---

## Task 4: Wire `twenty` into index.html

**Files:**
- Modify: `index.html` — `startActivity()`, `renderStarters()`,
  `defaultPrompt()`, `renderComposer()`, `renderAll()`'s empty-history hint,
  and two new functions: `chooseTwentySide()`, `renderTwentyControl()`

**Interfaces:**
- Consumes: `HSKPrompt.pickSecret` (Task 1), `HSKPrompt.ACTIVITIES.twenty`
  and the `side`/`secret` branch in `HSKPrompt.build()` (Task 2), `c.side`/
  `c.secret` round-tripping through `HSKSync` (Task 3), and the existing
  `currentChat()`, `currentActivity()`, `openingTurn()`, `saveChats()`,
  `queueSync()`, `renderStarters()`.
- Produces: `chooseTwentySide(side)` — sets `c.side` (and `c.secret` for
  `"guesser"`), persists, and starts the opening turn. `renderTwentyControl(box)`
  — renders the two chooser buttons only while `c.side` is unset.

There is no unit test harness for index.html's DOM logic (browser.test.js is
the Playwright suite and needs firefox+geckodriver locally); this task's
verification is `sh test/run.sh` (confirms nothing else broke, and
`release.test.js` still passes) plus the manual walkthrough in Step 4.

- [ ] **Step 1: `startActivity()` withholds the opening turn until a role is chosen**

Find (around index.html:2297):

```js
function startActivity(id) {
  const c = newChat(HSKPrompt.ACTIVITIES[id] ? id : "chat");
  renderStarters();
  const act = HSKPrompt.activityFor(currentActivity());
  /* A story no longer starts itself. The chooser is the first thing the learner
   * sees, so nothing is generated -- and nothing is spent -- until they have
   * said what the story should be about. Every other activity still opens with
   * the partner speaking. */
  if (act.gen !== "segments" && id !== "chat") openingTurn();
  return c;
}
```

Replace the `if` line with:

```js
  // Same withholding as story time, for the same reason: nothing is
  // generated until the learner has chosen a role, since the role decides
  // what the model is even allowed to say.
  if (act.gen !== "segments" && id !== "chat" && id !== "twenty") openingTurn();
```

- [ ] **Step 2: The chooser — `chooseTwentySide()` and `renderTwentyControl()`**

Add these two functions next to `renderStoryControl` (around index.html:4531,
right after it):

```js
/* Choosing a role for 20 Questions: fixed once, exactly like activity/level
 * (design D5). secret only for guesser, drawn from the curated pool
 * intersected with the student's own cumulative wordlist -- never rendered
 * anywhere; only systemPrompt() reads it (design D3). Guarded on c.side so a
 * double tap (or a stray click after the first choice already landed) cannot
 * silently redraw the secret out from under an in-progress round. */
function chooseTwentySide(side) {
  const c = currentChat();
  if (!c || c.side) return;
  c.side = side;
  if (side === "guesser") c.secret = HSKPrompt.pickSecret(S.base);
  saveChats();
  queueSync("conversations");
  renderStarters();
  openingTurn();
}

/* Choosing state only -- once `side` is set there is nothing to show here,
 * same as the ordinary chat starters once a story control's own topic
 * exists. */
function renderTwentyControl(box) {
  const c = currentChat();
  if (!c || c.side) return;
  const answerer = document.createElement("button");
  answerer.className = "story";
  answerer.textContent = "I'll think of something";
  answerer.onclick = () => chooseTwentySide("answerer");
  box.appendChild(answerer);
  const guesser = document.createElement("button");
  guesser.className = "story";
  guesser.textContent = "You think of something";
  guesser.onclick = () => chooseTwentySide("guesser");
  box.appendChild(guesser);
}
```

- [ ] **Step 3: Wire the render/prompt/composer call sites**

In `renderStarters()` (around index.html:4536), add a branch beside the
existing `"story"` one:

```js
  if (currentActivity() === "story") return renderStoryControl(box);
  if (currentActivity() === "twenty") return renderTwentyControl(box);
```

In `defaultPrompt()` (around index.html:1318), add `side`/`secret` next to
`storyTopic`:

```js
function defaultPrompt(offer, reuse, required, ctx) {
  const c = currentChat();
  const p = HSKPrompt.build({
    offer: offer || [],
    reuse: reuse || [],
    require: required || "",
    level: S.level,
    label: levelLabel(),
    length: S.replyLength,
    script: S.script,
    activity: currentActivity(),
    storySegment: (ctx && ctx.storySegment) || null,
    storyPhase: (ctx && ctx.storyPhase) || null,
    storyTopic: currentActivity() === "story" ? storyTopic() : "",
    side: currentActivity() === "twenty" ? (c && c.side) : null,
    secret: currentActivity() === "twenty" ? (c && c.secret) : null,
    // wordList() is already in the active script, so it must not be converted
    // a second time; build() appends it after the conversion hook.
    words: effectiveMode() === "with-list" ? wordList() : "",
    convert: toScript
  });
  return p;
}
```

In `renderComposer()` (around index.html:4435), disable typing until a role
is chosen, the same way story time disables it until a topic is chosen:

```js
function renderComposer() {
  const c = currentChat();
  const listening = (currentActivity() === "story" && !anyStoryQuestion() &&
    !(S.history.some(t => t.role === "user") || storyTold() > STORY_SEGMENTS)) ||
    (currentActivity() === "twenty" && !(c && c.side));
  input.disabled = listening;
  input.placeholder = listening ? "" : "用中文写…";
}
```

In `renderAll()`'s empty-history hint (around index.html:2034), add a branch
so the hint does not show the ordinary chat instructions while the chooser is
still on screen:

```js
    if (currentActivity() === "story") {
      hintText = (storyTopic() ? 'Tap <b>Start the story</b> below.'
                                : 'Pick what the story is about below.') +
        '<br>' + STORY_SEGMENTS +
        ' short parts, one tap each —<br>then the partner asks you about it.';
    } else if (currentActivity() === "twenty") {
      hintText = 'Pick who thinks of something, below.';
    } else if (currentActivity() === "focused") {
```

(The rest of that if/else-if chain, and everything after it, is unchanged.)

- [ ] **Step 4: Manual walkthrough**

This step has no automated harness; run it by hand once:

1. Open the app (`python3 -m http.server` from the repo root, then the served
   URL) with a real or test API key configured.
2. Switch the activity selector to "20 Questions". Confirm: no reply is
   generated yet, the composer is disabled, and two buttons appear —
   "I'll think of something" and "You think of something".
3. Tap "I'll think of something". Confirm: the composer enables, and the
   model's first message narrates that it is about to start guessing (no
   secret is visible anywhere — not the meta line, not the title).
4. Start a new "20 Questions" chat, tap "You think of something". Confirm:
   the composer enables, the model's first message does not reveal what it
   picked, and asking "是不是..." questions gets a yes/no answer without the
   model naming the thing until you guess correctly or give up.
5. Open the chat list (the sheet showing past conversations). Confirm the
   meta line for both chats reads "20 Questions · N messages · ..." with no
   secret anywhere in it.

- [ ] **Step 5: Run the full suite and commit**

Run: `sh test/run.sh`
Expected: every suite passes (or `browser.test.js` reports it is skipping
itself for lack of firefox/geckodriver — that is a pass for the purposes of
this task, per CLAUDE.md).

```bash
git add index.html
git commit -m "feat: wire the twenty activity chooser into index.html"
```

---

## Task 5: Version bump

**Files:**
- Modify: `index.html:927` (`VERSION`)
- Modify: `sw.js:10` (`CACHE`)

No new file is added to `sw.js`'s `SHELL` — `prompt.js`, `sync.js`, `index.html`
and `db/schema.sql` are all already pre-cached or not page-loaded assets
(`db/schema.sql` is never fetched by the page).

- [ ] **Step 1: Bump both version stamps together**

In `index.html`, change:

```js
const VERSION   = "v75 — 2026-09-02";
```

to (using today's date):

```js
const VERSION   = "v76 — 2026-09-03";
```

In `sw.js`, change:

```js
const CACHE = "hsk-chat-v75";
```

to:

```js
const CACHE = "hsk-chat-v76";
```

- [ ] **Step 2: Run the full suite**

Run: `sh test/run.sh`
Expected: every suite passes, including `test/release.test.js`'s check that
`VERSION` and `CACHE` agree.

- [ ] **Step 3: Commit**

```bash
git add index.html sw.js
git commit -m "chore: bump version for the twenty activity"
```

---

## Self-Review

**Spec coverage:**
- State table (Choosing/Playing) → Task 4 Steps 1-3.
- D1 (no counter/win detection) → no task adds either; the role rules in
  Task 2 only narrate.
- D2 (curated pool ∩ S.base) → Task 1.
- D3 (secret never rendered) → Task 4 only threads `secret` into
  `defaultPrompt()`, never into any render/title/meta path; verified by the
  manual walkthrough's step 5.
- D4 (no legalization mechanism) → no task adds one, matching the design.
- D5 (side fixed once) → `chooseTwentySide()`'s `if (!c || c.side) return;` guard.
- D6 (build() branches on side) → Task 2.
- D7 (chooser reuses story's slot/gate) → Task 4 Steps 1 and 3.
- Section 3 (pool + fallback + tests) → Task 1.
- Section 4 (prompt text + suppressed converse rules) → Task 2.
- Section 5 (prompt.test.js, sync.test.js, no SHELL change, real-model A/B) →
  Tasks 1-2 (prompt tests), Task 3 (sync tests), Task 5 (no SHELL change,
  confirmed by `release.test.js`), A/B is out-of-plan per Global Constraints.
- "Files touched" list in the design matches this plan's task files exactly.

**Placeholder scan:** none found — every step has real code or a runnable
command.

**Type consistency:** `pickSecret(base, rng)` returns a string in Task 1 and
is called as `HSKPrompt.pickSecret(S.base)` in Task 4 with no `rng` (defaults
to `Math.random`, matching the signature). `c.side`/`c.secret` are read the
same way (`c && c.side`) in `defaultPrompt()`, `renderComposer()`, and
`renderTwentyControl()`/`chooseTwentySide()`. `opts.side`/`opts.secret` in
`build()` match the keys `defaultPrompt()` passes. `ACTIVITIES.twenty.gen`
(`"turn"`) matches the `act.gen !== "segments"` check `startActivity()` already
uses for every non-story activity.
