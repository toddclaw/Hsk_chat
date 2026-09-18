/* A partner grader built out of many cheap narrow calls instead of one good one.
 *
 * Round twelve said the model is the variable: Sonnet reaches 70% where qwen
 * reaches 38%, at 37x the price. This is the attempt to buy that back with
 * structure. The budget is generous and nobody had used it -- one Sonnet call
 * costs what 37 qwen calls cost, and the most any arm had spent was five.
 *
 * FOUR THINGS THAT ARE DIFFERENT FROM THE FOUR-LENS DESIGN
 *
 * 1. The lenses come from the DATA, not the UI. The shipped four (word, grammar,
 *    order, natural) are the app's grade-sheet categories, which exist to
 *    explain a mistake to a learner, not to find one in model output. Reading
 *    the 18 outright errors in partner-corpus.json gives a different and much
 *    narrower list -- four are aspect particles, four are verb complements,
 *    four are adverbial placement -- and `grammar` and `order` had already been
 *    measured to catch nothing alone.
 *
 * 2. One sentence at a time. Zablocki et al. 2026 (arXiv 2609.10810) find that
 *    batching sentences suppresses overcorrection through "attention dilution",
 *    which is a finding about precision and a warning about recall: a grader
 *    looking at a whole turn is diluted across it. Partner turns run to three
 *    sentences and the errors are single-character. Splitting runs the effect
 *    backwards, and it is the same attention argument round five already found
 *    for questions.
 *
 * 3. Findings must be GROUNDED. Each lens returns the exact characters it
 *    objects to, and a finding whose span is not literally present in the
 *    sentence is dropped without a second call. Free, deterministic, and it is
 *    the cheapest filter available against a small model inventing a fault to
 *    have an answer.
 *
 * 4. A regex does the work no model should be paid for. Latin letters in a
 *    reply are a rule-4 violation, not a judgement call -- 3 of the 21 strict
 *    positives, 14% recall, at zero cost and no false alarms.
 *
 * Cost: lens prompts are ~200 tokens against grade()'s ~1500, so the whole
 * cascade runs at a fraction of one Sonnet call.
 */
"use strict";

var NEED = /\[\[NEED:([^|\]]*)(?:\|[^\]]*)?\]\]/g;

/* The app's own new-word markup. Measured as a false-alarm source on every
 * model tried -- the grader faults the partner for obeying rule 8 -- so it is
 * removed before anything judges the sentence, leaving the word behind. */
function stripNeed(t) { return String(t).replace(NEED, "$1"); }

/* Sentence-final punctuation only. Splitting at a comma would cut clauses whose
 * fault is the join between them, and a comma-spliced fragment reads as wrong
 * to a grader on its own terms. */
function sentences(t) {
  return stripNeed(t).split(/(?<=[。！？；…])\s*/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 1; });
}

/* Latin script in a Chinese reply. Rule 4 forbids it outright; the learner
 * cannot read it; it is not a matter of degree. A regex is the whole judge --
 * run after stripNeed, so the pinyin inside the app's own markup is not a
 * fault. */
function scriptFault(t) {
  return /[A-Za-z]{2,}/.test(stripNeed(t)) ? "latin script in the reply" : null;
}

/* ---------------------------------------------------------------- the lenses
 *
 * Each is ONE question with a stated remit and an explicit instruction to ignore
 * everything else, because round five's specialists drifted into each other's
 * territory and re-created the broad call four times over.
 *
 * The comments are how many of the 18 labelled outright errors fall to each,
 * which is why these seven and not the app's four. */
var LENSES = {
  // P122 P123 P124 P126 -- the block no prompt and no model below Sonnet moved
  aspect:
    "Look ONLY at the aspect particles 了, 过 and 着.\n" +
    "Is there a 了 or 过 that should not be there, or missing where the " +
    "sentence needs one, or both together where only one belongs?\n" +
    "Two cases worth checking: a question about a future or habitual event does " +
    "not take 了, and 过 for past experience does not also take a final " +
    "了.",
  // P086 P163 P187 P067
  complement:
    "Look ONLY at verb complements.\n" +
    "If the sentence says how well or how much an action is done, does it have " +
    "the 得 it needs? If it uses a resultative or directional ending " +
    "(懂 完 好 到 见 上 出来), is that the ending " +
    "this verb and this object actually take?",
  // P004 P099 P082 P064
  order:
    "Look ONLY at where things sit in the sentence.\n" +
    "Time, place, instrument and duration go before the verb in Chinese, not " +
    "after it. Is anything in the wrong position? If the sentence compares two " +
    "things, are both sides of the comparison actually present?",
  // P113 P095 P137
  collocation:
    "Look ONLY at whether these particular words go together.\n" +
    "Can this verb take this object? Can this adjective describe this noun? " +
    "The grammar may be perfect and the pairing still be one no Chinese speaker " +
    "makes.",
  // P032 P067 P187
  funcword:
    "Look ONLY at the small function words: 的 地 得, the " +
    "prepositions (从 跟 对 给 把 被 在 用), and " +
    "measure words.\n" +
    "Is the right one used, and is any of them missing where the sentence " +
    "requires it?",
  // P006
  negation:
    "Look ONLY at negation.\n" +
    "Is 不 or 没 the right one here, and is it in the right place? " +
    "Negating a frequency or a habit needs care -- 不每天 is not how " +
    "it is said.",
  // P185
  homophone:
    "Look ONLY for a character that sounds right and is wrong.\n" +
    "The writer picks characters from a pinyin list, so the confusions are " +
    "homophones and near-homophones: 带/戴, 做/作, " +
    "在/再, 的/得, 象/像.\n" +
    "Is every character the one this word is actually written with?"
};

