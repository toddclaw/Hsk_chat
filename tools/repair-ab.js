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

/* One turn, one arm. Returns how it ended and what it cost. */
async function runTurn(ctx, ladder) {
  const scratch = [{ role: "system", content: systemFor() }].concat(ctx);
  let gateFails = 0, prevText = null, introduced = false;
  const tried = [], strategies = [];
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    let raw;
    try { raw = await call(scratch, 400); } catch (e) { return { end: "error", attempt, strategies }; }
    const ex = extractNeeds(HSK.stripScaffold(raw));
    const lex = lexWith(ex.needs.map(n => n.w));
    const bad = HSK.validate(ex.text, lex).filter(v => v.kind === "bad" && !v.name);
    if (bad.length) {
      scratch.push({ role: "assistant", content: raw });
      scratch.push({ role: "user", content: vocabRepair(bad.map(v => v.text)) });
      prevText = ex.text;
      continue;
    }
    const fault = await gate(ex.text, lex);
    if (!fault) return { end: "clean", attempt, strategies, text: ex.text };
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
  return { end: "stub", attempt: TRIES, strategies };
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
      const base = await runTurn(job.c, false);
      const lad = await runTurn(job.c, true);
      rows.push({ i: job.i, base, lad });
      process.stdout.write(base.end === "clean" ? "." : "x");
      process.stdout.write(lad.end === "clean" ? "." : "x");
    }
  }));
  console.log("\n");

  const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "n/a";
  for (const [name, key] of [["BASE  (repair as shipped)", "base"], ["LADDER(strategies)", "lad"]]) {
    const r = rows.map(x => x[key]);
    const clean = r.filter(x => x.end === "clean");
    console.log(name.padEnd(26) +
      "rescued " + pct(clean.length, r.length).padEnd(5) +
      " (" + clean.length + "/" + r.length + ")   stub " + pct(r.filter(x => x.end === "stub").length, r.length) +
      "   mean tries " + (r.reduce((s, x) => s + x.attempt, 0) / r.length).toFixed(1));
  }
  /* Paired, because the arms saw the same turns: what matters is the turns one
   * rescued and the other did not, not the two rates side by side. */
  const won = rows.filter(x => x.lad.end === "clean" && x.base.end !== "clean");
  const lost = rows.filter(x => x.base.end === "clean" && x.lad.end !== "clean");
  console.log("\npaired: ladder rescued " + won.length + " the base lost, " +
              "lost " + lost.length + " the base rescued");
  const used = {};
  rows.forEach(x => (x.lad.strategies || []).forEach(s => { used[s] = (used[s] || 0) + 1; }));
  console.log("strategies used: " + JSON.stringify(used));
  console.log("spend $" + spend.toFixed(4));
  fs.writeFileSync(path.join(__dirname, "repair-ab-results.json"),
    JSON.stringify({ when: new Date().toISOString(), tries: TRIES, rows: rows }, null, 1));
})().catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
