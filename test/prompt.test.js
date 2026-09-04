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

/* 10. The bands are the official HSK 3.0 syllabus now, and the counts are load
 *     bearing: README.md and RESEARCH.md both reason in them, and the app's
 *     progress panel is arithmetic over their sizes. The local "HSK 0.5" band
 *     (the old HSK 1.0 syllabus wedged in below band 1) is gone.
 *
 *     Cumulative, and smaller than the syllabus's own per-band sums, because a
 *     word listed at two bands for two senses is counted once at the earlier
 *     one -- 300 / 504 / 1011 raw becomes 300 / 497 / 988 deduplicated. */
const CUMULATIVE = [300, 497, 988, 1978, 3557, 5334, 10896];
CUMULATIVE.forEach((want, i) => {
  const n = i + 1;
  const got = JSON.parse(
    fs.readFileSync(path.join(__dirname, `../data/hsk${n}.json`), "utf8")).length;
  check(got === want, `HSK ${n} ships ${want} words`, `got ${got}`);
});
check(!fs.existsSync(path.join(__dirname, "../data/hsk0.json")),
  "and the invented HSK 0.5 band is gone");
check(!(0 in P.LEVEL_STYLE) && !(0 in P.STARTERS),
  "with no prompt or starters left behind for it");

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
check(/corrected sentence/.test(P.explain(mine)) && /Name the\s+rule/.test(P.explain(mine)),
  "own: explain asks for a correction and the rule behind it");
/* Verdict first, and permission to stop there. The old shape asked for four
 * numbered paragraphs whatever the answer, so a correct sentence still got
 * four -- which reads as though something must be wrong with it -- and the
 * first of them re-translated the sentence, duplicating the button sitting
 * next to this one. */
/* The three verdicts are given as literal lines to emit, not described. When
 * they were described ("say which of three it is: natural at their level...")
 * the model echoed the description back verbatim, third person and all, so the
 * learner was told "natural Chinese at their level" -- a note about them,
 * addressed to somebody else. */
for (const verdict of ["Natural.", "Understandable, but not how a native speaker would say it.",
                       "Not correct."]) {
  check(P.explain(mine).includes(verdict),
    `own: the verdict "${verdict}" is quoted, not described`);
}
check(!/at their level; /.test(P.explain(mine)),
  "own: no third-person verdict wording for the model to echo back");
check(/Start with exactly one of these three lines/.test(P.explain(mine)),
  "own: the verdict comes first, not after a translation");
check(/stop immediately/.test(P.explain(mine)),
  "own: a correct sentence is allowed a one-line answer");
check(/Judge idiom, not only grammar/.test(P.explain(mine)),
  "own: the middle verdict is about idiom, or it never fires");

/* A follow-up needs a different system message. The verdict shape is an
 * instruction to emit one of three lines and stop, and it lives in the SYSTEM
 * role -- so it stays in force for the whole chat. Reported: asked "what about
 * the 现在 and the 了?", the model answered "Natural." again. It was obeying. */
// Local rather than CTX, which is declared further down this file.
const askedAbout = [{ role: "assistant", text: "你今天吃饭了吗？" }];
const followUp = P.explain({ text: SENT, own: true, label: "HSK 2", recent: "",
                             context: askedAbout, followUp: true });
check(!/Start with exactly one of these three lines/.test(followUp),
  "own: a follow-up is not made to answer in the verdict shape");
check(!/stop immediately/.test(followUp),
  "and is not told to stop after one line");
check(/Answer their question directly/.test(followUp),
  "it is told to answer the question instead");
check(/say plainly why it is correct/.test(followUp),
  "and to justify a pass rather than merely restate it -- which is what was asked for");
check(/something you missed, say so/.test(followUp),
  "and to concede when the student has spotted something");
// Everything that is not the shape must survive into the follow-up.
check(followUp.includes("HSK 2") && /homophone/.test(followUp) &&
      /No headings, no bullet lists/.test(followUp),
  "the level, the homophone note and the formatting rules all survive");
check(/The conversation so far/.test(followUp),
  "and so does the turn being answered");
check(/Start with exactly one of these three lines/.test(P.explain(
        { text: SENT, own: true, label: "HSK 2", recent: "", context: askedAbout })),
  "while the first pass still gets the verdict shape");
check(!/What it actually says in English/.test(P.explain(mine)),
  "own: the grammar check does not re-translate -- that is the other button");
check(!/numbered 1 to 4/.test(P.explain(mine)),
  "own: no fixed four-part shape to pad out");
check(/numbered 1 to 4/.test(P.explain(reply)),
  "reply: the explanation keeps its four-part shape");
check(/homophone/.test(P.explain(mine)),
  "own: explain knows wrong characters come from pinyin input");