function lensPrompt(key, sentence) {
  return "Here is one sentence of Chinese, written by a chat partner in a " +
    "language-learning app. A beginner will read it and copy it, so it has to " +
    "be Chinese a native speaker would actually write.\n\n" +
    "Sentence: " + sentence + "\n\n" +
    LENSES[key] + "\n\n" +
    /* The remit has to be closed as well as opened. Round five's specialists
     * were each told the others existed; told only what to look at, a model
     * answers the general question anyway and four lenses become four copies
     * of the broad call. */
    "Other kinds of fault are being checked by someone else. Report nothing " +
    "outside the question above, however wrong it looks.\n\n" +
    /* The span is the grounding. A fault whose characters are not in the
     * sentence is dropped without a model call. */
    "Reply with only JSON, no prose and no code fence.\n" +
    "Nothing wrong in this respect:  {\"found\":false}\n" +
    "Something wrong:  {\"found\":true,\"span\":\"\",\"fix\":\"\",\"why\":\"\"}\n" +
    "span - the exact characters at fault, copied from the sentence. Short.\n" +
    "fix  - those characters written correctly. It must DIFFER from span; if you " +
    "cannot write a different and better version, there is nothing wrong and the " +
    "answer is found:false.\n" +
    /* The commonest fault in Chinese learner and model text is a redundant
     * character, and the natural fix for one is to delete it -- which writes an
     * empty `fix` and trips the degenerate-output filter that exists to catch a
     * lens answering yes to its own question. The aspect lens found the 了 in
     * 熊猫吃过竹子了 exactly right and was thrown away for it. Widening the span
     * keeps deletions inside the same contract. */
    "         If the fix is to DELETE something, quote a span with a character " +
    "or two either side, so that the fix still has something in it. Never leave " +
    "fix empty.\n" +
    "why  - at most ten words of English.";
}

/* ------------------------------------------------- the rewrite proposer
 *
 * The single most useful thing measured in building this. Asked to JUDGE
 * 你比昨天忙吗？ every one of the seven lenses and a blunt "is anything wrong
 * here" all answer no. Asked to REWRITE it as a native speaker would, the same
 * model at the same temperature returns 你今天比昨天忙吗？ -- supplying the
 * missing term, correctly, without ever conceding the original was wrong.
 *
 * So the error is visible to the model and the judgement is not. Rewriting is a
 * generation task and generation is what it is good at; "is this wrong?" invites
 * the agreeable answer, and a small model gives it. The diff against the
 * original is then a fault proposal that cost one call and no judgement at all.
 *
 * This is NOT round two's `correctionFirst`, which measured no better than
 * shipped: that put "rewrite first" inside the full 1500-token grade() prompt on
 * a whole multi-sentence turn of learner text. This is one short sentence, alone,
 * with nothing else asked of it.
 *
 * It over-fires by design -- it will also return 今天晚上 -> 今晚, which is a
 * preference and not a fault -- and that is what the confirm step is for. */
function rewritePrompt(sentence) {
  return "Chinese sentence: " + sentence + "\n\n" +
    "Rewrite it the way a native speaker would actually say it, keeping the " +
    "same meaning and the same simple vocabulary. If it is already exactly " +
    "right, repeat it back unchanged.\n\n" +
    "Reply with only JSON: {\"rewrite\":\"\"}";
}

/* The differing middle of two strings, as {span, fix}.
 *
 * Deterministic, no model, and it gives the span the confirm step needs for
 * free. Returns null when the rewrite is identical or when it differs
 * everywhere, which is a rewrite that has changed the sentence rather than
 * corrected it and is not evidence of anything. */
