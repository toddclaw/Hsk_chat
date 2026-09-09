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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
