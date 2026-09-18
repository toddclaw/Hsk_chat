/* Does a different repair strategy rescue a turn the same one cannot?
 *
 * The retry loop's repair prompt says the same thing every time. Read off a
 * production session, that produced four byte-identical attempts inside one
 * turn, and ten of fourteen turns spending all six tries. Three of the fights
 * were unwinnable by construction -- the gate asks for 练武术, the validator
 * forbids 练 -- and no rewording reaches a sentence whose only correct form is
 * above the level.
 *
 * This replays the app's loop outside the browser so the two arms face the same
 * turns, the same learner sentences and the same graders:
 *
 *   BASE    the repair prompt as shipped: the correction, then "say it again".
 *   LADDER  HSKPrompt.repairStrategy() picks an untried strategy from Tarone's
 *           taxonomy, chosen by rule from what the app already knows.
 *
 * FAITHFUL IN THE PARTS THAT DECIDE THE OUTCOME, and not in the rest. The
 * system prompt, the validator, the lexicon, the gate and its two models are
 * the real ones. The VOCABULARY repair is a simplified stand-in (it names the
 * rejected words without senses.js's grammatical explanations) -- shared by
 * both arms, so it cannot move the comparison, only the absolute numbers.
 *
 * WHAT IT COUNTS. Not grader agreement -- whether the TURN survives. A turn is
 * rescued if it ends with Chinese on the screen, and lost if it ends on the
 * stub. That is the number the learner experiences.
 *
 *   node tools/repair-ab.js [--turns 25] [--tries 6]
 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const HSK = require("../validator.js");
const HSKPrompt = require("../prompt.js");
const HSKSenses = require("../senses.js");
const bench = require("./grader-bench.js");

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };
const CHAT_MODEL = "qwen/qwen3-235b-a22b-2507";
const GATE_MODEL = "z-ai/glm-5.3-flash";
const TRIES = Number(arg("tries", 6));
const N = Number(arg("turns", 25));
const KEY = fs.readFileSync(process.env.OPENROUTER_KEY_FILE ||
  path.join(os.homedir(), "Documents", "openrouter_key.txt"), "utf8").trim();

let spend = 0;
async function call(messages, maxTokens, model) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || CHAT_MODEL, messages: messages,
                               max_tokens: maxTokens, temperature: 0.8, usage: { include: true } })
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((b.error && b.error.message) || "HTTP " + r.status);
      spend += (b.usage && b.usage.cost) || 0;
      const txt = b.choices && b.choices[0] && b.choices[0].message.content;
      if (!txt) throw new Error("empty");
      return txt.trim();
    } catch (e) { if (t === 3) throw e; await new Promise(s => setTimeout(s, 700 * (t + 1))); }
  }
}

/* The level's allowlist, built the way index.html builds it. */
const LEVEL = 2;
const words = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "hsk" + LEVEL + ".json"), "utf8"));
const baseLex = HSK.buildLexicon(words.words || words);
const lexWith = extra => HSK.buildLexicon((words.words || words).concat(extra || []));

const NEED_RE = /\[\[NEED:([^|\]]+)(?:\|([^|\]]*))?(?:\|([^\]]*))?\]\]/g;
function extractNeeds(text) {
  const needs = []; let out = "", last = 0, m;
  NEED_RE.lastIndex = 0;
  while ((m = NEED_RE.exec(text))) {
    const w = m[1].trim();
    out += text.slice(last, m.index) + w;
    needs.push({ w: w, p: (m[2] || "").trim(), d: (m[3] || "").trim() });
    last = m.index + m[0].length;
  }
  return { text: out + text.slice(last), needs: needs };
}

/* The other half of the validator, and leaving it out made every arm look
 * better than it is.
 *
 * An allowed CHARACTER is not an allowed GRAMMAR: 得 as a complement marker
 * (你说得对, 听得懂) and 过 as a verb are above HSK 2 even though both
 * characters are in the list. Reading the first run's output by eye found them
 * in 15% of the base arm's "clean" replies and 12% of the Chinese planner's --
 * sentences the real app would have rejected and retried.
 *
 * It costs a model call per surviving attempt, which is what it costs in the
 * app too. Shared by every arm. */
