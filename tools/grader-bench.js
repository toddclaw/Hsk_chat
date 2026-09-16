/* Is the grader any good? A benchmark with human ground truth on both sides.
 *
 * Every verdict this app gives a learner comes from one model call and has never
 * been scored against anything. Measured in passing while testing something
 * else, it returned "Natural." three times out of three for 我的手表被我放在桌
 * 子上了 -- a reflexive 被 that no native speaker writes -- and waved through
 * 我要一个咖啡, 我不能说中文 and 昨天的天气非常地好. That is the grader driving
 * the tick or cross on every message, the mistake ledger, and which drill comes
 * next. It needs a number before it can be improved.
 *
 * GROUND TRUTH
 *
 * MuCGEC (Apache-2.0, Zhang et al., NAACL 2022) -- 7,063 sentences written by
 * learners of Chinese, each corrected by three annotators and reviewed by a
 * senior one. https://github.com/HillZhang1999/MuCGEC
 *
 * The dev set is 100% erroneous: 0 of its 1,137 sentences are left unedited by
 * every annotator. A benchmark of only-wrong sentences is worthless here,
 * because a grader that fails everything scores 100% on it -- and over-harshness
 * is a live failure mode, not a hypothetical. The app's own grader prompt has to
 * warn it "do not manufacture a problem to have something to teach".
 *
 * So the pairing: the SOURCE is a wrong sentence and its REFERENCES are the same
 * sentence written correctly by a human. One corpus, both directions, no model
 * anywhere in the labelling. An item is `wrong` or `right` and the grader is
 * scored on getting both kinds right.
 *
 * FIT, AND ITS LIMITS
 *
 * These are essay sentences from advanced learners: median 36 characters, and
 * only 1.1% of them stay inside HSK 2 vocabulary. Filtering to pairs where BOTH
 * halves validate at HSK 4 or below brings the median to 19 characters and 140
 * pairs, which is a far closer match to a chat message -- but it is still not
 * the same distribution as an HSK 2 learner writing 我昨天去公园了, and it is not
 * the partner's fluent-but-odd Chinese either. What this measures is the
 * grader's judgement of learner Chinese at a register near the app's, which is
 * the closest thing to ground truth available without hand-labelling.
 *
 *   node tools/grader-bench.js --build          # MuCGEC pairs\n *   node tools/grader-bench.js --build-clean    # MuCGEC wrong + written-correct\n *   node tools/grader-bench.js --clean [--arm ...]   # score against that
 *   node tools/grader-bench.js [--n 80] [--model <id>] [--arm shipped|checklist|correctionFirst]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const HSK = require("../validator.js");
const HSKPrompt = require("../prompt.js");

const ROOT = path.join(__dirname, "..");
const BENCH = path.join(__dirname, "grader-bench.json");
const DEV_URL = "https://raw.githubusercontent.com/HillZhang1999/MuCGEC/main/data/MuCGEC/MuCGEC_dev.txt";
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const KEY_FILE = process.env.OPENROUTER_KEY_FILE ||
  path.join(os.homedir(), "Documents", "openrouter_key.txt");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i === -1 ? dflt : args[i + 1];
};
const MODEL = arg("model", "qwen/qwen3-235b-a22b-2507");   // TEACH_MODEL
const CONCURRENCY = Number(arg("concurrency", 6));
const MAX_LEVEL = Number(arg("level", 4));
const ARM = arg("arm", "shipped");

const lex = {};
for (const n of [2, 3, 4, 5, 6, 7]) {
  lex[n] = HSK.buildLexicon(
    JSON.parse(fs.readFileSync(path.join(ROOT, "data", "hsk" + n + ".json"), "utf8")));
}
const cleanAt = (t, n) => HSK.validate(t, lex[n]).filter(v => !v.name).length === 0;

/* The lowest level whose list covers the sentence. Each item is graded at its
 * own level, because the grader prompt names the level and a sentence judged
 * against the wrong one is a different prompt being tested. */
function levelOf(text) {
  for (const n of [2, 3, 4, 5, 6, 7]) if (cleanAt(text, n)) return n;
  return 0;
}

/* ------------------------------------------------- the clean positive class
 *
 * MuCGEC's "correct" half is a MINIMAL human fix: the annotator repaired the
 * error they were annotating and left the rest of the sentence alone, so
 * 我不愿意这么过分地喜欢歌手 counts as correct while still not being anything a
 * native speaker would say. That made specificity unreadable -- on that set
 * claude-sonnet-4.5 flagged half the "correct" sentences, and reading them, most
 * of its complaints were defensible. A judge that is right cannot be told from a
 * judge that is harsh.
 *
 * So: keep MuCGEC's wrong half, which is solid ground truth (three annotators
 * edited it), and replace the right half with text written to BE correct.
 *
 * Two sources, scored separately rather than pooled, because they are not
 * equally clean:
 *
 *   app       STARTERS and LEVEL_STYLE samples -- hand-written for this app,
 *             already test-enforced to validate at their own level, and the
 *             app's actual register: chat turns, not essay prose. Never tuned
 *             against the grader, so there is no circularity. Only 43 at HSK 4
 *             and below, but enough to tell 5% from 40%.
 *   tatoeba   CC-BY 2.0 FR, crowd-sourced, filtered by this repo's own validator
 *             to the level and to 5-30 characters. Scale, with noise: 很少人这么
 *             认为 is in there and wants 很少有人. A judge flagging THOSE is not
 *             wrong, which is exactly why it is reported apart from `app`.
 *
 * If a judge's false-alarm rate collapses on `app` it was the benchmark, not the
 * judge. If it stays high on `app`, the judge is harsh.
 */
