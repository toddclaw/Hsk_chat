/* Can a model name the one word a mistake is about?
 *
 * The Drills chooser offers a CATEGORY and then a whole sentence. Todd's own
 * case is the argument against that: "wrong word" held three unrelated errors
 * -- 行 for 可以, an extra 人 in 同事人, and 认识 for 听说 -- and the drill that
 * follows practises none of the three. It re-elicits one sentence six times and
 * credits any sentence carrying no wrong-word tag, so 行 never reaches the
 * partner, is never checked, and is never counted.
 *
 * The fix needs one fact the grader does not currently produce: WHICH word.
 * prompt.js drillWord() asks for it in its own call, at grade time. This
 * measures whether the answer is worth having.
 *
 * Two counters, per DEVELOPING.md -- one would be trusted too easily:
 *
 *   extract   does it name the right word, against hand-written ground truth?
 *             Scored on `wrong` and `right` separately: a chooser needs `wrong`
 *             (the button says 行), a partner prompt may want `right`.
 *   check     GIVEN a word, does drillCheck() then give an honest used/ok?
 *             This is the counter that decides the design. RESEARCH.md records
 *             用词 at 1/3 and 同音字 at 0/3 when asked as a TAG, which is why
 *             those four tags get no check at all today. If naming the word
 *             does not lift that, the extraction has bought nothing.
 *
 * Three arms on the first counter, because the note may already contain the
 * answer -- Todd's reads "'行' is not the right word here":
 *
 *   model      drillWord() with the grader's note
 *   nonote     drillWord() without it. If accuracy holds, the call is doing
 *              real work; if it collapses, the note was carrying it.
 *   regex      first quoted CJK run in the note, no call at all. The free
 *              baseline the model has to beat to be worth its cost.
 *
 * The wrong sentences below are FIXTURES, not prompt content -- what the model
 * is asked to judge, which is the one place a wrong form belongs (RESEARCH.md,
 * "Sharpening a prompt rule by naming the failure").
 *
 * Name-free, per CLAUDE.md: 我 / 他 / 同事 / 老师 only, so nothing here turns on
 * characters above the level.
 *
 *   node tools/drill-word-ab.js [--runs 3] [--model <id>] [--only extract|check]
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
/* The TEACHING model, because that is what the app calls for both of these
 * prompts -- grade() and drillCheck() go through teachingModel() (index.html
 * 3094, 3114), which defaults to TEACH_MODEL. Measured on the 30B partner model
 * instead, both counters read far worse: extraction refused 0/6 when it should
 * have, and every wrong use of the drilled word scored ok:true, 0/18. Same
 * prompts, same fixtures. The model was the variable. */
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");
const CONCURRENCY = Number(arg("concurrency", 4));
const ONLY = arg("only", "");
const LABEL = "HSK " + LEVEL;

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }

/* Ground truth, hand-written. `wrong` and `right` are ARRAYS: more than one
 * answer is defensible and scoring a defensible answer as a miss would make the
 * numbers say the opposite of what they mean. 同事人 is the clearest case --
 * the faulty span is 同事人, the word to practise is 人, and Todd wants the
 * second. Both count.
 *
 * The first three are Todd's own, from the app. Their `note` strings are
 * reconstructed for the two the app did not show in full; the first is verbatim.
 *
 * `[]` means the honest answer is two empty strings: no single word is at
 * fault. Those fixtures are the free pass this has to refuse -- a chooser
 * offering a confidently wrong word is worse than one offering nothing. */
