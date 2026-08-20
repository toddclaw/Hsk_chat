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

/* Greedy maximum matching strands a character whenever a longer word starting
 * earlier wins the position -- with 不便 in the list, 不便宜 used to segment as
 * 不便 + 宜 and report 宜 as out of level. Only shows up on the larger lists. */
const wide = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk7.json"), "utf8"));
const wideLex = HSK.buildLexicon(wide);
for (const t of ["因为西瓜不便宜。", "这个问题很复杂。", "他的中文水平不错。"]) {
  const v = HSK.validate(t, wideLex).map(x => x.text);
  check(v.length === 0, `no stranded characters at HSK 7-9: ${t}`, "flagged: " + v.join(", "));
}
check(HSK.segment("不便宜", wideLex).map(t => t.text).join("|") === "不|便宜",
  "不便宜 segments as 不 + 便宜, not 不便 + 宜",
  HSK.segment("不便宜", wideLex).map(t => t.text).join("|"));

/* Model scaffolding: formatting wrapped around the answer rather than said.
 * It used to pass validation because brackets and digits counted as
 * punctuation, so a reply arrived on screen reading "[0.0:] 我喜欢听中文歌。" */
for (const c of fx.scaffold) {
  const got = HSK.stripScaffold(c.raw);
  check(got === c.clean, `scaffold: ${c.why}`, JSON.stringify(got) + " != " + JSON.stringify(c.clean));
}
check(HSK.validate("[0.0:] 我很好。", lex).length > 0,
  "unstripped brackets are a violation, not punctuation");
check(HSK.validate(HSK.stripScaffold("[0.0:] 我很好。"), lex).length === 0,
  "and stripping them leaves a clean reply");
check(HSK.isAscii("50%") && !HSK.isAscii("我"), "isAscii distinguishes the learner's own symbols");

/* Echoing. A partner under tight vocabulary and length limits can satisfy
 * every rule by handing the learner's question back -- 你喜欢喝茶吗？ answered
 * with 你喜欢喝吗？ -- which reads as not having understood a word of it. */
const l0lex = HSK.buildLexicon(
  JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk0.json"), "utf8")));
for (const c of fx.echo) {
  const got = HSK.echoesQuestion(c.reply, c.said, l0lex);
  check(got === c.echo, `echo (${c.echo ? "yes" : "no"}): ${c.why}`,
    `${c.reply} ← ${c.said}`);
}
check(HSK.contentWords("我也很喜欢喝茶。", l0lex).join() === ["喜欢", "喝", "茶"].join(),
  "content words drop the function words that say nothing about topic",
  HSK.contentWords("我也很喜欢喝茶。", l0lex).join());

const sug = HSK.suggest("想要", lex, 4).map(e => e.w);
check(sug.length > 0 && sug.every(w => /[想要]/.test(w)),
  "suggest: returns allowlist entries sharing a character", JSON.stringify(sug));

/* Every level file must be in the app's {w,p,d} shape and must validate against
 * itself: a raw upstream dump loads as a lexicon of zero words, and the app then
 * flags every character the model writes. Each entry must also round-trip, or the
 * loop burns retries on the list's own vocabulary. */
const levels = fs.readdirSync(path.join(__dirname, "../data"))
  .filter(f => /^hsk\d+\.json$/.test(f))
  .sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)));

check(levels.length > 0, "data/: at least one level file exists");

for (const file of levels) {
  const entries = JSON.parse(fs.readFileSync(path.join(__dirname, "../data", file), "utf8"));
  const shaped = Array.isArray(entries) && entries.every(e => e && typeof e.w === "string" && e.w);
  check(shaped, `${file}: converted to {w,p,d} (run tools/convert.py on raw dumps)`,
    shaped ? "" : "first entry: " + JSON.stringify(entries[0]).slice(0, 120));
  if (!shaped) continue;

  const l = HSK.buildLexicon(entries);
  let miss = 0;
  for (const e of entries) {
    if (HSK.validate(e.w, l).length) { miss++; if (miss < 4) console.log(`  ${file} self-check miss:`, e.w); }
  }
  check(miss === 0, `${file}: all ${entries.length} entries validate against their own list`, `${miss} failed`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
