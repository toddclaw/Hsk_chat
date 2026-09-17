/* Do the grader and the grammar check agree, and does handing one to the other
 * fix it?
 *
 * Both run on the same student sentence and answer the same question in
 * different shapes: the grader in four booleans and a tag list, driving the tick
 * or cross on the message; the grammar check in prose, opening with one of three
 * verdict lines. Until now each derived its answer independently, and the sheet
 * is opened BY the badge -- so a disagreement is not an abstraction, it is a red
 * cross that opens onto the word "Natural." with nothing to say which to
 * believe. The learner reported it as the confusing part.
 *
 *   independent  the check picks its own verdict          (as shipped)
 *   handed       the check is given the grader's verdict  (the change)
 *
 * The grader runs for real, once per sentence, and both arms are scored against
 * ITS verdict -- so `independent` measures how often the two agreed on their
 * own, and `handed` measures whether the handoff holds. A high `independent`
 * score would mean this change is solving a problem that does not exist.
 *
 * What this cannot measure: whether the explanation is any good. It checks the
 * opening line only. The risk of the change is that an explainer told the
 * answer stops thinking and writes a worse explanation under a correct verdict,
 * and that needs eyes, not counts -- every reply is printed for that reason.
 *
 * Plain node, no dependencies, never part of test/run.sh: it makes network calls
 * and costs money. The key is read out of a file OUTSIDE the repo into a
 * variable, never an argv element, never echoed.
 *
 *   node tools/explain-verdict-ab.js [--runs 3] [--model <id>]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const HSKPrompt = require("../prompt.js");

const ROOT = path.join(__dirname, "..");
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_FILE = process.env.OPENROUTER_KEY_FILE ||
  path.join(os.homedir(), "Documents", "openrouter_key.txt");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const RUNS = Number(arg("runs", 3));          // repeats per sentence, per arm
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");   // TEACH_MODEL
const CONCURRENCY = Number(arg("concurrency", 5));
const LABEL = "HSK 2";

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }

/* Name-free, per CLAUDE.md -- 王 李 明 are all above HSK 1 and contaminate any
 * measurement that touches level. Spread across the three verdicts on purpose:
 * an all-broken fixture would score well on agreement for the wrong reason,
 * since both judges default to finding fault when told a sentence may be wrong.
 * The last one is the sentence that started all of this. */
const SENTENCES = [
  "我昨天去公园了。",
  "我很喜欢吃中国菜。",
  "我们昨天看电影了，很有意思。",
  "我买了三个书。",
  "他比我很高。",
  "我去商店昨天。",
  "他不有钱。",
  "给我水。",
  "我每天走路去上班，因为公司很近。",
  "我的手表被我放在桌子上了。",
  /* Grammatical, or nearly so, and not what a native speaker would choose. Round
   * one carried exactly one of these and it was the ONLY sentence the two judges
   * disagreed on -- 3/3 disagreement on it against 0/27 everywhere else. The
   * explain prompt says so itself: "most sentences a learner worries about are
   * in this middle case rather than outright broken", so a fixture that is
   * mostly clear-cut understates the disagreement rate for the sentences that
   * matter. Which verdict each lands in is the grader's call, not a prediction
   * made here -- both arms are scored against whatever it says. */
  "请你帮助我。",
  "我不能说中文。",
  "我很喜欢学习中文语言。",
  "昨天的天气非常地好。",
  "我要一个咖啡。"
];

