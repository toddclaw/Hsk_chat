/* The retrieval engine: the learner's own corpus, turned into questions whose
 * answer is known before they are asked.
 *
 * Gap-fill is the first face. Dictation, tone ID and scramble are the same
 * selection with a different presentation -- they call batch() and ignore
 * `candidates`.
 *
 * Pure by construction: no DOM, no network, no clock, no randomness of its
 * own. Segmentation, validation, today's date and the random source all come
 * in as arguments, which is what makes the items reproducible in a test.
 *
 * Loadable in the browser (window.HSKRetrieval) and in node (module.exports).
 */
(function (root) {
  "use strict";

  var ROUND = 10;        // items per round; see RESEARCH.md
  var CANDIDATES = 4;    // one target, three distractors
  var MIN_WORDS = 4;     // a shorter sentence minus a word is a guess, not a context

  /* The same UTC day key the ghost and drill counters bank in -- mistakes.js
   * says why local dates would let a flight move a learner's numbers. Four
   * characters of arithmetic, duplicated rather than imported: no module in
   * this repo requires another. */
  function dayOf(iso) { return String(iso || "").slice(0, 10); }

  /* n counts DISTINCT ok days. Two devices offline on the same day push two
   * rows, and that is the intended shape -- the table has no unique constraint
   * precisely so the second push is absorbed rather than rejected, which only
   * works if counting is by day here. */
  function countsFrom(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (!r || !r.word || !r.day) return;
      var c = out[r.word] || (out[r.word] = { n: 0, days: {} });
      if (c.days[r.day] === undefined) c.days[r.day] = false;
      if (r.ok && !c.days[r.day]) { c.days[r.day] = true; c.n++; }
    });
    Object.keys(out).forEach(function (w) {
      Object.keys(out[w].days).forEach(function (d) { out[w].days[d] = true; });
    });
    return out;
  }

  /* One row per word per day, in both directions. A wrong answer occupies the
   * day without adding to n: you cannot retry the same word for credit until
   * tomorrow, and you are not punished twice for one bad afternoon. RESEARCH.md
   * argues the symmetry under "Retiring a ghost word".
   *
   * No demotion arithmetic is needed anywhere: n is also the selector, so a
   * wrong answer leaves the count low and the word comes back sooner. */
  function credit(rows, entry) {
    var list = rows || [];
    if (!entry || !entry.word || !entry.day) return list;
    var taken = list.some(function (r) {
      return r && r.word === entry.word && r.day === entry.day;
    });
    return taken ? list : list.concat([entry]);
  }

  var api = {
    ROUND: ROUND, CANDIDATES: CANDIDATES, MIN_WORDS: MIN_WORDS,
    dayOf: dayOf, countsFrom: countsFrom, credit: credit
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKRetrieval = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