/* Output is the expensive side of the bill, and models decorate this answer
 * whether or not it is asked for. Naming what not to emit cut output 39% with
 * the catch rate unchanged; "concise" alone had not. Pinned because it is worth
 * real money and would be easy to tidy away as boilerplate. */
for (const p of [P.explain(mine), P.explain(reply)]) {
  check(/No headings, no bullet lists, no bold, no emoji/.test(p),
    "explain names the decoration it does not want");
  check(/Stop when the fourth is done|stop immediately/.test(p),
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

/* 11. The grader. Its answer is parsed rather than read, and its tags feed a
 *     mistake ledger and any drill built on one, so the parts that have to be
 *     exact are checkable here rather than only against a model. */
const G = P.grade({ label: "HSK 2", text: SENT, recent: "",
                    context: [{ role: "assistant", text: "你好吗？" }] });

check(/only a JSON object/.test(G) && /"cats"/.test(G) && /"errors"/.test(G),
  "grade asks for the object the app parses");
check(/may well be wrong/.test(G),
  "grade is told the sentence may be wrong, like explain");
check(/do not manufacture a problem/.test(G),
  "and told not to invent faults in a correct sentence");
check(/homophone/.test(G), "grade knows wrong characters come from pinyin input");

// Every tag must reach the prompt with its example: measured, the examples are
// what took tag accuracy from 3/6 to 7/7.
check(P.ERROR_TAGS.length === 17, `seventeen tags (${P.ERROR_TAGS.length})`);
for (const t of P.ERROR_TAGS) {
  check(G.includes(t), `grade lists the tag ${t}`);
  check(!!P.TAG_LABEL[t], `${t} has a label for the mistake list`);
}
check((G.match(/e\.g\. /g) || []).length === P.ERROR_TAGS.length,
  "every tag carries a worked example, not just a gloss");
check(/not tags/.test(G),
  "and the prompt says the category names are not tags -- the model reached for them");
check(/names the RULE that was broken/.test(G),
  "tags name the rule broken, not the edit made");

/* The four categories are the icons the detail view shows; each is a different
 * repair, which is why naturalness is not folded into grammar. */
check(P.GRADE_CATS.length === 4, "four categories");
check(P.GRADE_CATS.map(c => c.key).join(",") === "word,grammar,order,natural",
  "word, grammar, order, natural", P.GRADE_CATS.map(c => c.key).join(","));
for (const c of P.GRADE_CATS) {
  check(!!c.label && !!c.zh, `category ${c.key} has an English and a Chinese label`);
  check(P.ERROR_TAGS.indexOf(c.key) === -1,
    `category ${c.key} is not also a tag -- that collision is what leaked`);
}

// Context reaches the grader for the same reason it reaches the grammar check:
// 我也是 is correct or nonsense depending on what it answers.
/* Anchored on "The student wrote:" with its colon. Without it the match lands
 * on "The student wrote it THEMSELVES" near the top of the prompt, and the
 * ordering check passes or fails for the wrong reason. */
check(/The conversation so far/.test(G) &&
      G.indexOf("你好吗？") < G.indexOf("The student wrote:"),
  "grade sees the turn being answered, before the sentence itself");
check(!/The conversation so far/.test(
  P.grade({ label: "HSK 2", text: SENT, context: [] })),
  "and omits the block entirely when there is no context");
check(P.grade({ label: "HSK 5", text: SENT }).includes("HSK 5"),
  "grade is told the level, which bounds the correction it offers");

/* modeFor: "auto" is a rule for picking an arm, not an arm. The boundary is a
 * measured one (RESEARCH.md, "Whether the allowlist belongs in the prompt"), so
 * it is pinned here -- moving it silently would move the app's cost by an order
 * of magnitude at the top of the syllabus. */
check(P.modeFor("auto", 1) === "with-list", "auto puts the list in at HSK 1");
check(P.modeFor("auto", 3) === "with-list", "auto puts the list in at HSK 3");
check(P.modeFor("auto", 4) === "without-list", "auto drops the list at HSK 4");
check(P.modeFor("auto", 7) === "without-list", "auto drops the list at HSK 7-9");
check(P.AUTO_LIST_MAX_LEVEL === 3, "the measured boundary is 3");
for (const n of levels) {
  const m = P.modeFor("auto", n);
  check(m === "with-list" || m === "without-list",
    `L${n}: auto resolves to a real arm`, "got " + m);
}
// Pinning still pins: the Settings counters are only meaningful if it does.
for (const n of [1, 4, 7]) {
  check(P.modeFor("with-list", n) === "with-list", `L${n}: with-list stays pinned`);
  check(P.modeFor("without-list", n) === "without-list", `L${n}: without-list stays pinned`);
}
// An unknown or missing value must not silently become the expensive arm.
check(P.modeFor(undefined, 6) === "without-list", "a missing mode falls to the cheap arm at HSK 6");
check(P.modeFor("", 1) === "with-list", "an empty mode still resolves by level");

/* The arm has to reach the prompt: build() takes `words`, and the caller decides
 * whether to pass it. This asserts the two halves agree about what "with-list"
 * means -- that the allowlist genuinely appears only in that arm. */
const modeArmOn = P.build({ level: 1, label: "HSK 1", length: "short", words: "我 你 好" });
const modeArmOff = P.build({ level: 1, label: "HSK 1", length: "short", words: "" });
check(modeArmOn.includes("我 你 好"), "build puts the allowlist in when given one");
check(!modeArmOff.includes("我 你 好"), "and leaves it out when not");
check(modeArmOn.length > modeArmOff.length, "with-list is the longer prompt");

/* Activities. The contract is four fields because four is what varies: extra
 * rules, where the reuse list comes from, how generation is driven, and whether
 * the conversational turn-taking rules apply at all. */
const ACT_IDS = ["chat", "focused", "story", "twenty"];
for (const id of ACT_IDS) {
  const a = P.activityFor(id);
  check(!!a, `activity ${id} exists`);
  check(typeof a.label === "string" && a.label.length > 0, `activity ${id} has a label`);
  check(a.gen === "turn" || a.gen === "segments", `activity ${id} has a real gen`, a.gen);
  check(typeof a.converse === "boolean", `activity ${id} says whether it converses`);
}
check(P.activityFor("nope") === P.ACTIVITIES.chat, "an unknown activity falls back to chat");
check(P.activityFor(undefined) === P.ACTIVITIES.chat, "so does a missing one");
check(P.ACTIVITIES.chat.converse === true, "chat converses");
check(P.ACTIVITIES.story.converse === false, "story does not converse mid-narrative");
check(P.ACTIVITIES.story.gen === "segments", "story generates in segments");
check(P.ACTIVITIES.focused.reuse === "unused", "focused chat draws reuse from the unused list");

// The conversational rules must actually leave the prompt for story time.
const ASK_RULE = "\u6700\u540e\u95ee\u4e00\u4e2a\u65b0\u95ee\u9898";
const chatPrompt = P.build({ level: 1, label: "HSK 1", length: "short", activity: "chat" });
const storyPrompt = P.build({ level: 1, label: "HSK 1", length: "short", activity: "story",
                              storySegment: { index: 0, of: 5 } });
check(chatPrompt.includes(ASK_RULE), "chat keeps the ask-a-question rule");
check(!storyPrompt.includes(ASK_RULE), "story drops it -- a segment must not end by asking");
check(!storyPrompt.includes("\u4e0d\u8981\u628a\u5b66\u751f\u7684\u8bdd\u91cd\u590d\u4e00\u904d"),
  "story drops the echo rule too");
check(storyPrompt !== chatPrompt, "the two activities produce different prompts");

// Segment position has to reach the model, or every segment restarts the story.
const seg0 = P.build({ level: 1, label: "HSK 1", length: "short", activity: "story",
                       storySegment: { index: 0, of: 5 } });
const seg3 = P.build({ level: 1, label: "HSK 1", length: "short", activity: "story",
                       storySegment: { index: 3, of: 5 } });
const seg4 = P.build({ level: 1, label: "HSK 1", length: "short", activity: "story",
                       storySegment: { index: 4, of: 5 } });
check(seg0 !== seg3, "the first segment reads differently from a middle one");
check(seg3.includes("\u63a5\u7740"), "a middle segment is told to continue, not restart");
check(seg4.includes("\u6700\u540e"), "the last segment is told to finish the story");
check(!seg0.includes(P.LENGTHS.short.rule),
  "a segment does not also get the conversational length rule -- it contradicts it");
check(chatPrompt.includes(P.LENGTHS.short.rule), "while chat still does");

// Rule numbering must survive activity rules, the same way it survives the others.
for (const id of ACT_IDS) {
  const out = P.build({ level: 3, label: "HSK 3", length: "medium", activity: id,
                        storySegment: id === "story" ? { index: 1, of: 5 } : null,
                        offer: [{ w: "\u82f9\u679c" }], reuse: [{ w: "\u559c\u6b22" }], script: "trad" });
  const nums = out.split("\n").map(l => /^(\d+)\. /.exec(l)).filter(Boolean).map(m => Number(m[1]));
  const expected = nums.map((_, i) => i + 1);
  check(JSON.stringify(nums) === JSON.stringify(expected),
    `activity ${id}: rule numbering is gap-free and in order`, JSON.stringify(nums));
}

/* Phase two of story time. Not a segment, so it must not be told to write
 * another ninety characters -- and it must not carry story time's own
 * "只讲故事，不要问学生问题", which is stated absolutely and is exactly the
 * rule a model obeys in preference to a later one contradicting it. */
const q = P.build({ level: 1, label: "HSK 1", length: "short",
                    activity: "story", storyPhase: "asking" });
check(q.includes("\u95ee\u5b66\u751f\u4e00\u4e2a\u5173\u4e8e\u4ed6\u521a\u624d\u8bfb\u7684\u90a3\u4e00\u6bb5\u7684\u95ee\u9898"),
  "the question phase asks about the part just read");
check(!q.includes("\u8fd9\u4e00\u6bb5\u5199\u5927\u6982\u4e5d\u5341\u4e2a\u6c49\u5b57"),
  "and is not told to write another segment");
check(!q.includes("\u4e0d\u8981\u95ee\u5b66\u751f\u95ee\u9898"),
  "and is not still under the telling rule forbidding questions");
check(q.includes(P.LENGTHS.short.rule),
  "it is a conversational turn again, so the length rule is back");
const qNums = q.split("\n").map(l => /^(\d+)\. /.exec(l)).filter(Boolean).map(m => Number(m[1]));
check(JSON.stringify(qNums) === JSON.stringify(qNums.map((_, i) => i + 1)),
  "and its rule numbering is still gap-free", JSON.stringify(qNums));

/* Task 9: the three story phases, the level-filtered question ladder, and
 * the defect fix in `discussing` (a learner answering the partner's own
 * question used to be met with story time's do-not-talk-to-them rules). */
var asking = P.build({
  level: 2, label: "HSK 2", length: "short", activity: "story",
  storyPhase: "asking"
});
check(asking.indexOf("\u53ea\u8bb2\u6545\u4e8b") === -1,
  "asking suppresses the do-not-question rule that would contradict it");
check(asking.indexOf("\u521a\u624d\u8bfb\u7684") !== -1,
  "and asks about the part just read, which is what circling does");
check(asking.indexOf("\u4e3a\u4ec0\u4e48") !== -1,
  "at HSK 2 the partner may ask why", asking.slice(0, 300));

var askingOne = P.build({
  level: 1, label: "HSK 1", length: "short", activity: "story",
  storyPhase: "asking"
});
check(askingOne.indexOf("\u4e3a\u4ec0\u4e48") === -1,
  "at HSK 1 it may not -- \u4e3a is above the level");

var discussing = P.build({
  level: 2, label: "HSK 2", length: "short", activity: "story",
  storyPhase: "discussing"
});
check(discussing.indexOf("\u53ea\u8bb2\u6545\u4e8b") === -1,
  "discussing does not tell the partner to keep telling the story");
check(discussing.indexOf("\u4e0d\u8981\u518d\u95ee") !== -1,
  "and stops after reacting, because the button asks the next question");

var telling = P.build({
  level: 2, label: "HSK 2", length: "short", activity: "story",
  storyPhase: "telling", storySegment: { index: 1, of: 5 }
});
check(telling.indexOf("\u53ea\u8bb2\u6545\u4e8b") !== -1, "telling keeps story time's own rules");

/* Names are the single largest source of out-of-level words in a story, and the
 * whitelist has to reach every segment -- not just the first, where 叫 would
 * have covered it anyway -- and the question phase, which asks about the
 * characters by name. */
const nameRule = "\u6545\u4e8b\u91cc\u7684\u4eba\u53ef\u4ee5\u53eb";
for (const idx of [0, 2, 4]) {
  const out = P.build({ level: 1, label: "HSK 1", length: "short", activity: "story",
                        storySegment: { index: idx, of: 5 } });
  check(out.includes(nameRule), `segment ${idx} is given the cast`);
  for (const e of P.STORY_NAMES) {
    check(out.includes(e.w), `segment ${idx} lists ${e.w}`);
  }
}
check(P.build({ level: 1, label: "HSK 1", length: "short", activity: "story",
                storyPhase: "asking" }).includes(nameRule),
  "and so is the question phase -- it asks about the characters by name");

/* Every name needs pinyin and a gloss or the popover is blank, and none may
 * carry a `t`: the caller runs these through the same toScript() as the rule
 * text, and a second conversion path is a second answer. */
for (const e of P.STORY_NAMES) {
  check(!!e.p && !!e.d, `${e.w} has pinyin and a gloss`);
  check(e.t === undefined, `${e.w} carries no separate traditional form`);
}

check(!P.build({ level: 1, label: "HSK 1", length: "short", activity: "chat" })
        .includes(nameRule), "while chat is not -- it is story time's problem");
check(P.ACTIVITIES.chat.names === null && P.ACTIVITIES.focused.names === null,
  "and neither dialogue activity has a cast");

// The topic reaches the model as a rule, not as a conversation turn.
var topicPrompt = P.build({
  level: 1, label: "HSK 1", length: "short", activity: "story",
  storyTopic: "the Monkey King", storySegment: { index: 0, of: 5 }
});
check(topicPrompt.indexOf("the Monkey King") !== -1,
  "the topic is named in the story prompt", topicPrompt.slice(0, 200));
check(topicPrompt.indexOf("学生想听一个关于") !== -1,
  "and introduced in Chinese, like every other rule");

var noTopic = P.build({
  level: 1, label: "HSK 1", length: "short", activity: "story",
  storyTopic: "", storySegment: { index: 0, of: 5 }
});
check(noTopic.indexOf("学生想听一个关于") === -1,
  "make-something-up adds no topic rule at all");

// Every level has ideas of its own, per D8: a table filled in only to HSK 2
// would leave every level above it on HSK 1's suggestions with nothing saying so.
[1, 2, 3, 4, 5, 6, 7].forEach(function (lv) {
  var ideas = P.storyIdeasFor(lv);
  check(ideas.length >= 4, "HSK " + lv + " has at least four story ideas",
    JSON.stringify(ideas));
  check(ideas.every(function (s) { return s && s.trim().length; }),
    "HSK " + lv + "'s ideas are all non-empty");
  check(new Set(ideas).size === ideas.length,
    "HSK " + lv + "'s ideas are distinct", JSON.stringify(ideas));
});
// storyIdeasFor falls back to STORY_IDEAS[1] for any level with no row of its
// own, so a per-level length/non-empty/distinct check alone cannot tell a real
// row from a silently-missing one that fell back to HSK 1's -- it would pass
// either way. This is the D8 failure mode by name: compare every other level's
// list against HSK 1's fallback target so a deleted row is caught, not just
// HSK 4's.
var hsk1Ideas = P.storyIdeasFor(1).join("|");
[2, 3, 4, 5, 6, 7].forEach(function (lv) {
  check(P.storyIdeasFor(lv).join("|") !== hsk1Ideas,
    "HSK " + lv + "'s ideas are not just HSK 1's (would mean a missing row)",
    JSON.stringify(P.storyIdeasFor(lv)));
});

// The ladder is checked against the data, not against the author's taste: a type
// is permitted only where the level carries the words its asking form needs.
// This is what catches 还是 at HSK 1, which validate() lets through as 还 + 是.
var LEVEL_WORDS = {};
[1, 2, 3, 4, 5, 6, 7].forEach(function (lv) {
  LEVEL_WORDS[lv] = new Set(JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "hsk" + lv + ".json"), "utf8")
  ).map(function (e) { return e.w; }));
});

