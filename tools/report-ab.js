/* Does the progress report invent progress?
 *
 * The report is the first prompt in the app whose output is a claim ABOUT the
 * learner rather than Chinese for them to read. The validator cannot check it:
 * it is English, and English is never out of level. So the thing that can go
 * wrong is not vocabulary, it is truth -- a warm paragraph congratulating
 * somebody on story time they have never opened.
 *
 * Two counters, per DEVELOPING.md -- one would be trusted too easily:
 *
 *   fidelity     did it state a figure the brief does not contain, or describe
 *                an untouched activity as something they did? Numbers are the
 *                checkable part of a hallucination.
 *   specificity  did it say anything only THIS learner could be told? The
 *                counter that keeps the first one honest: a prompt tuned hard
 *                against invention retreats into warmth that would fit anyone,
 *                and scores a perfect fidelity doing it.
 *
 * Four arms, chosen to test this design's own assumptions rather than to
 * survey wordings. Each shipped behaviour is paired with the variant that
 * removes the thing the spec assumes is helping:
 *
 *   zeroes    the shipped brief, carrying an explicit 0 for quiet activities
 *   omit      the same brief with the zero keys deleted. If `zeroes` does not
 *             beat this, the spec's "a model handed a gap fills it" is wrong
 *             and the brief can be smaller.
 *   guarded   the shipped prompt, with the do-not-invent sentence
 *   plain     the same prompt with that sentence cut. Does the guard move
 *             fidelity, or does it only make us feel safer?
 *
 * Fixtures are synthetic briefs, not real history, and NAME-FREE per CLAUDE.md.
 * `empty` and `bad` matter most: "you barely showed up this week" is the
 * hardest thing for an encouragement prompt to say honestly, and so the
 * likeliest place to find invented praise.
 *
 *   node tools/report-ab.js [--runs 3] [--model <id>]
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
/* The TEACHING model: writeReport() goes through teachingModel(), the same
 * route grade() and drillCheck() take. */
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");
const CONCURRENCY = Number(arg("concurrency", 4));

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }

const mk = (o) => Object.assign({
  level: 2, goalLevel: 4, coverage: { read: 0.9, use: 0.6 }, minutes: 0,
  messages: { graded: 0, clean: 0 }, words: { met: 0 },
  ghost: { credits: 0, retired: 0, working: 0 }, tags: [],
  activities: { chat: 0, focused: 0, drill: 0, story: 0, twenty: 0 }
}, o);

const FIXTURES = {
  good: mk({ minutes: 210, messages: { graded: 40, clean: 34 }, words: { met: 55 },
    ghost: { credits: 11, retired: 2, working: 3 },
    tags: [{ tag: "aspect-le", n: 2, eg: "我吃饭吗", better: "我吃饭了吗" }],
    activities: { chat: 6, focused: 4, drill: 1, story: 2, twenty: 0 } }),
  bad: mk({ minutes: 40, messages: { graded: 12, clean: 3 }, words: { met: 55 },
    ghost: { credits: 1, retired: 0, working: 1 },
    tags: [{ tag: "aspect-le", n: 6, eg: "我吃饭吗", better: "我吃饭了吗" },
           { tag: "measure-word", n: 4, eg: "一个书", better: "一本书" },
           { tag: "order", n: 3, eg: "我饭吃", better: "我吃饭" }],
    activities: { chat: 3, focused: 0, drill: 0, story: 0, twenty: 0 } }),
  empty: mk({}),
  lopsided: mk({ minutes: 300, messages: { graded: 60, clean: 50 }, words: { met: 55 },
    activities: { chat: 20, focused: 0, drill: 0, story: 0, twenty: 0 } })
};

/* Did it state a figure the brief does not contain? Numbers are the checkable
 * part of a hallucination: everything the report may legitimately say a number
 * about is in the brief, so a number that is not there was invented. Years and
 * small ordinals in prose ("the first thing") are excluded -- they are not
 * claims about the learner. */
function fidelity(out, brief) {
  const allowed = new Set(JSON.stringify(brief).match(/\d+/g) || []);
  const stated = (out.match(/\b\d+\b/g) || []).filter(n => Number(n) > 2);
  const invented = stated.filter(n => !allowed.has(n));
  // Describing an untouched activity as something they did is the other half.
  const claimed = Object.keys(brief.activities).filter(a =>
    brief.activities[a] === 0 &&
    new RegExp("(you|your)[^.]{0,40}" + a, "i").test(out));
  return { ok: invented.length === 0 && claimed.length === 0, invented, claimed };
}

