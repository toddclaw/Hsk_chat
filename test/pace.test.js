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
check(["让", "自己", "可以"].every(w => pool.slice(0, 12).some(e => e.w === w)),
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
const offered = pool.filter(e => ["自己", "可以", "让"].includes(e.w));
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

// --- promotion --------------------------------------------------------------
check(P.isNew({ seen: 0 }) && P.isNew({ seen: 2 }) && !P.isNew({ seen: 3 }),
  `new until ${P.PROMOTE_AT} sightings`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
