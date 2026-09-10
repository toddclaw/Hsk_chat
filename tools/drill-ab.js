/* A/B the mistakes-drill prompt against a real model.
 *
 * CLAUDE.md's rule: the suite can only check that the words are in the string,
 * and whether they WORK is a question about a model. The drill's whole claim is
 * elicitation -- that the partner steers the conversation so the target
 * structure has to appear in the LEARNER's own answer, which is production
 * practice rather than input. A partner that merely mentions 量词, or explains
 * it in English, has not drilled anything.
 *
 * Control is the shipped app: a learner who wants to practise measure words
 * today opens an ordinary chat. So the contrast is "chat" vs "drill" on the
 * same level, same length, same seed turn -- which is also the only contrast
 * that answers "does this activity earn its place".
 *
 * Two counters, per DEVELOPING.md -- one would be trusted too easily:
 *
 *   elicits    a judge model (not the model under test) labels each partner
 *              turn REQUIRES / OPTIONAL / NO: must a natural answer to this
 *              question use the target structure?
 *   validates  the reply survives the production retry-and-repair loop against
 *              the real HSK validator. A prompt that elicits perfectly and
 *              breaks the level has shipped nothing -- the out-of-level
 *              guarantee is the product.
 *
 * Name-free, per CLAUDE.md: ACTIVITIES.drill carries no cast, and the seed
 * turn below names nobody. 王 and 明 are above HSK 1 and would land in both
 * arms as noise, which is the mistake DEVELOPING.md records.
 *
 * Plain node, no dependencies, and never part of `test/run.sh`: it makes
 * network calls and costs money. The key is read out of a file OUTSIDE the
 * repo into a variable, never an argv element, never echoed.
 *
 *   node tools/drill-ab.js [--runs 4] [--level 3] [--model <id>] [--judge <id>]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const HSK = require("../validator.js");
const HSKPrompt = require("../prompt.js");

const ROOT = path.join(__dirname, "..");
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_FILE = process.env.OPENROUTER_KEY_FILE ||
  path.join(os.homedir(), "Documents", "openrouter_key.txt");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const RUNS = Number(arg("runs", 4));
const LEVEL = Number(arg("level", 3));
const MODEL = arg("model", "qwen/qwen3-30b-a3b-instruct-2507");
/* The judge is not the model under test: asking a model whether its own
 * question requires a structure is the same conflict story-ab.js avoids. */
const JUDGE = arg("judge", "anthropic/claude-sonnet-4.5");
const CONCURRENCY = Number(arg("concurrency", 4));
const ATTEMPTS = 3;  // S.attempts' shipped default in index.html.

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }

const LABELS = { 1: "HSK 1", 2: "HSK 2", 3: "HSK 3", 4: "HSK 4" };
const LABEL = LABELS[LEVEL] || ("HSK " + LEVEL);
const LENGTH = "short";

/* Five categories rather than one: the rule is generic over the tag, so
 * measuring 量词 alone would measure 量词. Spread across particle, negation,
 * comparison and disposal structures, all of them plausible at HSK 3. */
const TAGS = ["measure-word", "aspect-le", "negation-bu-mei", "comparison-bi", "de-particles"];

// Name-free, level-legal, and says nothing about any structure.
const SEED = "你好。";

const entries = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "hsk" + LEVEL + ".json"), "utf8"));
const baseLex = HSK.buildLexicon(entries);

/* The four arms isolate the two things that could be drowning the drill rule.
 * The first smoke run had the committed drill produce plain chat word for word
 * matching the prompt's own worked example -- the same failure prompt.js
 * already records for 20 Questions ("a few-shot example is a stronger signal
 * than a numbered rule"). Two suspects, so two independent switches:
 *
 *   chat      the shipped app. A learner drilling 量词 today just chats.
 *   converse  the drill exactly as committed: act.converse true, so rule 5
 *             ("answer, then share your own thing, then ask a new question")
 *             sits above the drill rule telling it to do something else.
 *   quiet     act.converse false, dropping rule 5. Few-shot still present.
 *   bare      quiet, and the chat few-shot exchange removed too.
 *   opening   quiet, plus an explicit first-turn instruction. Every reply in
 *             the first four-arm run opened with the prompt's own worked
 *             example almost verbatim -- the drill rule describes only what to
 *             do once a drill is under way and says nothing about the turn
 *             where there is nothing yet to react to. That is the identical
 *             defect tools/twenty-ab.js found and fixed with `opening`, so the
 *             instruction below is that one's wording with the guessing
 *             specifics dropped.
 *
 * The few-shot is stripped from the built string rather than gated in
 * prompt.js so the production file stays untouched until the run says which
 * change to make. */
