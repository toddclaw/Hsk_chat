/* What the learner has actually done, reduced to something a model can read.
 *
 * Everything here is derived by scanning and never stored, like mistakes.js.
 * The app is already full of GAUGES -- coverage bars, the mistake ledger, the
 * not-yet-yours row -- so the job of this module is not to produce another
 * number. It is to produce a small, complete, honest object, so the prose
 * written from it can be specific without being invented.
 *
 * No DOM. Segmentation and the live lexicon are index.html's business; what
 * arrives here is already counted. */
(function (root) {
  "use strict";

  /* New graded messages needed before "since you last checked" can say anything.
   * Ten is roughly one sitting, which is the smallest unit about which anything
   * true can be said. Below it the report widens rather than showing an empty
   * delta -- see WINDOW_DAYS. */
  var FLOOR = 10;

  /* What the report covers when FLOOR is not met. Two weeks of ordinary use:
   * long enough that the fallback is never empty, short enough to still be
   * recent. */
  var WINDOW_DAYS = 14;

  /* Sentences quoted back at the learner. Three is enough to show evidence
   * without the prompt turning into a transcript -- and the cap is the whole
   * reason prompt size does not grow with history. */
  var SAMPLES = 3;

  /* Every activity, always, so the brief can carry an explicit zero for the
   * ones untouched. Kept in step with prompt.js ACTIVITIES by report.test.js. */
  var ACTIVITY_IDS = ["chat", "focused", "drill", "story", "twenty"];

  var TAGS_SHOWN = 3;

  /* Graded user messages across every conversation, oldest first.
   *
   * Ungraded messages contribute nothing: the grader being off, or a message
   * still in flight, is not evidence about the learner either way. Same rule
   * mistakes.js applies, for the same reason. */
  function gradedTurns(chatMsgs, since) {
    var out = [];
    Object.keys(chatMsgs || {}).forEach(function (cid) {
      (chatMsgs[cid] || []).forEach(function (t) {
        if (!t || t.role !== "user" || !t.grade) return;
        if (since && String(t.created_at || "") < since) return;
        out.push(t);
      });
    });
    return out.sort(function (a, b) {
      var x = String(a.created_at || ""), y = String(b.created_at || "");
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }

  function brief(input) {
    input = input || {};
    var since = input.since || null;
    var turns = gradedTurns(input.chatMsgs, since);

    var clean = 0;
    turns.forEach(function (t) { if (t.grade && t.grade.ok === true) clean++; });

    var activities = {};
    ACTIVITY_IDS.forEach(function (id) { activities[id] = 0; });
    (input.chats || []).forEach(function (c) {
      var id = (c && c.activity) || "chat";
      if (activities[id] === undefined) return;   // an id we do not know is not invented
      activities[id]++;
    });

    var ghost = { credits: 0, retired: 0, working: 0 };
    var need = input.ghostUses || 0;
    Object.keys(input.ghost || {}).forEach(function (w) {
      var n = (input.ghost[w] && input.ghost[w].n) || 0;
      ghost.credits += n;
      if (need && n >= need) ghost.retired++;
      else if (n > 0) ghost.working++;
    });

    /* Only the fields the prompt actually uses. `note` is the grader talking to
     * the learner about one sentence; passing it on invites the report to
     * repeat advice it has no basis to repeat. */
    var tags = (input.tags || []).slice(0, TAGS_SHOWN).map(function (s) {
      return { tag: s.tag, n: s.n, eg: s.eg, better: s.better };
    });

    return {
      since: since,
      level: input.level || 1,
      goalLevel: input.goalLevel || 1,
      coverage: input.coverage || { read: 0, use: 0 },
      minutes: input.minutes || 0,
      messages: { graded: turns.length, clean: clean },
      /* Deliberately NOT cut by `since`: a word the app taught six months ago is
       * still a word it taught. Filtering it would make the since-brief claim
       * the learner had un-met words. */
      words: { met: (input.learning || []).length },
      ghost: ghost,
      tags: tags,
      activities: activities
    };
  }

  var api = { gradedTurns: gradedTurns, brief: brief,
              FLOOR: FLOOR, WINDOW_DAYS: WINDOW_DAYS, SAMPLES: SAMPLES,
              ACTIVITY_IDS: ACTIVITY_IDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
