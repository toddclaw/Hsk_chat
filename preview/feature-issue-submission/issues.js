(function (root) {
  "use strict";
  
  var VERSION = typeof window !== "undefined" ? window.VERSION : "v82";
  
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
    
    return recent.map(function(item) {
      return {
        text: item.text,
        created_at: item.created_at,
        role: item.role
      };
    });
  }
  
  function captureContext(options) {
    options = options || {};
    
    var context = {
      version: VERSION,
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
    
    if (checkboxes.errors && context.recentErrors.length) {
      lines.push("## Recent Errors");
      context.recentErrors.forEach(function(err) {
        lines.push("- " + err.kind + ": " + err.message);
      });
    }
    
    if (checkboxes.submissions && context.recentSubmissions.length) {
      lines.push("## Recent Submissions");
      context.recentSubmissions.forEach(function(sub) {
        lines.push("> " + sub.text.substring(0, 100) + (sub.text.length > 100 ? "..." : ""));
      });
    }
    
    if (checkboxes.translations && context.recentTranslations.length) {
      lines.push("## Recent Translations");
      context.recentTranslations.forEach(function(t) {
        lines.push("> " + t.translation.substring(0, 100) + (t.translation.length > 100 ? "..." : ""));
      });
    }
    
    if (checkboxes.explanations && context.recentExplanations.length) {
      lines.push("## Recent Explanations");
      context.recentExplanations.forEach(function(e) {
        lines.push("> " + e.text.substring(0, 100) + (e.text.length > 100 ? "..." : ""));
      });
    }
    
    if (checkboxes.grader && context.recentGraderResults.length) {
      lines.push("## Recent Grader Results");
      context.recentGraderResults.forEach(function(g) {
        lines.push("> " + g.text.substring(0, 100) + (g.text.length > 100 ? "..." : ""));
      });
    }
    
    if (checkboxes.words && context.recentWords.length) {
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
    
    var response = await fetch("https://api.github.com/repos/toddclaw/Hsk_chat/issues", {
      method: "POST",
      headers: {
        "Authorization": "token " + githubToken,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "HSK-Chat-Issue-Reporter/" + VERSION
      },
      body: JSON.stringify({
        title: title,
        body: body,
        labels: labels
      })
    });
    
    if (!response.ok) {
      var error = await response.json();
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