/* Did it describe as ABSENT something the figures show they did?
 *
 * This counter was not in the plan. It was added after the first run, in which
 * fidelity scored 48/48 while three of the four `lopsided` reports told a
 * learner with 60 graded and 50 clean messages that they had not written
 * sentences yet. Invented NUMBERS turn out not to be the failure mode; invented
 * DEFICITS are, and a counter that cannot see the failure that actually occurs
 * is not evidence, however green it reads.
 *
 * The cause is structural rather than random: the prompt demands a paragraph on
 * what to work on next, and `lopsided` is a learner with no outstanding mistake
 * categories -- so the model has nothing true to put there and manufactures a
 * gap. That is worse than a wrong number. A learner told they have not done the
 * thing they have been doing all fortnight stops trusting the report. */
function contradiction(out, brief) {
  const said = [];
  if ((brief.messages || {}).clean > 0 &&
      /\b(haven.?t|have not|not yet|never)\b[^.]{0,40}\b(written|writing|made|formed|produced|created)\b[^.]{0,30}sentence|\bhaven.?t\b[^.]{0,20}\bstarted\b/i.test(out)) {
    said.push("denies sentences");
  }
  if ((brief.minutes || 0) > 0 && /haven.?t[^.]{0,30}practi[cs]/i.test(out)) {
    said.push("denies practice");
  }
  return { ok: said.length === 0, said };
}

/* Did it say anything only THIS learner could be told? A prompt tuned hard
 * against hallucination retreats into warmth that would fit anyone. */
function specificity(out, brief) {
  const hooks = brief.tags.map(t => t.tag)
    .concat(brief.tags.map(t => t.better))
    .concat(Object.keys(brief.activities).filter(a => brief.activities[a] > 0));
  return { ok: hooks.some(h => h && out.toLowerCase().indexOf(String(h).toLowerCase()) !== -1),
           hooks };
}

/* The sentence `plain` removes. Kept as one constant so a reworded prompt
 * fails loudly here rather than silently turning `plain` into `guarded`. */
const GUARD = /Every number you state must come from[\s\S]*?never describe it as progress\. /;

const ARMS = {
  // Does carrying explicit zeroes stop the model inventing activity? The spec
  // asserts it does. This is the arm that finds out.
  zeroes: (f) => HSKPrompt.report({ brief: f, sinceBrief: f, samples: [],
                                    fellBack: false, label: "HSK 2" }),
  omit: (f) => {
    const thin = JSON.parse(JSON.stringify(f));
    Object.keys(thin.activities).forEach(k => {
      if (thin.activities[k] === 0) delete thin.activities[k];
    });
    return HSKPrompt.report({ brief: thin, sinceBrief: thin, samples: [],
                              fellBack: false, label: "HSK 2" });
  },
  // Does the guard sentence move fidelity, or does it only make us feel safer?
  guarded: (f) => HSKPrompt.report({ brief: f, sinceBrief: f, samples: [],
                                     fellBack: false, label: "HSK 2" }),
  plain: (f) => HSKPrompt.report({ brief: f, sinceBrief: f, samples: [],
                                   fellBack: false, label: "HSK 2" })
    .replace(GUARD, ""),
  /* The candidate fix for what the contradiction counter found. The guard
   * forbids inventing progress; nothing forbade inventing its absence, and the
   * "what to focus on next" paragraph is where a model with nothing true to say
   * goes looking. This tells it that deepening is a legitimate answer. */
  nodeficit: (f) => HSKPrompt.report({ brief: f, sinceBrief: f, samples: [],
                                       fellBack: false, label: "HSK 2" })
    .replace("Warm and direct,",
      "Never describe as missing or not yet done anything the figures above " +
      "show they did. If they have no outstanding mistake categories, say so " +
      "and make paragraph 2 about going deeper rather than about a weakness. " +
      "Warm and direct,"),
  /* The label this measurement changed, kept as the arm to beat. "messages
   * graded" never said whose sentences those were, and a model with no
   * outstanding mistakes to write paragraph 2 about reached for the most
   * plausible remaining gap -- that the learner had not produced anything yet.
   * Naming the author took invented deficits from 33/48 to 43/48 and shipped,
   * so this arm now runs the OLD wording: if a future edit erodes the gain,
   * `oldlabel` catching up is how it shows. */
  oldlabel: (f) => HSKPrompt.report({ brief: f, sinceBrief: f, samples: [],
                                      fellBack: false, label: "HSK 2" })
    .replace(/- sentences they wrote themselves and had checked: /g,
             "- messages graded: ")
};

