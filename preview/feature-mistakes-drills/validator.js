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
  var CJK_PUNCT = "，。？！、；：“”‘’「」（）《》〈〉【】…—·～￥、｜";
  /* Deliberately narrow. Everything here is invisible to the learner as
   * punctuation; brackets, markdown markers and the like are not punctuation at
   * all but model scaffolding, and letting them count as "always allowed" is how
   * subtitle timestamps such as [0.0:] reached the screen unchallenged. */
  var ASCII_OK = " \t\r\n.,?!;:'\"()-–—0123456789";

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

  /* Formatting the model wrapped around its answer rather than said. Bracketed
   * groups with no Chinese in them (timestamps, [music], [Speaker 1]) and
   * markdown emphasis are removed before validation: they are not vocabulary
   * mistakes, so making the repair loop pay for them would be wasteful, and
   * showing them to a learner is worse. Anything left over is still a violation.
   */
  function stripScaffold(text) {
    return String(text || "")
      .replace(/\[[^\]\n]*\]/g, function (m) { return /[一-鿿]/.test(m) ? m : ""; })
      .replace(/[*_`#]+/g, "")
      .replace(/^[ \t]+/gm, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

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

  // Longest run of number characters at i whose every character is allowed.
  function numRunAt(text, i, lex) {
    var j = i;
    while (j < text.length && isNum(text[j]) && lex.words.has(text[j])) j++;
    return j - i;
  }

  /* Segmentation is a shortest-path problem, not a greedy walk. Pure greedy
   * maximum matching strands characters whenever a longer word starting
   * earlier wins: with 不便 in the list, 不便宜 segments as 不便 + 宜 and reports
   * 宜 as out of level, though 不 + 便宜 covers it exactly. That false positive
   * grows with the list, so choose the segmentation that leaves the fewest
   * characters unmatched, breaking ties toward fewer (longer) words.
   *
   * Token kinds:
   *   word  - in the allowlist (entry attached)
   *   num   - a merged numeral run (entry synthesized)
   *   punct - whitespace / punctuation / digits
   *   bad   - out of level
   *   latin - roman letters (pinyin or English crept in) */
  function segment(text, lex) {
    var n = text.length;
    if (!n) return [];

    // best[i] = cheapest way to cover text[i..n): [unmatchedChars, tokens]
    var best = new Array(n + 1);
    var take = new Array(n + 1);   // chosen [length, kind] at i
    best[n] = [0, 0];

    for (var i = n - 1; i >= 0; i--) {
      var options = [];
      if (isPunct(text[i])) {
        var pe = i;
        while (pe < n && isPunct(text[pe])) pe++;
        options.push([pe - i, "punct"]);
      } else if (isLatin(text[i])) {
        var le = i;
        while (le < n && isLatin(text[le])) le++;
        options.push([le - i, "latin"]);
      } else {
        var max = Math.min(lex.maxLen, n - i);
        for (var len = max; len > 0; len--) {
          if (lex.words.has(text.slice(i, i + len))) options.push([len, "word"]);
        }
        var run = numRunAt(text, i, lex);
        if (run > 1) options.push([run, "num"]);
        options.push([1, "bad"]);          // always a way forward
      }

      var bestCost = null, bestTake = null;
      for (var o = 0; o < options.length; o++) {
        var l = options[o][0], kind = options[o][1];
        var rest = best[i + l];
        var unmatched = rest[0] + (kind === "bad" || kind === "latin" ? l : 0);
        var tokens = rest[1] + 1;
        if (!bestCost || unmatched < bestCost[0] ||
            (unmatched === bestCost[0] && tokens < bestCost[1])) {
          bestCost = [unmatched, tokens];
          bestTake = [l, kind];
        }
      }
      best[i] = bestCost;
      take[i] = bestTake;
    }

    // Walk the chosen path, merging adjacent out-of-level characters so 想要
    // surfaces as one violation rather than two.
    var out = [];
    for (var p = 0; p < n;) {
      var step = take[p], end = p + step[0], kind = step[1];
      if (kind === "bad") {
        while (end < n && take[end][1] === "bad") end += take[end][0];
      }
      var entry = null;
      if (kind === "word") entry = lex.words.get(text.slice(p, end));
      else if (kind === "num") {
        var parts = [];
        for (var k = p; k < end; k++) parts.push((lex.words.get(text[k]) || {}).p || "");
        entry = { w: text.slice(p, end), p: parts.join(" ").trim(), d: "number" };
      }
      out.push({ kind: kind, start: p, end: end, text: text.slice(p, end), entry: entry });
      p = end;
    }
    return out;
  }

  /* Words that carry no topic on their own. Their presence on both sides of an
   * exchange says nothing, so they are ignored when comparing what was said. */
  var FUNCTION_WORDS = ("你 我 他 她 它 您 我们 你们 他们 的 了 吗 呢 吧 啊 呀 是 不 " +
    "没 没有 也 还 很 太 都 和 跟 在 有 会 能 要 想 就 才 一 个 这 那 呀 嗯").split(" ");

  function contentWords(text, lex) {
    var skip = new Set(FUNCTION_WORDS);
    var out = [];
    segment(text, lex).forEach(function (t) {
      if (t.kind === "word" && !skip.has(t.text) && out.indexOf(t.text) === -1) out.push(t.text);
    });
    return out;
  }

  /* True when the reply's closing question is one the learner just asked.
   *
   * A partner under tight vocabulary and length limits can satisfy every rule
   * by handing the question straight back -- 你喜欢喝茶吗？ answered with
   * 你喜欢喝吗？ -- which reads as not having understood. Comparing content
   * words catches it: if the question introduces nothing the learner did not
   * already say, it is an echo rather than a reply. */
  function echoesQuestion(reply, userText, lex) {
    var m = String(reply || "").match(/([^。！？!?\n]+[？?])\s*$/);
    if (!m) return false;
    var asked = contentWords(m[1], lex);
    if (!asked.length) return false;
    var said = new Set(contentWords(userText || "", lex));
    return asked.every(function (w) { return said.has(w); });
  }

  /* Split a run of unmatchable characters using a reference lexicon, keeping
   * anything it does not recognise together: a name is better stored whole than
   * filed as separate characters. */
  function splitRun(run, refLex) {
    var out = [], chunk = "", i = 0;
    var flush = function () { if (chunk) { out.push(chunk); chunk = ""; } };
    while (i < run.length) {
      var hit = 0;
      if (refLex) {
        for (var len = Math.min(refLex.maxLen, run.length - i); len > 1; len--) {
          if (refLex.words.has(run.slice(i, i + len))) { hit = len; break; }
        }
      }
      if (hit) { flush(); out.push(run.slice(i, i + hit)); i += hit; continue; }
      chunk += run[i++];
      if (chunk.length >= 4) flush();
    }
    flush();
    return out;
  }

  /* The words a flagged span actually represents.
   *
   * A level's own lexicon cuts in the wrong place, because it knows only that
   * level's words: at HSK 0.5 the sentence 我喜欢跟狗一起走 flags 起走, since 一
   * is known and 起 and 走 are not. Storing that fragment would teach the app a
   * word that does not exist.
   *
   * A reference lexicon knows the real boundaries, so the span is read off a
   * dictionary segmentation of the same sentence -- 我 喜欢 跟 狗 一起 走 -- and
   * the words overlapping it are what the learner met. That is trusted only
   * when it yields a real multi-character word, because the dictionary also
   * holds most single characters, and 托德 would otherwise become 托 and 德. */
  function wordsAt(text, start, end, refLex) {
    if (refLex) {
      var overlap = segment(text, refLex).filter(function (t) {
        return t.kind === "word" && t.start < end && t.end > start;
      });
      for (var i = 0; i < overlap.length; i++) {
        if (overlap[i].text.length > 1) {
          return overlap.map(function (t) { return t.text; });
        }
      }
    }
    return splitRun(text.slice(start, end), refLex);
  }

  /* Personal names are not vocabulary. The published lists carry almost no name
   * characters -- 张 arrives at HSK 3 and 王 at HSK 4, and nothing usable exists
   * below that -- so a model answering this app's own HSK 1 starter
   * 你叫什么名字？ has no legal name to give: 小明, 小王 and 李老师 are all
   * rejected, every repair attempt is spent renaming, and the learner's very
   * first turn lands on a canned fallback. Characters introduced by 叫 or 姓 are
   * read as a name rather than a violation.
   *
   * A post-filter on validate() rather than another option inside segment():
   * the segmenter takes the shortest path, so a zero-cost name span would beat
   * the real parse of 你叫什么名字 (什么 + 名字, two tokens) with a bogus
   * one-token name. Forgiving only what the segmenter already gave up on leaves
   * every legal parse exactly as it was. */
  var NAME_INTRO = "叫姓";
  var NAME_MAX = 3;            // 小明, 王小明 -- long enough for a full name

  function nameSpans(text) {
    var spans = [];
    for (var i = 0; i < text.length; i++) {
      if (NAME_INTRO.indexOf(text[i]) === -1) continue;
      var end = i + 1;
      while (end < text.length && end - i <= NAME_MAX &&
             !isPunct(text[end]) && !isLatin(text[end])) end++;
      if (end > i + 1) spans.push([i + 1, end]);
    }
    return spans;
  }

  function validate(text, lex) {
    var spans = nameSpans(text);
    return segment(text, lex).filter(function (t) {
      return t.kind === "bad" || t.kind === "latin";
    }).map(function (t) {
      /* Marked rather than dropped. These same violations are what the app
       * turns into the learner's "new words" list, and a name that just went
       * past on screen is worth glossing -- it is only the repair loop that
       * should let it through. Overlap rather than containment because the
       * segmenter merges adjacent unplaceable characters: in 他姓张 the run is
       * 姓张, opening one character before the name does.
       *
       * Latin is never a name. The prompt bans English outright, so 我叫John is
       * a rule break rather than something to read. */
      if (t.kind === "bad" && spans.some(function (s) {
        return t.start < s[1] && t.end > s[0];
      })) t.name = true;
      return t;
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
    nameSpans: nameSpans,
    suggest: suggest,
    isPunct: isPunct,
    stripScaffold: stripScaffold,
    contentWords: contentWords,
    splitRun: splitRun,
    wordsAt: wordsAt,
    echoesQuestion: echoesQuestion,
    isAscii: function (t) { return /^[\x00-\x7F]*$/.test(t); }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSK = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
