/* A corpus of the PARTNER's Chinese, which is what the correctness gate judges.
 *
 * Every number in grader-bench-results.md through round nine is learner error
 * from MuCGEC: a human writing Chinese badly. The gate's actual job is the
 * opposite distribution -- a fluent model writing Chinese well, with the
 * occasional structural oddity -- and nothing measures it, because no such
 * corpus exists. The partner is a model, its output is fresh, and nobody has
 * annotated it.
 *
 * So it gets generated, through the real prompt, and labelled by Claude. Round
 * nine is what licenses that: blind against human ground truth the labelling
 * scores 93%, with its residual disagreement definitional rather than
 * perceptual. Attenuated, but good enough to answer a seven-point question.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO
 *
 * It does not balance the corpus. Partner Chinese is mostly correct, and the
 * rate at which it is not IS the finding -- at 66% specificity a gate that
 * retries on every fault spends most of its retries on Chinese that was already
 * fine, and only the natural rate says how often that happens. Sampling to 50/50
 * would measure the grader and say nothing about the gate.
 *
 * It does not use names. 王, 李 and 明 are all above HSK 1, and CLAUDE.md's rule
 * is that names contaminate a vocabulary measurement. The learner side is told
 * to avoid them so the corpus stays usable for more than correctness.
 *
 *   node tools/partner-corpus.js [--n 34] [--turns 6]   # generate
 *   node tools/partner-corpus.js --grade [--arm shipped|decomposed]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const HSKPrompt = require("../prompt.js");

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_FILE = process.env.OPENROUTER_KEY_FILE ||
  path.join(os.homedir(), "Documents", "openrouter_key.txt");
const OUT = path.join(__dirname, "partner-corpus.json");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");
const CONVOS = Number(arg("n", 24));
const TURNS = Number(arg("turns", 6));

let spend = 0;
const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("no key in " + KEY_FILE); process.exit(1); }

async function call(messages, maxTokens) {
  for (let tryN = 0; tryN < 4; tryN++) {
    try {
      const r = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens,
                               temperature: 0.8, usage: { include: true } })
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((b.error && b.error.message) || "HTTP " + r.status);
      spend += (b.usage && b.usage.cost) || 0;
      const t = b.choices && b.choices[0] && b.choices[0].message.content;
      if (!t) throw new Error("empty");
      return t.trim();
    } catch (e) {
      if (tryN === 3) throw e;
      await new Promise(s => setTimeout(s, 800 * (tryN + 1)));
    }
  }
}

/* The app's own prompt, not an approximation of it. If build()'s signature
 * drifts, this corpus stops describing the shipped partner and the drift is
 * silent, so the opts mirror index.html's defaultPrompt() field for field. */
function systemFor(level, activity, opening) {
  return HSKPrompt.build({
    offer: [], reuse: [], require: "",
    level: level, label: "HSK " + level,
    length: "short", script: "simp", activity: activity,
    storySegment: null, storyPhase: null,
    storyTopic: activity === "story" ? "在公园" : "",
    drillTag: "", drillEg: "", drillWord: "",
    side: null, secret: null,
    opening: opening, words: ""
  });
}

/* The learner is simulated because only the partner's half is being labelled.
 * It is told to write like an HSK 2 learner, errors and all -- a clean learner
 * produces a partner that never has to repair anything, which is not the
 * conversation the gate sits in. */
const LEARNER = level =>
  "You are simulating a language learner at HSK " + level + " chatting in Chinese. " +
  "Reply to the last message in one or two short sentences of Chinese, using only " +
  "vocabulary an HSK " + level + " student knows. Write the way a real learner does: " +
  "sometimes plainly wrong, sometimes awkward, sometimes fine. Occasionally change " +
  "the subject, ask a question back, or say you do not understand. " +
  "Never use a personal name. Output the Chinese only, nothing else.";

/* Topics, and why there are forty of them.
 *
 * The first 204 turns ran on twelve, and 11 of them opened with the identical
 * 我今天吃了煎蛋 -- a fifth of the corpus sharing five sentences. Duplicate turns
 * do not add information, they add weight to whatever the partner happens to do
 * with one prompt, and the positive class is small enough already. */
const TOPICS = ["天气", "吃饭", "家人", "工作", "买东西", "学校", "旅行",
                "运动", "看电视", "睡觉", "朋友", "坐车",
                "生病", "过生日", "养宠物", "打电话", "洗衣服", "做作业",
                "去医院", "剪头发", "搬家", "找东西", "下雪", "夏天",
                "音乐", "画画", "游泳", "爬山", "喝茶", "点菜",
                "问路", "银行", "邮局", "手机坏了", "邻居", "春节",
                "早起", "加班", "看书", "钓鱼"];

