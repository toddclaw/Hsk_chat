/* A/B the 20 Questions opening-turn instruction against a real model.
 *
 * The role rule (build()'s activityRules(), twenty branch) only ever
 * described REACTIVE behavior -- what to ask, how to count, when to reveal --
 * and said nothing about the very first turn, where there is nothing yet to
 * react to. A first run of this harness (testing a since-shipped, unrelated
 * fix -- the worked example's contradicting exchange) turned up the real
 * defect by accident: every guesser opening reply, in every arm, was plain
 * small talk with no sign a game had started (0/8, twice over), and the
 * answerer's opening reliability was worse than a too-loose "does it contain
 * 吗" check made it look.
 *
 * `opening: true` states the first-turn behavior explicitly instead of
 * asking the model to infer "is this my first message" from an empty
 * transcript. This compares that against the same prompt with `opening:
 * false` (what shipped before this fix) on the opening turn -- no prior
 * student message, exactly what openingTurn() sends -- for both roles. The
 * "reply" shape (student already asked a clean yes/no question) is not
 * re-tested here: an earlier run already found both arms answer that
 * correctly, and `opening` changes nothing about it.
 *
 * Plain node, no dependencies, and never part of `test/run.sh`: it makes
 * network calls and costs money. The key is read out of a file OUTSIDE the
 * repo into a variable, never an argv element, never echoed.
 *
 *   node tools/twenty-ab.js [--runs 8] [--model <id>]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const HSKPrompt = require("../prompt.js");

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_FILE = process.env.OPENROUTER_KEY_FILE ||
  path.join(os.homedir(), "Documents", "openrouter_key.txt");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const RUNS = Number(arg("runs", 8));
const MODEL = arg("model", "qwen/qwen3-30b-a3b-instruct-2507");
const CONCURRENCY = Number(arg("concurrency", 4));

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }

const LEVEL = 1, LABEL = "HSK 1", LENGTH = "short";
const SECRET = "苹果";

function opensysPrompt(side, opening) {
  return HSKPrompt.build({
    level: LEVEL, label: LABEL, length: LENGTH, activity: "twenty", side: side,
    secret: side === "guesser" ? SECRET : undefined, opening: opening
  });
}

async function callModel(systemContent) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: systemContent }],
      max_tokens: HSKPrompt.LENGTHS[LENGTH].maxTokens,
      temperature: 0.7,
      usage: { include: true }
    })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body.error && body.error.message) || ("HTTP " + r.status));
  const choice = (body.choices && body.choices[0]) || {};
  const txt = choice.message && choice.message.content;
  if (!txt) throw new Error("empty reply");
  return { text: txt.trim(), cost: (body.usage && body.usage.cost) || 0 };
}

/* "In character", counted rather than read (DEVELOPING.md's rule). Both
 * checks require a marker tied to the GUESSING frame specifically, not just
 * "is grammatically a yes/no question" -- an earlier version of this script
 * scored "你吃饭了吗？" (ordinary chat, uses 吗) the same as "这是第一个问题，
 * 是吃的吗？" (an actual guess), which overcounted the answerer arm's
 * success and hid the real gap.
 *
 * - answerer: must ask a yes/no question (吗/是不是/对不对/有没有 + ？) AND
 *   reference the thing or the count (心里想/东西/猜/第N个问题) -- otherwise
 *   an ordinary "did you eat" question would pass.
 * - guesser: on the opening turn there is nothing to answer yet, so the bar
 *   is different -- it must announce readiness/invite questions, not
 *   silently pass by default the way an earlier version of this script did.
 *   Widened once already after a real run: the model's actual phrasings
 *   ("我有一个东西，你问是或不是" -- "I have a thing, you ask yes-or-no")
 *   did not match a first guess at the wording ("想好", "是非问题"). */
function inCharacter(side, text) {
  if (side === "answerer") {
    const yesNo = /吗|是不是|对不对|有没有/.test(text) && /[？?]/.test(text);
    const aboutThing = /心里想|东西|猜|第.{0,3}个问题/.test(text);
    return yesNo && aboutThing;
  }
  return /想好|想的东西|有一个东西|问我|是非问题|是或不是|准备好|你可以问|你问/.test(text);
}

async function sample(arm, side) {
  const prompt = opensysPrompt(side, arm === "candidate");
  const res = await callModel(prompt);
  return { arm: arm, side: side, text: res.text, cost: res.cost, ok: inCharacter(side, res.text) };
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

(async function main() {
  // Arms and roles interleaved, not run back to back: a provider-side change
  // part way through would otherwise land entirely on one bucket and read as
  // an effect -- DEVELOPING.md, "Compare arms only within a run."
  const tasks = [];
  for (let i = 0; i < RUNS; i++) {
    ["answerer", "guesser"].forEach(side => {
      tasks.push(() => sample("shipped", side).catch(e => ({ arm: "shipped", side: side, error: e.message })));
      tasks.push(() => sample("candidate", side).catch(e => ({ arm: "candidate", side: side, error: e.message })));
    });
  }
  console.error("model=" + MODEL + " runs=" + RUNS + " samples=" + tasks.length);
  const rows = await pool(tasks, CONCURRENCY);

  let totalCost = 0;
  ["answerer", "guesser"].forEach(side => {
    console.log("\n=== " + side + " / opening turn ===");
    ["shipped", "candidate"].forEach(arm => {
      const rs = rows.filter(r => r && r.arm === arm && r.side === side);
      const ok = rs.filter(r => !r.error);
      const good = ok.filter(r => r.ok).length;
      ok.forEach(r => { totalCost += r.cost || 0; });
      console.log(arm + ": " + good + "/" + ok.length + " in character" +
        (rs.length - ok.length ? " (" + (rs.length - ok.length) + " errors)" : ""));
      ok.filter(r => !r.ok).forEach(r => console.log("  broke character: " + r.text.replace(/\n/g, " / ")));
    });
  });
  console.log("\ncost: $" + totalCost.toFixed(6));

  const out = path.join(__dirname, "twenty-ab-results.json");
  fs.writeFileSync(out, JSON.stringify({ model: MODEL, runs: RUNS, when: new Date().toISOString(), rows: rows }, null, 2));
  console.log("rows written to " + path.relative(path.join(__dirname, ".."), out));
})();
