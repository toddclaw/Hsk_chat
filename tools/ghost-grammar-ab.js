/* A/B the Ghost Words grammar-word contradiction against a real model.
 *
 * The defect, found by reading an explanation rather than a diff. At HSK 2
 * working up into 3, pacing had taught 被 把 为了 放 生活; none had ever been
 * produced, so Ghost Words targeted them and turn() made 被 a hard condition of
 * the reply. The system prompt then said both of these, four rules apart:
 *
 *   3.  可以用「了」「过」…。还不要用：把、被、难的动词补语。
 *   13. 学生最近学了这些词，请多用：被、把、为了、放、生活、手表。
 *
 * ...and, because the demand was nested inside `if (offer.length)` while Ghost
 * Words carries newWords:false, rule 12 was never printed at all -- the word
 * was enforced in turn()'s retry loop and never asked for in the prompt. What
 * shipped to the screen was 我的书被我放在桌子上了。为了生活好，我把手表也放好。
 * 你被妈妈帮忙过吗？ -- the character 被 present three times, 被字句 absent all
 * three: reflexive agent, then bolted onto 帮忙, which is intransitive and
 * cannot passivise at all. Every word validated. Vocabulary was never the
 * problem.
 *
 * ROUND ONE, three arms, 20 runs each, end-to-end usable replies:
 *
 *   v103    demand unstated, ban intact   (as shipped)      1/20   5%
 *   stated  demand stated,   ban intact   (#1)             11/20  55%
 *   fixed   demand stated,   ban lifted   (#1 + #2)         4/20  20%
 *
 *   v103 -> stated   p = 0.0012     stated -> fixed  p = 0.0484
 *
 * `stated` was in that round to be FALSIFIED: printing a demand for 被 under a
 * rule forbidding 被 should have raised compliance with the letter of the
 * requirement while leaving the Chinese as bad or worse. It did the opposite,
 * and lifting the ban -- the obvious repair for the contradiction -- undid most
 * of the gain. See the arm comment below for round two, which is what this file
 * now runs. Round one's numbers are kept here because the conclusion depends on
 * both rounds and the arms are not all re-run.
 *
 * Counted, not read (DEVELOPING.md's rule). Four measures per reply:
 *
 *   used       the required word is in the reply at all
 *   validates  survives the real repair loop against a real lexicon
 *   wellformed 被 is in a genuine 被字句 -- judged, see judge() below
 *   attempts   how many calls the loop spent getting there
 *
 * `used` and `wellformed` are the pair that matters. The failure mode here is
 * not refusal, it is compliance with the token and not the structure, so an arm
 * can score 10/10 on `used` and 2/10 on `wellformed` and that IS the bug.
 *
 * Plain node, no dependencies, and never part of test/run.sh: it makes network
 * calls and costs money. The key is read out of a file OUTSIDE the repo into a
 * variable, never an argv element, never echoed.
 *
 *   node tools/ghost-grammar-ab.js [--runs 30] [--model <id>] [--concurrency 6]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const HSK = require("../validator.js");
const HSKPrompt = require("../prompt.js");
const HSKPace = require("../pace.js");

const ROOT = path.join(__dirname, "..");
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_FILE = process.env.OPENROUTER_KEY_FILE ||
  path.join(os.homedir(), "Documents", "openrouter_key.txt");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const RUNS = Number(arg("runs", 12));
// The chat model in the session that produced the defect, not the repo default.
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");
const CONCURRENCY = Number(arg("concurrency", 4));
const ATTEMPTS = 3; // S.attempts' shipped default in index.html.

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }

const LEVEL = 2, LABEL = "HSK 2", LENGTH = "medium";
const REQUIRE = "被";
/* The learner's actual ghost list, in the order reuseFor() would have produced
 * it. All but 手表 are HSK 3 -- which is the whole point: they were taught ahead
 * of the level by pacing, which is what makes them bannable and demandable at
 * once. */
const GHOSTS = ["被", "把", "为了", "放", "生活", "手表"];

