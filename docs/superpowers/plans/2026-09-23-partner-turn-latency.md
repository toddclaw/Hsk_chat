# Partner Turn Latency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the median partner turn from 32.2s to under 10s (p90 under 20s) without weakening any correctness guarantee.

**Architecture:** The cost is multiplicative — the gate runs inside `turn()`'s retry loop, so 2.81 mean attempts each pay a ~12s gate. Attack both factors: make a gate round cheap (a non-reasoning second arm, arms run in parallel), then stop paying for attempts serially (generate 3 candidates at once, gate the survivors in parallel, ship the first that passes). Measure every stage with the same instrument.

**Tech Stack:** Plain ES2020 in `index.html`, no build step, no bundler, no dependencies. Node scripts in `tools/`. Tests are plain node with a `check(ok, label, detail)` counter.

**Spec:** `docs/superpowers/specs/2026-09-23-partner-turn-latency-design.md`

## Global Constraints

- **No build step, no bundler, no `package.json`, no dependencies — anywhere, including tests.** Do not add any.
- **`VERSION` in `index.html` and `CACHE` in `sw.js` must move together** on every user-visible change. A tools-only or docs-only change moves neither.
- **Any file the page loads must appear in `sw.js`'s `SHELL`.** `cache.addAll` is all-or-nothing.
- **Correctness never degrades to "show it anyway."** An unrepairable turn becomes the stub 我不会说.
- **Nothing reaches the screen ungated.** Any text shown has passed `gateFault()`, including text kept by a soft check.
- **The gate fails open.** A dead or timed-out grader passes the turn.
- **Never display model-corrected Chinese.** `grade.better` is repair guidance fed to the retry loop, never text on screen.
- **The benchmarked gate prompts ship character-for-character.** `test/prompt.test.js` asserts `HSKPrompt.grade({partner:true})` and `{partner:true, bar:"soft"}` byte-for-byte. Do not reword them.
- **Run `sh test/run.sh` before every commit.** `.githooks/pre-commit` runs it and refuses a failing commit.
- Extracted modules end with:
  `if (typeof module !== "undefined" && module.exports) module.exports = api;`
  `else root.HSKPace = api;`

**Measured baseline to beat** (`debug_log`, 30 days, 110 turns): median 32.2s, p75 58.2s, p90 101.5s, max 566.4s; gate 61% of wall; mean 2.81 attempts; per-attempt pass rate 35%.

---

### Task 1: The latency instrument

Build the reader before changing any behaviour, so every later stage is measured the same way. It parses what `debug_log` already carries, so it produces a baseline immediately.

**Files:**
- Create: `tools/turn-latency.js`
- Modify: `test/run.sh`

**Interfaces:**
- Consumes: the text stream `tools/pull-debug.js` prints on stdout.
- Produces: `parseTurns(text)` → `[{start, end, attempts, gateMs, gateFail, require, phases}]`, exported for the self-test. CLI prints median / p75 / p90 / max, gate share, mean attempts.

- [ ] **Step 1: Write the failing self-test**

Create `tools/turn-latency.js` containing only this, so the test runs and fails:

```js
"use strict";
const api = {};
if (typeof module !== "undefined" && module.exports) module.exports = api;
```

Then append the self-test block at the end of the same file:

```js
if (process.argv.indexOf("--selftest") !== -1) {
  const FIX = [
    "01:03:22.852     [plan] 别怕。",
    "01:03:24.827     [attempt 1] 别怕。 []",
    "01:03:26.668     [gate] teach answered in 1841ms",
    "01:03:51.965  W  [gate] glm failed after 25296ms, passing the turn: Error: x",
    "01:03:51.968     [require] 而且",
    "01:03:53.981     [attempt 2] 别怕，而且走。 []",
    "01:03:56.129     [gate] teach answered in 2147ms"
  ].join("\n");
  const t = api.parseTurns(FIX);
  let pass = 0, fail = 0;
  const check = (ok, label) => ok ? pass++ : (fail++, console.log(" FAIL " + label));
  check(t.length === 1, "one turn");
  check(t[0].attempts === 2, "two attempts, got " + (t[0] || {}).attempts);
  check(t[0].gateMs === 1841 + 25296 + 2147, "gate ms summed, got " + (t[0] || {}).gateMs);
  check(t[0].gateFail === 1, "one failed gate call");
  check(t[0].require === 1, "one require retry");
  check(t[0].end - t[0].start === 33277, "wall span, got " + (t[0].end - t[0].start));
  console.log("turn-latency selftest: " + (fail ? fail + " FAILED" : "ok"));
  process.exit(fail ? 1 : 0);
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/turn-latency.js --selftest`
Expected: FAIL — `api.parseTurns is not a function`.

