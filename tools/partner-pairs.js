/* Every pair of arms, unioned and intersected, from the stored verdicts.
 *
 * Round twenty-two left a frontier with a hole in it: one arm caught every
 * outright error and little else (`softBar` on glm-5.3-flash, 100% strict / 60%
 * loose), another caught most of the stiltedness and fired on half the corpus
 * (`decomposed`, 95% / 85%, 67% specificity). Nothing sat between them.
 *
 * A pair costs no API calls to evaluate -- both arms have already judged all 222
 * turns and the verdicts are on disk -- so the whole cross product is free, and
 * two of the combinations beat every single arm measured.
 *
 *   OR   fires when EITHER objects. Recall unions, specificity multiplies.
 *   AND  fires only when BOTH object. Specificity rises, recall falls.
 *
 * Ranked by loose recall + specificity, because the gate has to do both and the
 * strict bar has 21 positives behind it and cannot separate anything.
 *
 *   node tools/partner-pairs.js
 */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");

const SUFFIX = "-real-qwen.json", PREFIX = "partner-corpus-graded-";
const L = JSON.parse(fs.readFileSync(
  path.join(os.homedir(), "Documents", "real-qwen-labels.json"), "utf8"));
const W = new Set(L.wrong), U = new Set(L.unnatural);
const strict = id => W.has(id), loose = id => W.has(id) || U.has(id);

/* MEASURED on this corpus, as in partner-corpus-table.js. A pair costs the sum:
 * both arms run on every turn, because neither can be skipped without knowing
 * what the other said. */
const PRICE = { shipped: 0.00011, nativeFrame: 0.00011, decomposed: 0.00035,
  decomposedNative: 0.00035, lens: 0.00141, rewrite: 0.00025, rewriteLoose: 0.00030,
  "nativeFrame-glm-5.3-flash": 0.00030, "softBar-glm-5.3-flash": 0.00030 };

const arms = {};
for (const f of fs.readdirSync(__dirname)) {
  if (!f.startsWith(PREFIX) || !f.endsWith(SUFFIX)) continue;
  const key = f.slice(PREFIX.length, -SUFFIX.length), v = {};
  for (const r of JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8")).rows)
    v[r.id] = r.ok;
  arms[key] = v;
}

const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "n/a";
function score(name, v, cost) {
  const ids = Object.keys(v), fires = ids.filter(i => !v[i]);
  const sb = ids.filter(strict), lb = ids.filter(loose), good = ids.filter(i => !loose(i));
  return { name: name, n: ids.length, cost: cost,
    sr: pct(sb.filter(i => !v[i]).length, sb.length),
    lr: pct(lb.filter(i => !v[i]).length, lb.length),
    sp: pct(good.filter(i => v[i]).length, good.length),
    fi: pct(fires.length, ids.length),
    pr: pct(fires.filter(loose).length, fires.length),
    rank: (lb.filter(i => !v[i]).length / lb.length) +
          (good.filter(i => v[i]).length / good.length) };
}

const rows = Object.keys(arms).map(k => score(k, arms[k], PRICE[k] || 0));
const keys = Object.keys(arms).sort();
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
  const a = keys[i], b = keys[j], cost = (PRICE[a] || 0) + (PRICE[b] || 0);
  /* Only the turns BOTH judged. softBar dropped four to API errors and a pair
   * scored on a union of denominators would be comparing different corpora. */
  const ids = Object.keys(arms[a]).filter(id => id in arms[b]);
  const or = {}, and = {};
  for (const id of ids) { or[id] = arms[a][id] && arms[b][id]; and[id] = arms[a][id] || arms[b][id]; }
  rows.push(score(a + " OR " + b, or, cost), score(a + " AND " + b, and, cost));
}
rows.sort((x, y) => y.rank - x.rank);

console.log("\n" + "arm".padEnd(50) + "n    strict loose  spec  fires prec   $/turn");
console.log("-".repeat(94));
for (const r of rows.slice(0, 20))
  console.log(r.name.slice(0, 49).padEnd(50) + String(r.n).padEnd(5) +
    r.sr.padEnd(7) + r.lr.padEnd(7) + r.sp.padEnd(6) + r.fi.padEnd(6) +
    r.pr.padEnd(7) + (r.cost ? "$" + r.cost.toFixed(5) : ""));
console.log("\nOR fires when either objects; AND only when both do.");
console.log("Ranked by loose recall + specificity. 21 strict positives, 72 loose,");
console.log("150 negatives -- only the last two can separate anything.");
