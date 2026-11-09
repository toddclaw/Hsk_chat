/* Pinyin: tone-marked, unspaced pinyin into syllables and tones.
 *
 * `wǒmen` is one string, one tone mark and two syllables, so splitting is a
 * search over the finite set of legal syllables, not a regex. The rule that
 * makes it decidable is the apostrophe convention: a syllable opening on a, o
 * or e mid-word is written after an apostrophe, so its absence means the
 * boundary is elsewhere (fāngàn is fān|gàn, never fāng|àn).
 *
 * It never guesses. A string with no parse, or with two, returns null, and a
 * caller excludes that word rather than quiz the learner against a wrong key.
 *
 * Pure: no DOM, no state, no network. Loads in node for tests and as
 * window.HSKPinyin in the browser.
 */
(function (root) {
  "use strict";

  var SYLLABLES = (
    "a o e ai ei ao ou an en ang eng er " +
    "yi ya yo ye yao you yan yin yang ying yong " +
    "wu wa wo wai wei wan wen wang weng yu yue yuan yun " +
    "ba bo bai bei bao ban ben bang beng bi bie biao bian bin bing bu " +
    "pa po pai pei pao pou pan pen pang peng pi pie piao pian pin ping pu " +
    "ma mo me mai mei mao mou man men mang meng mi mie miao miu mian min ming mu " +
    "fa fo fei fou fan fen fang feng fu " +
    "da de dai dei dao dou dan den dang deng dong di dia die diao diu dian ding " +
    "du duo dui duan dun " +
    "ta te tai tao tou tan tang teng tong ti tie tiao tian ting tu tuo tui tuan tun " +
    "na ne nai nei nao nou nan nen nang neng nong ni nie niao niu nian nin niang " +
    "ning nu nuo nuan nü nüe " +
    "la lo le lai lei lao lou lan lang leng long li lia lie liao liu lian lin " +
    "liang ling lu luo luan lun lü lüe " +
    "ga ge gai gei gao gou gan gen gang geng gong gu gua guo guai gui guan gun guang " +
    "ka ke kai kei kao kou kan ken kang keng kong ku kua kuo kuai kui kuan kun kuang " +
    "ha he hai hei hao hou han hen hang heng hong hu hua huo huai hui huan hun huang " +
    "ji jia jie jiao jiu jian jin jiang jing jiong ju jue juan jun " +
    "qi qia qie qiao qiu qian qin qiang qing qiong qu que quan qun " +
    "xi xia xie xiao xiu xian xin xiang xing xiong xu xue xuan xun " +
    "zha zhe zhi zhai zhei zhao zhou zhan zhen zhang zheng zhong " +
    "zhu zhua zhuo zhuai zhui zhuan zhun zhuang " +
    "cha che chi chai chao chou chan chen chang cheng chong " +
    "chu chua chuo chuai chui chuan chun chuang " +
    "sha she shi shai shei shao shou shan shen shang sheng " +
    "shu shua shuo shuai shui shuan shun shuang " +
    "re ri rao rou ran ren rang reng rong ru rua ruo rui ruan run " +
    "za ze zi zai zei zao zou zan zen zang zeng zong zu zuo zui zuan zun " +
    "ca ce ci cai cao cou can cen cang ceng cong cu cuo cui cuan cun " +
    "sa se si sai sao sou san sen sang seng song su suo sui suan sun"
  ).split(" ");
  var LEGAL = {};
  for (var i = 0; i < SYLLABLES.length; i++) LEGAL[SYLLABLES[i]] = true;

  // NFD combining marks: macron, acute, caron, grave. The diaeresis (U+0308)
  // is not a tone; it folds back into ü.
  var TONE = { "̄": 1, "́": 2, "̌": 3, "̀": 4 };
  var SEP = /^[\s'’\-·]$/;

  // One unit per base letter: {ch: lowercase base for matching, raw: the
  // original text, tone}. A separator is a unit with sep: true.
  function units(p) {
    var s = p.normalize("NFD"), out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (TONE[c] || c === "̈") {
        var u = out[out.length - 1];
        if (!u || u.sep) return null;
        u.raw += c;
        if (c === "̈") {
          if (u.ch !== "u") return null;
          u.ch = "ü";
        } else {
          if (u.tone) return null;
          u.tone = TONE[c];
        }
      } else if (SEP.test(c)) {
        out.push({ sep: true });
      } else {
        var l = c.toLowerCase();
        if (l < "a" || l > "z") return null;
        out.push({ ch: l, raw: c, tone: 0 });
      }
    }
    return out;
  }

  // Every parse of a run of letters (no separators), up to two — two is
  // enough to know it is ambiguous.
  function parses(run) {
    var found = [];
    (function walk(at, acc) {
      if (found.length > 1) return;
      if (at === run.length) { found.push(acc.slice()); return; }
      var key = "";
      for (var j = at; j < run.length && j - at < 6; j++) {
        key += run[j].ch;
        if (!LEGAL[key]) continue;
        // a/o/e mid-word needs an apostrophe, so without one it is no boundary
        if (at > 0 && /^[aoe]/.test(key)) continue;
        acc.push([at, j + 1]);
        walk(j + 1, acc);
        acc.pop();
        // erhua: a trailing r that opens no syllable rides the one before it
        if (!LEGAL[key + "r"] && j + 1 < run.length && run[j + 1].ch === "r" &&
            (j + 2 === run.length || !/[aeiou]/.test(run[j + 2].ch))) {
          acc.push([at, j + 2]);
          walk(j + 2, acc);
          acc.pop();
        }
      }
    })(0, []);
    return found;
  }

  function syllables(p) {
    if (typeof p !== "string" || !p) return null;
    var us = units(p);
    if (!us) return null;
    var out = [], run = [];
    us.push({ sep: true });
    for (var i = 0; i < us.length; i++) {
      if (!us[i].sep) { run.push(us[i]); continue; }
      if (!run.length) continue;
      var ps = parses(run);
      if (ps.length !== 1) return null;
      for (var k = 0; k < ps[0].length; k++) {
        var part = run.slice(ps[0][k][0], ps[0][k][1]), raw = "", tone = 0;
        for (var m = 0; m < part.length; m++) {
          raw += part[m].raw;
          if (part[m].tone) {
            if (tone) return null;          // two marks on one syllable
            tone = part[m].tone;
          }
        }
        out.push({ text: raw.normalize("NFC"), tone: tone });
      }
      run = [];
    }
    return out.length ? out : null;
  }

  function split(p) {
    var s = syllables(p);
    return s && s.map(function (x) { return x.text; });
  }

  function tones(p) {
    var s = syllables(p);
    return s && s.map(function (x) { return x.tone; });
  }

  var MARK = { 1: "\u0304", 2: "\u0301", 3: "\u030C", 4: "\u0300" };

  // One Han character per tone, or null. An erhua 儿 has no syllable of its own.
  function chars(tones, w) {
    var c = Array.from(w).filter(function (x) { return /\p{Script=Han}/u.test(x); });
    if (c.length !== tones.length) c = c.filter(function (x) { return x !== "\u513F"; });
    return c.length === tones.length ? c : null;
  }

  // The tones as said. Without w only the third-tone rule can apply, since 不
  // and 一 are told apart by character, not by tone. Null means do not quiz it:
  // three thirds in a row depend on phrasing, so there is no rule to teach.
  // A neutral next syllable shifts nothing. 一一 stays yīyī: it is a repetition.
  function sandhi(tones, w) {
    for (var i = 0; i + 2 < tones.length; i++) {
      if (tones[i] === 3 && tones[i + 1] === 3 && tones[i + 2] === 3) return null;
    }
    var c = w ? chars(tones, w) : [];
    if (!c) return null;
    return tones.map(function (t, i) {
      var next = tones[i + 1];
      if (t === 3 && next === 3) return 2;
      if (c[i] === "\u4E0D" && t === 4 && next === 4) return 2;
      if (c[i] === "\u4E00" && t === 1 && next && c[i + 1] !== "\u4E00") return next === 4 ? 2 : 4;
      return t;
    });
  }

  // The tones as a dictionary would give them syllable by syllable. The wordlists
  // already store 不 and 一 as spoken (búyào), so this is the way back. A neutral
  // 不, as in 对不起, really is neutral.
  function citation(tones, w) {
    var c = chars(tones, w);
    return c && tones.map(function (t, i) {
      if (!t) return t;
      return c[i] === "\u4E0D" ? 4 : c[i] === "\u4E00" ? 1 : t;
    });
  }

  // One marked syllable, with its mark swapped for tone t (1-4).
  function retone(syl, t) {
    return syl.normalize("NFD").replace(/[\u0304\u0301\u030C\u0300]/, MARK[t]).normalize("NFC");
  }

  var api = { split: split, tones: tones, sandhi: sandhi, citation: citation,
              retone: retone, SYLLABLES: SYLLABLES };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKPinyin = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