/* Tatoeba ships this export bz2-only, and node has no bunzip2 in the standard
 * library. Rather than take the repo's first dependency for a step that runs
 * once, --build-clean reads a local copy and tells you how to fetch it. The
 * built JSON is committed, so nobody else has to. */
const TATOEBA_FILE = process.env.TATOEBA_FILE || "/tmp/cmn.tsv";
const TATOEBA_HOWTO =
  "curl -sSL https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2 " +
  "| bunzip2 > " + TATOEBA_FILE;

async function buildClean() {
  const wrong = [];
  {
    const res = await fetch(DEV_URL);
    if (!res.ok) throw new Error("MuCGEC fetch failed: HTTP " + res.status);
    for (const l of (await res.text()).split("\n").filter(Boolean)) {
      const p = l.split("\t");
      if (!p[1] || !cleanAt(p[1], MAX_LEVEL)) continue;
      // Only sentences every annotator actually edited: no disputed negatives.
      if (!p.slice(2).filter(Boolean).every(r => r !== p[1])) continue;
      wrong.push({ text: p[1], truth: "wrong", cls: "mucgec", level: levelOf(p[1]) });
    }
  }

  const app = [];
  for (const lv of Object.keys(HSKPrompt.STARTERS)) {
    if (Number(lv) > MAX_LEVEL) continue;
    HSKPrompt.STARTERS[lv].forEach(t =>
      app.push({ text: t, truth: "right", cls: "app", level: Number(lv) }));
  }
  for (const lv of Object.keys(HSKPrompt.LEVEL_STYLE)) {
    if (Number(lv) > MAX_LEVEL) continue;
    app.push({ text: HSKPrompt.LEVEL_STYLE[lv].sample, truth: "right",
               cls: "app", level: Number(lv) });
  }

  const tat = [];
  {
    if (!fs.existsSync(TATOEBA_FILE)) {
      throw new Error("no Tatoeba export at " + TATOEBA_FILE + "\n  fetch it with:\n  " +
                      TATOEBA_HOWTO);
    }
    const all = fs.readFileSync(TATOEBA_FILE, "utf8").split("\n").filter(Boolean)
      .map(l => l.split("\t")[2])
      .filter(t => t && t.length >= 5 && t.length <= 30 && cleanAt(t, MAX_LEVEL));
    /* A fixed stride rather than a random sample: reproducible without carrying
     * a seed, and spread across the corpus instead of clustered at its start,
     * where the oldest and shortest sentences sit. */
    const stride = Math.max(1, Math.floor(all.length / 200));
    for (let i = 0; i < all.length && tat.length < 200; i += stride) {
      tat.push({ text: all[i], truth: "right", cls: "tatoeba", level: levelOf(all[i]) });
    }
  }

  fs.writeFileSync(path.join(__dirname, "grader-bench-clean.json"), JSON.stringify({
    negative: { source: "MuCGEC dev set", url: "https://github.com/HillZhang1999/MuCGEC",
      licence: "Apache-2.0",
      citation: "Zhang et al., MuCGEC, NAACL 2022." },
    positive: [
      { source: "this repo's STARTERS and LEVEL_STYLE samples", licence: "same as this repo" },
      { source: "Tatoeba", url: "https://tatoeba.org", licence: "CC-BY 2.0 FR",
        note: "Sentences from Tatoeba (https://tatoeba.org), CC-BY 2.0 FR. " +
              "Filtered by this repo's validator to HSK " + MAX_LEVEL + " and below." }
    ],
    built: new Date().toISOString(), maxLevel: MAX_LEVEL,
    items: wrong.concat(app, tat)
  }, null, 2));
  console.log("built grader-bench-clean.json");
  console.log("  wrong   (MuCGEC, every annotator edited): " + wrong.length);
  console.log("  right   (this app, hand-written):         " + app.length);
  console.log("  right   (Tatoeba, CC-BY, validator-filtered): " + tat.length);
}

