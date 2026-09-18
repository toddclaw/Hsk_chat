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
const NO_ERROR = "\u6ca1\u6709\u9519\u8bef";   // MuCGEC's "this annotator found no error"

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
    /* MuCGEC writes the literal string 没有错误 -- "no error" -- where an
     * annotator found nothing to correct. It is a marker, not a sentence.
     * Taken as one it poisons the pair in both directions: the marker becomes a
     * `right` item the grader passes for free, and the source becomes a `wrong`
     * item a human had just declared error-free. Any disagreement among the
     * annotators about whether there is an error at all makes the pair useless
     * as ground truth, so the whole row goes. */
    if (r.refs.some(x => x === NO_ERROR)) continue;
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

/* Reasoning models spend their completion budget thinking before they emit a
 * character of content, and OpenRouter returns the thinking in `reasoning` with
 * `content` empty when the cap bites. At 600 this silently dropped 73 of 204
 * turns on glm-5.3-flash and 43 of 54 on glm-5.3 -- read as API flakiness until
 * the raw body was printed. The cap is not a cost control: you pay for tokens
 * generated, and a non-reasoning model still stops at ~60. Only truncation
 * changes. */
const MAX_TOKENS = 4000;
/* Every call in this file goes through MAX_TOKENS, including the cascade's. The
 * cascade originally hardcoded 300 and 200 -- its prompts are short and its
 * answers are one line, so a small cap looked like tidiness. On a reasoning
 * model it is not a cap on the answer, it is a cap on the thinking that precedes
 * it: glm-5.3-flash scored 14% through the cascade at 300 and returns a correct,
 * well-grounded finding on the same sentence at 4000. This is round thirteen's
 * defect a second time, in the one code path that was not fixed then. */

/* ------------------------------------------------ the frame, round eleven
 *
 * Every arm before this one varied what the grader is ASKED. These two vary who
 * it is told WROTE the sentence, which is the only thing round ten left that
 * could explain 90% recall on learner text and 24% on the partner's.
 *
 * grade() opens "a student of Chinese at HSK 2 wrote this, so it may well be
 * wrong" -- a frame built for the learner's half and measured to be necessary
 * there, because without it the model assumes correctness and passes
 * everything. Handed fluent, on-level, native-shaped text, that same frame may
 * be answering a different question than the one intended: not *is this
 * correct* but *is this the Chinese of someone at HSK 2*, for which the answer
 * is yes and a stray 了 never comes up.
 *
 * Two arms, because "the frame" is two claims:
 *   nativeFrame  the writer is the partner, held to native standard, no level.
 *   noLevel      still a student, but the level anchor removed. Isolates the
 *                anchor from the identity -- if noLevel alone recovers the
 *                recall, the fault was never the student framing.
 *
 * Everything else is held constant: same tags, same categories, same JSON, same
 * naturalness note. Each replacement asserts its target still exists, so a
 * reworded grade() fails loudly instead of quietly testing the shipped prompt. */
function reframe(base, pairs, arm) {
  let out = base;
  for (const [from, to] of pairs) {
    if (out.indexOf(from) === -1) {
      throw new Error("arm " + arm + ": grade() no longer contains " +
                      JSON.stringify(from.slice(0, 48)) + " -- this harness has drifted");
    }
    out = out.split(from).join(to);
  }
  return out;
}

