/* Wall-clock cost of a partner turn, reconstructed from debug_log.
 *
 * The acceptance instrument for docs/superpowers/plans/2026-09-23-partner-turn-latency.md.
 * Every stage of that plan is measured with this and nothing else, so a
 * later number is comparable with the baseline it claims to beat.
 *
 * Reads the text tools/pull-debug.js prints, rather than talking to Supabase
 * itself: the key handling, the pruning and the table-missing degradation all
 * live there already and there is no reason for a second copy.
 *
 *   node tools/pull-debug.js --hours 720 | node tools/turn-latency.js
 *   node tools/turn-latency.js --selftest
 */
"use strict";

/* A turn starts at its [plan] line, or at [attempt 1] when planning is off or
 * the activity is unplanned. It ends at the last line before the next start.
 *
 * The [plan] line is printed AFTER the planner returns, so the planner's own
 * time sits OUTSIDE every span measured here -- real turns are longer than
 * this reports. Task 2 adds [phase] lines that close that gap; until it lands,
 * treat these as a lower bound. */
const TS = (l) => {
  const m = String(l).match(/^(\d\d):(\d\d):(\d\d)\.(\d\d\d)/);
  return m ? ((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000 + +m[4]) : null;
};

function parseTurns(text) {
  const out = [];
  let cur = null;
  const push = () => { if (cur && cur.attempts > 0) out.push(cur); };
  const fresh = (t) => ({ start: t, end: t, attempts: 0, gateMs: 0, gateFail: 0,
                          require: 0, echo: 0, phases: {} });
  for (const line of String(text).split("\n")) {
    const t = TS(line);
    if (t === null) continue;
    if (/\[plan\] /.test(line) && !/too hard|no affordable/.test(line)) {
      push(); cur = fresh(t); continue;
    }
    if (/\[attempt 1\]/.test(line) && (!cur || cur.attempts > 0)) { push(); cur = fresh(t); }
    if (!cur) continue;
    cur.end = t;
    if (/\[attempt \d+\]/.test(line)) cur.attempts++;
    const ans = line.match(/\[gate\] .* answered in (\d+)ms/);
    if (ans) cur.gateMs += +ans[1];
    const bad = line.match(/\[gate\] .* failed after (\d+)ms/);
    if (bad) { cur.gateMs += +bad[1]; cur.gateFail++; }
    if (/\[require\]/.test(line)) cur.require++;
    if (/\[echo\]/.test(line)) cur.echo++;
    /* Task 2's per-phase lines. Absent until then, and absent on old rows
     * forever, so everything above has to keep working without them. */
    const ph = line.match(/\[phase\] (\w+) (\d+)ms/);
    if (ph) cur.phases[ph[1]] = (cur.phases[ph[1]] || 0) + +ph[2];
  }
  push();
  return out;
}

const api = { parseTurns: parseTurns };
if (typeof module !== "undefined" && module.exports) module.exports = api;

if (process.argv.indexOf("--selftest") === -1) {
  let buf = "";
  process.stdin.on("data", (d) => { buf += d; });
  process.stdin.on("end", () => {
    /* A turn longer than ten minutes is a device that slept mid-turn, not a
     * slow turn. Dropped rather than winsorised so the count is honest about
     * what it dropped. */
    const all = parseTurns(buf);
    const turns = all.filter(t => t.end > t.start && t.end - t.start < 600000);
    if (!turns.length) return console.log("no turns found on stdin");
    const dur = turns.map(t => t.end - t.start).sort((a, b) => a - b);
    const q = (p) => dur[Math.min(dur.length - 1, Math.floor(dur.length * p))];
    const s = (ms) => (ms / 1000).toFixed(1) + "s";
    const sum = (f) => turns.reduce((a, t) => a + f(t), 0);
    console.log(turns.length + " turns (" + (all.length - turns.length) + " dropped as > 10 min)");
    console.log("  wall      median " + s(q(.5)) + "   p75 " + s(q(.75)) +
                "   p90 " + s(q(.9)) + "   max " + s(dur[dur.length - 1]));
    console.log("  gate      " + s(sum(t => t.gateMs) / turns.length) + " a turn, " +
                (100 * sum(t => t.gateMs) / sum(t => t.end - t.start)).toFixed(0) + "% of wall");
    console.log("  attempts  mean " + (sum(t => t.attempts) / turns.length).toFixed(2) +
                "   >1 on " + (100 * turns.filter(t => t.attempts > 1).length / turns.length).toFixed(0) + "%");
    console.log("  retries   gate-fail " + sum(t => t.gateFail) +
                "   require " + sum(t => t.require) + "   echo " + sum(t => t.echo));
    const names = [...new Set(turns.flatMap(t => Object.keys(t.phases)))];
    if (names.length) {
      console.log("  phases (mean a turn):");
      for (const n of names)
        console.log("    " + n.padEnd(10) + s(sum(t => t.phases[n] || 0) / turns.length));
    }
  });
}

if (process.argv.indexOf("--selftest") !== -1) {
  const FIX = [
    "01:03:22.852     [plan] 别怕。",
    "01:03:24.827     [attempt 1] 别怕。 []",
    "01:03:26.668     [gate] teach answered in 1841ms",
    "01:03:51.965  W  [gate] glm failed after 25296ms, passing the turn: Error: x",
    "01:03:51.968     [require] 而且",
    "01:03:53.981     [attempt 2] 别怕，而且走。 []",
    "01:03:56.129     [gate] teach answered in 2147ms"
  ].join("\n");
  const t = api.parseTurns(FIX);
  let pass = 0, fail = 0;
  const check = (ok, label) => ok ? pass++ : (fail++, console.log(" FAIL " + label));
  check(t.length === 1, "one turn");
  check(t[0].attempts === 2, "two attempts, got " + (t[0] || {}).attempts);
  check(t[0].gateMs === 1841 + 25296 + 2147, "gate ms summed, got " + (t[0] || {}).gateMs);
  check(t[0].gateFail === 1, "one failed gate call");
  check(t[0].require === 1, "one require retry");
  check(t[0].end - t[0].start === 33277, "wall span, got " + (t[0].end - t[0].start));
  console.log("turn-latency selftest: " + (fail ? fail + " FAILED" : "ok"));
  process.exit(fail ? 1 : 0);
}