/* The lexicon the app would have had: the level, plus every above-level word
 * pacing has taught. Without the second half validate() rejects 被 as out of
 * level and the repair loop deletes the very thing being measured. */
const entries = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "hsk" + LEVEL + ".json"), "utf8"));
const ahead = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "hsk3.json"), "utf8"))
  .filter(e => GHOSTS.indexOf(e.w) !== -1);
const lex = HSK.buildLexicon(entries.concat(ahead));

/* The two forms of the HSK 2 grammar rule, as literal text.
 *
 * Built by a helper in the branch that was measured; inlined once that helper
 * was reverted -- which is the better shape for an archival harness anyway. It
 * pins the exact wording the numbers below came from, so a later edit to
 * LEVEL_STYLE cannot silently change what this reproduces. BANNED is asserted
 * against the live prompt in systemFor(): if it stops matching, this script has
 * drifted from the app and says so rather than measuring the wrong thing. */
const BANNED = "可以用「了」「过」「在…呢」「一点儿」「比」。还不要用：把、被、难的动词补语。";
const LIFTED = "可以用「了」「过」「在…呢」「一点儿」「比」。还不要用：难的动词补语。";

/* Round two: a 2x2 over the two things that could be making 被 come out well.
 *
 * Round one said the BAN is what does it. Told 被 is forbidden and required at
 * once, the partner used it once, in the safest passive it knows -- 被猫吃了一
 * 点儿, 被朋友拿走了 -- and scored 11/20 end to end. Lift the ban and it scored
 * 4/20, chaining 把 and 被 into two-clause sentences and cramming four ghost
 * words a reply instead of three. The prohibition was not working as a
 * prohibition. It was working as a difficulty warning, and removing it removed
 * the caution along with the restriction.
 *
 * Which leaves the question this round exists to answer: was the warning doing
 * the work, or was the restriction? If the caution can be stated OUT LOUD, the
 * ban can come off -- which is what the learner wanted in the first place, since
 * a partner that avoids 被字句 is a partner that never models the grammar he is
 * trying to reach. So: ban on/off, crossed with the caution stated/unstated.
 *
 *   stated      ban on,  caution implicit   (round one's winner, and the
 *                                            replication control -- it should
 *                                            land near 11/20 again)
 *   fixed       ban off, caution implicit   (round one's loser)
 *   statedCare  ban on,  caution explicit   (can explicit beat accidental?)
 *   liftedCare  ban off, caution explicit   (the one that matters: does saying
 *                                            it out loud buy back what lifting
 *                                            the ban costs?)
 *
 * CARE deliberately names no verb and no pattern. DEVELOPING.md's 心里 case --
 * a word lifted out of the rule text into every reply -- is the reason: seed it
 * with 拿走了 or 吃了 and the partner echoes exactly the forms the judge scores
 * GOOD, and the arm measures nothing but its own answer key. It also stops short
 * of enumerating the judge's four BAD criteria, for the same reason. What it
 * states is the thing the ban was communicating by accident and nothing more:
 * this is hard, get it right, back off if you are unsure. */
const CARE = "用「被」的时候一定要用对。你不确定对不对，就换一个更简单的说法。";

/* The shipped prompt now carries BANNED (the ban was never lifted -- that is
 * the finding), so the arms that need it lifted patch it out rather than in. */
const ARMS = {
  stated:     p => p,
  fixed:      p => p.replace(BANNED, LIFTED),
  statedCare: p => addCare(p),
  liftedCare: p => addCare(p.replace(BANNED, LIFTED))
};

/* Hung off the end of the demand rather than added as a rule of its own: the
 * caution is about the required word, it belongs in the same breath as the
 * requirement, and appending leaves every other rule at the number the other
 * arms give it. */
function addCare(p) {
  return p.split("\n")
    .map(l => l.includes("一定要用「") ? l + CARE : l)
    .join("\n");
}