if (!GUARD.test(ARMS.zeroes(FIXTURES.good))) {
  console.error("The guard sentence no longer matches: `plain` would be a " +
                "duplicate of `guarded` and the arm would measure nothing.");
  process.exit(1);
}

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

async function one(name, arm) {
  const f = FIXTURES[name];
  const res = await call([{ role: "user", content: ARMS[arm](f) }], 700, 0.7);
  /* Scored against the SHIPPED brief in every arm, `omit` included: the
   * question is whether the report told the truth about the learner, and
   * deleting a key from the prompt does not make the learner's zero untrue. */
  const fid = fidelity(res.text, f);
  const spec = specificity(res.text, f);
  const con = contradiction(res.text, f);
  return { fixture: name, arm: arm, cost: res.cost, text: res.text,
           fid: fid, spec: spec, con: con };
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
  const names = Object.keys(FIXTURES), arms = Object.keys(ARMS);
  const tasks = [];
  /* Arms interleaved, per DEVELOPING.md, "Compare arms only within a run":
   * OpenRouter routes a model id to whichever provider is serving it, so an
   * absolute level read off one run means nothing and a contrast does. */
  for (let i = 0; i < RUNS; i++) {
    names.forEach(n => arms.forEach(a => tasks.push(() => one(n, a))));
  }
  console.error("model=" + MODEL + " runs=" + RUNS + " samples=" + tasks.length);
  const rows = (await pool(tasks, CONCURRENCY)).filter(r => r && !r.error);

  console.log("\nper arm (" + rows.length + " scored):");
  console.log(pad("arm", 11) + pad("n", 5) + pad("fidelity", 14) +
              pad("no invented gap", 18) + "specificity");
  arms.forEach(a => {
    const r = rows.filter(x => x.arm === a);
    if (!r.length) return;
    console.log(pad(a, 11) + pad(r.length, 5) +
      pad(frac(r.filter(x => x.fid.ok).length, r.length), 14) +
      pad(frac(r.filter(x => x.con.ok).length, r.length), 18) +
      frac(r.filter(x => x.spec.ok).length, r.length));
  });

  console.log("\ninvented gaps per fixture:");
  console.log(pad("fixture", 10) + arms.map(a => pad(a, 12)).join(""));
  names.forEach(n => {
    console.log(pad(n, 10) + arms.map(a => {
      const r = rows.filter(x => x.arm === a && x.fixture === n);
      return pad(r.length ? frac(r.filter(x => x.con.ok).length, r.length) : "-", 12);
    }).join(""));
  });

  console.log("\nfidelity per fixture:");
  console.log(pad("fixture", 10) + arms.map(a => pad(a, 12)).join(""));
  names.forEach(n => {
    console.log(pad(n, 10) + arms.map(a => {
      const r = rows.filter(x => x.arm === a && x.fixture === n);
      return pad(r.length ? frac(r.filter(x => x.fid.ok).length, r.length) : "-", 12);
    }).join(""));
  });

  console.log("\nspecificity per fixture:");
  console.log(pad("fixture", 10) + arms.map(a => pad(a, 12)).join(""));
  names.forEach(n => {
    console.log(pad(n, 10) + arms.map(a => {
      const r = rows.filter(x => x.arm === a && x.fixture === n);
      return pad(r.length ? frac(r.filter(x => x.spec.ok).length, r.length) : "-", 12);
    }).join(""));
  });

  const gaps = rows.filter(r => !r.con.ok);
  if (gaps.length) {
    console.log("\nevery invented gap, so the counter can be argued with:");
    gaps.forEach(r => console.log("  " + pad(r.arm, 11) + pad(r.fixture, 10) +
      r.con.said.join(", ")));
  }

  const misses = rows.filter(r => !r.fid.ok);
  if (misses.length) {
    console.log("\nevery fidelity miss, so the counter can be argued with:");
    misses.forEach(r => {
      console.log("  " + pad(r.arm, 10) + pad(r.fixture, 10) +
        (r.fid.invented.length ? "invented " + r.fid.invented.join(",") + " " : "") +
        (r.fid.claimed.length ? "claimed " + r.fid.claimed.join(",") : ""));
    });
  }

  const cost = rows.reduce((a, r) => a + (r.cost || 0), 0);
  console.log("\n" + rows.length + " calls, $" + cost.toFixed(4));

  if (args.indexOf("--show") !== -1) {
    rows.forEach(r => console.log("\n--- " + r.arm + " / " + r.fixture + " ---\n" + r.text));
  }
})();
