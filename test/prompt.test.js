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
check(/第 11 条|除外/.test(rule1), "rule 1 carves out an exception when words are on offer", rule1);
const plain1 = P.build({ level: 1, label: "HSK 1", length: "short" })
  .split("\n").find(l => l.startsWith("1. "));
check(!/除外/.test(plain1), "and stays absolute when nothing is on offer", plain1);
check(offered.includes("让、但"), "the offered words are named");
check(/请用/.test(offered.split("\n").find(l => l.includes("学生现在可以学一个新词"))),
  "the offer asks for a word rather than merely permitting one");

/* 9. Forcing. When the offer has been declined too often the word becomes a
 *    condition rather than a suggestion, and the wording has to stop hedging. */
const forced = P.build({ level: 1, label: "HSK 1", length: "short",
  offer: [{ w: "让" }, { w: "但" }], require: "让" });
// Found by content, not by number: the offer rule's position shifts
// whenever a rule is inserted above it, which is exactly what happened here.
const rule10 = forced.split("\n").find(l => l.includes("一定要用「"));
check(/一定要用/.test(rule10) && rule10.includes("让"), "the required word is demanded", rule10);
check(!/都不用/.test(rule10), "and the escape clause is gone", rule10);
check(!rule10.includes("但"), "only the one word is named, so there is no ambiguity", rule10);
check(/除外/.test(forced.split("\n").find(l => l.startsWith("1. "))),
  "rule 1 still grants the exception while forcing");

/* Grammar correction. Restating a fixed version of what the student meant is
 * a different failure mode from echoing (rule 6): an echo hands back the
 * student's sentence unchanged, a correction restates it fixed and then the
 * conversation continues. Both must survive together in the same prompt. */
for (const n of levels) {
  const p = P.build({ level: n, label: "HSK " + n, length: "short" });
  check(/语法或者用词不对/.test(p), `L${n}: has a grammar-correction rule`);
  check(/只能用学生已经会的词/.test(p), `L${n}: the correction must use only known words`);
  check(/回答他，别只纠正不回答/.test(p), `L${n}: correcting must not replace answering`);
}

/* Rule numbering must never collide or run out of order -- inserting the
 * correction rule above is exactly the kind of change that broke it before. */
for (const n of levels) {
  const nums = P.build({ level: n, label: "HSK " + n, length: "short", script: "trad",
    offer: [{ w: "让" }], reuse: [{ w: "但" }] })
    .split("\n").filter(l => /^\d+\./.test(l)).map(l => parseInt(l, 10));
  check(nums.length >= 10, `L${n}: has all the fixed rules plus the conditional ones`);
  check(nums.every((v, i) => v === i + 1), `L${n}: numbered 1..N with no gaps or repeats`,
    nums.join(","));
}

/* 10. HSK 0.5 is a first-week level: it must be a strict subset of HSK 1 and
 *     its grammar rule must be stricter, or it is not a lower level at all. */
const l0 = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/hsk0.json"), "utf8"));
const l1w = new Set(JSON.parse(
  fs.readFileSync(path.join(__dirname, "../data/hsk1.json"), "utf8")).map(e => e.w));
check(l0.length === 150, `HSK 0.5 has 150 words (${l0.length})`);
check(["猫", "狗", "苹果", "怎么样", "火车站"].every(w => l0.some(e => e.w === w)),
  "it is the old HSK 1.0 syllabus, including the words HSK 3.0 moved up");
check(l0.every(e => l1w.has(e.w)), "HSK 0.5 is a strict subset of HSK 1");
check(["谢谢", "再见", "名字", "不客气"].every(w => l0.some(e => e.w === w)),
  "the words a first lesson teaches are present");
check(/不要用「了」/.test(P.LEVEL_STYLE[0].grammar),
  "HSK 0.5 bans 了, which HSK 1 allows", P.LEVEL_STYLE[0].grammar);
check(P.LEVEL_STYLE[0].vocab !== P.LEVEL_STYLE[1].vocab, "and has its own vocabulary rule");

/* 11. Every prompt must ask for a reply, not just impose limits. With only
 *     constraints, the cheapest way to obey them all is to echo the student. */
for (const n of levels) {
  const p = P.build({ level: n, label: "HSK " + n, length: "short" });
  check(/先回答学生说的话/.test(p), `L${n}: asks the partner to answer what was said`);
  check(/不要把学生的话重复一遍/.test(p), `L${n}: forbids repeating it back`);
  check(/学生刚问过的问题，不要再问他/.test(p), `L${n}: forbids asking the question back`);
}
check(P.build({ level: 0, label: "HSK 0.5", length: "short" }).includes("我很喜欢。我喜欢喝水。"),
  "and shows a worked example of answering rather than echoing");

// 12. An unknown level must not produce a prompt with no constraints at all.
check(P.styleFor(99) === P.LEVEL_STYLE[1], "unknown level falls back to the strictest profile");

/* 13. Translation and explanation. The `own` shapes exist because the student's
 *     own sentence may be wrong; a prompt that treats it as correct explains a
 *     mistake instead of catching it, which is the one thing these must not do. */
