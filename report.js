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

  /* Which moment the report's "since you last checked" section counts from.
   *
   * The baseline is the last report, unless too little has happened since for
   * that to say anything -- in which case the report widens to WINDOW_DAYS and
   * says so. The floor is a COUNT of graded messages rather than a span of
   * time on purpose: three days away from the app and three days of hard
   * practice are not the same event, and a clock cannot tell them apart.
   *
   * A learner with no previous report is not falling back. Their first report
   * covers everything, which is exactly right. */
  function baselineFor(chatMsgs, lastAt, now) {
    if (!lastAt) return { since: null, fellBack: false };
    if (gradedTurns(chatMsgs, lastAt).length >= FLOOR) {
      return { since: lastAt, fellBack: false };
    }
    return {
      since: new Date((now || Date.now()) - WINDOW_DAYS * 86400000).toISOString(),
      fellBack: true
    };
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

  /* The learner's own sentences, chosen BY the numbers rather than by the model.
   *
   * A report that says "your 了 sentences are landing now" is worth reading;
   * the same report without an example is a horoscope. But letting the model
   * pick its own evidence out of a transcript is how a report starts quoting
   * sentences that prove nothing -- so the choosing happens here, in code, and
   * the model receives a fixed, small set.
   *
   * These are the learner's OWN words. A sentence they wrote may contain words
   * above their level and will be shown as written: the out-of-level guarantee
   * is about what the partner GENERATES, and this is neither generated nor the
   * partner's. */
  function pickSamples(turns, tags) {
    var list = (turns || []).slice().reverse();   // newest first
    var out = [], seen = {};

    function take(t, tag) {
      if (!t || seen[t.text]) return;
      seen[t.text] = true;
      out.push({ text: t.text, ok: t.grade.ok === true, tag: tag || "" });
    }

    // The win: the most recent sentence the grader passed whole.
    take(list.filter(function (t) { return t.grade.ok === true; })[0], "");

    // The focus: the most recent sentence in each category they miss most.
    (tags || []).forEach(function (s) {
      if (out.length >= SAMPLES) return;
      take(list.filter(function (t) {
        return (t.grade.errors || []).some(function (e) {
          return e && e.tag === s.tag;
        });
      })[0], s.tag);
    });

    // Whatever is left over, newest first, so a quiet history still shows something.
    list.forEach(function (t) { if (out.length < SAMPLES) take(t, ""); });

    return out.slice(0, SAMPLES);
  }

  /* One line of Chinese, composed rather than generated.
   *
   * Every word below is HSK 1, so the line is legal at every level the app
   * offers and needs no validator at runtime, no repair loop, no fallback, and
   * no second model call. report.test.js checks the claim against the real HSK 1
   * allowlist, which is the only thing standing between a future edit and a
   * line that breaks the app's one guarantee.
   *
   * Digits rather than Chinese numerals: 一..十 would need their own
   * spelling-out code for 12, and the learner reads digits fluently from the
   * first day.
   *
   * Chosen by what the learner actually did, so it is feedback and not
   * decoration -- the most specific true thing first. */
  function chineseLine(b) {
    b = b || {};
    var ghost = (b.ghost && b.ghost.retired) || 0;
    var clean = (b.messages && b.messages.clean) || 0;
    var minutes = b.minutes || 0;

    if (ghost > 0) return "你学了 " + ghost + " 个新的字。很好！";
    if (clean > 0) return "你说对了 " + clean + " 个。很好！";
    if (minutes > 0) return "你今天学中文了。很好！";
    return "我们学中文吧！";
  }

  var api = { gradedTurns: gradedTurns, brief: brief,
              baselineFor: baselineFor, pickSamples: pickSamples, chineseLine: chineseLine,
              FLOOR: FLOOR, WINDOW_DAYS: WINDOW_DAYS, SAMPLES: SAMPLES,
              ACTIVITY_IDS: ACTIVITY_IDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
