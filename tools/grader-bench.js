/* Is the grader any good? A benchmark with human ground truth on both sides.
 *
 * Every verdict this app gives a learner comes from one model call and has never
 * been scored against anything. Measured in passing while testing something
 * else, it returned "Natural." three times out of three for 我的手表被我放在桌
 * 子上了 -- a reflexive 被 that no native speaker writes -- and waved through
 * 我要一个咖啡, 我不能说中文 and 昨天的天气非常地好. That is the grader driving
 * the tick or cross on every message, the mistake ledger, and which drill comes
 * next. It needs a number before it can be improved.
 *
 * GROUND TRUTH
 *
 * MuCGEC (Apache-2.0, Zhang et al., NAACL 2022) -- 7,063 sentences written by
 * learners of Chinese, each corrected by three annotators and reviewed by a
 * senior one. https://github.com/HillZhang1999/MuCGEC
 *
 * The dev set is 100% erroneous: 0 of its 1,137 sentences are left unedited by
 * every annotator. A benchmark of only-wrong sentences is worthless here,
 * because a grader that fails everything scores 100% on it -- and over-harshness
 * is a live failure mode, not a hypothetical. The app's own grader prompt has to
 * warn it "do not manufacture a problem to have something to teach".
 *
 * So the pairing: the SOURCE is a wrong sentence and its REFERENCES are the same
 * sentence written correctly by a human. One corpus, both directions, no model
 * anywhere in the labelling. An item is `wrong` or `right` and the grader is
 * scored on getting both kinds right.
 *
 * FIT, AND ITS LIMITS
 *
 * These are essay sentences from advanced learners: median 36 characters, and
 * only 1.1% of them stay inside HSK 2 vocabulary. Filtering to pairs where BOTH
 * halves validate at HSK 4 or below brings the median to 19 characters and 140
 * pairs, which is a far closer match to a chat message -- but it is still not
 * the same distribution as an HSK 2 learner writing 我昨天去公园了, and it is not
 * the partner's fluent-but-odd Chinese either. What this measures is the
 * grader's judgement of learner Chinese at a register near the app's, which is
 * the closest thing to ground truth available without hand-labelling.
 *
 *   node tools/grader-bench.js --build          # fetch and filter the corpus
 *   node tools/grader-bench.js [--n 80] [--model <id>] [--arm shipped|checklist|correctionFirst]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const HSK = require("../validator.js");
const HSKPrompt = require("../prompt.js");

const ROOT = path.join(__dirname, "..");
const BENCH = path.join(__dirname, "grader-bench.json");
const DEV_URL = "https://raw.githubusercontent.com/HillZhang1999/MuCGEC/main/data/MuCGEC/MuCGEC_dev.txt";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_FILE = process.env.OPENROUTER_KEY_FILE ||
  path.join(os.homedir(), "Documents", "openrouter_key.txt");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");   // TEACH_MODEL
const CONCURRENCY = Number(arg("concurrency", 6));
const MAX_LEVEL = Number(arg("level", 4));
const ARM = arg("arm", "shipped");

const lex = {};
for (const n of [2, 3, 4, 5, 6, 7]) {
  lex[n] = HSK.buildLexicon(
    JSON.parse(fs.readFileSync(path.join(ROOT, "data", "hsk" + n + ".json"), "utf8")));
}
const cleanAt = (t, n) => HSK.validate(t, lex[n]).filter(v => !v.name).length === 0;

/* The lowest level whose list covers the sentence. Each item is graded at its
 * own level, because the grader prompt names the level and a sentence judged
 * against the wrong one is a different prompt being tested. */
function levelOf(text) {
  for (const n of [2, 3, 4, 5, 6, 7]) if (cleanAt(text, n)) return n;
  return 0;
}