const EXTRACT = [
  { tag: "wrong-word",
    text: "我听说其他同事说啤酒不好喝，我觉得行。",
    better: "我听说其他同事说啤酒不好喝，我觉得可以。",
    note: "'行' is not the right word here; '可以' or '没关系' should be used to " +
          "express acceptance or agreement.",
    wrong: ["行"], right: ["可以"] },
  { tag: "wrong-word",
    text: "我听说其他同事人说茶不好喝，但是我喜欢喝茶。",
    better: "我听说其他同事说茶不好喝，但是我喜欢喝茶。",
    note: "'同事人' is not a word; '同事' already means colleague.",
    wrong: ["人", "同事人"], right: ["", "同事"] },
  { tag: "wrong-word",
    text: "我认识其他人说喝咖啡不好喝，但是我喜欢喝咖啡。",
    better: "我听说其他人说喝咖啡不好喝，但是我喜欢喝咖啡。",
    note: "'认识' means to know a person; use '听说' for hearing something said.",
    wrong: ["认识"], right: ["听说"] },

  { tag: "wrong-word",
    text: "我每天晚上看音乐。",
    better: "我每天晚上听音乐。",
    note: "Music is listened to, not looked at: use '听'.",
    wrong: ["看"], right: ["听"] },
  { tag: "wrong-word",
    text: "我每天做公共汽车上班。",
    better: "我每天坐公共汽车上班。",
    note: "'坐' is the verb for travelling by a vehicle.",
    wrong: ["做"], right: ["坐"] },

  { tag: "wrong-sense",
    text: "我很开车去公司。",
    better: "我常开车去公司。",
    note: "'很' marks degree, not frequency; '常' is what you want here.",
    wrong: ["很"], right: ["常"] },
  { tag: "wrong-sense",
    text: "他的身体很结实，学习也很结实。",
    better: "他的身体很结实，学习也很努力。",
    note: "'结实' describes a body, not the way somebody studies.",
    wrong: ["结实"], right: ["努力"] },

  { tag: "wrong-character",
    text: "我在学校学汉子。",
    better: "我在学校学汉字。",
    note: "'汉子' and '汉字' sound alike; the written character is '汉字'.",
    wrong: ["汉子"], right: ["汉字"] },
  { tag: "wrong-character",
    text: "我们一起去公园玩儿吧，天气真好，我很高心。",
    better: "我们一起去公园玩儿吧，天气真好，我很高兴。",
    note: "'高心' is not a word; the homophone you want is '高兴'.",
    wrong: ["高心"], right: ["高兴"] },

  /* Must refuse: the correction restructures, so no one word is at fault. */
  { tag: "unnatural",
    text: "给我水。",
    better: "请给我一杯水。",
    note: "The sentence is abrupt and has no measure word; a request needs both.",
    wrong: [""], right: [""] },
  { tag: "unnatural",
    text: "我昨天去了商店，我买了东西，我回家了。",
    better: "我昨天去商店买了东西就回家了。",
    note: "Three short clauses in a row sound choppy; join them.",
    wrong: [""], right: [""] }
];

/* Counter two. Given the word, does drillCheck() judge honestly?
 *
 * Same four kinds grade-target-ab.js uses, minus `other`: partial credit is
 * already measured there and does not change with the subject.
 *
 *   good   word used correctly            -> used true,  ok true
 *   bad    word used wrongly              -> used true,  ok false
 *   dodge  correct sentence, word absent  -> used false
 *
 * Every sentence here is one a learner could plausibly write while drilling the
 * word above it. The dodges are the free pass the design has to refuse. */
const CHECK = [
  { word: "行", kind: "good",  text: "明天下午三点行吗？" },
  { word: "行", kind: "good",  text: "你要是累了，休息一会儿也行。" },
  { word: "行", kind: "bad",   text: "我觉得这个东西很行。" },
  { word: "行", kind: "bad",   text: "他的中文很好，他会行说话。" },
  { word: "行", kind: "dodge", text: "我很喜欢喝茶。" },

  { word: "听说", kind: "good",  text: "我听说他明天要来。" },
  { word: "听说", kind: "bad",   text: "我听说了这本书。" },
  { word: "听说", kind: "bad",   text: "我在公园听说了他。" },
  { word: "听说", kind: "dodge", text: "我今天很忙。" },

  /* Todd's own third mistake, as a drill: 认识 for a person, never for a
   * reported fact. The bad pair is the shape of the error he actually made. */
  { word: "认识", kind: "good",  text: "我认识他的老师。" },
  { word: "认识", kind: "bad",   text: "我认识这本书很有意思。" },
  { word: "认识", kind: "bad",   text: "我认识他明天要来。" },
  { word: "认识", kind: "dodge", text: "我明天去公园。" }
];