const CHAT_FEWSHOT = "\n" + "学生：你喜欢喝茶吗？" + "\n" + "你：我很喜欢。我喜欢喝水。你喜欢吃什么？";
const OPENING = "现在马上问第一个问题，不要先打招呼，不要先说别的。";
const ALL_ARMS = ["chat", "converse", "quiet", "bare", "opening"];
// Narrow the arms once the field is down to the shipping decision: more
// samples on two candidates resolves more than a thin row for five.
const ARMS = String(arg("arms", ALL_ARMS.join(","))).split(",");

function systemFor(arm, tag) {
  if (arm === "chat") {
    return HSKPrompt.build({ level: LEVEL, label: LABEL, length: LENGTH, activity: "chat" });
  }
  HSKPrompt.ACTIVITIES.drill.converse = (arm === "converse");
  var s = HSKPrompt.build({
    level: LEVEL, label: LABEL, length: LENGTH, activity: "drill", drillTag: tag
  });
  HSKPrompt.ACTIVITIES.drill.converse = true;
  if (arm === "opening") {
    var mark = "学生今天要练习「";
    if (s.indexOf(mark) === -1) throw new Error("drill rule not found -- the splice is stale");
    s = s.replace(mark, OPENING + mark);
  }
  if (arm === "bare") {
    if (s.indexOf(CHAT_FEWSHOT) === -1) throw new Error("few-shot not found -- the strip is stale");
    s = s.replace(CHAT_FEWSHOT, "");
  }
  return s;
}

const NEED_RE = /\[\[NEED:([^\]|]+)(?:\|([^\]|]*))?(?:\|([^\]]*))?\]\]/g;
function extractNeeds(text) {
  const needs = [];
  NEED_RE.lastIndex = 0;
  const out = text.replace(NEED_RE, (_m, w) => {
    const word = String(w).trim();
    if (word && needs.indexOf(word) === -1) needs.push(word);
    return word;
  });
  return { text: out, needs: needs };
}

async function callModel(model, messages, maxTokens, temperature) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model, messages: messages, max_tokens: maxTokens,
      temperature: temperature, usage: { include: true }
    })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body.error && body.error.message) || ("HTTP " + r.status));
  const choice = (body.choices && body.choices[0]) || {};
  const txt = choice.message && choice.message.content;
  if (!txt) throw new Error("empty reply");
  return { text: txt.trim(), cost: (body.usage && body.usage.cost) || 0 };
}

// Abbreviated repairPrompt() from index.html: named violations, plus
// substitutes once the loop is on its last attempt.
function repairPrompt(violations, attempt) {
  const named = violations.map(v => "「" + v + "」").join("、");
  const parts = ["你用了" + named + "。这些词太难，学生不认识，不可以用。"];
  if (attempt >= ATTEMPTS) {
    violations.slice(0, 3).forEach(v => {
      const s = HSK.suggest(v, baseLex, 4).map(e => e.w);
      if (s.length) parts.push("「" + v + "」可以换成：" + s.join("、") + "。");
    });
    parts.push("只用最简单的词。");
  }
  return parts.join("");
}

/* The production loop, not a single sample: turn() already recovers from a
 * violation some of the time, so one-shot validate() understates what a user
 * actually sees. */
async function partnerTurn(systemContent) {
  const scratch = [{ role: "system", content: systemContent },
                   { role: "user", content: SEED }];
  let cost = 0, firstText = "", firstViolations = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = await callModel(MODEL, scratch, HSKPrompt.LENGTHS[LENGTH].maxTokens, 0.7);
    cost += res.cost;
    const ex = extractNeeds(res.text);
    const lex = ex.needs.length ? HSK.buildLexicon(entries, ex.needs.map(w => ({ w: w }))) : baseLex;
    // Name violations are excluded: neither arm asks for a name, and counting
    // them would measure the syllabus's missing name characters in both.
    const violations = HSK.validate(ex.text, lex).filter(v => !v.name);
    if (!violations.length) return { validated: true, attempts: attempt, text: ex.text, cost: cost };
    if (attempt === 1) { firstText = ex.text; firstViolations = violations.map(v => v.text); }
    scratch.push({ role: "assistant", content: res.text });
    scratch.push({ role: "user", content: repairPrompt(violations.map(v => v.text), attempt + 1) });
  }
  return { validated: false, attempts: ATTEMPTS, text: firstText,
           violations: firstViolations, cost: cost };
}

/* Deliberately asks about the LEARNER's answer, not about the partner's turn:
 * "does this question mention 量词" would score an explanation full marks, and
 * explanation is exactly what D10 says a drill is not. */
function judgePrompt(tag, text) {
  return "A Chinese teacher said this to a beginner student, who must now reply in Chinese.\n\n" +
    "TEACHER: " + text + "\n\n" +
    "Target structure: " + HSKPrompt.TAG_LABEL[tag] + " (" + HSKPrompt.TAG_ZH[tag] + ")\n\n" +
    "Question: to answer the teacher naturally and directly, would the student " +
    "have to USE that structure in their own reply?\n\n" +
    "Answer with exactly one of these words and nothing else:\n" +
    "REQUIRES - a natural direct answer cannot avoid the structure\n" +
    "OPTIONAL - the answer could reasonably use it or not\n" +
    "NO - answering does not involve the structure at all\n\nOne word:";
}