async function build() {
  const res = await fetch(DEV_URL);
  if (!res.ok) throw new Error("fetch failed: HTTP " + res.status);
  const rows = (await res.text()).split("\n").filter(Boolean).map(l => {
    const p = l.split("\t");
    return { src: p[1], refs: [...new Set(p.slice(2).filter(Boolean))] };
  });

  const items = [];
  for (const r of rows) {
    if (!r.src || !cleanAt(r.src, MAX_LEVEL)) continue;
    const ref = r.refs.find(x => x !== r.src && cleanAt(x, MAX_LEVEL));
    if (!ref) continue;
    /* Both halves at the SAME level, the higher of the two. Grading the wrong
     * one at HSK 3 and its fix at HSK 4 would confound the verdict with the
     * prompt, and the pair is the whole point. */
    const level = Math.max(levelOf(r.src), levelOf(ref));
    if (!level) continue;
    items.push({ text: r.src, truth: "wrong", level: level, pair: items.length });
    items.push({ text: ref, truth: "right", level: level, pair: items.length - 1 });
  }

  fs.writeFileSync(BENCH, JSON.stringify({
    source: "MuCGEC dev set", url: "https://github.com/HillZhang1999/MuCGEC",
    licence: "Apache-2.0",
    citation: "Zhang et al., MuCGEC: a Multi-Reference Multi-Source Evaluation " +
              "Dataset for Chinese Grammatical Error Correction, NAACL 2022.",
    built: new Date().toISOString(), maxLevel: MAX_LEVEL,
    note: "`wrong` is the learner's sentence; `right` is a human annotator's " +
          "correction of that same sentence. No model was involved in either label.",
    items: items
  }, null, 2));
  console.log("built " + BENCH);
  console.log("  " + items.length + " items (" + items.length / 2 + " pairs), " +
              "both halves inside HSK " + MAX_LEVEL);
  const byLevel = {};
  items.forEach(i => { byLevel[i.level] = (byLevel[i.level] || 0) + 1; });
  console.log("  by level: " + Object.keys(byLevel).sort()
    .map(k => "HSK " + k + "=" + byLevel[k]).join("  "));
}

/* ---------------------------------------------------------------- candidates
 *
 * The shipped prompt asks one open question -- "would you let this sentence
 * stand?" -- and then, separately, for a tag. Decision and categorisation are
 * fused in one call, and the decision half is asked in the general form that
 * measured worst: the same model that returns "Natural." 3/3 for 我的手表被我放
 * 在桌子上了 catches it when the question names what to look for. So the arms
 * below vary the DECISION and leave everything else alone.
 *
 *   shipped          HSKPrompt.grade(), untouched. Must land near 79% again or
 *                    the benchmark is noisier than it looks and nothing here
 *                    means anything.
 *   checklist        The seventeen tags reframed as a pre-decision checklist.
 *                    The app already carries the taxonomy; it just never asks
 *                    the model to walk it before deciding.
 *   correctionFirst  Rewrite first, derive the verdict from whether the rewrite
 *                    changed anything. parseGrade() already treats an identical
 *                    `better` as a pass, so this promotes an existing signal to
 *                    the primary one. It is also how MuCGEC itself is built.
 *
 * The checklist carries NO examples. The shipped prompt's tag examples are
 * measured-necessary for picking the right tag and stay where they are, but
 * DEVELOPING.md's rule holds for the decision half: an example of the bad output
 * is an instruction to produce something adjacent to it.
 */
const CHECKS =
  "Before you answer, walk this list and pass the sentence only if it survives " +
  "every line. Most learner errors are one of these:\n" +
  "- measure words: required where a number modifies a noun, and the right one\n" +
  "- aspect: 了 过 着 在 present where the sentence needs one, absent where it does not\n" +
  "- 的 / 地 / 得 in the right one of their three roles\n" +
  "- word order: where adverbials and attributives sit relative to the verb\n" +
  "- 把: the object moved forward, and a verb carrying a result or direction\n" +
  "- 被: an agent distinct from the subject, and a verb that can passivise at all. " +
  "A speaker who is both the subject's owner and the agent is not a passive, and " +
  "an intransitive verb has no object to promote\n" +
  "- 不 against 没, by tense and by verb\n" +
  "- comparison with 比, which takes no 很\n" +
  "- word choice: a word used in a sense it does not carry, or a character that is " +
  "a homophone of the intended one\n" +
  "- collocation: legal Chinese that no native speaker would actually say\n\n" +
  "A sentence that survives all of them is correct, and saying so is the right " +
  "answer. Do not walk the list looking for something to report.\n\n";

const CORRECTION_FIRST =
  "Work in this order.\n\n" +
  "First, write the sentence as a native speaker would write it, changing as " +
  "little as possible and keeping the student's meaning and their vocabulary " +
  "level. If nothing needs changing, reproduce it character for character -- a " +
  "sentence that is already correct must come back untouched, and rewriting it " +
  "to taste is a wrong answer.\n\n" +
  "Then judge: the sentence was correct if and only if your version is identical " +
  "to it.\n\n";

/* Spliced in immediately before the JSON specification, so the framing changes
 * and the output contract does not. Anchored on the literal line rather than an
 * offset: if that line is reworded, this raises instead of silently appending
 * the candidate text somewhere harmless. */
const JSON_ANCHOR = "Reply with only a JSON object, no prose and no code fence:";

function promptFor(arm, text, label) {
  const base = HSKPrompt.grade({ text: text, label: label });
  if (arm === "shipped") return base;
  const extra = arm === "checklist" ? CHECKS
              : arm === "correctionFirst" ? CORRECTION_FIRST : null;
  if (!extra) throw new Error("unknown arm: " + arm);
  if (base.indexOf(JSON_ANCHOR) === -1) {
    throw new Error("grade() no longer contains the JSON anchor -- this harness has drifted");
  }
  return base.replace(JSON_ANCHOR, extra + JSON_ANCHOR);
}