const EXPECT = {
  good:  { used: true,  ok: true },
  bad:   { used: true,  ok: false },
  dodge: { used: false, ok: null }   // ok carries no claim when unused
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

function parseJson(raw) {
  const s = String(raw || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
}

/* The free baseline. Grader notes name the word in quotes often enough that
 * this has to be ruled out before paying for a call. Straight quotes, curly
 * ones and 「」, one to four characters -- longer than that is a phrase, and a
 * phrase is not what goes on a chooser button. */
const QUOTED = /['"‘’“”「]([一-鿿]{1,4})['"‘’“”」]/;
function regexWord(note) {
  const m = QUOTED.exec(String(note || ""));
  return m ? m[1] : "";
}

const hit = (got, want) => want.indexOf(String(got == null ? "" : got).trim()) !== -1;

async function extractOne(f, arm) {
  if (arm === "regex") {
    const w = regexWord(f.note);
    return { counter: "extract", arm: arm, f: f, cost: 0,
             got: { wrong: w, right: "" },
             wrongRight: hit(w, f.wrong),
             /* The baseline cannot answer `right` at all -- one quoted word is
              * all a regex gets. Scored as a miss unless "" is acceptable,
              * which is the honest reading of what it can do. */
             rightRight: hit("", f.right) };
  }
  const res = await call([{ role: "user", content: HSKPrompt.drillWord({
    label: LABEL, text: f.text, better: f.better,
    note: arm === "nonote" ? "" : f.note }) }], 120, 0);
  const g = parseJson(res.text);
  if (!g) return { counter: "extract", arm: arm, f: f, cost: res.cost, unreadable: true };
  return { counter: "extract", arm: arm, f: f, cost: res.cost,
           got: { wrong: g.wrong, right: g.right },
           wrongRight: hit(g.wrong, f.wrong),
           rightRight: hit(g.right, f.right) };
}

/* Two wordings, interleaved. The word arm inherits "ignore other grammar, WRONG
 * WORDS, whether the sentence is natural" from the structural check, which reads
 * like the contradiction RESEARCH.md blames for 用词 scoring 1/3 -- told to
 * ignore wrong words while being asked about one. `reworded` drops that clause.
 * Kept because the result is a null: 0/18 against 1/18 on wrong uses, so the
 * clause is not what `ok` fails on and the next hypothesis has to look
 * elsewhere. */
async function checkOne(f, arm) {
  let p = HSKPrompt.drillCheck({ label: LABEL, text: f.text,
                                 drillTag: "wrong-word", drillWord: f.word });
  if (!p) throw new Error("drillCheck returned empty for a word drill");
  if (arm === "reworded") {
    p = p.replace("other grammar, wrong words, ", "the grammar, the OTHER words, ");
  }
  const res = await call([{ role: "user", content: p }], 120, 0);
  const g = parseJson(res.text);
  if (!g) return { counter: "check", arm: arm, f: f, cost: res.cost, unreadable: true };
  const want = EXPECT[f.kind];
  const got = { used: g.used === true, ok: g.ok === true };
  return { counter: "check", arm: arm, f: f, cost: res.cost, got: got,
           usedRight: got.used === want.used,
           okRight: want.ok === null ? true : got.ok === want.ok };
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
const frac = (a, b) => a + "/" + b + (b ? "  " + Math.round(100 * a / b) + "%" : "");

(async function main() {
  const tasks = [];
  /* Arms interleaved, per DEVELOPING.md, "Compare arms only within a run":
   * OpenRouter routes a model id to whichever provider is serving it, so an
   * absolute level read off one run means nothing and a contrast does. */
  for (let i = 0; i < RUNS; i++) {
    if (ONLY !== "check") {
      EXTRACT.forEach(f => {
        tasks.push(() => extractOne(f, "model"));
        tasks.push(() => extractOne(f, "nonote"));
        tasks.push(() => extractOne(f, "regex"));
      });
    }
    if (ONLY !== "extract") CHECK.forEach(f => {
      tasks.push(() => checkOne(f, "shipped"));
      tasks.push(() => checkOne(f, "reworded"));
    });
  }
  console.error("model=" + MODEL + " level=" + LEVEL + " runs=" + RUNS +
                " samples=" + tasks.length);
  const rows = (await pool(tasks, CONCURRENCY)).filter(r => r && !r.error);

  const ex = rows.filter(r => r.counter === "extract" && !r.unreadable);
  if (ex.length) {
    console.log("\ncounter 1 -- which word (" + ex.length + " scored):");
    console.log(pad("arm", 10) + pad("n", 6) + pad("wrong right", 14) + "right right");
    ["model", "nonote", "regex"].forEach(arm => {
      const a = ex.filter(r => r.arm === arm);
      if (!a.length) return;
      console.log(pad(arm, 10) + pad(a.length, 6) +
        pad(frac(a.filter(r => r.wrongRight).length, a.length), 14) +
        frac(a.filter(r => r.rightRight).length, a.length));
    });

    /* Broken out because the two failures are not the same failure. Naming the
     * wrong word sends the learner to drill something they already do right;
     * refusing when there IS a word costs only a chooser entry. */
    const refuse = ex.filter(r => r.f.wrong.indexOf("") !== -1);
    const real = ex.filter(r => r.f.wrong.indexOf("") === -1);
    console.log("\n" + pad("arm", 10) + pad("named a word", 16) + "refused when it should");
    ["model", "nonote", "regex"].forEach(arm => {
      const r1 = real.filter(r => r.arm === arm), r0 = refuse.filter(r => r.arm === arm);
      if (!r1.length && !r0.length) return;
      console.log(pad(arm, 10) +
        pad(frac(r1.filter(r => r.wrongRight).length, r1.length), 16) +
        frac(r0.filter(r => r.wrongRight).length, r0.length));
    });

    const miss = ex.filter(r => !r.wrongRight);
    if (miss.length) {
      console.log("\ndisagreements on `wrong`:");
      miss.slice(0, 14).forEach(r => console.log("  [" + pad(r.arm, 7) + r.f.tag + "] " +
        r.f.text + "  got " + JSON.stringify(r.got) + " want " + JSON.stringify(r.f.wrong)));
    }
  }

  const ck = rows.filter(r => r.counter === "check" && !r.unreadable);
  if (ck.length) {
    console.log("\ncounter 2 -- drillCheck given the word (" + ck.length + " scored):");
    ["shipped", "reworded"].forEach(arm => {
      const A = ck.filter(r => r.arm === arm);
      if (!A.length) return;
      console.log("\n  " + arm + ":");
      console.log("  " + pad("kind", 8) + pad("n", 5) + pad("used right", 14) + "ok right");
      ["good", "bad", "dodge"].forEach(kind => {
        const a = A.filter(r => r.f.kind === kind);
        if (!a.length) return;
        console.log("  " + pad(kind, 8) + pad(a.length, 5) +
          pad(frac(a.filter(r => r.usedRight).length, a.length), 14) +
          frac(a.filter(r => r.okRight).length, a.length));
      });
      console.log("  both fields right: " +
        frac(A.filter(r => r.usedRight && r.okRight).length, A.length));
    });
    console.log("\n(RESEARCH.md, asked as a TAG instead: 用词 1/3, 同音字 0/3. That is " +
      "the number this has to beat for the four error-class tags to be drillable.)");
    const bad = ck.filter(r => !r.usedRight || !r.okRight);
    if (bad.length) {
      console.log("\ndisagreements:");
      bad.slice(0, 14).forEach(r => console.log("  [" + pad(r.arm, 10) + pad(r.f.kind, 6) +
        r.f.word + "] " + r.f.text + "  got " + JSON.stringify(r.got) + " want " +
        JSON.stringify(EXPECT[r.f.kind])));
    }
  }

  const un = rows.filter(r => r.unreadable).length;
  if (un) console.log("\n" + un + " unreadable replies");
  console.log("\ncost $" + rows.reduce((a, r) => a + (r.cost || 0), 0).toFixed(4));
})();