async function judge(tag, text) {
  const res = await callModel(JUDGE, [{ role: "user", content: judgePrompt(tag, text) }], 8, 0);
  const m = /REQUIRES|OPTIONAL|NO/.exec(res.text.toUpperCase());
  return { label: m ? m[0] : "UNPARSED", cost: res.cost };
}

async function pool(tasks, n) {
  const out = [];
  let i = 0, done = 0;
  async function worker() {
    while (i < tasks.length) {
      const mine = i++;
      try { out[mine] = await tasks[mine](); }
      catch (e) { out[mine] = { error: e.message }; }
      done++;
      process.stderr.write("\r" + done + "/" + tasks.length + " ");
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  process.stderr.write("\n");
  return out;
}

const pad = (s, n) => String(s) + " ".repeat(Math.max(1, n - String(s).length));

(async function main() {
  /* Arms interleaved, per DEVELOPING.md, "Compare arms only within a run": a
   * provider-side change part way through would otherwise land entirely on one
   * bucket and read as an effect. */
  const tasks = [];
  for (let i = 0; i < RUNS; i++) {
    TAGS.forEach(tag => ARMS.forEach(arm => {
      tasks.push(() => partnerTurn(systemFor(arm, tag))
        .then(v => Object.assign({ arm: arm, tag: tag }, v))
        .catch(e => ({ arm: arm, tag: tag, error: e.message })));
    }));
  }
  console.error("model=" + MODEL + " judge=" + JUDGE + " level=" + LEVEL +
    " runs=" + RUNS + " tags=" + TAGS.length + " arms=" + ARMS.length +
    " samples=" + tasks.length +
    " (each up to " + ATTEMPTS + " real calls -- the production retry loop)");
  const rows = await pool(tasks, CONCURRENCY);

  // Judged after generation so a judge failure cannot abort a turn mid-way.
  console.error("judging…");
  const jtasks = rows.filter(r => r && !r.error).map(r => () =>
    judge(r.tag, r.text).then(j => { r.label = j.label; return j.cost; })
      .catch(e => { r.label = "ERROR"; return 0; }));
  const judgeCosts = await pool(jtasks, CONCURRENCY * 2);

  console.log("");
  console.log(pad("arm", 8) + pad("n", 5) + pad("REQUIRES", 10) + pad("OPTIONAL", 10) +
    pad("NO", 6) + "validated");
  const seen = {};
  ARMS.forEach(arm => {
    const ok = rows.filter(r => r && r.arm === arm && !r.error);
    seen[arm] = ok;
    const lab = l => ok.filter(r => r.label === l).length;
    console.log(pad(arm, 8) + pad(ok.length, 5) +
      pad(lab("REQUIRES"), 10) + pad(lab("OPTIONAL"), 10) + pad(lab("NO"), 6) +
      ok.filter(r => r.validated).length + "/" + ok.length);
  });

  console.log("\nby category (REQUIRES / n):");
  console.log(pad("tag", 24) + ARMS.map(a => pad(a, 10)).join(""));
  TAGS.forEach(tag => {
    const cell = arm => {
      const ok = seen[arm].filter(r => r.tag === tag);
      return ok.filter(r => r.label === "REQUIRES").length + "/" + ok.length;
    };
    console.log(pad(tag, 24) + ARMS.map(a => pad(cell(a), 10)).join(""));
  });

  const worst = ARMS[ARMS.length - 1];
  console.log("\n" + worst + "-arm turns the judge did not score REQUIRES:");
  seen[worst].filter(r => r.label !== "REQUIRES").slice(0, 10).forEach(r =>
    console.log("  [" + r.label + " " + r.tag + "] " + r.text.replace(/\n/g, " / ")));
  const fellBack = rows.filter(r => r && !r.error && !r.validated);
  if (fellBack.length) {
    console.log("\nfell back after " + ATTEMPTS + " attempts:");
    fellBack.slice(0, 10).forEach(r => console.log("  [" + r.arm + " " + r.tag + "] " +
      r.text.replace(/\n/g, " / ") + " [" + (r.violations || []).join(",") + "]"));
  }
  const errs = rows.filter(r => r && r.error);
  if (errs.length) console.log("\n" + errs.length + " errors, first: " + errs[0].error);

  const cost = rows.reduce((a, r) => a + ((r && r.cost) || 0), 0) +
    judgeCosts.filter(c => typeof c === "number").reduce((a, c) => a + c, 0);
  console.log("\ncost: $" + cost.toFixed(6));

  const out = path.join(__dirname, "drill-ab-results.json");
  fs.writeFileSync(out, JSON.stringify(
    { model: MODEL, judge: JUDGE, level: LEVEL, runs: RUNS, when: new Date().toISOString(), rows: rows }, null, 2));
  console.log("rows written to " + path.relative(ROOT, out));
})();
