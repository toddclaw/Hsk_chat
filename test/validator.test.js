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

/* Levels must nest. HSK 1.0 and HSK 3.0 disagree about 14 words -- 猫, 苹果,
 * 怎么样, 火车站 among them -- and without nesting a learner moving from HSK 0.5
 * to HSK 1 would lose vocabulary they had been using. tools/nest_levels.py
 * carries lower levels upward; this is what keeps it true. */
const ordered = levels.slice().sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)));
let below = null;
for (const file of ordered) {
  const words = new Set(JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data", file), "utf8")).map(e => e.w));
  if (below) {
    const lost = [...below.words].filter(w => !words.has(w));
    check(lost.length === 0, `${file} contains everything in ${below.file}`,
      "would lose: " + lost.slice(0, 8).join(" "));
  }
  below = { file: file, words: words };
}

/* Word boundaries for what the learner just met. The level's own lexicon cuts
 * in the wrong place -- it only knows that level's words -- so the reference
 * dictionary decides. Getting this wrong stores a fragment as a word AND
 * legalises it, so the partner starts using it back. */
const refLex = HSK.buildLexicon(
  JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk7.json"), "utf8")));
for (const c of fx.boundaries) {
  const lvl = HSK.buildLexicon(
    JSON.parse(fs.readFileSync(path.join(__dirname, `../data/hsk${c.level}.json`), "utf8")));
  const learned = [];
  HSK.validate(c.t, lvl).filter(v => v.kind === "bad" && !HSK.isAscii(v.text))
    .forEach(v => HSK.wordsAt(c.t, v.start, v.end, refLex).forEach(w => learned.push(w)));
  const same = learned.length === c.learn.length &&
    c.learn.every(w => learned.includes(w));
  check(same, `boundaries at HSK ${c.level}: ${c.t}`,
    `want [${c.learn}] got [${learned}] — ${c.why}`);
}
// 起走 is the span HSK 0.5 flags: 我0 喜1 欢2 跟3 狗4 一5 起6 走7
check(HSK.wordsAt("我喜欢跟狗一起走。", 6, 8, refLex).join() === "一起,走",
  "the reported case resolves to 一起 and 走, never the fragment 起走",
  HSK.wordsAt("我喜欢跟狗一起走。", 6, 8, refLex).join());
check(HSK.splitRun("托德", refLex).join() === "托德",
  "an unknown run stays whole rather than becoming single characters");
check(HSK.wordsAt("因为苹果", 0, 4, refLex).join() === "因为,苹果",
  "a run holding two words is still split into both",
  HSK.wordsAt("因为苹果", 0, 4, refLex).join());

/* Names. The app's own HSK 1 starter asks 你叫什么名字？, so a reply that gives
 * no name is not really an answer -- but 明, 王 and 李 are all above HSK 1, and
 * before this every name the model tried was rejected until the repair attempts
 * ran out. Names are marked, not dropped: the repair loop skips them, while the
 * learner's new-words list is built from the same violations and still shows
 * them. */
for (const t of ["我叫小明。", "我叫小王。", "我叫李老师。", "他姓张。", "我叫王小明。"]) {
  const v = HSK.validate(t, lex);
  check(v.length > 0 && v.every(x => x.name), `name: ${t} is marked, not repaired`,
    JSON.stringify(v.map(x => ({ t: x.text, name: !!x.name }))));
}

// The mark is scoped to the name; a hard word elsewhere still forces a repair.
const mixed = HSK.validate("我叫小明，我喜欢咖啡。", lex);
check(mixed.some(v => !v.name), "a hard word alongside a name is still repaired",
  JSON.stringify(mixed.map(x => ({ t: x.text, name: !!x.name }))));

// 叫 is not always an introduction, and the real parse must survive untouched.
check(HSK.validate("你叫什么名字？", lex).length === 0,
  "你叫什么名字？ still parses as 什么 + 名字 rather than a bogus name");
check(HSK.nameSpans("你叫什么名字？").length === 1,
  "a span is proposed after 叫 even when the characters turn out to be real words");

// English is a rule break rather than a name to read, so it is never marked.
check(HSK.validate("我叫John。", lex).some(v => v.kind === "latin" && !v.name),
  "a latin name is still an unmarked violation");

// A span stops at punctuation and never runs past NAME_MAX characters.
check(HSK.nameSpans("我叫小明。你好").every(([a, b]) => b - a <= 3),
  "a name span never exceeds 3 characters");
check(HSK.nameSpans("我叫。").length === 0,
  "no span is opened when punctuation follows immediately");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
