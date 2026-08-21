/* Ambiguous-form sense registry and per-level sense policy.
 *
 * validator.js only ever knows a word's surface form: once 得 sits in a
 * level's allowlist, any use of 得 passes. That is not enough for a small
 * set of characters whose different grammatical functions land at genuinely
 * different points in a learner's progression. 得 alone covers three
 * unrelated pieces of grammar that happen to share a character:
 *
 *   dei_modal     "must, have to" (děi) -- 我得走了, 你得小心
 *   de_complement a structural particle linking a verb/adjective to a
 *                 following complement of result, degree or possibility
 *                 (de) -- 跑得快, 高兴得很, 听得懂
 *   de_lexical    fossilised inside an existing compound -- 觉得, 得到,
 *                 值得, 记得...
 *
 * An allowed character or word does NOT mean every sense of it is allowed:
 * a level that has met 得 only inside 觉得/懂得 has not thereby met the
 * dei_modal "must" construction, and the JS validator has no way to tell
 * the two apart from surface form alone.
 *
 * de_lexical never appears as a standalone token in the first place: it
 * only ever occurs inside a compound word, which the segmenter (being a
 * shortest-path match against the allowlist, see validator.js) already
 * folds into one "word" token the moment that compound is itself in the
 * active lexicon. There is nothing left for a standalone check to do with
 * it -- if the compound is above level, ordinary vocabulary validation
 * already rejects it before this module is ever consulted. This module
 * therefore only ever classifies STANDALONE occurrences, and only offers
 * the classifier the senses that can actually occur standalone.
 *
 * This module is pure and network-free: registry lookup, per-level policy,
 * and prompt text only. The actual classification call belongs to the app
 * (it owns callModel()) -- this module says which words are worth spending
 * one on, and whether a reported sense is in or out of policy for the level
 * in play. New ambiguous words are added to REGISTRY alone; no other code
 * needs to change for the trigger, the policy, or the repair prompt to
 * pick them up.
 *
 * Loadable in the browser (window.HSKSenses) and in node (module.exports),
 * exactly like validator.js/prompt.js/pace.js, so the same registry is
 * directly unit-testable.
 */
