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
check(R.dayOf("2026-09-01T12:00:00Z") === "2026-09-01", "dayOf extracts the day");
check(R.dayOf(null) === "", "dayOf handles null input");
check(R.dayOf("") === "", "dayOf handles empty input");

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
const at = day => day + "T09:00:00Z";

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
