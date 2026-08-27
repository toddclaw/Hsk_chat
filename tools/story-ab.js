/* A/B the story-time position rule against a real model.
 *
 * Story time generates STORY_SEGMENTS segments, each its own turn(), and the
 * only thing stopping segment 4 from being another segment 0 is one rule:
 *
 *   index 0            这是故事的第一段。开个头，介绍一两个人和一个地方。
 *   0 < index < of-1   接着上面的故事往下讲，不要从头开始，也不要现在就结束。
 *   index >= of-1      这是故事的最后一段。把故事讲完，给它一个结尾。
 *
 * CLAUDE.md: a prompt edit ships only after a counted A/B against a real model,
 * because the answer is regularly the opposite of the obvious one. This is that
 * run for the rule above.
 *
 *   arm "positioned"   what shipped -- the rule tracks the real segment index
 *   arm "always-first" every segment is told it is the first one
 *
 * The control is a WRONG position rule rather than no rule at all, so exactly
 * one line of the prompt differs between the arms and the rest -- the story
 * rules, the suppressed turn-taking rules, the suppressed LENGTHS rule, the
 * ninety-character instruction -- is held identical. Deleting the line instead
 * would also renumber every rule after it, which is a second change.
 *
 * Two counters, deliberately not one:
 *
 *   restarts   a judge model labels each segment CONTINUES / RESTARTS /
 *              UNRELATED against everything before it
 *   duplicate  character-trigram overlap with the nearest earlier segment,
 *              which needs no model and no trust, as a cross-check on the judge
 *
 * Also reported, free from the same replies: out-of-level rate per segment and
 * mean Han characters against the ninety the rule asks for.
 *
 * Plain node, no dependencies, and never part of `test/run.sh`: it makes real
 * network calls and costs real money.
 *
 *   node tools/story-ab.js [--level 1] [--stories 6] [--model <id>] [--judge <id>]
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

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const LEVEL = Number(arg("level", 1));
const STORIES = Number(arg("stories", 6));
const MODEL = arg("model", "qwen/qwen3-30b-a3b-instruct-2507");
/* The judge is not the model under test. Labelling "did this continue the story
 * or start a new one" is the kind of meta-question index.html's own teaching
 * model exists because small models are bad at -- see the note above MODELS. */
const JUDGE = arg("judge", "anthropic/claude-sonnet-4.5");
const CONCURRENCY = Number(arg("concurrency", 3));

// index.html: STORY_SEGMENTS, STORY_MAX_TOKENS.
const SEGMENTS = 5;
const MAX_TOKENS = 400;

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }

const LEVELS = { 1: "HSK 1", 2: "HSK 2", 3: "HSK 3", 4: "HSK 4", 5: "HSK 5", 6: "HSK 6" };
const entries = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data", "hsk" + LEVEL + ".json"), "utf8"));
const baseLex = HSK.buildLexicon(entries, []);

/* The same call defaultPrompt() makes for a story segment. `index` is the arm:
 * the real one for "positioned", a fixed 0 for "always-first". */
function systemPrompt(index) {
  return HSKPrompt.build({
    offer: [], reuse: [], require: "",
    level: LEVEL, label: LEVELS[LEVEL] || ("HSK " + LEVEL),
    length: "short", script: "simp",
    activity: "story",
    storySegment: { index: index, of: SEGMENTS },
    words: ""
  });
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

function countHan(text) {
  const m = String(text || "").match(/[一-鿿]/g);
  return m ? m.length : 0;
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
  if (!r.ok) {
    throw new Error((body.error && body.error.message) || ("HTTP " + r.status));
  }
  const choice = (body.choices && body.choices[0]) || {};
  const txt = choice.message && choice.message.content;
  if (!txt) throw new Error("empty reply");
  return {
    text: txt.trim(),
    finish: choice.finish_reason || "",
    cost: (body.usage && body.usage.cost) || 0
  };
}

/* Character trigrams. Word segmentation would beg the question -- an HSK 1
 * lexicon cannot segment a reply that broke out of HSK 1, which is exactly the
 * reply most worth comparing. */
function trigrams(text) {
  const han = String(text).replace(/[^一-鿿]/g, "");
  const out = new Set();
  for (let i = 0; i + 3 <= han.length; i++) out.add(han.slice(i, i + 3));
  return out;
}
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  a.forEach(g => { if (b.has(g)) hit++; });
  return hit / (a.size + b.size - hit);
}

/* One story: SEGMENTS sequential turns, each seeing the ones before it exactly
 * the way windowed() hands them over -- system, then the previous segments as
 * assistant messages and no user message anywhere. A story has no learner turns
 * until phase two, so that array really is system-plus-assistants, which is an
 * unusual shape to send an API and worth exercising for real. */
