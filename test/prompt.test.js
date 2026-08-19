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

// 7. An unknown level must not produce a prompt with no constraints at all.
check(P.styleFor(99) === P.LEVEL_STYLE[1], "unknown level falls back to the strictest profile");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