[1, 2, 3, 4, 5, 6, 7].forEach(function (lv) {
  var ladder = P.questionTypesFor(lv);
  check(ladder.types.length > 0, "HSK " + lv + " permits at least one question type",
    JSON.stringify(ladder));
  ladder.needs.forEach(function (w) {
    check(LEVEL_WORDS[lv].has(w),
      "HSK " + lv + " carries 「" + w + "」, which its questions need", w);
  });
});

// The `needs` list is not the whole prompt: QUESTION_SHAPES is the worked
// example the model is actually shown, one per type, and a word inside the
// shape but absent from `needs` slips past the check above. Run every shape
// through HSK.validate() against every level whose ladder offers its type --
// the same "checked against the data" purpose as the `needs` loop, extended
// to the asking form itself. This is what catches 没 in the "infer" shape:
// only 没有 is an entry at any level.
var shapesByType = {};
P.QUESTION_SHAPES.forEach(function (q) { shapesByType[q.type] = q.shape; });
[1, 2, 3, 4, 5, 6, 7].forEach(function (lv) {
  var ladder = P.questionTypesFor(lv);
  ladder.types.forEach(function (t) {
    var shape = shapesByType[t];
    var v = HSK.validate(shape, lex[lv]);
    check(v.length === 0,
      "HSK " + lv + "'s \"" + t + "\" question shape validates at its own level",
      shape + " -- flagged: " + v.map(function (x) { return x.text; }).join(", "));
  });
});