/* The learner's first line, which is what actually decides where a conversation
 * goes. One fixed opener per topic produced the 11 identical 煎蛋 turns. */
const OPENERS = ["我想聊聊", "你喜欢", "跟我说说", "我不太懂", "今天我想问",
                 "我们聊", "我有一个问题，关于"];

async function convo(i) {
  const level = i % 4 === 3 ? 3 : 2;              // HSK 2 working into 3
  const activity = i % 6 === 5 ? "story" : i % 6 === 4 ? "focused" : "chat";
  const sys = systemFor(level, activity, true);
  const history = [];
  const out = [];

  for (let t = 0; t < TURNS; t++) {
    const partner = await call(
      [{ role: "system", content: systemFor(level, activity, t === 0) }].concat(history), 400);
    history.push({ role: "assistant", content: partner });
    out.push({ convo: i, turn: t, level, activity, text: partner,
               before: history.slice(0, -1).slice(-2).map(m => m.role[0] + ": " + m.content) });

    const learner = await call([{ role: "system", content: LEARNER(level) }].concat(
      history.map(m => ({ role: m.role === "assistant" ? "user" : "assistant", content: m.content })),
      t === 0 ? [{ role: "user", content: OPENERS[(i * 3) % OPENERS.length] +
                                          TOPICS[i % TOPICS.length] }] : []), 120);
    history.push({ role: "user", content: learner });
  }
  process.stdout.write(".");
  return out;
}

/* ------------------------------------------------------------ scoring
 *
 * Two bars, because the label set has two axes and the gate's bar is not yet
 * chosen. STRICT counts only outright errors as faults and treats awkward-but-
 * grammatical as acceptable; LOOSE counts both, which is the "worth imitating"
 * standard the gate was asked for.
 *
 * Recall and specificity are reported, but PRECISION is the number that decides
 * whether a gate is shippable. At a low base rate a grader can have fine
 * specificity and still be wrong most times it fires, and every firing costs a
 * retry against Chinese that was already fine.
 */