- [ ] **Step 3: Implement the parser**

Replace `const api = {};` with:

```js
/* Wall-clock cost of a partner turn, reconstructed from debug_log.
 *
 * The acceptance instrument for docs/superpowers/plans/2026-09-23-partner-turn-latency.md.
 * Every stage of that plan is measured with this and nothing else, so a
 * later number is comparable with the baseline it claims to beat.
 *
 * Reads the text tools/pull-debug.js prints, rather than talking to Supabase
 * itself: the key handling, the pruning and the table-missing degradation all
 * live there already and there is no reason for a second copy.
 *
 *   node tools/pull-debug.js --hours 720 | node tools/turn-latency.js
 *   node tools/turn-latency.js --selftest
 */
"use strict";

/* A turn starts at its [plan] line, or at [attempt 1] when planning is off or
 * the activity is unplanned. It ends at the last line before the next start.
 *
 * The [plan] line is printed AFTER the planner returns, so the planner's own
 * time sits OUTSIDE every span measured here -- real turns are longer than
 * this reports. Task 2 adds [phase] lines that close that gap; until it lands,
 * treat these as a lower bound. */
const TS = (l) => {
  const m = String(l).match(/^(\d\d):(\d\d):(\d\d)\.(\d\d\d)/);
  return m ? ((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4]) : null;
};

function parseTurns(text) {
  const out = [];
  let cur = null;
  const push = () => { if (cur && cur.attempts > 0) out.push(cur); };
  const fresh = (t) => ({ start: t, end: t, attempts: 0, gateMs: 0, gateFail: 0,
                          require: 0, echo: 0, phases: {} });
  for (const line of String(text).split("\n")) {
    const t = TS(line);
    if (t === null) continue;
    if (/\[plan\] /.test(line) && !/too hard|no affordable/.test(line)) {
      push(); cur = fresh(t); continue;
    }
    if (/\[attempt 1\]/.test(line) && (!cur || cur.attempts > 0)) { push(); cur = fresh(t); }
    if (!cur) continue;
    cur.end = t;
    if (/\[attempt \d+\]/.test(line)) cur.attempts++;
    const ans = line.match(/\[gate\] .* answered in (\d+)ms/);
    if (ans) cur.gateMs += +ans[1];
    const bad = line.match(/\[gate\] .* failed after (\d+)ms/);
    if (bad) { cur.gateMs += +bad[1]; cur.gateFail++; }
    if (/\[require\]/.test(line)) cur.require++;
    if (/\[echo\]/.test(line)) cur.echo++;
    /* Task 2's per-phase lines. Absent until then, and absent on old rows
     * forever, so everything above has to keep working without them. */
    const ph = line.match(/\[phase\] (\w+) (\d+)ms/);
    if (ph) cur.phases[ph[1]] = (cur.phases[ph[1]] || 0) + +ph[2];
  }
  push();
  return out;
}

const api = { parseTurns: parseTurns };
```

- [ ] **Step 4: Run the self-test to verify it passes**

Run: `node tools/turn-latency.js --selftest`
Expected: `turn-latency selftest: ok`

- [ ] **Step 5: Add the CLI report**

Insert immediately before the `if (process.argv.indexOf("--selftest")` block:

```js
if (process.argv.indexOf("--selftest") === -1) {
  let buf = "";
  process.stdin.on("data", (d) => { buf += d; });
  process.stdin.on("end", () => {
    /* A turn longer than ten minutes is a device that slept mid-turn, not a
     * slow turn. Dropped rather than winsorised so the count is honest about
     * what it dropped. */
    const all = parseTurns(buf);
    const turns = all.filter(t => t.end > t.start && t.end - t.start < 600000);
    if (!turns.length) return console.log("no turns found on stdin");
    const dur = turns.map(t => t.end - t.start).sort((a, b) => a - b);
    const q = (p) => dur[Math.min(dur.length - 1, Math.floor(dur.length * p))];
    const s = (ms) => (ms / 1000).toFixed(1) + "s";
    const sum = (f) => turns.reduce((a, t) => a + f(t), 0);
    console.log(turns.length + " turns (" + (all.length - turns.length) + " dropped as > 10 min)");
    console.log("  wall      median " + s(q(.5)) + "   p75 " + s(q(.75)) +
                "   p90 " + s(q(.9)) + "   max " + s(dur[dur.length - 1]));
    console.log("  gate      " + s(sum(t => t.gateMs) / turns.length) + " a turn, " +
                (100 * sum(t => t.gateMs) / sum(t => t.end - t.start)).toFixed(0) + "% of wall");
    console.log("  attempts  mean " + (sum(t => t.attempts) / turns.length).toFixed(2) +
                "   >1 on " + (100 * turns.filter(t => t.attempts > 1).length / turns.length).toFixed(0) + "%");
    console.log("  retries   gate-fail " + sum(t => t.gateFail) +
                "   require " + sum(t => t.require) + "   echo " + sum(t => t.echo));
    const names = [...new Set(turns.flatMap(t => Object.keys(t.phases)))];
    if (names.length) {
      console.log("  phases (mean a turn):");
      for (const n of names)
        console.log("    " + n.padEnd(10) + s(sum(t => t.phases[n] || 0) / turns.length));
    }
  });
}
```

- [ ] **Step 6: Record the baseline**

Run: `node tools/pull-debug.js --hours 720 | node tools/turn-latency.js`
Expected: roughly 93 turns, median ~32s, gate ~61% of wall, mean attempts ~2.81. Paste the output into the commit message — it is the number every later stage is compared against.

- [ ] **Step 7: Wire it into the suite**

`test/run.sh` runs under `set -e`, so a failing command aborts the run on its
own — there is no `fail=1` accumulator to join. Insert this immediately before
the `=== test/browser.test.js ===` block, so it runs with the fast suites and
not after the slow one:

```sh
printf '\n=== tools/turn-latency.js --selftest ===\n'
node tools/turn-latency.js --selftest
```

- [ ] **Step 8: Run the full suite**

Run: `sh test/run.sh`
Expected: `Fail: 0` everywhere, plus `turn-latency selftest: ok`.

- [ ] **Step 9: Commit**

```bash
git add tools/turn-latency.js test/run.sh
git commit -m "tools: reconstruct partner-turn latency from the diagnostic log"
```

No `VERSION`/`CACHE` bump — no app file changed.

---

### Task 2: Per-phase timings

The gate is the only phase with timings today and the sense check has none, so "the gate is 61%" is measured while "sense is cheap" is a guess. Close that before optimising anything.

**Files:**
- Modify: `index.html` — add `timed()` near `callModel` (~line 2038); wrap the plan call (~2340), the generation call, `checkSenseViolations` (~2408) and `gateFault` (~2435)
- Modify: `index.html` `VERSION`, `sw.js` `CACHE`

**Interfaces:**
- Produces: `timed(name, fn)` → `Promise<whatever fn resolves to>`, logging `[phase] <name> <ms>ms`. Task 1's parser already reads that line.

- [ ] **Step 1: Add the helper**

Insert above `async function callModel(` in `index.html`:

```js
/* How long one phase of a turn took, in the log the phone can send back.
 *
 * The gate has had timings since v110 and nothing else ever has, so the only
 * phase anybody could point at was the one already known to be slow --
 * checkSenseViolations() is a serial loop of model calls and has never been
 * timed at all. Every optimisation in this plan is chosen from these numbers,
 * so they go in before any of them.
 *
 * finally, not after the await: a phase that throws still took time, and the
 * vocabulary repair path throws routinely. */
async function timed(name, fn) {
  const t0 = Date.now();
  try { return await fn(); }
  finally { console.log("[phase] " + name + " " + (Date.now() - t0) + "ms"); }
}
```