// Cumulative: a level never loses a type it had below.
[2, 3, 4, 5, 6, 7].forEach(function (lv) {
  var below = P.questionTypesFor(lv - 1).types;
  var here = P.questionTypesFor(lv).types;
  check(below.every(function (t) { return here.indexOf(t) !== -1; }),
    "HSK " + lv + " keeps every question type HSK " + (lv - 1) + " had");
});

// The findings that shaped the order, pinned so a well-meaning edit cannot undo them.
check(P.questionTypesFor(1).types.indexOf("eitheror") === -1,
  "either/or is NOT offered at HSK 1 -- 还是 is HSK 2, and validate() cannot see it " +
  "because 还 and 是 are separately legal");
check(P.questionTypesFor(1).types.indexOf("what") !== -1,
  "but wh- questions are, because 什么 and 谁 are HSK 1 -- the English ladder inverts here");
check(P.questionTypesFor(1).types.indexOf("why") === -1,
  "and why is not, because 为 is above HSK 1");
check(P.questionTypesFor(2).types.indexOf("why") !== -1,
  "why arrives at HSK 2 with 为什么 and 因为");

// The declared cast is asked for before the story is written, in the
// [[NEED:]] shape extractNeeds() already parses -- no format, storage or
// lexicon plumbing of its own.
var cast = P.castPrompt("the Monkey King", "HSK 1", 3);
check(cast.indexOf("the Monkey King") !== -1, "the cast prompt names the topic");
check(cast.indexOf("[[NEED:") !== -1,
  "and asks for the answer in the channel extractNeeds already parses");