async function build() {
  const res = await fetch(DEV_URL);
  if (!res.ok) throw new Error("fetch failed: HTTP " + res.status);
  const rows = (await res.text()).split("\n").filter(Boolean).map(l => {
    const p = l.split("\t");
    return { src: p[1], refs: [...new Set(p.slice(2).filter(Boolean))] };
  });

  const items = [];
  for (const r of rows) {
    if (!r.src || !cleanAt(r.src, MAX_LEVEL)) continue;
    const ref = r.refs.find(x => x !== r.src && cleanAt(x, MAX_LEVEL));
    if (!ref) continue;
    /* Both halves at the SAME level, the higher of the two. Grading the wrong
     * one at HSK 3 and its fix at HSK 4 would confound the verdict with the
     * prompt, and the pair is the whole point. */
    const level = Math.max(levelOf(r.src), levelOf(ref));
    if (!level) continue;
    items.push({ text: r.src, truth: "wrong", level: level, pair: items.length });
    items.push({ text: ref, truth: "right", level: level, pair: items.length - 1 });
  }

  fs.writeFileSync(BENCH, JSON.stringify({
    source: "MuCGEC dev set", url: "https://github.com/HillZhang1999/MuCGEC",
    licence: "Apache-2.0",
    citation: "Zhang et al., MuCGEC: a Multi-Reference Multi-Source Evaluation " +
              "Dataset for Chinese Grammatical Error Correction, NAACL 2022.",
    built: new Date().toISOString(), maxLevel: MAX_LEVEL,
    note: "`wrong` is the learner's sentence; `right` is a human annotator's " +
          "correction of that same sentence. No model was involved in either label.",
    items: items
  }, null, 2));
  console.log("built " + BENCH);
  console.log("  " + items.length + " items (" + items.length / 2 + " pairs), " +
              "both halves inside HSK " + MAX_LEVEL);
  const byLevel = {};
  items.forEach(i => { byLevel[i.level] = (byLevel[i.level] || 0) + 1; });
  console.log("  by level: " + Object.keys(byLevel).sort()
    .map(k => "HSK " + k + "=" + byLevel[k]).join("  "));
}

/* ---------------------------------------------------------------- candidates
 *
 * The shipped prompt asks one open question -- "would you let this sentence
 * stand?" -- and then, separately, for a tag. Decision and categorisation are
 * fused in one call, and the decision half is asked in the general form that
 * measured worst: the same model that returns "Natural." 3/3 for 我的手表被我放
 * 在桌子上了 catches it when the question names what to look for. So the arms
 * below vary the DECISION and leave everything else alone.
 *
 *   shipped          HSKPrompt.grade(), untouched. Must land near 79% again or
 *                    the benchmark is noisier than it looks and nothing here
 *                    means anything.
 *   checklist        The seventeen tags reframed as a pre-decision checklist.
 *                    The app already carries the taxonomy; it just never asks
 *                    the model to walk it before deciding.
 *   correctionFirst  Rewrite first, derive the verdict from whether the rewrite
 *                    changed anything. parseGrade() already treats an identical
 *                    `better` as a pass, so this promotes an existing signal to
 *                    the primary one. It is also how MuCGEC itself is built.
 *
 * The checklist carries NO examples. The shipped prompt's tag examples are
 * measured-necessary for picking the right tag and stay where they are, but
 * DEVELOPING.md's rule holds for the decision half: an example of the bad output
 * is an instruction to produce something adjacent to it.
 */
const CHECKS =
  "Before you answer, walk this list and pass the sentence only if it survives " +
  "every line. Most learner errors are one of these:\n" +
  "- measure words: required where a number modifies a noun, and the right one\n" +
  "- aspect: 了 过 着 在 present where the sentence needs one, absent where it does not\n" +
  "- 的 / 地 / 得 in the right one of their three roles\n" +
  "- word order: where adverbials and attributives sit relative to the verb\n" +
  "- 把: the object moved forward, and a verb carrying a result or direction\n" +
  "- 被: an agent distinct from the subject, and a verb that can passivise at all. " +
  "A speaker who is both the subject's owner and the agent is not a passive, and " +
  "an intransitive verb has no object to promote\n" +
  "- 不 against 没, by tense and by verb\n" +
  "- comparison with 比, which takes no 很\n" +
  "- word choice: a word used in a sense it does not carry, or a character that is " +
  "a homophone of the intended one\n" +
  "- collocation: legal Chinese that no native speaker would actually say\n\n" +
  "A sentence that survives all of them is correct, and saying so is the right " +
  "answer. Do not walk the list looking for something to report.\n\n";

/* The question, changed. Round five's finding was that of 90 catches by the
 * four-specialist design, 89 had the `natural` check firing -- and that check
 * was not obeying its own prompt. Told to look only at idiom and explicitly not
 * at grammar, it fired on sentences whose faults were grammatical, while still
 * scoring 0/43 on hand-written text. It had become a well-calibrated "does this
 * read wrong" detector.
 *
 * Which suggests the gain was the QUESTION rather than the decomposition around
 * it: "would a native speaker say it this way?" beating "is this correct?". This
 * arm tests that at one call instead of five. Everything else -- the JSON
 * contract, the seventeen tags, the two failure-mode warnings -- is untouched,
 * so the only variable is what the model is asked.
 *
 * It also has to replace the `ok` line, because that line IS the question in its
 * operative form: a framing paragraph that contradicts the field definition
 * below it would just be a contradiction, and this session has already measured
 * what models do with one of those.
 */
