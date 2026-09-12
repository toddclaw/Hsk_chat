/* Progress report aggregation. Run: node test/report.test.js */
const R = require("../report.js");
const V = require("../validator.js");
const HSK1 = require("../data/hsk1.json");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

const NOW = Date.parse("2026-09-11T12:00:00Z");
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();

// A graded user message. `ok` is the whole-sentence verdict.
const turn = (when, ok, text) => ({
  role: "user", text: text || "我吃饭", created_at: when,
  grade: { ok: ok, errors: [] }
});

// The input brief() needs, with sensible empties. Override what a test cares about.
const input = (over) => Object.assign({
  chatMsgs: {}, chats: [], learning: [], tags: [], ghost: {}, ghostUses: 3,
  level: 1, goalLevel: 4, coverage: { read: 0, use: 0 },
  minutes: 0, since: null, now: NOW
}, over || {});

// --- graded turns ----------------------------------------------------------

check(R.gradedTurns({ a: [turn(daysAgo(1), true)] }).length === 1,
  "a graded user message is a graded turn");
check(R.gradedTurns({ a: [{ role: "assistant", text: "x", created_at: daysAgo(1) }] })
  .length === 0, "the partner's messages are not");
check(R.gradedTurns({ a: [{ role: "user", text: "x", created_at: daysAgo(1) }] })
  .length === 0, "and neither is an ungraded message: nothing is known about it");
check(R.gradedTurns({ a: [turn(daysAgo(1), true)], b: [turn(daysAgo(2), true)] })
  .length === 2, "turns are gathered across every conversation");
check(R.gradedTurns({ a: [turn(daysAgo(1), true, "new")],
                      b: [turn(daysAgo(9), true, "old")] })[0].text === "old",
  "and returned oldest first, whatever order the conversations came in");

// --- the all-time brief ----------------------------------------------------

const b1 = R.brief(input({
  chatMsgs: { a: [turn(daysAgo(1), true), turn(daysAgo(2), false),
                  turn(daysAgo(3), true)] }
}));
check(b1.messages.graded === 3, "every graded message counts", JSON.stringify(b1.messages));
check(b1.messages.clean === 2, "and the clean ones are counted separately");
check(b1.since === null, "an all-time brief echoes a null baseline");
check(R.brief(input({ learning: [{ w: "苹果" }, { w: "说话" }] })).words.met === 2,
  "words the app has taught are counted, however long ago it taught them");

// --- explicit zeroes -------------------------------------------------------

check(b1.activities.story === 0 && b1.activities.twenty === 0 &&
      b1.activities.drill === 0,
  "an untouched activity is a zero, never an absent key: a model handed a gap fills it",
  JSON.stringify(b1.activities));
check(Object.keys(b1.activities).length === 5,
  "all five activities are always present", JSON.stringify(b1.activities));

const b2 = R.brief(input({
  chats: [{ id: "a", activity: "focused" }, { id: "b", activity: "story" },
          { id: "c", activity: "focused" }],
  chatMsgs: { a: [turn(daysAgo(1), true)], b: [turn(daysAgo(1), true)],
              c: [turn(daysAgo(1), true)] }
}));
check(b2.activities.focused === 2 && b2.activities.story === 1 &&
      b2.activities.chat === 0,
  "conversations are counted by their activity", JSON.stringify(b2.activities));

// --- ghost words -----------------------------------------------------------

const b3 = R.brief(input({
  ghost: { "苹果": { n: 3, last: "2026-09-10" },
           "说话": { n: 1, last: "2026-09-09" },
           "可以": { n: 0, last: "" } },
  ghostUses: 3
}));
check(b3.ghost.credits === 4, "ghost credits are summed across every word",
  JSON.stringify(b3.ghost));
check(b3.ghost.retired === 1, "a word at the threshold is retired");
check(b3.ghost.working === 1,
  "a word part-way there is in progress; one at zero is neither");

// --- tags ------------------------------------------------------------------

const b4 = R.brief(input({
  tags: [{ tag: "aspect-le", n: 5, eg: "a", better: "b", note: "n" },
         { tag: "measure-word", n: 3, eg: "c", better: "d", note: "n" },
         { tag: "order", n: 2, eg: "e", better: "f", note: "n" },
         { tag: "tone", n: 1, eg: "g", better: "h", note: "n" }]
}));
check(b4.tags.length === 3, "at most three categories reach the brief",
  JSON.stringify(b4.tags));
check(b4.tags[0].tag === "aspect-le", "commonest first, as counts() already sorted them");
check(b4.tags[0].note === undefined,
  "and only the fields the prompt uses: the note is the grader talking to the learner, not to us",
  JSON.stringify(b4.tags[0]));


// --- the baseline ----------------------------------------------------------

// 12 graded messages, one a day, days 1..12 back.
const many = {};
many.a = [];
for (let i = 1; i <= 12; i++) many.a.push(turn(daysAgo(i), true));

const bl1 = R.baselineFor(many, daysAgo(20));
check(bl1.since === daysAgo(20) && bl1.enough === true,
  "plenty of new messages since the last report: that report is the baseline",
  JSON.stringify(bl1));

const bl2 = R.baselineFor(many, daysAgo(3));
check(bl2.enough === false,
  "too few since the last report: refuse rather than paraphrase the last one",
  JSON.stringify(bl2));
check(bl2.newTurns === 3,
  "and say how many there were, so the refusal can name a number", JSON.stringify(bl2));

const bl3 = R.baselineFor(many, null);
check(bl3.since === null && bl3.enough === true,
  "no previous report at all is never a refusal: it is the first report, and it covers everything",
  JSON.stringify(bl3));

check(R.baselineFor({}, daysAgo(30)).enough === false,
  "an empty history refuses too, rather than reporting on nothing");