function systemFor(armName) {
  const p = HSKPrompt.build({
    level: LEVEL, label: LABEL, length: LENGTH, activity: "focused",
    reuse: GHOSTS.map(w => ({ w: w })), require: REQUIRE, offer: []
  });
  if (p.indexOf(BANNED) === -1) {
    throw new Error("the shipped HSK 2 grammar rule no longer matches BANNED -- " +
                    "this harness has drifted from prompt.js");
  }
  const out = ARMS[armName](p);
  const wantsBan = armName === "stated" || armName === "statedCare";
  if (wantsBan && !out.includes(BANNED)) {
    throw new Error("arm " + armName + ": ban did not reapply -- check LIFTED/BANNED");
  }
  if (!wantsBan && !out.includes(LIFTED)) {
    throw new Error("arm " + armName + ": ban should be lifted and is not");
  }
  const wantsCare = armName.indexOf("Care") !== -1;
  if (wantsCare !== out.includes(CARE)) {
    throw new Error("arm " + armName + ": CARE placement wrong");
  }
  if (!out.includes("一定要用「")) {
    throw new Error("arm " + armName + ": the demand is missing");
  }
  return out;
}

/* An opener that neither supplies 被 nor blocks it: the partner has to build a
 * context for it. Validates clean at HSK 2 on its own. */
const OPENER = "我昨天去了朋友家。我们一起吃了饭，很高兴。你昨天做什么了？";

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

let spend = 0;
async function callModel(messages, maxTokens, temperature) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, messages: messages,
      max_tokens: maxTokens || HSKPrompt.LENGTHS[LENGTH].maxTokens,
      temperature: temperature === undefined ? 0.7 : temperature,
      usage: { include: true }
    })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body.error && body.error.message) || ("HTTP " + r.status));
  const choice = (body.choices && body.choices[0]) || {};
  const txt = choice.message && choice.message.content;
  spend += (body.usage && body.usage.cost) || 0;
  if (!txt) throw new Error("empty reply");
  return txt.trim();
}

// index.html's repairPrompt(), abbreviated the same way the other harnesses do.
function repairPrompt(violations, attempt) {
  const named = violations.map(v => "「" + v + "」").join("、");
  const parts = ["你用了" + named + "。这些词太难，学生不认识，不可以用。"];
  if (attempt >= ATTEMPTS) parts.push("只用简单的词。");
  return parts.join("");
}

/* Whether 被 is doing its job or is merely present.
 *
 * Judged, because no regex separates 书被我放在桌子上了 from 书被他拿走了 -- both
 * are [N 被 N V], and the difference is whether the agent is distinct from the
 * speaker and whether the verb can passivise at all. Asked as a single forced
 * token with the reasons enumerated, rather than a free-text verdict later
 * grepped: the enumerated version is the one that catches 被+帮忙, which a
 * "does this sound natural" phrasing passes about half the time.
 *
 * Temperature 0, and the judge is never told which arm wrote the sentence. */
async function judge(text) {
  const verdict = await callModel([{
    role: "user",
    content:
      "Here is a Chinese sentence or short passage written for a beginner learner:\n\n" +
      text + "\n\n" +
      "Question: is 被 used to form a grammatical 被字句?\n\n" +
      "Answer BAD if any of these is true:\n" +
      "- the agent after 被 is the same person as the subject (a reflexive passive)\n" +
      "- the verb after 被 is intransitive and cannot passivise (帮忙, 见面, 睡觉, 结婚)\n" +
      "- 被 has no verb phrase after it, or the verb lacks a required result/aspect\n" +
      "- the passive is grammatical but no native speaker would use it here\n" +
      "- 被 does not appear in the passage at all\n\n" +
      "Answer GOOD only if every 被 in the passage forms a well-made passive that a " +
      "native speaker would actually say.\n\n" +
      "Reply with exactly one word, GOOD or BAD, and nothing else."
  }], 8, 0);
  return /GOOD/i.test(verdict);
}

/* One turn through the shipped loop: validate, repair, re-ask for the required
 * word, up to ATTEMPTS. Mirrors turn() in index.html closely enough that a
 * result here means what it means in the app. */
