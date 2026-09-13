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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
