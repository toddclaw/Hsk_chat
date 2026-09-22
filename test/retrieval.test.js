/* Retrieval engine: corpus mining and day-capped credit.
 * Run: node test/retrieval.test.js  — dependency-free, like every suite here. */
const R = require("../retrieval.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

const row = (word, day, ok, face) => ({
  id: word + "-" + day, word: word, day: day, ok: ok !== false,
  face: face || "gapfill", created_at: day + "T12:00:00Z"
});

// --- countsFrom -------------------------------------------------------------
const counts1 = R.countsFrom([row("苹果", "2026-09-01"), row("苹果", "2026-09-02")]);
check(counts1["苹果"].n === 2, "two ok days count two", JSON.stringify(counts1));

/* The merge-correctness claim from the design, tested as arithmetic: two
 * devices offline on the same day push two rows with different ids, and the
 * day must still count once. This is WHY the table has no unique constraint. */
const dup = [row("苹果", "2026-09-01"), Object.assign(row("苹果", "2026-09-01"), { id: "other-device" })];
check(R.countsFrom(dup)["苹果"].n === 1, "two devices, one day, counted once",
  JSON.stringify(R.countsFrom(dup)));

const missed = R.countsFrom([row("苹果", "2026-09-01", false)]);
check(missed["苹果"].n === 0, "a wrong answer adds nothing to n");
check(missed["苹果"].days["2026-09-01"] === true,
  "a wrong answer still occupies the day");

check(Object.keys(R.countsFrom([])).length === 0, "no rows, no counts");
check(Object.keys(R.countsFrom(null)).length === 0, "null rows do not throw");

// --- credit -----------------------------------------------------------------
const base = [row("苹果", "2026-09-01")];
const added = R.credit(base, row("苹果", "2026-09-02"));
check(added.length === 2, "a new day appends a row");
check(base.length === 1, "credit does not mutate the array it was given");

const capped = R.credit(base, Object.assign(row("苹果", "2026-09-01"), { id: "again" }));
check(capped.length === 1, "a second row for the same word-day is refused");

const cappedWrong = R.credit(base, Object.assign(row("苹果", "2026-09-01", false), { id: "again" }));
check(cappedWrong.length === 1,
  "the cap is symmetric: a wrong answer cannot re-open a banked day");

check(R.credit(base, row("香蕉", "2026-09-01")).length === 2,
  "a different word on the same day is fine");

// --- constants --------------------------------------------------------------
check(R.ROUND === 10 && R.CANDIDATES === 4 && R.MIN_WORDS === 4,
  "constants are exported, not re-typed by callers");

// --- dayOf coverage gaps ---------------------------------------------------
check(R.dayOf(new Date(2026, 8, 1, 12, 0, 0).toISOString()) === "2026-09-01",
  "dayOf extracts the day");
check(R.dayOf(null) === "", "dayOf handles null input");
check(R.dayOf("") === "", "dayOf handles empty input");
check(R.dayOf(new Date(2026, 8, 18, 21, 0, 0).toISOString()) === "2026-09-18",
  "dayOf is the learner's local day -- an evening is not tomorrow");

// --- same word with both wrong and ok row -----------------------------------
const bothRows = [row("苹果", "2026-09-01", false), row("苹果", "2026-09-01", true, "other")];
check(R.countsFrom(bothRows)["苹果"].n === 1,
  "same word with wrong and ok row on same day counts once");

// --- sentences --------------------------------------------------------------
/* A real lexicon, not a stub: the suite should fail if segmentation or
 * validation changes under it, which is the whole point of feeding them in. */
const fs = require("fs");
const path = require("path");
const HSK = require("../validator.js");
const lex = HSK.buildLexicon(
  JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk1.json"), "utf8")));
const segment = t => HSK.segment(t, lex);
const validate = t => HSK.validate(t, lex).length === 0;

const TODAY = "2026-09-12";
const YDAY = "2026-09-11";
/* Nine in the morning LOCAL on that day, as the ISO stamp a message carries.
 * dayOf() reads the learner's local day, so appending a Z here would put every
 * fixture on the following day east of Greenwich. */
const at = day => {
  const p = day.split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2], 9, 0, 0).toISOString();
};

