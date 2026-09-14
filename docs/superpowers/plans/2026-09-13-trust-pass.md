# The Trust Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five places where this repo is standing on something it has not checked — an unrun migration, an untested product guarantee, a broken measuring instrument, a discarded diagnostic, and a pinned number no model produces.

**Architecture:** Five independent tasks plus a reconciliation. Nothing here adds a feature. Four tasks touch one file each and can run in parallel or in any order; the fifth touches a test and a doc. No task spends model budget.

**Tech Stack:** Plain node test suites, no framework and no dependencies (CLAUDE.md). Firefox + geckodriver for `test/browser.test.js`. Python 3 only for `.github/scripts`.

**Spec:** `docs/superpowers/specs/2026-09-13-trust-pass-design.md`

## Global Constraints

- **No dependencies, no build step, no `package.json`** — anywhere, including tests. Do not add any.
- **Tests are plain node**: a `check(ok, label, detail)` counter, a fixture, `process.exit(1)` at the end. Write new tests the same way.
- **`VERSION` in `index.html` and `CACHE` in `sw.js` must move together** on every user-visible change. Task 4 is the only task here that touches shipped behaviour; it is console-only, so **no bump is required by any task in this plan**. If that changes, both move.
- **Any file the page loads must appear in `sw.js`'s `SHELL`.** No task here adds a file the page loads.
- **Prompt changes need a counted A/B against a real model** (CLAUDE.md). **No task in this plan edits a prompt.** Task 5 explicitly stops short of `prompt.js` for this reason.
- **Changing a pedagogical constant means updating `RESEARCH.md` with it.** Task 5 updates `RESEARCH.md` without changing a constant, which is the allowed direction.
- Run the whole suite with `sh test/run.sh`. One suite: `node test/pace.test.js`.
- Commit on a branch. Do not commit to `main`. The pre-commit hook runs the full suite and refuses a red commit.

---

### Task 1: Confirm the retrievals migration reached the live database

**Files:**
- Modify: `BACKLOG.md` (add one entry recording the answer)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks depend on.

This task is a verification, not a code change. It is first because it is the only item that can be *currently broken in production* while every test is green.

- [ ] **Step 1: Run the read-only check in the Supabase SQL editor**

This is a `select` and changes nothing:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'retrievals'
order by ordinal_position;
```

Expected, if the migration ran — seven rows:

```
id          uuid
user_id     uuid
word        text
day         text
ok          boolean
face        text
created_at  timestamptz
updated_at  timestamptz
```

Zero rows means the table does not exist and the migration has **not** run.

- [ ] **Step 2: If zero rows, run the migration**

Paste `db/schema.sql` into the Supabase SQL editor and run it. Every statement is
`create ... if not exists` / `add column if not exists`, so running it whole is
safe on an already-migrated database.

- [ ] **Step 3: Confirm RLS is on**

```sql
select relname, relrowsecurity
from pg_class
where relname = 'retrievals';
```

Expected: `relrowsecurity` is `t`. RLS is the security boundary for this project
(CLAUDE.md) — a table without it is readable across users.

- [ ] **Step 4: Record the answer in BACKLOG.md**

Add this entry immediately after the `## Order of work` section. Replace the
bracketed date and outcome with what step 1 actually returned:

```markdown
## The retrievals table needs a hand-run migration — checked

**Found:** 2026-09-13, auditing v101 against the v100 failure. **Answered**
[DATE].

`db/schema.sql` has to be run by hand against Supabase, exactly like the
`side`/`secret` columns whose absence turned every story into a chat in v100.
This one degrades instead of failing — `schemaHasRetrievals` (`sync.js:625`)
probes once and gap-fill keeps working locally — which is what makes it worth
checking deliberately: nothing anywhere reports it.

It matters more than it looks. The retrieval count is also the word selector, so
a device whose rows never sync asks the same words for ever.

**Outcome:** [table present, seven columns, RLS on — nothing to do] /
[absent; `db/schema.sql` run on DATE].

**What would settle the general case:** nothing in this repo tells you whether a
migration has been applied. Every optional-column probe degrades silently by
design, so "it works" and "it is syncing" are indistinguishable from the client.
A Settings line reporting which optional tables the current session probed
successfully would make this checkable without the SQL editor.
```

