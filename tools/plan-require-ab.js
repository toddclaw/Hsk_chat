/* Does telling the PLANNER which word the turn owes stop the require retry?
 *
 * A steering turn -- Ghost Words, Flashcard Chat -- has to contain a particular
 * word. turn() enforces that mechanically: if the generated reply does not
 * contain it, the reply is thrown away and the model is told
 * 请一定要用「X」这个词，放在一句话里，再说一次. That instruction can only be obeyed
 * one way, by wedging the word into prose that is already finished.
 *
 * Real case from debug_log, 2026-09-23T01:03Z. Attempt 1 was
 * 我们快去找老师。老师会帮我们找到手机。-- clean, idiomatic, gate-passing, and with
 * no 而且 in it. The require check rejected it and attempt 2 came back
 * 我们快去找老师，而且老师会帮我们 -- an additive connective on a causal relation.
 * Todd copied that sentence verbatim into his own next turn and the per-word
 * grader marked him wrong for it. The app wrote the error, required it, showed
 * it, and then charged him for it.
 *
 * The hypothesis is the one RESEARCH.md keeps arriving at: the decision that
 * goes wrong happens before anything checks. planPrompt() chose what to say
 * without being told which word the turn owed, so by the time the requirement
 * was applied the content was already settled.
 *
 * ARMS. Both generate with the same system prompt, which already carries
 * `require`, so the ONLY difference is whether the plan knew:
 *
 *   blind  planPrompt() as it shipped -- no `required`
 *   aware  planPrompt({ required }) -- plan a meaning that wants the word
 *
 * HEADLINE is mechanical and needs no judge: how often attempt 1 already
 * contains the required word, so the retry never fires and nothing ever gets
 * wedged. Also counted, because a prompt fix that trades one failure for
 * another has not fixed anything: how often the plan survives the vocabulary
 * validator, and how many re-plan rounds it costs.
 *
 * INPUT is real. Todd's own learner turns in their real context, and required
 * words taken from the per-word verdicts actually stored on that thread -- so
 * the word a turn owes is a word that conversation really was steering at.
 *
 * OUTPUT GOES OUTSIDE THE REPOSITORY -- generated from real user writing.
 *
 *   node tools/plan-require-ab.js [--draws 1] [--model ...] [--limit 0]
 */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const HSKPrompt = require("../prompt.js");
const HSK = require("../validator.js");
const HSKPace = require("../pace.js");

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");
const DRAWS = Number(arg("draws", 1));
const LIMIT = Number(arg("limit", 0));            // 0 = every turn
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

/* The app's own lexicon, and the targets have to be IN it.
 *
 * A ghost word is above the learner's level by definition -- that is what makes
 * it a ghost word -- so a lexicon built from data/hsk<N>.json alone does not
 * contain it. 而且 is HSK 3 against Todd's HSK 2. Segmenting with that lexicon
 * splits it into 而 and 且, so spot() never finds it and every arm scores a flat
 * 0%, and validate() calls it out-of-level so every plan that obeys the
 * requirement is rejected and re-planned to death. The measurement would have
 * been a confident fabrication in both directions.
 *
 * The browser does not have this problem because S.lex is base PLUS extra,
 * learning and known, and a word cannot be a ghost target without having been
 * introduced. Passing the targets as `extra` is that same thing. Real entries
 * out of the cumulative top-level list, so pinyin and gloss are the app's.
 *
 * And the targets alone are not enough either. The export's `introduced` column
 * names every word the app taught above the level -- 117 of them -- and all of
 * them were legal in S.lex when these conversations happened. Validating a plan
 * against the level list plus a handful of ghost words rejects plans the real
 * app would have accepted, which lands squarely on the number this A/B exists
 * to read: how often the planner cannot afford to obey the requirement.
 *
 * ponytail: the whole introduced set is used for every turn, so a word taught
 * in September is legal in an August plan. It over-approximates by a few words
 * at the start of history and is far closer than the alternative; thread it
 * chronologically if the plan-failure rate is ever the headline rather than a
 * guard-rail. */
const ALL = new Map(JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "data", "hsk4.json"), "utf8")).map(e => [e.w, e]));
const EXPORT = JSON.parse(fs.readFileSync(
  path.join(os.homedir(), "Documents", "chat-export.json"), "utf8")).items;
const INTRODUCED = [...new Set([].concat.apply([], EXPORT
  .map(i => i.introduced || [])).map(x => (typeof x === "string" ? x : x && x.w))
  .filter(Boolean))];
const lexFor = (level, extra) => HSK.buildLexicon(
  JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "data", "hsk" + level + ".json"), "utf8")),
  [...new Set((extra || []).concat(INTRODUCED))].map(w => ALL.get(w) || { w: w }));

const systemFor = (level, activity, opening, require) => HSKPrompt.build({
  offer: [], reuse: [], require: require, level: level, label: "HSK " + level,
  length: "short", script: "simp", activity: activity, storySegment: null,
  storyPhase: null, storyTopic: "", drillTag: "", drillEg: "", drillWord: "",
  side: null, secret: null, opening: opening, words: ""
});