async function oneRun(armName) {
  const scratch = [
    { role: "system", content: systemFor(armName) },
    { role: "user", content: OPENER }
  ];
  let best = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let raw;
    try { raw = await callModel(scratch); }
    catch (e) { return { error: String(e.message || e), attempts: attempt }; }
    const ex = extractNeeds(raw);
    const violations = HSK.validate(ex.text, lex).filter(v => !v.name).map(v => v.text);
    if (violations.length) {
      scratch.push({ role: "assistant", content: raw });
      scratch.push({ role: "user", content: repairPrompt(violations, attempt + 1) });
      continue;
    }
    best = { text: ex.text, attempts: attempt, validates: true };
    const has = HSKPace.spot(HSK.segment(ex.text, lex), [REQUIRE]).length > 0;
    if (has) return Object.assign(best, { used: true });
    if (attempt < ATTEMPTS) {
      scratch.push({ role: "assistant", content: raw });
      scratch.push({ role: "user", content:
        "请一定要用「" + REQUIRE + "」这个词，放在一句话里，再说一次。其他的规则不变。" });
      continue;
    }
    return Object.assign(best, { used: false });
  }
  // Attempts exhausted with violations outstanding: the app shows a fallback.
  return best ? Object.assign(best, { used: false })
              : { validates: false, used: false, attempts: ATTEMPTS };
}

async function pool(jobs, width) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await jobs[i]();
    }
  }));
  return out;
}

(async function main() {
  const names = Object.keys(ARMS);
  console.log("model: " + MODEL + "  runs: " + RUNS + "/arm  level: " + LABEL +
              "  required: " + REQUIRE);
  console.log("ghosts: " + GHOSTS.join("、") + "\n");

  const results = {};
  for (const armName of names) {
    const rows = await pool(
      Array.from({ length: RUNS }, () => () => oneRun(armName)), CONCURRENCY);
    for (const r of rows) {
      if (r.used && r.text) r.wellformed = await judge(r.text);
    }
    results[armName] = rows;
  }

  const pct = (n, d) => d ? (100 * n / d).toFixed(0) + "%" : "--";
  console.log("arm        used      validates  wellformed  mean attempts  errors");
  for (const armName of names) {
    const rows = results[armName];
    const ok = rows.filter(r => !r.error);
    const used = ok.filter(r => r.used);
    const wf = used.filter(r => r.wellformed);
    const mean = ok.length
      ? (ok.reduce((s, r) => s + r.attempts, 0) / ok.length).toFixed(1) : "--";
    console.log(
      armName.padEnd(11) +
      (used.length + "/" + ok.length + " " + pct(used.length, ok.length)).padEnd(10) +
      (ok.filter(r => r.validates).length + "/" + ok.length).padEnd(11) +
      (wf.length + "/" + used.length + " " + pct(wf.length, used.length)).padEnd(12) +
      String(mean).padEnd(15) +
      rows.filter(r => r.error).length);
  }

  console.log("\n--- replies ---");
  for (const armName of names) {
    console.log("\n[" + armName + "]");
    for (const r of results[armName]) {
      if (r.error) { console.log("  ERROR " + r.error); continue; }
      const mark = !r.used ? "no-被 " : r.wellformed ? "GOOD  " : "BAD   ";
      console.log("  " + mark + (r.text || "(no legal reply)"));
    }
  }
  console.log("\nspend: $" + spend.toFixed(4));

  /* A short run must not overwrite the archival file. It did once: a --runs 1
   * smoke test replaced two rounds of results with four rows, and the write-up
   * next door went on citing numbers its own raw data no longer contained. */
  const out = path.join(__dirname, RUNS >= 10
    ? "ghost-grammar-ab-results.json" : "ghost-grammar-ab-smoke.json");
  const prior = RUNS >= 10 && fs.existsSync(out)
    ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
  fs.writeFileSync(out, JSON.stringify(Object.assign({}, prior, {
    model: MODEL, runs: RUNS, level: LABEL, require: REQUIRE, ghosts: GHOSTS,
    when: new Date().toISOString(), results: results
  }), null, 2));
  console.log("written: " + path.relative(ROOT, out));
})();