- [ ] **Step 2: Wrap the four phases**

In `planReply`'s caller (~line 2340), change:

```js
    const plan = await planReply(S.history.slice(-4), S.lex, required);
```
to:
```js
    const plan = await timed("plan", () => planReply(S.history.slice(-4), S.lex, required));
```

In `turn()`, wrap the generation call in `timed("generate", ...)`, the sense call:

```js
    const senseViols = hardViolations.length ? []
      : await timed("sense", () => checkSenseViolations(ex.text, lex, S.level));
```

and the gate call:

```js
        const fault = await timed("gate", () => gateFault(ex.text, lex));
```

(Read each site before editing — the surrounding lines carry comments that must not be disturbed.)

- [ ] **Step 3: Bump the version**

`index.html`: `const VERSION   = "v136 — 2026-09-23";`
`sw.js`: `const CACHE = "hsk-chat-v136";`

- [ ] **Step 4: Run the suite**

Run: `sh test/run.sh`
Expected: `Fail: 0`. `release.test.js` is what catches a version bumped in one file and not the other.

- [ ] **Step 5: Commit**

```bash
git add index.html sw.js
git commit -m "feat: time every phase of a partner turn, not only the gate (v136)"
```

- [ ] **Step 6: Collect a day of real turns, then read them**

Use the app normally for a day. Then:

Run: `node tools/pull-debug.js --hours 24 | node tools/turn-latency.js`
Expected: a `phases (mean a turn)` block. **Do not start Task 3 until this exists** — if sense turns out to be 20% of wall, Task 6 moves ahead of Task 4.

---

### Task 3: Choose a fast second gate arm

No app change. Pure measurement, using harnesses that already exist. The candidate must be a **cheap non-reasoning model** and a **different model** from the teaching model — a union needs two graders that disagree productively, and two prompts on one model do not.

**Files:**
- Create: none. Reads/writes `tools/partner-corpus-graded-softBar-<model>-real-qwen.json`.

- [ ] **Step 1: Probe latency before quality**

For each candidate model, run the shipped `softBar` prompt 20 times and record
median, max and empty count. A model that fails this needs no quality run.
Throwaway — write it to `/tmp/arm-probe.js`, not into the repo:

```js
const fs=require("fs"),path=require("path"),os=require("os");
const P=require("/home/tscoffe/Documents/Hsk_chat/prompt.js");
const MODEL=process.argv[2];
const KEY=fs.readFileSync(path.join(os.homedir(),"Documents","openrouter_key.txt"),"utf8").trim();
const ex=JSON.parse(fs.readFileSync(path.join(os.homedir(),"Documents","chat-export.json"),"utf8")).items;
const texts=ex.filter(i=>i.role==="assistant"&&i.activity==="focused"&&i.text.length>20).slice(-20).map(i=>i.text);
(async()=>{
  const rs=[]; let spend=0;
  for(const t of texts){
    const t0=Date.now();
    try{
      const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",
        headers:{Authorization:"Bearer "+KEY,"Content-Type":"application/json"},
        body:JSON.stringify({model:MODEL,messages:[{role:"user",
          content:P.grade({text:t,partner:true,bar:"soft"})}],
          max_tokens:4000,temperature:0.7,usage:{include:true}})});
      const b=await r.json().catch(()=>({}));
      spend+=(b.usage&&b.usage.cost)||0;
      const c=b.choices&&b.choices[0];
      rs.push({ms:Date.now()-t0,len:((c&&c.message&&c.message.content)||"").trim().length,
               err:(b.error&&b.error.message)||""});
    }catch(e){ rs.push({ms:Date.now()-t0,len:0,err:String(e.message)}); }
  }
  const ms=rs.map(r=>r.ms).sort((a,b)=>a-b);
  console.log(MODEL," median "+ms[Math.floor(ms.length/2)]+"ms",
    " max "+ms[ms.length-1]+"ms", " empty "+rs.filter(r=>!r.len).length+"/"+rs.length,
    " $"+spend.toFixed(4), rs.find(r=>r.err)?" err:"+rs.find(r=>r.err).err.slice(0,60):"");
})();
```