check(/\b3\b/.test(cast), "and states the cap");

// A finished story's derived title (the first sentence of segment 1) is
// unreadable in a chat list -- rereading is part of how this app is used, so
// a short one worth finding again is asked for from the teaching model.
var titleP = P.titlePrompt("小明去了商店。他买了一个球。");
check(titleP.indexOf("小明去了商店") !== -1, "the title prompt carries the story");
check(/\b(title|name)\b/i.test(titleP), "and asks for a title");

/* The secret pool for 20 Questions: concrete, guessable nouns, not tagged per
 * level -- membership is checked against the student's own cumulative
 * wordlist at pick time instead. */
check(Array.isArray(P.GUESS_POOL) && P.GUESS_POOL.length >= 30,
  "GUESS_POOL has a real number of entries", P.GUESS_POOL && P.GUESS_POOL.length);
check(new Set(P.GUESS_POOL).size === P.GUESS_POOL.length,
  "GUESS_POOL has no duplicates");
check(P.GUESS_POOL.every(function (w) { return typeof w === "string" && w.length; }),
  "every entry is a non-empty string");

var hsk1Words = new Set(JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "hsk1.json"), "utf8")
).map(function (e) { return e.w; }));
var hsk1Hits = P.GUESS_POOL.filter(function (w) { return hsk1Words.has(w); });
check(hsk1Hits.length >= 15,
  "HSK 1 alone already clears a real chunk of the pool -- an empty " +
  "intersection is not a realistic case at any level", hsk1Hits.length);

