/* System prompt construction.
 *
 * Separate from index.html so the per-level samples can be validated against
 * their own allowlists by the test suite: a prompt that demonstrates a word the
 * validator will reject teaches the model to fail.
 *
 * Loadable in the browser (window.HSKPrompt) and in node (module.exports).
 */
(function (root) {
  "use strict";

  /* Register and grammar per HSK band. The bans shrink as the level rises --
   * telling an HSK 5 partner to avoid 把 and 被 forbids grammar the learner met
   * at HSK 2 and 4 -- and above HSK 5 the direction reverses into encouragement.
   * Every sample validates clean against its own level (see the test suite). */
  var LEVEL_STYLE = {
    1: {
      vocab: "只用很简单的词。学生不认识的词，一个也不要用。",
      grammar: "只用最简单的句子：谁 + 做什么。不要用：把、被、就、才、" +
               "动词补语（看得懂、跑出去、说完了）、难的「了」。",
      sample: "你好！我很高兴。你叫什么名字？"
    },
    2: {
      vocab: "用简单的词。学生不认识的词不要用。",
      grammar: "可以用「了」「过」「在…呢」「一点儿」「比」。" +
               "还不要用：把、被、难的动词补语。",
      sample: "我今天很忙。上午我去了商店，买了一些水果。你今天做什么了？"
    },
    3: {
      vocab: "用简单的词，可是不用太短。学生不认识的词不要用。",
      grammar: "可以用「把」、结果补语（看完、听懂）、「因为…所以」「虽然…但是」" +
               "「要是…就」。还不要用「被」和很难的书面语。",
      sample: "因为今天下雨，所以我没有出去。我在家看完了一本书，觉得很有意思。" +
              "你喜欢在家做什么？"
    },
    4: {
      vocab: "用学生学过的词就行，不用特别简单。",
      grammar: "可以用「被」、方向补语和结果补语、「不但…而且」「除了…以外」" +
               "「越来越」。句子可以长一点，可以有两三个小句。",
      sample: "这本书我已经看了一半，虽然有点难，但是越看越有意思。" +
              "除了小说以外，我也喜欢看历史书。你最近在看什么？"
    },
    5: {
      vocab: "自然地用词，不用刻意简单。只是别用学生没学过的词。",
      grammar: "可以用「使」「让」「由于」「尽管…还是」「无论…都」，" +
               "也可以用一些常见的成语。语气自然一点，像跟朋友聊天。",
      sample: "由于最近工作特别忙，我几乎没有时间锻炼身体，这让我有点担心。" +
              "不过我还是每天坚持走路回家。你平时怎么安排自己的时间？"
    },
    6: {
      vocab: "自然地用词。只是别用学生没学过的词。",
      grammar: "可以用比较正式的说法和书面语，也可以用成语。不用为了简单牺牲表达，" +
               "但是要说得清楚。",
      sample: "我一直觉得，学一门语言最难的并不是记住多少词，" +
              "而是能不能自然地表达自己的想法。你有没有同样的感觉？"
    },
    7: {
      vocab: "像跟母语者说话一样用词。只是别用学生没学过的词。",
      grammar: "自然、地道，可以用成语、俗语和比较复杂的句子。不用为了简单牺牲表达。",
      sample: "说实话，语言学到一定的程度，难的往往不是词汇量，" +
              "而是能不能把话说得恰当。你觉得自己现在卡在哪里？"
    }
  };

  /* How much the partner says. Kept level-neutral -- the register comes from
   * LEVEL_STYLE, the volume from here -- so the two compose. */
  var LENGTHS = {
    short:  { label: "short — 1-2 sentences",  maxTokens: 300,
              rule: "每次说一到两句话。不要长。" },
    medium: { label: "medium — 3-4 sentences", maxTokens: 500,
              rule: "每次说三到四句话。先说你自己的事，再问学生。" },
    long:   { label: "longer — 5-6 sentences", maxTokens: 800,
              rule: "每次说五到六句话。多说一点你自己的想法和今天做的事，" +
                    "最后问学生一个问题。不要只说一两句。" }
  };

  function styleFor(level) {
    return LEVEL_STYLE[level] || LEVEL_STYLE[1];
  }

  /* opts: { level, label, length, words }
   * `words` is the allowlist joined by spaces, appended only in with-list mode. */
  function build(opts) {
    var style = styleFor(opts.level);
    var len = LENGTHS[opts.length] || LENGTHS.short;
    var lines = [
      "你是一个中文聊天伙伴。用户是学中文的学生（" + opts.label + "）。",
      "",
      "规则：",
      "1. " + style.vocab,
      "2. " + len.rule,
      "3. " + style.grammar,
      "4. 学生可以用英文问你，你看得懂。但是你回答的时候只可以写汉字，",
      "   不要用英文，不要用拼音，不要用汉字注音。",
      "5. 每次说完，问学生一个问题。",
      "6. 如果你真的需要一个学生不会的词，写 [[NEED:词|pīn yīn|english]]，一句话最多一个。",
      "7. 学生问「…怎么说」的时候，一定用 [[NEED:词|pīn yīn|english]] 回答，",
      "   这样他可以看到拼音和意思。不要用英文解释。",
      "",
      "例子：",
      "学生：你好！",
      "你：" + style.sample,
      "学生：怎么说 fried egg",
      "你：[[NEED:煎蛋|jiān dàn|fried egg]]。你喜欢吃吗？"
    ];
    if (opts.words) lines.push("", "你只可以用这些词：", opts.words);
    return lines.join("\n");
  }

  var api = { LEVEL_STYLE: LEVEL_STYLE, LENGTHS: LENGTHS, styleFor: styleFor, build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKPrompt = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
