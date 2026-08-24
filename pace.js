/* Gradual introduction of next-level vocabulary.
 *
 * Modelled on graded readers: roughly one new word per R characters of text at
 * the level you already know. The pacing is pure arithmetic over the reply
 * text, so it lives here and is tested directly rather than through the UI.
 *
 * Loadable in the browser (window.HSKPace) and in node (module.exports).
 */
(function (root) {
  "use strict";

  var DEFAULT_RATE = 45;   // characters of known text per new word
  var CREDIT_CAP = 3;      // so a long gap cannot dump six new words at once
  var SLATE = 3;           // candidates offered per turn
  /* Sightings before a word stops being new. Not only a label: isNew() also
   * picks the `reuse` list that goes into the system prompt, so this is how
   * long the partner keeps working a word back into the conversation.
   *
   * 6, not 3. Incidental acquisition needs roughly 8-10 encounters to be
   * reliable, and most semantic gain lands between 3 and 7 -- at 3 the app was
   * calling a word learned at the bottom of the range. Measured against a real
   * model before shipping; the numbers are in DEVELOPING.md. */
  var PROMOTE_AT = 6;
  var FORCE_AFTER = 2;     // declined offers before the word is required

  /* Asking politely stops working with some models: they read "use one if it
   * fits" as optional and never take it. After this many turns where an offer
   * went unused, the top word stops being a suggestion and becomes a condition
   * the reply has to satisfy -- enforced by the same repair loop that enforces
   * vocabulary, not by stronger wording. */
  function shouldForce(declines) {
    return (declines || 0) >= FORCE_AFTER;
  }

  /* Words in the next level that the current one does not have, commonest
   * first. Entries without a frequency rank sort last -- unranked means the
   * corpus never saw them, which is exactly the order we want them in. */
  function buildPool(currentEntries, nextEntries) {
    var have = new Set((currentEntries || []).map(function (e) { return e.w; }));
    return (nextEntries || [])
      .filter(function (e) { return !have.has(e.w); })
      .sort(function (a, b) {
        var af = a.f || Infinity, bf = b.f || Infinity;
        return af - bf || a.w.localeCompare(b.w);
      });
  }

  // Han characters only: punctuation and digits are not reading effort.
  function countHan(text) {
    var m = String(text || "").match(/[一-鿿]/g);
    return m ? m.length : 0;
  }

  /* Add a reply's characters to the budget and convert them into credits.
   * Returns a new state; the remainder carries so nothing is lost to rounding. */
  function earn(state, text, rate) {
    var r = Math.max(1, rate || DEFAULT_RATE);
    var chars = (state.chars || 0) + countHan(text);
    var credits = state.credits || 0;
    while (chars >= r && credits < CREDIT_CAP) {
      chars -= r;
      credits++;
    }
    if (credits >= CREDIT_CAP) chars = Math.min(chars, r - 1);   // stop hoarding
    return { chars: chars, credits: credits };
  }

  // The next few words to offer, skipping anything already introduced.
  function slate(pool, introduced, n) {
    var seen = introduced instanceof Set ? introduced : new Set(introduced || []);
    var out = [];
    for (var i = 0; i < pool.length && out.length < (n || SLATE); i++) {
      if (!seen.has(pool[i].w)) out.push(pool[i]);
    }
    return out;
  }

  /* Which offered words the model actually used, and which words already being
   * learned it reused. Both need the segmenter's boundaries rather than a
   * substring test: 自己 must not match inside a longer word. */
  function spot(tokens, words) {
    var want = words instanceof Set ? words : new Set(words || []);
    var hit = [];
    tokens.forEach(function (t) {
      if (t.kind === "word" && want.has(t.text) && hit.indexOf(t.text) === -1) hit.push(t.text);
    });
    return hit;
  }

  function isNew(entry) { return (entry.seen || 0) < PROMOTE_AT; }

  /* ------------------------------------------------------ level readiness
   *
   * "How far am I from the next level" has two answers and they are very far
   * apart. HSK 1 is 520 words and HSK 2 is 1261, so a learner at HSK 1 has met
   * 41% of the HSK 2 *list* -- but because the lists are frequency-ordered and
   * language is Zipfian, those 520 words already account for about 85% of the
   * *text* at HSK 2. Counting words answers a question nobody is asking;
   * counting reading is what tells you whether to move up.
   *
   * A word's share of running text goes as 1/rank, so weight is 1/f rather
   * than 1. The published thresholds this is measured against: 95% coverage
   * for adequate comprehension, 98% for comfortable independent reading.
   */

  /* The calibration knob, and it needs one: `f` is a rank, not a token count,
   * so the curve is an assumption about the corpus rather than a measurement
   * of it. 1 is plain Zipf. Raise it to weight the commonest words more
   * heavily, lower it to flatten the curve toward counting words equally. */
  var ZIPF_EXP = 1;
  var UNRANKED = 999999;   // the wordlists' "corpus never saw this" sentinel

  function weightOf(entry) {
    var f = (entry && entry.f) || UNRANKED;
    return f >= UNRANKED ? 0 : 1 / Math.pow(f, ZIPF_EXP);
  }

  var asSet = function (v) { return v instanceof Set ? v : new Set(v || []); };

  /* Share of a level's running text a given set of words covers, 0..1.
   *
   * One scale, no bonuses. An earlier version doubled the weight of words the
   * learner had written themselves, to make production count for more -- it
   * cannot work, and the failure is instructive. Weight goes as 1/rank, so the
   * commonest words carry enormous shares (的 is rank 1 and weighs 1.0); after
   * doubling, having typed the ten commonest words was enough to push the sum
   * past the total and pin the bar at 100%. It also put the headline on a
   * different scale from toTarget() below, so the panel could report 100% and
   * "57 more words to 95%" at the same time.
   *
   * Production is measured by passing the produced words as `known` instead --
   * same function, same scale, a second honest number rather than a thumb on
   * the first one. */
  function coverage(entries, known) {
    var have = asSet(known);
    var total = 0, got = 0;
    (entries || []).forEach(function (e) {
      var w = weightOf(e);
      total += w;
      if (have.has(e.w)) got += w;
    });
    return total ? got / total : 0;
  }

  /* How many more words, commonest first, to reach `target` coverage. This is
   * the actionable number: at HSK 1 it is 147 of the 741 new HSK 2 words to
   * reach 95%, not 741. Returns 0 when already there. */
  function toTarget(entries, known, target) {
    var have = asSet(known);
    var total = 0, got = 0, missing = [];
    (entries || []).forEach(function (e) {
      var w = weightOf(e);
      total += w;
      if (have.has(e.w)) got += w; else missing.push({ w: w, f: (e.f || UNRANKED) });
    });
    if (!total) return 0;
    missing.sort(function (a, b) { return a.f - b.f; });
    var need = (target || 0.95) * total, n = 0;
    /* Unranked words weigh nothing, so once they are all that is left the sum
     * cannot rise and this would spin to the end of the list handing back a
     * count that buys no coverage at all. Stop when progress stops. */
    while (got < need && n < missing.length && missing[n].w > 0) { got += missing[n].w; n++; }
    return n;
  }

  var api = {
    DEFAULT_RATE: DEFAULT_RATE, CREDIT_CAP: CREDIT_CAP, SLATE: SLATE, PROMOTE_AT: PROMOTE_AT,
    FORCE_AFTER: FORCE_AFTER, shouldForce: shouldForce,
    buildPool: buildPool, countHan: countHan, earn: earn, slate: slate, spot: spot, isNew: isNew,
    ZIPF_EXP: ZIPF_EXP,
    READY_AT: 0.95,      // the published "adequate comprehension" threshold
    coverage: coverage, toTarget: toTarget
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKPace = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
