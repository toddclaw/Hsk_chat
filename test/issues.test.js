var assert = require("assert");

var pass = 0;
var fail = 0;
var failures = [];
var asyncTests = [];

function runTest(name, fn) {
  try {
    var result = fn();
    if (result && typeof result.then === "function") {
      asyncTests.push(result.then(function() {
        pass++;
        console.log("  ✓ " + name);
      }).catch(function(err) {
        fail++;
        failures.push({ name: name, error: err.message });
        console.log("  ✗ " + name);
        console.log("    " + err.message);
      }));
    } else {
      pass++;
      console.log("  ✓ " + name);
    }
  } catch (err) {
    fail++;
    failures.push({ name: name, error: err.message });
    console.log("  ✗ " + name);
    console.log("    " + err.message);
  }
}

function describe(name, fn) {
  console.log("\n" + name);
  fn();
}

function it(name, fn) {
  runTest(name, fn);
}

var HSKIssues = require("../issues.js");

describe("HSKIssues context capture", function() {
  it("captures system info", function() {
    global.S = {
      level: 2,
      activity: "chat",
      model: "qwen/qwen-3-30b-a3b",
      prefs: { sync: true }
    };
    
    var ctx = HSKIssues.captureContext();
    assert(ctx.version);
    assert(ctx.browser);
    assert(ctx.level === 2);
  });
  
  it("reports the page's VERSION, not undefined", function() {
    global.VERSION = "v85 \u2014 2026-09-07";
    assert(HSKIssues.captureContext().version === "v85 \u2014 2026-09-07");
    delete global.VERSION;
  });

  it("smart samples recent items", function() {
    var history = [
      { role: "user", text: "old", created_at: "2026-09-05T10:00:00Z" },
      { role: "user", text: "recent", created_at: new Date().toISOString() }
    ];
    
    var ctx = HSKIssues.captureContext({ history: history });
    assert(ctx.recentSubmissions.length > 0);
  });
});

describe("GitHub issue formatting", function() {
  it("formats context with checkboxes", function() {
    var ctx = {
      version: "v82",
      browser: "Firefox",
      platform: "Linux",
      isPWA: false,
      level: 2,
      activity: "chat",
      model: "qwen",
      syncEnabled: true,
      conversationCount: 5,
      messageCount: 20,
      vocabExtraCount: 10,
      vocabLearningCount: 5,
      vocabKnownCount: 15,
      recentErrors: [],
      recentSubmissions: [],
      recentTranslations: [],
      recentExplanations: [],
      recentGraderResults: [],
      recentWords: []
    };
    
    var checkboxes = {
      system: true,
      appState: true,
      dataSummary: true,
      errors: false,
      submissions: false,
      translations: false,
      explanations: false,
      grader: false,
      words: false
    };
    
    var formatted = HSKIssues.formatContextForGitHub(ctx, checkboxes);
    assert(formatted.includes("## System"));
    assert(formatted.includes("## App State"));
    assert(formatted.includes("## Data"));
    assert(!formatted.includes("## Recent Errors"));
  });
});

describe("smartSample helper", function() {
  it("returns most recent item and items within time window", function() {
    var now = new Date();
    var oneMinAgo = new Date(now.getTime() - 1 * 60 * 1000);
    var threeMinAgo = new Date(now.getTime() - 3 * 60 * 1000);
    var fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

    var items = [
      { text: "oldest", created_at: fiveMinAgo.toISOString(), role: "user" },
      { text: "middle", created_at: threeMinAgo.toISOString(), role: "user" },
      { text: "recent", created_at: oneMinAgo.toISOString(), role: "user" }
    ];

    var sampled = HSKIssues.smartSample(items, 2);

    assert(sampled.length >= 1, "should include at least most recent item, got " + sampled.length);
    assert(sampled.some(function(s) { return s.text === "recent"; }), "should include most recent");
  });

  it("handles empty items", function() {
    var sampled = HSKIssues.smartSample([], "created_at", 2);
    assert(sampled.length === 0);
  });

  it("handles null items", function() {
    var sampled = HSKIssues.smartSample(null, "created_at", 2);
    assert(sampled.length === 0);
  });
});

