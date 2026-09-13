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

  /* Sentence boundaries. The same character class validator.js:191 already
   * uses to find a question, and a terminator stays with the sentence it ends.
   * Written as a match rather than a split with a lookbehind: this file has to
   * run in whatever browser the learner's phone shipped with. */
  function splitSentences(text) {
    return (String(text || "").match(/[^。！？!?\n]+[。！？!?]?/g) || [])
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  /* Every source is re-validated here, whatever it is.
   *
   * Not belt-and-braces. RESEARCH.md's "The grammar check writes Chinese of
   * its own" records that nothing validates or retries the Chinese a teaching
   * call writes -- only the partner's replies get validate-and-retry -- so a
   * correction can carry out-of-level words. And a learner who moves DOWN a
   * level has a history that is no longer in level at all. The check is
   * offline and free; the alternative is showing a word the app promised not
   * to show. */
  function sentences(opts) {
    var o = opts || {}, out = [];
    var starters = o.starters || [];
    (o.turns || []).forEach(function (t) {
      if (!t || !t.text) return;
      var day = dayOf(t.created_at);
      if (!day || day >= o.today) return;      // nothing from today
      var sources = [];
      if (t.role === "assistant") {
        sources.push({ text: t.text, kind: t.kind === "segment" ? "story" : "partner" });
      } else if (t.role === "user" && t.grade) {
        var own = starters.indexOf(String(t.text || "").trim()) === -1;
        if (t.grade.ok && own) sources.push({ text: t.text, kind: "mine" });
        /* Regardless of this turn's `ok`, and deliberately: the correction is
         * the grader's sentence, not the learner's. parseGrade() has already
         * blanked the corrections that are character-for-character the
         * sentence they correct. */
        if (t.grade.better) sources.push({ text: t.grade.better, kind: "correction" });
      }
      sources.forEach(function (src) {
        splitSentences(src.text).forEach(function (s) {
          var words = o.segment(s).filter(function (tok) { return tok.kind === "word"; });
          if (words.length < MIN_WORDS) return;
          if (!o.validate(s)) return;
          out.push({ text: s, kind: src.kind, day: day,
                     conversationId: t.conversation_id || null });
        });
      });
    });
    return out;
  }

  var api = {
    ROUND: ROUND, CANDIDATES: CANDIDATES, MIN_WORDS: MIN_WORDS,
    dayOf: dayOf, countsFrom: countsFrom, credit: credit, sentences: sentences
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKRetrieval = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
