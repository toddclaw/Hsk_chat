/* Does the grader's drill verdict tell the truth?
 *
 * The drill's partial credit rests entirely on one new field: asked to grade a
 * sentence while a structure is being drilled, the model also reports whether
 * that structure was USED and whether it was RIGHT, judged apart from anything
 * else wrong in the sentence. If that field is noise, a learner gets credit for
 * sentences that dodge the structure and none for sentences that nail it, which
 * is worse than the whole-sentence verdict it replaces.
 *
 * CLAUDE.md's rule: the suite can only check the words are in the string.
 * Whether they WORK is a question about a model.
 *
 * Two counters, per DEVELOPING.md -- one would be trusted too easily:
 *
 *   target     the used/ok pair against hand-written ground truth. Three kinds
 *              of sentence per tag: the structure used correctly, the structure
 *              used wrongly, and a correct sentence that avoids it entirely.
 *              The third is the one that matters most -- it is the free pass
 *              the design has to refuse.
 *   tags       does the seventeen-tag output survive the extra question? Every
 *              tag measurement in RESEARCH.md was taken without the drill block
 *              in the prompt, so the control arm here is the same fixtures
 *              graded without it. A drill that improves credit and wrecks the
 *              ledger has shipped nothing.
 *
 * The wrong sentences below are FIXTURES, not prompt content: they are what the
 * grader is asked to judge, which is the one place a wrong form belongs. The
 * prompt itself still only ever names correct ones (RESEARCH.md, "Sharpening a
 * prompt rule by naming the failure").
 *
 * Name-free, per CLAUDE.md: every fixture uses 我 / 他 / 老师 and no personal
 * name, so nothing here turns on characters above the level.
 *
 *   node tools/grade-target-ab.js [--runs 3] [--model <id>]
 *
 * --loop instead runs the whole activity: partner turn, a student model
 * answering it naturally, then the grade. That reports how often a partner turn
 * actually produces a reply that uses the target -- the honest bound on how
 * grindy a six-pass goal is. It measures the PARTNER, not a learner: a model
 * answering at level makes far fewer mistakes than the person this is for.
 *
 * Plain node, no dependencies, never part of test/run.sh: it makes network
 * calls and costs money. The key is read out of a file OUTSIDE the repo into a
 * variable, never an argv element, never echoed.
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
const RUNS = Number(arg("runs", 3));
const LEVEL = Number(arg("level", 3));
const MODEL = arg("model", "qwen/qwen3-30b-a3b-instruct-2507");
const CONCURRENCY = Number(arg("concurrency", 4));
const LOOP = args.indexOf("--loop") !== -1;
/* The partner rule gained the specific sentence, which is itself a prompt edit
 * and needs its own arm: --noeg drills the category alone, the way it did
 * before an example could be chosen. */
const NOEG = args.indexOf("--noeg") !== -1;
const LABEL = "HSK " + LEVEL;

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }

/* Ground truth, hand-written. `eg` is the corrected sentence the drill is
 * working towards -- exactly what startDrillWith() stores and the prompt shows.
 *
 * kind:
 *   good   structure used correctly          -> used true,  ok true
 *   bad    structure used wrongly            -> used true,  ok false
 *   other  structure right, ANOTHER error    -> used true,  ok true   (partial credit)
 *   dodge  correct sentence, structure absent -> used false
 */
const FIXTURES = [
  { tag: "measure-word", eg: "我有三本书", kind: "good",  text: "我买了两本书" },
  { tag: "measure-word", eg: "我有三本书", kind: "bad",   text: "我买了两个书" },
  { tag: "measure-word", eg: "我有三本书", kind: "other", text: "我昨天买了两本书了" },
  { tag: "measure-word", eg: "我有三本书", kind: "dodge", text: "我很喜欢看书" },

  { tag: "aspect-le",    eg: "我已经吃了饭", kind: "good",  text: "我昨天看了一个电影" },
  { tag: "aspect-le",    eg: "我已经吃了饭", kind: "bad",   text: "我很高兴了" },
  { tag: "aspect-le",    eg: "我已经吃了饭", kind: "other", text: "我昨天看了三个电影" },
  { tag: "aspect-le",    eg: "我已经吃了饭", kind: "dodge", text: "我每天都喝茶" },

  { tag: "negation-bu-mei", eg: "他没有钱", kind: "good",  text: "我昨天没去学校" },
  { tag: "negation-bu-mei", eg: "他没有钱", kind: "bad",   text: "我昨天不去学校" },
  { tag: "negation-bu-mei", eg: "他没有钱", kind: "other", text: "我昨天没去学校了" },
  { tag: "negation-bu-mei", eg: "他没有钱", kind: "dodge", text: "我喜欢喝咖啡" },

  { tag: "comparison-bi", eg: "他比我高", kind: "good",  text: "今天比昨天冷" },
  { tag: "comparison-bi", eg: "他比我高", kind: "bad",   text: "今天比昨天很冷" },
  { tag: "comparison-bi", eg: "他比我高", kind: "other", text: "今天比昨天冷了一点儿，我没有穿多衣服" },
  { tag: "comparison-bi", eg: "他比我高", kind: "dodge", text: "今天天气很好" },

  { tag: "de-particles", eg: "他说得很好", kind: "good",  text: "他跑得很快" },
  { tag: "de-particles", eg: "他说得很好", kind: "bad",   text: "他跑的很快" },
  { tag: "de-particles", eg: "他说得很好", kind: "other", text: "他跑得很快，可是我不快" },
  { tag: "de-particles", eg: "他说得很好", kind: "dodge", text: "我今天很累" }
];