/* Threads, exactly as replay-partner.js segments them: a run of messages
 * sharing an activity and a day. Steering activities only -- an unsteered chat
 * turn owes no word and has nothing to measure. */
const STUB = /^(我不会说|我不知道)。?$/;
const KEEP = new Set(["focused", "flashcard"]);
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

/* What this conversation was really steering at: every word the app asked a
 * per-word question about anywhere in the thread. Those verdicts are only
 * stored for targets of the set in play, so this is the real target list and
 * not a guess. Threads with none are dropped -- there is no requirement to
 * measure. */
function targetsOf(t) {
  const s = new Set();
  for (const m of t.msgs)
    Object.keys((m.grade && m.grade.ghost) || {}).forEach(w => s.add(w));
  return [...s];
}

/* One planning attempt, with the app's own re-plan loop: a plan that reaches
 * for a word above the level is rejected, the word is banned and it tries
 * again, three rounds. Returns the plan and what it cost to get one. */
async function plan(turns, label, lex, required) {
  let banned = [];
  /* Every rejected plan and the word that sank it, kept rather than counted.
   * "No affordable plan 83%" is a statistic with no content -- the question it
   * raises is WHICH words the planner keeps reaching for, and whether asking
   * for the required word is what sends it after them. */
  const tries = [];
  for (let round = 0; round < 3; round++) {
    let text;
    try {
      /* The candidate arm is built HERE and not in prompt.js, because it lost
       * and nothing ships it. planPrompt() is untouched in production; this is
       * the rejected arm kept runnable so the result can be re-checked. */
      var base = HSKPrompt.planPrompt({ turns: turns, label: label, banned: banned });
      var body = required
        ? base.replace("\u53ea\u5199\u4e2d\u6587\uff0c\u4e0d\u8981\u89e3\u91ca\u3002",
            "\u4f60\u8fd9\u6b21\u56de\u7b54\u91cc\u4e00\u5b9a\u8981\u7528\u300c" + required +
            "\u300d\u8fd9\u4e2a\u8bcd\u3002\u8bf7\u60f3\u4e00\u4e2a\u672c\u6765\u5c31\u4f1a" +
            "\u7528\u5230\u8fd9\u4e2a\u8bcd\u7684\u610f\u601d\uff0c\u8ba9\u5b83\u7528\u5f97" +
            "\u81ea\u7136\uff0c\u4e0d\u8981\u60f3\u597d\u4e86\u522b\u7684\u610f\u601d\u518d" +
            "\u628a\u8fd9\u4e2a\u8bcd\u786c\u585e\u8fdb\u53bb\u3002\n\n" +
            "\u53ea\u5199\u4e2d\u6587\uff0c\u4e0d\u8981\u89e3\u91ca\u3002")
        : base;
      text = HSK.stripScaffold(await call([{ role: "user", content: body }], 200));
    } catch (e) { return { text: null, rounds: round, failed: true, tries: tries }; }
    if (!text) return { text: null, rounds: round, failed: true, tries: tries };
    const bad = HSK.validate(text, lex).filter(v => v.kind === "bad" && !v.name);
    if (!bad.length) return { text: text, rounds: round, failed: false, tries: tries };
    tries.push({ text: text, bad: bad.map(v => v.text) });
    banned = banned.concat(bad.map(v => v.text));
  }
  return { text: null, rounds: 3, failed: true, tries: tries };
}

