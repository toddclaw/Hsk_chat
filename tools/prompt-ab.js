/* A/B the prompt-mode toggle against a real model.
 *
 * Settings -> Prompt mode chooses whether the level's allowlist is appended to
 * the system prompt (`with-list`) or the rules stand alone (`without-list`).
 * Both paths were built because HSKStory reported that including the list makes
 * output worse, and the README's instruction was to assume neither result. This
 * script is how that gets settled: it runs both arms against the same seeds and
 * counts out-of-level words, exactly the way DEVELOPING.md's other worked
 * examples do -- count, do not read.
 *
 * Plain node, no dependencies, and never part of `test/run.sh`: it makes real
 * network calls and costs real money.
 *
 *   node tools/prompt-ab.js [--level 1] [--runs 8] [--model <id>]
 *
 * The key is read out of a file OUTSIDE the repo into a variable and is never
 * echoed, never an argv element, and never written anywhere.
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

/* Seeds are the learner's side of one turn. Name-free on purpose: every HSK
 * list carries almost no name characters, so a seed that invites one makes the
 * name the most common violation in BOTH arms and buries the effect. That
 * happened to the PROMOTE_AT measurement and cost it a whole run --
 * DEVELOPING.md, "Worked example: raising PROMOTE_AT from 3 to 6".
 *
 * Drawn from HSKPrompt.STARTERS[1] minus 你叫什么名字？ for that reason. */
const SEEDS = [
  "你今天好吗？",
  "你喜欢吃什么？",
  "你会说中文吗？",
  "今天热吗？",
  "你几点睡觉？",
  "你想喝茶还是喝水？",
  "你的家在哪儿？",
  "你想去哪儿？"
];

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const LEVEL = Number(arg("level", 1));
const RUNS = Number(arg("runs", 8));
const MODEL = arg("model", "qwen/qwen3-30b-a3b-instruct-2507");
const LENGTH = arg("length", "short");
const CONCURRENCY = Number(arg("concurrency", 4));

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }

const LEVELS = { 1: "HSK 1", 2: "HSK 2", 3: "HSK 3", 4: "HSK 4", 5: "HSK 5", 6: "HSK 6" };

const entries = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "hsk" + LEVEL + ".json"), "utf8"));
const baseLex = HSK.buildLexicon(entries, []);
const wordList = [...baseLex.words.keys()].join(" ");

/* Same shape index.html's defaultPrompt() builds, with the one difference the
 * experiment is about: `words` is the allowlist in one arm and "" in the other. */
function systemPrompt(mode) {
  return HSKPrompt.build({
    offer: [], reuse: [], require: "",
    level: LEVEL, label: LEVELS[LEVEL] || ("HSK " + LEVEL),
    length: LENGTH, script: "simp",
    words: mode === "with-list" ? wordList : ""
  });
}

/* index.html keeps this regex and the extraction inline; replicated rather than
 * exported because the app's copy also records positions for the UI, which a
 * count does not need. A [[NEED:]] word is a request the prompt invites, so it
 * is legal this turn and must not score as a violation. */
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

async function callModel(messages) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, messages: messages,
      max_tokens: (HSKPrompt.LENGTHS[LENGTH] || HSKPrompt.LENGTHS.short).maxTokens,
      temperature: 0.7,
      usage: { include: true }
    })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = (body.error && body.error.message) || ("HTTP " + r.status);
    throw new Error(detail);
  }
  const choice = (body.choices && body.choices[0]) || {};
  const txt = choice.message && choice.message.content;
  if (!txt) throw new Error("empty reply");
  return {
    text: txt.trim(),
    finish: choice.finish_reason || "",
    outTokens: (body.usage && body.usage.completion_tokens) || 0,
    cost: (body.usage && body.usage.cost) || 0
  };
}

/* One sample: generate, strip the model's own formatting, then validate against
 * a lexicon that includes this reply's [[NEED:]] words -- the same order
 * turn() uses. Names are excluded exactly as the repair loop excludes them. */
async function sample(mode, seed) {
  const res = await callModel([
    { role: "system", content: systemPrompt(mode) },
    { role: "user", content: seed }
  ]);
  const ex = extractNeeds(HSK.stripScaffold(res.text));
  const lex = ex.needs.length
    ? HSK.buildLexicon(entries, ex.needs.map(w => ({ w: w })))
    : baseLex;
  const viols = HSK.validate(ex.text, lex).filter(v => !v.name);
  return {
    mode: mode, seed: seed, text: ex.text,
    violations: viols.map(v => v.text),
    bad: viols.length > 0,
    han: HSKPace_countHan(ex.text),
    needs: ex.needs.length,
    truncated: res.finish === "length",
    outTokens: res.outTokens, cost: res.cost
  };
}

