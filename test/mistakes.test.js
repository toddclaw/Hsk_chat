/* Mistake counting. Run: node test/mistakes.test.js */
const M = require("../mistakes.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

const LABELS = { "measure-word": "measure word", "aspect-le": "了" };
const NOW = Date.parse("2026-09-07T12:00:00Z");
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();

// A graded user message that got `tag` wrong.
const wrong = (tag, when, text) => ({
  role: "user", text: text || "我说错了", created_at: when,
  grade: { ok: false, better: "正确的说法", errors: [{ tag: tag, note: "the rule" }] }
});
// A graded user message the grader passed.
const right = when => ({
  role: "user", text: "我说对了", created_at: when, grade: { ok: true, errors: [] }
});
const drillMarker = tag => ({ role: "drill", text: tag });

const counts = (chatMsgs, over) =>
  M.counts(chatMsgs, Object.assign({ tagLabels: LABELS, now: NOW }, over || {}));
const find = (rows, tag) => rows.filter(r => r.tag === tag)[0];

// --- the window -------------------------------------------------------------
check(find(counts({ c1: [wrong("measure-word", daysAgo(1))] }), "measure-word").n === 1,
  "a failure inside the window counts");
check(counts({ c1: [wrong("measure-word", daysAgo(91))] }).length === 0,
  "a failure older than 90 days does not count");
check(find(counts({ c1: [wrong("measure-word", daysAgo(89))] }), "measure-word").n === 1,
  "89 days old still counts");
check(counts({ c1: [wrong("measure-word", "not a date")] }).length === 0,
  "an unparseable date never counts");

// --- credits ----------------------------------------------------------------
const twoSameDay = {
  c1: [wrong("measure-word", daysAgo(5)), wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"), right(daysAgo(1)), right(daysAgo(1))]
};
check(find(counts(twoSameDay), "measure-word").credits === 1,
  "two passes on one calendar day credit once",
  JSON.stringify(find(counts(twoSameDay), "measure-word")));

const twoDays = {
  c1: [wrong("measure-word", daysAgo(5)), wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"), right(daysAgo(2)), right(daysAgo(1))]
};
check(find(counts(twoDays), "measure-word").credits === 2,
  "passes on two calendar days credit twice");
check(find(counts(twoDays), "measure-word").n === 0,
  "and two credits cancel two failures");

// --- the floor --------------------------------------------------------------
const overCredited = {
  c1: [wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"), right(daysAgo(3)), right(daysAgo(2)), right(daysAgo(1))]
};
check(find(counts(overCredited), "measure-word").n === 0,
  "more credits than failures floors at zero, never negative",
  String(find(counts(overCredited), "measure-word").n));
check(find(counts(overCredited), "measure-word").failures === 1,
  "the raw failure count is still reported alongside");

// --- attribution ------------------------------------------------------------
check(find(counts({
  c1: [wrong("measure-word", daysAgo(5))],
  c2: [right(daysAgo(1))]
}), "measure-word").credits === 0,
  "a pass outside any drill credits nothing");

const twoTags = {
  c1: [wrong("measure-word", daysAgo(5)), wrong("aspect-le", daysAgo(5))],
  c2: [drillMarker("measure-word"), right(daysAgo(1))]
};
check(find(counts(twoTags), "measure-word").n === 0 &&
      find(counts(twoTags), "aspect-le").n === 1,
  "a drill on one tag credits only that tag");
check(find(counts({
  c1: [wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"), wrong("measure-word", daysAgo(1))]
}), "measure-word").credits === 0,
  "a failed sentence inside a drill earns no credit");

// --- housekeeping -----------------------------------------------------------
check(counts({ c1: [wrong("no-such-tag", daysAgo(1))] }).length === 0,
  "unknown tags are ignored");
check(counts({ c1: [{ role: "assistant", text: "hi", created_at: daysAgo(1) }] }).length === 0,
  "the partner's messages are never graded against the learner");
check(counts({ c1: [drillMarker("measure-word"), right(daysAgo(1))] }).length === 0,
  "a tag with credits but no failures in the window is not listed");

const ordered = counts({
  c1: [wrong("aspect-le", daysAgo(3)), wrong("aspect-le", daysAgo(2)),
       wrong("measure-word", daysAgo(1))]
});
check(ordered[0].tag === "aspect-le" && ordered[1].tag === "measure-word",
  "rows are ordered by count, commonest first",
  ordered.map(r => r.tag + ":" + r.n).join(" "));

// --- the example shown back -------------------------------------------------
const eg = find(counts({
  c1: [wrong("measure-word", daysAgo(9), "旧的句子"), wrong("measure-word", daysAgo(1), "新的句子")]
}), "measure-word");
check(eg.eg === "新的句子", "the example shown is the most recent one, by date", eg.eg);

const egAcross = find(counts({
  zzz: [wrong("measure-word", daysAgo(1), "新的句子")],
  aaa: [wrong("measure-word", daysAgo(9), "旧的句子")]
}), "measure-word");
check(egAcross.eg === "新的句子",
  "and is the most recent across conversations regardless of key order", egAcross.eg);

// --- the recent examples the drill chooser shows ----------------------------
const three = find(counts({
  c1: [wrong("measure-word", daysAgo(9), "第三句"), wrong("measure-word", daysAgo(5), "第二句"),
       wrong("measure-word", daysAgo(1), "第一句"), wrong("measure-word", daysAgo(20), "第四句")]
}), "measure-word");
check(three.recent.length === 3, "at most three recent examples are kept",
  String(three.recent.length));
check(three.recent.map(r => r.eg).join(" ") === "第一句 第二句 第三句",
  "and they are newest first", three.recent.map(r => r.eg).join(" "));
check(three.recent[0].better === "正确的说法" && three.recent[0].note === "the rule",
  "each carries its correction and the grader's note");
check(three.recent[0].eg === three.eg,
  "the single example is the head of the list, so old callers see no change");

// --- drillExampleOf ---------------------------------------------------------
const egMarker = text => ({ role: "drillEg", text: text });
check(M.drillExampleOf([drillMarker("aspect-le"), egMarker("我已经吃了饭")]) === "我已经吃了饭",
  "drillExampleOf reads the chosen correction");
check(M.drillExampleOf([drillMarker("aspect-le")]) === "",
  "drillExampleOf is empty when no example was chosen");

// --- credit judged on the target, not the whole sentence --------------------
// The grader's verdict on the drilled structure specifically. `ok` is the
// whole-sentence verdict, which partial credit deliberately ignores.
const onTarget = (when, opts) => ({
  role: "user", text: "我写的句子", created_at: when,
  grade: Object.assign({ ok: false, errors: [{ tag: "aspect-le", note: "了" }] }, opts)
});

check(find(counts({
  c1: [wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"),
       onTarget(daysAgo(1), { target: { used: true, ok: true } })]
}), "measure-word").credits === 1,
  "the target used correctly credits even though the sentence failed elsewhere");

check(find(counts({
  c1: [wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"),
       onTarget(daysAgo(1), { target: { used: true, ok: false } })]
}), "measure-word").credits === 0,
  "the target used wrongly credits nothing");

check(find(counts({
  c1: [wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"),
       onTarget(daysAgo(1), { ok: true, errors: [], target: { used: false, ok: true } })]
}), "measure-word").credits === 0,
  "a correct sentence that dodges the target credits nothing");

check(find(counts({
  c1: [wrong("measure-word", daysAgo(5)), wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"),
       onTarget(daysAgo(2), { target: { used: true, ok: true } }),
       onTarget(daysAgo(1), { target: { used: true, ok: true } })]
}), "measure-word").credits === 2,
  "target credit is still capped at one a day, so two days credit twice");

check(find(counts({
  c1: [wrong("measure-word", daysAgo(5)), wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"),
       onTarget(daysAgo(1), { target: { used: true, ok: true } }),
       onTarget(daysAgo(1), { target: { used: true, ok: true } })]
}), "measure-word").credits === 1,
  "and six passes in one sitting are worth what one is");

// Rows graded before the target field existed keep the credits they earned.
check(find(counts({
  c1: [wrong("measure-word", daysAgo(5))],
  c2: [drillMarker("measure-word"), right(daysAgo(1))]
}), "measure-word").credits === 1,
  "a legacy pass with no target field still credits on grade.ok");

// --- tags that name an error rather than a structure ------------------------
/* wrong-word, wrong-character and friends get no target check at all -- see
 * prompt.js ERROR_CLASS_TAGS. Credit for them is the absence of that tag's own
 * error, which is the same partial-credit principle: judged on the thing being
 * drilled, not on the whole sentence. */
const LEX = { "wrong-word": "wrong word", "aspect-le": "了" };
const lexCounts = (chatMsgs) =>
  M.counts(chatMsgs, { tagLabels: LEX, now: NOW });

// The reported bug: a green tick, no target field, and no credit.
check(lexCounts({
  c1: [wrong("wrong-word", daysAgo(5))],
  c2: [drillMarker("wrong-word"),
       { role: "user", text: "我觉得可以", created_at: daysAgo(1),
         grade: { ok: true, errors: [] } }]
}).filter(r => r.tag === "wrong-word")[0].credits === 1,
  "a sentence with no error of the drilled tag credits it");

check(lexCounts({
  c1: [wrong("wrong-word", daysAgo(5))],
  c2: [drillMarker("wrong-word"), wrong("wrong-word", daysAgo(1))]
}).filter(r => r.tag === "wrong-word")[0].credits === 0,
  "and a sentence that makes that very mistake again credits nothing");

/* Partial credit, the whole point, in the lexical direction: the drilled tag is
 * clean and another one is not. */
check(lexCounts({
  c1: [wrong("wrong-word", daysAgo(5))],
  c2: [drillMarker("wrong-word"),
       { role: "user", text: "我觉得可以了", created_at: daysAgo(1),
         grade: { ok: false, errors: [{ tag: "aspect-le", note: "了" }] } }]
}).filter(r => r.tag === "wrong-word")[0].credits === 1,
  "an error under a DIFFERENT tag does not block the drilled tag's credit");

// An unreadable grade says nothing about anything.
check(lexCounts({
  c1: [wrong("wrong-word", daysAgo(5))],
  c2: [drillMarker("wrong-word"),
       { role: "user", text: "?", created_at: daysAgo(1),
         grade: { unreadable: true } }]
}).filter(r => r.tag === "wrong-word")[0].credits === 0,
  "a grade that could not be read credits nothing");

/* A verdict that was never meaningful must not be consulted, and one was
 * stored: the first release asked the target question for these tags too, so
 * transcripts carry target:{used:true,ok:false} on sentences that were fine. */
check(M.credited({ ok: true, errors: [], target: { used: true, ok: false } },
                 "wrong-word", ["wrong-word"]) === true,
  "a stored target is ignored for a tag that names an error");
check(M.credited({ ok: true, errors: [], target: { used: true, ok: false } },
                 "measure-word", ["wrong-word"]) === false,
  "and still decides it for a tag that names a structure");
check(M.counts({
  c1: [wrong("wrong-word", daysAgo(5))],
  c2: [drillMarker("wrong-word"),
       { role: "user", text: "我觉得可以", created_at: daysAgo(1),
         grade: { ok: true, errors: [], target: { used: true, ok: false } } }]
}, { tagLabels: LEX, now: NOW, errorClassTags: ["wrong-word"] })
  .filter(r => r.tag === "wrong-word")[0].credits === 1,
  "counts() takes the list the same way it takes the labels");

// --- drillTagOf -------------------------------------------------------------
check(M.drillTagOf([drillMarker("aspect-le"), right(daysAgo(1))]) === "aspect-le",
  "drillTagOf reads the marker");
check(M.drillTagOf([right(daysAgo(1))]) === "",
  "drillTagOf is empty for an ordinary conversation");

// --- drilling one word rather than the whole category -----------------------
// RESEARCH.md, "Drilling a word rather than a category". The grader's error
// entry may carry the word it is about; a tag whose errors carry none keeps
// behaving exactly as it did before the field existed.
const LEX2 = { "wrong-word": "wrong word" };
const wrongWord = (word, when, text) => ({
  role: "user", text: text || "我说错了", created_at: when,
  grade: { ok: false, better: "正确的说法",
           errors: [{ tag: "wrong-word", note: "the rule", word: word }] }
});
const wordDrill = (tag, word) => [{ role: "drill", text: tag },
                                  { role: "drillWord", text: word }];
const wordsOf = (rows, tag) => (rows.filter(r => r.tag === tag)[0] || {}).words || [];
const lex = (msgs, over) => M.counts(msgs, Object.assign(
  { tagLabels: LEX2, now: NOW, errorClassTags: ["wrong-word"] }, over || {}));

check(M.drillWordOf(wordDrill("wrong-word", "行")) === "行",
  "drillWordOf reads the marker");
check(M.drillWordOf([{ role: "drill", text: "wrong-word" }]) === "",
  "drillWordOf is empty for a drill on the category alone");

const threeWords = { c1: [wrongWord("行", daysAgo(9)), wrongWord("认识", daysAgo(3)),
                          wrongWord("行", daysAgo(8))] };
check(wordsOf(lex(threeWords), "wrong-word").length === 2,
  "two distinct words under one tag become two entries");
check(wordsOf(lex(threeWords), "wrong-word")[0].word === "认识",
  "words sort by recency, not by count",
  JSON.stringify(wordsOf(lex(threeWords), "wrong-word").map(w => w.word)));
check(wordsOf(lex(threeWords), "wrong-word").filter(w => w.word === "行")[0].n === 2,
  "a word missed twice counts twice");
check(lex(threeWords).filter(r => r.tag === "wrong-word")[0].n === 3,
  "the tag total is unchanged by the split");

check(wordsOf(lex({ c1: [wrong("wrong-word", daysAgo(2))] }), "wrong-word").length === 0,
  "an error with no word makes no word entry");

// A pass on the drilled word credits the word AND the category it sits under:
// without the second, a category could never fall from a word drill.
const drilled = {
  c1: [wrongWord("行", daysAgo(9)), wrongWord("认识", daysAgo(8))],
  c2: wordDrill("wrong-word", "行").concat([
    { role: "user", text: "三点行吗", created_at: daysAgo(2),
      grade: { ok: true, errors: [], target: { used: true, ok: true } } }])
};
check(wordsOf(lex(drilled), "wrong-word").filter(w => w.word === "行")[0].n === 0,
  "a pass on the drilled word clears that word");
check(wordsOf(lex(drilled), "wrong-word").filter(w => w.word === "认识")[0].n === 1,
  "and leaves the other word under the same tag alone");
check(lex(drilled).filter(r => r.tag === "wrong-word")[0].n === 1,
  "the category falls by one too");

// The per-day cap, one level down: it now bounds a word, not a category.
const twice = {
  c1: [wrongWord("行", daysAgo(9)), wrongWord("行", daysAgo(8))],
  c2: wordDrill("wrong-word", "行").concat([
    { role: "user", text: "三点行吗", created_at: daysAgo(2),
      grade: { ok: true, errors: [], target: { used: true, ok: true } } },
    { role: "user", text: "这样也行", created_at: daysAgo(2),
      grade: { ok: true, errors: [], target: { used: true, ok: true } } }])
};
check(wordsOf(lex(twice), "wrong-word").filter(w => w.word === "行")[0].n === 1,
  "two passes on one day credit a word once");

// Two words drilled on the same day are two practices, not one massed session.
const twoWordsOneDay = {
  c1: [wrongWord("行", daysAgo(9)), wrongWord("认识", daysAgo(8))],
  c2: wordDrill("wrong-word", "行").concat([
    { role: "user", text: "三点行吗", created_at: daysAgo(2),
      grade: { ok: true, errors: [], target: { used: true, ok: true } } }]),
  c3: wordDrill("wrong-word", "认识").concat([
    { role: "user", text: "我认识他", created_at: daysAgo(2),
      grade: { ok: true, errors: [], target: { used: true, ok: true } } }])
};
check(lex(twoWordsOneDay).filter(r => r.tag === "wrong-word")[0].n === 0,
  "two different words drilled the same day credit separately");

// A category drilled on its own and a word under it drilled separately both
// credit the same tag. Assigning rather than adding would drop one of them,
// and which one would depend on key order.
const mixed = {
  c1: [wrongWord("行", daysAgo(9)), wrong("wrong-word", daysAgo(8))],
  c2: wordDrill("wrong-word", "行").concat([
    { role: "user", text: "三点行吗", created_at: daysAgo(3),
      grade: { ok: true, errors: [], target: { used: true, ok: true } } }]),
  c3: [{ role: "drill", text: "wrong-word" },
       { role: "user", text: "我说对了", created_at: daysAgo(2),
         grade: { ok: true, errors: [] } }]
};
check(lex(mixed).filter(r => r.tag === "wrong-word")[0].credits === 2,
  "a category drill and a word drill under it both credit the tag",
  JSON.stringify(lex(mixed).filter(r => r.tag === "wrong-word")[0]));
check(lex(mixed).filter(r => r.tag === "wrong-word")[0].n === 0,
  "so two failures under it clear");

// credited(): an error-class tag gets no exemption once a word names the target.
check(M.credited({ ok: true, errors: [], target: { used: true, ok: false } },
                 "wrong-word", ["wrong-word"], "行") === false,
  "a wrong use of the drilled word earns nothing, error-class tag or not");
check(M.credited({ ok: true, errors: [], target: { used: false, ok: false } },
                 "wrong-word", ["wrong-word"], "行") === false,
  "a sentence that dodges the drilled word earns nothing");
check(M.credited({ ok: true, errors: [], target: { used: true, ok: true } },
                 "wrong-word", ["wrong-word"], "行") === true,
  "an attempted and correct use of the drilled word earns a credit");
check(M.credited({ ok: true, errors: [], target: { used: true, ok: false } },
                 "wrong-word", ["wrong-word"]) === true,
  "without a word the error-class fallback is unchanged: tag absence is credit");
check(M.credited({ ok: false, errors: [{ tag: "wrong-word" }] },
                 "wrong-word", ["wrong-word"], "行") === false,
  "a transcript with no stored verdict falls back to tag absence");

// --- needsMigration ---------------------------------------------------------
// Two kinds of work, counted separately because they cost differently: a
// message with no grade needs the full grader, a message graded before the
// word extraction existed needs only the cheap extraction.
const CLASS = ["wrong-word", "wrong-sense", "wrong-character", "unnatural"];
const need = msgs => M.needsMigration(msgs, CLASS);

check(need({ c1: [{ role: "user", text: "x", created_at: daysAgo(1) }] }).grades === 1,
  "a user message with no grade needs grading");
check(need({ c1: [{ role: "assistant", text: "x" }] }).grades === 0,
  "the partner's own turns are not graded");
check(need({ c1: [right(daysAgo(1))] }).grades === 0,
  "a graded message does not need grading again");

const oldClass = {
  c1: [{ role: "user", text: "我觉得行", created_at: daysAgo(1),
         grade: { ok: false, better: "我觉得可以",
                  errors: [{ tag: "wrong-word", note: "n" }] } }]
};
check(need(oldClass).words === 1,
  "an error-class error with no word needs the extraction");
check(need(oldClass).grades === 0,
  "and does not need re-grading -- the grade stands");

check(need({ c1: [{ role: "user", text: "x", created_at: daysAgo(1),
    grade: { ok: false, better: "y",
             errors: [{ tag: "wrong-word", note: "n", word: "行" }] } }] }).words === 0,
  "an error that already carries a word is done");
check(need({ c1: [{ role: "user", text: "x", created_at: daysAgo(1),
    grade: { ok: false, better: "y",
             errors: [{ tag: "measure-word", note: "n" }] } }] }).words === 0,
  "a structural tag names what to practise already and needs no extraction");
check(need({ c1: [{ role: "user", text: "x", created_at: daysAgo(1),
    grade: { ok: false, better: "",
             errors: [{ tag: "wrong-word", note: "n" }] } }] }).words === 0,
  "with no correction there is nothing to extract the word from");

// The whole reason the run never finished: "no single word is at fault" is what
// drillWord() asks for when the mistake is the order or the sentence as a
// whole, so an error can be done and still carry no word. Without `noword` it
// matches this scan on every pass and every press re-buys the same residue.
check(need({ c1: [{ role: "user", text: "x", created_at: daysAgo(1),
    grade: { ok: false, better: "y",
             errors: [{ tag: "wrong-word", note: "n", noword: true }] } }] }).words === 0,
  "an extraction that found no single word is done, not work again");
check(need({ c1: [{ role: "user", text: "x", created_at: daysAgo(1),
    grade: { ok: false, better: "y",
             errors: [{ tag: "wrong-word", note: "n", noword: true },
                      { tag: "unnatural", note: "n" }] } }] }).words === 1,
  "and a sibling error the extraction has not reached still counts");
check(need({ c1: [{ role: "user", text: "x", created_at: daysAgo(1),
    grade: { unreadable: true } }] }).words === 0,
  "an unreadable grade is not work either");
check(need({}).grades === 0 && need({}).words === 0,
  "an empty history needs nothing");
// Resumability: the counts fall as work lands, so a second press continues.
check(need({ c1: [{ role: "user", text: "x", created_at: daysAgo(1) },
                  right(daysAgo(1))] }).grades === 1,
  "a part-done history counts only what is left");

// --- ghost words ------------------------------------------------------------

// A graded user message. `ghost` is the per-word verdict map, omitted on the
// messages that predate the feature.
const gturn = (when, ok, ghost) => ({
  role: "user", text: "我说话", created_at: when,
  grade: ghost ? { ok: ok, errors: [], ghost: ghost } : { ok: ok, errors: [] }
});
const saysWord = () => ["说话"];

check(M.ghostVerdict({ ok: true, errors: [] }, "说话") === "ok",
  "no verdict and a clean sentence credits the word");
check(M.ghostVerdict({ ok: false, errors: [{ tag: "aspect-le" }] }, "说话") === "none",
  "no verdict and a failed sentence credits nothing");
check(M.ghostVerdict({ ok: false, ghost: { "说话": { used: true, ok: true } } },
  "说话") === "ok",
  "a correct word in a failing sentence credits: the verdict beats grade.ok");
check(M.ghostVerdict({ ok: true, ghost: { "说话": { used: true, ok: false } } },
  "说话") === "wrong",
  "a wrong word in a passing sentence is a failure: the verdict beats grade.ok");
check(M.ghostVerdict({ ok: true, ghost: { "说话": { used: false, ok: false } } },
  "说话") === "none",
  "a sentence that never reached for the word is neither credit nor failure");
check(M.ghostVerdict({ unreadable: true }, "说话") === "none",
  "an unreadable grade says nothing about any word");
check(M.ghostVerdict(null, "说话") === "none",
  "an ungraded message says nothing about any word");
check(M.ghostVerdict({ ok: true, ghost: { "米饭": { used: true, ok: false } } },
  "说话") === "ok",
  "a verdict about another word does not decide this one");

const gp = (turns) => M.ghostProgress(turns, saysWord);

check((gp([gturn("2026-09-01T10:00:00Z", true)])["说话"] || {}).n === 1,
  "one clean message is one credit");
check((gp([gturn("2026-09-01T10:00:00Z", true),
           gturn("2026-09-01T18:00:00Z", true)])["说话"] || {}).n === 1,
  "two credits on the same day count once");
check((gp([gturn("2026-09-01T10:00:00Z", true),
           gturn("2026-09-02T10:00:00Z", true),
           gturn("2026-09-03T10:00:00Z", true)])["说话"] || {}).n === 3,
  "three credits on three days count three");
check((gp([gturn("2026-09-01T10:00:00Z", true),
           gturn("2026-09-02T10:00:00Z", true),
           gturn("2026-09-03T10:00:00Z", false,
                 { "说话": { used: true, ok: false } })])["说话"] || {}).n === 1,
  "a wrong use demotes by one, it does not reset to zero");
check((gp([gturn("2026-09-01T10:00:00Z", false,
                 { "说话": { used: true, ok: false } })])["说话"] || {}).n === 0,
  "a demotion floors at zero rather than going negative");
check((gp([gturn("2026-09-01T10:00:00Z", true),
           gturn("2026-09-01T12:00:00Z", false,
                 { "说话": { used: true, ok: false } }),
           gturn("2026-09-01T14:00:00Z", true)])["说话"] || {}).n === 0,
  "a demotion followed by a same-day success does not re-earn that day");
// The cap runs both ways. Uncapped, this would be 0 -- three days of work undone
// in one afternoon, which is the reset rule RESEARCH.md rejects.
const gwrong = (when) => gturn(when, false, { "说话": { used: true, ok: false } });
check((gp([gturn("2026-09-01T10:00:00Z", true),
           gturn("2026-09-02T10:00:00Z", true),
           gturn("2026-09-03T10:00:00Z", true),
           gwrong("2026-09-04T10:00:00Z"), gwrong("2026-09-04T12:00:00Z"),
           gwrong("2026-09-04T14:00:00Z")])["说话"] || {}).n === 2,
  "three wrong uses in one day cost one credit, not three");
check((gp([gturn("2026-09-01T10:00:00Z", true),
           gturn("2026-09-02T10:00:00Z", true),
           gturn("2026-09-03T10:00:00Z", true),
           gwrong("2026-09-04T10:00:00Z"),
           gwrong("2026-09-05T10:00:00Z")])["说话"] || {}).n === 1,
  "and wrong uses on two days cost two");
check((gp([gturn("2026-09-03T10:00:00Z", true),
           gturn("2026-09-01T10:00:00Z", false,
                 { "说话": { used: true, ok: false } })])["说话"] || {}).n === 1,
  "the walk is ordered by timestamp, not by array order");
check((gp([gturn("2026-09-01T10:00:00Z", true)])["说话"] || {}).last === "2026-09-01",
  "last names the most recently credited day");
check(M.ghostProgress([{ role: "user", created_at: "2026-09-01T10:00:00Z",
                         grade: { ok: true, errors: [] } }],
  () => ["说话", "说话"])["说话"].n === 1,
  "a word repeated inside one message earns that message's single credit once");
check(Object.keys(gp([])).length === 0, "no messages is no progress");
check(M.dayKey("2026-09-01T10:00:00Z") === "2026-09-01",
  "dayKey is exported for the caller that needs today's key");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
