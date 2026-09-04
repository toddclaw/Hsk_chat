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
              "而是能不能说得恰当。你觉得自己现在卡在哪里？"
    }
  };

  /* Conversation starters, in each level's own vocabulary. At HSK 1 the hard
   * part is not saying a sentence, it is knowing which sentence is even
   * sayable; these are the ones that are. Every line validates against its own
   * level (see the test suite) -- a starter the app would then underline as
   * out of level would be worse than none. */
  var STARTERS = {
    1: ["你好！你叫什么名字？", "你是哪国人？", "你今天好吗？", "你喜欢吃什么？",
        "你会说中文吗？", "你家有几个人？", "今天热吗？", "你几点睡觉？",
        "你想喝茶还是喝水？", "你有中国朋友吗？", "你的家在哪儿？", "你想去哪儿？"],
    2: ["你昨天做什么了？", "你有什么爱好？", "你喜欢什么运动？", "你去过中国吗？",
        "你几点起床？", "你今天想做什么？", "你会做饭吗？", "你最喜欢什么颜色？",
        "你觉得中文有意思吗？", "你家离公司远吗？"],
    3: ["你为什么开始学中文？", "你喜欢夏天还是冬天？", "你觉得学中文难吗？",
        "你以后有什么打算？", "你喜欢住在大城市还是小地方？", "你最近在忙什么？",
        "你昨天晚上做了什么？", "你觉得朋友最重要的是什么？", "你周末一般怎么过？"],
    4: ["你觉得工作最重要的是什么？", "你小时候的梦想是什么？", "你旅行的时候喜欢做什么？",
        "你觉得学一门语言最重要的是什么？", "你怎么安排自己的时间？",
        "你最近有没有养成什么好习惯？", "你觉得网上购物方便吗？",
        "你更喜欢一个人还是跟朋友一起？"],
    5: ["你觉得科技让生活变得更好了吗？", "你怎么安排工作和休息的时间？", "你最近读了什么书？",
        "你觉得环境问题严重吗？", "你认为年轻人的压力主要来自哪里？",
        "你觉得教育最重要的是什么？", "你相信努力比运气更重要吗？",
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

  /* What a story could be about, per level.
   *
   * English, and deliberately: this is a menu for CHOOSING, not something the
   * learner will say, so holding it to the level's vocabulary would buy nothing
   * and cost expressiveness. The topic reaches the model verbatim (build()'s
   * topic rule), and the level guarantee comes from the validator downstream as
   * it always does.
   *
   * What no test can check is whether an idea suits its level -- that is
   * judgment, and a badly judged one produces a dull story rather than an
   * illegal one. What the tests do check is that every level has its own pool,
   * per D8 in the design doc.
   *
   * The evidence for offering a menu at all rather than only a free-text box:
   * extensive-reading effects measured LARGER where text choice was limited and
   * some accountability was present. See RESEARCH.md, "Letting the learner
   * choose the story". */
  var STORY_IDEAS = {
    1: ["A day at the market", "A lost cat comes home",
        "Two friends and one umbrella", "Breakfast with the family",
        "A very slow bus"],
    2: ["A running race at school", "Buying a birthday present",
        "The first day at a new job", "A weekend at the beach",
        "A dog that will not sit down"],
    3: ["Getting lost in a big city", "A cooking contest between neighbours",
        "The night the power went out", "An old photograph nobody recognises",
        "Moving into a new apartment"],
    4: ["A misunderstanding between two coworkers", "A journey by night train",
        "The shop that never closes", "Someone returns after ten years away",
        "A promise that is hard to keep"],
    5: ["A small town keeps a secret", "Two versions of the same afternoon",
        "An apprentice outgrows the master",
        "A letter that arrives twenty years late"],
    6: ["A negotiation where both sides are wrong",
        "The last day of an old factory", "A translator who changes one word",
        "An argument about what really happened"],
    7: ["A rumour that reshapes a neighbourhood",
        "The Monkey King borrows something he should not",
        "A scholar who refuses an appointment",
        "Two accounts of the same reform"]
  };

  function storyIdeasFor(level) {
    return STORY_IDEAS[level] || STORY_IDEAS[1];
  }

  /* Which comprehension questions the partner may ask, per level.
   *
   * Ordered by the OUTPUT an answer demands, which is TPRS's circling ladder --
   * yes/no asks almost nothing, wh- more, why most. But which rungs are
   * AVAILABLE comes from this language's data, and it inverts the English
   * order: 谁/什么/哪儿/几/多少/怎么样 are all HSK 1 while 还是 is HSK 2, because
   * Chinese wh- questions are in-situ and the question words are among the
   * commonest in the language.
   *
   * `needs` is the vocabulary an asking form requires, and test/prompt.test.js
   * asserts every word is an ENTRY in that level's list -- not merely
   * segmentable. That is what keeps 还是 out of HSK 1: validate() accepts it as
   * 还 + 是, so the ladder has to be stricter than the validator. Where a form
   * is genuinely compositional (什么 + 时候) the pieces are listed instead, so
   * the judgment is explicit rather than hidden.
   *
   * Cumulative, and complete for all seven levels per D8: a table filled in
   * only to HSK 2 would leave HSK 3-7 asking yes/no questions forever with
   * nothing reporting it. See RESEARCH.md, "Which questions, at which level". */
  var QUESTION_LADDER = {
    1: { types: ["yesno", "who", "what", "where", "howmany", "when", "howabout"],
         needs: ["吗", "谁", "什么", "哪儿", "几", "多少", "时候", "怎么样"] },
    2: { types: ["eitheror", "why"], needs: ["还是", "为什么", "因为"] },
    /* 要是 dropped from the design doc's needs list, same reason as 越来越
     * below: it is not an entry in data/hsk3.json, only from hsk4.json up.
     * Neither question shape HSK 3 unlocks uses it (reason: 虽然下雨，他还是去
     * 了，为什么？ / retell: 用你自己的话说一说刚才那一段。). Fix the ladder, not
     * the wordlist. */
    3: { types: ["reason", "retell"], needs: ["虽然", "但是", "所以"] },
    /* 越来越 dropped from the design doc's needs list: it is not an entry in
     * data/hsk4.json or any other level -- only 越 is, from HSK 3 up. Neither
     * question shape HSK 4 unlocks uses it (compare: 这一段和上一段比，有什么不
     * 一样？ / predict: 你觉得下面会怎么样？). Fix the ladder, not the wordlist. */
    4: { types: ["compare", "predict"], needs: ["比", "觉得"] },
    5: { types: ["infer"], needs: [] },
    6: { types: ["opinion"], needs: [] },
    7: { types: ["evaluate"], needs: [] }
  };

  /* Levels 5-7 add no new asking vocabulary because what they add is depth, not
   * new question words -- an inference question is asked with the same 为什么 as
   * a why question. They are thin on purpose and grown on arrival. */
  function questionTypesFor(level) {
    var types = [], needs = [];
    for (var lv = 1; lv <= (level || 1); lv++) {
      var row = QUESTION_LADDER[lv];
      if (!row) continue;
      row.types.forEach(function (t) { if (types.indexOf(t) === -1) types.push(t); });
      row.needs.forEach(function (w) { if (needs.indexOf(w) === -1) needs.push(w); });
    }
    return { types: types, needs: needs };
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

  /* Which arm of the prompt-mode A/B a level actually wants.
   *
   * The measurement says there is no single answer: the allowlist helps where it
   * CONSTRAINS and stops once it does not. At HSK 1-3 the model reaches for words
   * the level does not carry and the list redirects it -- violation tokens more
   * than halve. By HSK 4 the whole effect is 11 tokens in 64 replies (p = 0.72)
   * and by HSK 6 it is nothing (p = 1.00), because the model's natural register at
   * short length already sits inside 5,334 words. Cost meanwhile runs 2.7x to 33x.
   * Full table in RESEARCH.md, "Whether the allowlist belongs in the prompt".
   *
   * So `auto` is the default and resolves per level, and the two explicit values
   * still pin an arm -- the counters in Settings exist to be run, and pinning is
   * how you run them. HSK 4 is the ambiguous boundary and sits on the cheap side
   * deliberately: the evidence there is a non-result, and a non-result should not
   * buy a 12x bill. */
  var AUTO_LIST_MAX_LEVEL = 3;

  function modeFor(mode, level) {
    if (mode === "with-list" || mode === "without-list") return mode;
    return (level || 1) <= AUTO_LIST_MAX_LEVEL ? "with-list" : "without-list";
  }

  /* What varies between the dialogue activities, as data.
   *
   * Four fields, because four is what actually differs. `converse` is the one
   * that is not obvious: build() pushes three conversational turn-taking rules
   * (answer the student, do not repeat them, correct then carry on), and those
   * are wrong inside a story -- every segment would end by asking the learner a
   * question. An activity has to be able to suppress rules, not only add them.
   *
   * Rule text is not held to the level allowlist; the existing rules already use
   * 英文 and 语法, both above HSK 1. Samples and starters are, and still are. */
  /* A story needs characters, and the syllabus will not give it any: 明, 王 and
   * 李 are absent from all 10,896 words of the 7-9 band, and 红 and 白 do not
   * arrive until HSK 5. So there is no level at which story time earns a named
   * character -- this is not a beginner constraint a learner grows out of.
   *
   * validate() forgives a name only where 叫 or 姓 introduces it, which repairs
   * the first mention and leaves it bare in every segment after. So instead
   * these three are named in the prompt and made legal for the turn, the same
   * bargain turn() already strikes for [[NEED:]] words and pacing offers.
   *
   * These three because they are what the model reaches for unprompted: 明, 红
   * and 白 were 283, 84 and 79 of 1686 violations in one measured run. Naming
   * what it was going to say anyway is why the list can be this short.
   *
   * No `t` field: the caller converts these with the same toScript() that
   * converts the rule text, so the prompt and the lexicon cannot disagree about
   * what 小红 looks like in traditional. */
  var STORY_NAMES = [
    { w: "小明", p: "Xiǎo Míng", d: "Xiao Ming, a name" },
    { w: "小红", p: "Xiǎo Hóng", d: "Xiao Hong, a name" },
    { w: "小白", p: "Xiǎo Bái",  d: "Xiao Bai, a name" }
  ];

  /* The secret pool for `guesser` mode: concrete, guessable nouns. No
   * per-level tagging -- an uncurated random word from the raw allowlist can
   * be ungoessable (因为, 应该, 如果), so membership is checked against the
   * student's own cumulative wordlist (S.base) at PICK time instead of
   * asserted up front. Measured against the real data/hsk<N>.json files, HSK 1
   * alone already yields well over half of this pool, so an empty
   * intersection is not a realistic case at any level -- pickSecret() still
   * falls back to any word in base if it ever is one, rather than throwing. */
  var GUESS_POOL = [
    "苹果", "猫", "狗", "书", "老师", "医院", "电脑", "手机", "椅子", "桌子",
    "车", "飞机", "火车", "水果", "衣服", "雨",
    "咖啡", "鱼", "鸟", "床", "门", "花", "足球", "裤子",
    "香蕉", "西瓜", "房子", "伞", "自行车", "公园", "太阳", "山", "树",
    "窗户", "眼镜", "帽子", "星星"
  ];

  /* base: an array of {w,...} entries, e.g. S.base. rng: () => [0,1), so a
   * test can pin the draw. Filters to what the student actually has, falls
   * back to the raw base if that intersection is empty, and returns null only
   * when there is truly nothing to draw from. */
  function pickSecret(base, rng) {
    var r = rng || Math.random;
    var have = {};
    (base || []).forEach(function (e) { have[e.w] = true; });
    var pool = GUESS_POOL.filter(function (w) { return have[w]; });
    if (!pool.length) pool = (base || []).map(function (e) { return e.w; });
    if (!pool.length) return null;
    return pool[Math.min(pool.length - 1, Math.floor(r() * pool.length))];
  }

  /* One example per question type, so the rule shows the shape rather than
   * naming a category the model has to guess at. Filtered by the level's
   * ladder, so HSK 1 never sees a 为什么 example it cannot legally use. */
  var QUESTION_SHAPES = [
    { type: "yesno",    shape: "「他高兴吗？」" },
    { type: "who",      shape: "「谁去了？」" },
    { type: "what",     shape: "「他买了什么？」" },
    { type: "where",    shape: "「他们在哪儿？」" },
    { type: "howmany",  shape: "「有几个？」" },
    { type: "when",     shape: "「什么时候的事？」" },
    { type: "howabout", shape: "「今天怎么样？」" },
    { type: "eitheror", shape: "「他去学校还是去商店？」" },
    { type: "why",      shape: "「他为什么很高兴？」" },
    { type: "reason",   shape: "「虽然下雨，他还是去了，为什么？」" },
    { type: "retell",   shape: "「用你自己的话说一说刚才那一段。」" },
    { type: "compare",  shape: "「这一段和上一段比，有什么不一样？」" },
    { type: "predict",  shape: "「你觉得下面会怎么样？」" },
    { type: "infer",    shape: "「他没有说，可是你觉得他心里想什么？」" },
    { type: "opinion",  shape: "「你觉得他做得对不对？为什么？」" },
    { type: "evaluate", shape: "「这个故事想说明什么？你同意吗？」" }
  ];

  var ACTIVITIES = {
    chat: {
      label: "Chat",
      rules: null,
      names: null,
      reuse: null,
      gen: "turn",
      converse: true,
      note: null
    },
    focused: {
      label: "Ghost Words",
      /* The reuse rule already says "please use these a lot". This one asks for
       * something stronger and different -- build the conversation so the words
       * have somewhere to go -- because a partner that merely uses them when they
       * fit is what the unused list is evidence of not working. */
      rules: [
        "学生学过下面这些词，可是一次也没有自己用过。这是今天的练习目标。" +
        "请你带着话题往这些词的方向走，问一些必须用到这些词才好回答的问题，" +
        "让学生自己说出来。如果学生没有用这些词，继续问，直到他们用到。"
      ],
      names: null,
      reuse: "unused",
      gen: "turn",
      converse: true,
      note: "Ghost Words: practice words you've learned but never used. " +
        "The partner asks questions that need these words in the answer."
    },
    story: {
      label: "Story time",
      rules: [
        "你在给学生讲一个故事。故事要简单、有意思，每一段都要接得上。",
        "只讲故事，不要问学生问题，也不要在故事里跟学生说话。"
      ],
      names: STORY_NAMES,
      reuse: null,
      gen: "segments",
      converse: false,
      note: null
    },
    twenty: {
      label: "20 Questions",
      /* Role-dependent, not activity-dependent -- handled by the branch in
       * build() below, same shape as storyPhase. */
      rules: null,
      names: null,
      reuse: null,
      gen: "turn",
      /* A yes/no-question exchange isn't the answer-then-share-then-ask shape
       * these rules assume; see the role branch in build(). */
      converse: false,
      note: "20 Questions: think of something and let the partner guess it, " +
        "or guess what the partner is thinking of."
    }
  };

  function activityFor(id) {
    return ACTIVITIES[id] || ACTIVITIES.chat;
  }

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
    var act = activityFor(opts.activity);
    var seg = opts.storySegment || null;

    /* Each entry is one rule's finished text; numbering is assigned by
     * position when the list is assembled below. Inserting, removing or
     * reordering a rule can then never leave two rules sharing a number or
     * the model reading them out of order -- both have happened by hand. */
    var rules = [];

    /* When words are on offer, this rule has to say so. Left absolute it
     * contradicts the offer outright -- "never use a word the student does
     * not know" against "you may use one of these" -- and a model resolving
     * that conflict obeys the rule stated first and stated without
     * exception, so the offer is silently ignored every turn. The exception
     * is worded without a rule number, since the offer rule's own number
     * shifts whenever a rule is added above it. */
    rules.push(convert(style.vocab) +
      ((opts.offer && opts.offer.length) ? convert("（后面提到的新词除外。）") : ""));
    /* A story segment sets its own length below; LENGTHS is the conversational
     * axis and its "one or two sentences" contradicts it outright. */
    if (!seg) rules.push(convert(len.rule));
    rules.push(convert(style.grammar));
    rules.push(convert("学生可以用英文问你，你看得懂。但是你回答的时候只可以写汉字，") +
               "\n   " + convert("不要用英文，不要用拼音，不要用汉字注音。"));
    /* Without this the rules are all constraints and nothing asks for a
     * reply. Under a tight vocabulary the cheapest way to obey every other
     * rule is to hand the student's own sentence back, which reads as not
     * having understood. */
    /* Turn-taking. Suppressed for an activity that is not a conversation --
     * inside a story these would make every segment end by questioning the
     * learner, which is the opposite of listening to a story. */
    if (act.converse) {
      rules.push(convert("先回答学生说的话，再说一点你自己的事，最后问一个新问题。"));
      rules.push(convert("不要把学生的话重复一遍。学生刚问过的问题，不要再问他。"));
      /* Correcting is not the same failure mode as echoing: an echo hands back
       * the student's own sentence unchanged, while a correction restates it
       * fixed, in words the student already has, and then the conversation
       * continues -- rule 5 above still applies to what comes after it. */
      rules.push(convert("如果学生的话语法或者用词不对，先用正确、简单的说法说一次你觉得他想说的意思") +
                 "（" + convert("只能用学生已经会的词，需要的话可以更简单") + "），" +
                 convert("然后再继续说下去，回答他，别只纠正不回答。"));
    }
    rules.push(convert("如果你真的需要一个学生不会的词，写") + " [[NEED:" + convert("词") +
               "|pīn yīn|english]]" + convert("，一句话最多一个。"));
    rules.push(convert("学生问「…怎么说」的时候，一定用") + " [[NEED:" + convert("词") +
               "|pīn yīn|english]] " + convert("回答，") + "\n   " +
               convert("这样他可以看到拼音和意思。不要用英文解释。"));
    rules.push(convert("只写句子本身。不要写时间（比如 [0.0:]），不要写方括号、星号或者标题。"));

    /* The activity's own rules, then its position in the story if it has one.
     * Position after the activity's own rules so it reads as the more immediate
     * instruction of the two. */
    /* Story time has three phases, and each suppresses the rules that would
     * contradict it. Rule 2 of telling is 只讲故事，不要问学生问题 stated
     * absolutely, and build() already knows what a model does with a later rule
     * contradicting an earlier absolute one: it obeys the first. So asking and
     * discussing replace those rules rather than following them.
     *
     * `discussing` fixes a defect rather than adding a feature: before it, a
     * learner answering the partner's own question was met by the telling
     * rules, which forbid talking to them. */
    var phase = opts.storyPhase || (opts.activity === "story" ? "telling" : null);
    if (phase === "asking") {
      var ladder = questionTypesFor(opts.level);
      rules.push(convert("现在问学生一个关于他刚才读的那一段的问题，一次只问一个。") +
        convert("问题要短，用简单的话。") +
        convert("可以问这样的问题：") + QUESTION_SHAPES
          .filter(function (q) { return ladder.types.indexOf(q.type) !== -1; })
          .map(function (q) { return convert(q.shape); }).join("、") + convert("。"));
    } else if (phase === "discussing") {
      rules.push(convert("学生在回答你刚才的问题。先说他答得对不对，") +
        convert("再用学生会的词把对的答案说一次。说完就停，不要再问新的问题。"));
    } else if (opts.activity === "twenty" && opts.side === "answerer") {
      rules.push(convert("学生心里想了一个东西，你负责猜。一次只问一个是非问题") +
        convert("（能用「是不是」、「对不对」、「有没有」回答的那种），") +
        convert("大概二十个问题以内猜出来，一边猜一边说这是第几个问题。"));
    } else if (opts.activity === "twenty" && opts.side === "guesser" && opts.secret) {
      var secret = convert(opts.secret);
      rules.push(convert("你心里想的是「") + secret + convert("」。学生问你是非问题，") +
        convert("只回答「是」或「不是」（可以简单地多说一点，但是不要自己说出这个东西是什么）。") +
        convert("如果学生猜对了，或者说不猜了，你才可以说出「") + secret + convert("」。"));
    } else {
      (act.rules || []).forEach(function (r) { rules.push(convert(r)); });
    }
    /* Deliberately outside the phase branch above: asking and discussing both
     * refer to the characters the story just introduced, and 「小明去了哪儿？」
     * must not fail validation for the name it is asking about. */
    if (act.names && act.names.length) {
      rules.push(convert("故事里的人可以叫") +
        act.names.map(function (e) { return "「" + convert(e.w) + "」"; }).join("") +
        convert("。别的名字不要用。"));
    }
    /* What the learner asked for. Placed before the segment's position so the
     * model reads the subject first and the position as a qualifier of it.
     * Passed through verbatim, in whatever language it was typed: a topic is
     * the learner's own words, not app-authored Chinese, so `convert` does not
     * touch it. */
    if (opts.storyTopic) {
      rules.push(convert("学生想听一个关于") + "「" + opts.storyTopic + "」" +
                 convert("的故事。"));
    }
    if (seg) {
      if (seg.index === 0) {
        rules.push(convert("这是故事的第一段。开个头，介绍一两个人和一个地方。"));
      } else if (seg.index >= seg.of - 1) {
        rules.push(convert("这是故事的最后一段。把故事讲完，给它一个结尾。"));
      } else {
        rules.push(convert("接着上面的故事往下讲，不要从头开始，也不要现在就结束。"));
      }
      rules.push(convert("这一段写大概九十个汉字。"));
    }

    if (opts.script === "trad") {
      // The one rule with no simplified counterpart: say which script to write.
      rules.push(convert("请用繁体字回答，不要用简体字。"));
    }
    /* Gradual introduction. The offer is permission, not an instruction: a word
     * forced into a conversation it does not fit reads as a vocabulary drill,
     * and the credit simply carries to the next turn instead. */
    if (opts.offer && opts.offer.length) {
      if (opts.require) {
        // No longer a suggestion: the reply is rejected without it.
        rules.push(convert("这次一定要用「") + opts.require +
                   convert("」这个词，放在一句话里。这是必须的。"));
      } else {
        rules.push(convert("学生现在可以学一个新词。这次请用下面的一个：") +
                   opts.offer.map(function (e) { return e.w; }).join("、") +
                   convert("。只用一个，放在自然的句子里；" +
                           "只有在实在放不进去的时候，才一个都不用。"));
      }
    }
    if (opts.reuse && opts.reuse.length) {
      rules.push(convert("学生最近学了这些词，请多用：") +
                 opts.reuse.map(function (e) { return e.w; }).join("、") + convert("。"));
    }

    var lines = [
      convert("你是一个中文聊天伙伴。用户是学中文的学生") + "（" + opts.label + "）。",
      "",
      convert("规则：")
    ].concat(rules.map(function (r, i) { return (i + 1) + ". " + r; }));

    lines.push(
      "",
      convert("例子："),
      convert("学生：你好！"),
      convert("你：") + convert(style.sample),
      // An exchange that answers, adds something, and asks something new.
      convert("学生：你喜欢喝茶吗？"),
      convert("你：我很喜欢。我喜欢喝水。你喜欢吃什么？"),
      convert("学生：") + "怎么说 fried egg",
      convert("你：") + "[[NEED:" + convert("煎蛋") + "|jiān dàn|fried egg]]" +
        convert("。你喜欢吃吗？")
    );
    if (opts.words) lines.push("", convert("你只可以用这些词："), opts.words);
    return lines.join("\n");
  }

  /* ------------------------------------------- translation and explanation
   *
   * Both of these point at one message and neither goes through the validator,
   * but the message can be one of two quite different things, and `own` is
   * which. The partner's reply is known-good Chinese to be taken apart. The
   * student's own line is a draft that may be wrong -- and explaining why a
   * particle is there, when it should not be there at all, teaches the mistake
   * instead of fixing it. So each has two shapes rather than one prompt hedged
   * to cover both.
   *
   * opts: { text, own, label, recent }
   */

  function translate(opts) {
    if (!opts.own) {
      return "Translate this Chinese into natural, idiomatic English. Reply with only the " +
        "translation, no quotes, no other commentary:\n\n" + opts.text;
    }
    /* Deliberately not a translation of the corrected sentence. The gap between
     * what the student meant and what they actually wrote is the whole lesson,
     * and a prompt that quietly repairs the line before translating it hides
     * exactly the thing they pressed the button to see.
     *
     * The last two sentences are load-bearing, and were added after watching a
     * live model without them: told only to translate what was written and to
     * let it read oddly, it stops translating and starts glossing word by word.
     * 我昨天去公园了 -- which is correct -- came back as "I yesterday go park
     * of". Rendering a sound sentence as broken English is worse than repairing
     * a broken one, since it invents a mistake the student did not make. */
    return "A Chinese learner wrote the line below themselves, so it may contain mistakes. " +
      "Translate the meaning it actually conveys, not a corrected version of it: where a wrong " +
      "word, particle or word order changes the meaning, translate the changed meaning rather " +
      "than the one you think was intended. Do not silently repair it.\n\n" +
      "Write ordinary fluent English even so. This is a translation, not a word-by-word gloss: " +
      "if the Chinese is in fact correct, the English must read as naturally as the Chinese " +
      "does. Only where the line is too broken to carry any meaning at all, give the most " +
      "likely intended reading.\n\n" +
      "Reply with only the translation, no quotes, no other commentary:\n\n" + opts.text;
  }

  /* The turns leading up to the sentence, as the teacher would read them.
   * Roles are spelled out rather than left as "user"/"assistant": the model is
   * being asked to take the student's side, and "Student:" says whose sentence
   * is under the microscope far more plainly than "user:" does. */
  function contextBlock(turns) {
    if (!turns || !turns.length) return "";
    var lines = turns.map(function (t) {
      return (t.role === "user" ? "Student: " : "Partner: ") + t.text;
    });
    return "The conversation so far:\n" + lines.join("\n") + "\n\n";
  }

  /* ------------------------------------------------------------- grading
   *
   * The grader runs on every sentence the student sends, so unlike explain()
   * its answer has to be machine-readable: it drives a tick or a cross on the
   * message, four category icons, and a stored record that "your top mistakes"
   * counts and any future drill select on.
   *
   * That last use is what forces a fixed taxonomy. Free-text error
   * descriptions do not aggregate -- every phrasing differs, so a top-three
   * becomes a list of one-offs and a drill has nothing to filter by. The model
   * picks a TAG from the list below and writes prose only in `note`, about
   * this one sentence.
   *
   * The tags come from corpus studies of learner Chinese rather than from
   * intuition: measure words split into missing/extra/wrong, aspect divides by
   * marker, and adverbial word order is singled out because it alone accounts
   * for over half of all word-order errors in learner writing. wrong-character
   * is here because this app can see it -- the student types pinyin and picks
   * from a candidate list, so their wrong characters are usually homophones of
   * the right one, which a handwriting app never observes.
   */
  /* One row per tag: the code the model must emit, the words the mistake list
   * shows the learner, and a worked example.
   *
   * The example is not decoration. Measured without them, the model tagged
   * 三个书 as wrong-word rather than measure-word and 他比我很高 as
   * word-order-attributive rather than comparison-bi -- it produced the right
   * correction each time and filed it under the wrong heading, which is
   * precisely the failure that makes a mistake ledger useless. A code and a
   * two-word gloss are not enough to pick between seventeen headings; a
   * wrong-to-right pair is. */
  var TAGS = [
    ["measure-word",           "measure word",             "三个书 → 三本书"],
    ["aspect-le",              "了",                        "很高兴了 → 很高兴"],
    ["aspect-guo",             "过",                        "我去过了那儿吗 → 我去过那儿吗"],
    ["aspect-zhe",             "着",                        "他站着了 → 他站着"],
    ["aspect-zai",             "在 / 正在",                 "我在吃饭了 → 我在吃饭"],
    ["negation-bu-mei",        "不 vs 没",                  "他不有钱 → 他没有钱"],
    ["de-particles",           "的 / 地 / 得",              "他说的很好 → 他说得很好"],
    ["word-order-adverbial",   "adverbial word order",      "我去商店昨天 → 我昨天去商店"],
    ["word-order-attributive", "attributive word order",    "朋友的我 → 我的朋友"],
    ["comparison-bi",          "比 comparison",             "他比我很高 → 他比我高"],
    ["ba-construction",        "把 construction",           "我把书看 → 我把书看完了"],
    ["bei-construction",       "被 construction",           "书被我看 → 书被我看完了"],
    ["connective",             "connectives",               "因为下雨，我不去 → 因为下雨，所以我不去"],
    ["wrong-word",             "wrong word",                "我看音乐 → 我听音乐"],
    ["wrong-sense",            "right word, wrong sense",   "我很开车 → 我常开车"],
    ["wrong-character",        "wrong character",           "我的马妈 → 我的妈妈"],
    ["unnatural",              "unnatural phrasing",        "给我水 → 请给我一杯水"]
  ];

  var ERROR_TAGS = TAGS.map(function (r) { return r[0]; });
  var TAG_LABEL = {};
  TAGS.forEach(function (r) { TAG_LABEL[r[0]] = r[1]; });

  /* The four categories the detail view shows as icons. Each is a different
   * repair: a wrong word is looked up, a wrong rule is learned, a wrong order
   * is a pattern, and unnatural-but-correct is a collocation. Keeping the last
   * one separate is what stops "foreign-sounding but legal" being filed as a
   * grammar error and skewing the mistake counts. */
  var GRADE_CATS = [
    { key: "word",    label: "word choice", zh: "词" },
    { key: "grammar", label: "grammar",     zh: "语法" },
    { key: "order",   label: "word order",  zh: "语序" },
    { key: "natural", label: "naturalness", zh: "地道" }
  ];

  function grade(opts) {
    var tags = TAGS.map(function (r) {
      return "  " + r[0] + "  (" + r[1] + ")  e.g. " + r[2];
    }).join("\n");
    return "You are grading one sentence written by a student of Chinese at " +
      opts.label + ".\n\n" +
      /* Same framing explain() uses and for the same measured reason: without
       * being told the sentence may be wrong, a model answers as though it
       * were and grades everything correct. */
      "The student wrote it THEMSELVES, so it may well be wrong. Do not assume it is " +
      "correct. Equally, do not manufacture a problem to have something to teach -- a " +
      "correct sentence must come back with every category true and no errors.\n\n" +
      "Two failure modes are easy to misread. The student types pinyin and picks a " +
      "character from a list, so a wrong character is usually a homophone of the right " +
      "one rather than a misunderstanding. And a sentence can break no rule and still " +
      "not be what a native speaker would say; that is the naturalness category, not " +
      "the grammar one.\n\n" +
      "Reply with only a JSON object, no prose and no code fence:\n" +
      '{"ok":true,"meant":"","better":"",' +
      '"cats":{"word":true,"grammar":true,"order":true,"natural":true},"errors":[]}\n\n' +
      "ok        — true only if you would let the sentence stand as written.\n" +
      "meant     — in English, your best guess at what they were trying to say.\n" +
      "better    — the sentence as a native speaker would write it, staying inside " +
      opts.label + " vocabulary where possible. Empty string when ok is true.\n" +
      "cats      — true means that category is fine, false means it is where the " +
      "problem is. More than one may be false.\n" +
      "errors    — one entry per distinct mistake, [] when ok is true. Each is " +
      '{"tag":"","note":""} where note is one short sentence naming the rule for this ' +
      "sentence, and tag is copied EXACTLY from the list below.\n\n" +
      /* Said because it happened: the four category keys sit a few lines above
       * in this same prompt, and the model reached for "grammar" and "natural"
       * as tags. They are not tags. */
      "The four category names are not tags. A tag is only ever one of these " +
      "seventeen codes, spelled exactly as written:\n" + tags + "\n\n" +
      "Pick the code that names the RULE that was broken, not the surface of the " +
      "edit -- a missing measure word is measure-word even though the fix inserts a " +
      "word, and a 比 sentence with 很 in it is comparison-bi even though the fix " +
      "deletes one.\n\n" +
      contextBlock(opts.context) + "The student wrote: " + opts.text;
  }

  /* Who is in this story, asked before it is written.
   *
   * Answered in the [[NEED:]] shape on purpose: extractNeeds() already parses
   * it, the app already glosses it, and needsSoFar() already carries it into
   * every later segment -- so the declared cast needs no format, no storage and
   * no lexicon plumbing of its own.
   *
   * The point is pre-teaching: the learner meets 孙悟空 with a gloss before
   * reading rather than sprung on them mid-paragraph. The carry-forward, not
   * this call, is what makes an out-of-level name possible at all. */
  function castPrompt(topic, label, max) {
    return "A student at " + label + " is about to read a short Chinese story " +
      "about: " + topic + "\n\n" +
      "Name the people or creatures the story needs, at most " + max + ", using " +
      "the Chinese names a Chinese reader would expect. Reply with nothing but " +
      "one line each in this exact form:\n" +
      "[[NEED:名字|pīn yīn|who they are in English]]\n\n" +
      "If the story needs no named character at all, reply with nothing.";
  }

  /* A title for a finished story. The derived one is the first sentence of the
   * first segment, which is unreadable in a list -- and rereading is part of
   * how this app is used, so finding a story again matters. */
  function titlePrompt(story) {
    return "Here is a short Chinese story a learner has just read:\n\n" + story +
      "\n\nGive it a title in Chinese, at most eight characters, using only " +
      "words that appear in the story. Reply with the title and nothing else.";
  }

  function explain(opts) {
    // Recently introduced words go in so the explanation can point out which
    // ones are still new, not just recite the sentence.
    var head = "You are a friendly Chinese teaching assistant helping a student " +
      (opts.own ? "who is writing" : "who is reading") + " Chinese at " + opts.label +
      ". Recently introduced words they are still practicing: " + (opts.recent || "none yet") +
      ".\n\n";
    /* "Keep it concise" on its own does not work -- models answer this in
     * decorated Markdown whether or not it is asked for, and the decoration is
     * pure output cost on the expensive side of the bill. Naming the specific
     * things not to emit cut output from 289 tokens to 154, a 47% saving, with
     * the error-catching rate unchanged at 10/10 and no faults invented in
     * correct sentences. Measured; see the commit. */
    /* Shared decoration rules only. The paragraph count belongs to each branch:
     * the two questions have different shapes, and "four numbered paragraphs"
     * was forcing the grammar check to pad a one-line answer up to four. */
    var tail = "You may reply in English and quote Chinese as needed -- you are not " +
      "restricted to the student's vocabulary here.\n\n" +
      "Formatting: plain sentences only. No headings, no bullet lists, no bold, no emoji, " +
      "and no closing encouragement.\n\n";

    if (!opts.own) {
      return head +
        "Explain the following Chinese sentence in plain English: the grammar structures used, " +
        "why each word or particle is there, and call out anything above the student's level. " +
        tail + "Four short paragraphs, numbered 1 to 4. Stop when the fourth is done.\n\n" +
        "Sentence: " + opts.text;
    }
    /* Verdict first, and only as much after it as the verdict earns.
     *
     * This used to ask for four numbered paragraphs always: what the sentence
     * says in English, whether it is correct, a correction, then the rule. Two
     * problems. The first paragraph re-translated the sentence, which is what
     * the translate button next to it already does, so every check opened with
     * the answer to a different question. And a fixed four-part shape means a
     * correct sentence still gets four paragraphs, which reads as though
     * something must be wrong with it.
     *
     * The answer wanted here is: is this good Chinese at my level? If not,
     * what should it be, and why did I get it wrong? Everything else is
     * padding on a check meant to be read in a couple of seconds. */
    /* A follow-up is a different question and must not be answered in the
     * verdict shape. The shape below is an instruction to emit one of three
     * lines and stop, and it lives in the SYSTEM message, so it stays in force
     * for every later turn of the chat -- asked "what about the 现在 and the
     * 了?", the model could only repeat "Natural." It was obeying. */
    if (opts.followUp) {
      return head +
        "The student wrote the sentence below THEMSELVES and has already been given a " +
        "verdict on it. They are now asking a follow-up question about it.\n\n" +
        "Answer their question directly, in a few sentences. Quote Chinese where it helps. " +
        "If they are asking about something you passed as correct, say plainly why it is " +
        "correct rather than only repeating the verdict -- and if they have spotted " +
        "something you missed, say so.\n\n" +
        "The student types pinyin and picks a character from a list, so a wrong character " +
        "is often a homophone of the right one rather than a misunderstanding.\n\n" +
        tail + contextBlock(opts.context) + "The sentence under discussion: " + opts.text;
    }
    return head +
      "The student wrote the sentence below THEMSELVES, so it may well be wrong. Do not assume " +
      "it is correct, and do not silently answer as if it were.\n\n" +
      "Answer in this shape and nothing else:\n" +
      /* The three verdicts are given as the literal words to emit. Described
       * rather than quoted ("say which of three it is: natural at their
       * level..."), the model echoed the description back including its
       * third person -- the learner was told "natural Chinese at their
       * level", which reads as a note written about them to someone else. */
      "Start with exactly one of these three lines, on its own:\n" +
      "Natural.\n" +
      "Understandable, but not how a native speaker would say it.\n" +
      "Not correct.\n" +
      "The middle one is for Chinese that breaks no rule but no native speaker would choose: " +
      "a calque from English, a stiff or abrupt phrasing, or a word that is technically right " +
      "and not the one used here. Judge idiom, not only grammar -- most sentences a learner " +
      "worries about are in this middle case rather than outright broken.\n" +
      "After \"Natural.\" stop immediately. Do not add a translation, do not restate the " +
      "sentence, do not offer an alternative, and do not manufacture a problem to have " +
      "something to teach.\n" +
      "Otherwise, give the corrected sentence on its own line, with no commentary attached, " +
      "staying inside the student's level where that is possible.\n" +
      "Then at most two sentences on what led them astray -- word order, a missing or wrong " +
      "particle, a measure word, aspect, or a word used in a sense it does not carry. Name the " +
      "rule rather than describing the edit, so it transfers to the next sentence.\n\n" +
      "Two failure modes are easy to misread. The student types pinyin and picks a character " +
      "from a list, so a wrong character is often a homophone of the right one rather than a " +
      "misunderstanding. And a sentence can be entirely grammatical yet blunt or unidiomatic; " +
      "that is the middle verdict, not the third one.\n\n" + tail +
      /* Context goes immediately before the sentence, not up with the level and
       * the recent words. A learner sentence is often only judgeable against
       * what it answers -- 我也是 and 很好 are correct or nonsense depending on
       * the question -- but the thing being checked is still the one line, and
       * putting the transcript last keeps it read as background rather than as
       * more material to comment on. */
      contextBlock(opts.context) + "The student wrote: " + opts.text;
  }

  var api = { LEVEL_STYLE: LEVEL_STYLE, LENGTHS: LENGTHS, STARTERS: STARTERS,
              ACTIVITIES: ACTIVITIES, activityFor: activityFor,
              STORY_NAMES: STORY_NAMES,
              GUESS_POOL: GUESS_POOL, pickSecret: pickSecret,
              AUTO_LIST_MAX_LEVEL: AUTO_LIST_MAX_LEVEL, modeFor: modeFor,
              styleFor: styleFor, startersFor: startersFor,
              storyIdeasFor: storyIdeasFor, questionTypesFor: questionTypesFor,
              QUESTION_SHAPES: QUESTION_SHAPES,
              build: build,
              translate: translate, explain: explain, grade: grade, castPrompt: castPrompt,
              titlePrompt: titlePrompt,
              ERROR_TAGS: ERROR_TAGS, TAG_LABEL: TAG_LABEL, GRADE_CATS: GRADE_CATS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKPrompt = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