(function (root) {
  "use strict";

  /* One entry per ambiguous surface word.
   *
   *  senses      every sense this module knows about, for documentation.
   *  standalone  the subset that can appear as a standalone token -- what
   *              the classifier is actually asked to choose between.
   *  classify    Chinese description of each standalone sense, used to ask
   *              the model which one a given occurrence is.
   *  suggest     Chinese alternative phrasing, used in the repair prompt
   *              when a sense is disallowed at the level in play.
   *  tiers       ordered [maxLevel, allowed senses] pairs; the first tier
   *              whose maxLevel covers the level in play applies. Written
   *              as data, not a function, so a future word reuses the same
   *              shape without new code -- only a new REGISTRY entry.
   *
   * Policy for 得 (conservative default): no sense at all through HSK 2,
   * de_complement alone from HSK 3, dei_modal joins from HSK 5, and by
   * HSK 7-9 both are unrestricted. de_lexical is never gated here -- see
   * the module comment above -- so it does not appear in any tier.
   */
  var REGISTRY = {
    "得": {
      senses: ["dei_modal", "de_complement", "de_lexical"],
      standalone: ["dei_modal", "de_complement"],
      classify: {
        dei_modal: "「得」是必须、应该的意思，后面直接跟一个动词短语（比如「我得走了」「你得小心」）",
        de_complement: "「得」放在动词或形容词后面，连接表示结果、程度或可能的部分（比如「跑得快」「高兴得很」「听得懂」）"
      },
      suggest: {
        dei_modal: "要 / 必须",
        de_complement: "很 / 极了 -- 换一种不用「得」字的说法"
      },
      tiers: [
        { maxLevel: 2, allow: [] },
        { maxLevel: 4, allow: ["de_complement"] },
        { maxLevel: 6, allow: ["de_complement", "dei_modal"] },
        { maxLevel: 99, allow: ["de_complement", "dei_modal"] }
      ]
    }
  };

  function entryFor(word) {
    return Object.prototype.hasOwnProperty.call(REGISTRY, word) ? REGISTRY[word] : null;
  }

  function allowedSenses(word, level) {
    var e = entryFor(word);
    if (!e) return null;
    for (var i = 0; i < e.tiers.length; i++) {
      if (level <= e.tiers[i].maxLevel) return e.tiers[i].allow.slice();
    }
    return e.tiers[e.tiers.length - 1].allow.slice();
  }

  /* Registered words present as a standalone "word" token -- i.e. the
   * segmenter did not fold them into a longer allowlist entry. Order and
   * duplicates preserved: the classifier is asked about each occurrence in
   * the order it appears, one sense label per occurrence. */
  function standaloneHits(tokens, word) {
    return (tokens || []).filter(function (t) { return t.kind === "word" && t.text === word; });
  }

  // Every registered word with at least one standalone occurrence in this
  // token list -- the trigger condition for spending a classify call at all.
  function wordsPresent(tokens) {
    var out = [];
    Object.keys(REGISTRY).forEach(function (w) {
      if (standaloneHits(tokens, w).length) out.push(w);
    });
    return out;
  }

  function classifyPrompt(word, text, count) {
    var e = entryFor(word);
    var senseList = e.standalone.map(function (s) { return s + "：" + e.classify[s]; }).join("\n");
    return "下面这句话里，单独出现的「" + word + "」字一共有 " + count + " 次" +
      "（更长词语里的「" + word + "」不算，比如「觉得」「得到」里的）。\n" +
      "句子：" + text + "\n\n" +
      "请按出现的顺序，判断每一次「" + word + "」属于哪一种用法：\n" + senseList + "\n\n" +
      "只回复一个 JSON 数组，长度必须正好是 " + count + "，每一项是一个字符串（" +
      e.standalone.join(" 或 ") + "），比如：[\"dei_modal\",\"de_complement\"]。不要写别的。";
  }

  // Tolerant of prose wrapped around the array -- the same posture as the
  // app's other JSON-from-a-model parsing (glossWords in index.html).
  function parseClassification(raw, count) {
    try {
      var s = String(raw || "");
      var json = s.slice(s.indexOf("["), s.lastIndexOf("]") + 1);
      var arr = JSON.parse(json);
      if (!Array.isArray(arr) || arr.length !== count) return null;
      return arr.map(function (v) { return String(v); });
    } catch (e) { return null; }
  }

  /* Compare a classification against level policy. One violation per
   * disallowed occurrence, shaped like validator.js's own violation objects
   * but with kind "sense" so the repair loop can tell the two apart. */
  function checkSenses(word, senseResult, level) {
    var allowed = allowedSenses(word, level) || [];
    var out = [];
    (senseResult || []).forEach(function (sense) {
      if (allowed.indexOf(sense) === -1) out.push({ kind: "sense", word: word, sense: sense });
    });
    return out;
  }

  /* Descriptive sentences only -- no closing "try again" instruction. The
   * app's own repair loop (index.html) combines this with the vocabulary
   * repair text from the same attempt and appends one shared closing line,
   * so this never duplicates it. */
  function repairPrompt(violations) {
    var parts = [];
    (violations || []).forEach(function (v) {
      var e = entryFor(v.word);
      var desc = (e && e.classify[v.sense]) || v.sense;
      var alt = (e && e.suggest[v.sense]) || "";
      parts.push("你用的「" + v.word + "」是" + desc + "，这个用法在这个级别还不可以用" +
        (alt ? "，可以换成：" + alt : "") + "。");
    });
    return parts.join("");
  }

  var api = {
    REGISTRY: REGISTRY,
    isRegistered: function (w) { return !!entryFor(w); },
    allowedSenses: allowedSenses,
    standaloneHits: standaloneHits,
    wordsPresent: wordsPresent,
    classifyPrompt: classifyPrompt,
    parseClassification: parseClassification,
    checkSenses: checkSenses,
    repairPrompt: repairPrompt
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKSenses = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
