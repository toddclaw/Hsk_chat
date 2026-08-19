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
    /* A first-week level: the 150 commonest and most-taught words of HSK 1.
     * The grammar rule is stricter than HSK 1's -- no 了 at all, and sentences
     * short enough to hold in your head while you decode them. */
    0: {
      vocab: "只用最简单的词。学生刚开始学中文，只会一百多个词。",
      grammar: "只用最短的句子：谁 + 做什么。不要用「了」「过」「把」「被」，" +
               "不要用长句子，一句话不要超过七八个字。",
      sample: "你好！我很好。你叫什么名字？"
    },
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

  /* Conversation starters, in each level's own vocabulary. At HSK 1 the hard
   * part is not saying a sentence, it is knowing which sentence is even
   * sayable; these are the ones that are. Every line validates against its own
   * level (see the test suite) -- a starter the app would then underline as
   * out of level would be worse than none. */
  var STARTERS = {
    0: ["你好！你叫什么名字？", "你今天好吗？", "你喜欢吃什么？", "你会说中文吗？",
        "你家有几个人？", "你喜欢喝茶吗？", "你是学生吗？", "现在几点？",
        "你几岁？", "你的老师是谁？"],
    1: ["你好！你叫什么名字？", "你是哪国人？", "你今天好吗？", "你喜欢吃什么？",
        "你会说中文吗？", "你家有几个人？", "今天热吗？", "你几点睡觉？",
        "你想喝茶还是喝水？", "你有中国朋友吗？", "你的家在哪儿？", "你想去哪儿？"],
    2: ["你昨天做什么了？", "你有什么爱好？", "你喜欢什么运动？", "你去过中国吗？",
        "你平时几点起床？", "周末你想做什么？", "你会做饭吗？", "你最喜欢什么颜色？",
        "你觉得中文难不难？", "你家离公司远吗？"],
    3: ["你为什么开始学中文？", "你喜欢夏天还是冬天？", "你觉得学中文难吗？",
        "你以后有什么打算？", "你喜欢住在城市还是农村？", "你最近在忙什么？",
        "你昨天晚上做了什么？", "你觉得什么样的朋友最重要？", "你周末一般怎么过？"],
    4: ["你觉得什么样的工作最有意思？", "你小时候的梦想是什么？", "你旅行的时候喜欢做什么？",
        "你觉得学一门语言最重要的是什么？", "你怎么安排自己的时间？",
        "你最近有没有养成什么好习惯？", "你觉得网上购物方便吗？",
        "你更喜欢一个人还是跟朋友一起？"],
    5: ["你觉得科技让生活变得更好了吗？", "你怎么安排工作和休息的时间？", "你最近读了什么书？",
        "你觉得环境问题严重吗？", "你认为年轻人的压力主要来自哪里？",
        "你觉得什么样的教育最有用？", "你相信努力比运气更重要吗？",
        "你觉得城市的生活压力大吗？"],
    6: ["你觉得社会的变化让人更幸福了吗？", "你认为传统文化还有多少影响？",
        "你怎么看待人工智能的发展？", "你觉得什么决定了一个人的性格？",
        "你认为成功的标准是什么？", "你觉得网络让人们更亲近还是更孤独？"],
    7: ["你觉得语言会不会影响一个人的思维方式？", "你怎么看待现代社会的焦虑感？",
        "你认为什么样的生活才算有意义？", "你觉得文化差异最难跨越的地方在哪里？",
        "你相信人的性格是天生的还是后天形成的？", "你觉得这个时代最大的挑战是什么？"]
  };

  function startersFor(level) {
    return STARTERS[level] || STARTERS[1];
  }

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

  /* opts: { level, label, length, words, script, convert }
   * `words` is the allowlist joined by spaces, appended only in with-list mode.
   * `convert` rewrites app-authored Chinese into the active script; it runs over
   * the rules and the sample but never over `words`, which the caller already
   * supplies in that script. `offer` are next-level words permitted this turn,
   * `reuse` are recently introduced ones worth repeating. */
  function build(opts) {
    var style = styleFor(opts.level);
    var len = LENGTHS[opts.length] || LENGTHS.short;
    var convert = opts.convert || function (t) { return t; };
    var lines = [
      convert("你是一个中文聊天伙伴。用户是学中文的学生") + "（" + opts.label + "）。",
      "",
      convert("规则：") ,
      /* When words are on offer, rule 1 has to say so. Left absolute it
       * contradicts the offer outright -- "never use a word the student does
       * not know" against "you may use one of these" -- and a model resolving
       * that conflict obeys the rule stated first and stated without exception,
       * so the offer is silently ignored every turn. */
      "1. " + convert(style.vocab) +
        ((opts.offer && opts.offer.length) ? convert("（第 10 条的新词除外。）") : ""),
      "2. " + convert(len.rule),
      "3. " + convert(style.grammar),
      "4. " + convert("学生可以用英文问你，你看得懂。但是你回答的时候只可以写汉字，"),
      "   " + convert("不要用英文，不要用拼音，不要用汉字注音。"),
      "5. " + convert("每次说完，问学生一个问题。"),
      "6. " + convert("如果你真的需要一个学生不会的词，写") + " [[NEED:" + convert("词") +
              "|pīn yīn|english]]" + convert("，一句话最多一个。"),
      "7. " + convert("学生问「…怎么说」的时候，一定用") + " [[NEED:" + convert("词") +
              "|pīn yīn|english]] " + convert("回答，"),
      "   " + convert("这样他可以看到拼音和意思。不要用英文解释。"),
      "8. " + convert("只写句子本身。不要写时间（比如 [0.0:]），不要写方括号、星号或者标题。")
    ];
    if (opts.script === "trad") {
      // The one rule with no simplified counterpart: say which script to write.
      lines.push("9. " + convert("请用繁体字回答，不要用简体字。"));
    }
    /* Gradual introduction. The offer is permission, not an instruction: a word
     * forced into a conversation it does not fit reads as a vocabulary drill,
     * and the credit simply carries to the next turn instead. */
    if (opts.offer && opts.offer.length) {
      if (opts.require) {
        // No longer a suggestion: the reply is rejected without it.
        lines.push("10. " + convert("这次一定要用「") + opts.require +
                   convert("」这个词，放在一句话里。这是必须的。"));
      } else {
        lines.push("10. " + convert("学生现在可以学一个新词。这次请用下面的一个：") +
                   opts.offer.map(function (e) { return e.w; }).join("、") +
                   convert("。只用一个，放在自然的句子里；" +
                           "只有在实在放不进去的时候，才一个都不用。"));
      }
    }
    if (opts.reuse && opts.reuse.length) {
      lines.push("11. " + convert("学生最近学了这些词，请多用：") +
                 opts.reuse.map(function (e) { return e.w; }).join("、") + convert("。"));
    }
    lines.push(
      "",
      convert("例子："),
      convert("学生：你好！"),
      convert("你：") + convert(style.sample),
      convert("学生：") + "怎么说 fried egg",
      convert("你：") + "[[NEED:" + convert("煎蛋") + "|jiān dàn|fried egg]]" +
        convert("。你喜欢吃吗？")
    );
    if (opts.words) lines.push("", convert("你只可以用这些词："), opts.words);
    return lines.join("\n");
  }

  var api = { LEVEL_STYLE: LEVEL_STYLE, LENGTHS: LENGTHS, STARTERS: STARTERS,
              styleFor: styleFor, startersFor: startersFor, build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKPrompt = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