// pickSecret: filter to the student's own words, fall back if the
// intersection is empty, and never throw on an empty base.
var base1 = [{ w: "苹果" }, { w: "猫" }, { w: "水" }];   // 水 is not in GUESS_POOL
var zeroRng = function () { return 0; };
check(P.pickSecret(base1, zeroRng) === "苹果" || P.pickSecret(base1, zeroRng) === "猫",
  "pickSecret only ever returns a word actually in the base", P.pickSecret(base1, zeroRng));
check(["苹果", "猫", "水"].indexOf(P.pickSecret(base1, zeroRng)) !== -1,
  "and it is one the caller actually offered");

var baseNoOverlap = [{ w: "水" }, { w: "空气" }];   // neither is in GUESS_POOL
check(P.pickSecret(baseNoOverlap, zeroRng) === "水",
  "an empty intersection falls back to any word in base, not a throw");

check(P.pickSecret([], zeroRng) === null,
  "an empty base returns null rather than throwing");

var manyRng = function () { return 0.999999; };
check(P.pickSecret([{ w: "苹果" }], manyRng) === "苹果",
  "rng is clamped to a real index even near 1");

/* 20 Questions: a role branch parallel to storyPhase, per D6. Neither role's
 * text is held to the level allowlist -- same rule as every other activity's
 * `rules`, which already use 英文/语法. */
check(!!P.ACTIVITIES.twenty, "activity twenty exists");
check(P.ACTIVITIES.twenty.gen === "turn", "twenty generates one turn at a time");
check(P.ACTIVITIES.twenty.converse === false,
  "twenty suppresses the ordinary chat turn-taking rules -- a yes/no exchange isn't that shape");
check(P.ACTIVITIES.twenty.names === null, "twenty has no cast");

var noSide = P.build({ level: 1, label: "HSK 1", length: "short", activity: "twenty" });
check(noSide.indexOf("你负责猜") === -1 && noSide.indexOf("你心里想的是") === -1,
  "with no side chosen yet, neither role's rule appears");