const NATURAL_FRAMING =
  "The question is not whether you can work out what they meant, and not only " +
  "whether the sentence breaks a rule. It is whether a native speaker would say " +
  "it this way.\n\n" +
  "Those come apart in both directions and both directions are faults. Chinese " +
  "can be perfectly grammatical and still be something nobody would ever say -- " +
  "a calque from English, a stiff or abrupt phrasing, a word that is technically " +
  "right and not the one used here. And a sentence can read smoothly while a " +
  "particle, a measure word, a character or the order of two phrases is wrong; " +
  "fluency is not evidence of correctness, and an error that reads well is still " +
  "an error.\n\n" +
  "Ask it the way a native speaker reads: would I say this? If yes, the sentence " +
  "is fine and saying so is the right answer -- most sentences are fine, and " +
  "hunting for something to report is its own failure.\n\n";

const NATURAL_OK_LINE =
  "ok        — true only if a native speaker would say it this way, as written.\n";

const SHIPPED_OK_LINE =
  "ok        — true only if you would let the sentence stand as written.\n";

const CORRECTION_FIRST =
  "Work in this order.\n\n" +
  "First, write the sentence as a native speaker would write it, changing as " +
  "little as possible and keeping the student's meaning and their vocabulary " +
  "level. If nothing needs changing, reproduce it character for character -- a " +
  "sentence that is already correct must come back untouched, and rewriting it " +
  "to taste is a wrong answer.\n\n" +
  "Then judge: the sentence was correct if and only if your version is identical " +
  "to it.\n\n";

/* Spliced in immediately before the JSON specification, so the framing changes
 * and the output contract does not. Anchored on the literal line rather than an
 * offset: if that line is reworded, this raises instead of silently appending
 * the candidate text somewhere harmless. */
const JSON_ANCHOR = "Reply with only a JSON object, no prose and no code fence:";

function promptFor(arm, text, label) {
  const base = HSKPrompt.grade({ text: text, label: label });
  if (arm === "shipped") return base;
  const extra = arm === "checklist" ? CHECKS
              : arm === "correctionFirst" ? CORRECTION_FIRST
              : arm === "naturalFraming" ? NATURAL_FRAMING : null;
  if (!extra) throw new Error("unknown arm: " + arm);
  if (base.indexOf(JSON_ANCHOR) === -1) {
    throw new Error("grade() no longer contains the JSON anchor -- this harness has drifted");
  }
  let out = base.replace(JSON_ANCHOR, extra + JSON_ANCHOR);
  if (arm === "naturalFraming") {
    if (out.indexOf(SHIPPED_OK_LINE) === -1) {
      throw new Error("grade()'s ok line has been reworded -- this arm would leave " +
                      "the old question standing next to the new framing");
    }
    out = out.replace(SHIPPED_OK_LINE, NATURAL_OK_LINE);
  }
  return out;
}

/* ------------------------------------------------- the decomposed candidate
 *
 * One call currently answers "is this correct, which of four categories is
 * wrong, and which of seventeen tags applies" all at once. There is precedent in
 * this repo for that being the problem rather than the prompt's wording: the
 * drill check was originally an extra field on the grader's answer, the two
 * verdicts FUSED, and the partial-credit case came back wrong 9 times in 15.
 * Asked as its own call: 15/15. See gradeTurn() in index.html.
 *
 * And round four says the misses are structural rather than noisy -- seven
 * sentences missed by five calls out of five, all of them fluent-reading errors
 * of a specific kind: a homophone substitution, 儿化, modifier order, word order
 * inside a phrase. A single general question does not have attention left over
 * for any of them.
 *
 * So: four specialists, each asked ONE question with a narrow remit, then an
 * integrator that aggregates without re-judging. Five cheap calls cost about a
 * fifth of one Sonnet call -- the same budget voting failed to earn out.
 *
 * Two design rules, both aimed at the failure this invites. Four specialists
 * each primed to find something will find something, and specificity is what
 * pays for it -- every qwen arm is currently 43/43 on hand-written text and that
 * must survive. So each specialist is told the other three exist and to stay off
 * their ground, and each is told explicitly that finding nothing is a normal
 * answer. The clean positive class is what checks whether that worked.
 *
 * The specialists run in PARALLEL: four calls, one round trip, then the
 * integrator. Latency is two round trips rather than five.
 */
const SPECIALISTS = {
  word:
    "Look ONLY at whether each word is the right word. In scope: a word that " +
    "does not mean what the writer needed, a word used in a sense it does not " +
    "carry, a missing or redundant word, and -- this one matters most -- a " +
    "character that is a HOMOPHONE of the intended one. The writer types pinyin " +
    "and picks a character from a list, so 少 for 小, 做 for 坐, 在 for 再 are " +
    "the common shape, and they read fluently. Check every character that has a " +
    "common homophone.",
  grammar:
    "Look ONLY at grammatical machinery: measure words, aspect (了 过 着 在), " +
    "的 / 地 / 得, 不 against 没, comparison with 比, 把, 被, and verb " +
    "complements. For 被 specifically: the agent must differ from the subject, " +
    "and the verb must be one that can passivise at all. For 把 the verb needs a " +
    "result or direction.",
  order:
    "Look ONLY at word order. Where adverbials and time words sit relative to " +
    "the subject and verb, where attributives sit relative to what they modify, " +
    "and the order of elements inside a noun phrase. A sentence can use every " +
    "right word and put one in the wrong place, and it will read almost fluently.",
  natural:
    "Look ONLY at whether a native speaker would say it this way. In scope: " +
    "phrasing that breaks no rule but is a calque from English, stiff, abrupt, " +
    "or simply not the collocation anyone uses. NOT in scope: anything " +
    "ungrammatical -- that belongs to another check."
};

