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

  function shuffle(list, random) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* Three wrong candidates that are obviously wrong make the task free of
   * information. The lists already carry what is needed to do better: a
   * frequency rank. Nearest ranks, then a random three out of that window --
   * pure nearest-rank would hand the same word the same three distractors
   * every time it came round.
   *
   * No part-of-speech data exists anywhere in this app, so rank proximity is
   * the whole of the similarity model. The blank renders fixed-width, so
   * length does not have to match and is not a cue either way. */
  function distractors(target, sentence, pool, random) {
    var seen = {};
    seen[target] = true;
    var eligible = (pool || []).filter(function (e) {
      if (!e || !e.w || seen[e.w]) return false;
      return sentence.indexOf(e.w) === -1;
    });
    var tf = null;
    (pool || []).forEach(function (e) { if (e && e.w === target && e.f) tf = e.f; });
    var ranked = tf === null
      ? shuffle(eligible, random)
      : eligible.slice().sort(function (a, b) {
          return Math.abs((a.f || Infinity) - tf) - Math.abs((b.f || Infinity) - tf);
        });
    var window = ranked.slice(0, tf === null ? CANDIDATES - 1 : (CANDIDATES - 1) * 4);
    return shuffle(window, random).slice(0, CANDIDATES - 1).map(function (e) { return e.w; });
  }

  /* Fewest retrievals first, ties commonest-first.
   *
   * Not weakest-first tiers, and not random. Random mostly blanks 的 and 我;
   * tiers sound better than they behave, because a target only exists if an
   * eligible sentence happens to contain it, so a mistake-ledger tier can be
   * empty while feeling like it should be full. Fewest-retrievals spreads
   * practice across the words the learner is actually working on and makes the
   * stored count load-bearing -- it is the selector, not a score. */
  function pickTarget(tokens, worth, counts, rank, today, used) {
    var best = null;
    tokens.forEach(function (tok, i) {
      if (tok.kind !== "word" || !worth[tok.text] || used[tok.text]) return;
      var c = counts[tok.text] || { n: 0, days: {} };
      if (c.days[today]) return;                  // one retrieval a day, each way
      var r = rank[tok.text];
      if (r === undefined) r = Infinity;
      if (!best || c.n < best.n || (c.n === best.n && r < best.rank)) {
        best = { word: tok.text, n: c.n, rank: r, index: i };
      }
    });
    return best;
  }

  function batch(opts) {
    var o = opts || {}, counts = o.counts || {}, used = {};
    var worth = {}, rank = {};
    (o.learning || []).forEach(function (e) { if (e && e.w) worth[e.w] = true; });
    (o.mistakes || []).forEach(function (w) { if (w) worth[w] = true; });
    (o.pool || []).forEach(function (e) { if (e && e.w && e.f) rank[e.w] = e.f; });

    var size = o.size || ROUND;
    /* Shuffled, so a round is not always the ten oldest sentences in the
     * history -- which after a month would be the same ten every time. */
    var pool = shuffle(sentences(o), o.random);
    var items = [];
    for (var i = 0; i < pool.length && items.length < size; i++) {
      var s = pool[i];
      var tokens = o.segment(s.text);
      var hit = pickTarget(tokens, worth, counts, rank, o.today, used);
      if (!hit) continue;                          // skip the sentence, do not fall back
      /* pickTarget blanks one occurrence, but a repeated target leaves the
       * others sitting in the sentence next to the blank -- the answer,
       * legible a few characters away. Held to the same "skip the sentence"
       * rule distractors() already applies to visible words, and checked
       * before `used` is set so a skipped sentence does not burn the word. */
      if (tokens.filter(function (t) { return t.text === hit.word; }).length > 1) continue;
      /* Four candidates is a hard invariant, not a best-effort: a pool too
       * small or too covered by this sentence to offer three distractors
       * ships a worse question than none, so the item -- and only this
       * item -- is dropped. Built and measured before `used` is set, so a
       * skip here does not burn the word for the rest of the round. */
      var candidates = shuffle(
        [hit.word].concat(distractors(hit.word, s.text, o.pool, o.random)), o.random);
      if (candidates.length < CANDIDATES) continue;
      var before = 0;
      for (var k = 0; k < hit.index; k++) before += tokens[k].text.length;
      used[hit.word] = true;
      items.push({
        text: s.text, at: before, len: hit.word.length, target: hit.word,
        candidates: candidates,
        source: { kind: s.kind, day: s.day, conversationId: s.conversationId }
      });
    }
    return items;
  }

  var api = {
    ROUND: ROUND, CANDIDATES: CANDIDATES, MIN_WORDS: MIN_WORDS,
    dayOf: dayOf, countsFrom: countsFrom, credit: credit, sentences: sentences,
    batch: batch
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKRetrieval = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