async function senseViolations(text, lex) {
  const tokens = HSK.segment(text, lex);
  const words = HSKSenses.wordsPresent(tokens);
  const out = [];
  for (const w of words) {
    const count = HSKSenses.standaloneHits(tokens, w).length;
    try {
      const raw = await call([{ role: "user",
        content: HSKSenses.classifyPrompt(w, text, count) }], 200);
      const classified = HSKSenses.parseClassification(raw, count);
      if (classified) out.push.apply(out, HSKSenses.checkSenses(w, classified, LEVEL));
    } catch (e) { /* as the app does: a failed classify lets the word through */ }
  }
  return out;
}

// Shared by both arms, so it cannot move the comparison.
function vocabRepair(bad) {
  return "你用了" + bad.map(w => "「" + w + "」").join("、") +
    "。这些词太难，学生不认识，不可以用。请用别的说法，再说一次。只说中文，不要解释。";
}

const systemFor = () => HSKPrompt.build({
  offer: [], reuse: [], require: "", level: LEVEL, label: "HSK " + LEVEL,
  length: "short", script: "simp", activity: "chat", storySegment: null,
  storyPhase: null, storyTopic: "", drillTag: "", drillEg: "", drillWord: "",
  side: null, secret: null, opening: false, words: ""
});

async function gate(text, lex) {
  for (const [model, opts] of [[null, { partner: true }],
                               [GATE_MODEL, { partner: true, bar: "soft" }]]) {
    let g;
    try {
      const raw = await call([{ role: "user",
        content: HSKPrompt.grade(Object.assign({ text: text }, opts)) }], 4000, model);
      g = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]);
    } catch (e) { return null; }                    // a failed gate passes, as shipped
    const ok = g.ok !== false && !(g.errors || []).length;
    if (ok) continue;
    const blocked = (HSK.validate(g.better || "", lex)
      .filter(v => v.kind === "bad" && !v.name)[0] || {}).text || "";
    return { note: (g.errors || []).map(e => e.note).filter(Boolean).join(" "),
             better: g.better || "", blocked: blocked };
  }
  return null;
}

/* ---------------------------------------------------------------- planning
 *
 * The third arm, and the one that argues the other two are solving the wrong
 * problem. Read the failures: the partner tried to describe a DESERT, tried to
 * say "practise martial arts", tried to say "I received a letter". None of
 * those are phrasing failures. The model chose something to say that HSK 2
 * cannot afford and then spent six tries failing to afford it.
 *
 * So the constraint moves from the last step to the first. Decide WHAT to say
 * before deciding how, name the words it will take, and check those against the
 * allowlist BEFORE spending a generation and two graders on it. A plan that
 * cannot be afforded is re-planned at planning cost.
 *
 * It asks for the content in English on purpose: the model's Chinese is fine,
 * what it lacks is judgement about what is expressible. The risk that buys is
 * English-shaped Chinese, which is the `unnatural` category the gate already
 * punishes -- so the gate fault rate is the number that catches it. */
function planPrompt(ctx, banned) {
  const convo = ctx.slice(-4).map(m =>
    (m.role === "user" ? "Student: " : "Partner: ") + m.content).join("\n");
  return "A student is learning Chinese at HSK " + LEVEL + ". Here is the end of " +
    "their conversation with a language partner:\n\n" + convo + "\n\n" +
    "Plan the partner's next reply. Do NOT write it.\n\n" +
    /* Read off the first run: planning bought its rescue rate partly with
     * genericness. Told only to plan something sayable, the partner answered a
     * message about coffee and getting up at 5:30 with a remark about
     * breakfast, and invented an apple and a cup of tea from nowhere. The plan
     * has to be a reply to THIS student, not a safe thing to say in general. */
    "The reply must answer what the student just said. Start by naming the " +
    "thing they told you and responding to THAT. Do not change the subject to " +
    "something easier unless nothing about their message can be said at all.\n\n" +
    "The reply may only use words a student at HSK " + LEVEL + " knows. That is a " +
    "small vocabulary: no 沙漠, no 练, no 封. Plan something that can be SAID " +
    "with those words, rather than something that would have to be worked " +
    "around.\n\n" +
    (banned.length ? "These words are above the level and must not be in the " +
      "plan: " + banned.join("、") + ". Plan something you can say without them.\n\n" : "") +
    'Reply with only a JSON object: {"say":"","words":[]}\n' +
    "say   — in English, what the reply will say: a response to the student, one " +
    "small thing about yourself, and a question back.\n" +
    "words — every content word in Chinese you intend to use. Not function words.";
}

