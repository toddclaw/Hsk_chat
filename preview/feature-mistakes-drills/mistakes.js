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
                       eg: "", better: "", note: "", at: -Infinity };
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
          /* The most recent instance is the one worth showing back, by date --
           * not by whichever conversation Object.keys happened to yield last. */
          if (when >= s.at) {
            s.at = when;
            s.eg = t.text || "";
            s.better = t.grade.better || "";
            s.note = e.note || "";
          }
        });

        if (drill && labels[drill] && t.grade.ok) {
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
      delete s.at;
      return s;
    }).sort(function (a, b) {
      return b.n - a.n || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
    });
  }

  var api = { counts: counts, drillTagOf: drillTagOf, WINDOW_DAYS: WINDOW_DAYS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKMistakes = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
