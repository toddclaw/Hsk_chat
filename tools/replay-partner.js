/* Partner turns of the RIGHT KIND, at whatever volume is wanted.
 *
 * Round twenty-two found that the 204-turn synthetic corpus matched real traffic
 * on how OFTEN the partner errs and not on WHAT it gets wrong: generated in a
 * clean loop against a simulated learner the partner writes smooth Chinese with
 * fine cracks in it (a stray 了, 米饭很饱), while answering Todd's actual
 * sentences it comes apart (我家在城市下面, 你有它的样子吗). Eleven arms were
 * raced on that difference.
 *
 * The missing ingredient was never the prompt -- it is the learner. So this
 * replays TODD'S OWN TURNS, in their real order and their real context, through
 * the same system prompt the app builds, and keeps what the partner says back.
 * Real input, fresh output, and as many draws per turn as the budget allows.
 *
 * Chat and focused only. Twenty needs a `secret` and drill needs a tag, an
 * example and a word, none of which the export carries -- and 19 of the 21
 * outright errors in the real corpus are chat or focused anyway.
 *
 * Conversations are segmented on a run of messages sharing an activity and a
 * day, because `pull-chats.js` reports the conversation COUNT and not an id per
 * row. A mis-segmentation costs a little context on one turn and nothing else:
 * the learner's sentence is still real and the partner still has to answer it.
 *
 * OUTPUT GOES OUTSIDE THE REPOSITORY -- it is generated from real user writing.
 *
 *   node tools/replay-partner.js [--draws 2] [--model ...]
 */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const HSKPrompt = require("../prompt.js");

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");
const DRAWS = Number(arg("draws", 2));
const KEEP = new Set(["chat", "focused"]);
const KEY = fs.readFileSync(process.env.OPENROUTER_KEY_FILE ||
  path.join(os.homedir(), "Documents", "openrouter_key.txt"), "utf8").trim();

let spend = 0;
async function call(messages, maxTokens) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, messages: messages, max_tokens: maxTokens,
                               temperature: 0.8, usage: { include: true } })
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((b.error && b.error.message) || "HTTP " + r.status);
      spend += (b.usage && b.usage.cost) || 0;
      const txt = b.choices && b.choices[0] && b.choices[0].message.content;
      if (!txt) throw new Error("empty");
      return txt.trim();
    } catch (e) {
      if (t === 3) throw e;
      await new Promise(s => setTimeout(s, 800 * (t + 1)));
    }
  }
}

// Identical to partner-corpus.js's, so a replayed turn and a generated one face
// the same rules and any difference between the corpora is the learner.
const systemFor = (level, activity, opening) => HSKPrompt.build({
  offer: [], reuse: [], require: "", level: level, label: "HSK " + level,
  length: "short", script: "simp", activity: activity, storySegment: null,
  storyPhase: null, storyTopic: "", drillTag: "", drillEg: "", drillWord: "",
  side: null, secret: null, opening: opening, words: ""
});

/* A run of messages sharing an activity and a day. The stub replies are dropped
 * from the history: 我不会说 is the app's failure path, not something the
 * partner would have said, and leaving it in teaches the replay to produce it. */
const STUB = /^(我不会说|我不知道)。?$/;
function threads(items) {
  const out = [];
  let cur = null;
  for (const m of items) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (!KEEP.has(m.activity)) { cur = null; continue; }
    const k = m.activity + "/" + m.day;
    if (!cur || cur.k !== k) out.push(cur = { k: k, activity: m.activity, level: null, msgs: [] });
    if (m.level) cur.level = m.level;
    if (!(m.role === "assistant" && STUB.test(m.text.trim()))) cur.msgs.push(m);
  }
  return out.filter(t => t.msgs.some(m => m.role === "user"));
}

(async () => {
  const ex = JSON.parse(fs.readFileSync(
    path.join(os.homedir(), "Documents", "chat-export.json"), "utf8")).items;
  const ts = threads(ex);
  const jobs = [];
  for (const t of ts) {
    const level = t.level || 2;
    const history = [];
    for (const m of t.msgs) {
      if (m.role === "assistant") { history.push({ role: "assistant", content: m.text }); continue; }
      history.push({ role: "user", content: m.text });
      const ctx = history.slice();                 // frozen: the real prefix
      for (let d = 0; d < DRAWS; d++)
        jobs.push({ activity: t.activity, level: level, draw: d,
                    prompt: m.text, ctx: ctx });
    }
  }
  console.log(ts.length + " threads, " + (jobs.length / DRAWS) + " real learner turns, " +
              DRAWS + " draws -> " + jobs.length + " partner turns");

  const out = [], queue = jobs.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const j = queue.shift();
      const sys = systemFor(j.level, j.activity, j.ctx.length === 1);
      try {
        const text = await call([{ role: "system", content: sys }].concat(j.ctx), 400);
        out.push({ activity: j.activity, level: j.level, draw: j.draw,
                   prompt: j.prompt, text: text });
        process.stdout.write(".");
      } catch (e) { process.stdout.write("x"); }
    }
  }));
  out.forEach((r, n) => { r.id = "Q" + String(n + 1).padStart(4, "0"); });
  const file = path.join(os.homedir(), "Documents", "replay-partner.json");
  fs.writeFileSync(file, JSON.stringify({ model: MODEL, built: new Date().toISOString(),
    note: "Partner turns generated by replaying Todd's own learner turns, in " +
          "context, through the app's own system prompt. Built by " +
          "tools/replay-partner.js. Real input, fresh output.",
    items: out }, null, 1));
  console.log("\n" + out.length + " turns -> " + file + "   spend $" + spend.toFixed(4));
})().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
