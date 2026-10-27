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
/* HSK 1 rather than the old local HSK 0.5 band, which is gone: the fixtures
 * are echo cases, and the tightest real level is where echoing is most
 * tempting for a model with the least vocabulary to work with. */
const l0lex = HSK.buildLexicon(
  JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk1.json"), "utf8")));
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

/* Levels must nest: a word met at HSK 1 stays legal at HSK 4, or advancing
 * would silently take vocabulary away. The syllabus lists some words at two
 * bands for different senses (半 at 1 and 4), so tools/convert.py assigns each
 * word its earliest band and builds every file cumulatively. This is what
 * keeps that true. */
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
// 起走 is the span a tight level flags: 我0 喜1 欢2 跟3 狗4 一5 起6 走7
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

/* Place names get the same pass, for the same reason and with a narrower rule.
 *
 * The syllabus has essentially no cities: 北京 and 上海 are absent from every
 * list including the 10,896-word HSK 7-9 reference, and only 中国 survives at
 * HSK 1. So a reply saying where someone lives cannot be repaired into the
 * level -- the loop rewrites it until the attempts run out. Measured at HSK 6
 * in the prompt-mode A/B, 杭 was the single largest violation (x9, every one
 * of them 我家在杭州) and removing that one character reversed the sign of the
 * whole comparison. The app provokes it itself: 你的家在哪儿？ is a shipped
 * HSK 1 starter. */
for (const t of ["我家在杭州。", "我家在北京。", "我家在上海。", "我家在香港。",
                 "我家在河南省。", "我去过杭州。"]) {
  const v = HSK.validate(t, lex);
  check(v.length > 0 && v.every(x => x.name), `place: ${t} is marked, not repaired`,
    JSON.stringify(v.map(x => ({ t: x.text, name: !!x.name }))));
}

/* Both conditions are required, and each test below fails if either is dropped.
 * A classifier with no preposition is ordinary vocabulary: 节省 is a word the
 * learner should have repaired, not a province. */
check(HSK.validate("我要节省钱。", lex).every(v => !v.name),
  "a classifier without a location preposition is not a place",
  JSON.stringify(HSK.validate("我要节省钱。", lex).map(x => ({ t: x.text, name: !!x.name }))));
check(HSK.validate("我喜欢咖啡。", lex).every(v => !v.name),
  "an ordinary out-of-level word is still repaired");
check(HSK.validate("他在跑步。", lex).every(v => !v.name),
  "a preposition without a classifier is not a place either -- 在 is also the progressive");

// The mark is scoped to the place; a hard word elsewhere still forces a repair.
const mixedPlace = HSK.validate("我家在杭州，我喜欢咖啡。", lex);
check(mixedPlace.some(v => !v.name), "a hard word alongside a place is still repaired",
  JSON.stringify(mixedPlace.map(x => ({ t: x.text, name: !!x.name }))));

/* An in-level word can never be swallowed however generous the rule gets --
 * validate() filters to bad/latin before marking anything, so 中国 is a `word`
 * and never a candidate. This is the structural answer to "the filter must not
 * eat words the learner is supposed to know". */
check(HSK.validate("我家在中国。", lex).length === 0,
  "中国 is in HSK 1, so it is never a violation and never markable");

/* Known false positive, pinned deliberately rather than left to be discovered:
 * 在 is also the progressive marker, so a verb ending in a classifier reads as
 * a place. The cost is one word glossed instead of repaired -- the same cost a
 * wrong person-name span already carries. If a real conversation shows it
 * mattering, narrowing PLACE_SUFFIX is a one-line change. */
check(HSK.validate("他在反省。", lex).every(v => v.name),
  "documented limitation: 在 + a verb ending in a classifier is read as a place");

/* At HSK 6 the SAME name splits the other way: 州, 海, 市, 省 and 岛 are
 * themselves HSK 6 words, so 杭州 arrives as 杭[bad] + 州[word] rather than one
 * bad run. HSK 6 is the level the A/B that found this measured -- a rule that
 * only looked at the run's last character fixed HSK 1 and left the measured
 * case burning a retry, which a HSK-1-only fixture would never have shown. */
const lex6 = HSK.buildLexicon(
  JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk6.json"), "utf8")));
for (const t of ["我家在杭州。", "我家在香港。", "我住在北京。"]) {
  check(HSK.validate(t, lex6).every(v => v.name),
    `place at HSK 6, where the classifier is in-level: ${t}`,
    JSON.stringify(HSK.validate(t, lex6).map(x => ({ t: x.text, name: !!x.name }))));
}
check(HSK.validate("我喜欢咖啡。", lex6).every(v => !v.name),
  "and an ordinary out-of-level word at HSK 6 is still repaired");

/* Second known miss, pinned for the same reason as the first: only the place
 * next to the preposition is excused, so the second city in a conjunction still
 * costs a retry. Same family as the bare mention (杭州很大, 我是杭州人) this rule
 * was deliberately scoped not to chase -- widening it to reach 和北京 means
 * dropping the preposition condition, which is what keeps ordinary vocabulary
 * being repaired. */
const conj = HSK.validate("我去过杭州和北京。", lex6);
check(conj.some(v => v.name) && conj.some(v => !v.name),
  "documented limitation: in 杭州和北京 only the first place is excused",
  JSON.stringify(conj.map(x => ({ t: x.text, name: !!x.name }))));

/* The partner re-telling the story it has already told. Fixtures are real
 * segments out of the app's own database; `dropped` is how many paragraphs of
 * each reply the learner had already read. */
for (const c of fx.repeats.cases) {
  const got = HSK.dropRepeated(c.text, c.prior);
  check(got.dropped.length === c.dropped, `repeat: ${c.why}`,
    `want ${c.dropped} dropped, got ${got.dropped.length}`);
  // What survives must be intact units of the original, never a splice.
  const parts = c.text.split(/\n+/).map(x => x.trim()).filter(Boolean);
  check(got.text.split(/\n+/).every(k => parts.includes(k.trim())),
    `repeat: what is kept is whole units (${c.why})`);
  if (c.keeps) {
    check(got.text.trim() === c.keeps, `repeat: keeps exactly the new text (${c.why})`,
      JSON.stringify(got.text.trim()));
  }
}

/* The leading-run rule, which is what makes this safe to apply outside story
 * time. Stale text at the FRONT is the failure; a unit that recurs in the
 * middle of a reply is ordinary conversation. Both directions are pinned
 * because getting the second one wrong deletes the partner's answer. */
{
  /* Units need a few characters each: the comparison is on Han BIGRAMS, so a
   * one-character line has none and can never match anything. */
  const stale = "我喜欢喝茶。", fresh = "你今天去哪儿？", tail = "明天见面吧。";
  const got = HSK.dropRepeated(stale + "\n" + fresh + "\n" + tail, [stale, tail]);
  check(got.dropped.length === 1,
    "repeat: drops the stale FRONT and stops at the first new unit",
    JSON.stringify(got.dropped));
  check(got.text === fresh + "\n\n" + tail,
    "repeat: a repeated unit AFTER the first new one is kept, not spliced out",
    JSON.stringify(got.text));
}
check(HSK.dropRepeated("新的话。\n旧的话。", ["旧的话。"]).dropped.length === 0,
  "repeat: a reply whose first unit is new is never trimmed at all");

/* The threshold is set from these two populations and is worth pinning: the
 * repeats were REWORDED, so equality misses them, and the story's own distinct
 * paragraphs share a cast and a setting, so a loose threshold eats them. On the
 * measured story they land at 0.88-1.00 and 0.07-0.15 respectively. */
{
  const oct = fx.repeats.cases[2];                       // the four-paragraph re-tell
  const paras = oct.text.split(/\n+/).map(x => x.trim()).filter(Boolean);
  /* Not an equality test: the paragraph that gets dropped from the October
   * re-tell is NOT byte-identical to the one already read -- 经过了很多商店 had
   * become 路上看到了很多商店 in passing. Equality would have missed it. */
  const reworded = fx.repeats.cases[1];                  // M0801 against M0800
  const gone = HSK.dropRepeated(reworded.text, reworded.prior).dropped[0];
  check(gone && gone !== reworded.prior[0].trim(),
    "repeat: the caught paragraph is reworded, not identical -- so equality would miss it",
    gone ? "identical to prior" : "nothing dropped");
  // Distinct paragraphs of one story must survive each other pairwise.
  let eaten = 0;
  paras.forEach((a, i) => paras.forEach((b, j) => {
    if (i !== j && HSK.dropRepeated(a, [b]).dropped.length) eaten++;
  }));
  check(eaten === 0,
    "repeat: distinct paragraphs of the same story do not match each other",
    `${eaten} pair(s) crossed REPEAT_SIM = ${HSK.REPEAT_SIM}`);
}

/* Two things keep an ordinary chat turn safe, and neither is a length cutoff.
 *
 * A one-paragraph reply can never be trimmed at all: with nothing left over the
 * drop fails open. Only a reply that is part stale and part new is touched,
 * which is the story shape and not the chat shape. */
check(HSK.dropRepeated("我也喜欢喝茶。", ["我也喜欢喝茶。"]).dropped.length === 0,
  "repeat: a one-paragraph reply is never trimmed, even word for word");
check(HSK.dropRepeated("我也喜欢喝茶。\n\n你喝咖啡吗？", ["我也喜欢喝茶。"]).dropped.length === 1,
  "repeat: a stale paragraph beside a new one does go, at any length");
/* And a short reply does not reach the threshold on rewording alone. The worry
 * was that few bigrams would collide by accident; 我也喜欢喝茶 against
 * 我也很喜欢喝茶 scores 0.57, under the bar, so the accident does not happen. */
check(HSK.dropRepeated("我也很喜欢喝茶。\n\n你喝咖啡吗？", ["我也喜欢喝茶。"]).dropped.length === 0,
  "repeat: a reworded SHORT reply stays below the threshold, so chat is untouched");
/* Same text, single newline: the separator must not decide the outcome. */
check(HSK.dropRepeated("我也喜欢喝茶。\n你喝咖啡吗？", ["我也喜欢喝茶。"]).dropped.length === 1,
  "repeat: a single newline separates units just as a blank line does");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
