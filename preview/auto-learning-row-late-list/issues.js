(function (root) {
  "use strict";
  
  /* index.html declares VERSION with const, which never lands on window, and
   * this file loads before that script runs -- latching it at load time put
   * "undefined" in the one field a bug report most needs. Read it at call
   * time from the global lexical scope the two scripts share. */
  function appVersion() {
    return typeof VERSION !== "undefined" ? VERSION : "unknown";
  }
  
  function smartSample(items, key, minutes) {
    if (!items || !items.length) return [];
    var now = Date.now();
    var twoMin = 2 * 60 * 1000;
    var recent = [];
    
    var mostRecent = null;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!mostRecent || new Date(item.created_at) > new Date(mostRecent.created_at)) {
        mostRecent = item;
      }
      var itemTime = new Date(item.created_at).getTime();
      if (now - itemTime <= minutes * 60 * 1000) {
        recent.push(item);
      }
    }
    
    var seen = {};
    recent.forEach(function(r) { seen[r.created_at] = true; });
    if (mostRecent && !seen[mostRecent.created_at]) {
      recent.push(mostRecent);
    }
    
    /* The whole turn, not a projection: the formatter needs translation,
     * explainChat and grade, and dropping them is what made every preview of a
     * translated chat throw. */
    return recent;
  }
  
  function captureContext(options) {
    options = options || {};
    
    var context = {
      version: appVersion(),
      browser: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      language: typeof navigator !== "undefined" ? navigator.language : "unknown",
      platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
      isPWA: typeof window !== "undefined" && window.matchMedia && window.matchMedia('(display-mode: standalone)').matches,
      
      level: (typeof S !== "undefined" ? S.level : null) || options.level,
      activity: (typeof S !== "undefined" ? S.activity : null) || options.activity,
      model: (typeof S !== "undefined" ? S.model : null) || options.model,
      teachModel: (typeof S !== "undefined" ? S.teachModel : null) || options.teachModel,
      storyModel: (typeof S !== "undefined" ? S.storyModel : null) || options.storyModel,
      script: (typeof S !== "undefined" ? S.script : null) || options.script,
      pinyin: (typeof S !== "undefined" ? S.pinyin : null) || options.pinyin,
      syncEnabled: (typeof S !== "undefined" ? S.sync : null) || options.sync,
      
      conversationCount: (typeof S !== "undefined" && S.chatMsgs ? Object.keys(S.chatMsgs).length : 0),
      messageCount: (typeof S !== "undefined" && S.history ? S.history.length : 0),
      vocabExtraCount: (typeof S !== "undefined" && S.extra ? S.extra.length : 0),
      vocabLearningCount: (typeof S !== "undefined" && S.learning ? S.learning.length : 0),
      vocabKnownCount: (typeof S !== "undefined" && S.known ? S.known.length : 0)
    };
    
    var history = options.history || (typeof S !== "undefined" ? (S.history || []) : []);
    context.recentSubmissions = smartSample(history.filter(function(m) { return m.role === "user"; }), "created_at", 2);
    context.recentTranslations = smartSample(history.filter(function(m) { return m.translation; }), "created_at", 2);
    context.recentExplanations = smartSample(history.filter(function(m) { return m.explainChat && m.explainChat.length; }), "created_at", 2);
    context.recentGraderResults = smartSample(history.filter(function(m) { return m.grade; }), "created_at", 2);
    
    var tenMinWords = [];
    var now = Date.now();
    history.forEach(function(msg) {
      if (msg.introduced && msg.introduced.length) {
        var msgTime = new Date(msg.created_at).getTime();
        if (now - msgTime <= 10 * 60 * 1000) {
          tenMinWords = tenMinWords.concat(msg.introduced);
        }
      }
    });
    context.recentWords = tenMinWords;
    
    context.recentErrors = options.errors || [];
    
    return context;
  }
  
  /* Anything reaching the formatter may be absent, null, or not a string --
   * a turn that was never translated, a grade that failed to parse. Clip
   * returns "" for all of it and callers drop empty lines, so a missing field
   * costs a line of preview, not an exception. */
  function clip(s) {
    if (typeof s !== "string") return "";
    s = s.trim();
    return s.length > 100 ? s.substring(0, 100) + "..." : s;
  }

  function who(item) {
    return item && item.role === "user" ? "you" : "partner";
  }

  /* Header plus lines, but only if some line survived clipping. */
  function section(lines, title, quoted) {
    if (!quoted.length) return;
    lines.push("## " + title);
    quoted.forEach(function(q) { lines.push("> " + q); });
  }

  /* The grammar/explanation chat is a thread; the reply is what is worth
   * reading back, so take the last assistant turn in it. */
  function lastExplain(item) {
    var chat = (item && item.explainChat) || [];
    for (var i = chat.length - 1; i >= 0; i--) {
      if (chat[i] && chat[i].role === "assistant") return clip(chat[i].text);
    }
    return "";
  }

  function gradeLine(item) {
    var g = (item && item.grade) || {};
    var parts = [];
    if (g.unreadable) parts.push("unreadable");
    else parts.push(g.ok ? "ok" : "not ok");
    if (clip(g.better)) parts.push("better: " + clip(g.better));
    (g.errors || []).forEach(function(e) {
      if (e && (e.tag || e.note)) parts.push((e.tag || "?") + ": " + clip(e.note));
    });
    var src = clip(item && item.text);
    return (src ? src + " — " : "") + parts.join("; ");
  }

  function collect(items, fn) {
    return (items || []).map(fn).filter(function(s) { return !!s; });
  }

  function formatContextForGitHub(context, checkboxes) {
    var lines = [];
    
    if (checkboxes.system) {
      lines.push("## System");
      lines.push("- **Version:** " + context.version);
      lines.push("- **Browser:** " + context.browser);
      lines.push("- **Platform:** " + context.platform);
      lines.push("- **PWA:** " + (context.isPWA ? "yes" : "no"));
    }
    
    if (checkboxes.appState) {
      lines.push("## App State");
      lines.push("- **HSK Level:** " + context.level);
      lines.push("- **Activity:** " + context.activity);
      lines.push("- **Chat Model:** " + context.model);
      lines.push("- **Sync:** " + (context.syncEnabled ? "on" : "off"));
    }
    
    if (checkboxes.dataSummary) {
      lines.push("## Data");
      lines.push("- **Conversations:** " + context.conversationCount);
      lines.push("- **Messages:** " + context.messageCount);
      lines.push("- **Extra Words:** " + context.vocabExtraCount);
      lines.push("- **Learning Words:** " + context.vocabLearningCount);
      lines.push("- **Known Words:** " + context.vocabKnownCount);
    }
    
    if (checkboxes.errors) {
      section(lines, "Recent Errors", collect(context.recentErrors, function(err) {
        var msg = clip(err && err.message);
        return msg ? ((err.kind || "error") + ": " + msg) : "";
      }));
    }
    
    if (checkboxes.submissions) {
      section(lines, "Recent Submissions", collect(context.recentSubmissions, function(sub) {
        return clip(sub && sub.text);
      }));
    }
    
    if (checkboxes.translations) {
      section(lines, "Recent Translations", collect(context.recentTranslations, function(t) {
        var en = clip(t && t.translation);
        return en ? ("[" + who(t) + "] " + clip(t.text) + " — " + en) : "";
      }));
    }
    
    /* Same field either way: "Check my grammar" on your own turn, "English
     * explanation" on the partner's. Label it rather than split the section. */
    if (checkboxes.explanations) {
      section(lines, "Recent Explanations", collect(context.recentExplanations, function(e) {
        var reply = lastExplain(e);
        return reply ? ("[" + (who(e) === "you" ? "grammar" : "explanation") + "] " + reply) : "";
      }));
    }
    
    if (checkboxes.grader) {
      section(lines, "Recent Grader Results", collect(context.recentGraderResults, gradeLine));
    }
    
    if (checkboxes.words && context.recentWords && context.recentWords.length) {
      lines.push("## Recent Words");
      lines.push(context.recentWords.join(", "));
    }
    
    return lines.join("\n\n");
  }
  
  /* A prefilled issue URL, not an API POST. Filing on a public repo needs no
   * token, no OAuth scope and nothing stored, and the user reads the whole
   * report on GitHub before anything is published. Signed-out users get bounced
   * through the login page, whose return_to carries the prefill intact.
   *
   * Measured against the live endpoint: GitHub 500s past ~6000 characters of
   * query string and 414s by 10000. Percent-encoding inflates Chinese ninefold,
   * so a couple of hundred characters of chat is enough to hit that -- the
   * budget is therefore spent against the ENCODED length, never the raw one. */
  var REPO = "toddclaw/Hsk_chat";
  var URL_BUDGET = 4000;

  /* Slicing mid-character leaves a lone surrogate, and encodeURIComponent
   * throws URIError on one. Emoji in a description are the way in. */
  function trimSurrogate(s) {
    var last = s.charCodeAt(s.length - 1);
    return (last >= 0xD800 && last <= 0xDBFF) ? s.slice(0, -1) : s;
  }

  function encLen(s) { return encodeURIComponent(s).length; }

  /* Longest prefix whose encoded form fits. Encoded length grows monotonically
   * with the prefix, so bisect it rather than encoding once per character. */
  function fit(body, budget) {
    if (encLen(body) <= budget) return body;
    var note = "\n\n_(context truncated to fit GitHub's URL limit)_";
    budget -= encLen(note);
    if (budget <= 0) return note;
    var lo = 0, hi = body.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (encLen(trimSurrogate(body.slice(0, mid))) <= budget) lo = mid;
      else hi = mid - 1;
    }
    return trimSurrogate(body.slice(0, lo)) + note;
  }

  /* Labels only stick for users with push access -- GitHub drops them from
   * anyone else, exactly as it did on the API. Free to send either way. */
  function issueUrl(category, description, context, checkboxes) {
    var isBug = /bug|error|fail|broken|issue|problem/i.test(description);
    var prefix = "https://github.com/" + REPO + "/issues/new" +
      "?title=" + encodeURIComponent("[HSK Chat] " + category) +
      "&labels=" + encodeURIComponent("app-submission," + (isBug ? "bug" : "enhancement")) +
      "&body=";
    var body = description + "\n\n---\n\n" + formatContextForGitHub(context, checkboxes);
    return prefix + encodeURIComponent(fit(body, URL_BUDGET - prefix.length));
  }

  var api = {
    captureContext: captureContext,
    formatContextForGitHub: formatContextForGitHub,
    issueUrl: issueUrl,
    smartSample: smartSample
  };
  
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKIssues = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