var answerer = P.build({ level: 1, label: "HSK 1", length: "short",
                         activity: "twenty", side: "answerer" });
check(answerer.indexOf("学生想了一个东西，你负责猜") !== -1,
  "answerer: the model is told it is the one guessing");
check(answerer.indexOf("心里") === -1,
  "and not primed to echo 心里 (above HSK 1) into every guessing question -- measured live");
check(answerer.indexOf("大概二十个问题以内") !== -1,
  "and given the roughly-twenty budget to narrate against");
check(answerer.indexOf("你心里想的是") === -1,
  "and not handed a secret it never got");

var guesser = P.build({ level: 1, label: "HSK 1", length: "short",
                        activity: "twenty", side: "guesser", secret: "苹果" });
check(guesser.indexOf("你心里想的是「苹果」") !== -1,
  "guesser: the model is told its own secret");
check(guesser.indexOf("只回答「是」或「不是」") !== -1,
  "and told to answer only yes/no");
check(guesser.indexOf("学生想了一个东西") === -1,
  "and not given the answerer's rule instead");

var guesserNoSecret = P.build({ level: 1, label: "HSK 1", length: "short",
                                activity: "twenty", side: "guesser" });
check(guesserNoSecret.indexOf("你心里想的是") === -1,
  "guesser with no secret yet adds no rule at all, rather than leaking a literal undefined");

// The conversational turn-taking rules must actually leave the prompt.
var twentyPrompt = P.build({ level: 1, label: "HSK 1", length: "short",
                             activity: "twenty", side: "answerer" });
check(twentyPrompt.indexOf(ASK_RULE) === -1,
  "twenty drops the ask-a-new-question rule -- the round has its own shape");

// Script conversion reaches the secret exactly like every other app-authored
// rule -- it is Chinese vocabulary data, not learner-typed English like a
// story topic.
var guesserTrad = P.build({ level: 1, label: "HSK 1", length: "short",
                            activity: "twenty", side: "guesser", secret: "苹果",
                            script: "trad", convert: function (t) { return t.replace(/苹果/g, "蘋果"); } });
check(guesserTrad.indexOf("蘋果") !== -1,
  "the secret is passed through the same convert() as the rest of the rule");

// Rule numbering must survive the role branch, same as every other activity.
var twentyNums = twentyPrompt.split("\n").map(function (l) {
  return (/^(\d+)\. /.exec(l) || [])[1];
}).filter(Boolean).map(Number);
check(JSON.stringify(twentyNums) === JSON.stringify(twentyNums.map(function (_, i) { return i + 1; })),
  "twenty: rule numbering is gap-free and in order", JSON.stringify(twentyNums));

/* activityRules() is what a custom system prompt still gets (systemPrompt()'s
 * own branch in index.html), extracted out of build() so the two can never
 * drift apart -- its output must always be exactly a subset of what build()
 * itself produces for the same opts. */
[
  { activity: "chat" },
  { activity: "focused" },
  { activity: "story", storySegment: { index: 0, of: 5 } },
  { activity: "story", storyPhase: "asking" },
  { activity: "story", storyPhase: "discussing" },
  { activity: "twenty", side: "answerer" },
  { activity: "twenty", side: "guesser", secret: "苹果" }
].forEach(function (o) {
  var opts = Object.assign({ level: 1, label: "HSK 1", length: "short" }, o);
  var rules = P.activityRules(opts);
  var full = P.build(opts);
  rules.forEach(function (r) {
    check(full.indexOf(r) !== -1,
      "activityRules() for " + JSON.stringify(o) + " appears verbatim in build()'s own output",
      r);
  });
});
check(P.activityRules({ activity: "twenty", level: 1, label: "HSK 1", length: "short" }).length === 0,
  "activityRules() adds nothing for twenty with no side chosen yet -- a custom " +
  "prompt should not invent a role the chooser never set");
check(P.activityRules({ activity: "focused", level: 1, label: "HSK 1", length: "short" }).length > 0,
  "and Ghost Words' targeting instruction survives a custom prompt");

/* Measured live: both 20 Questions roles fell back to plain chat, the exact
 * shape of the worked example below -- answer, share something, ask a new
 * question -- which is unconditional in every other activity's prompt and
 * directly contradicts the role rule. A few-shot example outweighs a
 * numbered rule, so it has to go for this activity specifically; every
 * other activity is unmeasured and keeps it. */
var CHAT_EXAMPLE_LINE = "你喜欢吃什么";
var twentyAnswererPrompt = P.build({ level: 1, label: "HSK 1", length: "short",
                                     activity: "twenty", side: "answerer" });
