/* Every arm and model scored so far, one table, from the stored verdicts.
 *
 * Arms are compared item by item on the same 204 turns, so this re-reads the
 * verdict files rather than re-running anything -- a comparison that cost new
 * API calls every time it was looked at would be consulted less often than it
 * should be.
 *
 *   node tools/partner-corpus-table.js
 */
"use strict";
const fs = require("fs"), path = require("path");

/* Two label sets, one lookup. The synthetic corpus is P-ids and the real one is
 * R-ids, so they cannot collide and a union is the whole of the join -- which is
 * what makes a POOLED row possible at all. The real labels live outside the
 * repository with the writing they describe; without them this prints the
 * synthetic table exactly as it did before. */
const L = JSON.parse(fs.readFileSync(path.join(__dirname, "partner-corpus-labels.json"), "utf8"));
const REAL = path.join(require("os").homedir(), "Documents", "real-qwen-labels.json");
const R = fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, "utf8"))
                              : { wrong: [], unnatural: [], english: [] };
const W = new Set([].concat(L.wrong, R.wrong));
const U = new Set([].concat(L.unnatural, R.unnatural));
const E = new Set([].concat(L.english || [], R.english || []));
const strict = id => W.has(id) || E.has(id);
const loose = id => strict(id) || U.has(id);

/* MEASURED $ per turn on this corpus, not derived from the per-token price.
 * The distinction matters: glm-5.3 lists at a third of qwen3.8-max's headline
 * rate and both are reasoning models, so what you actually pay is set by how
 * many thinking tokens they spend before answering -- 2.3k and 3.9k against a
 * non-reasoning model's 60. Judged by list price these look cheaper than
 * Sonnet. They are 2.5x and 6x it. */
const PRICE = {
  "shipped": 0.00011, "noLevel": 0.00011, "nativeFrame": 0.00011,
  "decomposed": 0.00035,                             // ~3.2 calls per turn
  "nativeFrame-glm-5.3-flash": 0.00030,
  "nativeFrame-claude-sonnet-4.5": 0.00410,
  "nativeFrame-glm-5.3": 0.01034,
  "nativeFrame-qwen3.8-max-0902": 0.02515,
  "lens": 0.00141,                                   // ~45 small qwen calls a turn, measured
  "lensLoose": 0.00160,                              // + one stiltedness call per rewrite finding
  "softBar-glm-5.3-flash": 0.00030,
  "softBar-claude-sonnet-4.5": 0.00410
};

/* An arm now has up to two verdict files -- the 204 synthetic turns and the 222
 * real qwen ones -- and the third row, both together, is the one round
 * twenty-two was run to get: 39 strict positives instead of 21 or 18. Grouped by
 * the arm name with the corpus suffix stripped, so a new corpus needs no change
 * here beyond its suffix. */
const CORPORA = [["-real-qwen", "real"]];
const groups = new Map();
for (const f of fs.readdirSync(__dirname).filter(f => /^partner-corpus-graded-.*\.json$/.test(f))) {
  const bare = f.replace(/^partner-corpus-graded-|\.json$/g, "");
  const hit = CORPORA.find(([suffix]) => bare.endsWith(suffix));
  const key = hit ? bare.slice(0, -hit[0].length) : bare;
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8")).rows;
  const g = groups.get(key) || { synthetic: null, real: null };
  g[hit ? hit[1] : "synthetic"] = rows;
  groups.set(key, g);
}
const files = [];
for (const [key, g] of groups) {
  if (g.synthetic) files.push({ key: key, corpus: "synth", rows: g.synthetic });
  if (g.real) files.push({ key: key, corpus: "real", rows: g.real });
  if (g.synthetic && g.real)
    files.push({ key: key, corpus: "POOL", rows: [].concat(g.synthetic, g.real) });
}

const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "n/a";
const rows = [];
for (const { key, corpus, rows: r } of files) {
  const cell = bar => {
    const bad = r.filter(x => bar(x.id)), good = r.filter(x => !bar(x.id));
    const caught = bad.filter(x => !x.ok).length;
    return { rec: pct(caught, bad.length), n: caught + "/" + bad.length,
             spec: pct(good.filter(x => x.ok).length, good.length),
             prec: pct(caught, r.filter(x => !x.ok).length) };
  };
  const s = cell(strict), l = cell(loose);
  rows.push({ key, corpus, n: r.length, s, l,
              fires: pct(r.filter(x => !x.ok).length, r.length),
              cost: PRICE[key] });
}
rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
                   ["synth", "real", "POOL"].indexOf(a.corpus) -
                   ["synth", "real", "POOL"].indexOf(b.corpus));

console.log("\n" + "arm / model".padEnd(30) + "corpus  " + "n    strict       loose        spec  fires  prec   $/turn  $/session");
console.log("-".repeat(104));
for (const r of rows) {
  console.log(r.key.padEnd(30) + r.corpus.padEnd(8) + String(r.n).padEnd(5) +
    (r.s.rec + " " + r.s.n).padEnd(13) + (r.l.rec + " " + r.l.n).padEnd(13) +
    r.l.spec.padEnd(6) + r.fires.padEnd(7) + r.l.prec.padEnd(7) +
    (r.cost ? "$" + r.cost.toFixed(5) : "   ?  ").padEnd(9) +
    (r.cost ? "$" + (r.cost * 30).toFixed(3) : ""));
}
console.log("\nsynth = 204 generated turns; real = 222 turns from the app's own");
console.log("database, qwen activities only (story is Sonnet's); POOL = both.");
console.log("strict = outright wrong or English left in (21 synth, 21 real)");
console.log("loose  = + grammatical but not worth imitating (53 synth, 72 real)");
console.log("spec/prec are on the loose bar; $/session is 30 partner turns.");