function promptFor(arm, text, label) {
  const base = HSKPrompt.grade({ text: text, label: label });
  if (arm === "shipped") return base;

  /* `softBar` is `nativeFrame` with ONE clause changed, and nothing else.
   *
   * Round twelve's finding was that Sonnet over-fires: 29 of its 35 false alarms
   * were plainly correct sentences. The suspect is nativeFrame's own ok line --
   * "true only if a native speaker would write this exactly as it stands." A weak
   * model ignores a bar that strict. A strong one obeys it, and *exactly as it
   * stands* condemns every sentence the grader would merely have phrased
   * differently.
   *
   * The replacement moves the question from "is this what I would write" to "is
   * there a fault here a learner must not copy", and says outright that plainer
   * is not a fault. That is the whole edit. DEVELOPING.md's worked example is a
   * prompt "fix" that made its failure eight times likelier, so the frame, the
   * tags, the categories and the JSON are held exactly as nativeFrame has them --
   * if this moves the numbers, one clause moved them. */
  if (arm === "softBar") {
    return reframe(promptFor("nativeFrame", text, label), [
      ["ok        — true only if a native speaker would write this exactly as it " +
       "stands.\n",
       "ok        — false only when there is a real fault here: something wrong, " +
       "or something no native speaker would say. A sentence that is plainer, " +
       "shorter or less graceful than the one you would have written is not a " +
       "fault -- pass it. Ask whether a learner copying this sentence would be " +
       "copying a mistake, not whether you would have written it this way.\n"]
    ], arm);
  }

  if (arm === "nativeFrame") {
    return reframe(base, [
      ["You are grading one sentence written by a student of Chinese at " + label + ".",
       "You are checking one sentence of Chinese written by a language-learning " +
       "app's conversation partner. The learner reads it and copies it, so it has " +
       "to be Chinese a native speaker would actually write."],
      ["The student wrote it THEMSELVES, so it may well be wrong. Do not assume it is " +
       "correct.",
       "It was written by a model, so it reads fluently and may still be wrong. " +
       "Fluent is not the same as correct -- do not assume it is correct."],
      ["staying inside " + label + " vocabulary where possible",
       "keeping as close to the original as the fix allows"],
      ["The student wrote: ", "The sentence: "],
      [SHIPPED_OK_LINE,
       "ok        — true only if a native speaker would write this exactly as it " +
       "stands.\n"]
    ], arm);
  }

  if (arm === "noLevel") {
    return reframe(base, [
      ["a student of Chinese at " + label + ".", "a student of Chinese."],
      ["staying inside " + label + " vocabulary where possible",
       "keeping as close to the original as the fix allows"]
    ], arm);
  }

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

/* The frame the four lenses never got.
 *
 * Round eleven measured the frame on a SINGLE-call grader and it was worth
 * fourteen points: telling the judge the partner wrote the text, and naming no
 * level, beat telling it a learner at HSK N did. The decomposed design was built
 * before that and still opens every specialist with "a learner at HSK 2" -- so
 * four lenses are each grading the partner's Chinese as if it were homework, and
 * four chances to mark it down for being above the learner's level.
 *
 * Applied to all five prompts, because the integrator repeats the frame and can
 * reintroduce on its own what the lenses stopped doing. */
const NATIVE_FRAME = "a Chinese conversation partner writing to a learner";

function specialistPrompt(key, text, label, native) {
  if (native) return nativeSpecialistPrompt(key, text);
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

function nativeSpecialistPrompt(key, text) {
  return "You are one of four checks on a single Chinese sentence written by " +
    NATIVE_FRAME + ". The other three cover the areas you are not looking at, so " +
    "report nothing outside your own -- a fault you can see but that belongs to " +
    "another check is not yours to raise.\n\n" +
    SPECIALISTS[key] + "\n\n" +
    "It is meant to be Chinese worth copying, so the standard is what a native " +
    "speaker would actually write. Simple vocabulary is not a fault: the text is " +
    "deliberately plain and plain is not wrong.\n\n" +
    "Most sentences have nothing wrong in any one area. Finding nothing is the " +
    "normal answer and the right one when it is true. Do not reach.\n\n" +
    'Reply with only a JSON object: {"found":false,"note":""}\n' +
    "found  — true only if there is a fault in YOUR area.\n" +
    "note   — one short sentence naming it, in English. Empty when found is false.\n\n" +
    "The sentence: " + text;
}

function nativeIntegratorPrompt(text, findings) {
  const tags = HSKPrompt.ERROR_TAGS.join(", ");
  return "Four separate checks have looked at one Chinese sentence written by " +
    NATIVE_FRAME + ". Their reports:\n\n" + findings + "\n\n" +
    "Your job is to settle it, not to grade the sentence again from scratch. " +
    "Take the reports as evidence: a check that found nothing is evidence the " +
    "sentence is fine in that area. Discard a report only when it is plainly " +
    "wrong about the sentence in front of you, and do not add a fault none of " +
    "them raised. Plain vocabulary is deliberate and is not a fault.\n\n" +
    "Reply with only a JSON object, no prose and no code fence:\n" +
    '{"ok":true,"meant":"","better":"",' +
    '"cats":{"word":true,"grammar":true,"order":true,"natural":true},"errors":[]}\n\n' +
    "ok      — true only if the sentence should stand as written.\n" +
    "meant   — in English, what it says.\n" +
    "better  — the sentence as a native speaker would write it. Empty when ok.\n" +
    "cats    — false for each area a check faulted, true otherwise.\n" +
    "errors  — one {\"tag\":\"\",\"note\":\"\"} per distinct fault, [] when ok is " +
    "true. tag is copied EXACTLY from: " + tags + "\n\n" +
    "The sentence: " + text;
}

async function judgeSplit(text, label, KEY) {
  const raw = await callModel(detectPrompt(text, label), 200, KEY);
  const d = jsonIn(raw);
  if (!d || !d.found) return { ok: true, second: false };
  // Detection owns the verdict; the second call only characterises it.
  await callModel(categorisePrompt(text, label, String(d.note || "a fault")), MAX_TOKENS, KEY);
  return { ok: false, second: true };
}

async function judgeDecomposed(text, label, KEY, native) {
  const keys = Object.keys(SPECIALISTS);
  const reports = await Promise.all(keys.map(async k => {
    try {
      const raw = await callModel(specialistPrompt(k, text, label, native), MAX_TOKENS, KEY);
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
  const raw = await callModel(native ? nativeIntegratorPrompt(text, findings)
                                    : integratorPrompt(text, label, findings), MAX_TOKENS, KEY);
  return { ok: verdictOk(raw, text), reports: reports };
}

let spend = 0;
async function callModel(content, maxTokens, KEY, temperature) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL, messages: [{ role: "user", content: content }],
      max_tokens: maxTokens,
      /* 0.7 is the default every arm before the cascade was measured at, and it
       * stays that way so those numbers keep meaning what they meant. Detection
       * is not a task that wants sampling: the diagnostic pass caught P126, P163
       * and P137 that the scoring run had missed, same prompt, same model, purely
       * because the dice fell differently. */
      temperature: temperature === undefined ? 0.7 : temperature,
      usage: { include: true }
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
      const raw = await callModel(promptFor(ARM, it.text, "HSK " + it.level), MAX_TOKENS, KEY);
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
          const raw = await callModel(promptFor(ARM, it.text, "HSK " + it.level), MAX_TOKENS, KEY);
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
        promptFor(ARM, it.text, "HSK " + it.level), MAX_TOKENS, KEY);
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

/* The two judges, exported so partner-corpus.js scores the SAME code rather
 * than a copy of it. A second implementation of the four-lens design that
 * drifted by one word would answer the transfer question about a grader that
 * does not exist. */
/* The lens cascade. See tools/partner-lens.js for why these lenses and not the
 * app's four; this is only the plumbing.
 *
 *   split -> regex -> 7 narrow calls per sentence -> drop ungrounded findings
 *         -> one adjudication per sentence that still has any
 *
 * A turn is faulty if any sentence is. The cost is paid per sentence and the
 * adjudicator is only woken when a lens has already found something, so a clean
 * turn costs 7 x sentences and nothing more. */
/* `bar` is "strict" (outright faults only) or "loose" (+ stilted). The two
 * share every proposal and every free filter and differ only in which confirm
 * channels a finding is put through, so running both costs one extra call per
 * rewrite finding rather than a second pipeline. */
/* Retry, then give up LOUDLY.
 *
 * Every call inside judgeLens used to swallow its own failure and carry on with
 * one fewer opinion. That is the wrong default for a detector: a turn whose
 * every call failed came back "clean", indistinguishable from a turn that was
 * clean, and the run printed no error marks at all. Raising the worker count
 * from 14 to 20 was enough to do it -- the cascade scored 24% instead of 76% on
 * an unchanged corpus with an unchanged prompt, and 5 of its 21 catches were the
 * regex, which is to say the model half was dead and nothing said so.
 *
 * Now a call that will not come back throws, judgeLens propagates, and the
 * runner's own retry sees it. A missing verdict is honest; a fabricated clean
 * one is not. */
async function lensCall(prompt, KEY, temp) {
  for (let t = 0; t < 3; t++) {
    try { return jsonIn(await callModel(prompt, MAX_TOKENS, KEY, temp)); }
    catch (e) {
      if (t === 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (t + 1)));
    }
  }
}

async function judgeLens(text, label, KEY, trace, bar) {
  const P = require("./partner-lens.js");
  if (P.scriptFault(text)) {                         // free, and no model can beat it
    if (trace) trace.push({ lens: "script", span: "", kept: true });
    return false;
  }
  const keys = Object.keys(P.LENSES);

  /* PROPOSE WIDELY, CONFIRM NARROWLY.
   *
   * The two halves want opposite settings and the first cascade ran them on one.
   * At temperature 0 the lenses went silent -- 米饭很饱, 你比昨天忙吗 and
   * 你今天晚上吃什么了 drew nothing from any of the seven, where at 0.7 they had.
   * Turned back up they propose freely and wrongly, which no longer matters,
   * because a separate confirm at temperature 0 decides each claim on its own.
   *
   * Two draws per lens, OR-ed. Not round four's self-consistency: that took a
   * majority of five votes on one broad call and suppressed the minority that
   * was right. Two draws can only ADD candidates, and nothing here votes. */
  const DRAWS = 2, T_FIND = 0.8, T_JUDGE = 0;

  const verdicts = await Promise.all(P.sentences(text).map(async sentence => {
    const raw = await Promise.all(keys.map(async k => {
      const tries = await Promise.all(Array.from({ length: DRAWS }, () =>
        lensCall(P.lensPrompt(k, sentence), KEY, T_FIND)));
      return tries.find(j => j && j.found && j.span) || tries[0];
    }));

    /* The eighth proposer, and the only one that sees what judging cannot.
     * See rewritePrompt() in partner-lens.js. Needs neither filter below: its
     * span is a substring of the sentence by construction and its fix differs
     * by construction, because both come from a diff. */
    const rewrites = [];
    for (let d = 0; d < DRAWS; d++) {
      const j = await lensCall(P.rewritePrompt(sentence), KEY, d ? T_FIND : 0);
      const f = j && j.rewrite ? P.diff(sentence, String(j.rewrite).trim()) : null;
      if (f) rewrites.push(f);
    }

    /* Two free filters, before any confirm call is bought.
     *
     * GROUNDED: a lens that cannot quote the characters it objects to has
     * invented the fault or is describing a different sentence.
     *
     * CHANGED: a lens that reports a fault and writes the same characters back
     * as the fix has found nothing -- it answered yes because it was asked a
     * yes/no question about its own speciality, which is the failure mode that
     * asking seven narrow questions invites. Six lenses fired on 我会做简单的饭
     * and five survived the old adjudicator; this catches that class for free. */
    const found = raw.map(function (j, i) {
      if (!j || !j.found || !j.span) return null;
      return { lens: keys[i], span: String(j.span), fix: String(j.fix || ""),
               why: String(j.why || "") };
    }).filter(function (f) {
      return f && sentence.indexOf(f.span) !== -1 && f.fix && f.fix !== f.span;
    }).concat(rewrites).filter(function (f, i, all) {
      return all.findIndex(function (x) { return x.span === f.span; }) === i;
    });

    if (trace) {
      raw.forEach(function (j, i) {
        if (j && j.found && j.span) trace.push({ lens: keys[i], span: String(j.span),
          fix: String(j.fix || ""), why: String(j.why || ""),
          grounded: sentence.indexOf(String(j.span)) !== -1,
          changed: !!j.fix && String(j.fix) !== String(j.span), kept: false });
      });
      rewrites.forEach(function (f) {
        trace.push({ lens: "rewrite", span: f.span, fix: f.fix, why: f.why,
                     grounded: true, changed: true, kept: false });
      });
    }
    if (!found.length) return true;

    /* Confirmation, one finding at a time, none of them seeing the others.
     *
     * The first cascade asked about every finding on a sentence in a single
     * call -- the broad question this document exists to argue against -- and it
     * failed in both directions on the two turns anyone inspected: all three
     * true findings vetoed on P187, five false ones confirmed on P118.
     * Factored verification is also what Dhuliawala et al. (arXiv 2309.11495)
     * find necessary to stop a model copying its own earlier mistakes. */
    const ruled = await Promise.all(found.map(async function (f) {
      const j = await lensCall(P.confirmPrompt(sentence, f), KEY, T_JUDGE);
      if (j && j.wrong === true) return true;
      /* Only rewrite findings reach the stiltedness channel. A lens finding is a
       * claim about a rule, and a rule is either broken or it is not; the
       * question "does this sound like a person" is only meaningful against a
       * whole alternative sentence, which is what a rewrite is. */
      if (bar !== "loose" || f.lens !== "rewrite") return false;
      const n = await lensCall(
        P.naturalPrompt(sentence, sentence.replace(f.span, f.fix)), KEY, T_JUDGE);
      return !!(n && n.natural === false);
    }));
    if (trace) ruled.forEach(function (r, i) {
      const t = trace.filter(function (x) { return x.span === found[i].span; }).pop();
      if (t) t.kept = r;
    });
    return !ruled.some(Boolean);
  }));
  return verdicts.every(function (v) { return v; });
}

/* The cascade with six of its seven proposers deleted.
 *
 * The cascade catches the most of anything measured and fires on 62% of real
 * partner turns, which is not a gate. Its cost and most of its firing come from
 * six lenses that ASK A JUDGEMENT QUESTION -- "is the aspect wrong here" -- and
 * the one thing this study has measured twice is that this model answers that
 * question badly and answers "write this natively" well (round eight; the
 * rewritePrompt comment in partner-lens.js).
 *
 * So: keep the rewrite proposer, delete the six judges. A fault has to survive
 * being proposed by a rewrite that did not know it was looking for one, and then
 * being confirmed side by side with its repair -- the two-sentence framing that
 * scored 5 of 7 where the abstract question scored 2.
 *
 * Eight calls a turn against the cascade's forty-five, and the same two filters
 * are free: a rewrite's span is a substring by construction and its fix differs
 * by construction, so nothing ungrounded can get through.
 */
async function judgeRewrite(text, KEY, bar) {
  const P = require("./partner-lens.js");
  if (P.scriptFault(text)) return false;
  const DRAWS = 2;
  const verdicts = await Promise.all(P.sentences(text).map(async sentence => {
    const found = [];
    for (let d = 0; d < DRAWS; d++) {
      const j = await lensCall(P.rewritePrompt(sentence), KEY, d ? 0.8 : 0);
      const f = j && j.rewrite ? P.diff(sentence, String(j.rewrite).trim()) : null;
      if (f && !found.some(x => x.span === f.span)) found.push(f);
    }
    if (!found.length) return true;
    const ruled = await Promise.all(found.map(async f => {
      const j = await lensCall(P.confirmPrompt(sentence, f), KEY, 0);
      if (j && j.wrong === true) return true;
      if (bar !== "loose") return false;
      const n = await lensCall(
        P.naturalPrompt(sentence, sentence.replace(f.span, f.fix)), KEY, 0);
      return !!(n && n.natural === false);
    }));
    return !ruled.some(Boolean);
  }));
  return verdicts.every(v => v);
}

module.exports = {
  judgeRewrite: judgeRewrite,
  judgeLens: judgeLens,
  judgeArm: async (arm, text, label, KEY) =>
    verdictOk(await callModel(promptFor(arm, text, label), MAX_TOKENS, KEY), text),
  judgeDecomposed: async (text, label, KEY, native) =>
    (await judgeDecomposed(text, label, KEY, native)).ok,
  callModel: callModel, KEY_FILE: KEY_FILE, MODEL: MODEL, promptFor: promptFor,
  spend: function () { return spend; }
};

/* Required by partner-corpus.js, so the CLI must not fire on import. */
if (require.main === module) {
  const MODE = args.indexOf("--vote") !== -1 ? scoreVote
             : args.indexOf("--build-clean") !== -1 ? buildClean
             : args.indexOf("--build") !== -1 ? build
             : args.indexOf("--clean") !== -1 ? scoreClean
             : score;
  MODE().catch(e => {
    console.error(String((e && e.message) || e));
    process.exit(1);
  });
}