check(twentyAnswererPrompt.indexOf(CHAT_EXAMPLE_LINE) === -1,
  "twenty's worked example drops the answer-share-ask exchange that contradicts its own role rule");
check(twentyAnswererPrompt.indexOf("[[NEED:") !== -1,
  "but keeps the [[NEED:]] demonstration -- a student can still ask 怎么说 mid-round");
check(P.build({ level: 1, label: "HSK 1", length: "short", activity: "chat" })
        .indexOf(CHAT_EXAMPLE_LINE) !== -1,
  "chat keeps the full worked example -- this is scoped to twenty, not global");

/* Measured live (tools/twenty-ab.js): the role rule alone only describes
 * REACTIVE behavior, and says nothing about the opening turn, where there is
 * nothing yet to react to. Every guesser opening reply in a real run was
 * plain small talk with no sign a game had started (0/8, twice over); the
 * answerer's opening reliability was worse than an earlier, too-loose check
 * suggested. `opening` fixes this by stating the first-turn behavior
 * explicitly rather than asking the model to infer it from an empty
 * transcript. */
var answererOpening = P.build({ level: 1, label: "HSK 1", length: "short",
                                activity: "twenty", side: "answerer", opening: true });
check(answererOpening.indexOf("现在马上问第一个是非问题") !== -1,
  "answerer's opening turn is told to ask a guessing question immediately");
var answererLater = P.build({ level: 1, label: "HSK 1", length: "short",
                              activity: "twenty", side: "answerer", opening: false });
check(answererLater.indexOf("现在马上问第一个是非问题") === -1,
  "and that instruction does not repeat on later turns, which already have something to react to");

/* A free-form "announce readiness in your own words" instruction measured
 * badly here (8/10 fell back to 我不知道 after 3 repair attempts): the
 * concept "I will answer yes-or-no" has no simple HSK 1 phrasing, so the
 * model reliably reached for 回答/或/开始, all above HSK 1. A literal,
 * pre-validated template sidesteps it -- told to say this exact sentence,
 * the model did, verbatim, 10/10 on the first attempt. */
var GUESSER_OPENING_LINE = "我想了一个东西，你问我吧。";
check(HSK.validate(GUESSER_OPENING_LINE,
  HSK.buildLexicon(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "hsk1.json"), "utf8"))))
  .length === 0, "the guesser opening template is itself legal at HSK 1 -- it is the whole point");
var guesserOpening = P.build({ level: 1, label: "HSK 1", length: "short",
                               activity: "twenty", side: "guesser", secret: "苹果", opening: true });
check(guesserOpening.indexOf(GUESSER_OPENING_LINE) !== -1,
  "guesser's opening turn is told to say the pre-validated announcement");
var guesserLater = P.build({ level: 1, label: "HSK 1", length: "short",
                             activity: "twenty", side: "guesser", secret: "苹果", opening: false });
check(guesserLater.indexOf(GUESSER_OPENING_LINE) === -1,
  "and that instruction does not repeat on later turns either");

// Rule numbering must survive the opening instruction too.
var openingNums = answererOpening.split("\n").map(function (l) {
  return (/^(\d+)\. /.exec(l) || [])[1];
}).filter(Boolean).map(Number);
check(JSON.stringify(openingNums) === JSON.stringify(openingNums.map(function (_, i) { return i + 1; })),
  "opening turn: rule numbering is still gap-free", JSON.stringify(openingNums));

/* Measured live: a real medium-length reply correctly asked its second
 * guessing question, then appended "我昨天努力学习。老师说我的练习很好。
 * 你最近有什么特别的事吗？" -- word for word the medium length rule's own
 * "share your own thing, then ask" instruction, which is not gated by
 * act.converse the way rules 5-7 are (it is not a turn-taking rule). Omitted
 * for twenty entirely (not narrowed to a sentence-count-only variant): rule
 * 8 already states the shape, and long's own "不要只说一两句" flatly
 * contradicts "ask exactly one question" -- see build()'s own comment on
 * why this ships as a textual-contradiction fix, not a proven fix for the
 * rambling that prompted it. */
["short", "medium", "long"].forEach(function (len) {
  var out = P.build({ level: 1, label: "HSK 1", length: len, activity: "twenty", side: "answerer" });
  check(out.indexOf(P.LENGTHS[len].rule) === -1,
    "twenty at " + len + " length drops the length rule entirely -- rule 8 already states the shape");
});
check(P.build({ level: 1, label: "HSK 1", length: "medium", activity: "chat" })
        .indexOf("先说你自己的事") !== -1,
  "chat keeps the full medium rule -- this is scoped to twenty, not global");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
