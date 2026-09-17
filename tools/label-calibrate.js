/* How good is Claude's labelling, measured against human ground truth?
 *
 * The partner-statement corpus (round eight onward) has no human annotators
 * behind it -- the labels will be Claude's. MuCGEC's whole value was that no
 * model touched the labels, so before spending Claude's judgement on partner
 * Chinese, it gets scored on Chinese a human already judged.
 *
 * The blind part matters twice over. grader-bench.json is 140 PAIRS: a
 * learner's sentence and a human's correction of that same sentence, differing
 * by a character or two. Seeing both halves together makes the task trivial and
 * measures nothing, so each pair is split -- one half to batch A, one to batch
 * B, which side decided by a fixed-seed shuffle. Each batch is ~50/50 and no
 * pair appears twice inside one. Truth is not written to the blind file.
 *
 *   node tools/label-calibrate.js --make            # blind batches
 *   node tools/label-calibrate.js --score labels.json
 */
"use strict";
const fs = require("fs");
const path = require("path");

const BENCH = path.join(__dirname, "grader-bench.json");
const BLIND = path.join(__dirname, "label-calibrate-blind.json");

// mulberry32, so the split is the same every run and the result reproduces.
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make() {
  const items = JSON.parse(fs.readFileSync(BENCH, "utf8")).items;
  const byPair = new Map();
  for (const it of items) {
    if (!byPair.has(it.pair)) byPair.set(it.pair, []);
    byPair.get(it.pair).push(it);
  }
  const rand = rng(8);
  const batches = { A: [], B: [] };
  const key = [];
  for (const [pair, half] of byPair) {
    if (half.length !== 2) continue;
    const flip = rand() < 0.5;
    const to = { A: flip ? half[0] : half[1], B: flip ? half[1] : half[0] };
    for (const b of ["A", "B"]) {
      const id = b + String(batches[b].length + 1).padStart(3, "0");
      batches[b].push({ id, text: to[b].text });
      key.push({ id, truth: to[b].truth, pair, level: to[b].level });
    }
  }
  for (const b of ["A", "B"]) {           // order within a batch, too
    const r = rng(b === "A" ? 17 : 23);
    batches[b].sort(() => r() - 0.5);
  }
  fs.writeFileSync(BLIND, JSON.stringify({ batches }, null, 1));
  fs.writeFileSync(path.join(__dirname, ".label-calibrate-key.json"),
    JSON.stringify(key));
  console.log("A", batches.A.length, "B", batches.B.length, "->", BLIND);
}

function score(file) {
  const key = new Map(JSON.parse(fs.readFileSync(
    path.join(__dirname, ".label-calibrate-key.json"), "utf8")).map(k => [k.id, k]));
  const mine = JSON.parse(fs.readFileSync(file, "utf8"));
  let n = 0, ok = 0;
  const cell = { wrong: { hit: 0, n: 0 }, right: { hit: 0, n: 0 } };
  const misses = [];
  for (const [id, label] of Object.entries(mine)) {
    const k = key.get(id);
    if (!k) throw new Error("unknown id " + id);
    n++; cell[k.truth].n++;
    if (label === k.truth) { ok++; cell[k.truth].hit++; }
    else misses.push({ id, truth: k.truth, said: label, level: k.level });
  }
  const pct = (a, b) => (100 * a / b).toFixed(0) + "%";
  console.log(`recall      ${cell.wrong.hit}/${cell.wrong.n}  ${pct(cell.wrong.hit, cell.wrong.n)}`);
  console.log(`specificity ${cell.right.hit}/${cell.right.n}  ${pct(cell.right.hit, cell.right.n)}`);
  console.log(`overall     ${ok}/${n}  ${pct(ok, n)}`);
  console.log("\nmisses:");
  for (const m of misses) console.log(" ", m.id, "truth", m.truth, "said", m.said);
  fs.writeFileSync(file.replace(/\.json$/, "-scored.json"),
    JSON.stringify({ n, ok, cell, misses }, null, 1));
}

if (process.argv.includes("--make")) make();
else if (process.argv.includes("--score")) score(process.argv[process.argv.indexOf("--score") + 1]);
else console.log("--make | --score <labels.json>");