Run: `node /tmp/arm-probe.js <model-id>`

Acceptance: **median under 3s, zero empty completions in 20 calls.** Print the
raw `empty` count and do not infer it from latency — an empty completion and a
fast answer look identical in a timing column.

- [ ] **Step 2: Grade the survivors on the real corpus**

```bash
node tools/partner-corpus.js --grade --arm softBar --model <candidate> \
  --corpus ../../real-qwen.json --labels ../../real-qwen-labels.json
```

Run from `tools/`. It writes `partner-corpus-graded-softBar-<slug>-real-qwen.json`.

**Do not let it overwrite a stored baseline.** The output name is derived from arm + model slug + corpus tag; if a file of that name already exists, copy it aside first. This was done by accident once already this month.

- [ ] **Step 3: Score the pairs, free**

```bash
node tools/partner-pairs.js
```

Acceptance: `nativeFrame OR softBar-<candidate>` within a stated tolerance of the shipped pair — **100% strict, 73% loose, 80% specificity**. Write the tolerance down before looking at the numbers.

Note the comparison that matters and that nothing has yet made: the shipped arm scores as measured on the 34% of calls it answers and scores nothing on the rest. An arm slightly worse on paper that always answers may beat it.

- [ ] **Step 4: Record the result either way**

Append the numbers to `BACKLOG.md`, "The gate's second arm is down a third of the time". A candidate that lost is worth as much as one that won — five prompt fixes in this study have moved the number the wrong way, and the record of which is why nobody re-runs them.

```bash
git add BACKLOG.md tools/partner-corpus-graded-*.json
git commit -m "research: score <candidate> as the gate's second arm"
```

---

### Task 4: Ship the fast arm

**Files:**
- Modify: `index.html` — `GATE_MODEL` (~line 1133), `GATE_TIMEOUT_MS` (~1147), the `gateOn` Settings note (~line 678)
- Modify: `index.html` `VERSION`, `sw.js` `CACHE`

- [ ] **Step 1: Swap the model and the timeout**

```js
const GATE_MODEL = "<the winner from Task 3>";
```

Rewrite the comment above it: it currently explains that the arm is a reasoning model costing 7–18s, which is exactly what is being removed. Say what the arm is now and cite Task 3's numbers.

Then lower the timeout:

```js
/* Twice the slowest answer measured on the shipped arm, as before -- but the
 * arm is no longer a reasoning model, so that is single digits rather than 25s.
 * The old value sat in the MIDDLE of the old arm's latency distribution, which
 * is why it lost a third of its races. RESEARCH.md, "What the gate actually
 * does in production". */
const GATE_TIMEOUT_MS = <2x the measured max, rounded up>;
```

- [ ] **Step 2: Correct the Settings copy**

The `gateOn` note promises "a reply can take **ten seconds longer**, and one of them thinks before it answers". Both stop being true. Rewrite those two clauses to match the new arm. Leave the rest of the note alone.

- [ ] **Step 3: Bump, test, commit**

`VERSION` → `v137 — 2026-09-23`, `CACHE` → `hsk-chat-v137`.

Run: `sh test/run.sh` → `Fail: 0`

```bash
git add index.html sw.js
git commit -m "perf: a gate arm that answers in seconds, not a coin flip (v137)"
```

- [ ] **Step 4: Measure after a day of use**

Run: `node tools/pull-debug.js --hours 24 | node tools/turn-latency.js`
Expected: gate share well below 61%, gate-fail retries near zero, median in the mid-teens. **Record it. If the gate share did not move, stop and find out why before Task 5.**

---

### Task 5: Run the two gate arms in parallel

`gateFault()` asks the fast arm and only reaches the second if the first passed. Once both are fast that serialisation is pure latency.

**Files:**
- Modify: `index.html` — `gateFault()` (~line 1922)
- Test: `test/browser.test.js`
- Modify: `index.html` `VERSION`, `sw.js` `CACHE`