- [ ] **Step 5: Commit**

```bash
git add BACKLOG.md
git commit -m "docs: record whether the retrievals migration reached the database"
```

---

### Task 2: Regression-test the out-of-level guarantee under traditional script

**Files:**
- Modify: `test/browser.test.js` (append a case in the gap-fill block, after the existing simplified-script assertions)

**Interfaces:**
- Consumes: `GAP_YDAY` (`test/browser.test.js:36`), and the helpers `exec`, `go`, `waitFor`, `check` already in the file.
- Produces: nothing other tasks depend on.

The fix this protects keeps simplified words off the candidate buttons in
traditional mode. It currently has no test, so reverting it leaves the suite
green. `exec` runs in the page's global scope, so `S` and `HSK` are both reachable
— the file's own comment at line 112 relies on the same property.

- [ ] **Step 1: Write the failing test**

Append inside the gap-fill block, after the existing `.gapchoice` assertions:

```js
    /* ------------------------------------- gap-fill, traditional script */

    /* The out-of-level guarantee is the product, and in traditional mode it
     * was being broken: gapItems() sourced its candidate pool from S.base,
     * which is always simplified, so a third of the buttons were simplified
     * words the learner's lexicon does not contain. gapPool() fixed it and
     * lives in index.html, where no node suite can reach it -- so without this
     * case, reverting that fix leaves the suite green. */
    await exec(`
      localStorage.setItem("hsk1chat.script", JSON.stringify("trad"));
      localStorage.setItem("hsk1chat.chats", "[]");
      localStorage.removeItem("hsk1chat.chatId");
      localStorage.setItem("hsk1chat.chatMsgs", JSON.stringify({
        "eeeeeeee-2222-4222-8222-eeeeeeeeeeee": [
          { id: "e2222222-2222-4222-8222-222222222222", role: "assistant",
            text: "我今天下午在学校看见你的朋友了。", attempts: 1,
            created_at: "${GAP_YDAY}T09:00:00.000Z" }
        ]
      }));
      localStorage.setItem("hsk1chat.learning", JSON.stringify([
        { w: "朋友", from: 2, seen: 6 }
      ]));
      localStorage.setItem("hsk1chat.retrievals", "[]");
      return true;`);
    await go(base);
    await waitFor("document.querySelector('#activity option[value=\"__gapfill\"]')",
      "the app after reseeding for gap-fill in traditional script");

    await exec(`
      var sel = document.querySelector('#activity');
      sel.value = "__gapfill";
      sel.dispatchEvent(new Event("change"));
      return true;`);
    await waitFor("document.querySelector('#gapSheet').classList.contains('open')",
      "the gap-fill sheet to open in traditional script");

    check(await exec(`return S.script;`) === "trad",
      "the fixture really is in traditional script");
    check(await exec(`return document.querySelectorAll('.gapchoice').length;`) === 4,
      "traditional mode still offers one target and three distractors");

    /* The assertion that matters: every candidate validates against the ACTIVE
     * lexicon. A simplified word leaking in from S.base fails this, which is
     * exactly the shape of the bug. */
    const badCandidates = await exec(`
      return Array.from(document.querySelectorAll('.gapchoice'))
        .map(b => b.textContent.trim())
        .filter(w => HSK.validate(w, S.lex).length !== 0);`);
    check(Array.isArray(badCandidates) && badCandidates.length === 0,
      "every gap-fill candidate is in the active lexicon in traditional script",
      "out-of-level candidates: " + JSON.stringify(badCandidates));

    // Restore the default for anything later in the file.
    await exec(`localStorage.setItem("hsk1chat.script", JSON.stringify("simp")); return true;`);
```