function specialistPrompt(key, text, label) {
  return "You are one of four checks on a single Chinese sentence written by a " +
    "learner at " + label + ". The other three cover the areas you are not " +
    "looking at, so report nothing outside your own -- a fault you can see but " +
    "that belongs to another check is not yours to raise.\n\n" +
    SPECIALISTS[key] + "\n\n" +
    "Most sentences have nothing wrong in any one area. Finding nothing is the " +
    "normal answer and the right one when it is true. Do not reach.\n\n" +
    'Reply with only a JSON object: {"found":false,"note":""}\n' +
    "found  — true only if there is a fault in YOUR area.\n" +
    "note   — one short sentence naming it, in English. Empty when found is false.\n\n" +
    "The sentence: " + text;
}

function integratorPrompt(text, label, findings) {
  const tags = HSKPrompt.ERROR_TAGS.join(", ");
  return "Four separate checks have looked at one Chinese sentence written by a " +
    "learner at " + label + ". Their reports:\n\n" + findings + "\n\n" +
    "Your job is to settle it, not to grade the sentence again from scratch. " +
    "Take the reports as evidence: a check that found nothing is evidence the " +
    "sentence is fine in that area. Discard a report only when it is plainly " +
    "wrong about the sentence in front of you, and do not add a fault none of " +
    "them raised.\n\n" +
    "Reply with only a JSON object, no prose and no code fence:\n" +
    '{"ok":true,"meant":"","better":"",' +
    '"cats":{"word":true,"grammar":true,"order":true,"natural":true},"errors":[]}\n\n' +
    "ok      — true only if the sentence should stand as written.\n" +
    "meant   — in English, what they were trying to say.\n" +
    "better  — the sentence as a native speaker would write it, inside " + label +
    " vocabulary where possible. Empty string when ok is true.\n" +
    "cats    — false for each area a check faulted, true otherwise.\n" +
    "errors  — one {\"tag\":\"\",\"note\":\"\"} per distinct fault, [] when ok is " +
    "true. tag is copied EXACTLY from: " + tags + "\n\n" +
    "The sentence: " + text;
}

/* ------------------------------------------------------ the two-call split
 *
 * Round six: the decomposed grader's gain is not the naturalness question (worth
 * four points, p = 0.58) and not breadth either. It is that each specialist
 * answers ONE binary and is asked for nothing else, while the single-call grader
 * answers the same question with `meant`, `better`, four `cats` and a tagged
 * `errors` array riding along, and the verdict degrades under the load. Same
 * thing the drill check found: fused 9-wrong-in-15, split 15/15.
 *
 * If that is the mechanism, four specialists are more than the job needs. One
 * detector answering nothing but "is there a fault", then a categoriser only
 * when it says yes. Two calls on a faulty sentence, one on a clean one, and most
 * sentences are clean.
 *
 * The detector owns the verdict outright -- a detection is not re-litigated
 * downstream. Letting the categoriser overturn it would put the verdict back
 * into a call that is also producing tags, which is the fusion this design
 * exists to avoid. It also makes specificity exactly the detector's specificity,
 * which is the number worth being able to read.
 *
 * For the correctness gate this is ONE call: the gate needs the yes/no and never
 * a tag, because nothing from the partner's Chinese enters the mistake ledger.
 */
function detectPrompt(text, label) {
  return "You are checking one Chinese sentence written by a learner at " + label +
    ". One question only: is there anything wrong with it?\n\n" +
    "Wrong means either of two things and both count. The sentence breaks a rule " +
    "-- a particle, a measure word, aspect, word order, a character that is a " +
    "homophone of the one intended. Or it breaks no rule and is still not what a " +
    "native speaker would say.\n\n" +
    "Fluency is not evidence of correctness. An error that reads smoothly is " +
    "still an error, and those are the ones that get missed.\n\n" +
    "Most sentences are fine. Finding nothing is the normal answer and the right " +
    "one when it is true -- do not hunt for something to report.\n\n" +
    'Reply with only a JSON object: {"found":false,"note":""}\n' +
    "found  — true if there is a fault.\n" +
    "note   — one short sentence in English naming it. Empty when found is false.\n\n" +
    "The sentence: " + text;
}

function categorisePrompt(text, label, note) {
  return "A check has found a fault in the Chinese sentence below, written by a " +
    "learner at " + label + ". What it reported:\n\n  " + note + "\n\n" +
    "Your job is to write that up, not to decide again whether the sentence is " +
    "wrong. It is wrong; say how.\n\n" +
    "Reply with only a JSON object, no prose and no code fence:\n" +
    '{"meant":"","better":"",' +
    '"cats":{"word":true,"grammar":true,"order":true,"natural":true},"errors":[]}\n\n' +
    "meant   — in English, what they were trying to say.\n" +
    "better  — the sentence as a native speaker would write it, inside " + label +
    " vocabulary where possible.\n" +
    "cats    — false for each area the fault is in, true for the others.\n" +
    "errors  — one {\"tag\":\"\",\"note\":\"\"} per distinct fault. tag is copied " +
    "EXACTLY from: " + HSKPrompt.ERROR_TAGS.join(", ") + "\n\n" +
    "The sentence: " + text;
}

