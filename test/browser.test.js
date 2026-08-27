/* The browser half of the app, driven for real. Run: node test/browser.test.js
 *
 * sync.js splits in two: pure data-shaping (covered directly by
 * test/sync.test.js) and the Supabase glue, which needs a DOM, a click and a
 * supabase-js client before any of it runs. That half had no committed
 * coverage at all -- "delete all cloud data" could stop deleting a table, or
 * start deleting before sync was switched off, and every node suite would
 * still pass.
 *
 * Deliberately dependency-free, like everything else here. WebDriver is a plain
 * HTTP/JSON protocol, geckodriver speaks it, and node has had fetch and a
 * static http server built in for years -- so this needs no package.json, no
 * node_modules and no build step. It costs a browser on the machine instead,
 * and skips cleanly when there is not one.
 *
 * Supabase itself is mocked in-page. index.html loads supabase-js lazily and
 * returns early if window.supabase already exists, so setting it before sync is
 * switched on keeps the whole run hermetic -- no CDN, no network, no project.
 * What this proves is that the app calls the right tables in the right order;
 * what it cannot prove is that RLS permits the delete, which needs a real
 * sign-in against the real project.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const net = require("net");

const ROOT = path.join(__dirname, "..");
/* Local date in YYYY-MM-DD, matching HSKTime.dayKey(). Computed per run rather
 * than written into the file: a date literal here passes on the day it is
 * written and fails silently every day after. */
const TODAY = new Date().toLocaleDateString("en-CA");
let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

/* ------------------------------------------------------------ environment */

function which(cmd) {
  const r = spawnSync("sh", ["-c", "command -v " + cmd], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}
/* snap ships geckodriver under a dotted name and a tarball install uses the
 * plain one. GitHub's runners ship it too, but at a path named only by
 * $GECKOWEBDRIVER rather than on PATH -- without that branch this suite would
 * quietly skip in CI, which is worse than not having it, since the run would
 * still be green while covering nothing. */
function inGeckoWebdriverDir() {
  const dir = process.env.GECKOWEBDRIVER;
  if (!dir) return null;
  const f = path.join(dir, "geckodriver");
  return fs.existsSync(f) ? f : null;
}
const DRIVER = which("geckodriver") || which("firefox.geckodriver") || inGeckoWebdriverDir();
const BROWSER = which("firefox") || which("firefox-esr");

if (!DRIVER || !BROWSER) {
  console.log("skipped: needs firefox and geckodriver on PATH" +
    (BROWSER ? "" : " (no firefox found)") + (DRIVER ? "" : " (no geckodriver found)"));
  console.log("\n0 passed, 0 failed (skipped)");
  process.exit(0);
}

const freePort = () => new Promise(res => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
});

/* ----------------------------------------------------------- static serve */

const TYPES = { ".html": "text/html", ".js": "text/javascript",
                ".json": "application/json", ".png": "image/png",
                ".webmanifest": "application/manifest+json" };