const partner = (text, day) => ({
  role: "assistant", text: text, created_at: at(day || YDAY), conversation_id: "c1"
});
const segmentTurn = (text, day) => ({
  role: "assistant", kind: "segment", text: text, created_at: at(day || YDAY), conversation_id: "c1"
});
const mine = (text, grade, day) => ({
  role: "user", text: text, grade: grade, created_at: at(day || YDAY), conversation_id: "c1"
});
const sents = (turns, over) => R.sentences(Object.assign(
  { turns: turns, starters: [], today: TODAY, segment: segment, validate: validate }, over || {}));

const LONG = "我今天下午在学校看见你的朋友了。";   // 10 word tokens, all HSK 1
const SHORT = "我很好。";                          // 3 word tokens, under MIN_WORDS

check(sents([partner(LONG)]).length === 1, "a partner sentence is eligible");
check(sents([partner(LONG)])[0].kind === "partner", "partner turns are tagged partner");
check(sents([segmentTurn(LONG)])[0].kind === "story", "a story segment is tagged story");
check(sents([partner(LONG, TODAY)]).length === 0,
  "nothing from today: retrieval needs a gap, or it tests the screen");
check(sents([partner(SHORT)]).length === 0,
  "a sentence under MIN_WORDS is a guess, not a context");
check(sents([partner("我喜欢咖啡。")]).length === 0,
  "an out-of-level sentence is dropped even though it was stored");

check(sents([mine(LONG, { ok: true, errors: [] })]).length === 1,
  "my own sentence counts when the grader passed it");
check(sents([mine(LONG, { ok: false, errors: [{ tag: "word-choice" }], better: "" })]).length === 0,
  "a sentence the grader failed is never asked back at me");
check(sents([mine("x", null)]).length === 0, "an ungraded sentence is not eligible");
check(sents([mine(LONG, { ok: true, errors: [] })], { starters: [LONG] }).length === 0,
  "a tapped starter is not my writing");

/* The one source that comes from a turn the rule above rejects. The sentence
 * the learner got wrong returns as the sentence they get asked about. */
const corrected = mine("我今天下午在学校看见你的朋友。",
  { ok: false, errors: [{ tag: "aspect-le" }], better: LONG });
check(sents([corrected]).length === 1, "the grader's correction is corpus");
check(sents([corrected])[0].kind === "correction", "a correction is tagged correction");
check(sents([corrected])[0].text === LONG, "the correction's text, not the learner's");

const two = partner("我今天下午在学校看见你的朋友了。你的朋友是谁呀？");
check(sents([two]).length === 2, "a message splits into sentences", JSON.stringify(sents([two])));
check(sents([two])[0].text === LONG, "the terminator stays with its sentence");
check(sents([partner(LONG)])[0].day === YDAY, "the source day rides along for display");
check(R.sentences({ turns: null, today: TODAY, segment: segment, validate: validate }).length === 0,
  "no turns, no sentences");

// --- batch ------------------------------------------------------------------
/* A fixed sequence, not Math.random: a generator whose output cannot be pinned
 * is one you can only test for "did not throw". */
const seeded = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };

const pool = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk1.json"), "utf8"));
const learning = w => ({ w: w, from: 2, seen: 6 });

const batch = over => R.batch(Object.assign({
  turns: [partner(LONG)], starters: [], counts: {}, learning: [learning("朋友")],
  mistakes: [], pool: pool, today: TODAY, size: R.ROUND,
  segment: segment, validate: validate, random: seeded([0.1, 0.4, 0.7, 0.2, 0.9])
}, over || {}));

const one = batch()[0];
check(!!one, "an item is generated from one eligible sentence");
check(one.target === "朋友", "the target is a word the learner is learning");
check(LONG.slice(one.at, one.at + one.len) === "朋友",
  "at/len point at the target inside the sentence", JSON.stringify(one));
check(one.candidates.length === R.CANDIDATES, "four candidates");
check(one.candidates.indexOf("朋友") !== -1, "the target is among the candidates");
check(new Set(one.candidates).size === R.CANDIDATES, "no duplicate candidates");
check(one.candidates.every(w => LONG.indexOf(w) === -1 || w === "朋友"),
  "no distractor is already visible in the sentence", JSON.stringify(one.candidates));
check(one.source.kind === "partner" && one.source.day === YDAY,
  "the item knows where it came from");

/* A pool too small to fill four candidates must not ship a short list -- the
 * item is skipped instead. Both non-target entries here are already visible
 * in LONG, so eligible is empty and there is nothing to draw a distractor
 * from at all. */