async function judgeSplit(text, label, KEY) {
  const raw = await callModel(detectPrompt(text, label), 200, KEY);
  const d = jsonIn(raw);
  if (!d || !d.found) return { ok: true, second: false };
  // Detection owns the verdict; the second call only characterises it.
  await callModel(categorisePrompt(text, label, String(d.note || "a fault")), 600, KEY);
  return { ok: false, second: true };
}

async function judgeDecomposed(text, label, KEY) {
  const keys = Object.keys(SPECIALISTS);
  const reports = await Promise.all(keys.map(async k => {
    try {
      const raw = await callModel(specialistPrompt(k, text, label), 200, KEY);
      const j = jsonIn(raw);
      return { k: k, found: !!(j && j.found), note: (j && String(j.note || "")) || "" };
    } catch (e) { return { k: k, found: false, note: "", error: true }; }
  }));
  /* An all-clear from every specialist needs no integrator call: there is
   * nothing to reconcile and nothing to tag. Saves the fifth call on the
   * majority of sentences, which is most of what this design costs. */
  if (!reports.some(r => r.found)) return { ok: true, reports: reports };
  const findings = reports.map(r =>
    "- " + r.k + ": " + (r.found ? (r.note || "a fault, unspecified") : "nothing found")
  ).join("\n");
  const raw = await callModel(integratorPrompt(text, label, findings), 600, KEY);
  return { ok: verdictOk(raw, text), reports: reports };
}

let spend = 0;
async function callModel(content, maxTokens, KEY) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, messages: [{ role: "user", content: content }],
      max_tokens: maxTokens, temperature: 0.7, usage: { include: true }
    })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body.error && body.error.message) || ("HTTP " + r.status));
  const choice = (body.choices && body.choices[0]) || {};
  const txt = choice.message && choice.message.content;
  spend += (body.usage && body.usage.cost) || 0;
  if (!txt) throw new Error("empty reply");
  return txt.trim();
}

function jsonIn(raw) {
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// index.html's parseGrade(), reduced to the `ok` it recomputes rather than trusts.
function verdictOk(raw, text) {
  const g = jsonIn(raw);
  if (!g) return null;
  const noEdit = String(g.better || "").trim() === String(text).trim();
  if (noEdit) return true;
  const cats = {};
  HSKPrompt.GRADE_CATS.forEach(c => { cats[c.key] = (g.cats || {})[c.key] !== false; });
  const known = new Set(HSKPrompt.ERROR_TAGS);
  const errors = (Array.isArray(g.errors) ? g.errors : []).filter(e => e && known.has(e.tag));
  return g.ok !== false && !errors.length && HSKPrompt.GRADE_CATS.every(c => cats[c.key]);
}

async function pool(jobs, width) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

/* Balanced by CLASS, not overall: the three classes answer different questions
 * and pooling them would let the Tatoeba sample, which is the biggest and the
 * noisiest, set the headline. Equal n each, deterministic slice. */
async function scoreClean() {
  const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
  if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }
  const file = path.join(__dirname, "grader-bench-clean.json");
  if (!fs.existsSync(file)) { console.error("run --build-clean first"); process.exit(1); }
  const bench = JSON.parse(fs.readFileSync(file, "utf8"));
  const per = Number(arg("n", 60));

  const items = [];
  for (const cls of ["mucgec", "app", "tatoeba"]) {
    items.push.apply(items, bench.items.filter(i => i.cls === cls).slice(0, per));
  }
  console.log("model: " + MODEL + "  arm: " + ARM + "  items: " + items.length +
              "  (" + ["mucgec", "app", "tatoeba"]
                .map(c => c + "=" + items.filter(i => i.cls === c).length).join(" ") + ")\n");

  const rows = await pool(items.map(it => async () => {
    try {
      if (ARM === "decomposed") {
        const d = await judgeDecomposed(it.text, "HSK " + it.level, KEY);
        return Object.assign({}, it, { ok: d.ok, reports: d.reports });
      }
      if (ARM === "split") {
        const d = await judgeSplit(it.text, "HSK " + it.level, KEY);
        return Object.assign({}, it, { ok: d.ok, second: d.second });
      }
      const raw = await callModel(promptFor(ARM, it.text, "HSK " + it.level), 600, KEY);
      return Object.assign({}, it, { ok: verdictOk(raw, it.text) });
    } catch (e) { return Object.assign({}, it, { ok: null, error: String(e.message || e) }); }
  }), CONCURRENCY);

  const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "--";
  const line = (label, cls, want) => {
    const r = rows.filter(x => x.cls === cls && x.ok !== null);
    const hit = r.filter(x => x.ok === want).length;
    console.log("  " + label.padEnd(38) + String(r.length).padStart(4) + "   " +
                String(hit).padStart(3) + "  " + pct(hit, r.length));
    return [hit, r.length];
  };
  console.log("                                          n   correct");
  const rec = line("wrong Chinese it faulted (MuCGEC)", "mucgec", false);
  const appR = line("this app's own sentences it passed", "app", true);
  const tatR = line("Tatoeba sentences it passed", "tatoeba", true);

  if (ARM === "decomposed") {
    console.log("\nwhich specialist fired, by class");
    console.log("              " + Object.keys(SPECIALISTS).map(k => k.padStart(9)).join(""));
    for (const cls of ["mucgec", "app", "tatoeba"]) {
      const r = rows.filter(x => x.cls === cls && x.reports);
      if (!r.length) continue;
      console.log("  " + cls.padEnd(12) + Object.keys(SPECIALISTS).map(k => {
        const n = r.filter(x => x.reports.some(p => p.k === k && p.found)).length;
        return (n + "/" + r.length).padStart(9);
      }).join(""));
    }
  }

  if (ARM === "split") {
    const s = rows.filter(x => x.second).length;
    console.log("\nsecond (categorisation) calls made: " + s + "/" + rows.length +
                " -- the rest were one call");
  }

  console.log("\n--- false alarms on this app's own hand-written sentences ---");
  rows.filter(x => x.cls === "app" && x.ok === false).forEach(x => console.log("  " + x.text));

  console.log("\nspend: $" + spend.toFixed(4));
  const out = path.join(__dirname, "grader-bench-clean-results-" + ARM + ".json");
  const prior = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
  fs.writeFileSync(out, JSON.stringify(Object.assign(prior, {
    model: MODEL, arm: ARM, when: new Date().toISOString(),
    recall: rec, appSpecificity: appR, tatoebaSpecificity: tatR, rows: rows
  }), null, 2));
  console.log("written: " + path.relative(ROOT, out));
}

