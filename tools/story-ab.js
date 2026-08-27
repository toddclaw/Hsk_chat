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
 *   arm "no-names"     the shipped cast removed and forbidden instead, which
 *                      is how the whitelist's own measurement is reproduced
 *
 * Pick with --arms a,b. Run-to-run variance is large enough that one 20-story
 * run can mislead badly: the "positioned" arm alone read 20%, 4% and 7%
 * restarts across three sessions. Compare arms only WITHIN a run -- they
 * interleave, so a provider-side change hits both -- and pool across runs
 * before believing an absolute level.
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

/* Pacing needs the next level to draw from, exactly as loadLevel() does. Without
 * this the harness measures a story that never introduces a word -- which is the
 * whole feature, and what the first three runs of this file silently omitted. */
const nextEntries = fs.existsSync(path.join(ROOT, "data", "hsk" + (LEVEL + 1) + ".json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "data", "hsk" + (LEVEL + 1) + ".json"), "utf8"))
  : [];
const POOL = HSKPace.buildPool(entries, nextEntries);
const ATTEMPTS = Number(arg("attempts", 3));      // index.html: S.attempts, default 3
const PACING = args.indexOf("--nopace") === -1;
const FALLBACKS = ["我不知道。", "我不会说。"];   // index.html

/* The same call defaultPrompt() makes for a story segment. `index` is the arm:
 * the real one for "positioned", a fixed 0 for "always-first". */
function systemPrompt(index, def, offer, required) {
  /* Mutated around the call rather than passed in: build() reads the activity
   * table, so this is the only way to test a rule in the position it would
   * actually ship in. Restored immediately -- the arms interleave. */
  HSKPrompt.ACTIVITIES.story.rules = STORY_RULES.concat(def.extraRules || []);
  if (def.names) HSKPrompt.ACTIVITIES.story.names = def.names;
  const out = HSKPrompt.build({
    offer: offer || [], reuse: [], require: required || "",
    level: LEVEL, label: LEVELS[LEVEL] || ("HSK " + LEVEL),
    length: "short", script: "simp",
    activity: "story",
    storySegment: { index: index, of: SEGMENTS },
    words: ""
  });
  HSKPrompt.ACTIVITIES.story.rules = STORY_RULES;
  HSKPrompt.ACTIVITIES.story.names = STORY_NAMES;
  return out;
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

/* A mirror of index.html's repairPrompt(), not a paraphrase of it: what the
 * repair loop is worth depends entirely on what it says, so an approximation
 * here would measure a loop the app does not run. The one divergence is the
 * sense check, which costs a model call per attempt and which tools/prompt-ab.js
 * omits for the same reason. */
function repairPrompt(violations, attempt, lex) {
  const latin = violations.filter(v => v.kind === "latin");
  const words = violations.filter(v => v.kind === "bad");
  const parts = [];
  if (latin.length) parts.push("不要用英文，不要用拼音。只写汉字。");
  if (words.length) {
    parts.push("你用了" + words.map(v => "「" + v.text + "」").join("、") +
      "。这些词太难，学生不认识，不可以用。");
    if (attempt >= 3) {
      words.slice(0, 3).forEach(v => {
        const sug = HSK.suggest(v.text, lex, 4).map(e => e.w);
        if (sug.length) parts.push("「" + v.text + "」可以换成：" + sug.join("、") + "。");
      });
      parts.push("只用最简单的词。");
    }
  }
  parts.push("请用别的说法，再说一次。只说中文，不要解释。");
  return parts.join("");
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
/* One story, mirroring runStory() in index.html: SEGMENTS sequential turns, each
 * seeing the ones before it exactly the way windowed() hands them over -- system,
 * then the previous segments as assistant messages and no user message anywhere.
 *
 * Each segment now runs turn()'s real attempt loop and settles against the real
 * pacing budget. The first three runs of this file did neither, and so measured
 * a first draft against a gate the app retries three times, in a story that never
 * introduced a word. Both of those are the feature, not noise around it.
 */
async function runStory(arm) {
  const def = ARM_DEFS[arm];
  const segs = [];
  let cost = 0, emptyRetries = 0;
  // index.html: S.budget[level], and S.learning as it grows during the story.
  const budget = { chars: 0, credits: 0, declines: 0 };
  const learning = [];
  const cast = def.names || STORY_NAMES;

  for (let i = 0; i < SEGMENTS; i++) {
    /* Offer next-level words only once a credit is earned, and re-offer the same
     * slate across repair attempts -- a reply rejected for vocabulary must not
     * cost the introduction. Both are turn()'s rules, not this file's. */
    const offer = (PACING && budget.credits > 0)
      ? HSKPace.slate(POOL, learning.map(e => e.w), HSKPace.SLATE) : [];
    const required = (offer.length && HSKPace.shouldForce(budget.declines))
      ? offer[0].w : "";

    const scratch = [{ role: "system",
                       content: systemPrompt(def.index(i), def, offer, required) }]
      .concat(segs.map(s => ({ role: "assistant", content: s.text })));

    let attempt = 0, best = null, empties = 0;
    while (attempt < ATTEMPTS) {
      attempt++;
      let res;
      /* An empty completion is retried once and counted. index.html does NOT
       * retry -- callModel throws "empty" and the story ends on a notice card --
       * so the retry is here to keep n usable, and the count is what says how
       * often a real story would have died. */
      for (let a = 0; ; a++) {
        try { res = await callModel(MODEL, scratch, MAX_TOKENS, 0.7); break; }
        catch (e) {
          if (a >= 1 || !/empty reply/.test(e.message)) {
            e.message = "segment " + i + ": " + e.message;
            throw e;
          }
          empties++;
        }
      }
      cost += res.cost;
      const ex = extractNeeds(HSK.stripScaffold(res.text));
      /* The cast and the offered words join the per-turn lexicon the way turn()
       * adds them: legal because the prompt asked for them. Score them as
       * violations and the arm is measuring its own premise away. */
      const lex = HSK.buildLexicon(entries,
        cast.map(e => ({ w: e.w }))
          .concat(learning, offer, ex.needs.map(w => ({ w: w }))));
      const viols = HSK.validate(ex.text, lex).filter(v => !v.name);
      if (!best) best = { text: ex.text, viols: viols, lex: lex, needs: ex.needs };
      if (!viols.length) {
        best = { text: ex.text, viols: [], lex: lex, needs: ex.needs, clean: true };
        break;
      }
      if (attempt < ATTEMPTS) {
        scratch.push({ role: "assistant", content: res.text });
        scratch.push({ role: "user", content: repairPrompt(viols, attempt + 1, lex) });
      }
    }

    /* Attempts exhausted with nothing clean: turn() shows a canned fallback,
     * which is survivable in a chat turn and nonsense mid-narrative. Counted
     * rather than smoothed over -- it is the failure the learner actually sees. */
    const failed = !best.clean;
    const text = failed ? FALLBACKS[0] : best.text;

    // settlePace(): bank what was introduced, then earn from what was read.
    const introduced = [];
    if (PACING && !failed) {
      const toks = HSK.segment(best.text, best.lex);
      HSKPace.spot(toks, offer.map(e => e.w)).forEach(w => {
        if (learning.some(e => e.w === w) || budget.credits <= 0) return;
        const e = offer.find(o => o.w === w);
        learning.push({ w: w, p: e.p, d: e.d });
        budget.credits--;
        introduced.push(w);
      });
      if (introduced.length) budget.declines = 0;
      else if (offer.length) budget.declines++;
      Object.assign(budget, HSKPace.earn(budget, best.text, HSKPace.DEFAULT_RATE));
    }

    const tri = trigrams(text);
    segs.push({
      index: i, text: text, tri: tri,
      violations: best.viols.map(v => v.text),
      attempts: attempt, failed: failed, offered: offer.length,
      introduced: introduced, needs: best.needs.length,
      han: countHan(text),
      dup: segs.reduce((m, p) => Math.max(m, jaccard(tri, p.tri)), 0)
    });
    emptyRetries += empties;
  }
  return { arm: arm, segs: segs, cost: cost, emptyRetries: emptyRetries,
           introduced: segs.reduce((a, s) => a + s.introduced.length, 0) };
}

/* The counter the first name experiment lacked. Restarts are about structure;
 * this is about reference -- two characters both called 他 can read perfectly as
 * one continuous story and still leave you unable to tell who did what. That is
 * the harm forbidding names might cause, and nothing so far would have seen it. */
const CLARITY_PROMPT =
  "Below is a short Chinese story for a beginner, in five segments.\n\n" +
  "Question: throughout the story, is it always clear WHO is doing what?\n\n" +
  "Answer with exactly one of these words and nothing else:\n" +
  "CLEAR - you can always tell which character is meant\n" +
  "CONFUSING - at some point you cannot tell which character a pronoun or " +
  "description refers to\n";

async function clarity(segs) {
  const res = await callModel(JUDGE, [
    { role: "user", content: CLARITY_PROMPT + "\n=== STORY ===\n" +
      segs.map(s => s.text).join("\n") + "\n\nOne word:" }
  ], 8, 0);
  const m = /CONFUSING|CLEAR/.exec(res.text.toUpperCase());
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

/* An arm is a position rule and, optionally, an extra story rule appended to
 * ACTIVITIES.story.rules -- which is exactly where such a rule would ship, so
 * the arm under test is the shipped prompt and not an approximation of it.
 *
 * "no-names" is the candidate fix for the finding that names are roughly a
 * third of story time's out-of-level words. Introducing a character with 叫
 * does NOT solve it: validate() forgives only the span 叫 or 姓 actually
 * introduces, so a name established in segment 0 is bare in all four segments
 * after. Not naming anyone is the only version that survives the whole story.
 *
 * The risk it is here to measure is that pronouns are more ambiguous than
 * names, so the fix could buy a lower out-of-level rate with a worse story --
 * which is why this arm is judged for continuity like every other. */
/* An arm is a position rule plus an optional override of the activity's own
 * data. The overrides are applied to ACTIVITIES.story itself around the build()
 * call, so what an arm tests is the shipped prompt rather than a replica of it.
 *
 * "no-names" is the control for the cast, and it has to strip ACTIVITIES.story
 * .names as well as adding a suppression rule -- the names also feed the
 * validation lexicon, and an arm that forbade them in the prompt while still
 * accepting them would score its own violations away. */
const ARM_DEFS = {
  "positioned":   { index: i => i },
  "always-first": { index: () => 0 },
  "no-names":     { index: i => i, names: [], extraRules: [
    "故事里的人不要起名字。用「他」「她」「他们」「我的朋友」「老师」" +
    "「妈妈」这样的说法来说他们是谁。"
  ] }
};
const ARMS = String(arg("arms", "positioned,no-names")).split(",");
ARMS.forEach(a => {
  if (!ARM_DEFS[a]) { console.error("unknown arm: " + a); process.exit(1); }
});

const STORY_RULES = HSKPrompt.ACTIVITIES.story.rules.slice();
const STORY_NAMES = HSKPrompt.ACTIVITIES.story.names;

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
  // One clarity call per STORY, not per segment: reference is a whole-story
  // property and asking per segment would just re-ask the continuity question.
  if (!NOJUDGE) stories.filter(s => !s.error).forEach(s => {
    jtasks.push(() => clarity(s.segs)
      .then(r => { s.clarity = r.label; return r.cost; })
      .catch(e => { s.clarity = "ERROR"; return 0; }));
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
      /* The probe this run exists for: what the repair loop is worth. A segment
       * that never comes clean shows the learner a canned fallback in the middle
       * of a story, which is the failure that actually matters. */
      attempts: (() => {
        const all = mine.flatMap(s => s.segs);
        const d = [0, 0, 0, 0, 0, 0, 0];
        all.forEach(s => { if (!s.failed) d[s.attempts] = (d[s.attempts] || 0) + 1; });
        return d;
      })(),
      failedSegs: mine.flatMap(s => s.segs).filter(s => s.failed).length,
      storiesWithFallback: mine.filter(s => s.segs.some(g => g.failed)).length,
      offeredSegs: mine.flatMap(s => s.segs).filter(s => s.offered > 0).length,
      introduced: mine.reduce((a, s) => a + s.introduced, 0),
      needSegs: mine.flatMap(s => s.segs).filter(s => s.needs > 0).length,
      han: (() => {
        const all = mine.flatMap(s => s.segs);
        return all.length ? all.reduce((a, s) => a + s.han, 0) / all.length : 0;
      })(),
      clear: mine.filter(s => s.clarity === "CLEAR").length,
      confusing: mine.filter(s => s.clarity === "CONFUSING").length,
      cost: mine.reduce((a, s) => a + s.cost, 0)
    };
  });

  console.log("");
  console.log(pad("", 14) + pad("stories", 9) + pad("segs", 6) + pad("CONT", 6) +
    pad("RESTART", 9) + pad("UNREL", 7) + pad("clean stories", 15) +
    pad("mean dup", 10) + pad("dup>=.25", 10) + pad("clear", 10));
  ARMS.forEach(arm => {
    const r = rows[arm];
    console.log(pad(arm, 14) + pad(r.stories, 9) + pad(r.segs, 6) +
      pad(r.continues, 6) +
      pad(r.restarts + " (" + (r.segs ? r.restarts / r.segs * 100 : 0).toFixed(0) + "%)", 9) +
      pad(r.unrelated, 7) +
      pad(r.cleanStories + "/" + r.stories, 15) +
      pad(r.dup.toFixed(3), 10) + pad(r.dupHigh, 10) +
      pad(r.clear + "/" + (r.clear + r.confusing), 10));
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

  console.log("");
  console.log(pad("", 14) + pad("clean on try 1/2/3+", 21) + pad("never clean", 13) +
    pad("stories hit", 13) + pad("offered", 9) + pad("introduced", 12) + "[[NEED:]]");
  ARMS.forEach(arm => {
    const r = rows[arm];
    const a = r.attempts, later = a.slice(3).reduce((x, y) => x + y, 0);
    console.log(pad(arm, 14) +
      pad((a[1] || 0) + " / " + (a[2] || 0) + " / " + later, 21) +
      pad(r.failedSegs + "/" + r.allSegs, 13) +
      pad(r.storiesWithFallback + "/" + r.stories, 13) +
      pad(r.offeredSegs + "/" + r.allSegs, 9) +
      pad(String(r.introduced), 12) + r.needSegs);
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
