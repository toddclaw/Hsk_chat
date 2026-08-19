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
  var PROMOTE_AT = 3;      // sightings before a word stops being new

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

  var api = {
    DEFAULT_RATE: DEFAULT_RATE, CREDIT_CAP: CREDIT_CAP, SLATE: SLATE, PROMOTE_AT: PROMOTE_AT,
    buildPool: buildPool, countHan: countHan, earn: earn, slate: slate, spot: spot, isNew: isNew
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKPace = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
