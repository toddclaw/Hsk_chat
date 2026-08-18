/* Fixture tests for the validator. Run: node test/validator.test.js
 * Deliberately dependency-free -- no build step anywhere in this project. */
const fs = require("fs");
const path = require("path");
const HSK = require("../validator.js");

const words = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk1.json"), "utf8"));
const lex = HSK.buildLexicon(words);
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures.json"), "utf8"));

let pass = 0, fail = 0;
const bad = [];
function check(ok, label, detail) {
  if (ok) pass++;
  else { fail++; bad.push(label + (detail ? "\n    " + detail : "")); }
}

console.log(`lexicon: ${lex.words.size} entries, maxLen ${lex.maxLen}\n`);

for (const c of fx.good) {
  const v = HSK.validate(c.t, lex);
  check(v.length === 0, `good: ${c.t}  (${c.why})`,
    v.length ? "unexpected violations: " + v.map(x => x.text).join(", ") : "");
}

for (const c of fx.bad) {
  const got = HSK.validate(c.t, lex).map(x => x.text);
  const want = c.expect;
  const same = got.length === want.length && got.every((g, i) => g === want[i]);
  check(same, `bad: ${c.t}  (${c.why})`, `want [${want}] got [${got}]`);
}

for (const c of fx.spans) {
  const v = HSK.validate(c.t, lex);
  const same = v.length === c.violations.length && c.violations.every((w, i) =>
    v[i] && v[i].text === w.text && v[i].start === w.start && v[i].end === w.end);
  check(same, `spans: ${c.t}`, JSON.stringify(v.map(x => ({ text: x.text, start: x.start, end: x.end }))));
}

// Segmentation feeds the tap-to-gloss popover, so boundaries matter too.
const seg = HSK.segment("我今年二十三岁了。", lex).map(t => t.text);
check(JSON.stringify(seg) === JSON.stringify(["我", "今年", "二十三", "岁", "了", "。"]),
  "segment: 二十三 merges into one token", JSON.stringify(seg));

const sug = HSK.suggest("想要", lex, 4).map(e => e.w);
check(sug.length > 0 && sug.every(w => /[想要]/.test(w)),
  "suggest: returns allowlist entries sharing a character", JSON.stringify(sug));

// Every character of every allowlist entry must round-trip cleanly, or the
// loop will burn retries on the list's own vocabulary.
let selfFail = 0;
for (const e of words) {
  if (HSK.validate(e.w, lex).length) { selfFail++; if (selfFail < 6) console.log("  self-check miss:", e.w); }
}
check(selfFail === 0, `self-check: all ${words.length} entries validate against their own list`, `${selfFail} failed`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