// The floor is a count of messages, not a span of time. Three days away from
// the app and three days of hard practice must not produce the same answer.
const busy = { a: [] };
for (let i = 0; i < 15; i++) busy.a.push(turn(daysAgo(1), true));
check(R.baselineFor(busy, daysAgo(2)).enough === true,
  "one hard day clears the floor, though barely any time has passed");

/* The bug this replaced: a second press straight after a report widened to a
 * fourteen-day window and spent a real call rewriting the same history with
 * small changes. Nothing new has happened, so nothing is what it must say. */
check(R.baselineFor(many, daysAgo(0)).enough === false,
  "pressing again immediately refuses: a call that paraphrases last week is worse than no call");
check(R.WINDOW_DAYS === undefined,
  "and the widening window is gone rather than left dead in the module");

// --- samples ---------------------------------------------------------------

// A graded message carrying a specific error tag.
const flawed = (when, tag, text) => ({
  role: "user", text: text, created_at: when,
  grade: { ok: false, errors: [{ tag: tag, note: "n" }] }
});

const sTurns = R.gradedTurns({ a: [
  turn(daysAgo(9), true, "旧的好句子"),
  turn(daysAgo(1), true, "新的好句子"),
  flawed(daysAgo(2), "aspect-le", "我吃饭了吗"),
  flawed(daysAgo(8), "measure-word", "一个书")
] });
const picks = R.pickSamples(sTurns, [{ tag: "aspect-le", n: 4 }]);

check(picks.length <= R.SAMPLES, "never more than SAMPLES sentences",
  JSON.stringify(picks));
check(picks.some(p => p.text === "新的好句子" && p.ok === true),
  "the most recent clean sentence is quoted: it is the win",
  JSON.stringify(picks));
check(picks.some(p => p.text === "我吃饭了吗" &&
                      p.tag === "aspect-le"),
  "so is a recent sentence in the category they miss most",
  JSON.stringify(picks));
check(!picks.some(p => p.text === "旧的好句子"),
  "the older clean sentence loses to the newer one: recent evidence or none",
  JSON.stringify(picks));
check(R.pickSamples([], [{ tag: "aspect-le", n: 4 }]).length === 0,
  "no history is no samples, not a crash");
check(R.pickSamples(sTurns, []).length > 0,
  "no mistake categories at all still yields the clean sentence");
check(R.pickSamples(sTurns, [{ tag: "aspect-le", n: 4 }])
  .every(p => typeof p.text === "string" && typeof p.ok === "boolean"),
  "every sample is shaped the same, so the prompt builder needs no special cases");

// --- the Chinese line ------------------------------------------------------

// Every line the module can produce, at HSK 1, checked against the real
// allowlist. This is what makes "valid by construction" a fact rather than a
// claim -- there is no runtime validation anywhere in this path, so if a
// template ever drifts above HSK 1 this is the only thing that will notice.
/* validate() returns an ARRAY of violations -- empty means legal. It does not
 * return an object with .ok; that mistake costs an afternoon. */
const lex1 = V.buildLexicon(HSK1);
const violations = (line) => V.validate(line, lex1);
const lines = [
  R.chineseLine(R.brief(input())),
  R.chineseLine(R.brief(input({ ghost: { "苹果": { n: 3, last: "x" } },
                                ghostUses: 3 }))),
  R.chineseLine(R.brief(input({
    chatMsgs: { a: [turn(daysAgo(1), true), turn(daysAgo(2), true)] } }))),
  R.chineseLine(R.brief(input({ minutes: 45 })))
];
lines.forEach(function (line, i) {
  const v = violations(line);
  check(v.length === 0, "Chinese line " + i + " is inside HSK 1: " + line,
    JSON.stringify(v.map(x => x.text)));
});
check(lines.every(l => l && l.length > 0),
  "there is always a line, even for a learner who has done nothing yet");
check(new Set(lines).size > 1,
  "and it is not the same sentence every time, or it is decoration rather than feedback");

// --- tapped starters are not the learner's writing -------------------------

/* Todd's report quoted a starter chip back at him as a sentence he had written
 * well. He had not written it: he tapped it because he did not recognise the
 * characters and was curious. Starters are app-authored, so they grade clean
 * every time -- a free pass into the clean count and into the quoted evidence. */
const STARTER = "\u4f60\u597d\uff01";
const mixed = { a: [turn(daysAgo(2), true, STARTER), turn(daysAgo(1), true, "\u6211\u5403\u996d")] };

check(R.gradedTurns(mixed, null, [STARTER]).length === 1,
  "a tapped starter is not a graded turn, however cleanly it graded");
check(R.gradedTurns(mixed, null, [STARTER])[0].text === "\u6211\u5403\u996d",
  "the learner's own sentence survives the filter");
check(R.gradedTurns(mixed, null).length === 2,
  "and with no starter list nothing is excluded: the caller supplies the chips");

const bs = R.brief(input({ chatMsgs: mixed, starters: [STARTER] }));
check(bs.messages.graded === 1 && bs.messages.clean === 1,
  "the counts exclude it too, so 'sentences they wrote themselves' is true",
  JSON.stringify(bs.messages));

check(!R.pickSamples(R.gradedTurns(mixed, null, [STARTER]), [])
       .some(p => p.text === STARTER),
  "and it can never be quoted back as their own good sentence");

/* The floor routes through the same gate: tapping ten chips is not a sitting. */
const allStarters = { a: [] };
for (let i = 0; i < 12; i++) allStarters.a.push(turn(daysAgo(i + 1), true, STARTER));
check(R.baselineFor(allStarters, daysAgo(20), [STARTER]).enough === false,
  "tapping twelve starters does not clear the floor: none of it was theirs");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