**Interfaces:**
- Produces: `gateFault(text, lex)` — unchanged signature and unchanged return shape `{better, note, blocked} | null`. Only the order of the two calls changes.

- [ ] **Step 1: Rewrite the loop as a union**

Replace the `for (const [model, opts] of ...)` loop body with two concurrent calls, keeping every existing behaviour: unparseable is not a fault, a failed call passes the turn, the blocking word is resolved through the same validator, and the same `[gate]` lines are logged so `tools/turn-latency.js` keeps working.

```js
  const arms = [[null, { partner: true }],
                [GATE_MODEL, { partner: true, bar: "soft" }]];
  /* Both arms at once. They used to run in sequence with the second skipped
   * when the first objected, which saved a call on the ~21% of turns that
   * fault and cost the serialisation on the other 79%. With a fast second arm
   * that trade inverts. Promise.all, not race: this is a UNION, so a verdict
   * is only known once both have spoken -- or failed, which passes. */
  const verdicts = await Promise.all(arms.map(async ([model, opts]) => {
    const began = Date.now();
    try {
      const raw = await withTimeout(callModel(
        [{ role: "user", content: HSKPrompt.grade(Object.assign({ text: text }, opts)) }],
        GATE_MAX_TOKENS, model), GATE_TIMEOUT_MS, (model || "teach") + " grader");
      console.log("[gate] " + (model || "teach") + " answered in " + (Date.now() - began) + "ms");
      return parseGrade(raw, text);
    } catch (e) {
      console.warn("[gate] " + (model || "teach") + " failed after " +
                   (Date.now() - began) + "ms, passing the turn:", e);
      return null;                       // fails open, exactly as before
    }
  }));
```

Then fold in arm order, so the first arm's correction still wins when both
object, and keep the `blocked` resolution and the `[gate] ... faulted:` line
exactly as they are today:

```js
  for (let i = 0; i < verdicts.length; i++) {
    const g = verdicts[i], model = arms[i][0];
    /* Unparseable is not a fault. parseGrade() already returns null for a reply
     * it cannot read, and treating that as an objection would fail turns for
     * the model's punctuation rather than the partner's Chinese. A null from a
     * FAILED call lands here too, and means the same thing: no objection. */
    if (!g || g.ok) continue;
    const notes = (g.errors || []).map(e => e.note).filter(Boolean).join(" ");
    const blocked = lex
      ? ((HSK.validate(g.better || "", lex).filter(v => v.kind === "bad" && !v.name)[0] || {}).text || "")
      : "";
    console.log("[gate] " + (model || "teach") + " faulted:", text, g.better, notes,
                blocked ? "(fix needs out-of-level 「" + blocked + "」)" : "");
    return { better: g.better || "", note: notes, blocked: blocked };
  }
  return null;
```

- [ ] **Step 2: Add a browser check that both arms still run**

`browser.test.js` has no key and no network, so assert the shape rather than the calls: seed a stubbed `window.callModel` that records the prompts it is asked for, invoke `window.gateFault("...", lex)`, and check that **two** prompts were requested and that one contains the soft-bar wording. Follow the stubbing idiom already used around line 456 (`// Set at call time, not at boot -- see the seed above. callModel reads the...`).

- [ ] **Step 3: Verify the prompts did not drift**

Run: `node test/prompt.test.js`
Expected: PASS — it asserts both gate prompts character-for-character against what `tools/grader-bench.js` benchmarked. If this fails, the union was rewritten by paraphrasing a prompt; revert and redo.

- [ ] **Step 4: Bump, test, commit**

`VERSION` → `v138 — 2026-09-23`, `CACHE` → `hsk-chat-v138`.

Run: `sh test/run.sh` → `Fail: 0`

```bash
git add index.html sw.js test/browser.test.js
git commit -m "perf: ask both gate arms at once (v138)"
```

---

### Task 6: Parallel sense checks

Only if Task 2's phase numbers say sense is worth more than a second a turn. **If they do not, skip this task and write one line in the plan saying so** — a measured skip is a result.