async function grade() {
  const arm = arg("arm", "shipped");
  const bench = require("./grader-bench.js");
  const judge = arm === "decomposed"
    ? (text, label, KEY) => bench.judgeDecomposed(text, label, KEY)
    : arm === "decomposedNative"
    ? (text, label, KEY) => bench.judgeDecomposed(text, label, KEY, true)
    : arm === "rewrite" || arm === "rewriteLoose"
    ? (text, label, KEY) => bench.judgeRewrite(text, KEY,
        arm === "rewriteLoose" ? "loose" : "strict")
    : arm === "lens" || arm === "lensLoose"
    ? (text, label, KEY) => bench.judgeLens(text, label, KEY, null,
        arm === "lensLoose" ? "loose" : "strict")
    : (text, label, KEY) => bench.judgeArm(arm, text, label, KEY);
  const file = arg("corpus", null) ? path.join(__dirname, arg("corpus")) : OUT;
  const corpus = JSON.parse(fs.readFileSync(file, "utf8")).items;
  const L = JSON.parse(fs.readFileSync(path.join(__dirname,
    arg("labels", "partner-corpus-labels.json")), "utf8"));
  const wrong = new Set(L.wrong), unnat = new Set(L.unnatural), eng = new Set(L.english);
  const labelled = corpus.filter(i => wrong.has(i.id) || unnat.has(i.id) || eng.has(i.id)).length ||
                   L.wrong.some(id => corpus.find(i => i.id === id));

  console.log("arm " + arm + "  model " + MODEL + "  " + corpus.length + " partner turns\n");
  if (require("./grader-bench.js").MODEL !== MODEL) {
    throw new Error("grader-bench.js is judging with " + require("./grader-bench.js").MODEL +
                    " while this harness reports " + MODEL + " -- the two read --model " +
                    "from the same argv and have drifted apart");
  }
  const rows = [];
  const queue = corpus.slice();
  /* The cascade fans out ~45 calls per turn, so worker count here is really
   * worker count x 45 in flight. At 20 it tripped OpenRouter's rate limit hard
   * enough to fail 164 of 204 turns -- and before failures were made loud, that
   * same limit had quietly scored the cascade at 24% instead of 76% by returning
   * "clean" for turns whose every call had died. Low and slow, overridable. */
  const WIDTH = Number(arg("width", /^lens|^rewrite/.test(arm) ? 5 : 6));
  await Promise.all(Array.from({ length: WIDTH }, async () => {
    while (queue.length) {
      const it = queue.shift();
      /* Sonnet dropped 12 of 204 turns to transient API errors on its first run,
       * which put its headline on a different denominator from every other arm's.
       * Arms are compared item by item, so a skipped item is not a rounding
       * error, it is a hole in the comparison. */
      let ok = null;
      for (let t = 0; t < 4 && ok === null; t++) {
        try { ok = await judge(it.text, "HSK " + it.level, KEY); }
        catch (e) {
          if (t === 3) { process.stdout.write("x"); break; }
          await new Promise(r => setTimeout(r, 1000 * (t + 1)));
        }
      }
      if (ok === null) continue;
      rows.push({ id: it.id, activity: it.activity, level: it.level, ok: ok });
      process.stdout.write(".");
    }
  }));
  rows.sort((a, b) => a.id < b.id ? -1 : 1);

  const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "n/a";
  console.log("\n");
  if (!labelled) {
    console.log("(corpus carries no labels yet -- verdicts written, scoring skipped)");
    fs.writeFileSync(out, JSON.stringify({ model: MODEL, arm: arm,
      when: new Date().toISOString(), rows: rows }, null, 1));
    return console.log("written: " + path.basename(out));
  }
  /* English leakage sits in the strict bar. It is not a question of degree --
   * rule 4 forbids it outright and a learner cannot read it -- so scoring it as
   * acceptable would credit a grader for passing text the app must never show. */
  for (const [name, faulty] of [["strict (wrong, or English leaked in)", id => wrong.has(id) || eng.has(id)],
                                ["loose  (+ grammatical but unnatural)", id => wrong.has(id) || eng.has(id) || unnat.has(id)]]) {
    const bad = rows.filter(r => faulty(r.id)), good = rows.filter(r => !faulty(r.id));
    const caught = bad.filter(r => !r.ok).length, passed = good.filter(r => r.ok).length;
    const fires = rows.filter(r => !r.ok).length;
    console.log(name);
    console.log("  recall      " + caught + "/" + bad.length + "  " + pct(caught, bad.length));
    console.log("  specificity " + passed + "/" + good.length + "  " + pct(passed, good.length));
    console.log("  overall     " + (caught + passed) + "/" + rows.length + "  " +
                pct(caught + passed, rows.length));
    console.log("  the gate fires on " + fires + "/" + rows.length + " turns, " +
                pct(caught, fires) + " of them justified\n");
  }
  /* The model is in the filename because it is a variable of the experiment, not
   * a setting -- round twelve runs the same arm on a different one, and a result
   * file that silently overwrote its own baseline would lose the comparison. */
  const slug = MODEL === "qwen/qwen3-235b-a22b-2507" ? "" : "-" + MODEL.split("/").pop();
  const tag = arg("corpus", null) ? "-" + path.basename(arg("corpus"), ".json").replace("partner-corpus", "c") : "";
  const out = path.join(__dirname, "partner-corpus-graded-" + arm + slug + tag + ".json");
  fs.writeFileSync(out, JSON.stringify({ model: MODEL, arm: arm,
    when: new Date().toISOString(), rows: rows }, null, 1));
  // spend lives in grader-bench.js's module scope here, not this one's.
  console.log("written: " + path.basename(out));
}

async function generate() {
  console.log("model " + MODEL + "  " + CONVOS + " conversations x " + TURNS + " turns");
  const all = [];
  const queue = Array.from({ length: CONVOS }, (_, i) => i);
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const i = queue.shift();
      try { all.push.apply(all, await convo(i)); }
      catch (e) { process.stdout.write("x"); console.error("\nconvo " + i + ": " + e.message); }
    }
  });
  await Promise.all(workers);
  all.sort((a, b) => a.convo - b.convo || a.turn - b.turn);
  const off = Number(arg("id-offset", 0));
  all.forEach((r, n) => { r.id = "P" + String(n + 1 + off).padStart(4, "0"); });
  const out = arg("out", null) ? path.join(__dirname, arg("out")) : OUT;
  fs.writeFileSync(out, JSON.stringify({
    model: MODEL, built: new Date().toISOString(),
    note: "Partner turns generated through HSKPrompt.build(). Labels are added " +
          "separately and are Claude's, not a human's -- see round nine.",
    items: all
  }, null, 1));
  console.log("\n" + all.length + " partner turns -> " + out + "   spend $" + spend.toFixed(4));
}

(args.indexOf("--grade") !== -1 ? grade : generate)()
  .catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
