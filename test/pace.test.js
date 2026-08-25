/* Pacing arithmetic. Run: node test/pace.test.js */
const fs = require("fs");
const path = require("path");
const P = require("../pace.js");
const HSK = require("../validator.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

const load = n => JSON.parse(fs.readFileSync(path.join(__dirname, `../data/hsk${n}.json`), "utf8"));
const l1 = load(1), l2 = load(2);

// --- the pool ---------------------------------------------------------------
const pool = P.buildPool(l1, l2);
const l1set = new Set(l1.map(e => e.w));
check(pool.length > 0 && pool.length === l2.length - l1.length,
  `pool is exactly what level 2 adds (${pool.length})`);
check(pool.every(e => !l1set.has(e.w)), "pool excludes everything already known");
check(pool.slice(0, 20).every((e, i, a) => i === 0 || (a[i - 1].f || Infinity) <= (e.f || Infinity)),
  "pool is ordered by corpus frequency");
check(["让", "自己", "但"].every(w => pool.slice(0, 12).some(e => e.w === w)),
  "the commonest additions come first", pool.slice(0, 6).map(e => e.w).join(" "));
check((pool[pool.length - 1].f || Infinity) >= (pool[0].f || 0), "unranked words sort last");

/* The pool must exclude everything already usable, not just the level list.
 * 啊 lives in EXTRA_ALLOWED and is permitted at every level, so offering it
 * would spend a credit on a word the learner already has. */
const withParticles = P.buildPool(l1.concat(HSK.EXTRA_ALLOWED), l2);
check(!withParticles.some(e => e.w === "啊"),
  "always-allowed particles are never offered as new");
check(withParticles.length === pool.length - 1,
  "and excluding them removes exactly those words",
  `${withParticles.length} vs ${pool.length}`);
const withAdded = P.buildPool(l1.concat([{ w: "让" }]), l2);
check(!withAdded.some(e => e.w === "让"), "a word already added is never offered as new");

// --- counting ---------------------------------------------------------------
check(P.countHan("我很好，谢谢你！") === 6, "counts Han characters only, not punctuation",
  String(P.countHan("我很好，谢谢你！")));
check(P.countHan("hello 123 ！") === 0, "latin and digits are not reading effort");

// --- earning ----------------------------------------------------------------
let st = { chars: 0, credits: 0 };
st = P.earn(st, "我".repeat(44), 45);
check(st.credits === 0 && st.chars === 44, "44 characters earns nothing yet", JSON.stringify(st));
st = P.earn(st, "我", 45);
check(st.credits === 1 && st.chars === 0, "the 45th earns a credit", JSON.stringify(st));
st = P.earn(st, "我".repeat(50), 45);
check(st.credits === 2 && st.chars === 5, "the remainder carries, nothing is lost to rounding",
  JSON.stringify(st));
st = P.earn(st, "我".repeat(500), 45);
check(st.credits === P.CREDIT_CAP, "credits cap so a long gap cannot dump a pile of new words",
  JSON.stringify(st));
check(st.chars < 45, "and the character counter stops hoarding once capped", JSON.stringify(st));
check(P.earn({ chars: 0, credits: 0 }, "我".repeat(80), 80).credits === 1,
  "a slower rate really is slower");

// --- the slate --------------------------------------------------------------
const first = P.slate(pool, [], 3).map(e => e.w);
check(first.length === 3, "offers three candidates");
const after = P.slate(pool, first, 3).map(e => e.w);
check(after.every(w => !first.includes(w)), "already-introduced words are never offered again",
  after.join(" "));
check(P.slate(pool, pool.map(e => e.w), 3).length === 0, "an exhausted pool offers nothing");

// --- spotting use -----------------------------------------------------------
// the lexicon must contain the words being looked for, or the segmenter never
// produces them as tokens and the check would pass for the wrong reason
const offered = pool.filter(e => ["自己", "但", "让"].includes(e.w));
check(offered.length === 3, "the three test words are really in the level-2 pool");
const lex = HSK.buildLexicon(l1.concat(offered));
const toks = HSK.segment("我自己也可以做。", lex);
check(P.spot(toks, ["自己", "可以", "让"]).sort().join() === ["可以", "自己"].sort().join(),
  "spots the offered words the model actually used",
  JSON.stringify(P.spot(toks, ["自己", "可以", "让"])));
// substring safety: 一定 must not be credited by 一 inside 一起
const lex2 = HSK.buildLexicon(l1.concat([{ w: "一定", p: "yī dìng", d: "certainly" }]));
check(P.spot(HSK.segment("我们一起走。", lex2), ["一定"]).length === 0,
  "a word is not credited for appearing inside another word");

/* Escalation. Asking politely stops working with some models -- they read the
 * offer as optional and never take it -- so after two declined offers the word
 * stops being a suggestion. */
check(P.FORCE_AFTER === 2, "forces after two declines");
check(!P.shouldForce(0) && !P.shouldForce(1), "one decline is not enough");
check(P.shouldForce(2) && P.shouldForce(5), "two or more forces the word");
check(!P.shouldForce(undefined), "an absent counter is not a decline");

/* The offer must skip words marked "already known ahead of time" exactly like
 * it skips words already introduced -- slate() takes a single skip set, so the
 * app is expected to concat S.learning and S.known before calling it. */
const skipBoth = P.slate(pool, ["让", "但"], 5).map(e => e.w);
check(!skipBoth.includes("让") && !skipBoth.includes("但"),
  "slate() skips anything in the skip set, known-ahead words included",
  skipBoth.join(" "));

// --- promotion --------------------------------------------------------------
check(P.isNew({ seen: 0 }) && P.isNew({ seen: P.PROMOTE_AT - 1 }) && !P.isNew({ seen: P.PROMOTE_AT }),
  `new until ${P.PROMOTE_AT} sightings`);


/* ------------------------------------------------------- level readiness */

/* The whole point of weighting by 1/f: the list share and the text share are
 * very different numbers, and only the second one answers "am I ready". Built
 * from the real wordlists rather than a fixture, because the gap between them
 * is a property of the shipped data -- a fixture could show the arithmetic
 * working while the data it runs on had quietly changed shape. */
const h1 = load(1), h2 = load(2);
const h1w = h1.map(e => e.w);

const cov = P.coverage(h2, h1w);
check(cov > 0.85 && cov < 0.92,
  `HSK 1 covers ~88% of HSK 2 text (got ${(cov * 100).toFixed(1)}%)`);
check(h1.length / h2.length < 0.65,
  "while covering only ~60% of the HSK 2 list -- the two are not the same question");
check(cov > h1.length / h2.length + 0.2,
  "and text coverage runs well ahead of list coverage");
/* Across every transition, not just the first: the bands are cumulative and
 * each adds rarer words, so the gap is a property of the syllabus rather than
 * a quirk of HSK 1. If it ever closed, weighting by 1/rank would be pointless
 * and the panel could go back to counting words. */
for (let n = 1; n <= 6; n++) {
  const a = load(n), b = load(n + 1);
  const text = P.coverage(b, a.map(e => e.w)), list = a.length / b.length;
  check(text > list + 0.2,
    `HSK ${n}->${n + 1}: text coverage leads list share`,
    `${(text * 100).toFixed(1)}% vs ${(list * 100).toFixed(1)}%`);
}

check(P.coverage(h2, h2.map(e => e.w)) === 1, "knowing every word is full coverage");
check(P.coverage(h2, []) === 0, "knowing none is zero");
check(P.coverage([], ["x"]) === 0, "an empty level does not divide by zero");

const need = P.toTarget(h2, h1w, P.READY_AT);
check(need > 20 && need < 120,
  `~58 words to the 98% mark, not all 197 (got ${need})`);
check(P.toTarget(h2, h1w, 0.95) < need, "95% costs fewer words than 98%");
check(P.toTarget(h2, h2.map(e => e.w), P.READY_AT) === 0, "already past target needs nothing");

/* 95% would be degenerate against the real syllabus: HSK 5 already covers over
 * 95% of HSK 6 text before anything is learned, so the recommendation would
 * fire having recommended nothing. Every transition must actually ask for
 * words. */
for (let n = 1; n <= 6; n++) {
  const a = load(n), b = load(n + 1);
  check(P.toTarget(b, a.map(e => e.w), P.READY_AT) > 0,
    `HSK ${n}->${n + 1}: the move-up mark is not already met on arrival`);
}

/* Unranked words carry no weight, so a target that cannot be reached must stop
 * rather than hand back the whole remaining list as if it would help. */
const unranked = [{ w: "a", f: 1 }, { w: "b", f: 999999 }, { w: "c" }];
check(P.toTarget(unranked, ["a"], 0.99) === 0,
  "words the corpus never saw are never counted toward a target");

/* Production is a second reading of the same scale, not a bonus on the first.
 * Words you have written are a subset of words you can read, so it can only be
 * lower -- that gap is the receptive/productive one, and showing it is the
 * point. */
const readCov = P.coverage(h2, h1w);
const useCov = P.coverage(h2, h1w.slice(0, 50));
check(useCov < readCov, "production coverage sits below reading coverage");
check(useCov >= 0 && readCov <= 1, "both stay on the same 0..1 scale");

/* The bug this replaced: the headline was weighted and clamped while
 * toTarget() was not, so the panel could show 100% and "57 more words to 95%"
 * in the same breath. They have to agree at the threshold, whatever the
 * learner knows. Checked across a sweep rather than one state, since the
 * disagreement only showed up once enough common words were produced. */
let incoherent = 0;
for (let n = 0; n <= 400; n += 40) {
  const known = h1w.concat(P.buildPool(h1, h2).slice(0, n).map(e => e.w));
  const atOrPast = P.coverage(h2, known) >= P.READY_AT;
  const nothingToGo = P.toTarget(h2, known, P.READY_AT) === 0;
  if (atOrPast !== nothingToGo) incoherent++;
}
check(incoherent === 0,
  "the headline and the words-to-threshold count never contradict each other",
  `${incoherent} states disagreed`);

check(P.PROMOTE_AT === 6, "a word is new until 6 sightings, not 3");

/* ------------------------------------------------ documented figures ------
 *
 * README.md and RESEARCH.md both reason in concrete numbers -- 520 words at
 * HSK 1, 741 new at HSK 2, ~85% coverage, ~147 words to the threshold -- and
 * RESEARCH.md is published for people to check the argument against. Prose
 * drifts from data silently: the README's counts were already stale by a dozen
 * words before anyone noticed. Pin them.
 */
const SIZES = [300, 497, 988, 1978, 3557, 5334, 10896];
SIZES.forEach((n, i) => {
  check(load(i + 1).length === n,
    `HSK ${i + 1} ships ${n} entries, as the docs say`,
    `actually ${load(i + 1).length}`);
});
check(h2.length - h1.length === 197,
  "197 new words between HSK 1 and HSK 2, as RESEARCH.md states",
  `actually ${h2.length - h1.length}`);
check(Math.round(P.coverage(h2, h1w) * 100) === 88,
  "HSK 1 covers 88% of HSK 2 text, the figure RESEARCH.md argues from",
  `actually ${Math.round(P.coverage(h2, h1w) * 100)}%`);
check(P.toTarget(h2, h1w, P.READY_AT) === 58,
  "and 58 words reach the mark, the number the panel shows a beginner",
  `actually ${P.toTarget(h2, h1w, P.READY_AT)}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
