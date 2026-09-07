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
  
  async function submitToGitHub(category, description, context, checkboxes, githubToken) {
    var isBug = /bug|error|fail|broken|issue|problem/i.test(description);
    var labels = ["app-submission", isBug ? "bug" : "enhancement"];
    
    var title = "[HSK Chat] " + category;
    var body = description + "\n\n---\n\n" + formatContextForGitHub(context, checkboxes);
    
    var response;
    try {
      response = await fetch("https://api.github.com/repos/toddclaw/Hsk_chat/issues", {
        method: "POST",
        headers: {
          "Authorization": "token " + githubToken,
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "HSK-Chat-Issue-Reporter/" + appVersion()
        },
        body: JSON.stringify({
          title: title,
          body: body,
          labels: labels
        })
      });
    } catch (networkErr) {
      throw new Error("Network error. Check your connection and try again.");
    }
    
    if (!response.ok) {
      // Handle rate limiting
      if (response.status === 429) {
        throw new Error("GitHub rate limit exceeded. Please try again in a few minutes.");
      }
      // Handle authentication/authorization errors — parse GitHub's
      // actual message so the user knows what went wrong.
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        var body;
        try {
          body = await response.json();
        } catch (e) {
          body = { message: "Failed to create GitHub issue (status " + response.status + ")" };
        }
        var githubMsg = body.message || "Failed to create GitHub issue";
        if (response.status === 404) {
          throw new Error(githubMsg + " — Sign out and sign back in from Settings → Sync & backup so the app can request issue-creation permission.");
        }
        if (response.status === 403) {
          if (/rate.limit|secondary rate/i.test(githubMsg.toLowerCase())) {
            throw new Error(githubMsg);
          }
          throw new Error(githubMsg + " — Sign out and sign back in from Settings → Sync & backup so the app can request issue-creation permission.");
        }
        throw new Error(githubMsg + " — Sign out and sign back in from Settings → Sync & backup so the app can request issue-creation permission.");
      }
      // Other errors
      var error;
      try {
        error = await response.json();
      } catch (e) {
        error = { message: "Failed to create GitHub issue (status " + response.status + ")" };
      }
      throw new Error(error.message || "Failed to create GitHub issue");
    }
    
    return await response.json();
  }
  
  var api = {
    captureContext: captureContext,
    formatContextForGitHub: formatContextForGitHub,
    submitToGitHub: submitToGitHub,
    smartSample: smartSample
  };
  
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HSKIssues = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
