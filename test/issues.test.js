var assert = require("assert");

var pass = 0;
var fail = 0;
var failures = [];

function runTest(name, fn) {
  try {
    fn();
    pass++;
    console.log("  ✓ " + name);
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