const SENT = "我昨天去公园了";
const reply = { text: SENT, label: "HSK 2", recent: "" };
const mine = { text: SENT, own: true, label: "HSK 2", recent: "" };

for (const opts of [reply, mine]) {
  const t = P.translate(opts), e = P.explain(opts);
  const which = opts.own ? "own" : "reply";
  check(t.includes(SENT) && e.includes(SENT), `${which}: both prompts carry the sentence`);
  check(/only the translation/.test(t), `${which}: translate asks for the translation alone`);
  check(/not restricted to the student's vocabulary/.test(e),
    `${which}: explain is exempt from the word list`);
}

// The reply prompts must not have picked up the hedging the own ones need:
// told a known-good sentence may be wrong, a model invents faults to report.
check(!/may contain mistakes|may well be wrong/.test(P.translate(reply) + P.explain(reply)),
  "a reply is not described as possibly wrong");
check(/may contain mistakes/.test(P.translate(mine)), "own: translate says it may be wrong");
check(/not a corrected version/.test(P.translate(mine)),
  "own: translate renders what was written, not a repair of it");
/* Found against a live model, not by reading the prompt: asked only to
 * translate what was written and to let it read oddly, it stopped translating
 * and started glossing, and rendered the correct 我昨天去公园了 as "I yesterday
 * go park of". A sound sentence shown back as broken English invents a mistake
 * the student did not make, which is worse than the repair this is avoiding. */
check(/not a word-by-word gloss/.test(P.translate(mine)),
  "own: translate is told it is still a translation, not a gloss");
check(/if the Chinese is in fact correct/.test(P.translate(mine)),
  "own: a correct sentence must come back as natural English");
check(/may well be wrong/.test(P.explain(mine)), "own: explain says it may be wrong");
check(/do not manufacture a problem/.test(P.explain(mine)),
  "own: a correct sentence is allowed to be correct");
check(/corrected version/.test(P.explain(mine)) && /Name the rule/.test(P.explain(mine)),
  "own: explain asks for a correction and the rule behind it");
check(/homophone/.test(P.explain(mine)),
  "own: explain knows wrong characters come from pinyin input");

/* Output is the expensive side of the bill, and models decorate this answer
 * whether or not it is asked for. Naming what not to emit cut output 39% with
 * the catch rate unchanged; "concise" alone had not. Pinned because it is worth
 * real money and would be easy to tidy away as boilerplate. */
for (const p of [P.explain(mine), P.explain(reply)]) {
  check(/No headings, no bullet lists, no bold, no emoji/.test(p),
    "explain names the decoration it does not want");
  check(/Stop when the fourth is done/.test(p),
    "and tells it when to stop rather than only to be brief");
}

/* The turns leading up to the sentence. A learner line is often only judgeable
 * against what it answers -- 我也是 is fine after a statement and odd after a
 * question -- but the thing being checked is still the one sentence. */
const CTX = [{ role: "assistant", text: "你喜欢吃中国菜吗？" },
             { role: "user", text: "我是美国人。" }];
const withCtx = P.explain({ text: SENT, own: true, label: "HSK 2", recent: "", context: CTX });
check(/The conversation so far:/.test(withCtx), "own: context is labelled as context");
check(/Partner: 你喜欢吃中国菜吗？/.test(withCtx), "own: the partner's turn is attributed");
check(/Student: 我是美国人。/.test(withCtx), "own: and so is the student's");
check(withCtx.indexOf("The conversation so far:") < withCtx.indexOf("The student wrote:"),
  "own: context comes before the sentence it explains");
/* Last, not up with the level and recent words: it is background for reading
 * the sentence, not more material to comment on. */
check(withCtx.indexOf("The conversation so far:") > withCtx.indexOf("Recently introduced"),
  "own: but after the standing instructions, so it reads as background");
// No context is the first message of a conversation, and must not leave a stub.
check(!/The conversation so far/.test(P.explain(mine)),
  "own: no context means no empty context block");
check(!/The conversation so far/.test(
        P.explain({ text: SENT, own: true, label: "HSK 2", recent: "", context: [] })),
  "own: an empty context array is the same as none");
// The partner's own reply is known-good; it does not need the transcript.
check(!/The conversation so far/.test(
        P.explain({ text: SENT, own: false, label: "HSK 2", recent: "", context: CTX })),
  "reply: context is not added to the explain-the-partner prompt");

// Level and recent words reach both explain shapes: the whole point of the
// context block is that it can say which words are still new to this student.
for (const own of [false, true]) {
  const e = P.explain({ text: SENT, own: own, label: "HSK 3", recent: "公园（gōng yuán，park）" });
  check(e.includes("HSK 3"), `own=${own}: explain is told the level`);
  check(e.includes("公园（gōng yuán，park）"), `own=${own}: explain is told the recent words`);
  check(P.explain({ text: SENT, own: own, label: "HSK 3", recent: "" }).includes("none yet"),
    `own=${own}: an empty recent list reads as "none yet", not as blank`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