async function plan(ctx, lex) {
  let banned = [];
  for (let round = 0; round < 3; round++) {
    let j;
    try {
      const raw = await call([{ role: "user", content: planPrompt(ctx, banned) }], 600);
      j = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]);
    } catch (e) { return null; }
    if (!j || !j.say) return null;
    const words = (j.words || []).map(String);
    const bad = words.filter(w =>
      HSK.validate(w, lex).some(v => v.kind === "bad" && !v.name));
    if (!bad.length) return { say: j.say, words: words, replans: round };
    banned = banned.concat(bad);
  }
  return null;                      // unaffordable after three goes; generate anyway
}

/* The same idea without the detour through English.
 *
 * The English planner asks the model to DECLARE which Chinese words it will
 * use, and that declaration is the weak link: it can name five words and then
 * write twenty. A plan written in Chinese goes through the validator whole, so
 * the check is complete rather than self-reported -- and nothing has to survive
 * a translation step, which is where English-shaped Chinese would come from.
 *
 * The cost is that the model does its thinking about what it can afford in the
 * language it is constrained in, which is the harder job. Which of those wins
 * is exactly the kind of question this repository answers by running it. */
/* The prompt now lives in prompt.js, so what this measures is what ships. */
const planZhPrompt = (ctx, banned) => HSKPrompt.planPrompt({
  turns: ctx.map(m => ({ role: m.role, text: m.content })),
  label: "HSK " + LEVEL, banned: banned });

async function planZh(ctx, lex) {
  let banned = [];
  for (let round = 0; round < 3; round++) {
    let text;
    try { text = HSK.stripScaffold(await call([{ role: "user",
      content: planZhPrompt(ctx, banned) }], 200)); }
    catch (e) { return null; }
    if (!text) return null;
    // The whole plan, not a word list it told us about.
    const bad = HSK.validate(text, lex).filter(v => v.kind === "bad" && !v.name);
    if (!bad.length) return { say: text, words: [], replans: round };
    banned = banned.concat(bad.map(v => v.text));
  }
  return null;
}

/* One turn, one arm. Returns how it ended and what it cost. */
async function runTurn(ctx, mode) {
  const ladder = mode === "ladder";
  const scratch = [{ role: "system", content: systemFor() }].concat(ctx);
  let planned = null;
  if (mode === "plan") {
    planned = await plan(ctx, baseLex);
    if (planned) {
      scratch.push({ role: "user", content:
        "Write your next reply in Chinese following this plan:\n" + planned.say +
        "\n\nUse only words the student knows. 只说中文，不要解释。" });
    }
  } else if (mode === "planZh") {
    planned = await planZh(ctx, baseLex);
    if (planned) {
      scratch.push({ role: "user", content:
        "请按这个意思回答学生，可以说得自然一点：\n" + planned.say +
        "\n\n只用学生认识的词。只说中文，不要解释。" });
    }
  }
  let gateFails = 0, prevText = null, introduced = false;
  const tried = [], strategies = [];
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    let raw;
    try { raw = await call(scratch, 400); }
    catch (e) { return { end: "error", attempt: attempt, strategies: strategies, planned: !!planned }; }
    const ex = extractNeeds(HSK.stripScaffold(raw));
    const lex = lexWith(ex.needs.map(n => n.w));
    const bad = HSK.validate(ex.text, lex).filter(v => v.kind === "bad" && !v.name);
    /* Spent only once vocabulary passes, exactly as the app spends it. */
    const senses = bad.length ? [] : await senseViolations(ex.text, lex);
    if (bad.length || senses.length) {
      scratch.push({ role: "assistant", content: raw });
      scratch.push({ role: "user", content: bad.length
        ? vocabRepair(bad.map(v => v.text))
        : HSKSenses.repairPrompt(senses) + "请用别的说法，再说一次。只说中文，不要解释。" });
      prevText = ex.text;
      continue;
    }
    const fault = await gate(ex.text, lex);
    if (!fault) return { end: "clean", attempt: attempt, strategies: strategies,
                         planned: !!planned, replans: planned ? planned.replans : null,
                         text: ex.text };
    gateFails++;
    let strategy = null;
    if (ladder) {
      strategy = HSKPrompt.repairStrategy({
        gateFails: gateFails, tried: tried, blocked: fault.blocked,
        repeated: ex.text === prevText, sameWord: false,
        allowIntroduce: !introduced && !ex.needs.length
      });
      if (strategy) {
        tried.push(strategy.id); strategies.push(strategy.id);
        if (strategy.id === "introduce") introduced = true;
      }
    }
    const base = "你刚才写的中文有问题：" + (fault.note || "不是中国人会说的话") + "。" +
      (fault.better ? "更自然的说法是「" + fault.better + "」。" : "");
    scratch.push({ role: "assistant", content: raw });
    scratch.push({ role: "user", content: strategy
      ? base + strategy.text + "只说中文，不要解释。"
      : base + "请用这个意思重新说一次，其他的规则不变。" });
    prevText = ex.text;
  }
  return { end: "stub", attempt: TRIES, strategies: strategies, planned: !!planned,
           replans: planned ? planned.replans : null };
}

