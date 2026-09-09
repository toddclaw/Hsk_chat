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
   * Messages graded before `target` existed fall back to the whole-sentence
   * verdict, so credits already earned do not vanish on upgrade. */
  function credited(grade) {
    if (!grade) return false;
    var t = grade.target;
    if (t && typeof t === "object") return t.used === true && t.ok === true;
    return grade.ok === true;
  }

  function counts(chatMsgs, opts) {
    opts = opts || {};
    var labels = opts.tagLabels || {};
    var now = opts.now || Date.now();
    var cutoff = now - (opts.windowDays || WINDOW_DAYS) * DAY;
    var byTag = {};
    var creditDays = {};

    function slot(tag) {
      if (!byTag[tag]) {
        byTag[tag] = { tag: tag, n: 0, failures: 0, credits: 0,
                       eg: "", better: "", note: "", recent: [] };
      }
      return byTag[tag];
    }

    Object.keys(chatMsgs || {}).forEach(function (cid) {
      var msgs = chatMsgs[cid] || [];
      var drill = drillTagOf(msgs);
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
          /* Kept as a list, not just the latest: the drill asks the learner to
           * choose WHICH mistake to work on, and one is not a choice. Sorted
           * and trimmed after the scan, below -- by date, never by whichever
           * conversation Object.keys happened to yield last. */
          s.recent.push({ eg: t.text || "", better: t.grade.better || "",
                          note: e.note || "", at: when });
        });

        if (drill && labels[drill] && credited(t.grade)) {
          if (!creditDays[drill]) creditDays[drill] = {};
          creditDays[drill][dayKey(t.created_at)] = true;
        }
      });
    });

    Object.keys(creditDays).forEach(function (tag) {
      if (byTag[tag]) byTag[tag].credits = Object.keys(creditDays[tag]).length;
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
              drillTagOf: drillTagOf, drillExampleOf: drillExampleOf,
              WINDOW_DAYS: WINDOW_DAYS, RECENT_SHOWN: RECENT_SHOWN };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKMistakes = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