let spend = 0;
async function callModel(content, maxTokens, KEY) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, messages: [{ role: "user", content: content }],
      max_tokens: maxTokens, temperature: 0.7, usage: { include: true }
    })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body.error && body.error.message) || ("HTTP " + r.status));
  const choice = (body.choices && body.choices[0]) || {};
  const txt = choice.message && choice.message.content;
  spend += (body.usage && body.usage.cost) || 0;
  if (!txt) throw new Error("empty reply");
  return txt.trim();
}

function jsonIn(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// index.html's parseGrade(), reduced to the `ok` it recomputes rather than trusts.
function verdictOk(raw, text) {
  const g = jsonIn(raw);
  if (!g) return null;
  const noEdit = String(g.better || "").trim() === String(text).trim();
  if (noEdit) return true;
  const cats = {};
  HSKPrompt.GRADE_CATS.forEach(c => { cats[c.key] = (g.cats || {})[c.key] !== false; });
  const known = new Set(HSKPrompt.ERROR_TAGS);
  const errors = (Array.isArray(g.errors) ? g.errors : []).filter(e => e && known.has(e.tag));
  return g.ok !== false && !errors.length && HSKPrompt.GRADE_CATS.every(c => cats[c.key]);
}

async function pool(jobs, width) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

async function score() {
  const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
  if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }
  if (!fs.existsSync(BENCH)) { console.error("run --build first"); process.exit(1); }
  const bench = JSON.parse(fs.readFileSync(BENCH, "utf8"));

  /* Sampled in PAIRS, so the two halves stay balanced. Sampling items
   * independently would let a run come out 60/40 and move the headline number
   * without the grader changing at all. */
  const pairs = [];
  for (let i = 0; i < bench.items.length; i += 2) pairs.push([bench.items[i], bench.items[i + 1]]);
  const want = Math.min(Number(arg("n", 80)) / 2, pairs.length);
  const take = pairs.slice(0, want);
  const items = [].concat.apply([], take);

  console.log("model: " + MODEL + "  arm: " + ARM + "  items: " + items.length +
              " (" + take.length + " pairs)  source: " + bench.source + "\n");

  const rows = await pool(items.map(it => async () => {
    try {
      const raw = await callModel(
        promptFor(ARM, it.text, "HSK " + it.level), 600, KEY);
      return Object.assign({}, it, { ok: verdictOk(raw, it.text) });
    } catch (e) { return Object.assign({}, it, { ok: null, error: String(e.message || e) }); }
  }), CONCURRENCY);

  const wrong = rows.filter(r => r.truth === "wrong" && r.ok !== null);
  const right = rows.filter(r => r.truth === "right" && r.ok !== null);
  const caught = wrong.filter(r => r.ok === false).length;   // correctly faulted
  const passed = right.filter(r => r.ok === true).length;    // correctly left alone
  const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "--";

  console.log("                                     n     correct");
  console.log("  wrong sentences it faulted      " + String(wrong.length).padStart(5) +
              "   " + caught + "  " + pct(caught, wrong.length) + "   (recall)");
  console.log("  correct sentences it passed     " + String(right.length).padStart(5) +
              "   " + passed + "  " + pct(passed, right.length) + "   (specificity)");
  console.log("  overall                         " + String(wrong.length + right.length).padStart(5) +
              "   " + (caught + passed) + "  " + pct(caught + passed, wrong.length + right.length));
  const errs = rows.filter(r => r.error).length;
  const unparsed = rows.filter(r => r.ok === null && !r.error).length;
  if (errs || unparsed) console.log("  call errors: " + errs + "   unparseable: " + unparsed);

  /* Both failure directions, named. A grader can reach the same overall score by
   * missing real errors or by inventing them, and they need opposite fixes. */
  console.log("\n--- missed (wrong, called correct) ---");
  wrong.filter(r => r.ok === true).slice(0, 12).forEach(r => console.log("  " + r.text));
  console.log("\n--- false alarms (correct, called wrong) ---");
  right.filter(r => r.ok === false).slice(0, 12).forEach(r => console.log("  " + r.text));

  console.log("\nspend: $" + spend.toFixed(4));
  const out = path.join(__dirname, "grader-bench-results-" + ARM + ".json");
  fs.writeFileSync(out, JSON.stringify({
    model: MODEL, arm: ARM, when: new Date().toISOString(), source: bench.source,
    recall: [caught, wrong.length], specificity: [passed, right.length], rows: rows
  }, null, 2));
  console.log("written: " + path.relative(ROOT, out));
}

(args.indexOf("--build") !== -1 ? build() : score()).catch(e => {
  console.error(String((e && e.message) || e));
  process.exit(1);
});