describe("full-turn preview", function() {
  // A real turn carries fields smartSample used to throw away: the crash was
  // "t.translation is undefined" on every chat that had ever been translated.
  var now = new Date().toISOString();
  var history = [
    { role: "user", text: "\u6211\u559c\u6b22\u5403\u996d", created_at: now,
      translation: "I like eating rice",
      explainChat: [ { role: "assistant", text: "\u559c\u6b22 takes a verb directly." } ],
      grade: { ok: false, better: "\u6211\u559c\u6b22\u5403\u7c73\u996d",
               errors: [ { tag: "word", note: "\u996d alone is a meal" } ] } },
    { role: "assistant", text: "\u4f60\u5403\u4e86\u5417", created_at: now,
      translation: "Have you eaten?",
      explainChat: [ { role: "assistant", text: "A common greeting." } ] }
  ];
  var all = { system: true, appState: true, dataSummary: true, errors: true,
              submissions: true, translations: true, explanations: true,
              grader: true, words: true };

  it("does not throw on a turn with translation, grammar and grade", function() {
    var ctx = HSKIssues.captureContext({ history: history });
    HSKIssues.formatContextForGitHub(ctx, all);
  });

  it("includes my last message text, translation, grammar and grade", function() {
    var out = HSKIssues.formatContextForGitHub(
      HSKIssues.captureContext({ history: history }), all);
    assert(out.indexOf("\u6211\u559c\u6b22\u5403\u996d") !== -1, "user text missing");
    assert(out.indexOf("I like eating rice") !== -1, "user translation missing");
    assert(out.indexOf("\u559c\u6b22 takes a verb directly.") !== -1, "grammar missing");
    assert(out.indexOf("\u6211\u559c\u6b22\u5403\u7c73\u996d") !== -1, "grade better missing");
    assert(out.indexOf("\u996d alone is a meal") !== -1, "grade error note missing");
  });

  it("includes the partner's last message text, translation and explanation", function() {
    var out = HSKIssues.formatContextForGitHub(
      HSKIssues.captureContext({ history: history }), all);
    assert(out.indexOf("\u4f60\u5403\u4e86\u5417") !== -1, "assistant text missing");
    assert(out.indexOf("Have you eaten?") !== -1, "assistant translation missing");
    assert(out.indexOf("A common greeting.") !== -1, "explanation missing");
  });

  it("does not throw when those fields are absent", function() {
    var bare = [ { role: "user", text: "\u4f60\u597d", created_at: now },
                 { role: "assistant", text: "\u4f60\u597d", created_at: now } ];
    var out = HSKIssues.formatContextForGitHub(
      HSKIssues.captureContext({ history: bare }), all);
    assert(out.indexOf("## Recent Translations") === -1, "empty section emitted");
  });

  it("does not throw on a turn whose text is missing", function() {
    var junk = [ { role: "user", created_at: now, translation: null, grade: {} } ];
    HSKIssues.formatContextForGitHub(HSKIssues.captureContext({ history: junk }), all);
  });
});

// --- async tests for submitToGitHub error handling -----------------------
describe("submitToGitHub error handling", function() {
  var originalFetch;

  function stubFetch(status, body) {
    return function() {
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status: status,
        json: function() { return Promise.resolve(body); }
      });
    };
  }

  it("404 with Not Found mentions signing back in to grant issue permission", function() {
    originalFetch = global.fetch;
    global.fetch = stubFetch(404, { message: "Not Found" });
    return HSKIssues.submitToGitHub("bug", "test desc", {}, {}, "tok").then(
      function() {
        throw new Error("should have thrown for 404");
      },
      function(err) {
        assert(err.message.includes("sign out") || err.message.includes("grant") || err.message.includes("permission"),
          "404 message should mention signing back in or granting permission, got: " + err.message);
      }
    ).then(function() {
      global.fetch = originalFetch;
    });
  });

  it("403 surfaces GitHub message and includes sign-in guidance for scope issues", function() {
    originalFetch = global.fetch;
    global.fetch = stubFetch(403, { message: "Resource not accessible by personal access token" });
    return HSKIssues.submitToGitHub("bug", "test desc", {}, {}, "tok").then(
      function() {
        throw new Error("should have thrown for 403");
      },
      function(err) {
        assert(err.message.includes("Resource not accessible by personal access token"),
          "403 message should surface GitHub message, got: " + err.message);
        assert(err.message.includes("sign out") || err.message.includes("grant") || err.message.includes("permission"),
          "403 scope-related message should mention signing back in, got: " + err.message);
      }
    ).then(function() {
      global.fetch = originalFetch;
    });
  });

  it("429 yields the rate-limit message", function() {
    originalFetch = global.fetch;
    global.fetch = stubFetch(429, { message: "rate limit" });
    return HSKIssues.submitToGitHub("bug", "test desc", {}, {}, "tok").then(
      function() {
        throw new Error("should have thrown for 429");
      },
      function(err) {
        assert(err.message.includes("rate limit"),
          "429 message should mention rate limit, got: " + err.message);
      }
    ).then(function() {
      global.fetch = originalFetch;
    });
  });

  it("201 success returns the parsed JSON response", function() {
    originalFetch = global.fetch;
    global.fetch = stubFetch(201, { html_url: "https://github.com/toddclaw/Hsk_chat/issues/1" });
    return HSKIssues.submitToGitHub("bug", "test desc", {}, {}, "tok").then(
      function(result) {
        assert(result.html_url === "https://github.com/toddclaw/Hsk_chat/issues/1",
          "201 should return parsed JSON with html_url");
      }
    ).then(function() {
      global.fetch = originalFetch;
    });
  });
});

// Wait for async tests before printing the summary
Promise.all(asyncTests).then(function() {
  console.log("\n---");
  console.log("Pass: " + pass);
  console.log("Fail: " + fail);

  if (fail > 0) {
    console.log("\nFailures:");
    for (var i = 0; i < failures.length; i++) {
      console.log("  " + failures[i].name + ": " + failures[i].error);
    }
    process.exit(1);
  }
});