(async () => {
  const ex = EXPORT;

  const jobs = [];
  for (const t of threads(ex)) {
    const targets = targetsOf(t);
    if (!targets.length) continue;
    const level = t.level || 2;
    const history = [];
    let n = 0;
    for (const m of t.msgs) {
      if (m.role === "assistant") { history.push({ role: "assistant", content: m.text }); continue; }
      history.push({ role: "user", content: m.text });
      /* Rotate through the thread's targets rather than always taking the
       * first: ghostRequired() picks whichever is still owed, which changes as
       * the session banks words, and always steering at one word would measure
       * that word and not the mechanism. */
      const required = targets[n++ % targets.length];
      const ctx = history.slice();                    // frozen: the real prefix
      for (let d = 0; d < DRAWS; d++)
        jobs.push({ activity: t.activity, level: level, draw: d, required: required,
                    targets: targets, prompt: m.text, ctx: ctx });
    }
  }
  const live = LIMIT ? jobs.slice(0, LIMIT) : jobs;
  console.log(live.length + " jobs (" + (live.length / DRAWS) + " turns x " + DRAWS +
              " draws) x 2 arms, model " + MODEL);

  const lexes = {};
  const out = [], queue = live.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const j = queue.shift();
      const label = "HSK " + j.level;
      const lk = j.level + "|" + j.targets.join(",");
      const lex = lexes[lk] || (lexes[lk] = lexFor(j.level, j.targets));
      const sys = systemFor(j.level, j.activity, j.ctx.length === 1, j.required);
      for (const arm of ["blind", "aware"]) {
        try {
          const p = await plan(j.ctx.slice(-4).map(m => ({ role: m.role, text: m.content })),
                               label, lex, arm === "aware" ? j.required : "");
          const msgs = [{ role: "system", content: sys }].concat(j.ctx);
          if (p.text) msgs.push({ role: "user", content: HSKPrompt.planInstruction(p.text) });
          let text = HSK.stripScaffold(await call(msgs, 400));
          /* The require retry, because production does not ship attempt 1.
           *
           * turn() throws away a reply that lacks the word and sends exactly
           * this instruction -- character for character, index.html:2491 -- so
           * comparing a compliant `aware` turn against a non-compliant `blind`
           * one would be comparing the candidate against something the learner
           * never sees. What ships today IS the wedged retry, and that is what
           * the judge below has to grade. */
          let retried = false;
          if (HSKPace.spot(HSK.segment(text, lex), [j.required]).length === 0) {
            retried = true;
            text = HSK.stripScaffold(await call(msgs.concat([
              { role: "assistant", content: text },
              { role: "user", content: "请一定要用「" + j.required +
                "」这个词，放在一句话里，再说一次。其他的规则不变。" }]), 400));
          }
          /* Does the turn read as Chinese, judged by the prompt that ships.
           *
           * The mechanical number only says the word is present; the complaint
           * was never absence, it was 而且 wedged onto a causal relation. So the
           * turn is graded by HSKPrompt.grade({partner:true}) -- `nativeFrame`,
           * the arm measured at 86% strict recall and 87% specificity on real
           * partner turns for $0.0001 a turn, and the one gateFault() asks
           * first. A fault here is the failure this change exists to prevent. */
          let ok = null, better = "";
          try {
            const raw = await call([{ role: "user", content:
              HSKPrompt.grade({ text: text, partner: true }) }], 600);
            const m = raw.match(/\{[\s\S]*\}/);
            const g = m ? JSON.parse(m[0]) : null;
            if (g) { ok = g.ok !== false; better = String(g.better || ""); }
          } catch (e) { /* a dead judge leaves the row ungraded, not wrong */ }
          out.push({ arm: arm, activity: j.activity, level: j.level, draw: j.draw,
                     ok: ok, better: better,
                     required: j.required, prompt: j.prompt, plan: p.text,
                     planRounds: p.rounds, planFailed: p.failed, planTries: p.tries, text: text,
                     /* The mechanical question, asked with the app's own
                      * segmenter so a required word only counts when it is
                      * really that word and not a piece of a longer one. */
                     retried: retried,
                     hit: HSKPace.spot(HSK.segment(text, lex), [j.required]).length > 0,
                     planHit: !!p.text &&
                       HSKPace.spot(HSK.segment(p.text, lex), [j.required]).length > 0 });
          process.stdout.write(arm === "aware" ? "o" : ".");
        } catch (e) { process.stdout.write("x"); }
      }
    }
  }));

  const file = path.join(os.homedir(), "Documents", "plan-require-ab.json");
  fs.writeFileSync(file, JSON.stringify({ model: MODEL, built: new Date().toISOString(),
    note: "Two planner arms over Todd's real learner turns. blind = planPrompt " +
          "without the required word, aware = with it. Built by " +
          "tools/plan-require-ab.js.", items: out }, null, 1));

  console.log("\n");
  const rows = {};
  for (const arm of ["blind", "aware"]) {
    const a = out.filter(r => r.arm === arm);
    if (!a.length) continue;
    rows[arm] = {
      n: a.length,
      hit: a.filter(r => r.hit).length,
      planHit: a.filter(r => r.planHit).length,
      planFailed: a.filter(r => r.planFailed).length,
      rounds: (a.reduce((s, r) => s + r.planRounds, 0) / a.length)
    };
  }
  const pct = (x, n) => (100 * x / n).toFixed(0) + "%";
  for (const arm of Object.keys(rows)) {
    const r = rows[arm];
    console.log(arm.padEnd(6) + " n=" + String(r.n).padStart(4) +
      "   reply has the word " + pct(r.hit, r.n).padStart(4) +
      "   plan has it " + pct(r.planHit, r.n).padStart(4) +
      "   no affordable plan " + pct(r.planFailed, r.n).padStart(4) +
      "   mean re-plans " + r.rounds.toFixed(2));
  }
  /* Paired on the turn, because the arms saw the same learner sentence: the
   * interesting cell is the one the change is meant to empty. */
  const key = r => r.activity + "|" + r.draw + "|" + r.required + "|" + r.prompt;
  const B = {}, A = {};
  out.forEach(r => { (r.arm === "blind" ? B : A)[key(r)] = r; });
  let fixed = 0, broke = 0, both = 0, neither = 0;
  for (const k of Object.keys(B)) {
    if (!A[k]) continue;
    if (B[k].hit && A[k].hit) both++;
    else if (!B[k].hit && A[k].hit) fixed++;
    else if (B[k].hit && !A[k].hit) broke++;
    else neither++;
  }
  console.log("\npaired: both " + both + "   aware only (retry avoided) " + fixed +
              "   blind only (regression) " + broke + "   neither " + neither);
  console.log("\n" + out.length + " rows -> " + file + "   spend $" + spend.toFixed(4));
})().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
