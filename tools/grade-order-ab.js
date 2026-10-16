/* Does the grader pick a tag before it has a reason for one?
 *
 * The grade() schema is {"tag":"","note":""}. A model emits those fields in
 * order, so the label is committed before the sentence justifying it exists --
 * and across 299 real production verdicts, 8 of 44 marker-tag firings named a
 * character (了, 过, 的, 把) that appears in NEITHER the learner's sentence nor
 * the grader's own correction. Five were 了. In every one the grader had found a
 * real fault, fixed it correctly, and then written a note rationalising a tag it
 * had already emitted.
 *
 * Arm B flips the pair to {"note":"","tag":""} and changes nothing else, so the
 * model must describe the fault before labelling it.
 *
 * WHAT IS SCORED. Two things, and the second is the one that can veto:
 *
 *   ghost rate    mechanical, no labels needed. A marker tag whose character is
 *                 in neither the sentence nor the correction is self-
 *                 contradictory whatever a human thinks of the sentence. This is
 *                 the defect being fixed, so it is the primary number.
 *   wrong/right   the 208 blind labels from tools/grade-audit.js. Recall and
 *                 specificity on `ok`. B must not buy a lower ghost rate with a
 *                 worse verdict -- CLAUDE.md records four prompt fixes in this
 *                 study that moved the number the wrong way.
 *
 * Both arms are re-graded in the same run. The stored production verdicts are
 * NOT the control: they were made by a different fleet on a different day, and
 * qwen at temperature 0.7 disagrees with itself. Arm A is what isolates the
 * variable; the stored verdicts only say whether the re-grade reproduces
 * production at all.
 *
 *   node tools/grade-order-ab.js [--n 208] [--model <id>] [--concurrency 6]
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const HSKPrompt = require("../prompt.js");

const D = f => path.join(os.homedir(), "Documents", f);
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY = fs.readFileSync(
  process.env.OPENROUTER_KEY_FILE || D("openrouter_key.txt"), "utf8").trim();

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");     // TEACH_MODEL
const CONCURRENCY = Number(arg("concurrency", 6));
const LIMIT = Number(arg("n", 208));
/* Repeats, because the effect lives in a thin slice. Marker tags fire on ~0.15
 * of sentences in production, so one pass over 208 gives ~31 firings an arm and
 * ~6 ghosts -- too few to tell a halving from the dice. Three passes put ~93
 * firings an arm, which separates 18% from 5% at p < 0.01. Repeats also average
 * out temperature 0.7, which RESEARCH.md records as enough on its own to change
 * which sentences get flagged. */
const REPEAT = Number(arg("repeat", 3));
const WITH_CONTEXT = !args.includes("--no-context");
const OUT = D("grade-order-ab.json");

const LEVELS = { 1: "HSK 1", 2: "HSK 2", 3: "HSK 3", 4: "HSK 4",
                 5: "HSK 5", 6: "HSK 6", 7: "HSK 7" };

/* Arm B by substitution on the shipped string, which is how grader-bench.js
 * builds its arms too: the prompt under test stays the prompt that ships until
 * a number says otherwise. Asserted rather than replaced blind -- a silent
 * no-op substitution would score arm B as a tie and look like a real result. */
const SHIPPED_PAIR = '{"tag":"","note":""}';
const NOTE_FIRST   = '{"note":"","tag":""}';

function promptFor(arm, text, level, context) {
  const base = HSKPrompt.grade({ text: text, label: LEVELS[level] || "HSK 2",
                                 context: context || [] });
  if (arm === "shipped") return base;
  if (base.indexOf(SHIPPED_PAIR) === -1) {
    throw new Error("grade() no longer contains " + SHIPPED_PAIR + " -- arm B is a no-op");
  }
  return base.replace(SHIPPED_PAIR, NOTE_FIRST);
}

let spend = 0;
async function callModel(content) {
  for (let tryN = 0; tryN < 3; tryN++) {
    try {
      const r = await fetch(API_URL, {
        method: "POST",
        headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, messages: [{ role: "user", content: content }],
          max_tokens: 700, temperature: 0.7, usage: { include: true }
        })
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((body.error && body.error.message) || ("HTTP " + r.status));
      spend += (body.usage && body.usage.cost) || 0;
      const txt = ((body.choices || [])[0] || {}).message;
      /* Printed, not swallowed. RESEARCH.md records three wrong numbers in this
       * study that came from a call failing quietly. */
      if (!txt || !txt.content) throw new Error("empty content");
      return txt.content.trim();
    } catch (e) {
      if (tryN === 2) return { error: String(e.message || e) };
      await new Promise(r => setTimeout(r, 800 * (tryN + 1)));
    }
  }
}

const jsonIn = raw => {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
};

/* index.html's parseGrade, minus the marker filter -- measuring the filter's
 * input is the whole point, so applying it here would hide the effect. */