/* Self-consistency: the same prompt, the same model, N times, at the
 * temperature the app actually uses.
 *
 * A Sonnet call costs about 26x a qwen call, so five qwen votes cost a fifth of
 * one Sonnet call. If the shipped grader's 19% miss rate is SAMPLING VARIANCE,
 * voting recovers most of it for almost nothing and the budget ceiling on the
 * gate disappears. If it is a BLIND SPOT -- the same sentences wrong every time
 * -- voting buys nothing and the answer really is the expensive model.
 *
 * The vote histogram is what separates those two, and it is the point of this
 * run: variance shows up as sentences scattered across 1/5, 2/5, 3/5, 4/5, and
 * a blind spot shows up as a pile at 0/5 with almost nothing in between.
 *
 * The threshold sweep comes free once the votes exist, so the whole operating
 * curve is reported rather than one arbitrary majority rule. The app can then
 * pick its threshold per job: the gate wants recall and can spend false alarms
 * on retries, the grader wants the opposite.
 */
async function scoreVote() {
  const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
  if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }
  const file = path.join(__dirname, "grader-bench-clean.json");
  if (!fs.existsSync(file)) { console.error("run --build-clean first"); process.exit(1); }
  const bench = JSON.parse(fs.readFileSync(file, "utf8"));
  const VOTES = Number(arg("vote", 5));
  const per = Number(arg("n", 43));

  const items = [];
  for (const cls of ["mucgec", "app"]) {
    items.push.apply(items, bench.items.filter(i => i.cls === cls).slice(0, per));
  }
  console.log("model: " + MODEL + "  arm: " + ARM + "  votes: " + VOTES +
              "  items: " + items.length + "  calls: " + items.length * VOTES + "\n");

  const jobs = [];
  items.forEach((it, i) => {
    for (let v = 0; v < VOTES; v++) {
      jobs.push(async () => {
        try {
          const raw = await callModel(promptFor(ARM, it.text, "HSK " + it.level), 600, KEY);
          return { i: i, ok: verdictOk(raw, it.text) };
        } catch (e) { return { i: i, ok: null }; }
      });
    }
  });
  const rows = await pool(jobs, CONCURRENCY);

  // Votes to FAULT the sentence, out of the calls that came back parseable.
  const faults = items.map((it, i) => {
    const mine = rows.filter(r => r.i === i && r.ok !== null);
    return { text: it.text, cls: it.cls, n: mine.length,
             faulted: mine.filter(r => r.ok === false).length };
  });

  const wrong = faults.filter(f => f.cls === "mucgec");
  const right = faults.filter(f => f.cls === "app");

  console.log("vote histogram -- how many of " + VOTES + " calls faulted each sentence");
  console.log("           " + Array.from({ length: VOTES + 1 }, (_, k) => String(k).padStart(4)).join(""));
  for (const [label, set] of [["wrong    ", wrong], ["app-clean", right]]) {
    const h = Array.from({ length: VOTES + 1 }, (_, k) => set.filter(f => f.faulted === k).length);
    console.log("  " + label + h.map(x => String(x).padStart(4)).join(""));
  }

  console.log("\nthreshold sweep (fault the sentence when >= k of " + VOTES + " calls do)");
  console.log("   k    recall        false alarms on clean");
  for (let k = 1; k <= VOTES; k++) {
    const rec = wrong.filter(f => f.faulted >= k).length;
    const fa = right.filter(f => f.faulted >= k).length;
    console.log("   " + k + "   " + (rec + "/" + wrong.length).padEnd(8) +
                (100 * rec / wrong.length).toFixed(0).padStart(3) + "%   " +
                (fa + "/" + right.length).padEnd(8) +
                (100 * fa / right.length).toFixed(0).padStart(3) + "%");
  }
  const single = wrong.filter(f => f.faulted >= Math.ceil(f.n / 2)).length;
  console.log("\n  for reference: claude-sonnet-4.5 single call was 95% recall, 98% clean");

  console.log("\n--- never caught by any of " + VOTES + " calls (blind spots) ---");
  wrong.filter(f => f.faulted === 0).forEach(f => console.log("  " + f.text));

  console.log("\nspend: $" + spend.toFixed(4));
  const out = path.join(__dirname, "grader-bench-vote-results.json");
  fs.writeFileSync(out, JSON.stringify({
    model: MODEL, arm: ARM, votes: VOTES, when: new Date().toISOString(), faults: faults
  }, null, 2));
  console.log("written: " + path.relative(ROOT, out));
}