function diff(a, b) {
  if (!b || a === b) return null;
  var p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  var s = 0;
  while (s < a.length - p && s < b.length - p &&
         a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  /* A pure insertion has an empty span and a pure deletion an empty fix, and
   * both read as nonsense in the confirm prompt ("change \"\" to 今天"). Two
   * characters of context on each side makes every finding a substring of the
   * original that can be shown, grounded and argued about. */
  var pad = 0;
  while (pad < 2 && (p - pad > 0) && (a.length - s + pad < a.length)) pad++;
  var lo = Math.max(0, p - pad), hi = Math.min(a.length, a.length - s + pad);
  var span = a.slice(lo, hi), fix = b.slice(lo, b.length - (a.length - hi));
  if (!span || span === fix) return null;
  if (span.length > a.length * 0.6) return null;      // a rewrite, not a repair
  return { lens: "rewrite", span: span, fix: fix,
           why: "a native speaker writes it this way" };
}

/* Confirmation, one finding at a time, at temperature zero.
 *
 * Measured against three other phrasings on fourteen findings the cascade
 * actually produced, hand-labelled by whether the ORIGINAL was wrong:
 *
 *   asked to judge the span in the abstract     2/7 real, 0/7 false
 *   asked whether a teacher would mark it       3/7 real, 0/7 false
 *   asked to count mistakes in the span         2/7 real, 0/7 false
 *   SHOWN BOTH SENTENCES and asked which        5/7 real, 2/7 false
 *
 * The same lesson as the rewrite proposer, from the other end: this model is
 * much better at comparing two concrete sentences than at judging one in the
 * abstract. Every abstract phrasing agrees that 我不每天散步 and 你比昨天忙吗 are
 * fine; put the corrected version beside them and it picks the correction.
 *
 * The earlier version also showed the proposer's suggested FIX and asked if it
 * was right, which threw out `collocation` diagnosing 米饭很饱 correctly because
 * its repair, 很饱人, was bad. Diagnosis and repair have to be judged apart --
 * here B is only context for reading A, and the question is asked about A. */
function confirmPrompt(sentence, f) {
  var b = sentence.replace(f.span, f.fix);
  return "Here are two Chinese sentences.\n" +
    "A: " + sentence + "\n" +
    "B: " + b + "\n\n" +
    "Is A something a native Chinese speaker would write, or does A contain a " +
    "mistake that B fixes?\n\n" +
    "B being smoother or more elegant is not enough -- A has to be actually " +
    "wrong. A beginner is going to copy A, so wrong means they would be copying " +
    "a mistake.\n\n" +
    "Reply with only JSON: {\"wrong\":true} if A contains a mistake, " +
    "{\"wrong\":false} if A is fine Chinese even though B differs.";
}

/* ------------------------------------------------- the stiltedness channel
 *
 * The cascade's proposers all hunt FAULTS, and most of what makes partner
 * Chinese not worth imitating is not a fault -- 唱歌节目, 快乐的歌, 动物电视,
 * 真兔子 are all well-formed and none of them is what a person says. That is the
 * whole of the gap between the cascade's 53% on the worth-imitating bar and
 * Sonnet's 73%.
 *
 * It needs no new proposer. The rewrite already surfaces these -- 快乐的歌 ->
 * 好听的歌 comes back on the first draw -- and the strict confirm then correctly
 * throws them out, because they are not mistakes. So the same finding is asked a
 * second and different question.
 *
 * Measured on sixteen sentences, eight labelled unnatural and eight clean:
 *
 *   "would a native ever say A?"              0/8 stilted, 0/8 false
 *   "which would come out of their mouth?"    5/8 stilted, 2/8 false
 *   "does A sound foreign or textbook?"       4/8 stilted, 0/8 false
 *
 * The first is the abstract question again, and again the answer is always yes --
 * the third time in this cascade that asking a weak model to judge one thing on
 * its own returned nothing at all. The third phrasing is taken: half the recall
 * of the middle one and none of its false alarms, which suits a channel whose
 * whole job is to widen the net. */
function naturalPrompt(sentence, rewrite) {
  return "Two Chinese sentences.\n" +
    "A: " + sentence + "\n" +
    "B: " + rewrite + "\n\n" +
    "One of these may sound like a foreigner or a textbook rather than a Chinese " +
    "person talking.\n" +
    "Is A something a Chinese person actually says?\n\n" +
    "Reply with only JSON: {\"natural\":true} if A sounds like real Chinese, " +
    "{\"natural\":false} if A sounds off, foreign or made-up.";
}

var api = { LENSES: LENSES, lensPrompt: lensPrompt, naturalPrompt: naturalPrompt,
            confirmPrompt: confirmPrompt, rewritePrompt: rewritePrompt, diff: diff,
            sentences: sentences, scriptFault: scriptFault, stripNeed: stripNeed };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.HSKPartnerLens = api;