- [ ] **Step 2: Prove the test can fail**

Do not trust a passing new test. Break the thing it guards and confirm it goes
red. In `index.html`, find `gapPool()` at line 5088 and temporarily make it
return the simplified base list:

```js
function gapPool() { return S.base; }   // TEMPORARY - revert after this step
```

Run: `node test/browser.test.js`
Expected: **FAIL** on `"every gap-fill candidate is in the active lexicon in traditional script"`, with the offending simplified words listed in the detail.

If it passes, the test is not reaching the buttons and must be fixed before
continuing — a green result here is the failure mode this whole task exists to
remove.

- [ ] **Step 3: Revert the deliberate break**

```bash
git checkout -- index.html
```

Confirm `gapPool()` is back to its real body before continuing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node test/browser.test.js`
Expected: PASS, with the total count up by three from its previous value.

- [ ] **Step 5: Run the whole suite**

Run: `sh test/run.sh`
Expected: every suite green, exit 0.

- [ ] **Step 6: Commit**

```bash
git add test/browser.test.js
git commit -m "test: the out-of-level guarantee, in traditional script"
```

---

### Task 3: Restore `judge()` in `tools/story-ab.js`

**Files:**
- Modify: `tools/story-ab.js` (add `JUDGE_PROMPT` and `judge()` next to `CLARITY_PROMPT` / `clarity()` at lines 490-506)
- Modify: `BACKLOG.md` (the `judge()` entry)

**Interfaces:**
- Consumes: `callModel(model, messages, maxTokens, temperature)` and the module-level `JUDGE` constant (line 75).
- Produces: `judge(beforeTexts, afterText) -> Promise<{ label: string, cost: number }>` where `label` is one of `"CONTINUES"`, `"RESTARTS"`, `"UNRELATED"`, or `"UNPARSED"`. The call site at line 868 already expects exactly this shape.

- [ ] **Step 1: Confirm the break is real before fixing it**

Run: `grep -n "judge" tools/story-ab.js`
Expected: a call at line 868 and references in the header comment, but **no**
`function judge` definition. This is the whole defect.

- [ ] **Step 2: Write `JUDGE_PROMPT` and `judge()`**

Insert directly after `clarity()` ends (line 506), matching its shape — same
`callModel(JUDGE, ...)`, same one-word answer, same regex parse:

```js
/* Continuity, per segment, against everything before it. Deliberately the same
 * shape as clarity() above: one judge model, a one-word answer, a regex that
 * cannot half-match. The three labels are the ones runArm()'s counters read.
 *
 * This function went missing at some commit after 1028a8a and nothing noticed:
 * the call site's .catch writes the ReferenceError into the label, so CONT,
 * RESTART and UNREL printed zero for every arm rather than erroring. Any
 * continuity number this harness printed between that commit and this one was
 * zero by accident. Task 13's topic arms are unaffected -- they were run with
 * --nojudge. */
const JUDGE_PROMPT =
  "Below is the beginning of a short Chinese story for a beginner, then ONE " +
  "further segment.\n\n" +
  "Question: does the further segment continue the story before it?\n\n" +
  "Answer with exactly one of these words and nothing else:\n" +
  "CONTINUES - it carries on the same story, with the same characters and situation\n" +
  "RESTARTS - it begins the story again, or re-introduces characters already introduced\n" +
  "UNRELATED - it is about something else entirely\n";