function parse(raw, text) {
  const g = jsonIn(raw);
  if (!g) return null;
  const noEdit = String(g.better || "").trim() === String(text).trim();
  const known = new Set(HSKPrompt.ERROR_TAGS);
  const errors = noEdit ? [] : (Array.isArray(g.errors) ? g.errors : [])
    .filter(e => e && known.has(e.tag))
    .map(e => ({ tag: e.tag, note: String(e.note || "") }));
  const cats = {};
  HSKPrompt.GRADE_CATS.forEach(c => { cats[c.key] = noEdit || (g.cats || {})[c.key] !== false; });
  const ok = noEdit || (g.ok !== false && !errors.length &&
                        HSKPrompt.GRADE_CATS.every(c => cats[c.key]));
  return { ok: ok, better: noEdit ? "" : String(g.better || ""), errors: errors };
}

async function pool(items, worker) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i]);
      if (++done % 25 === 0) process.stderr.write("  " + done + "/" + items.length + "\n");
    }
  }));
  return out;
}

/* index.html's contextFor(): the previous EXPLAIN_CONTEXT real turns, in order.
 * Production grades with this and the first run of this tool did not, which cost
 * the control arm 25 points of specificity against the stored verdicts (61% vs
 * 86%) -- the benchmark was not the shipped prompt. Rebuilt here by position in
 * the export and keyed on text, which is what the blind file carries. A text
 * appearing twice gets the FIRST occurrence's context; there is no id to join
 * on, and the alternative is dropping the row. */
const EXPLAIN_CONTEXT = 4;
function buildContext() {
  const items = JSON.parse(fs.readFileSync(D("chat-export.json"), "utf8")).items;
  const real = items.filter(t => t.role === "user" || t.role === "assistant");
  const map = new Map();
  real.forEach((t, i) => {
    if (!t.grade || map.has(t.text)) return;
    map.set(t.text, real.slice(Math.max(0, i - EXPLAIN_CONTEXT), i)
                         .map(x => ({ role: x.role, text: x.text })));
  });
  return map;
}
const CTX = WITH_CONTEXT ? buildContext() : new Map();

(async () => {
  const blind = JSON.parse(fs.readFileSync(D("grade-audit-blind.json"), "utf8")).items;
  const labels = JSON.parse(fs.readFileSync(D("grade-audit-labels.json"), "utf8"));
  const wrong = new Set(labels.wrong);
  const seen = new Set(labels.seen);
  const items = blind.filter(i => seen.has(i.id)).slice(0, LIMIT);
  console.log(items.length + " labelled sentences x " + REPEAT + " passes x 2 arms on " + MODEL +
    (WITH_CONTEXT ? "\n  WITH conversation context, as production grades"
                  : "\n  NO context") +
    ", context found for " + items.filter(i => CTX.has(i.text)).length + "\n");

  const results = {};
  for (const arm of ["shipped", "noteFirst"]) {
    process.stderr.write(arm + ":\n");
    const jobs = [];
    for (let r = 0; r < REPEAT; r++) for (const it of items) jobs.push(it);
    const raw = await pool(jobs, it => callModel(
      promptFor(arm, it.text, it.level || 2, CTX.get(it.text) || [])));
    results[arm] = jobs.map((it, n) => ({
      id: it.id, text: it.text, raw: raw[n],
      grade: (raw[n] && raw[n].error) ? null : parse(raw[n], it.text)
    }));
  }
  fs.writeFileSync(OUT, JSON.stringify({ model: MODEL, results: results }, null, 1));

  const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "n/a";
  const rows = [];
  for (const arm of ["shipped", "noteFirst"]) {
    const rs = results[arm];
    let dead = 0, fires = 0, ghosts = 0, hitW = 0, nW = 0, hitR = 0, nR = 0;
    const ghostTags = {};
    for (const r of rs) {
      if (!r.grade) { dead++; continue; }
      for (const e of r.grade.errors) {
        if (!HSKPrompt.TAG_MARK[e.tag]) continue;
        fires++;
        if (HSKPrompt.markerMissing(e.tag, r.text, r.grade.better)) {
          ghosts++; ghostTags[e.tag] = (ghostTags[e.tag] || 0) + 1;
        }
      }
      const truth = wrong.has(r.id) ? "wrong" : "right";
      if (truth === "wrong") { nW++; if (!r.grade.ok) hitW++; }
      else { nR++; if (r.grade.ok) hitR++; }
    }
    rows.push({ arm, dead, fires, ghosts, ghostTags,
                recall: [hitW, nW], spec: [hitR, nR] });
  }

  console.log("arm         no JSON   marker tags   GHOST      recall        specificity");
  for (const r of rows) {
    console.log(r.arm.padEnd(12) + String(r.dead).padStart(5) +
      String(r.fires).padStart(12) + "   " +
      (r.ghosts + " (" + pct(r.ghosts, r.fires) + ")").padEnd(11) +
      (r.recall[0] + "/" + r.recall[1] + " " + pct(r.recall[0], r.recall[1])).padEnd(14) +
      r.spec[0] + "/" + r.spec[1] + " " + pct(r.spec[0], r.spec[1]));
  }
  console.log("\nghost tags by arm:");
  rows.forEach(r => console.log("  " + r.arm.padEnd(12) + JSON.stringify(r.ghostTags)));
  console.log("\nproduction baseline, same check on the STORED verdicts: 8/44 (18%)");
  console.log("$" + spend.toFixed(4) + " -> " + OUT);
})();
