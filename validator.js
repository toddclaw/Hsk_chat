/* HSK constrained-chat validator.
 *
 * Greedy maximum matching against the allowlist itself -- deliberately not a
 * general segmenter. A general segmenter splits against its own dictionary and
 * then you check membership, which disagrees at every boundary the two
 * dictionaries define differently. Matching against the allowlist directly
 * makes "unsegmentable" and "disallowed" the same signal.
 *
 * Loadable in the browser (window.HSK) and in node (module.exports) so the
 * fixture tests run without a build step.
 */
(function (root) {
  "use strict";

  // Punctuation the learner never has to look up.
  var CJK_PUNCT = "，。？！、；：“”‘’（）《》〈〉【】…—·～￥、｜";
  var ASCII_OK = " \t\r\n.,?!;:'\"()[]{}<>-–—/\\*#@%&+=_~`$^|0123456789";

  // Number characters combine freely (二十三, 一百五十) but only ever count as
  // allowed when every character in the run is itself in the allowlist, so this
  // widens segmentation, never vocabulary.
  var NUM_CHARS = "〇零一二两三四五六七八九十百千万亿点半";

  // Empirically-grown false positives: particles and suffixes the published
  // lists store only inside compounds, or omit outright.
  var EXTRA_ALLOWED = [
    { w: "啊", p: "a", d: "sentence-final particle (softens tone)" },
    { w: "呀", p: "ya", d: "sentence-final particle (variant of 啊)" },
    { w: "儿", p: "r", d: "-r suffix (哪儿, 一点儿)" },
    { w: "嗯", p: "ǹg", d: "mm; uh-huh" },
    { w: "哦", p: "ó", d: "oh" }
  ];

  function isPunct(ch) {
    return ASCII_OK.indexOf(ch) !== -1 || CJK_PUNCT.indexOf(ch) !== -1;
  }

  function isLatin(ch) {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");
  }

  function isNum(ch) {
    return NUM_CHARS.indexOf(ch) !== -1;
  }

  /* Build the lookup structure a session validates against.
   * entries: [{w, p, d}]   extra: [{w, p, d}] accepted mid-session
   * maxLen is derived from the data, never hardcoded. */
  function buildLexicon(entries, extra) {
    var words = new Map();
    var maxLen = 1;
    function add(e) {
      if (!e || !e.w) return;
      if (!words.has(e.w)) words.set(e.w, e);
      if (e.w.length > maxLen) maxLen = e.w.length;
    }
    (entries || []).forEach(add);
    EXTRA_ALLOWED.forEach(add);
    (extra || []).forEach(add);
    return { words: words, maxLen: maxLen };
  }

  // Longest allowlist entry starting at i, or 0.
  function matchAt(text, i, lex) {
    var max = Math.min(lex.maxLen, text.length - i);
    for (var len = max; len > 0; len--) {
      if (lex.words.has(text.slice(i, i + len))) return len;
    }
    return 0;
  }

  // Longest run of number characters at i whose every character is allowed.
  function numRunAt(text, i, lex) {
    var j = i;
    while (j < text.length && isNum(text[j]) && lex.words.has(text[j])) j++;
    return j - i;
  }

  /* One pass produces both the violation list and the word boundaries the UI
   * needs for tap-to-gloss. Token kinds:
   *   word  - in the allowlist (entry attached)
   *   num   - a merged numeral run (entry synthesized)
   *   punct - whitespace / punctuation / digits
   *   bad   - out of level
   *   latin - roman letters (pinyin or English crept in) */
  function segment(text, lex) {
    var out = [];
    var i = 0;
    function push(kind, start, end, entry) {
      out.push({ kind: kind, start: start, end: end, text: text.slice(start, end), entry: entry || null });
    }
    while (i < text.length) {
      if (isPunct(text[i])) {
        var p = i;
        while (i < text.length && isPunct(text[i])) i++;
        push("punct", p, i);
        continue;
      }
      if (isLatin(text[i])) {
        var l = i;
        while (i < text.length && isLatin(text[i])) i++;
        push("latin", l, i);
        continue;
      }

      var m = matchAt(text, i, lex);
      var n = numRunAt(text, i, lex);
      if (n > m && n > 1) {
        var parts = [];
        for (var k = 0; k < n; k++) parts.push((lex.words.get(text[i + k]) || {}).p || "");
        push("num", i, i + n, { w: text.slice(i, i + n), p: parts.join(" ").trim(), d: "number" });
        i += n;
        continue;
      }
      if (m) {
        push("word", i, i + m, lex.words.get(text.slice(i, i + m)));
        i += m;
        continue;
      }

      // No match: extend over consecutive characters that also fail to match,
      // so 想要 surfaces as one violation rather than two.
      var start = i;
      i++;
      while (i < text.length && !isPunct(text[i]) && !isLatin(text[i]) &&
             !matchAt(text, i, lex) && !(numRunAt(text, i, lex) > 1)) i++;
      push("bad", start, i);
    }
    return out;
  }

  function validate(text, lex) {
    return segment(text, lex).filter(function (t) {
      return t.kind === "bad" || t.kind === "latin";
    });
  }

  /* Candidate replacements: allowlist entries sharing a character with the
   * violation. Crude, but naming a permitted substitute in the repair prompt
   * beats asking the model to find its own. */
  function suggest(word, lex, limit) {
    var hits = [];
    lex.words.forEach(function (entry, w) {
      if (w === word) return;
      for (var i = 0; i < word.length; i++) {
        if (w.indexOf(word[i]) !== -1) { hits.push(entry); return; }
      }
    });
    hits.sort(function (a, b) { return a.w.length - b.w.length; });
    return hits.slice(0, limit || 4);
  }

  var api = {
    CJK_PUNCT: CJK_PUNCT,
    EXTRA_ALLOWED: EXTRA_ALLOWED,
    buildLexicon: buildLexicon,
    segment: segment,
    validate: validate,
    suggest: suggest,
    isPunct: isPunct
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSK = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