async function score() {
  const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
  if (!KEY) { console.error("No key in " + KEY_FILE); process.exit(1); }
  if (!fs.existsSync(BENCH)) { console.error("run --build first"); process.exit(1); }
  const bench = JSON.parse(fs.readFileSync(BENCH, "utf8"));

  /* Sampled in PAIRS, so the two halves stay balanced. Sampling items
   * independently would let a run come out 60/40 and move the headline number
   * without the grader changing at all. */
  const pairs = [];
  for (let i = 0; i < bench.items.length; i += 2) pairs.push([bench.items[i], bench.items[i + 1]]);
  const want = Math.min(Number(arg("n", 80)) / 2, pairs.length);
  const take = pairs.slice(0, want);
  const items = [].concat.apply([], take);

  console.log("model: " + MODEL + "  arm: " + ARM + "  items: " + items.length +
              " (" + take.length + " pairs)  source: " + bench.source + "\n");

  const rows = await pool(items.map(it => async () => {
    try {
      const raw = await callModel(
        promptFor(ARM, it.text, "HSK " + it.level), 600, KEY);
      return Object.assign({}, it, { ok: verdictOk(raw, it.text) });
    } catch (e) { return Object.assign({}, it, { ok: null, error: String(e.message || e) }); }
  }), CONCURRENCY);

  const wrong = rows.filter(r => r.truth === "wrong" && r.ok !== null);
  const right = rows.filter(r => r.truth === "right" && r.ok !== null);
  const caught = wrong.filter(r => r.ok === false).length;   // correctly faulted
  const passed = right.filter(r => r.ok === true).length;    // correctly left alone
  const pct = (a, b) => b ? (100 * a / b).toFixed(0) + "%" : "--";

  console.log("                                     n     correct");
  console.log("  wrong sentences it faulted      " + String(wrong.length).padStart(5) +
              "   " + caught + "  " + pct(caught, wrong.length) + "   (recall)");
  console.log("  correct sentences it passed     " + String(right.length).padStart(5) +
              "   " + passed + "  " + pct(passed, right.length) + "   (specificity)");
  console.log("  overall                         " + String(wrong.length + right.length).padStart(5) +
              "   " + (caught + passed) + "  " + pct(caught + passed, wrong.length + right.length));
  const errs = rows.filter(r => r.error).length;
  const unparsed = rows.filter(r => r.ok === null && !r.error).length;
  if (errs || unparsed) console.log("  call errors: " + errs + "   unparseable: " + unparsed);

  /* Both failure directions, named. A grader can reach the same overall score by
   * missing real errors or by inventing them, and they need opposite fixes. */
  console.log("\n--- missed (wrong, called correct) ---");
  wrong.filter(r => r.ok === true).slice(0, 12).forEach(r => console.log("  " + r.text));
  console.log("\n--- false alarms (correct, called wrong) ---");
  right.filter(r => r.ok === false).slice(0, 12).forEach(r => console.log("  " + r.text));

  console.log("\nspend: $" + spend.toFixed(4));
  const out = path.join(__dirname, "grader-bench-results-" + ARM + ".json");
  fs.writeFileSync(out, JSON.stringify({
    model: MODEL, arm: ARM, when: new Date().toISOString(), source: bench.source,
    recall: [caught, wrong.length], specificity: [passed, right.length], rows: rows
  }, null, 2));
  console.log("written: " + path.relative(ROOT, out));
}

const MODE = args.indexOf("--vote") !== -1 ? scoreVote
           : args.indexOf("--build-clean") !== -1 ? buildClean
           : args.indexOf("--build") !== -1 ? build
           : args.indexOf("--clean") !== -1 ? scoreClean
           : score;
MODE().catch(e => {
  console.error(String((e && e.message) || e));
  process.exit(1);
});
