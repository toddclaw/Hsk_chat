/* Chat-time accounting. Run: node test/time.test.js
 *
 * The clock is the easy half. What these check is the sync: a counter merged
 * with last-write-wins loses whichever device synced first, and it loses it
 * silently, which is the failure mode worth a test.
 */
const T = require("../time.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));
const eq = (got, want, label) =>
  check(got === want, label, got === want ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// 1. Day keys are local, not UTC: "today" is the day the person is having.
const d = new Date(2026, 7, 22, 23, 30);          // 22 Aug, local, late evening
eq(T.dayKey(d), "2026-08-22", "dayKey uses local date");
eq(T.dayKey(new Date(2026, 0, 5)), "2026-01-05", "single digits are padded");

// 2. Adding only ever touches the device doing the adding.
let m = {};
T.add(m, "dev-a", 60, "2026-08-22");
T.add(m, "dev-a", 30, "2026-08-22");
T.add(m, "dev-a", 10, "2026-08-21");
eq(m["dev-a"].total, 100, "total accumulates across days");
eq(m["dev-a"].days["2026-08-22"], 90, "and the day bucket accumulates separately");
T.add(m, "dev-b", 5, "2026-08-22");
eq(m["dev-a"].total, 100, "a second device does not disturb the first");
check(T.add(m, "dev-a", 0, "2026-08-22")["dev-a"].total === 100, "zero seconds is a no-op");
check(T.add(m, "dev-a", -50, "2026-08-22")["dev-a"].total === 100, "negative seconds cannot rewind it");

// 3. Totals sum across devices, which is the whole point of keeping them apart.
const t = T.totals(m, "2026-08-22");
eq(t.today, 95, "today sums every device's bucket for that day");
eq(t.total, 105, "and the total sums every device");
eq(T.totals({}, "2026-08-22").total, 0, "an empty map totals zero");

/* 4. The merge. This is what last-write-wins would get wrong: each side has
 *    time the other has never seen, and both have to survive. */
const phone  = { "dev-a": { total: 600, days: { "2026-08-22": 600 } } };
const laptop = { "dev-b": { total: 300, days: { "2026-08-22": 300 } } };
const both = T.merge(phone, laptop);
eq(T.totals(both, "2026-08-22").total, 900, "merging two devices keeps both totals");
eq(T.totals(both, "2026-08-22").today, 900, "and both of today's buckets");
check(T.merge(phone, {})["dev-a"].total === 600, "merging with nothing keeps what we had");
check(T.merge({}, laptop)["dev-b"].total === 300, "merging into nothing adopts the remote");

// A stale copy of our own device must never drag our number backwards.
const ahead = { "dev-a": { total: 900, days: { "2026-08-22": 900 } } };
const stale = { "dev-a": { total: 600, days: { "2026-08-22": 600 } } };
eq(T.merge(ahead, stale)["dev-a"].total, 900, "a stale remote cannot reduce a local total");
eq(T.merge(stale, ahead)["dev-a"].total, 900, "and a newer remote raises it");
eq(T.merge(ahead, stale)["dev-a"].days["2026-08-22"], 900, "same for the day bucket");

/* Idempotent and order-independent, or repeated syncs would drift. Compared
 * canonically: the two merges hold the same numbers but insert the device keys
 * in whichever order they were walked, and object key order is not something
 * either side should have to agree on. */
const canon = o => JSON.stringify(Object.keys(o).sort().map(k =>
  [k, o[k].total, Object.keys(o[k].days).sort().map(d => [d, o[k].days[d]])]));
const once = T.merge(phone, laptop);
eq(canon(T.merge(once, laptop)), canon(once), "merging the same remote twice changes nothing");
eq(canon(T.merge(phone, laptop)), canon(T.merge(laptop, phone)),
  "merge does not depend on which side is which");

// Merging must not alias the inputs, or a later add() would mutate a peer's copy.
const src = { "dev-a": { total: 60, days: { "2026-08-22": 60 } } };
const merged = T.merge(src, {});
T.add(merged, "dev-a", 60, "2026-08-22");
eq(src["dev-a"].total, 60, "merge copies rather than aliasing its inputs");

// 5. Pruning bounds the blob without ever losing time from the totals.
let old = {};
T.add(old, "dev-a", 100, "2026-01-01");
T.add(old, "dev-a", 50, "2026-08-22");
T.prune(old, 14, "2026-08-22");
eq(old["dev-a"].total, 150, "pruning old days leaves the total alone");
eq(old["dev-a"].days["2026-01-01"], undefined, "the old day bucket is gone");
eq(old["dev-a"].days["2026-08-22"], 50, "and a recent one is kept");

// 6. Formatting. Reads as a study total, not a stopwatch.
eq(T.format(0), "none yet", "zero");
eq(T.format(1), "under a minute", "a few seconds");
eq(T.format(59), "under a minute", "just under a minute");
eq(T.format(60), "1 min", "exactly a minute");
eq(T.format(1440), "24 min", "under an hour");
eq(T.format(3600), "1 h", "exactly an hour reads without a stray 0 min");
eq(T.format(5880), "1 h 38 min", "hours and minutes");
eq(T.format(41880), "11 h 38 min", "many hours");
eq(T.format(undefined), "none yet", "missing input does not throw");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