const EXPECT = {
  good:  { used: true,  ok: true },
  bad:   { used: true,  ok: false },
  other: { used: true,  ok: true },
  dodge: { used: false, ok: null }   // ok is not meaningful when unused
};

async function call(messages, maxTokens, temperature) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: messages, max_tokens: maxTokens,
                           temperature: temperature, usage: { include: true } })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body.error && body.error.message) || ("HTTP " + r.status));
  const txt = body.choices && body.choices[0] && body.choices[0].message &&
              body.choices[0].message.content;
  if (!txt) throw new Error("empty reply");
  return { text: txt.trim(), cost: (body.usage && body.usage.cost) || 0 };
}

// parseGrade() from index.html, reduced to the two things this measures.
function parseGrade(raw) {
  const a = String(raw || "").indexOf("{"), b = String(raw || "").lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  let g;
  try { g = JSON.parse(raw.slice(a, b + 1)); } catch (e) { return null; }
  // drillCheck answers {used, ok} directly; grade() answers the tag object.
  const t = typeof g.used === "boolean" || typeof g.ok === "boolean" ? g : null;
  return {
    tags: (Array.isArray(g.errors) ? g.errors : []).map(e => e && e.tag).filter(Boolean),
    target: t ? { used: t.used === true, ok: t.ok === true } : null
  };
}

async function gradeOne(f, withDrill) {
  /* The drill arm is now a SEPARATE call about the structure alone, not a
   * field on the grader's own answer -- see prompt.js drillCheck() for the
   * measurement that forced the split. The plain arm still grades the same
   * fixture, so the tag control below compares like with like. */
  const res = await call([{ role: "user", content: withDrill
    ? HSKPrompt.drillCheck({ text: f.text, label: LABEL, drillTag: f.tag, drillEg: f.eg })
    : HSKPrompt.grade({ text: f.text, label: LABEL }) }], withDrill ? 120 : 600, 0);
  const g = parseGrade(res.text);
  if (!g) return { arm: withDrill ? "drill" : "plain", f: f, unreadable: true, cost: res.cost };
  const want = EXPECT[f.kind];
  const usedRight = g.target ? g.target.used === want.used : false;
  const okRight = !g.target ? false
    : want.ok === null ? true            // unused: ok carries no claim
    : g.target.ok === want.ok;
  return {
    arm: withDrill ? "drill" : "plain", f: f, cost: res.cost,
    target: g.target, usedRight: usedRight, okRight: okRight,
    /* The control. A "bad" fixture must still be filed under its own tag, and a
     * "good" or "dodge" one must not be filed under it at all -- the ledger the
     * chooser reads is built from exactly this. */
    tagRight: f.kind === "bad" || f.kind === "other"
      ? g.tags.indexOf(f.tag) !== -1
      : g.tags.indexOf(f.tag) === -1
  };
}

/* --loop: the whole activity end to end. The student model is told to answer
 * naturally and is NOT told what is being drilled -- being told would measure
 * the instruction, not the partner's question. */