let spend = 0;
async function callModel(content, maxTokens) {
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

// index.html's jsonIn(), abbreviated: models fence JSON whatever the prompt says.
function jsonIn(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

/* index.html's parseGrade(), reduced to what verdictFor() reads. `ok` is
 * recomputed rather than trusted there and here for the same reason: a model
 * that lists errors and still says ok:true would show a tick over a red sheet. */
function parseGrade(raw, text) {
  const g = jsonIn(raw);
  if (!g) return null;
  const noEdit = String(g.better || "").trim() === String(text).trim();
  const cats = {};
  HSKPrompt.GRADE_CATS.forEach(c => {
    cats[c.key] = noEdit || (g.cats || {})[c.key] !== false;
  });
  const known = new Set(HSKPrompt.ERROR_TAGS);
  const errors = noEdit ? [] : (Array.isArray(g.errors) ? g.errors : [])
    .filter(e => e && known.has(e.tag))
    .map(e => ({ tag: e.tag, note: String(e.note || "") }));
  const ok = g.ok !== false && !errors.length &&
    HSKPrompt.GRADE_CATS.every(c => cats[c.key]);
  return { ok: noEdit || ok, meant: String(g.meant || ""),
           better: noEdit ? "" : String(g.better || ""), cats: cats, errors: errors };
}

/* Which of the three the explanation actually opened with. Matched on the
 * literal lines the prompt asks for, longest first -- the middle verdict
 * contains no substring of the others, but matching "Not correct." before
 * checking the others guards against a future wording that does. */
function openingVerdict(text) {
  const first = String(text).split("\n").map(s => s.trim()).filter(Boolean)[0] || "";
  const hits = Object.keys(HSKPrompt.VERDICTS)
    .map(k => [k, HSKPrompt.VERDICTS[k]])
    .sort((a, b) => b[1].length - a[1].length)
    .filter(([, line]) => first.indexOf(line) === 0);
  return hits.length ? hits[0][1] : null;
}

async function pool(jobs, width) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

(async function main() {
  console.log("model: " + MODEL + "  sentences: " + SENTENCES.length +
              "  repeats: " + RUNS + "/arm  level: " + LABEL + "\n");

  // One real grade per sentence -- the badge both arms are scored against.
  const grades = await pool(SENTENCES.map(s => async () => {
    const raw = await callModel(HSKPrompt.grade({ text: s, label: LABEL }), 600);
    return parseGrade(raw, s);
  }), CONCURRENCY);

  const jobs = [];
  SENTENCES.forEach((s, i) => {
    for (const arm of ["independent", "handed"]) {
      for (let n = 0; n < RUNS; n++) {
        jobs.push(async () => {
          const p = HSKPrompt.explain({
            text: s, own: true, label: LABEL,
            grade: arm === "handed" ? grades[i] : null
          });
          const out = await callModel(p, Math.max(200, s.length * 3));
          return { i: i, arm: arm, text: out, opened: openingVerdict(out) };
        });
      }
    }
  });
  const rows = await pool(jobs, CONCURRENCY);

  console.log("sentence                              grader        independent  handed");
  let agree = { independent: 0, handed: 0 }, total = { independent: 0, handed: 0 };
  SENTENCES.forEach((s, i) => {
    const want = HSKPrompt.verdictFor(grades[i]);
    const cell = arm => {
      const mine = rows.filter(r => r.i === i && r.arm === arm);
      const ok = mine.filter(r => r.opened === want).length;
      agree[arm] += ok; total[arm] += mine.length;
      return ok + "/" + mine.length;
    };
    const short = want === HSKPrompt.VERDICTS.ok ? "natural"
                : want === HSKPrompt.VERDICTS.idiom ? "unidiomatic" : "wrong";
    console.log(s.padEnd(30) + "  " + short.padEnd(14) +
                cell("independent").padEnd(13) + cell("handed"));
  });

  console.log("\narm          opens with the grader's verdict");
  for (const arm of ["independent", "handed"]) {
    console.log("  " + arm.padEnd(13) + agree[arm] + "/" + total[arm] + "  " +
                (100 * agree[arm] / total[arm]).toFixed(0) + "%");
  }

  /* Every reply printed. The counts cannot see the failure mode this change
   * actually risks -- an explainer handed the answer writing a thinner
   * explanation under a correct verdict -- and that needs reading. */
  console.log("\n--- replies ---");
  SENTENCES.forEach((s, i) => {
    console.log("\n### " + s + "   [grader: " + HSKPrompt.verdictFor(grades[i]) + "]");
    for (const arm of ["independent", "handed"]) {
      rows.filter(r => r.i === i && r.arm === arm).forEach(r =>
        console.log("  [" + arm + "] " + r.text.replace(/\n/g, "\n      ")));
    }
  });

  console.log("\nspend: $" + spend.toFixed(4));
  const out = path.join(__dirname, "explain-verdict-ab-results.json");
  fs.writeFileSync(out, JSON.stringify({
    model: MODEL, runs: RUNS, level: LABEL, when: new Date().toISOString(),
    sentences: SENTENCES, grades: grades, rows: rows
  }, null, 2));
  console.log("written: " + path.relative(ROOT, out));
})();