**Files:**
- Modify: `index.html` — `checkSenseViolations()` (~line 1806)
- Modify: `index.html` `VERSION`, `sw.js` `CACHE`

- [ ] **Step 1: Replace the serial loop**

```js
  /* One call per ambiguous word, all at once. It was a serial for-loop, so a
   * reply with three registered ambiguous words paid three round trips in a
   * row. Each still fails open on its own: a classify call that cannot be
   * reached must not turn an unrelated reply into a rejection. */
  const found = await Promise.all(words.map(async (w) => {
    const count = HSKSenses.standaloneHits(tokens, w).length;
    try {
      const raw = await callModel([{ role: "user",
        content: HSKSenses.classifyPrompt(w, text, count) }], 60);
      const classified = HSKSenses.parseClassification(raw, count);
      return classified ? HSKSenses.checkSenses(w, classified, level) : [];
    } catch (e) {
      console.warn("sense classify failed, allowing through:", w, e);
      return [];
    }
  }));
  return [].concat.apply([], found);
```

- [ ] **Step 2: Run the sense suite**

Run: `node test/senses.test.js`
Expected: PASS. The module is untouched; this is a guard against having edited it by accident.

- [ ] **Step 3: Bump, test, commit**

`VERSION` → `v139 — 2026-09-23`, `CACHE` → `hsk-chat-v139`.

Run: `sh test/run.sh` → `Fail: 0`

```bash
git add index.html sw.js
git commit -m "perf: classify ambiguous senses concurrently (v139)"
```

---

### Task 7: Speculative candidates

The structural change. Generate K replies at once, check them locally, gate the survivors in parallel, ship the first that passes in draw order.

**Files:**
- Modify: `index.html` — `K` constant and `S.draws` near `attempts` (~line 1364), `K` key in `K` map (~line 1310), `turn()`'s attempt loop, the Settings `<select>` beside `attempts` (~line 591), the persist list (~line 3743)
- Test: `test/browser.test.js`
- Modify: `index.html` `VERSION`, `sw.js` `CACHE`

**Interfaces:**
- Consumes: `gateFault(text, lex)` from Task 5, `checkSenseViolations(text, lex, level)` from Task 6.
- Produces: no new exported surface. `turn()` keeps its signature and its return shape.

- [ ] **Step 1: Add the setting**

In `K`: `draws:"hsk1chat.draws",`
In `S`: `draws: store.get(K.draws, 3),      // replies generated at once, first clean one wins`
In the persist block beside `store.set(K.plan, S.plan);`: `store.set(K.draws, S.draws);`

Settings markup, directly after the `attempts` select:

```html
    <label for="draws">Replies written at once</label>
      <select id="draws"></select>
      <div class="note">The partner writes this many replies in parallel and shows you the
      first one that passes every check. More is faster, not better: the checks are
      unchanged and nothing skips them. Measured before this existed, a reply took a median
      of 32 seconds because it was written, checked, rejected and rewritten one at a time —
      2.8 times on average. Costs one generation each; the checking is only spent on the
      ones that survive the free word-list check.</div>
```

Populate it the way `attempts` is populated (find `#attempts` in the render code and copy the idiom) with choices `[1, 2, 3, 4, 5]`.

- [ ] **Step 2: Draw K candidates instead of one**

Inside the attempt loop, replace the single generation with K concurrent ones, then filter locally before spending anything:

```js
    /* K replies at once, and the checks pick. The loop below is unchanged for
     * K = 1, which is how this ships safe: the old path is a special case.
     *
     * Vocabulary is local and free, so it runs on all K and usually leaves
     * one or two. The sense check and the gate are spent only on survivors,
     * in draw order, exactly as they were spent on the single reply before.
     *
     * Measured before this existed: 35% of attempts passed everything, so
     * three draws clear about 73% of turns in one round and the mean attempt
     * count falls 2.81 -> ~1.4. RESEARCH.md and the plan this came from. */
    const draws = await Promise.all(
      Array.from({ length: Math.max(1, S.draws) }, () => generateOnce(scratch, lex)));
```

**`generateOnce` does not exist yet — create it first, in the same commit, by
lifting the existing generation body out of the loop without changing a line of
it.** Its shape:

```js
/* One drawn reply: the model call, its empty-completion retry, and the
 * scaffold strip. Lifted verbatim out of turn()'s loop so K draws and the old
 * single draw run identical code -- if this and the loop ever disagree, the
 * K = 1 path stops being the safe special case it is relied on to be.
 *
 * Returns the same { text, needs, raw, genFinish } the loop body built. */
async function generateOnce(scratch, lex) { /* ...the existing body, unmoved... */ }
```

Its return value must carry everything the loop already reads off a generation:
`ex.text`, `ex.needs`, `raw`, and `genFinish` for the truncation flag. Check
each of those at the call site before deleting the inline version — a field
dropped here surfaces as `truncated` silently going false, which is exactly the
class of bug this codebase has been bitten by before.

- [ ] **Step 3: Keep the fallback path identical**

If no draw survives, fall through to the existing repair logic using the **first** draw's violations, so `repairPrompt`, the strategy ladder, `missed`, `echoed` and the stub all behave as they do today. A turn that cannot be repaired still becomes 我不会说.

- [ ] **Step 4: Assert K = 1 is the old behaviour**

In `browser.test.js`, set `localStorage["hsk1chat.draws"] = "1"`, and with a stubbed `callModel` counting calls, check exactly one generation is requested per attempt. Then set it to `3` and check three are. This is the guard that the safe special case stayed safe.

- [ ] **Step 5: Bump, test, commit**

`VERSION` → `v140 — 2026-09-23`, `CACHE` → `hsk-chat-v140`.

Run: `sh test/run.sh` → `Fail: 0`

```bash
git add index.html sw.js test/browser.test.js
git commit -m "perf: write three replies at once and show the first clean one (v140)"
```

- [ ] **Step 6: Measure against the target**

Run: `node tools/pull-debug.js --hours 24 | node tools/turn-latency.js`

Acceptance: **median under 10s, p90 under 20s**, mean attempts near 1.4, and the gate fault rate on shipped replies no higher than the baseline's. Also check spend in Settings: the estimate is ~3x generation, and estimates have been wrong here before.

---

### Task 8: Write the result down

**Files:**
- Modify: `RESEARCH.md`, `CLAUDE.md`, `DEVELOPING.md`, `BACKLOG.md`

- [ ] **Step 1: Record what the numbers did**

`RESEARCH.md` gains a section with the before/after table from `tools/turn-latency.js` and, if any stage disappointed, which and by how much. `DEVELOPING.md`'s "What a partner turn goes through" diagram needs the K-draws fan-out and the parallel gate. `CLAUDE.md`'s gate paragraph needs its "the pair is not what runs" correction updated or removed depending on Task 3's outcome. Close the `BACKLOG.md` entry if Task 4 shipped.

- [ ] **Step 2: Commit**

```bash
git add RESEARCH.md CLAUDE.md DEVELOPING.md BACKLOG.md
git commit -m "docs: what the latency work actually bought"
```

---

## Notes for whoever picks this up

**Measure before and after every stage, with `tools/turn-latency.js` and nothing else.** In the session that produced this plan, three confident diagnoses were overturned by measurement — twice after code had been written against them. The most instructive: a change that cut the required-word retry from 45% to 6% was rejected because the same run showed wedged turns already graded clean 86% of the time against 83% for un-wedged ones. The mechanism being "fixed" was not costing anything.

**Moving the required-word check above the gate is deliberately not in this plan.** It looks like an easy win and it is a wash: measured over 110 turns, 20 would save a gate round and 21 would pay an extra generation. The design doc has the table.

**`reasoning: {effort: "low"}` on the current gate model is deliberately not in this plan.** It is fast and it is a different grader: union specificity falls 80% → 62%.

**Print the raw thing and count what did not come back.** Five silent failures in this study produced plausible wrong numbers — 没有错误 parsed as a sentence, `content` empty while `reasoning` filled the budget, a swallowed exception that made a dead grader look clean, `[[NEED:]]` counted from text the app had already stripped, and a gate arm timing out a third of the time while every benchmark said it was fine.