async function loopOne(tag, eg) {
  const system = HSKPrompt.build({ level: LEVEL, label: LABEL, length: "short",
                                   activity: "drill", drillTag: tag, drillEg: eg,
                                   opening: true });
  const partner = await call([{ role: "system", content: system },
                              { role: "user", content: "你好。" }], 200, 0.7);
  const student = await call([
    { role: "system", content: "You are a student of Chinese at " + LABEL +
      ". Answer the teacher in one short Chinese sentence. Reply with the " +
      "sentence and nothing else." },
    { role: "user", content: partner.text }], 100, 0.7);
  const g = parseGrade((await call([{ role: "user", content: HSKPrompt.drillCheck({
    text: student.text, label: LABEL, drillTag: tag, drillEg: eg
  }) }], 120, 0)).text);
  return { tag: tag, partner: partner.text, student: student.text,
           used: !!(g && g.target && g.target.used),
           passed: !!(g && g.target && g.target.used && g.target.ok),
           cost: partner.cost + student.cost };
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
  const tasks = [];
  if (LOOP) {
    const seen = {};
    FIXTURES.forEach(f => { seen[f.tag] = f.eg; });
    for (let i = 0; i < RUNS; i++) {
      Object.keys(seen).forEach(tag =>
        tasks.push(() => loopOne(tag, NOEG ? "" : seen[tag])));
    }
  } else {
    /* Arms interleaved, per DEVELOPING.md, "Compare arms only within a run". */
    for (let i = 0; i < RUNS; i++) {
      FIXTURES.forEach(f => {
        tasks.push(() => gradeOne(f, true));
        tasks.push(() => gradeOne(f, false));
      });
    }
  }
  console.error("model=" + MODEL + " level=" + LEVEL + " runs=" + RUNS +
    " samples=" + tasks.length +
    (LOOP ? " (loop: 3 calls each, example=" + (NOEG ? "no" : "yes") + ")" : ""));
  const rows = (await pool(tasks, CONCURRENCY)).filter(r => r && !r.error);

  if (LOOP) {
    console.log("\n" + pad("tag", 24) + pad("used", 10) + "passed");
    const tags = [...new Set(rows.map(r => r.tag))];
    tags.forEach(tag => {
      const ok = rows.filter(r => r.tag === tag);
      console.log(pad(tag, 24) +
        pad(ok.filter(r => r.used).length + "/" + ok.length, 10) +
        ok.filter(r => r.passed).length + "/" + ok.length);
    });
    const passed = rows.filter(r => r.passed).length;
    console.log("\ntotal " + passed + "/" + rows.length +
      (passed ? "  -> about " + (rows.length / passed).toFixed(1) +
        " partner turns per pass, so a 6-pass goal is roughly " +
        Math.round(6 * rows.length / passed) + " turns" : ""));
    console.log("\nsamples:");
    rows.slice(0, 8).forEach(r => console.log("  [" + r.tag + " " +
      (r.passed ? "PASS" : r.used ? "used, wrong" : "DODGED") + "] " +
      r.partner.replace(/\n/g, " / ") + "  ||  " + r.student.replace(/\n/g, " / ")));
    return;
  }

  const drill = rows.filter(r => r.arm === "drill" && !r.unreadable);
  console.log("\ntarget verdict, drill arm (" + drill.length + " graded):");
  console.log(pad("kind", 8) + pad("n", 5) + pad("used right", 12) + "ok right");
  ["good", "bad", "other", "dodge"].forEach(kind => {
    const ok = drill.filter(r => r.f.kind === kind);
    if (!ok.length) return;
    console.log(pad(kind, 8) + pad(ok.length, 5) +
      pad(ok.filter(r => r.usedRight).length + "/" + ok.length, 12) +
      ok.filter(r => r.okRight).length + "/" + ok.length);
  });
  const both = drill.filter(r => r.usedRight && r.okRight).length;
  console.log("\nboth fields right: " + both + "/" + drill.length);

  /* The control the split makes trivial: the grader prompt is now identical in
   * and out of a drill, so the ledger cannot move. Kept as a running check that
   * it stays that way. */
  const plain = rows.filter(r => r.arm === "plain" && !r.unreadable);
  console.log("\ntag accuracy, grader untouched by the drill: " +
    plain.filter(r => r.tagRight).length + "/" + plain.length);

  const bad = drill.filter(r => !r.usedRight || !r.okRight);
  if (bad.length) {
    console.log("\ndisagreements:");
    bad.slice(0, 12).forEach(r => console.log("  [" + r.f.kind + " " + r.f.tag + "] " +
      r.f.text + "  got " + JSON.stringify(r.target) +
      " want " + JSON.stringify(EXPECT[r.f.kind])));
  }
  const un = rows.filter(r => r.unreadable).length;
  if (un) console.log("\n" + un + " unreadable replies");
  console.log("\ncost $" + rows.reduce((a, r) => a + (r.cost || 0), 0).toFixed(4));
})();