async function runStory(arm) {
  const segs = [];
  let cost = 0, emptyRetries = 0;
  for (let i = 0; i < SEGMENTS; i++) {
    const index = arm === "always-first" ? 0 : i;
    const messages = [{ role: "system", content: systemPrompt(index) }]
      .concat(segs.map(s => ({ role: "assistant", content: s.text })));
    /* An empty completion is retried once and counted. index.html does NOT
     * retry -- callModel throws "empty" and the story ends on a notice card --
     * so the retry is here to keep n usable for the continuity question, and
     * the count is what says how often a real story would have died. */
    let res, empties = 0;
    for (let a = 0; ; a++) {
      try { res = await callModel(MODEL, messages, MAX_TOKENS, 0.7); break; }
      catch (e) {
        if (a >= 1 || !/empty reply/.test(e.message)) {
          e.message = "segment " + i + ": " + e.message;
          throw e;
        }
        empties++;
      }
    }
    emptyRetries += empties;
    const ex = extractNeeds(HSK.stripScaffold(res.text));
    const lex = ex.needs.length
      ? HSK.buildLexicon(entries, ex.needs.map(w => ({ w: w })))
      : baseLex;
    const viols = HSK.validate(ex.text, lex).filter(v => !v.name);
    const tri = trigrams(ex.text);
    segs.push({
      index: i, text: ex.text, tri: tri,
      violations: viols.map(v => v.text),
      han: countHan(ex.text),
      truncated: res.finish === "length",
      // Nearest earlier segment, not the immediately preceding one: a restart
      // resembles segment 0, which by segment 4 is three turns back.
      dup: segs.reduce((m, p) => Math.max(m, jaccard(tri, p.tri)), 0)
    });
    cost += res.cost;
  }
  return { arm: arm, segs: segs, cost: cost, emptyRetries: emptyRetries };
}

/* The judge sees the story so far and the next segment, and is asked for one
 * word. Deliberately not asked to explain: a label is countable and a paragraph
 * is something to read, and DEVELOPING.md is emphatic about which of those
 * settles a question. */
const JUDGE_PROMPT =
  "You are evaluating a Chinese-language story that was generated one segment " +
  "at a time. Below is the story so far, then the NEXT segment.\n\n" +
  "Answer with exactly one of these words and nothing else:\n" +
  "CONTINUES - the next segment carries the same story forward\n" +
  "RESTARTS - the next segment begins the story again: it re-introduces " +
  "characters or the setting already established, or retells earlier events\n" +
  "UNRELATED - the next segment is about something else entirely\n";