async function judge(before, after) {
  const res = await callModel(JUDGE, [
    { role: "user", content: JUDGE_PROMPT +
      "\n=== STORY SO FAR ===\n" + before.join("\n") +
      "\n\n=== FURTHER SEGMENT ===\n" + after + "\n\nOne word:" }
  ], 8, 0);
  const m = /CONTINUES|RESTARTS|UNRELATED/.exec(res.text.toUpperCase());
  return { label: m ? m[0] : "UNPARSED", cost: res.cost };
}
```

- [ ] **Step 3: Verify it parses and is defined**

No model call — just prove the function exists and the file still loads:

```bash
node -e 'const s=require("fs").readFileSync("tools/story-ab.js","utf8");
if(!/function judge\s*\(/.test(s)) { console.error("judge() still missing"); process.exit(1); }
if(!/CONTINUES\|RESTARTS\|UNRELATED/.test(s)) { console.error("label regex missing"); process.exit(1); }
console.log("judge() defined, labels match the counters");'
node --check tools/story-ab.js && echo "parses"
```

Expected: `judge() defined, labels match the counters` then `parses`.

- [ ] **Step 4: Verify the labels match what the counters read**

The counters at lines 886-892 read `"CONTINUES"`, `"RESTARTS"`, `"UNRELATED"`.
A typo here reintroduces the silent-zero bug in a new form:

```bash
grep -n 'lab("CONTINUES")\|lab("RESTARTS")\|lab("UNRELATED")' tools/story-ab.js
grep -n 'g.label === "CONTINUES"' tools/story-ab.js
```

Expected: three `lab(...)` lines and the clean-stories check, all matching the
strings `judge()` can return.

- [ ] **Step 5: Update the BACKLOG entry**

Replace the `**What would settle it:**` paragraph of `## judge() is undefined in tools/story-ab.js` with:

```markdown
**Fixed** 2026-09-13: `judge()` restored next to `clarity()`, which was already
the template for the request shape, returning the same three labels the counters
read. **Still open:** which published continuity numbers were zero by accident.
Task 13's topic arms were run with `--nojudge` and are unaffected. Any *other*
run that reported CONT / RESTART / UNREL since the break needs re-running before
its numbers can be quoted — RESEARCH.md's story-time sections are where to look.
```

- [ ] **Step 6: Run the whole suite**

Run: `sh test/run.sh`
Expected: green. Nothing in the suite exercises this tool, so this confirms no
collateral damage rather than confirming the fix.

- [ ] **Step 7: Commit**

```bash
git add tools/story-ab.js BACKLOG.md
git commit -m "fix: restore judge(), which had been printing zero continuity for every arm"
```

---

### Task 4: Capture why a completion came back empty

**Files:**
- Modify: `index.html:1672-1680` (`callModel`'s empty-completion path)
- Modify: `BACKLOG.md` (the empty-completion entry)

**Interfaces:**
- Consumes: `callError(kind, message)` (`index.html:1621`).
- Produces: `callModel.lastEmpty` — `{ finish, nativeFinish, provider, model, at }` or `undefined`. Nothing else reads it yet; it exists to be read off a live session's console.

The diagnosis is blocked on data the code already has and throws away.
`callModel` sets `callModel.lastFinish` at line 1679, but the empty check throws
at line 1675 — so the one case where the reason matters is the one case where it
is discarded.

- [ ] **Step 1: Read the current code so the edit lands in the right place**

Run: `sed -n '1670,1682p' index.html`
Expected: the `choice` / `txt` lines, `if (!txt) throw callError("empty", detail);`,
then the `callModel.lastFinish` assignment *after* it.

- [ ] **Step 2: Capture the three fields before throwing**

Replace:

```js
  const choice = (body.choices && body.choices[0]) || {};
  const txt = choice.message && choice.message.content;
  // The common free-tier outcome: a 200 with nothing in it.
  if (!txt) throw callError("empty", detail);
```

with:

```js
  const choice = (body.choices && body.choices[0]) || {};
  const txt = choice.message && choice.message.content;
  // The common free-tier outcome: a 200 with nothing in it.
  if (!txt) {
    /* One completion in eight comes back empty on some routes and the cause is
     * unknown. It stayed unknown because this path threw before reaching the
     * finish_reason line below, so the only case where the reason matters was
     * the only case that discarded it.
     *
     * OpenRouter routes one model id to several providers and names the one it
     * used in the response, so the first question is whether the empties
     * concentrate in one provider -- which needs the provider recorded next to
     * the reason, not either alone. Kept on the function (not in S) because it
     * is a debugging breadcrumb read off the console in a live session, not
     * state: it must never sync, never persist, and never reach the UI. */
    callModel.lastEmpty = {
      finish: choice.finish_reason || "",
      nativeFinish: choice.native_finish_reason || "",
      provider: body.provider || "",
      model: model || S.model,
      at: new Date().toISOString()
    };
    console.warn("[empty completion]", JSON.stringify(callModel.lastEmpty));
    throw callError("empty", detail);
  }
```

- [ ] **Step 3: Prove the branch works without spending a model call**

`callModel` needs a key and a network, so exercise the *shape* of the branch
against the same object an OpenRouter empty reply produces:

```bash
node -e '
// The exact body OpenRouter returns for the empty case, per the entry.
const body = { provider: "DeepInfra", choices: [ { message: { content: "" },
  finish_reason: "stop", native_finish_reason: "stop" } ] };
const choice = (body.choices && body.choices[0]) || {};
const txt = choice.message && choice.message.content;
if (txt) { console.error("fixture is not empty"); process.exit(1); }
const rec = {
  finish: choice.finish_reason || "",
  nativeFinish: choice.native_finish_reason || "",
  provider: body.provider || "",
  model: "test/model",
  at: new Date().toISOString()
};
const ok = rec.finish === "stop" && rec.nativeFinish === "stop" && rec.provider === "DeepInfra";
console.log(ok ? "empty-completion record captures all three fields" : "MISSING FIELDS");
process.exit(ok ? 0 : 1);'
```

Expected: `empty-completion record captures all three fields`, exit 0.

- [ ] **Step 4: Confirm no secret and no sync**

`callModel.lastEmpty` must never reach the network or storage:

```bash
grep -n "lastEmpty" index.html sync.js
node test/sync.test.js
```

Expected: `lastEmpty` appears only in `index.html`, never in `sync.js`, and
`sync.test.js` passes (it is the suite that asserts `PREFS_KEYS` never names
anything it should not).

- [ ] **Step 5: Update the BACKLOG entry**

Replace `**What would settle it:**` in `## One completion in eight comes back empty, cause unknown` with:

```markdown
**Instrumented** 2026-09-13, not yet diagnosed. `callModel` threw on the empty
reply *before* reaching its own `finish_reason` line, so the only case where the
reason mattered was the only case that discarded it. It now records
`finish_reason`, `native_finish_reason`, the provider and the model on
`callModel.lastEmpty` and warns them to the console before throwing.

**What would settle it:** use the app normally until the warning appears a
handful of times and read the provider field. OpenRouter routes one id to several
providers, so the question is whether the empties concentrate in one — if they
do, this is a routing problem and not a prompt or a model problem.
```

- [ ] **Step 6: Run the whole suite**

Run: `sh test/run.sh`
Expected: green, including the browser suite.

- [ ] **Step 7: Commit**

Console-only, so no `VERSION` / `CACHE` bump:

```bash
git add index.html BACKLOG.md
git commit -m "fix: an empty completion no longer throws away the reason it was empty"
```

---

### Task 5: Settle the 90-character segment target with arithmetic

**Files:**
- Modify: `test/pace.test.js:205-232` (the story-segment block)
- Modify: `index.html:1096-1106` (the comment that overstates the fragility)
- Modify: `RESEARCH.md` (record the finding)
- Modify: `BACKLOG.md` (close the entry)

**Interfaces:**
- Consumes: `P.earn(state, text, rate)`, `P.DEFAULT_RATE` (45), `P.CREDIT_CAP` (3) from `pace.js`.
- Produces: nothing other tasks depend on.

**Do not touch `prompt.js`.** The 九十个汉字 instruction at `prompt.js:565` is a
prompt, and CLAUDE.md requires a counted A/B before a prompt edit ships. Nothing
found here calls for one. This task fixes the test and the documentation, which
is where the untrue claim actually lives.

- [ ] **Step 1: Reproduce the arithmetic before changing anything**

```bash
node -e '
const P = require("./pace.js");
function story(seg, segs=5){
  let st={chars:0,credits:0}, earned=0;
  for(let i=0;i<segs;i++){
    const b=st.credits;
    st=P.earn(st,"字".repeat(seg),P.DEFAULT_RATE);
    earned+=st.credits-b;
    st={chars:st.chars,credits:0};
  }
  return earned;
}
for(const s of [55,83,90,112,168,180]) console.log(s, story(s));'
```

Expected exactly:

```
55 6
83 9
90 10
112 12
168 15
180 15
```

This is the evidence for the whole task: the shipped model's range (112–168)
earns *more* than the 90 target, not less, and the low end recovers to 6–9
because leftover characters carry between segments.

- [ ] **Step 2: Write the failing test**

Replace the block at `test/pace.test.js:211-232` (from the `/* Story segments exist ... */`
comment through the `earned >= 10` check) with a test over the measured range
rather than a single pinned number:

```js
/* Story segments exist so the per-turn pacing constants keep meaning what
 * RESEARCH.md says. The number the prompt asks for is 90, but no model produces
 * it: measured output is 55-83 on qwen and 112-168 on capable models, and
 * STORY_MODEL is anthropic/claude-sonnet-4.5 -- so the shipped path is the WIDE
 * one, not the short one. Pinning 90 tested arithmetic that never happens.
 *
 * What actually has to hold is the invariant, across everything a model really
 * produces: a segment must earn at least one credit, and a story must not throw
 * earnings away. Both hold across 55-168. earn() only discards above ~180,
 * which is beyond anything measured. */
const SEG_RANGE = [55, 70, 83, 90, 112, 135, 168], SEGS = 5;

SEG_RANGE.forEach(seg => {
  const one = P.earn({ chars: 0, credits: 0 }, "字".repeat(seg), P.DEFAULT_RATE);
  check(one.credits >= 1,
    `a ${seg}-character segment earns at least one credit`, "earned " + one.credits);
  const lost = seg - (one.credits * P.DEFAULT_RATE + one.chars);
  check(lost === 0,
    `a ${seg}-character segment discards nothing`, "lost " + lost + " chars");
});

/* A whole story, segment by segment, with the remainder carried the way the app
 * carries it. This is what recovers the short end: five 55-character segments
 * earn 6 credits, not 5, because the leftovers add up. */
function storyCredits(seg) {
  let st = { chars: 0, credits: 0 }, earned = 0;
  for (let i = 0; i < SEGS; i++) {
    const before = st.credits;
    st = P.earn(st, "字".repeat(seg), P.DEFAULT_RATE);
    earned += st.credits - before;
    st = { chars: st.chars, credits: 0 };   // spent on the next segment's slate
  }
  return earned;
}

check(storyCredits(90) === 10,
  "the 90 the prompt asks for is worth ten credits a story -- the design figure",
  "got " + storyCredits(90));
check(storyCredits(55) === 6,
  "the shortest measured segment still earns 6, not 5: the remainder carries",
  "got " + storyCredits(55));
check(storyCredits(168) === 15,
  "and the widest measured segment earns 15 without discarding",
  "got " + storyCredits(168));
check(storyCredits(112) >= 10,
  "the SHIPPED story model's range meets or beats the design figure",
  "got " + storyCredits(112));

// The failure this replaces: the same text as one turn.
```

Leave the `oneShot` lines that follow line 232 exactly as they are.

- [ ] **Step 3: Run the test to verify it passes**

Run: `node test/pace.test.js`
Expected: PASS. These assertions encode the numbers step 1 printed, so a failure
here means `pace.js` changed under the plan and step 1 must be re-run.

- [ ] **Step 4: Prove the new test can fail**

Temporarily change `CREDIT_CAP` in `pace.js:13` from `3` to `2`:

Run: `node test/pace.test.js`
Expected: **FAIL** on the discard checks at the wide end — at `CREDIT_CAP = 2` a
135-character segment stops earning and starts throwing characters away.

Then revert:

```bash
git checkout -- pace.js
```

- [ ] **Step 5: Correct the comment that overstates the fragility**

Replace the first paragraph of the comment at `index.html:1096`:

```js
/* Story segments. 90 Han characters is two credits at DEFAULT_RATE = 45 and stays
 * under CREDIT_CAP = 3, so no segment throws earnings away; five of them is a
 * ~450-character story carrying roughly ten new words, which is graded-reader
 * density reached without changing a researched constant. See RESEARCH.md.
```

with:

```js
/* Story segments. 90 Han characters is two credits at DEFAULT_RATE = 45 and stays
 * under CREDIT_CAP = 3; five of them is a ~450-character story carrying roughly
 * ten new words, which is graded-reader density reached without changing a
 * researched constant. See RESEARCH.md.
 *
 * The 90 is a target, not a threshold, and no model actually hits it: 55-83 on
 * qwen, 112-168 on capable models, and STORY_MODEL is a capable one. The
 * invariant survives that anyway -- every length in 55-168 earns at least one
 * credit and discards nothing, because earn() carries the remainder into the
 * next segment and only starts discarding above ~180. test/pace.test.js asserts
 * that across the whole measured range rather than pinning 90, which is
 * arithmetic that never happens.
```

- [ ] **Step 6: Record the finding in RESEARCH.md**

Append to the story-time section:

```markdown
**The 90-character segment target is a target, not a threshold.** The prompt asks
for 九十个汉字 (`prompt.js`) and no model delivers it: 55-83 on `qwen3-30b-a3b`,
112-168 on capable models. Since `STORY_MODEL` is `anthropic/claude-sonnet-4.5`,
the shipped path is the wide one, and the concern recorded in BACKLOG.md — that
segments run *short* of 90 — is about a model the app does not use for stories.

Worked against `earn()`, the invariant holds across the entire measured range.
Credits per five-segment story: 55→6, 83→9, 90→10, 112→12, 168→15. Nothing is
discarded anywhere in that range; `earn()`'s remainder carries between segments,
and its discard rule does not bite until ~180 characters in a single turn. The
shipped model therefore *exceeds* the ten-credit design figure rather than
missing it.

So the number is not load-bearing and is left alone: changing it would be a
prompt edit, and CLAUDE.md wants a counted A/B for one of those. What changed is
the test, which used to pin 90 — a value no model produces — and now asserts the
invariant across 55-168.
```

- [ ] **Step 7: Close the BACKLOG entry**

Replace the `**What would settle it:**` paragraph of `## Story segments run short of the 90 characters the prompt asks for` with:

```markdown
**Answered** 2026-09-13, by arithmetic rather than measurement, and the framing
in the heading above is wrong. `STORY_MODEL` is `anthropic/claude-sonnet-4.5`,
which produces 112-168 — the 55-83 figures are `qwen`, which is not the shipped
story model. The shipped path runs *wide* of 90, not short of it.

The invariant holds either way. Credits per five-segment story: 55→6, 83→9,
90→10, 112→12, 168→15, nothing discarded anywhere in the range, because `earn()`
carries the remainder between segments and only discards above ~180. The shipped
model beats the ten-credit design figure.

`test/pace.test.js` no longer pins 90. `prompt.js` is deliberately unchanged: the
number is not load-bearing, and editing it would be a prompt change needing a
counted A/B (CLAUDE.md).
```

- [ ] **Step 8: Run the whole suite**

Run: `sh test/run.sh`
Expected: green, exit 0.

- [ ] **Step 9: Commit**

Comment, test and docs only — no behaviour change, so no `VERSION` / `CACHE` bump:

```bash
git add test/pace.test.js index.html RESEARCH.md BACKLOG.md
git commit -m "test: assert the segment invariant across what models produce, not 90"
```

---

### Task 6: Reconcile BACKLOG.md and open the PR

**Files:**
- Modify: `BACKLOG.md` (the `## Order of work` section)

**Interfaces:**
- Consumes: the outcome of tasks 1-5.
- Produces: nothing.

- [ ] **Step 1: Update the "Cheap, and they restore trust in the tools" list**

That list names four items. Two are settled by this plan. Replace the list with:

```markdown
**Cheap, and they restore trust in the tools.** None is a feature; all are
currently costing something silently.

- ~~`judge()` undefined in `tools/story-ab.js`~~ — **fixed 2026-09-13.** Which
  published continuity numbers were zero by accident is still open.
- The `loadGoalList()` race in `browser.test.js` — closes out `run.sh`'s retry.
  Still open; it touches `boot()` and wants its own change.
- Place names past the validator — burns retries on a starter the app itself
  ships. Still open, and the first thing to fix before any A/B is re-run.
- 为什么 at HSK 1 — burns repairs at the level where pacing is most fragile.
  Still open; needs a counted run, so it is not part of the trust pass.
```

- [ ] **Step 2: Add the trust pass to the ranking**

Insert after the `**Built since this was ranked.**` paragraph:

```markdown
**The trust pass, 2026-09-13.** A separate axis from the ranking below —
not learner value, but whether the ground under it is checked. Five items: the
retrievals migration, a regression test for the out-of-level guarantee in
traditional script, `judge()`, the discarded empty-completion diagnostic, and the
90-character question. Spec and plan in `docs/superpowers/`. Two of the five
turned out to be *documentation* defects rather than code defects, which is worth
noting: the 90 was never load-bearing, and the story-segment entry had the shipped
model wrong.
```

- [ ] **Step 3: Verify nothing in the file still claims a fixed thing is broken**

```bash
grep -n "judge()" BACKLOG.md
grep -n "cause unknown" BACKLOG.md
grep -n "run short of the 90" BACKLOG.md
```

Each hit must sit under an entry that now records its answer. A heading may keep
its original wording — the file's convention is to append the answer rather than
rewrite history — but the body must not still say "unknown" where it is known.

- [ ] **Step 4: Run the whole suite**

Run: `sh test/run.sh`
Expected: green, exit 0.

- [ ] **Step 5: Commit and open the PR**

```bash
git add BACKLOG.md
git commit -m "docs: reconcile the backlog with the trust pass"
git push -u origin HEAD
gh pr create --base main --title "The trust pass" --body "See docs/superpowers/plans/2026-09-13-trust-pass.md"
```

---

## Self-review

**Spec coverage.** Spec item 1 → Task 1. Item 2 → Task 2. Item 3 → Task 3. Item 4
→ Task 4. Item 5 → Task 5. The spec's "what done looks like" list has six bullets;
the sixth (BACKLOG reflects all of it) is Task 6. The spec's out-of-scope list is
not implemented anywhere, which is correct.

**Placeholders.** One deliberate bracketed value remains, in Task 1 step 4: the
date and outcome of a check that has not been run yet. It is marked as such and
cannot be filled in ahead of time.

**Type consistency.** `judge(before, after) -> {label, cost}` matches the call
site at `tools/story-ab.js:868` and the three label strings match the counters at
886-892, which Task 3 step 4 verifies explicitly. `callModel.lastEmpty`'s five
fields are defined in Task 4 step 2 and asserted in step 3. `storyCredits(seg)`
and `SEG_RANGE` are defined in Task 5 step 2 and used only within that task.
`P.earn` / `P.DEFAULT_RATE` / `P.CREDIT_CAP` match `pace.js:12-13,56`.

**Ordering.** Tasks 1-5 are independent — each touches a disjoint set of files
except `BACKLOG.md`, which every task appends to in a different section. Running
them as parallel subagents will conflict in `BACKLOG.md` only; either serialise
the BACKLOG edits into Task 6 or expect a trivial merge there.