// pace.js counts Han the same way; inlined to avoid loading it for one regex.
function HSKPace_countHan(text) {
  const m = String(text || "").match(/[一-鿿]/g);
  return m ? m.length : 0;
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

function summarise(rows) {
  const ok = rows.filter(r => !r.error);
  const n = ok.length;
  const bad = ok.filter(r => r.bad).length;
  const viols = ok.reduce((s, r) => s + r.violations.length, 0);
  return {
    replies: n,
    errors: rows.length - n,
    outOfLevel: bad,
    rate: n ? bad / n : 0,
    totalViolations: viols,
    truncated: ok.filter(r => r.truncated).length,
    needsUsed: ok.filter(r => r.needs > 0).length,
    meanHan: n ? ok.reduce((s, r) => s + r.han, 0) / n : 0,
    meanOutTokens: n ? ok.reduce((s, r) => s + r.outTokens, 0) / n : 0,
    cost: ok.reduce((s, r) => s + r.cost, 0)
  };
}

function topViolations(rows) {
  const c = new Map();
  rows.filter(r => !r.error).forEach(r =>
    r.violations.forEach(w => c.set(w, (c.get(w) || 0) + 1)));
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
}

(async function main() {
  /* Arms interleaved rather than run back to back: a rate limit or a
   * provider-side change part way through would otherwise land entirely on one
   * arm and read as an effect. */
  const tasks = [];
  for (let i = 0; i < RUNS; i++) {
    SEEDS.forEach(seed => {
      /* The mode is attached to the failure too, or a run where one arm errors
       * more than the other silently drops those samples from both counts and
       * the error asymmetry -- which would itself be a result -- disappears. */
      tasks.push(() => sample("without-list", seed)
        .catch(e => ({ mode: "without-list", seed: seed, error: e.message })));
      tasks.push(() => sample("with-list", seed)
        .catch(e => ({ mode: "with-list", seed: seed, error: e.message })));
    });
  }

  console.error("model=" + MODEL + " level=" + LEVEL + " length=" + LENGTH +
    " seeds=" + SEEDS.length + " runs=" + RUNS + " samples=" + tasks.length);
  console.error("system prompt chars: without-list=" + systemPrompt("without-list").length +
    " with-list=" + systemPrompt("with-list").length);

  const rows = await pool(tasks, CONCURRENCY);
  const arms = {};
  ["without-list", "with-list"].forEach(mode => {
    arms[mode] = { rows: rows.filter(r => r && r.mode === mode) };
    arms[mode].summary = summarise(arms[mode].rows);
    arms[mode].top = topViolations(arms[mode].rows);
  });

  const pad = (s, n) => String(s).padEnd(n);
  console.log("");
  console.log(pad("", 16) + pad("replies", 9) + pad("out-of-level", 14) +
    pad("viols", 7) + pad("chars", 7) + pad("out tok", 9) + "cost");
  ["without-list", "with-list"].forEach(mode => {
    const s = arms[mode].summary;
    console.log(pad(mode, 16) + pad(s.replies, 9) +
      pad(s.outOfLevel + " (" + (s.rate * 100).toFixed(1) + "%)", 14) +
      pad(s.totalViolations, 7) + pad(s.meanHan.toFixed(1), 7) +
      pad(s.meanOutTokens.toFixed(0), 9) + "$" + s.cost.toFixed(6));
  });
  console.log("");
  ["without-list", "with-list"].forEach(mode => {
    console.log(mode + " top violations: " +
      (arms[mode].top.map(([w, n]) => w + "×" + n).join(", ") || "none"));
  });
  console.log("");
  ["without-list", "with-list"].forEach(mode => {
    const s = arms[mode].summary;
    console.log(mode + ": errors=" + s.errors + " truncated=" + s.truncated +
      " replies using [[NEED:]]=" + s.needsUsed);
  });

  const out = path.join(__dirname, "prompt-ab-results.json");
  fs.writeFileSync(out, JSON.stringify({
    model: MODEL, level: LEVEL, length: LENGTH, runs: RUNS, seeds: SEEDS,
    when: new Date().toISOString(),
    arms: {
      "without-list": { summary: arms["without-list"].summary, top: arms["without-list"].top },
      "with-list": { summary: arms["with-list"].summary, top: arms["with-list"].top }
    },
    rows: rows
  }, null, 2));
  console.log("\nrows written to " + path.relative(ROOT, out));
})();
