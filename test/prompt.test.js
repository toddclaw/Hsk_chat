/* The system prompt is data, so it can be checked like data. Run:
 *   node test/prompt.test.js
 *
 * The point of these: a prompt that demonstrates a word the validator will
 * reject teaches the model to fail, and every retry it causes looks like a
 * model problem rather than a prompt problem. */
const fs = require("fs");
const path = require("path");
const HSK = require("../validator.js");
const P = require("../prompt.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

const levels = Object.keys(P.LEVEL_STYLE).map(Number).sort((a, b) => a - b);
const lex = {};
for (const n of levels) {
  lex[n] = HSK.buildLexicon(
    JSON.parse(fs.readFileSync(path.join(__dirname, `../data/hsk${n}.json`), "utf8")));
}

// 1. Every worked sample is legal at the level that shows it.
for (const n of levels) {
  const v = HSK.validate(P.LEVEL_STYLE[n].sample, lex[n]).map(x => x.text);
  check(v.length === 0, `L${n}: sample validates at its own level`, "flagged: " + v.join(", "));
}

// 2. The samples actually climb. If an upper-level sample were legal at HSK 1
//    it would not be demonstrating anything the lower prompt does not.
for (const n of levels.filter(n => n >= 4)) {
  const v = HSK.validate(P.LEVEL_STYLE[n].sample, lex[1]);
  check(v.length > 0, `L${n}: sample is richer than HSK 1 allows`);
}

// 3. The grammar banlist shrinks with the level. 把 is HSK 3 grammar and 被 is
//    HSK 4, so forbidding them higher up forbids what the learner already met.
check(/不要用/.test(P.LEVEL_STYLE[1].grammar) && P.LEVEL_STYLE[1].grammar.includes("把"),
  "L1: 把 is banned");
check(P.LEVEL_STYLE[3].grammar.includes("可以用「把」"), "L3: 把 is unlocked");
check(P.LEVEL_STYLE[4].grammar.includes("可以用「被」"), "L4: 被 is unlocked");
for (const n of [5, 6, 7]) {
  check(!/不要用/.test(P.LEVEL_STYLE[n].grammar), `L${n}: no grammar bans remain`,
    P.LEVEL_STYLE[n].grammar);
}

// 4. Assembly: the level's own rules go in, the machinery survives, and the
//    wordlist appears only when asked for.
for (const n of levels) {
  const p = P.build({ level: n, label: "HSK " + n, length: "medium" });
  const s = P.LEVEL_STYLE[n];
  check(p.includes(s.vocab) && p.includes(s.grammar) && p.includes(s.sample),
    `L${n}: build() uses that level's vocab rule, grammar and sample`);
  check(p.includes("[[NEED:") && p.includes("不要用英文"),
    `L${n}: the NEED channel and the English rule survive`);
  check(!p.includes("你只可以用这些词"), `L${n}: no wordlist unless asked`);
}
const withList = P.build({ level: 1, label: "HSK 1", length: "short", words: "你 好 我" });
check(withList.includes("你只可以用这些词：\n你 好 我"), "with-list appends the allowlist");

// 5. Length is level-neutral, so the two axes compose instead of fighting.
for (const k of Object.keys(P.LENGTHS)) {
  const spec = P.LENGTHS[k];
  check(spec.maxTokens > 0 && spec.rule && spec.label, `${k}: complete length spec`);
  check(P.build({ level: 7, label: "HSK 7-9", length: k }).includes(spec.rule),
    `${k}: rule reaches the assembled prompt at any level`);
}
check(P.LENGTHS.short.maxTokens < P.LENGTHS.medium.maxTokens &&
      P.LENGTHS.medium.maxTokens < P.LENGTHS.long.maxTokens,
  "token ceilings increase with length");

// 6. Conversation starters must be sayable at the level that offers them. A
//    starter the app would immediately underline as out of level is worse than
//    offering nothing -- it teaches the learner a sentence they may not use.
for (const n of levels) {
  const list = P.startersFor(n);
  check(Array.isArray(list) && list.length >= 5, `L${n}: has starters`, JSON.stringify(list));
  for (const t of list) {
    const v = HSK.validate(t, lex[n]).map(x => x.text);
    check(v.length === 0, `L${n} starter validates: ${t}`, "flagged: " + v.join(", "));
  }
  check(list.every(t => /[？]$/.test(t)), `L${n}: every starter is a question`,
    list.filter(t => !/[？]$/.test(t)).join(" | "));
}
check(P.startersFor(99) === P.STARTERS[1], "unknown level falls back to HSK 1 starters");

/* 7. Traditional mode. The app converts its own Chinese word by word against
 *    the wordlist, so every sample and starter must still validate once
 *    converted -- otherwise the app hands the learner text its own validator
 *    rejects, which is the failure this suite exists to prevent. */
const tradLex = {}, tradMap = {};
for (const n of levels) {
  const entries = JSON.parse(
    fs.readFileSync(path.join(__dirname, `../data/hsk${n}.json`), "utf8"));
  tradLex[n] = HSK.buildLexicon(entries.map(e => e.t ? { w: e.t, p: e.p, d: e.d } : e));
  tradMap[n] = HSK.buildLexicon(entries);          // simplified keys, entries carry .t
}
const toTrad = (text, n) => HSK.segment(text, tradMap[n]).map(tok => {
  if (tok.kind !== "word") return tok.text;
  const e = tradMap[n].words.get(tok.text);
  return (e && e.t) || tok.text;
}).join("");

for (const n of levels) {
  const sample = toTrad(P.LEVEL_STYLE[n].sample, n);
  const v = HSK.validate(sample, tradLex[n]).map(x => x.text);
  check(v.length === 0, `L${n}: sample validates in traditional — ${sample}`,
    "flagged: " + v.join(", "));
  for (const t of P.startersFor(n)) {
    const conv = toTrad(t, n);
    const sv = HSK.validate(conv, tradLex[n]).map(x => x.text);
    check(sv.length === 0, `L${n} traditional starter validates: ${conv}`,
      "flagged: " + sv.join(", "));
  }
}
// The conversion has to actually do something, or the checks above are vacuous.
check(toTrad("我学习中文", 1) === "我學習中文", "conversion is word-level and real",
  toTrad("我学习中文", 1));
// Assert on the rule, not its number: numbering is presentation and shifts
// whenever a rule is added.
check(P.build({ level: 1, label: "HSK 1", length: "short", script: "trad" }).includes("繁体字"),
  "traditional mode adds the write-in-traditional rule");
check(!P.build({ level: 1, label: "HSK 1", length: "short" }).includes("繁体字"),
  "simplified mode does not");
// Every prompt tells the model not to wrap its answer in scaffolding.
for (const n of levels) {
  check(P.build({ level: n, label: "HSK " + n, length: "short" }).includes("[0.0:]"),
    `L${n}: warns against timestamps and brackets`);
}
// The rules the model reads must be numbered in order.
const numbered = P.build({ level: 1, label: "HSK 1", length: "short", script: "trad",
  offer: [{ w: "让" }], reuse: [{ w: "但" }] })
  .split("\n").filter(l => /^\d+\./.test(l)).map(l => parseInt(l, 10));
check(numbered.every((n, i) => i === 0 || n > numbered[i - 1]),
  "rules are numbered in ascending order", numbered.join(","));

/* 8. The offer must not contradict the vocabulary rule. Left absolute, rule 1
 *    forbids exactly what the offer permits, and a model obeying the rule
 *    stated first ignores the offer every turn -- which is what happened. */
const offered = P.build({ level: 1, label: "HSK 1", length: "short",
  offer: [{ w: "让" }, { w: "但" }] });
const rule1 = offered.split("\n").find(l => l.startsWith("1. "));
check(/第 10 条|除外/.test(rule1), "rule 1 carves out an exception when words are on offer", rule1);
const plain1 = P.build({ level: 1, label: "HSK 1", length: "short" })
  .split("\n").find(l => l.startsWith("1. "));
check(!/除外/.test(plain1), "and stays absolute when nothing is on offer", plain1);
check(offered.includes("让、但"), "the offered words are named");
check(/请用/.test(offered.split("\n").find(l => l.startsWith("10. "))),
  "the offer asks for a word rather than merely permitting one");

// 9. An unknown level must not produce a prompt with no constraints at all.
check(P.styleFor(99) === P.LEVEL_STYLE[1], "unknown level falls back to the strictest profile");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
