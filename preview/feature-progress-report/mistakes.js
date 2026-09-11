/* Which grammar categories the learner keeps getting wrong, and how close they
 * are to being drilled away.
 *
 * Two rules, both from the spaced-practice literature (RESEARCH.md, "Drilling
 * a mistake category"):
 *
 *   - a failure counts only while it is recent, so improving without drilling
 *     still makes the number fall;
 *   - a drill pass subtracts, but at most one a day, because a drill session is
 *     massed practice by construction and massed practice is what loses.
 *
 * Derived by scanning the graded messages, never stored. A running tally kept
 * beside them would be a second source of truth to drift -- the same reasoning
 * that kept the original count in index.html a scan.
 *
 * Loadable in the browser (window.HSKMistakes) and in node (module.exports).
 */
(function (root) {
  "use strict";

  var WINDOW_DAYS = 90;      // how long a mistake stays on the books
  var RECENT_SHOWN = 3;      // examples of a category offered as drill targets
  var DAY = 86400000;

  /* UTC, not local. Two devices in two timezones have to agree on whether a
   * pass fell on the same day as another, and the stored timestamp is already
   * UTC ISO. Local dates would let a flight change a learner's numbers. */
  function dayKey(iso) { return String(iso || "").slice(0, 10); }

  /* The category this conversation drills, or "" for an ordinary chat. Stored
   * as a pseudo-message the way story time stores its topic, so it needs no
   * column of its own and syncs with the transcript. */
  function drillTagOf(msgs) {
    for (var i = 0; i < (msgs || []).length; i++) {
      if (msgs[i] && msgs[i].role === "drill") return msgs[i].text || "";
    }
    return "";
  }

  /* The one corrected sentence this drill is working on, chosen from the
   * learner's own recent mistakes in the category. A second marker rather than
   * a second field on the first: `messages.text` is the only string column that
   * syncs, and stuffing two values into it would need a delimiter to decode. */
  function drillExampleOf(msgs) {
    for (var i = 0; i < (msgs || []).length; i++) {
      if (msgs[i] && msgs[i].role === "drillEg") return msgs[i].text || "";
    }
    return "";
  }

  /* The one WORD this drill is working on, "" for a drill on the category
   * alone. A third marker for the same reason there is a second: `messages.text`
   * is the only string column that syncs, so two values in one need a delimiter
   * to decode. Written by the chooser from the `word` the grader's extraction
   * put on the error entry. */
  function drillWordOf(msgs) {
    for (var i = 0; i < (msgs || []).length; i++) {
      if (msgs[i] && msgs[i].role === "drillWord") return msgs[i].text || "";
    }
    return "";
  }

  /* Did this sentence earn a credit for the category being drilled?
   *
   * The grader answers about the drilled structure specifically (`target`), so
   * a sentence that uses it correctly counts even when something else in the
   * sentence is wrong -- drilling 就 and slipping on 了 is progress on 就. The
   * other error still counts as a failure under its own tag, so nothing is
   * forgiven, only attributed.
   *
   * `used` is what stops a dodge scoring: a simple correct sentence that never
   * reaches for the structure is not evidence about it.
   *
   * No verdict is asked for -- or possible -- when the tag names a class of
   * error rather than a structure (prompt.js ERROR_CLASS_TAGS: wrong word,
   * wrong sense, wrong character, unnatural). "Did you attempt a homophone
   * mistake" has no useful answer; the drill for those is to write sentences
   * WITHOUT that error, which the grader's own tags already report. So the
   * fallback is the absence of that tag, which is the same partial-credit
   * principle read the other way round: judged on the thing being drilled and
   * not on the whole sentence.
   *
   * The fallback also covers messages graded before `target` existed, and the
   * rare case of the check itself failing.
   *
   * ponytail: for those four tags a very short safe sentence earns credit as
   * easily as a real attempt. The per-day cap bounds what that can do to the
   * ledger; if it becomes a way to feel productive without practising, the
   * answer is a minimum-effort check, not a stricter rule here. */
  function credited(grade, tag, errorClassTags, word) {
    if (!grade || grade.unreadable) return false;
    /* A word drill is judged on the word, whatever its tag. The error-class
     * exemption below exists because those four tags name no structure to ask
     * about -- 用词 scored 1/3 and 同音字 0/3 -- but 行 is a structure to ask
     * about, and the same question scores 37/39 (RESEARCH.md, "Drilling a word
     * rather than a category"). So a stored verdict is meaningful here and the
     * exemption does not apply. Falling back to tag absence when no verdict was
     * stored still covers a failed check and a transcript written before the
     * word existed. */
    var errorClass = !word && (errorClassTags || []).indexOf(tag) !== -1;
    var t = grade.target;
    /* Skipped for an error-class tag even when one is stored. The first release
     * asked the question for those tags too, so transcripts already carry
     * verdicts that were meaningless when written; consulting them would leave
     * a correct sentence uncredited forever. Which list this is comes from the
     * caller, the same way tagLabels does -- this file stays free of prompt.js. */
    if (!errorClass && t && typeof t === "object") {
      return t.used === true && t.ok === true;
    }
    return !(grade.errors || []).some(function (e) { return e && e.tag === tag; });
  }

  /* The verdict on ONE ghost word in one sentence, in three values rather than
   * two.
   *
   * "none" and "wrong" have to be told apart because they do different things
   * to progress: a sentence that never reached for the word says nothing, while
   * one that reached for it and missed costs a day-credit. A boolean collapses
   * those, and collapsing them is what made ghost progress a ratchet that only
   * ever clicked forward.
   *
   * The fallback to grade.ok is what keeps every message written before this
   * feature -- and every message written outside the Ghost Words activity,
   * where no verdict is asked for -- counting exactly as it did. It is the
   * STRICTER of the two rules: the whole sentence has to be clean. It can never
   * return "wrong", because grade.ok === false says something in the sentence
   * was wrong and never that THIS word was, so a failed check and a legacy
   * transcript can demote nothing. */
  function ghostVerdict(grade, word) {
    if (!grade || grade.unreadable) return "none";
    var v = grade.ghost && grade.ghost[word];
    if (v && typeof v === "object") {
      if (v.used !== true) return "none";
      return v.ok === true ? "ok" : "wrong";
    }
    return grade.ok === true ? "ok" : "none";
  }

  /* How far along each word is, walked in timestamp order.
   *
   * At most one credit per word per calendar day -- the same rule and the same
   * dayKey() the drill already uses, for the reason RESEARCH.md gives there:
   * massed practice is what loses, so session length must not be able to move
   * the number. Within a day, write the word as often as you like; it is the
   * across-day interval that predicts whether the word is still there next
   * week.
   *
   * A credited day stays credited after a demotion, so failing and then
   * succeeding again the same day does not re-earn the day. That closes the
   * only same-day loop the rule has.
   *
   * At most one DEMOTION a day too, for the same reason and to keep the two
   * directions symmetric. Uncapped, three wrong uses in one afternoon undo
   * three days of work while the best possible day gives one back -- which is
   * the reset-to-zero rule RESEARCH.md rejects, reached by another road. The
   * learner who writes a word wrong three times running is the one the
   * activity exists for.
   *
   * Every word in one pass, not one pass per word: the per-word version is
   * O(words x messages) and both of those grow with use. `wordsOf` is a
   * callback because segmentation needs the live lexicon, which is index.html's
   * business -- the same split needsMigration() already uses.
   *
   * Derived by scanning, never stored, like every other count in this file. */
  function ghostProgress(turns, wordsOf) {
    var rows = (turns || []).slice().sort(function (a, b) {
      var x = String((a && a.created_at) || ""), y = String((b && b.created_at) || "");
      return x < y ? -1 : x > y ? 1 : 0;
    });
    var out = {}, credited = {}, demoted = {};
    function slot(w) {
      if (!out[w]) { out[w] = { n: 0, last: "" }; credited[w] = {}; demoted[w] = {}; }
      return out[w];
    }
    rows.forEach(function (t) {
      var day = dayKey(t && t.created_at);
      var seen = {};
      (wordsOf(t) || []).forEach(function (w) {
        if (seen[w]) return;            // one message credits a word once
        seen[w] = true;
        var v = ghostVerdict(t && t.grade, w);
        if (v === "ok") {
          var s = slot(w);
          if (!credited[w][day]) { credited[w][day] = true; s.n++; s.last = day; }
        } else if (v === "wrong") {
          var f = slot(w);
          if (!demoted[w][day]) { demoted[w][day] = true; f.n = Math.max(0, f.n - 1); }
        }
      });
    });
    return out;
  }

  /* How much of the history predates the current grader, counted in two kinds
   * of work because they cost two very different amounts.
   *
   *   grades  a user message never graded at all -- the app ran without a
   *           grader before it had one, and those turns carry no verdict.
   *   words   a message graded before the word extraction existed, whose
   *           error-class errors therefore name a category and nothing to
   *           drill. Only the cheap extraction call is needed; the grade
   *           itself stands, so nothing the learner has already seen changes.
   *
   * Derived by scanning, like everything else here, and deliberately not a
   * stored "migrated to v92" flag. A flag is a second source of truth to drift,
   * and this way the job resumes for free: a message that has been done no
   * longer matches, so pressing the button again continues rather than
   * restarts.
   *
   * `better` is required for the word half because the extraction compares the
   * two sentences to find the word. An error with no correction beside it has
   * nothing to extract from and is not counted as work. */
  function needsMigration(chatMsgs, errorClassTags) {
    var classTags = errorClassTags || [];
    var out = { grades: 0, words: 0 };
    Object.keys(chatMsgs || {}).forEach(function (cid) {
      (chatMsgs[cid] || []).forEach(function (t) {
        if (!t || t.role !== "user") return;
        if (!t.grade) { out.grades++; return; }
        if (t.grade.unreadable || !t.grade.better) return;
        var any = (t.grade.errors || []).some(function (e) {
          return e && !e.word && classTags.indexOf(e.tag) !== -1;
        });
        if (any) out.words++;
      });
    });
    return out;
  }

  function counts(chatMsgs, opts) {
    opts = opts || {};
    var labels = opts.tagLabels || {};
    var errorClassTags = opts.errorClassTags || [];
    var now = opts.now || Date.now();
    var cutoff = now - (opts.windowDays || WINDOW_DAYS) * DAY;
    var byTag = {};
    var creditDays = {};

    function slot(tag) {
      if (!byTag[tag]) {
        byTag[tag] = { tag: tag, n: 0, failures: 0, credits: 0,
                       eg: "", better: "", note: "", recent: [], words: [] };
      }
      return byTag[tag];
    }

    /* One sub-slot per word the grader named under a tag. Only errors that
     * carry a `word` get one: the extraction can honestly answer "no single
     * word" (RESEARCH.md, 6/6 on the fixtures where that is the truth), and a
     * tag whose errors are all like that keeps working exactly as it did. */
    var byWord = {};
    function wordSlot(tag, word) {
      var k = tag + "\u0000" + word;
      if (!byWord[k]) {
        byWord[k] = { tag: tag, word: word, n: 0, failures: 0, credits: 0,
                      eg: "", better: "", note: "", recent: [] };
      }
      return byWord[k];
    }

    Object.keys(chatMsgs || {}).forEach(function (cid) {
      var msgs = chatMsgs[cid] || [];
      var drill = drillTagOf(msgs);
      var drillWord = drillWordOf(msgs);
      msgs.forEach(function (t) {
        if (!t || t.role !== "user" || !t.grade) return;
        var when = Date.parse(t.created_at || "");
        /* NaN fails this comparison, so an unparseable timestamp is excluded
         * rather than counted as epoch-zero and silently aged out. */
        var recent = when >= cutoff;

        (t.grade.errors || []).forEach(function (e) {
          if (!e || !labels[e.tag] || !recent) return;
          var s = slot(e.tag);
          s.failures++;
          if (e.word) {
            var ws = wordSlot(e.tag, e.word);
            ws.failures++;
            ws.recent.push({ eg: t.text || "", better: t.grade.better || "",
                             note: e.note || "", at: when });
          }
          /* Kept as a list, not just the latest: the drill asks the learner to
           * choose WHICH mistake to work on, and one is not a choice. Sorted
           * and trimmed after the scan, below -- by date, never by whichever
           * conversation Object.keys happened to yield last. */
          s.recent.push({ eg: t.text || "", better: t.grade.better || "",
                          note: e.note || "", at: when });
        });

        /* Credit lands on the word when one is being drilled, and on the tag
         * otherwise. Per word rather than per tag because the daily cap encodes
         * spacing for the thing being practised, and drilling 行 today and 认识
         * today are two practices, not one massed session on "word choice".
         * Each word still needs its own distinct days. */
        if (drill && labels[drill] && credited(t.grade, drill, errorClassTags, drillWord)) {
          var key = drillWord ? drill + "\u0000" + drillWord : drill;
          if (!creditDays[key]) creditDays[key] = {};
          creditDays[key][dayKey(t.created_at)] = true;
        }
      });
    });

    Object.keys(creditDays).forEach(function (key) {
      var days = Object.keys(creditDays[key]).length;
      /* `+=` on both, never `=`. A tag can be credited twice over -- once by a
       * drill on the category alone and once through a word under it -- and
       * Object.keys yields those two keys in no guaranteed order, so an
       * assignment would silently drop whichever landed first. */
      if (byTag[key]) byTag[key].credits += days;
      if (byWord[key]) byWord[key].credits += days;
      /* A word drill also credits its tag: the learner practised a 用词 mistake,
       * and the category count is the sum of what is still outstanding under
       * it. Without this the tag total could never fall from a word drill. */
      var tag = key.split("\u0000")[0];
      if (byWord[key] && byTag[tag]) byTag[tag].credits += days;
    });

    /* Attach each word to its tag. Sorted by RECENCY, not by count: a category
     * accumulates over 90 days but a word does not, so the counts here are 1s
     * and 2s and ranking on them barely discriminates. The most recent mistake
     * is the one the learner remembers making. */
    Object.keys(byWord).forEach(function (k) {
      var w = byWord[k];
      w.n = Math.max(0, w.failures - w.credits);
      w.recent.sort(function (a, b) { return b.at - a.at; });
      w.at = w.recent.length ? w.recent[0].at : 0;
      w.recent = w.recent.slice(0, RECENT_SHOWN);
      if (w.recent.length) {
        w.eg = w.recent[0].eg; w.better = w.recent[0].better; w.note = w.recent[0].note;
      }
      if (byTag[w.tag]) byTag[w.tag].words.push(w);
    });
    Object.keys(byTag).forEach(function (tag) {
      byTag[tag].words.sort(function (a, b) { return b.at - a.at; });
    });

    return Object.keys(byTag).map(function (tag) {
      var s = byTag[tag];
      s.n = Math.max(0, s.failures - s.credits);
      s.recent.sort(function (a, b) { return b.at - a.at; });
      s.recent = s.recent.slice(0, RECENT_SHOWN);
      /* The head of the list under its old name, so Settings and every other
       * caller that wants one example keeps working unchanged. */
      if (s.recent.length) {
        s.eg = s.recent[0].eg;
        s.better = s.recent[0].better;
        s.note = s.recent[0].note;
      }
      return s;
    }).sort(function (a, b) {
      return b.n - a.n || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
    });
  }

  var api = { counts: counts, credited: credited,
              needsMigration: needsMigration,
              ghostVerdict: ghostVerdict, ghostProgress: ghostProgress,
              dayKey: dayKey,
              drillTagOf: drillTagOf, drillExampleOf: drillExampleOf,
              drillWordOf: drillWordOf,
              WINDOW_DAYS: WINDOW_DAYS, RECENT_SHOWN: RECENT_SHOWN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKMistakes = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