(async () => {
  /* Real learner turns, in their real context -- the same input replay-partner.js
   * uses, and the reason the corpus has the right KIND of difficulty in it. */
  const ex = JSON.parse(fs.readFileSync(
    path.join(os.homedir(), "Documents", "chat-export.json"), "utf8")).items;
  const ctxs = [];
  let hist = [], act = null, day = null;
  for (const m of ex) {
    if (m.activity !== "chat" || (m.role !== "user" && m.role !== "assistant")) { continue; }
    if (act !== m.activity || day !== m.day) { hist = []; act = m.activity; day = m.day; }
    hist.push({ role: m.role, content: m.text });
    if (m.role === "user") ctxs.push(hist.slice());
  }
  const picked = ctxs.filter((_, i) => i % Math.max(1, Math.floor(ctxs.length / N)) === 0).slice(0, N);
  console.log(picked.length + " real learner turns, " + TRIES + " tries, two arms\n");

  const rows = [];
  const queue = picked.map((c, i) => ({ i, c }));
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const job = queue.shift();
      const base = await runTurn(job.c, "base");
      /* The ladder is dropped: round twenty-five measured it at 5-8 against
       * base, p = 0.58, and it would cost a quarter of this run to re-confirm
       * a null. */
      const pln = await runTurn(job.c, "plan");
      const pzh = await runTurn(job.c, "planZh");
      rows.push({ i: job.i, base: base, pln: pln, pzh: pzh });
      [base, pln, pzh].forEach(r => process.stdout.write(r.end === "clean" ? "." : "x"));
    }
  }));
  console.log("\n");

  const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "n/a";
  for (const [name, key] of [["BASE   (repair as shipped)", "base"],
                            ["PLAN   (decide first, English)", "pln"],
                            ["PLAN-ZH(decide first, Chinese)", "pzh"]]) {
    const r = rows.map(x => x[key]);
    const clean = r.filter(x => x.end === "clean");
    console.log(name.padEnd(32) +
      "rescued " + pct(clean.length, r.length).padEnd(5) +
      " (" + clean.length + "/" + r.length + ")   stub " + pct(r.filter(x => x.end === "stub").length, r.length) +
      "   mean tries " + (r.reduce((s, x) => s + x.attempt, 0) / r.length).toFixed(1));
  }
  /* Paired, because the arms saw the same turns: what matters is the turns one
   * rescued and the other did not, not the rates side by side. An exact McNemar
   * on the discordant pairs, because round twenty-five's 7-5 looked like a win
   * and was p = 0.77. */
  const fact = n => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  const choose = (n, k) => fact(n) / (fact(k) * fact(n - k));
  for (const [a, b] of [["pln", "base"], ["pzh", "base"], ["pzh", "pln"]]) {
    const won = rows.filter(x => x[a].end === "clean" && x[b].end !== "clean").length;
    const lost = rows.filter(x => x[b].end === "clean" && x[a].end !== "clean").length;
    const n = won + lost;
    let p = 1;
    if (n) { let t = 0; for (let k = 0; k <= Math.min(won, lost); k++) t += choose(n, k);
             p = Math.min(1, 2 * t / Math.pow(2, n)); }
    console.log("\n" + a + " vs " + b + ": rescued " + won + " the other lost, lost " +
                lost + "   exact McNemar p = " + p.toFixed(2));
  }
  for (const k of ["pln", "pzh"]) {
    const rp = rows.map(x => x[k].replans).filter(r => r !== null && r !== undefined);
    const made = rows.filter(x => x[k].planned).length;
    if (rp.length) console.log(k + ": plan made on " + made + "/" + rows.length +
      " turns, re-planned for cost on " + rp.filter(r => r > 0).length + "/" + rp.length);
  }

  console.log("spend $" + spend.toFixed(4));
  fs.writeFileSync(path.join(__dirname, "repair-ab-results.json"),
    JSON.stringify({ when: new Date().toISOString(), tries: TRIES, rows: rows }, null, 1));
})().catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