const tinyPool = [{ w: "朋友", f: 1 }, { w: "你", f: 2 }, { w: "了", f: 3 }];
check(batch({ pool: tinyPool }).length === 0,
  "a pool too small for four candidates is skipped, not shipped short");

check(batch({ learning: [], mistakes: [] }).length === 0,
  "a sentence with no word worth practising is skipped, not filled with 的");
check(batch({ mistakes: ["朋友"], learning: [] })[0].target === "朋友",
  "a word from the mistake ledger is worth practising too");

/* The selector: fewest retrievals first, ties commonest-first. 朋友 has been
 * retrieved twice, 学校 not at all, so 学校 is the one to ask. */
const twoWords = { learning: [learning("朋友"), learning("学校")],
  counts: { "朋友": { n: 2, days: { "2026-09-01": true, "2026-09-02": true } } } };
check(batch(twoWords)[0].target === "学校", "the fewest-retrievals word wins");

/* 学校 has the fewest retrievals and would win -- but it has already been
 * answered today, so the day cap hands the item to 朋友 instead. */
const doneToday = {
  learning: [learning("朋友"), learning("学校")],
  counts: { "学校": { n: 0, days: { [TODAY]: true } }, "朋友": { n: 5, days: {} } }
};
check(batch(doneToday)[0].target === "朋友",
  "a word already answered today is not offered again");

const many = [];
for (let i = 0; i < 15; i++) many.push(partner(LONG, "2026-09-0" + ((i % 8) + 1)));
check(batch({ turns: many }).length <= R.ROUND, "a round is at most ROUND items");
const targets = batch({ turns: many, learning: [learning("朋友"), learning("学校")] })
  .map(it => it.target);
check(new Set(targets).size === targets.length, "no target is repeated in a round");

/* The boundary itself: far more eligible sentences and worth-practising
 * words than ROUND exist here, so a round must fill to exactly ROUND -- not
 * stop short, and not (an off-by-one the <= check above would miss) run
 * past it. */
const NEW = "你的朋友是谁呀？";
const richWords = ["我", "今天", "下午", "在", "学校", "看见", "你", "的", "朋友", "了", "是", "谁", "呀"];
const plenty = [];
for (let i = 0; i < 20; i++) {
  plenty.push(partner(LONG, "2026-09-0" + ((i % 8) + 1)));
  plenty.push(partner(NEW, "2026-09-0" + ((i % 8) + 1)));
}
check(batch({ turns: plenty, learning: richWords.map(learning) }).length === R.ROUND,
  "a round fills to exactly ROUND when enough sentences and words exist");

check(batch({ turns: [] }).length === 0, "an empty corpus yields an empty round");

/* A repeated target: pickTarget blanks only the first occurrence, so a naive
 * item would print the answer a few characters past its own blank. */
const REPEATED = "我今天去学校，你也去学校。";
check(batch({ turns: [partner(REPEATED)], learning: [learning("学校")] }).length === 0,
  "a sentence with the target word twice yields no item, not a leaked answer");

// --- traditional-script pool -------------------------------------------------
/* Simulates what gapPool() in index.html hands to batch() in traditional
 * mode: a pool keyed by the traditional form (`w`), simplified form riding
 * along as `other` -- the shape inScript() produces. Sentences and the
 * lexicon they are validated against are traditional too, so a candidate
 * drawn from the wrong (simplified) form would fail HSK.validate() against
 * this lexicon even though it is a real HSK1 word. */
const tradList = pool.map(e => e.t ? Object.assign({}, e, { w: e.t, other: e.w }) : e);
const tradLex = HSK.buildLexicon(tradList);
const tradSegment = t => HSK.segment(t, tradLex);
const tradValidate = t => HSK.validate(t, tradLex).length === 0;
const TRAD_SENT = "我今天去學校看朋友。";  // 學校 traditional for simplified 学校
const tradBatch = batch({
  turns: [partner(TRAD_SENT)], learning: [learning("學校")],
  pool: tradList, segment: tradSegment, validate: tradValidate
});
check(tradBatch.length > 0, "a traditional pool still produces an item");
tradBatch.forEach(it => {
  check(it.candidates.every(w => tradLex.words.has(w)),
    "every candidate is in the traditional lexicon items were validated against",
    JSON.stringify(it.candidates));
  check(it.candidates.indexOf("学校") === -1,
    "the simplified form of the target does not appear as a candidate",
    JSON.stringify(it.candidates));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