function serve(port) {
  const srv = http.createServer((req, res) => {
    let p = decodeURI(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const f = path.join(ROOT, p);
    // Never serve outside the repo, even if a test asks for it by mistake.
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404).end(); return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "text/plain" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(port, "127.0.0.1", () => r(srv)));
}

/* ------------------------------------------------------------- webdriver */

let WD = null, session = null;
const call = async (method, url, body) => {
  const r = await fetch(WD + url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
};
const exec = async (script, args) => {
  const r = await call("POST", `/session/${session}/execute/sync`,
    { script: script, args: args || [] });
  if (r.value && r.value.error) throw new Error(r.value.error + ": " + r.value.message);
  return r.value;
};
const go = url => call("POST", `/session/${session}/url`, { url: url });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Polls rather than sleeps: firefox start-up varies far more than the app does.
async function waitFor(expr, label, timeoutMs) {
  const limit = Date.now() + (timeoutMs || 20000);
  for (;;) {
    let v = null;
    try { v = await exec("return (" + expr + ") ? true : false;"); } catch (e) { /* not ready */ }
    if (v) return true;
    if (Date.now() > limit) throw new Error("timed out waiting for " + label);
    await sleep(200);
  }
}

/* ------------------------------------------------------- the page harness
 *
 * Runs inside the page. Marionette executes scripts in a sandbox that sees
 * window and the DOM but NOT the page's top-level const bindings, so nothing
 * here may touch S, VERSION or K by name -- every assertion below is made
 * through window or the DOM, which is what the user sees anyway.
 */
const INSTALL_MOCK = `
window.__t = { calls: [] };
window.confirm = function () { return true; };
window.supabase = {
  createClient: function () {
    function builder(table) {
      var q = { _table: table, _op: null };
      q.select = function () { q._op = "select"; return q; };
      q.delete = function () { q._op = "delete"; return q; };
      q.upsert = function (rows) { q._op = "upsert"; q._rows = rows; return q; };
      q.eq = function () { return q; };
      q.gt = function () { return q; };
      q.maybeSingle = function () { q._single = true; return q; };
      // Thenable, so "await client.from(t).delete().eq(...)" resolves.
      q.then = function (resolve) {
        var box = document.querySelector("#syncOn");
        window.__t.calls.push({
          table: table,
          op: q._op,
          // The ordering this feature turns on, recorded as the call is made.
          syncOnAtCall: !!(box && box.checked)
        });
        resolve({ data: q._single ? null : [], error: null });
        return Promise.resolve();
      };
      return q;
    }
    return {
      from: builder,
      auth: {
        getSession: function () {
          return Promise.resolve({ data: { session: { user: { id: "test-user" } } } });
        },
        onAuthStateChange: function () {
          return { data: { subscription: { unsubscribe: function () {} } } };
        },
        signInWithOAuth: function () { return Promise.resolve({}); },
        signOut: function () { return Promise.resolve({}); }
      }
    };
  }
};
return true;
`;

/* ------------------------------------------------------------------- run */

(async () => {
  const port = await freePort();
  const srv = await serve(port);
  const driverPort = await freePort();
  WD = "http://127.0.0.1:" + driverPort;
  const driver = spawn(DRIVER, ["--port", String(driverPort)], { stdio: "ignore" });
  let closed = false;
  const shutdown = async () => {
    if (closed) return; closed = true;
    try { if (session) await call("DELETE", "/session/" + session); } catch (e) {}
    try { driver.kill("SIGKILL"); } catch (e) {}
    try { srv.close(); } catch (e) {}
  };
  process.on("exit", () => { try { driver.kill("SIGKILL"); } catch (e) {} });

  try {
    // geckodriver needs a moment before it answers.
    for (let i = 0; i < 50; i++) {
      try { const r = await fetch(WD + "/status"); if ((await r.json()).value.ready) break; }
      catch (e) { await sleep(200); }
    }
    const made = await call("POST", "/session", {
      capabilities: { alwaysMatch: { "moz:firefoxOptions": { args: ["-headless"] } } }
    });
    if (!made.value || !made.value.sessionId) {
      throw new Error("could not start firefox: " + JSON.stringify(made).slice(0, 200));
    }
    session = made.value.sessionId;
    const base = "http://127.0.0.1:" + port + "/index.html";

    // A conversation to clear, seeded before the app boots so it renders one.
    await go(base);
    await waitFor("document.querySelector('#log')", "the app shell");
    await exec(`
      localStorage.setItem("hsk1chat.history", JSON.stringify([
        { id: "11111111-1111-4111-8111-111111111111", role: "user",
          text: "你好", needs: [], attempts: 1,
          created_at: "2026-01-01T00:00:00.000Z",
          /* A stored explain-chat, so opening the sheet renders it instead of
           * calling the model -- this suite has no key and no network. The text
           * is the shape a real answer arrives in: Markdown nobody asked for. */
          explainChat: [{ role: "assistant",
            text: "1. **Is it correct?** Yes.\\n- a bullet\\n### A heading" }] },
        /* A real learner's worth of typing, not two short turns. The progress
         * panel measures production by segmenting these, and a two-word
         * history cannot reach the states where the reading and production
         * figures could disagree -- which is exactly the bug the coherence
         * check downstream exists to catch. Common, high-frequency words on
         * purpose: those carry nearly all the weight. */
        { id: "44444444-4444-4444-8444-444444444444", role: "user",
          text: "我们今天来这里看看，你的东西很多，我不去了，我可以来，这个很好。",
          needs: [], attempts: 1, created_at: "2026-01-01T00:00:30.000Z" },
        { id: "22222222-2222-4222-8222-222222222222", role: "assistant",
          text: "你喜欢吃中国菜吗？", needs: [], attempts: 1,
          created_at: "2026-01-01T00:01:00.000Z" },
        /* No explainChat, so opening this one's sheet actually builds a prompt
         * -- which is the only way to see whether the turn above reached it. */
        { id: "33333333-3333-4333-8333-333333333333", role: "user",
          text: "我也是", needs: [], attempts: 1,
          created_at: "2026-01-01T00:02:00.000Z" }
      ]));
      /* Only the teaching model is seeded. The chat model is left alone so the
       * shipped default is what runs, which is the thing worth asserting -- and
       * it still differs from the teaching id, so a call can be attributed to
       * one or the other. Read into S at boot, so it has to be here rather
       * than set later. The API key deliberately is NOT: boot opens the
       * Settings sheet when no key is stored, and the wipe checks further down
       * assert on an element inside that sheet, so seeding a key here hides it
       * and breaks a test that has nothing to do with models. */
      /* Two HSK 2 words introduced by pacing, of which the typed history above
       * uses exactly one. That makes the never-used row's subtraction
       * non-empty on both sides -- without it the row is simply absent and any
       * assertion about it passes without testing anything. */
      localStorage.setItem("hsk1chat.learning", JSON.stringify([
        { w: "可以", p: "kě yǐ", d: "can; may", seen: 2, from: 2 },
        { w: "已经", p: "yǐ jīng", d: "already",  seen: 1, from: 2 }
      ]));
      localStorage.setItem("hsk1chat.teachModel", JSON.stringify("teaching/model"));
      /* Two devices' worth of recorded time, so the display has something to
       * sum. Seeded before boot because S reads it once at startup. */
      /* One prompt override, so a real request can be checked against it. Seeded
       * before boot because S reads it once at startup. */
      localStorage.setItem("hsk1chat.teachPrompts", JSON.stringify({
        transMine: "CUSTOM TRANSLATE PROMPT for {text} at {level}"
      }));
      /* Spend, seeded like the time totals: S reads it once at startup. */
      localStorage.setItem("hsk1chat.cost", JSON.stringify({
        "dev-a": { total: 1.25, days: { "${TODAY}": 0.0234 } },
        "dev-b": { total: 0.75, days: { "${TODAY}": 0.0066 } }
      }));
      localStorage.setItem("hsk1chat.chatTime", JSON.stringify({
        "dev-a": { total: 5880, days: { "${TODAY}": 1440 } },
        "dev-b": { total: 120,  days: { "${TODAY}": 60 } }
      }));
      return true;`);
    await go(base);
    await waitFor("window.HSKSync && document.querySelector('#syncOn')", "sync.js and the toggle");

    /* Asserted by content, not just "something is there": if the seed silently
      * failed, the cleared-afterwards check below would pass against an empty
      * log that was never filled, and prove nothing. */
    /* boot() fills the log only after loadLevel() resolves, so this waits for
     * the content rather than the element -- and asserts on the text, not just
     * "something is there". If the seed silently failed, the cleared-afterwards
     * check below would pass against a log that was never filled. */
    let seeded = true;
    try {
      await waitFor("document.querySelector('#log').textContent.indexOf('你好') !== -1",
        "the seeded conversation", 15000);
    } catch (e) { seeded = false; }
    check(seeded, "the seeded conversation renders before the wipe",
      await exec("return document.querySelector('#log').textContent.slice(0, 120);"));

    /* The seeded turn is the student's own, so it is also the cheapest place to
     * check that translate and explain reach a user message at all -- they were
     * assistant-only, and the whole feature is one `role === "assistant"` guard
     * away from silently disappearing again. Asserted by label rather than by
     * count: "Check my grammar" is what routes explainSystemPrompt to the shape
     * that knows the sentence may be wrong. Not clicked -- that would spend a
     * real model call, and this suite has no key and no network. */
    const ownBtns = await exec(`
      var m = document.querySelector('#log .msg.user .meta');
      return m ? Array.prototype.map.call(m.querySelectorAll('button'),
        function (b) { return b.textContent; }) : null;`);
    check(!!ownBtns && ownBtns.indexOf("English translation") !== -1,
      "a user message offers a translation button", JSON.stringify(ownBtns));
    check(!!ownBtns && ownBtns.indexOf("Check my grammar") !== -1,
      "a user message offers the grammar-check button", JSON.stringify(ownBtns));

    /* Yellow means "already answered -- pressing this is free and instant".
     * The seed gives both states from one render: the first user turn has a
     * stored explain-chat and no translation, the last has neither. Checked on
     * both sides because a rule that marked every button, or none, would sail
     * through a one-sided assertion. */
    const marks = await exec(`
      function state(m) {
        var out = {};
        Array.prototype.forEach.call(m.querySelectorAll('.meta button'), function (b) {
          out[b.textContent] = b.className;
        });
        return out;
      }
      var msgs = document.querySelectorAll('#log .msg.user');
      return { first: state(msgs[0]), last: state(msgs[msgs.length - 1]) };`);
    check(/\bcached\b/.test(marks.first["Check my grammar"] || ""),
      "a stored explanation marks its button as cached", JSON.stringify(marks.first));
    check(!/\bcached\b/.test(marks.first["English translation"] || ""),
      "an untranslated message's translate button is not marked",
      JSON.stringify(marks.first));
    check(!/\bcached\b/.test(marks.last["Check my grammar"] || ""),
      "and a turn with nothing stored is not marked either", JSON.stringify(marks.last));
    check(!("redo" in marks.first),
      "redo is offered only where there is an answer to replace",
      JSON.stringify(marks.first));

    /* Opening that sheet exercises md.js against the DOM for real: node can
     * check the string it returns, but only a browser shows whether the result
     * reaches the page as formatting or as text. The seeded explain-chat means
     * no model call happens. */
    await exec(`
      var btns = document.querySelectorAll('#log .msg.user .meta button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent === "Check my grammar") { btns[i].click(); break; }
      }
      return true;`);
    await waitFor("document.querySelector('#explainSheet').classList.contains('open')",
      "the explain sheet");
    const md = await exec(`
      var box = document.querySelector('#explainLog');
      return { html: box.innerHTML, text: box.textContent,
               strong: box.querySelectorAll('strong').length,
               heading: box.querySelectorAll('b').length };`);
    check(md.strong > 0, "the sheet renders **bold** as a real <strong>", md.html.slice(0, 160));
    check(md.heading > 0, "and a ### heading as a heading", md.html.slice(0, 160));
    // The actual complaint: markup showing through as characters on the page.
    check(md.text.indexOf("**") === -1 && md.text.indexOf("###") === -1,
      "no Markdown punctuation is left visible to the reader", JSON.stringify(md.text));
    check(md.text.indexOf("•") !== -1, "list items render as bullets", JSON.stringify(md.text));
    check(await exec(`
      document.querySelector('#explainClose').click();
      return !document.querySelector('#explainSheet').classList.contains('open');`),
      "the sheet closes again");

    /* Which model a teaching call goes to. This is the whole point of the
     * setting and it is invisible everywhere else: routing it back to the chat
     * model would look identical in the UI and simply give worse answers, which
     * is exactly the failure that motivated splitting them. fetch is stubbed, so
     * no key and no network are involved -- the assertion is on the request body
     * the app builds. */
    await exec(`
      // Set at call time, not at boot -- see the seed above. callModel reads the
      // key on every call, so this is enough to get past its "no key" guard.
      localStorage.setItem("hsk1chat.apiKey", JSON.stringify("test-key-never-sent"));
      window.__calls = [];
      window.__realFetch = window.fetch;
      window.fetch = function (url, opts) {
        window.__calls.push(JSON.parse((opts && opts.body) || "{}"));
        return Promise.resolve({ ok: true, status: 200, json: function () {
          return Promise.resolve({ choices: [{ message: { content: "I am fine." },
                                              finish_reason: "stop" }] });
        } });
      };
      var btns = document.querySelectorAll('#log .msg.user .meta button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent === "English translation") { btns[i].click(); break; }
      }
      return true;`);
    await waitFor("window.__calls && window.__calls.length > 0", "the translation request");
    const sent = await exec("return window.__calls[0];");
    check(sent && sent.model === "teaching/model",
      "a translation is sent to the teaching model, not the chat model",
      "model was: " + (sent && sent.model));
    /* And that the override is actually SENT, not merely stored. Checking
     * localStorage only proves the editor saves; this proves the call path
     * consults it, which is the half that can silently stop working. */
    const body = sent && sent.messages && sent.messages[0] && sent.messages[0].content;
    check(/^CUSTOM TRANSLATE PROMPT for /.test(body || ""),
      "a customised teaching prompt is what gets sent", JSON.stringify(body));
    check(/for 你好 at /.test(body || ""),
      "with {text} replaced by the actual sentence", JSON.stringify(body));
    check(!/\{level\}/.test(body || ""),
      "and {level} substituted rather than left as a placeholder", JSON.stringify(body));
    /* That translation has just landed, so the button above it has to say so
     * and the redo has to appear -- neither waits for a render this path used
     * not to do at all. This is the resubmit feature's only entry point for a
     * translation, so it is the assertion that keeps it reachable. */
    await waitFor(`(function () {
      var m = document.querySelector('#log .msg.user');
      return Array.prototype.some.call(m.querySelectorAll('.meta button'),
        function (b) { return b.textContent === "redo"; });
    })()`, "the redo button appearing once a translation is stored");
    const transBtns = await exec(`
      var out = {};
      Array.prototype.forEach.call(
        document.querySelectorAll('#log .msg.user .meta button'),
        function (b) { out[b.textContent] = b.className; });
      return out;`);
    check(/\bcached\b/.test(transBtns["Hide translation"] || ""),
      "and the translate button is marked cached without a reload",
      JSON.stringify(transBtns));
    /* The grammar check should see what the student was replying to. 我也是 is
     * the case that makes it matter: fine after a statement, odd after a
     * question, and unjudgeable with neither. */
    await exec(`
      window.__calls = [];
      var msgs = document.querySelectorAll('#log .msg.user');
      var last = msgs[msgs.length - 1];
      var btns = last.querySelectorAll('.meta button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent === "Check my grammar") { btns[i].click(); break; }
      }
      return true;`);
    await waitFor("window.__calls && window.__calls.length > 0", "the grammar-check request");
    const gc = await exec("return window.__calls[0].messages[0].content;");
    check(/The conversation so far:/.test(gc || ""),
      "the grammar check is given the conversation", JSON.stringify((gc || "").slice(-260)));
    check(/Partner: 你喜欢吃中国菜吗？/.test(gc || ""),
      "including the turn it was replying to", JSON.stringify((gc || "").slice(-260)));
    check(/The student wrote: 我也是/.test(gc || ""),
      "and the sentence under review is still the last thing said",
      JSON.stringify((gc || "").slice(-260)));
    check((gc || "").indexOf("The conversation so far:") < (gc || "").indexOf("The student wrote:"),
      "with the context before it, not after");
    /* A follow-up must not inherit the verdict shape. It is a SYSTEM
     * instruction to emit one of three lines and stop, so it governs the whole
     * chat unless the system message changes with the question. Reported:
     * asked "what about the 现在 and the 了?", the model replied "Natural."
     * again, because that was the only thing it was permitted to say. */
    await exec(`
      window.__calls = [];
      document.querySelector('#explainInput').value = "why is that correct?";
      document.querySelector('#explainSend').click();
      return true;`);
    await waitFor("window.__calls && window.__calls.length > 0", "the follow-up request");
    const fu = await exec("return window.__calls[0].messages[0].content;");
    check(!/Start with exactly one of these three lines/.test(fu || ""),
      "a follow-up is not sent the verdict shape",
      JSON.stringify((fu || "").slice(0, 200)));
    check(/Answer their question directly/.test(fu || ""),
      "it is asked to answer the question instead",
      JSON.stringify((fu || "").slice(0, 200)));
    check(/The sentence under discussion:/.test(fu || ""),
      "and still told which sentence is being discussed");
    check(await exec("return window.__calls[0].messages.length;") >= 3,
      "with the verdict already given carried as context");

    await exec(`document.querySelector('#explainClose').click(); return true;`);

    check(await exec(`
      window.fetch = window.__realFetch; window.__calls = []; return true;`),
      "fetch is restored for the rest of the suite");

    /* ---------------------------------------------- the Settings accordion
     *
     * Boot opened Settings already, because the seed deliberately stores no key.
     */
    check(await exec(`return document.querySelector('#setSheet').classList.contains('open');`),
      "a first run with no key opens Settings");
    const secs = await exec(`
      return Array.prototype.map.call(document.querySelectorAll('#setSheet .sec'),
        function (d) { return d.querySelector('summary').textContent.trim() + "=" +
                              (d.open ? "open" : "closed"); });`);
    check(secs.length >= 8, "Settings is broken into sections", JSON.stringify(secs));
    check(secs.filter(s => s.endsWith("=open")).length === 1,
      "exactly one section starts open", JSON.stringify(secs));
    check(String(secs[0]).indexOf("Connection") === 0 && String(secs[0]).endsWith("=open"),
      "and it is Connection, the one a first run needs", JSON.stringify(secs));

    /* The default a new install runs on. Nothing seeded hsk1chat.model, so this
     * is MODELS[0] reaching the Settings picker unaided -- the cheap model the
     * app was tuned against, not whichever frontier name happens to be first in
     * the list. */
    check(await exec(`return document.querySelector('#modelChat').value;`)
            === "qwen/qwen3-30b-a3b-instruct-2507",
      "a fresh install defaults to the cheap Qwen model",
      await exec(`return document.querySelector('#modelChat').value;`));

    /* ------------------------------------------------- the Models two-step
     *
     * Loading the catalogue is setup; picking a model is what you come back for.
     * With no catalogue cached the setup block leads and the reload button is
     * not there; once one exists they swap. Getting this backwards would put a
     * once-ever button above the control used every time.
     */
    await exec(`document.querySelectorAll('#setSheet .sec')[1].open = true; return true;`);
    const before = await exec(`
      return { setup: getComputedStyle(document.querySelector('#modelSetup')).display,
               reload: getComputedStyle(document.querySelector('#modelReload')).display };`);
    check(before.setup !== "none", "with no catalogue, the setup block is shown", JSON.stringify(before));
    check(before.reload === "none", "and the quiet reload button is not", JSON.stringify(before));

    // Fake a cached catalogue rather than calling OpenRouter: this suite has no key.
    await exec(`
      localStorage.setItem("hsk1chat.modelCache", JSON.stringify([
        { id: "cheap/one", label: "Cheap One", free: true,  inM: 0,    outM: 0 },
        { id: "big/one",   label: "Big One",   free: false, inM: 0.09, outM: 0.55 }
      ]));
      return true;`);
    await exec(`document.querySelector('#btnSet').click(); return true;`);
    await exec(`document.querySelectorAll('#setSheet .sec')[1].open = true; return true;`);
    const after = await exec(`
      return { setup: getComputedStyle(document.querySelector('#modelSetup')).display,
               reload: getComputedStyle(document.querySelector('#modelReload')).display,
               note: document.querySelector('#modelNote').textContent,
               chat: document.querySelector('#modelChat').options.length,
               teach: document.querySelector('#teachModel').options.length };`);
    check(after.setup === "none", "once a catalogue is cached the setup block goes away", JSON.stringify(after));
    check(after.reload !== "none", "and the quiet reload button appears", JSON.stringify(after));
    check(/2 models cached, 1 of them free/.test(after.note), "the note counts the catalogue", after.note);
    check(after.chat >= 2, "the Settings chat picker is populated from it", JSON.stringify(after));
    // Teaching picker: the same list plus "Same as the chat model", never free-filtered.
    check(after.teach === after.chat + 1,
      "the teaching picker adds the same-as-chat option", JSON.stringify(after));

    /* --------------------------------------------- the model browser
     *
     * A few hundred catalogue entries do not fit a <select> on a phone, so
     * picking and starring happen in a sheet. The thing that can silently
     * break is the sheet growing its own idea of what is on offer: it must
     * read the same filters and sort as the dropdowns, not copies. */
    /* Pin the chat model to something in the seeded catalogue first. The
     * default id is not in it, and a starred model the catalogue has never
     * heard of cannot narrow a list built from the catalogue -- the filter
     * would fall back to unfiltered and the assertions below would be
     * measuring the fallback rather than the filter. */
    await exec(`
      var b = document.querySelector('#modelId');
      b.value = "big/one"; b.dispatchEvent(new Event("change")); return true;`);
    await exec(`document.querySelector('#browseChatModel').click(); return true;`);
    await waitFor("document.querySelector('#modelSheet').classList.contains('open')",
      "the model browser");
    await waitFor("document.querySelectorAll('#modelPickList .modelrow').length > 0",
      "model rows");
    check(await exec(`
      return document.querySelectorAll('#modelPickList .modelrow').length;`) >= 2,
      "the browser lists the cached catalogue");

    // Starring is its own tap target -- it must not change the chat model.
    const chatBefore = await exec(`return JSON.parse(localStorage.getItem("hsk1chat.model"));`);
    /* Star the model already in use. fillModels() always carries the current
     * model into the pickers so a filter can never silently switch what you
     * are talking to -- so starring any *other* model leaves two entries and
     * the narrowing below would prove nothing. */
    await exec(`
      document.querySelector('#modelPickList .modelrow.on .starbtn').click(); return true;`);
    check(await exec(`
      return (JSON.parse(localStorage.getItem("hsk1chat.favModels")) || []).length;`) === 1,
      "tapping ★ stars the model");
    check(await exec(`return JSON.parse(localStorage.getItem("hsk1chat.model"));`) === chatBefore,
      "and does not change which model you are talking to");
    /* The star sits inside a row that is itself a tap target, so it has to stop
     * the event. Without that, starring also selects and closes -- which the
     * model check above cannot see when the starred row is the one already in
     * use, since selecting it changes nothing. Starring is a batch job; it
     * stays open on purpose. */
    check(await exec(`
      return document.querySelector('#modelSheet').classList.contains('open');`),
      "and leaves the sheet open, since starring is a batch job");
    check(await exec(`
      return document.querySelector('#modelPickList .modelrow.on .starbtn')
               .classList.contains('on');`),
      "the star shows as set without reopening the sheet");

    /* Favorites-only has to reach the dropdowns, not just the sheet -- two
     * lists disagreeing about what is available is the whole failure mode. */
    const teachBefore = await exec(`
      return document.querySelector('#teachModel').options.length;`);
    await exec(`
      var b = document.querySelector('#favOnly');
      b.checked = true; b.dispatchEvent(new Event("change")); return true;`);
    check(await exec(`return document.querySelector('#modelChat').options.length;`) === 1,
      "Favorites-only narrows the Settings dropdown, not only the sheet",
      await exec(`return document.querySelector('#modelChat').options.length + " options";`));
    /* And the teaching picker, which it did not reach at first: the browse
     * sheet honored favorites for both pickers while this dropdown honored it
     * for neither, so the two disagreed about what was on offer. "Free models
     * only" is the one filter that deliberately stops here -- it would hide the
     * paid models this setting exists to reach. */
    /* Compared, not counted to a constant: the picker always carries the
     * teaching model in use and the same-as-chat option on top of whatever
     * survives the filter, so the absolute number says little. That it went
     * down is the whole claim. */
    check(await exec(`
      return document.querySelector('#teachModel').options.length;`) < teachBefore,
      "and narrows the teaching picker too, which it did not at first",
      await exec(`
        return Array.prototype.map.call(document.querySelector('#teachModel').options,
          function (o) { return o.textContent; }).join(" | ");`));
    check(await exec(`
      return document.querySelectorAll('#modelPickList .modelrow').length;`) === 1,
      "and the sheet agrees with it");

    /* An empty picker is worse than an unfiltered one. With favorites on and
     * none set, the filter has to yield rather than leave nothing to choose.
     * Unstarred through the UI, not by writing localStorage -- S is read once
     * at boot, so poking storage directly leaves the running app believing the
     * old value and tests the fallback against a state that never happens. */
    await exec(`
      document.querySelector('#modelPickList .modelrow.on .starbtn').click(); return true;`);
    check(await exec(`
      return (JSON.parse(localStorage.getItem("hsk1chat.favModels")) || []).length;`) === 0,
      "tapping ★ again unstars it");
    check(await exec(`return document.querySelector('#modelChat').options.length;`) >= 2,
      "Favorites-only with no favorites falls back rather than emptying the picker",
      await exec(`return document.querySelector('#modelChat').options.length + " options";`));

    // Choosing closes; this is a picker first and an editor second.
    await exec(`
      var b = document.querySelector('#favOnly');
      b.checked = false; b.dispatchEvent(new Event("change"));
      var rows = document.querySelectorAll('#modelPickList .modelrow');
      // Whichever row is not the one already in use, so "it changed" is real.
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i].classList.contains("on")) { rows[i].click(); break; }
      }
      return true;`);
    check(!(await exec(`
      return document.querySelector('#modelSheet').classList.contains('open');`)),
      "choosing a model closes the sheet");
    check(await exec(`return JSON.parse(localStorage.getItem("hsk1chat.model"));`) !== chatBefore,
      "and actually changes the chat model");

    /* One setting, two controls now that the header picker is gone. Leaving
     * either stale would show you a model you are not actually talking to. */
    await exec(`
      var sel = document.querySelector('#modelChat');
      sel.value = "big/one";
      sel.dispatchEvent(new Event("change"));
      return true;`);
    const synced = await exec(`
      return { box: document.querySelector('#modelId').value,
               stored: JSON.parse(localStorage.getItem("hsk1chat.model")) };`);
    check(synced.box === "big/one", "choosing in Settings moves the paste-an-id box",
      JSON.stringify(synced));
    check(synced.stored === "big/one", "and is persisted", JSON.stringify(synced));

    /* The other direction, which used not to work: the box was write-only, so a
     * pasted id changed nothing until Settings was closed and reopened. The id
     * here is deliberately absent from the catalogue -- that is the case the
     * box exists for, and assigning it to a <select> that has no such option
     * selects nothing at all rather than failing, so the pickers have to be
     * rebuilt around it. */
    await exec(`
      var box = document.querySelector('#modelId');
      box.value = "someone/not-in-the-catalogue";
      box.dispatchEvent(new Event("change"));
      return true;`);
    const pasted = await exec(`
      return { chat: document.querySelector('#modelChat').value,
               stored: JSON.parse(localStorage.getItem("hsk1chat.model")) };`);
    check(pasted.chat === "someone/not-in-the-catalogue",
      "pasting an id updates the Settings picker at once, without closing and reopening",
      JSON.stringify(pasted));
    check(pasted.stored === "someone/not-in-the-catalogue",
      "and is persisted", JSON.stringify(pasted));

    // Put a real id back so the commit checks below are not asserting on junk.
    await exec(`
      var b = document.querySelector('#modelId');
      b.value = "big/one"; b.dispatchEvent(new Event("change")); return true;`);

    /* The key is stored as it is typed, with Settings still open and nothing
     * committed. It was only ever written on close, so signing in for sync --
     * which navigates the page away to GitHub and comes back as a fresh load --
     * threw away a key that had just been entered and tested. Asserted while
     * the sheet is open, because "after closing" is the case that already
     * worked and would hide the regression. */
    await exec(`
      var k = document.querySelector('#key');
      k.value = "sk-or-typed-not-yet-closed";
      k.dispatchEvent(new Event("input"));
      return true;`);
    check(await exec(`return document.querySelector('#setSheet').classList.contains('open');`),
      "Settings is still open with the typed key uncommitted");
    check(await exec(`return JSON.parse(localStorage.getItem("hsk1chat.apiKey"));`)
            === "sk-or-typed-not-yet-closed",
      "the API key is stored as it is typed, not only when Settings closes");

    /* Settings has no Cancel: the fields are read out of the DOM when it closes,
     * so ✕ must commit exactly what Done commits. Asserted through a field in a
     * section that is still COLLAPSED, which is the part the accordion could
     * plausibly have broken -- a collapsed <details> renders nothing, and a
     * commit that skipped those inputs would lose every setting not opened. */
    await exec(`
      document.querySelector('#key').value = "sk-or-committed-by-the-x";
      var sel = document.querySelector('#replyLength');
      sel.value = "long";
      return true;`);
    check(await exec(`
      return !document.querySelector('#replyLength').closest('details').open;`),
      "reply length is inside a section that is still collapsed");
    await exec(`document.querySelector('#setX').click(); return true;`);
    check(!(await exec(`return document.querySelector('#setSheet').classList.contains('open');`)),
      "the ✕ closes Settings");
    check(await exec(`return JSON.parse(localStorage.getItem("hsk1chat.apiKey"));`)
            === "sk-or-committed-by-the-x",
      "the ✕ commits the API key rather than discarding it");
    check(await exec(`return JSON.parse(localStorage.getItem("hsk1chat.replyLength"));`) === "long",
      "and commits a field from a section that was never opened");

    /* ------------------------------------------------ time and the prompts */

    /* The clock itself is covered in test/time.test.js. What only a browser can
     * show is that the numbers reach the page, and that the summary row carries
     * today's total the way Connection carries "key saved". */
    await exec(`document.querySelector('#btnSet').click(); return true;`);
    await waitFor("document.querySelector('#setSheet').classList.contains('open')", "Settings");
    const clock = await exec(`
      return { body: document.querySelector('#chatTime').textContent,
               row: document.querySelector('#secConversationNote').textContent };`);
    /* Seeded: 1440 + 60 = 25 min today, 5880 + 120 = 1 h 40 min all time. Asserted
     * as a range rather than a string, because the real clock is running while
     * this suite drives the page and may legitimately add a tick or two -- an
     * exact match here would fail on a slow machine and pass on a fast one.
     * Exact formatting is pinned in test/time.test.js instead. */
    const mins = (txt, which) => {
      const seg = txt.split(which)[0];
      const m = seg.match(/(?:(\d+) h)?\s*(?:(\d+) min)?\s*$/) || [];
      return (Number(m[1] || 0) * 60) + Number(m[2] || 0);
    };
    const today = mins(clock.body, "today"), all = mins(clock.body, "all time");
    check(today >= 25 && today <= 27, "today's time sums every device (25 min seeded)",
      today + " min from " + JSON.stringify(clock.body));
    check(all >= 100 && all <= 102, "and so does the all-time total (1 h 40 min seeded)",
      all + " min from " + JSON.stringify(clock.body));
    check(/^2[567] min today$/.test(clock.row),
      "the collapsed Conversation row shows today's time", JSON.stringify(clock.row));

    /* Spend. Seeded 0.0234 + 0.0066 = $0.03 today, 1.25 + 0.75 = $2.00 all time.
     * Summed across devices for the same reason the time totals are. */
    const cost = await exec(`return document.querySelector('#costBox').textContent;`);
    check(/\$0\.030/.test(cost) && /today/.test(cost),
      "today's spend sums every device", JSON.stringify(cost));
    check(/\$2\.00 all time/.test(cost),
      "and so does the all-time total", JSON.stringify(cost));

    /* The Connection headline reports the balance rather than "key saved". The
     * balance is fetched, so drive it through the element refreshBalance fills. */
    /* Driven through the real path -- refreshBalance() clears the field and
     * refills it from the key endpoint, so seeding the element directly would be
     * wiped the next time Settings opened. Stub the lookup instead. */
    await exec(`
      window.__realFetch2 = window.fetch;
      window.fetch = function (url) {
        if (String(url).indexOf("/api/v1/key") !== -1) {
          return Promise.resolve({ ok: true, json: function () {
            return Promise.resolve({ data: { limit: 20, limit_remaining: 19.56, usage: 0.44 } });
          } });
        }
        return window.__realFetch2.apply(window, arguments);
      };
      document.querySelector('#setX').click();
      document.querySelector('#btnSet').click();
      return true;`);
    await waitFor(
      "/19\\.56/.test(document.querySelector('#secConnectionNote').textContent)",
      "the balance to reach the headline");
    check(true, "the Connection headline shows the balance");
    /* And when the lookup cannot be made -- offline, or a rejected key -- it says
     * a key is stored rather than inventing a number. balanceText returns "" on
     * purpose for that case; see the note above it. */
    check("key saved" === (await exec(`
      window.fetch = function () { return Promise.reject(new Error("offline")); };
      document.querySelector('#setX').click();
      document.querySelector('#btnSet').click();
      return document.querySelector('#secConnectionNote').textContent;`)),
      "and falls back to 'key saved' when the balance is unknown");
    await exec(`window.fetch = window.__realFetch2; return true;`);

    /* Both prices in the picker. The seeded catalogue has one free model and one
     * paid, so this also covers the free case. */
    const opts = await exec(`
      return Array.prototype.map.call(document.querySelector('#modelChat').options,
        function (o) { return o.textContent; });`);
    check(opts.some(o => /\$0\.09→\$0\.55\/M/.test(o)),
      "the picker shows input and output prices", JSON.stringify(opts));
    check(opts.some(o => / · free$/.test(o)),
      "and still says free for a free model", JSON.stringify(opts));

    /* Teaching text tracks the size slider rather than sitting at a fixed 14px.
     * Asserted as computed pixels at two slider positions, since the whole point
     * is that it moves. */
    const sizes = await exec(`
      function expPx() {
        var d = document.createElement('div');
        d.className = 'explainMsg';
        document.body.appendChild(d);
        var px = parseFloat(getComputedStyle(d).fontSize);
        d.remove();
        return px;
      }
      var f = document.querySelector('#fontSize');
      f.value = "34"; f.dispatchEvent(new Event("input"));
      var big = expPx();
      f.value = "18"; f.dispatchEvent(new Event("input"));
      var small = expPx();
      return { big: big, small: small };`);
    check(sizes.big > sizes.small,
      "explanation text grows with the size slider", JSON.stringify(sizes));
    check(sizes.big > 18 && sizes.big < 24,
      "at 34px it is prose-sized, not headline-sized", JSON.stringify(sizes));
    check(sizes.small >= 13,
      "and never drops below the readable floor", JSON.stringify(sizes));

    /* Copy conversation, now per-conversation in the 💬 sheet rather than one
     * button in Settings -- there is more than one conversation to copy. The
     * clipboard is not readable from a headless browser, so capture what
     * copyText hands to it. */
    const copied = await exec(`
      var got = null;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: function (t) { got = t; return Promise.resolve(); } }
      });
      document.querySelector('#btnChats').click();
      var btns = document.querySelectorAll('#chatList .chatrow .cacts button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent === "Copy") { btns[i].click(); break; }
      }
      document.querySelector('#chatX').click();
      return got;`);
    check(/^Partner: 你喜欢吃什么？/m.test(copied || "") || /Partner: /.test(copied || ""),
      "copy produces labelled turns", JSON.stringify(copied));
    check(/You: 你好/.test(copied || ""),
      "with the student's turns labelled You", JSON.stringify(copied));
    check(/\n\n/.test(copied || ""), "and a blank line between turns");

    // Section order: Conversation sits directly under Models.
    const order = await exec(`
      return Array.prototype.map.call(document.querySelectorAll('#setSheet .sec > summary'),
        function (s) { return s.childNodes[0].textContent.trim(); });`);
    check(order[1] === "Models" && order[2] === "Conversation",
      "Conversation sits directly under Models", JSON.stringify(order));
    check(order.indexOf("Reading & audio") > order.indexOf("Conversation"),
      "and above the display settings", JSON.stringify(order));

    // Starters and Clear conversation moved into Conversation.
    check(await exec(`
      return !!document.querySelector('#showStarters').closest('details')
               .querySelector('summary').textContent.match(/Conversation/);`),
      "conversation starters moved to the Conversation section");
    check(await exec(`
      return !!document.querySelector('#clearHistory').closest('details')
               .querySelector('summary').textContent.match(/Conversation/);`),
      "and so did Clear conversation");

    /* The four teaching prompts, editable like the system prompt. The default is
     * shown with its placeholders intact rather than filled against a sample
     * sentence -- the placeholders are the part worth editing. */
    await exec(`document.querySelectorAll('#setSheet .sec')[6].open = true; return true;`);
    const tp = await exec(`
      var boxes = document.querySelectorAll('#teachPrompts textarea');
      return { n: boxes.length,
               ids: Array.prototype.map.call(boxes, function (b) { return b.id; }),
               hasText: /\\{text\\}/.test(boxes[0].value),
               states: Array.prototype.map.call(
                 document.querySelectorAll('#teachPrompts .note'),
                 function (s) { return s.textContent; }) };`);
    check(tp.n === 5, "every teaching prompt is exposed, the grader included",
      JSON.stringify(tp.ids));
    check(tp.ids.indexOf("tp_grade") !== -1,
      "including the grader, which is a prompt like the rest and editable like the rest",
      JSON.stringify(tp.ids));
    check(tp.hasText, "shown with {text} left in rather than filled in", JSON.stringify(tp));
    check(/custom/.test(tp.states[0]),
      "the seeded override reads as custom", JSON.stringify(tp.states));
    check(tp.states.slice(1).every(x => /tracking/.test(x)),
      "and the untouched ones still track the app's version", JSON.stringify(tp.states));

    // Editing one and closing makes it custom; the others stay on the default.
    await exec(`
      var b = document.querySelector('#tp_explainMine');
      b.value = "MY OWN GRAMMAR PROMPT for {text}";
      document.querySelector('#setX').click();
      return true;`);
    const saved = await exec(`return JSON.parse(localStorage.getItem("hsk1chat.teachPrompts"));`);
    check(saved && saved.explainMine === "MY OWN GRAMMAR PROMPT for {text}",
      "an edited teaching prompt is saved", JSON.stringify(saved));
    check(saved && !saved.transReply && !saved.explainReply,
      "and untouched ones are not frozen into storage", JSON.stringify(saved));

    // Reset puts it back to tracking.
    await exec(`document.querySelector('#btnSet').click(); return true;`);
    await waitFor("document.querySelector('#setSheet').classList.contains('open')", "Settings");
    await exec(`
      document.querySelectorAll('#setSheet .sec')[6].open = true;
      var rows = document.querySelectorAll('#teachPrompts .teachRow');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].querySelector('textarea').id === "tp_explainMine") {
          rows[i].querySelector('button').click(); break;
        }
      }
      return true;`);
    check(await exec(`
      var s = JSON.parse(localStorage.getItem("hsk1chat.teachPrompts"));
      return !s || !s.explainMine;`),
      "Reset to default clears the override");

    // Reopen for the sync checks below; also exercises the summary values.
    await exec(`document.querySelector('#btnSet').click(); return true;`);
    await waitFor("document.querySelector('#setSheet').classList.contains('open')", "Settings again");
    check(!(await exec(`return document.querySelector('#secConnection').open;`)),
      "reopening with a key saved leaves Connection collapsed");
    check(/key saved/.test(await exec(`
      return document.querySelector('#secConnectionNote').textContent;`)),
      "the collapsed Connection row reports that a key is stored");

    /* ------------------------------------------------ level progress */

    await exec(`document.querySelector('#btnSet').click(); return true;`);
    await waitFor("document.querySelector('#setSheet').classList.contains('open')",
      "Settings for the progress panel");

    /* The number that makes the whole feature worth having. A learner at HSK 1
     * has ticked off 41% of the HSK 2 *list* but can already read about 85% of
     * HSK 2 *text*, because the lists are frequency-ordered and language is
     * Zipfian. Asserted as a band, not a constant: the exact figure moves with
     * ZIPF_EXP and with anything the earlier tests added to the word lists, but
     * a panel reporting the list share instead would land near 41% and a broken
     * one would land at 0 or 100. */
    const prog = await exec(`
      return document.querySelector('#progress').textContent;`);
    const pctMatch = /(\d+)% you can read/.exec(prog || "");
    check(!!pctMatch, "the progress panel reports a percentage of the next level",
      JSON.stringify((prog || "").slice(0, 160)));
    /* Both figures are named in words, so the bar's two colors do not have to
     * be decoded from a key that is not on screen. */
    const useMatch = /(\d+)% you can use/.exec(prog || "");
    check(!!useMatch && Number(useMatch[1]) < Number(pctMatch ? pctMatch[1] : 0),
      "and production is labelled and sits below reading",
      JSON.stringify((prog || "").slice(0, 160)));
    const pct = pctMatch ? Number(pctMatch[1]) : -1;
    check(pct > 70 && pct < 100,
      `and it is text coverage (~85%), not list share (~41%) -- got ${pct}%`,
      JSON.stringify((prog || "").slice(0, 160)));

    /* The actionable half: how many words to the threshold. 741 would mean the
     * whole remaining list; the frequency-weighted answer is a few hundred at
     * most, and that difference is the point of the feature. */
    const toGo = /(\d+) more words?, commonest first/.exec(prog || "");
    check(!!toGo && Number(toGo[1]) > 0 && Number(toGo[1]) < 500,
      "and names a reachable number of words to the threshold, not the whole list",
      JSON.stringify((prog || "").slice(0, 200)));
    check(/used by you/.test(prog || ""),
      "production is reported separately from exposure",
      JSON.stringify((prog || "").slice(0, 200)));

    /* Production has no threshold to hit -- the receptive/productive gap widens
     * with proficiency and not every word becomes productive, so a fixed target
     * would be wrong at every level. What is actionable is the list, not a
     * number: words the app taught you that you have never written. Named, not
     * just counted, because three characters you can put in your next message
     * is a prompt and "5 unused" is a statistic. The seed has introduced words
     * and a typed history, so both sides of the subtraction are non-empty. */
    check(/never used/.test(prog || ""),
      "the panel names what to do next, not only what has happened",
      JSON.stringify((prog || "").slice(0, 260)));
    check(/1 of the 2 the app taught you/.test(prog || ""),
      "counting only introduced words the learner has never written",
      JSON.stringify((prog || "").slice(0, 260)));
    /* 已经 is the seeded word the history never uses; 可以 is the one it does.
     * Naming the used one would make the row busywork. */
    check(/never used[\s\S]*?\u5df2\u7ecf/.test(prog || "") &&
          !/never used[\s\S]*?\u53ef\u4ee5/.test(prog || ""),
      "and naming the unused word rather than one already written",
      JSON.stringify((prog || "").slice(0, 260)));

    /* The bug this replaced: the headline was weighted for production and
     * clamped while the words-to-threshold row was not, so the panel showed
     * "100%" and "57 more words to 95%" together. They are the same number
     * read two ways and must never contradict -- checked here rather than only
     * in pace.test.js because what went wrong was the panel wiring the two
     * rows to different functions, which the node suite cannot see. */
    const headline = pct, stillToGo = toGo ? Number(toGo[1]) : -1;
    check((headline >= 95) === (stillToGo === 0),
      "the headline and the words-to-threshold row agree with each other",
      `headline ${headline}%, ${stillToGo} words to go`);
    check(/you can read/.test(prog || "") && /you can use/.test(prog || ""),
      "reading and production are shown as two figures on one scale",
      JSON.stringify((prog || "").slice(0, 200)));

    /* The second bar answers a different question on its own scale. Reading
     * coverage starts near 88% for HSK 1 -> 2 and every word that matters sits
     * in the top twelve points of it, so it looks full on arrival; new words
     * learned runs 0 to 100 across the same effort. Two bars, two scales. */
    const newBar = /(\d+) of (\d+) new words/.exec(prog || "");
    check(!!newBar, "the panel shows new-word progress as its own figure",
      JSON.stringify((prog || "").slice(0, 260)));
    /* 197, not 497. The denominator has to be what HSK 2 *adds*, not its whole
     * cumulative list -- and "bigger than the numerator" is true of both, so
     * the number is pinned. test/pace.test.js pins the list sizes it comes
     * from, so the two cannot drift apart silently. */
    check(!!newBar && Number(newBar[2]) === 197,
      "with a denominator of the level's new words, not its whole list",
      newBar ? newBar[0] : "no match");
    check(await exec(`
      return document.querySelectorAll('#progress .bar').length;`) === 2,
      "and draws it as a second bar rather than folding it into the first");
    /* Its fill must not track the reading bar: they are different numbers and
     * a shared width would mean one of them is lying. */
    check(await exec(`
      var b = document.querySelectorAll('#progress .bar');
      return b[0].querySelector('i').style.width !== b[1].querySelector('i').style.width;`),
      "the two bars are filled independently",
      await exec(`
        var b = document.querySelectorAll('#progress .bar');
        return b[0].querySelector('i').style.width + " vs " + b[1].querySelector('i').style.width;`));

    /* Below the threshold there must be no Move up button: it is a
     * recommendation, and offering it early would make it meaningless. */
    check(await exec(`
      var b = document.querySelector('#moveUp');
      return b.style.display === "none" || b.offsetParent === null;`),
      "Move up is hidden until the threshold is reached");

    check(/% to HSK 2/.test(await exec(`
      return document.querySelector('#secLearningNote').textContent;`)),
      "the collapsed Learning row carries the number without opening it",
      await exec(`return document.querySelector('#secLearningNote').textContent;`));

    /* ------------------------------------------------- the level browser */

    /* The first-level problem: the browser was hardcoded to level+1, so there
     * was no way to see or tick the list you are actually on without dropping
     * a level to look at it from below. */
    await exec(`document.querySelector('#btnLevels').click(); return true;`);
    await waitFor("document.querySelector('#poolSheet').classList.contains('open')",
      "the level browser");
    await waitFor("document.querySelectorAll('#poolList .poolrow').length > 0",
      "the level browser's rows");
    check(await exec(`
      return document.querySelector('#poolLevel').options.length;`) === 7,
      "every level is reachable from the picker",
      await exec(`
        return Array.prototype.map.call(document.querySelector('#poolLevel').options,
          function (o) { return o.textContent; }).join(" | ");`));
    check(await exec(`
      return Number(document.querySelector('#poolLevel').value);`) === 1,
      "Browse opens on your own level, which used to be unreachable");
    /* Grouped rather than one flat scroll, and each heading carries its count.
     * Browsing your own level, everything is already usable, so the group that
     * exists is "Already at your level" -- and its rows must have no tick box,
     * since ticking a word you already have would do nothing. */
    const groups = await exec(`
      return Array.prototype.map.call(
        document.querySelectorAll('#poolList details'),
        function (d) { return d.querySelector('summary').textContent.trim(); });`);
    check(groups.length > 0 && groups.some(g => /Already at your level/.test(g)),
      "the list is grouped by what you have done with each word",
      JSON.stringify(groups));
    check(groups.some(g => /\d/.test(g)),
      "and every heading carries its own count", JSON.stringify(groups));
    check(await exec(`
      return document.querySelectorAll('#poolList details')[0].open;`),
      "the first non-empty group opens, so the sheet never lands on closed headings");
    check(await exec(`
      var d = document.querySelector('#poolList details');
      return d.querySelectorAll('.poolrow').length > 0 &&
             d.querySelectorAll('.poolrow input').length === 0;`),
      "words already at your level have no tick box to ignore");
    /* Commonest first -- the order they are worth learning in, and the order
     * pacing already offers them in. 的 outranks everything in the corpus, so
     * an unsorted or reverse-sorted list cannot start with it. */
    check(await exec(`
      var r = document.querySelectorAll('#poolList .poolrow');
      return r.length ? r[0].querySelector('.w2').textContent : "";`) === "\u7684",
      "and lists the commonest word first",
      await exec(`
        var r = document.querySelectorAll('#poolList .poolrow');
        return Array.prototype.slice.call(r, 0, 5).map(function (x) {
          return x.querySelector('.w2').textContent; }).join(" ");`));

    // Switching levels re-fetches and re-renders, including upward.
    await exec(`
      var sel = document.querySelector('#poolLevel');
      sel.value = "3"; sel.dispatchEvent(new Event("change")); return true;`);
    await waitFor(`document.querySelector('#poolTitle').textContent.indexOf('HSK 3') !== -1`,
      "the browser switching to HSK 3");
    check(await exec(`
      return document.querySelectorAll('#poolList .poolrow').length > 0;`),
      "a level above the next one can be browsed too");
    check(await exec(`
      document.querySelector('#poolX').click();
      return !document.querySelector('#poolSheet').classList.contains('open');`),
      "the level browser closes with the sheet ✕");

    /* ------------------------------------------------------- the grader
     *
     * fetch is stubbed, so nothing here spends a call. What is worth checking
     * is the parsing, because the grader's answer is machine-read: a model
     * that fences its JSON, invents a tag, or claims ok while listing errors
     * must not produce a green tick over a red sheet. */
    await exec(`
      window.__graded = [];
      window.__realFetch2 = window.fetch;
      window.__reply = JSON.stringify({
        ok: false, meant: "I was happy yesterday.", better: "\u6211\u6628\u5929\u5f88\u9ad8\u5174\u3002",
        cats: { word: true, grammar: false, order: true, natural: true },
        errors: [{ tag: "aspect-le", note: "\u4e86 does not attach to a stative adjective" },
                 { tag: "grammar",   note: "a category name, not a tag -- must be dropped" }]
      });
      window.fetch = function (url, opts) {
        window.__graded.push(JSON.parse((opts && opts.body) || "{}"));
        /* Fenced, with prose either side: models do this however firmly the
         * prompt says not to. No line breaks in the fence -- a literal newline
         * inside this template becomes a real one in the injected script and
         * breaks the string it sits in. */
        return Promise.resolve({ ok: true, status: 200, json: function () {
          return Promise.resolve({ choices: [{ message: {
            content: "Sure! " + String.fromCharCode(96,96,96) + "json " + window.__reply + " " + String.fromCharCode(96,96,96) + " Hope that helps." },
            finish_reason: "stop" }] });
        } });
      };
      localStorage.setItem("hsk1chat.apiKey", JSON.stringify("test-key-never-sent"));
      document.querySelector('#input').value = "\u6211\u6628\u5929\u5f88\u9ad8\u5174\u4e86\u3002";
      document.querySelector('#send').click();
      return true;`);
    await waitFor(`document.querySelectorAll('#log .msg.user .grade.bad').length > 0`,
      "the grade badge landing on the message");
    check(true, "a graded message shows a cross rather than a tick");

    const sentGrade = await exec(`
      var c = window.__graded.filter(function (b) {
        return /only a JSON object/.test((b.messages[0] || {}).content || ""); });
      return c.length ? c[0] : null;`);
    check(sentGrade && sentGrade.model === "teaching/model",
      "grading runs on the teaching model, not the chat model",
      sentGrade ? sentGrade.model : "no grade call");
    check(!!sentGrade && /The student wrote:/.test(sentGrade.messages[0].content),
      "and is given the sentence it is grading");

    await exec(`document.querySelector('#log .msg.user .grade.bad').click(); return true;`);
    await waitFor("document.querySelector('#gradeSheet').classList.contains('open')",
      "the grade detail sheet");
    const detail = await exec(`
      return { meant: document.querySelector('#gradeMeant').textContent,
               better: document.querySelector('#gradeBetter').textContent,
               cats: Array.prototype.map.call(document.querySelectorAll('#gradeCats .gcat'),
                 function (c) { return c.className + ":" + c.querySelector('b').textContent; }),
               errs: document.querySelector('#gradeErrors').textContent };`);
    check(/happy yesterday/.test(detail.meant),
      "the sheet shows the intended meaning", JSON.stringify(detail.meant));
    check(detail.better.indexOf("\u6211\u6628\u5929\u5f88\u9ad8\u5174") === 0,
      "and a corrected sentence", JSON.stringify(detail.better));
    check(detail.cats.length === 4, "four category chips", JSON.stringify(detail.cats));
    check(detail.cats.filter(c => /bad/.test(c)).length === 1,
      "exactly the failing one marked bad", JSON.stringify(detail.cats));
    /* The stub returned "grammar" as a tag -- a display category, which the
     * model does emit despite the prompt. It must not reach the sheet or the
     * ledger, where it would become a top mistake nobody can drill. */
    check(/\u4e86/.test(detail.errs) && !/category name/.test(detail.errs),
      "known tags are shown and invented ones dropped", JSON.stringify(detail.errs));

    // Ask a follow-up hands over to the existing grammar chat rather than
    // growing a second one.
    check(await exec(`
      document.querySelector('#gradeAsk').click();
      return document.querySelector('#explainSheet').classList.contains('open') &&
             !document.querySelector('#gradeSheet').classList.contains('open');`),
      "Ask a follow-up opens the grammar chat and closes this sheet");
    await exec(`document.querySelector('#explainClose').click(); return true;`);

    /* ok is recomputed, never trusted: a model claiming ok while listing
     * errors would otherwise show a green tick over a red detail sheet. */
    await exec(`
      window.__reply = JSON.stringify({
        ok: true, meant: "x", better: "y",
        cats: { word: true, grammar: true, order: true, natural: true },
        errors: [{ tag: "measure-word", note: "contradicts its own ok" }] });
      document.querySelector('#input').value = "\u6211\u6709\u4e09\u4e2a\u4e66\u3002";
      document.querySelector('#send').click();
      return true;`);
    await waitFor(`document.querySelectorAll('#log .msg.user .grade').length > 1`,
      "the second grade");
    check(await exec(`
      var b = document.querySelectorAll('#log .msg.user .grade');
      return b[b.length - 1].classList.contains("bad");`),
      "a grade that lists errors is not a pass, whatever its ok field says");

    // Unparseable answers are recorded as unknown, not silently as correct.
    await exec(`
      window.__reply = "not json at all";
      document.querySelector('#input').value = "\u4f60\u597d\u3002";
      document.querySelector('#send').click();
      return true;`);
    await waitFor(`document.querySelectorAll('#log .msg.user .grade.unknown').length > 0`,
      "the unreadable grade");
    check(true, "an unreadable answer shows as unknown rather than as a pass");

    // Top mistakes, counted from the grades just stored.
    await exec(`
      window.fetch = window.__realFetch2;
      document.querySelector('#btnSet').click(); return true;`);
    await waitFor("document.querySelector('#setSheet').classList.contains('open')",
      "Settings for the mistake list");
    const mis = await exec(`return document.querySelector('#mistakes').textContent;`);
    check(/\u4e86/.test(mis) && /measure word/.test(mis),
      "the mistake list counts what the grader logged", JSON.stringify(mis));
    check(!/category name/.test(mis) && !/\bgrammar\b/.test(mis.replace(/grammar check/gi, "")),
      "and never counts a tag the taxonomy does not know", JSON.stringify(mis));

    /* ------------------------------------------- conversation history */

    /* The seeded history predates conversations entirely -- no conversation_id
     * anywhere -- so this also checks the migration: it must arrive as one
     * chat rather than vanishing behind an empty one. */
    await exec(`document.querySelector('#btnChats').click(); return true;`);
    await waitFor("document.querySelector('#chatSheet').classList.contains('open')",
      "the conversations sheet");
    check(await exec(`
      return document.querySelectorAll('#chatList .chatrow').length;`) === 1,
      "a legacy history migrates into exactly one conversation",
      await exec(`return document.querySelector('#chatList').textContent.slice(0, 120);`));
    check((await exec(`
      return document.querySelector('#chatList .chatrow .ctitle').textContent;`))
        .indexOf("\u4f60\u597d") === 0,
      "titled from the first thing the learner said");
    check(await exec(`
      return JSON.parse(localStorage.getItem("hsk1chat.chatId"));`)
        === "00000000-0000-4000-8000-000000000001",
      "under the fixed legacy id, not one invented on this device");

    // New chat: empty log, old one still listed and still holding its messages.
    await exec(`document.querySelector('#newChat').click(); return true;`);
    check(await exec(`
      return document.querySelector('#log').querySelector('.hint') !== null;`),
      "a new chat starts empty");
    await exec(`document.querySelector('#btnChats').click(); return true;`);
    check(await exec(`
      return document.querySelectorAll('#chatList .chatrow').length;`) === 2,
      "and the old one is still in the list");
    check(await exec(`
      return document.querySelectorAll('#chatList .chatrow.on').length;`) === 1,
      "exactly one conversation is marked current");

    // Switching back has to restore the messages, not just the title.
    await exec(`
      var rows = document.querySelectorAll('#chatList .chatrow');
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i].classList.contains("on")) { rows[i].querySelector('.ctitle').click(); break; }
      }
      return true;`);
    await waitFor("document.querySelector('#log').textContent.indexOf('\u4f60\u597d') !== -1",
      "the old conversation reopening with its messages");
    check(true, "switching back restores the conversation's messages");

    /* Deleting leaves a tombstone rather than merely dropping the rows. Without
     * one, a device that was offline re-pushes its copy and the chat returns. */
    await exec(`
      // INSTALL_MOCK does this too, but that runs later, in the sync section.
      window.confirm = function () { return true; };
      document.querySelector('#btnChats').click();
      var rows = document.querySelectorAll('#chatList .chatrow');
      for (var i = 0; i < rows.length; i++) {
        if (!rows[i].classList.contains("on")) {
          var b = rows[i].querySelectorAll('.cacts button');
          for (var j = 0; j < b.length; j++) if (b[j].textContent === "Delete") { b[j].click(); break; }
          break;
        }
      }
      return true;`);
    check(await exec(`
      return document.querySelectorAll('#chatList .chatrow').length;`) === 1,
      "a deleted conversation leaves the list");
    check(await exec(`
      return (JSON.parse(localStorage.getItem("hsk1chat.chats")) || [])
        .filter(function (c) { return c.deleted; }).length;`) === 1,
      "but is kept as a tombstone, so the delete can reach other devices");
    check(await exec(`
      return (JSON.parse(localStorage.getItem("hsk1chat.chats")) || [])
        .filter(function (c) { return c.deleted; })[0].deleted_at != null;`),
      "and the tombstone is stamped");

    // Rename is why the title column ships; it must survive a derived retitle.
    await exec(`
      window.prompt = function () { return "Ordering food"; };
      var b = document.querySelectorAll('#chatList .chatrow .cacts button');
      for (var i = 0; i < b.length; i++) if (b[i].textContent === "Rename") { b[i].click(); break; }
      return true;`);
    check(await exec(`
      return document.querySelector('#chatList .chatrow .ctitle').textContent;`)
        === "Ordering food",
      "renaming a conversation sticks");
    check(await exec(`
      document.querySelector('#chatX').click();
      return !document.querySelector('#chatSheet').classList.contains('open');`),
      "the conversations sheet closes with ✕");

    // Sign in against the mock by switching sync on, exactly as a user would.
    await exec(INSTALL_MOCK);
    /* Settings is a set of collapsed <details> now, and everything below lives
     * inside the sync one. A collapsed section renders nothing but its summary,
     * so the visibility checks at the end would fail for a reason that has
     * nothing to do with what they test. Opening it is also what a user doing
     * this would have done. */
    await exec(`
      document.querySelector("#secSync").open = true;
      return document.querySelector("#secSync").open;`);
    await exec(`
      var box = document.querySelector("#syncOn");
      box.checked = true;
      box.dispatchEvent(new Event("change"));
      return true;`);
    await waitFor("document.querySelector('#syncSignedIn').style.display !== 'none'",
      "the signed-in sync section");
    check(true, "switching sync on reaches a signed-in state against the mock");

    /* The first pull says "Synced just now" and then renderSyncSection() runs
     * immediately after it -- here at the end of the toggle handler, and again
     * on the load that lands back from the GitHub redirect. It used to repaint
     * that line from scratch and blank it, so a sync that had in fact just
     * succeeded reported nothing at all, and pressing "Sync now" was the only
     * way to see the app confirm anything. Asserted after the re-render, which
     * is the whole point: during the pull it was never blank. */
    check(/synced/i.test(await exec(`
      return document.querySelector('#syncStatus').textContent;`)),
      "the first pull's outcome survives the re-render that follows it",
      JSON.stringify(await exec(`
        return document.querySelector('#syncStatus').textContent;`)));

    /* prefsPushedAt has to reach disk, not just memory. In memory it is
     * undefined on every load, so every load takes the "I have never pushed"
     * branch and adopts whatever the cloud holds -- overwriting local settings
     * whenever the cloud is behind, which is exactly the case when you change a
     * setting and reload before the 2s debounce can push it. Reloading to pick
     * up a new version is that case.
     *
     * Driven by changing a real preference and waiting for the push, rather
     * than asserting on a key that a passing test might never have caused to be
     * written. */
    await exec(`
      var b = document.querySelector('#showStarters');
      b.checked = !b.checked; b.dispatchEvent(new Event("change")); return true;`);
    await waitFor(`localStorage.getItem("hsk1chat.prefsPushedAt") !== null`,
      "the prefs push being recorded on disk");
    check(true, "the last prefs push is recorded on disk, so a reload cannot re-adopt a stale cloud copy");

    // The feature under test.
    await exec(`window.__t.calls = []; document.querySelector("#syncWipe").click(); return true;`);
    await waitFor("(document.querySelector('#syncWipeNote').textContent || '').length > 0",
      "the wipe outcome message");

    const calls = await exec("return window.__t.calls;");
    const deletes = calls.filter(c => c.op === "delete");
    const tables = deletes.map(c => c.table).sort();
    const want = ["conversations", "messages", "prefs",
                  "vocab_extra", "vocab_known", "vocab_learning"];

    check(want.every(t => tables.includes(t)),
      "every user table is deleted", "deleted: [" + tables + "]");
    check(tables.length === want.length,
      "nothing outside the user tables is deleted", "deleted: [" + tables + "]");

    /* The ordering the feature depends on. flushSync() checks the sync flag, so
     * a push already on the debounce timer is only harmless if sync went off
     * first -- otherwise it lands after the delete and restores the rows. */
    check(deletes.length > 0 && deletes.every(c => c.syncOnAtCall === false),
      "sync is already off when the first delete is issued",
      JSON.stringify(deletes.map(c => ({ t: c.table, syncOn: c.syncOnAtCall }))));

    check(!(await exec("return document.querySelector('#syncOn').checked;")),
      "the sync toggle ends up off");
    check(await exec("return document.querySelector('#log').textContent.indexOf('你好') === -1;") &&
          await exec("return document.querySelector('#log').querySelector('.hint') !== null;"),
      "the conversation is cleared on this device",
      await exec("return document.querySelector('#log').textContent.slice(0, 120);"));
    check(/deleted/i.test(await exec("return document.querySelector('#syncWipeNote').textContent;")),
      "the outcome is reported",
      await exec("return document.querySelector('#syncWipeNote').textContent;"));
    /* renderSyncSection() hides the signed-in block the moment sync goes off,
     * so a message placed inside it would vanish exactly when it matters. */
    check(await exec(`
      var n = document.querySelector('#syncWipeNote');
      return n.offsetParent !== null || n.getClientRects().length > 0;`),
      "the outcome message is still visible after the section is hidden");

    /* ------------------------------------------------ the vocabulary sheet */

    await exec(`document.querySelector('#btnVocab').click(); return true;`);
    await waitFor("document.querySelector('#vocabSheet').classList.contains('open')",
      "the vocabulary sheet");

    /* Adding a word the level already covers is a no-op inside addWords(), and
     * a silent one: the box clears, the list does not change, and the Add
     * button looks broken. 你 is HSK 1, so it is covered at every level the app
     * offers. Asserted on the note, not on the list, because "nothing was
     * added" is the correct behavior -- the bug was never saying so. */
    await exec(`
      document.querySelector('#addWord').value = "你";
      document.querySelector('#addWordBtn').click();
      return true;`);
    const addNote = await exec(`return document.querySelector('#addNote').textContent;`);
    check(addNote.indexOf("你") !== -1 && /already/i.test(addNote),
      "adding a word already on the list says so instead of ignoring it",
      JSON.stringify(addNote));

    /* Same sticky ✕ as Settings, and it has to actually close. The word box is
     * empty here, so closeVocab()'s commit is the no-op path -- the committing
     * half is checked below. */
    check(await exec(`
      document.querySelector('#vocabX').click();
      return !document.querySelector('#vocabSheet').classList.contains('open');`),
      "the ✕ closes the vocabulary sheet");

    /* A word still sitting unsubmitted in the box is the one thing closing
     * could throw away, so ✕ adds it on the way out -- "exit and save", the
     * same contract Settings' ✕ has. 咖啡 is HSK 3 and absent from HSK 1, which
     * is the level this run is at, so it is genuinely an addition rather than
     * another already-covered no-op. */
    await exec(`
      document.querySelector('#btnVocab').click();
      document.querySelector('#addWord').value = "咖啡";
      document.querySelector('#vocabX').click();
      return true;`);
    check(await exec(`
      return (JSON.parse(localStorage.getItem("hsk1chat.extraVocab")) || [])
        .some(function (e) { return e.w === "咖啡"; });`),
      "and commits a word left in the box rather than discarding it",
      await exec(`return localStorage.getItem("hsk1chat.extraVocab");`));

    /* ------------------------------------------------------- activities */

    /* S is a const in index.html so it is not on window; top-level function
     * declarations are. Conversation state is read back through currentChat()
     * and through the localStorage key saveChats() writes. */
    await exec("window.newChat('story');");
    check(await exec("return window.currentActivity();") === "story",
      "a chat created as story time reports story");
    check(await exec("return window.currentChat().activity;") === "story",
      "and the activity is on the conversation object");
    check(JSON.parse(await exec("return localStorage.getItem('hsk1chat.chats');"))[0].activity
      === "story", "and it is persisted, not only held in memory");

    await exec("window.newChat();");
    check(await exec("return window.currentActivity();") === "chat",
      "newChat with no argument is a chat");

    // Conversations written before activities existed carry none at all.
    await exec("window.newChat('story'); delete window.currentChat().activity;");
    check(await exec("return window.currentActivity();") === "chat",
      "a conversation with no activity reads as chat");

    // Switching activity leaves the conversation you were in alone.
    const beforeId = await exec("return window.currentChat().id;");
    await exec("window.startActivity('focused');");
    check(await exec("return window.currentChat().id;") !== beforeId,
      "startActivity opens a different conversation");
    check(await exec("return window.currentActivity();") === "focused",
      "and that conversation is in the new activity");
    check(await exec(
      "var raw = JSON.parse(localStorage.getItem('hsk1chat.chats') || '[]');" +
      "var want = arguments[0];" +
      "return raw.filter(function (c) { return c.id === want; }).length;",
      [beforeId]) === 1, "and the previous conversation still exists");


    /* ------------------------------------------- the header after the swap */

    check(await exec("return !document.querySelector('#model');") === true,
      "the header model picker is gone");
    check(await exec("return !!document.querySelector('#modelChat');") === true,
      "but Settings still has one");
    check(await exec("return !document.querySelector('header #level');") === true,
      "the level picker has left the header");
    check(await exec("return !!document.querySelector('#level');") === true,
      "and is still in the document, in Settings");
    check(await exec("return !!document.querySelector('#activity');") === true,
      "the header has an activity selector");

    /* The chip navigates, so it is a control: focusable and announced. Its
     * visible text ("HSK 1") does not say what it does, hence the aria-label. */
    check(await exec("return document.querySelector('#levelChip').tagName;") === "BUTTON",
      "the level chip is a button, not a styled span");
    check(await exec(
      "return !!document.querySelector('#levelChip').getAttribute('aria-label');") === true,
      "the level chip has an aria-label");

    /* The handler awaits loadLevel() before anything re-renders, so this has to
     * wait for the wordlist rather than read the chip straight back. */
    await exec("var l = document.querySelector('#level');" +
               "l.value = '3'; l.dispatchEvent(new Event('change'));");
    let chipFollowed = true;
    try {
      await waitFor("document.querySelector('#levelChip').textContent.indexOf('3') !== -1",
        "the level chip catching up", 15000);
    } catch (e) { chipFollowed = false; }
    check(chipFollowed, "the chip follows the level set in Settings",
      await exec("return document.querySelector('#levelChip').textContent;"));

    /* Back to HSK 1 for everything below: the focused-chat block seeds words
     * introduced from HSK 2, and readiness() only counts those as unused while
     * the current level is below the level they came from. */
    await exec("var l = document.querySelector('#level');" +
               "l.value = '1'; l.dispatchEvent(new Event('change'));");
    await waitFor("document.querySelector('#levelChip').textContent.indexOf('1') !== -1",
      "the level back at HSK 1", 15000);

    const actOpts = await exec(
      "return Array.prototype.map.call(document.querySelectorAll('#activity option')," +
      "function (o) { return o.value; });");
    check(actOpts.indexOf("chat") !== -1 && actOpts.indexOf("focused") !== -1 &&
          actOpts.indexOf("story") !== -1,
      "all three activities are offered", JSON.stringify(actOpts));

    await exec(
      "var s = document.querySelector('#activity');" +
      "s.value = 'focused'; s.dispatchEvent(new Event('change'));");
    check(await exec("return window.currentActivity();") === "focused",
      "choosing an activity opens a conversation in it");

    /* The activity change above started an opening turn against the seeded
     * key, and everything below is about the busy state, so wait for that one
     * to finish first or it is the turn being observed. */
    await waitFor("document.querySelector('#send').textContent === '\\u9001'",
      "the focused-chat opening turn to settle", 30000);

    /* S.busy is not reachable from here, so the only way to observe the busy
     * state is to be in it: a stub that never resolves on its own holds the app
     * there until the test lets it go. \u505c is the stop button, \u9001 send. */
    await exec(
      "window.__rej = null;" +
      "window.callModel = function () {" +
      "  return new Promise(function (_, rej) { window.__rej = rej; });" +
      "};");
    await exec("window.newChat('story'); window.storyStep();");
    await waitFor("document.querySelector('#send').textContent === '\\u505c'",
      "the send button becomes a stop button while a turn is running");
    check(await exec("return document.querySelector('#activity').disabled;") === true,
      "and the activity selector is locked for as long as it runs");
    check(/Writing part 1 of 5/.test(await exec(
      "return document.querySelector('#log').textContent;")),
      "a story segment says what it is generating rather than showing a bare ellipsis");

    /* Stopping is a decision, not a failure: busy clears, the composer comes
     * back, and nothing is written to the log. */
    await exec("window.__rej({ kind: 'stopped' });");
    await waitFor("document.querySelector('#send').textContent === '\\u9001'",
      "stopping a turn clears the busy state");
    check(await exec("return document.querySelectorAll('#log .notice').length;") === 0,
      "a stopped turn leaves no error card behind");
    check(await exec("return document.querySelectorAll('#log .msg.bot').length;") === 0,
      "and no half-written segment");


    /* --------------------------------- the chat list, and who gets starters */

    await exec("window.newChat('story'); window.renderChats();");
    const meta = await exec(
      "var m = document.querySelector('#chatList .cmeta'); return m ? m.textContent : '';");
    check(/Story time/.test(meta),
      "the chat list says which activity a conversation was", meta);
    check(/message/.test(meta), "and still says how many messages", meta);

    /* Starters are openers for the LEARNER, so only chat wants them. The sync
     * block above flipped the global toggle to drive a prefs push, so put it
     * back first -- otherwise all three cases below are empty for a reason that
     * has nothing to do with activities. */
    await exec("var b = document.querySelector('#showStarters');" +
               "b.checked = true; b.dispatchEvent(new Event('change'));");
    await exec("window.newChat('chat'); window.renderStarters();");
    check(await exec("return document.querySelectorAll('#starters button').length;") > 0,
      "chat offers starters");
    await exec("window.newChat('story'); window.renderStarters();");
    check(await exec(
      "return document.querySelectorAll('#starters button:not(.story)').length;") === 0,
      "story time does not -- the partner speaks first");
    check(await exec(
      "var b = document.querySelector('#starters button.story');" +
      "return b ? b.textContent : '';") === "Start the story",
      "it gets a control instead, so the story advances on a tap and not on a timer");
    await exec("window.newChat('focused'); window.renderStarters();");
    check(await exec("return document.querySelectorAll('#starters button').length;") === 0,
      "and neither does focused chat");


    /* ------------------------------------------- the partner opening a turn */

    /* The model is stubbed in-page, the same way this file already stubs
     * supabase. callModel is a top-level function declaration, so it is a
     * writable window property and reassigning it changes what turn() resolves
     * at call time. \u4eca\u5929\u5f88\u597d is HSK 1 and carries no name --
     * a name would fail validation and land every turn on the canned fallback,
     * which would prove nothing about the opening path. */
    await exec(
      "window.callModel = function () { return Promise.resolve('\\u4eca\\u5929\\u5f88\\u597d\\u3002'); };");
    await exec("window.newChat('focused');");
    await exec("window.openingTurn();");
    await waitFor("document.querySelectorAll('#log .msg').length > 0", "the opening reply");

    const cls = await exec(
      "return Array.prototype.map.call(document.querySelectorAll('#log .msg')," +
      "function (m) { return m.className; });");
    check(cls.length > 0, "an opening turn produced a message");
    check(/bot/.test(cls[0]), "and the first message is the partner's", JSON.stringify(cls));
    check(!cls.some(c => /\buser\b/.test(c)),
      "with no learner turn invented to justify it", JSON.stringify(cls));


    /* ------------------------------------------------------- focused chat */

    /* S.learning is seeded through localStorage and a reload, exactly the way
     * this file already seeds it further up. Sync is off by this point (the
     * wipe turned it off), so the reload needs no supabase mock reinstalled. */
    await exec(
      "localStorage.setItem('hsk1chat.learning', JSON.stringify([" +
      "{w:'\\u82f9\\u679c',p:'ping guo',d:'apple',seen:9,from:2}," +
      "{w:'\\u7c73\\u996d',p:'mi fan',d:'rice',seen:9,from:2}]));");
    await go(base);
    await waitFor("document.querySelector('#activity')", "app ready after reload");
    // readiness() is null until the next level's wordlist has loaded.
    await waitFor("window.readiness && window.readiness() !== null",
      "the next level's wordlist", 20000);
    await exec("window.newChat('focused');");

    const focusedReuse = await exec(
      "return window.reuseFor('focused').map(function (e) { return e.w; });");
    check(focusedReuse.indexOf("\u82f9\u679c") !== -1,
      "focused chat reuses a word the learner has never written",
      JSON.stringify(focusedReuse));
    const chatReuse = await exec(
      "return window.reuseFor('chat').map(function (e) { return e.w; });");
    check(JSON.stringify(chatReuse) !== JSON.stringify(focusedReuse),
      "and chat does not draw from the same list",
      JSON.stringify(chatReuse) + " vs " + JSON.stringify(focusedReuse));

    const fp = await exec(
      "return window.systemPrompt([], window.reuseFor('focused'), '');");
    check(/\u5fc5\u987b\u7528\u5230\u8fd9\u4e9b\u8bcd/.test(fp),
      "the focused-chat rule asks the partner to build openings, not merely to use the words");


    /* --------------------------------------------------- story time, part 1 */

    /* \u4ed6\u53bb\u4e86\u5b66\u6821 rather than \u5c0f\u738b\u53bb\u4e86\u5b66\u6821:
     * \u738b arrives at HSK 4, so a stub carrying it would fail validation on
     * every segment and land the whole story on the canned fallback, proving
     * nothing about segment generation. Same rule CLAUDE.md states for
     * measurement -- run name-free. */
    await exec(
      "window.callModel = function () { return Promise.resolve('\\u4ed6\\u53bb\\u4e86\\u5b66\\u6821\\u3002'); };");
    await exec("window.newChat('story');");
    await exec("(async function () { for (var i = 0; i < 6; i++) await window.storyStep(); })();");
    await waitFor("document.querySelectorAll('#log .msg.bot').length >= 5",
      "five story segments");

    check(await exec("return document.querySelectorAll('#log .msg.bot').length;") >= 5,
      "a story is five segments");
    check(await exec("return document.querySelectorAll('#log .msg.user').length;") === 0,
      "generated without inventing a learner turn");
    check(await exec(
      "return Array.prototype.every.call(document.querySelectorAll('#log .msg.bot')," +
      "function (m) { return m.textContent.trim().length > 0; });") === true,
      "and every segment has text");


    /* --------------------------------------------------- story time, part 2 */

    /* The stub answers with a question only when the story is over, so the last
     * message proves the hand-off to phase two happened. */
    await exec(
      "window.__seg = 0;" +
      "window.callModel = function (msgs) {" +
      "  window.__seg++;" +
      "  var sys = msgs[0].content;" +
      "  if (sys.indexOf('\\u95ee\\u5b66\\u751f\\u4e00\\u4e2a') !== -1)" +
      "    return Promise.resolve('\\u4ed6\\u53bb\\u4e86\\u54ea\\u513f\\uff1f');" +
      "  return Promise.resolve('\\u4ed6\\u53bb\\u4e86\\u5b66\\u6821\\u3002');" +
      "};");
    await exec("window.newChat('story');");
    await exec("(async function () { for (var i = 0; i < 6; i++) await window.storyStep(); })();");
    await waitFor("document.querySelectorAll('#log .msg.bot').length >= 6",
      "five segments and a question");

    const lastMsg = await exec(
      "var all = document.querySelectorAll('#log .msg.bot');" +
      "return all.length ? all[all.length - 1].textContent : '';");
    check(/\uff1f/.test(lastMsg),
      "after the last segment the partner asks about the story", lastMsg);

    /* A segment that exhausts its attempts must not end the story. The stub
     * returns an out-of-level word for one segment only, which drives turn()
     * through every repair attempt and out the failure path. */
    await exec(
      "window.__n = 0;" +
      "window.callModel = function () {" +
      "  window.__n++;" +
      "  if (window.__n >= 3 && window.__n <= 5)" +
      "    return Promise.resolve('\\u91ce\\u9910\\u78bb\\u3002');" +
      "  return Promise.resolve('\\u4ed6\\u53bb\\u4e86\\u5b66\\u6821\\u3002');" +
      "};");
    await exec("window.newChat('story');");
    await exec("(async function () { for (var i = 0; i < 6; i++) await window.storyStep(); })();");
    await waitFor("document.querySelectorAll('#log .msg.bot').length >= 5",
      "the story survived a bad segment");
    check(await exec("return document.querySelectorAll('#log .msg.bot').length;") >= 5,
      "a segment that exhausts its attempts does not stop the story");


    /* ------------------------------------------- story time names its cast */

    /* The node suite can prove the names reach the prompt; only here can it be
     * shown they reach the LEXICON, which is what decides whether the app
     * rejects a reply for using the name it just asked for. \u5c0f\u660e is
     * the case the whole whitelist exists for: \u660e is absent from every
     * band the app offers, including 7-9, so without the injection this reply
     * fails validation three times and lands on the canned fallback. */
    await exec(
      "window.callModel = function () { return Promise.resolve('\\u5c0f\\u660e\\u53bb\\u4e86\\u5b66\\u6821\\u3002'); };");
    await exec("window.newChat('story');");
    await exec("(async function () { for (var i = 0; i < 6; i++) await window.storyStep(); })();");
    await waitFor("document.querySelectorAll('#log .msg.bot').length >= 5",
      "a story about a named character");

    const named = await exec(
      "return Array.prototype.map.call(document.querySelectorAll('#log .msg.bot')," +
      "function (m) { return m.textContent; });");
    check(named.slice(0, 5).every(t => t.indexOf("\u5c0f\u660e") !== -1),
      "a named character survives validation instead of falling back",
      JSON.stringify(named.slice(0, 5)));

    /* ------------------------- a story is a conversation you can come back to */

    /* The bug this replaced the loop for: a five-segment loop wrote nothing to
     * storage until its first segment landed, so backgrounding the tab during
     * the slowest call in the app lost the whole story. Stepping persists as it
     * goes, and what is in storage is what survives a reload. */
    await exec(
      "window.callModel = function () { return Promise.resolve('\\u4ed6\\u53bb\\u4e86\\u5b66\\u6821\\u3002'); };");
    await exec("window.newChat('story');");
    const storyId = await exec("return window.currentChat().id;");
    await exec("(async function () { for (var i = 0; i < 2; i++) await window.storyStep(); })();");
    await waitFor("window.storyTold() === 2", "two segments told");
    check(await exec(
      "var m = JSON.parse(localStorage.getItem('hsk1chat.chatMsgs'))[arguments[0]];" +
      "return m.filter(function (t) { return t.role === 'assistant'; }).length;",
      [storyId]) === 2,
      "each segment is in storage the moment it is told, not when the story ends");

    /* The position is derived from the transcript, so an unfinished story picked
     * up on any device knows where it was without a stored counter -- which is
     * as well, since db/schema.sql has no column to sync one in. */
    await exec("window.newChat('chat');");
    await exec("window.openChat(arguments[0]);", [storyId]);
    check(await exec("return window.storyTold();") === 2,
      "reopening a half-told story knows how far it got");
    check(await exec(
      "var b = document.querySelector('#starters button.story'); return b ? b.textContent : '';")
      === "Read on (3 of 5)",
      "and offers to read on from there");
    check(await exec("return document.querySelector('#input').disabled;") === true,
      "the composer stays shut while the story is still being told");
    check(await exec("return document.querySelector('#input').placeholder;") === "",
      "and does not ask for a sentence there is nowhere to put");

    /* The chat list is how you get back to it, so it has to be nameable. A story
     * has no learner turn, and titleFrom used to look only at those. */
    await exec("window.renderChats();");
    check(await exec(
      "var rows = document.querySelectorAll('#chatList .chatrow');" +
      "for (var i = 0; i < rows.length; i++)" +
      "  if (/Story time/.test(rows[i].querySelector('.cmeta').textContent))" +
      "    return rows[i].querySelector('.ctitle').textContent;" +
      "return '';") !== "New chat",
      "a saved story is named after its own first line, not left as \"New chat\"");

    // Finish it: after the question, phase two is ordinary chat and reopens the composer.
    await exec("(async function () { for (var i = 0; i < 4; i++) await window.storyStep(); })();");
    await waitFor("window.storyTold() === 6", "the story runs out at five segments and a question");
    await exec("window.renderStarters();");
    check(await exec(
      "return document.querySelectorAll('#starters button.story').length;") === 0,
      "a finished story stops offering to continue");
    check(await exec("return document.querySelector('#input').disabled;") === false,
      "and hands the composer back so the question can be answered");
    check(await exec("return document.querySelector('#input').placeholder;") ===
      "\u7528\u4e2d\u6587\u5199\u2026",
      "with the prompt to write in Chinese back where it belongs");


    /* The cast is legal for the activity that was told about it, not globally.
     * The identical reply in a chat must still be rejected -- three attempts,
     * then the canned fallback -- or the whitelist has quietly widened the
     * allowlist for every conversation. */
    await exec("window.newChat('chat');");
    await exec(
      "window.__msgs = [];" +
      "document.querySelector('#composer') || 0;" +
      "window.callModel = function () {" +
      "  window.__msgs.push(1);" +
      "  return Promise.resolve('\\u5c0f\\u660e\\u53bb\\u4e86\\u5b66\\u6821\\u3002');" +
      "};");
    await exec("window.openingTurn();");
    await waitFor("document.querySelectorAll('#log .msg.bot').length >= 1",
      "the chat reply");
    const chatReply = await exec(
      "var b = document.querySelectorAll('#log .msg.bot');" +
      "return b[b.length - 1].textContent;");
    check(chatReply.indexOf("\u5c0f\u660e") === -1,
      "the same named reply is still rejected in a chat -- the cast does not leak",
      chatReply);
    check(await exec("return window.__msgs.length;") > 1,
      "and it cost the repair attempts, which is what rejection means",
      String(await exec("return window.__msgs.length;")));


    /* ------------------------------------------ the story-time model setting */

    /* Measured: story time produces nothing usable on the cheap chat model at
     * HSK 1 -- 2 usable segments in 55 against 33 in 40 on Sonnet. So it gets
     * its own model, and the default is capable rather than cheap. */
    check(await exec("return !!document.querySelector('#storyModel');") === true,
      "Settings has a story-time model picker");
    check(await exec("return window.storyModel();") === "anthropic/claude-sonnet-4.5",
      "and defaults to a model that can actually do it",
      await exec("return window.storyModel();"));

    /* The model has to reach the request, not just the setting. callModel's
     * third argument is what turn() passes through. */
    await exec(
      "window.__models = [];" +
      "window.callModel = function (msgs, maxTok, model) {" +
      "  window.__models.push(model || null);" +
      "  return Promise.resolve('\\u4ed6\\u53bb\\u4e86\\u5b66\\u6821\\u3002');" +
      "};");
    await exec("window.newChat('story');" +
      "(async function () { for (var i = 0; i < 6; i++) await window.storyStep(); })();");
    await waitFor("document.querySelectorAll('#log .msg.bot').length >= 5", "a story");
    check(await exec(
      "return window.__models.length > 0 && window.__models.every(function (m) {" +
      "  return m === 'anthropic/claude-sonnet-4.5'; });") === true,
      "story turns request the story model",
      JSON.stringify(await exec("return window.__models;")));

    // A chat turn must not, or every conversation silently costs story money.
    await exec("window.__models = []; window.newChat('chat');");
    await exec("window.openingTurn();");
    await waitFor("window.__models.length > 0", "a chat turn");
    check(await exec(
      "return window.__models.every(function (m) { return !m; });") === true,
      "while a chat turn does not -- it uses the chat model",
      JSON.stringify(await exec("return window.__models;")));

    /* An empty completion is one call in eight and used to end a story on a
     * notice card. One retry, inside turn(), so every activity gets it. */
    await exec(
      "window.__n = 0;" +
      "window.callModel = function () {" +
      "  window.__n++;" +
      "  if (window.__n === 1) { var e = new Error(''); e.kind = 'empty'; return Promise.reject(e); }" +
      "  return Promise.resolve('\\u4ed6\\u53bb\\u4e86\\u5b66\\u6821\\u3002');" +
      "};");
    await exec("window.newChat('chat'); window.openingTurn();");
    await waitFor("document.querySelectorAll('#log .msg.bot').length >= 1",
      "a reply after one empty completion");
    check(await exec(
      "var b = document.querySelectorAll('#log .msg.bot');" +
      "return b.length && b[b.length - 1].textContent.indexOf('\\u5b66\\u6821') !== -1;") === true,
      "an empty completion is retried rather than ending the turn");
    check(await exec("return document.querySelectorAll('#log .msg.notice').length;") === 0,
      "and no error card is shown for it");

  } catch (e) {
    fail++; bad.push("harness: " + (e && e.message || e));
  } finally {
    await shutdown();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
})();
