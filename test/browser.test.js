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
            text: "1. **Is it correct?** Yes.\\n- a bullet\\n### A heading" }] }
      ]));
      /* Only the teaching model is seeded. The chat model is left alone so the
       * shipped default is what runs, which is the thing worth asserting -- and
       * it still differs from the teaching id, so a call can be attributed to
       * one or the other. Read into S at boot, so it has to be here rather
       * than set later. The API key deliberately is NOT: boot opens the
       * Settings sheet when no key is stored, and the wipe checks further down
       * assert on an element inside that sheet, so seeding a key here hides it
       * and breaks a test that has nothing to do with models. */
      localStorage.setItem("hsk1chat.teachModel", JSON.stringify("teaching/model"));
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
     * is MODELS[0] reaching the header picker unaided -- the cheap model the
     * app was tuned against, not whichever frontier name happens to be first in
     * the list. */
    check(await exec(`return document.querySelector('#model').value;`)
            === "qwen/qwen3-30b-a3b-instruct-2507",
      "a fresh install defaults to the cheap Qwen model",
      await exec(`return document.querySelector('#model').value;`));

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

    /* One setting, three controls. Leaving any of them stale would show you a
     * model you are not actually talking to. */
    await exec(`
      var sel = document.querySelector('#modelChat');
      sel.value = "big/one";
      sel.dispatchEvent(new Event("change"));
      return true;`);
    const synced = await exec(`
      return { header: document.querySelector('#model').value,
               box: document.querySelector('#modelId').value,
               stored: JSON.parse(localStorage.getItem("hsk1chat.model")) };`);
    check(synced.header === "big/one", "choosing in Settings moves the header picker", JSON.stringify(synced));
    check(synced.box === "big/one", "and the paste-an-id box", JSON.stringify(synced));
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
      return { header: document.querySelector('#model').value,
               chat: document.querySelector('#modelChat').value,
               stored: JSON.parse(localStorage.getItem("hsk1chat.model")) };`);
    check(pasted.header === "someone/not-in-the-catalogue",
      "pasting an id updates the header picker at once", JSON.stringify(pasted));
    check(pasted.chat === "someone/not-in-the-catalogue",
      "and the Settings picker, without closing and reopening", JSON.stringify(pasted));
    check(pasted.stored === "someone/not-in-the-catalogue",
      "and is persisted", JSON.stringify(pasted));

    // Put a real id back so the commit checks below are not asserting on junk.
    await exec(`
      var b = document.querySelector('#modelId');
      b.value = "big/one"; b.dispatchEvent(new Event("change")); return true;`);

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

    // Reopen for the sync checks below; also exercises the summary values.
    await exec(`document.querySelector('#btnSet').click(); return true;`);
    await waitFor("document.querySelector('#setSheet').classList.contains('open')", "Settings again");
    check(!(await exec(`return document.querySelector('#secConnection').open;`)),
      "reopening with a key saved leaves Connection collapsed");
    check(/key saved/.test(await exec(`
      return document.querySelector('#secConnectionNote').textContent;`)),
      "the collapsed Connection row reports that a key is stored");

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

    // The feature under test.
    await exec(`window.__t.calls = []; document.querySelector("#syncWipe").click(); return true;`);
    await waitFor("(document.querySelector('#syncWipeNote').textContent || '').length > 0",
      "the wipe outcome message");

    const calls = await exec("return window.__t.calls;");
    const deletes = calls.filter(c => c.op === "delete");
    const tables = deletes.map(c => c.table).sort();
    const want = ["messages", "prefs", "vocab_extra", "vocab_known", "vocab_learning"];

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
  } catch (e) {
    fail++; bad.push("harness: " + (e && e.message || e));
  } finally {
    await shutdown();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
})();
