/* Auditing the grader against its own production verdicts.
 *
 * messages.grade has been storing the grader's full judgement on every sentence
 * the learner has written -- ok, meant, better, cats, tagged errors -- for 23
 * days. 208 of them. Scoring those costs no API calls: the verdicts are already
 * made. Only the labels are missing.
 *
 * That makes this the best benchmark in the study. MuCGEC is human-labelled but
 * is advanced learner essay prose; the partner corpus is on-distribution but is
 * a model's writing and Claude's labels. These are the app's real user, at his
 * real level, judged by the real prompt, and the thing being labelled is a
 * human's Chinese -- which is what the grader was built for.
 *
 * BLIND, AND WHY IT MATTERS MORE HERE THAN ANYWHERE
 *
 * The verdict and the label live in the same row. A labeller who can see `ok`
 * and `better` is not labelling, it is agreeing, and the measurement would come
 * out near 100% however bad the grader is. --blind writes id and text ONLY, in
 * shuffled order, and the answer key goes somewhere the labeller is not reading.
 *
 * Round nine measured what a Claude label is worth on Chinese: 93% against human
 * ground truth, blind, with the residual disagreement definitional rather than
 * perceptual. That is what licenses this.
 *
 *   node tools/grade-audit.js --blind    # id + text, shuffled, no verdicts
 *   node tools/grade-audit.js --score <labels.json>
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };

const EXPORT = arg("export", path.join(os.homedir(), "Documents", "chat-export.json"));
const BLIND = path.join(os.homedir(), "Documents", "grade-audit-blind.json");
const KEY = path.join(os.homedir(), "Documents", ".grade-audit-key.json");

function rng(seed) {                                 // mulberry32, reproducible
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

if (args.includes("--blind")) {
  const graded = JSON.parse(fs.readFileSync(EXPORT, "utf8")).items.filter(i => i.grade);
  const rand = rng(97);
  const order = graded.map(g => ({ g, k: rand() })).sort((a, b) => a.k - b.k).map(o => o.g);
  const blind = [], key = [];
  order.forEach((g, n) => {
    const id = "G" + String(n + 1).padStart(3, "0");
    blind.push({ id: id, level: g.level || null, text: g.text });
    key.push({ id: id, ok: g.grade.ok !== false, better: g.grade.better || "",
               tags: (g.grade.errors || []).map(e => e.tag), activity: g.activity });
  });
  fs.writeFileSync(BLIND, JSON.stringify({ items: blind }, null, 1));
  fs.writeFileSync(KEY, JSON.stringify(key));
  console.log(blind.length + " sentences -> " + BLIND);
  console.log("verdicts withheld in " + KEY);
}

if (args.includes("--score")) {
  const key = new Map(JSON.parse(fs.readFileSync(KEY, "utf8")).map(k => [k.id, k]));
  const blind = new Map(JSON.parse(fs.readFileSync(BLIND, "utf8")).items.map(i => [i.id, i.text]));
  const mine = JSON.parse(fs.readFileSync(arg("score", args[args.indexOf("--score") + 1]), "utf8"));
  const L = mine.wrong ? new Set(mine.wrong) : null;
  if (!L) throw new Error("labels need a `wrong` array");

  let n = 0, agree = 0;
  const cell = { wrong: { hit: 0, n: 0 }, right: { hit: 0, n: 0 } };
  const missed = [], invented = [];
  for (const [id, k] of key) {
    if (!mine.seen || !mine.seen.includes(id)) {
      if (mine.seen) continue;                       // partial pass
    }
    const truth = L.has(id) ? "wrong" : "right";
    const said = k.ok ? "right" : "wrong";
    n++; cell[truth].n++;
    if (truth === said) { agree++; cell[truth].hit++; }
    else if (truth === "wrong") missed.push({ id, text: blind.get(id) });
    else invented.push({ id, text: blind.get(id), better: k.better });
  }
  const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "n/a";
  console.log("sentences scored      " + n);
  console.log("recall      " + cell.wrong.hit + "/" + cell.wrong.n + "  " +
              pct(cell.wrong.hit, cell.wrong.n) + "   (faulty ones it faulted)");
  console.log("specificity " + cell.right.hit + "/" + cell.right.n + "  " +
              pct(cell.right.hit, cell.right.n) + "   (correct ones it passed)");
  console.log("overall     " + agree + "/" + n + "  " + pct(agree, n));
  console.log("\nmissed (faulty, passed): " + missed.length);
  missed.slice(0, 20).forEach(m => console.log("  " + m.id + "  " + m.text));
  console.log("\ninvented (correct, faulted): " + invented.length);
  invented.slice(0, 20).forEach(m => console.log("  " + m.id + "  " + m.text +
    "\n       it wanted: " + m.better));
}