async function judge(prior, next) {
  const res = await callModel(JUDGE, [
    { role: "user", content: JUDGE_PROMPT +
      "\n=== STORY SO FAR ===\n" + prior.join("\n") +
      "\n\n=== NEXT SEGMENT ===\n" + next + "\n\nOne word:" }
  ], 8, 0);
  const m = /CONTINUES|RESTARTS|UNRELATED/.exec(res.text.toUpperCase());
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

const ARMS = ["positioned", "always-first"];

(async function main() {
  /* Interleaved, like tools/prompt-ab.js: a rate limit or a provider-side
   * change part way through would otherwise land on one arm and read as an
   * effect. */
  const tasks = [];
  for (let i = 0; i < STORIES; i++) {
    ARMS.forEach(arm => tasks.push(() =>
      runStory(arm).catch(e => ({ arm: arm, error: e.message }))));
  }

  console.error("model=" + MODEL + " judge=" + JUDGE + " level=" + LEVEL +
    " stories=" + STORIES + "/arm segments=" + SEGMENTS +
    " calls=" + (tasks.length * SEGMENTS));
  const stories = await pool(tasks, CONCURRENCY);

  // Judged after generation so a judge failure cannot abort a story mid-way.
  const NOJUDGE = args.indexOf("--nojudge") !== -1;
  if (!NOJUDGE) console.error("judging…");
  const jtasks = [];
  if (NOJUDGE) jtasks.length = 0;
  if (!NOJUDGE) stories.filter(s => !s.error).forEach(s => {
    for (let i = 1; i < s.segs.length; i++) {
      jtasks.push(() => judge(s.segs.slice(0, i).map(p => p.text), s.segs[i].text)
        .then(r => { s.segs[i].label = r.label; return r.cost; })
        .catch(e => { s.segs[i].label = "ERROR:" + e.message; return 0; }));
    }
  });
  const judgeCosts = await pool(jtasks, CONCURRENCY * 2);

  const pad = (s, n) => String(s).padEnd(n);
  const rows = {};
  ARMS.forEach(arm => {
    const mine = stories.filter(s => s && s.arm === arm && !s.error);
    // Segment 0 is excluded from every continuity figure: it has nothing to
    // continue, and both arms give it the identical prompt.
    const later = mine.flatMap(s => s.segs.slice(1));
    const lab = l => later.filter(s => s.label === l).length;
    rows[arm] = {
      stories: mine.length,
      errors: stories.filter(s => s && s.arm === arm && s.error).length,
      segs: later.length,
      continues: lab("CONTINUES"),
      restarts: lab("RESTARTS"),
      unrelated: lab("UNRELATED"),
      // A story is only usable if EVERY later segment continued; one restart
      // in the middle is a broken story, not a slightly worse one.
      cleanStories: mine.filter(s =>
        s.segs.slice(1).every(g => g.label === "CONTINUES")).length,
      dup: later.length ? later.reduce((a, s) => a + s.dup, 0) / later.length : 0,
      dupHigh: later.filter(s => s.dup >= 0.25).length,
      outOfLevel: mine.flatMap(s => s.segs).filter(s => s.violations.length).length,
      allSegs: mine.flatMap(s => s.segs).length,
      truncated: mine.flatMap(s => s.segs).filter(s => s.truncated).length,
      emptyRetries: mine.reduce((a, s) => a + (s.emptyRetries || 0), 0),
      han: (() => {
        const all = mine.flatMap(s => s.segs);
        return all.length ? all.reduce((a, s) => a + s.han, 0) / all.length : 0;
      })(),
      cost: mine.reduce((a, s) => a + s.cost, 0)
    };
  });

  console.log("");
  console.log(pad("", 14) + pad("stories", 9) + pad("segs", 6) + pad("CONT", 6) +
    pad("RESTART", 9) + pad("UNREL", 7) + pad("clean stories", 15) +
    pad("mean dup", 10) + pad("dup>=.25", 10));
  ARMS.forEach(arm => {
    const r = rows[arm];
    console.log(pad(arm, 14) + pad(r.stories, 9) + pad(r.segs, 6) +
      pad(r.continues, 6) +
      pad(r.restarts + " (" + (r.segs ? r.restarts / r.segs * 100 : 0).toFixed(0) + "%)", 9) +
      pad(r.unrelated, 7) +
      pad(r.cleanStories + "/" + r.stories, 15) +
      pad(r.dup.toFixed(3), 10) + pad(r.dupHigh, 10));
  });

  console.log("");
  console.log(pad("", 14) + pad("out-of-level", 16) + pad("mean chars", 12) +
    pad("truncated", 11) + pad("err+retry", 11) + "cost");
  ARMS.forEach(arm => {
    const r = rows[arm];
    console.log(pad(arm, 14) +
      pad(r.outOfLevel + "/" + r.allSegs + " (" +
        (r.allSegs ? r.outOfLevel / r.allSegs * 100 : 0).toFixed(0) + "%)", 16) +
      pad(r.han.toFixed(0) + " (asked 90)", 12) +
      pad(r.truncated, 11) + pad(r.errors + "+" + r.emptyRetries + "r", 8) +
      "$" + r.cost.toFixed(6));
  });

  /* Out-of-level rate per REPLY is not comparable across activities of
   * different lengths -- a 55-character segment has four times a 13-character
   * chat turn's chances to trip. Violations per hundred Han characters is, and
   * it is the number that says whether story time is genuinely worse Chinese or
   * merely more of it. */
  console.log("");
  ARMS.forEach(arm => {
    const all = stories.filter(s => s && s.arm === arm && !s.error).flatMap(s => s.segs);
    const v = all.reduce((a, s) => a + s.violations.length, 0);
    const h = all.reduce((a, s) => a + s.han, 0);
    const c = new Map();
    all.forEach(s => s.violations.forEach(w => c.set(w, (c.get(w) || 0) + 1)));
    const top = [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log(pad(arm, 14) + "violations/100 han: " + (h ? v / h * 100 : 0).toFixed(1) +
      "   total " + v + " over " + h + " chars");
    console.log("  top: " + top.map(e => e[0] + "×" + e[1]).join(", "));
  });

  const jc = judgeCosts.filter(c => typeof c === "number").reduce((a, c) => a + c, 0);
  console.log("\njudging cost $" + jc.toFixed(6));

  const failed = stories.filter(s => s && s.error);
  if (failed.length) {
    console.log("\nerrors:");
    [...new Set(failed.map(s => s.arm + ": " + s.error))].forEach(e =>
      console.log("  " + e));
  }

  // One story per arm, printed whole. Not the measurement -- the measurement is
  // the table above -- but a table that says 40% restarts is unactionable
  // without one example of what a restart looked like.
  if (args.indexOf("--show") !== -1) {
    ARMS.forEach(arm => {
      const s = stories.find(x => x && x.arm === arm && !x.error);
      if (!s) return;
      console.log("\n=== " + arm + " ===");
      s.segs.forEach(g => console.log(
        "[" + g.index + " " + (g.label || "-") + " dup=" + g.dup.toFixed(2) +
        " han=" + g.han + (g.violations.length ? " bad:" + g.violations.join(",") : "") +
        "]\n" + g.text));
    });
  }
})();
