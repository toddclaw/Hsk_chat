/* Stratified sampling for the partner corpus.
 *
 * WHY THIS EXISTS
 *
 * Round seventeen: the 204-turn corpus has 21 strict positives, one catch is
 * five points of recall, and no two graders in this study are distinguishable on
 * it. The fix is more positives, and the partner is only wrong 8.8% of the time,
 * so finding 100 of them means reading 1,100 turns by hand.
 *
 * Stratification buys most of them for a fraction of the reading. Cheap graders
 * run over everything -- they cost $0.0007 a turn and nobody has to read their
 * output -- and split the corpus in two:
 *
 *   FLAGGED    at least one cheap grader objected. Positive-dense. Labelled in
 *              full, so this stratum is a census and carries no sampling error.
 *   UNFLAGGED  nobody objected. Positive-sparse but not empty, because the cheap
 *              union misses about a third of them. A RANDOM sample is labelled
 *              and weighted up by the stratum size.
 *
 * The randomness is the whole thing. Labelling only what the graders flagged
 * would measure the graders against themselves -- every miss would be invisible
 * by construction, and recall would come out at 100%. The unflagged sample is
 * what keeps the estimate honest, and it has to stay random even when it is
 * boring to read.
 *
 * Estimates are Horvitz-Thompson: each labelled turn stands for 1/(its sampling
 * probability) turns, which is 1 in the flagged stratum and N_unflagged/n_sample
 * in the other.
 *
 *   node tools/partner-stratify.js --plan     # what to label, and the weights
 *   node tools/partner-stratify.js --score <graded.json> [--labels <f>]
 */
"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };

const CORPUS = arg("corpus", "partner-corpus-2.json");
const SAMPLE = Number(arg("sample", 200));          // unflagged turns to read
const FLAGGERS = (arg("flaggers",
  "nativeFrame-c-2,nativeFrame-glm-5.3-flash-c-2,softBar-glm-5.3-flash-c-2")).split(",");

const P = f => path.join(__dirname, f);
const load = f => JSON.parse(fs.readFileSync(P(f), "utf8"));

function rng(seed) {                                 // mulberry32, reproducible
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function strata() {
  const items = load(CORPUS).items;
  const flagged = new Set();
  const present = [];
  for (const f of FLAGGERS) {
    const file = "partner-corpus-graded-" + f + ".json";
    if (!fs.existsSync(P(file))) continue;
    present.push(f);
    for (const r of load(file).rows) if (r.ok === false) flagged.add(r.id);
  }
  if (!present.length) throw new Error("no flagger verdicts found -- run them first");
  const A = items.filter(i => flagged.has(i.id));
  const B = items.filter(i => !flagged.has(i.id));
  const rand = rng(41);
  const order = B.map((it, n) => ({ it, k: rand() + n * 0 })).sort((x, y) => x.k - y.k);
  const sample = order.slice(0, Math.min(SAMPLE, B.length)).map(o => o.it);
  return { items, A, B, sample, present,
           weightA: 1, weightB: B.length / Math.max(1, sample.length) };
}

if (args.includes("--plan")) {
  const s = strata();
  console.log("flaggers used: " + s.present.join(", "));
  console.log("corpus            " + s.items.length);
  console.log("flagged  (census) " + s.A.length + "   weight " + s.weightA.toFixed(2));
  console.log("unflagged         " + s.B.length + "   sampling " + s.sample.length +
              " of them, weight " + s.weightB.toFixed(2));
  console.log("to read           " + (s.A.length + s.sample.length) +
              "  (" + (100 * (s.A.length + s.sample.length) / s.items.length).toFixed(0) + "% of the corpus)\n");
  const out = { flagged: s.A.map(i => i.id), sampled: s.sample.map(i => i.id),
                weightA: s.weightA, weightB: s.weightB,
                unflaggedTotal: s.B.length, corpus: CORPUS };
  fs.writeFileSync(P("partner-stratify-plan.json"), JSON.stringify(out, null, 1));
  console.log("written: partner-stratify-plan.json");
}

/* Weighted recall and specificity, with the standard error the whole exercise
 * was for. The flagged stratum contributes no variance -- it is counted, not
 * sampled -- so all of it comes from the unflagged sample. */
if (args.includes("--score")) {
  const plan = load("partner-stratify-plan.json");
  const L = load(arg("labels", "partner-corpus-2-labels.json"));
  const rows = load(arg("score", args[args.indexOf("--score") + 1])).rows;
  const verdict = new Map(rows.map(r => [r.id, r.ok]));
  const W = new Set(L.wrong), E = new Set(L.english), U = new Set(L.unnatural);
  const inA = new Set(plan.flagged), inB = new Set(plan.sampled);

  const bars = { strict: id => W.has(id) || E.has(id),
                 loose: id => W.has(id) || E.has(id) || U.has(id) };
  for (const [name, bad] of Object.entries(bars)) {
    let posW = 0, caughtW = 0, negW = 0, passedW = 0, varPos = 0, varCaught = 0;
    for (const id of [...inA, ...inB]) {
      const v = verdict.get(id);
      if (v === undefined) continue;
      const w = inA.has(id) ? plan.weightA : plan.weightB;
      if (bad(id)) { posW += w; if (v === false) caughtW += w;
                     if (inB.has(id)) { varPos += w * w; if (v === false) varCaught += w * w; } }
      else { negW += w; if (v === true) passedW += w; }
    }
    const rec = caughtW / posW;
    /* Delta-method SE on a ratio of two weighted sums, using only the sampled
     * stratum's contribution. Rough, and honest about being rough. */
    const se = posW ? Math.sqrt(Math.max(0, varCaught * (1 - rec) * (1 - rec) +
                 (varPos - varCaught) * rec * rec)) / posW : 0;
    console.log(name.padEnd(8) +
      "recall " + (100 * rec).toFixed(0) + "% +/- " + (100 * 1.96 * se).toFixed(0) +
      "   (est. " + posW.toFixed(0) + " positives in " +
      (posW + negW).toFixed(0) + " turns)   specificity " +
      (100 * passedW / negW).toFixed(0) + "%");
  }
}
