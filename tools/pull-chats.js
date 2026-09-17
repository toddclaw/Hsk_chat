/* Pull the whole chat history out of the app's own database, for measurement.
 *
 * The first version of this took only role=assistant text, to keep the read as
 * narrow as the question. The question got bigger: round nineteen showed that a
 * partner turn means nothing without knowing which ACTIVITY and therefore which
 * MODEL produced it -- story time runs on claude-sonnet-4.5 and everything else
 * on qwen, and pooling them produced a headline that was exactly backwards.
 *
 * conversations.activity is a real column. Guessing it from whether the text
 * mentions 小明 was a stopgap and this replaces it.
 *
 * WHAT IT TAKES NOW, and it is a lot: both roles, the grader's verdict, the
 * explanation thread, the translation, and the conversation's activity and
 * level. That is the learner's own writing and everything the app ever said
 * about it. It is taken because the grader's stored verdicts are a free
 * benchmark -- every one of them is a judgement on a real sentence that can be
 * scored against a fresh label -- and because the learner's half is the other
 * thing the gate has to judge.
 *
 * IT DOES NOT GO IN THE REPOSITORY. There is no .gitignore here, so a file of
 * real chat history written into tools/ is one `git add .` away from being
 * published. Default output is ~/Documents.
 *
 * The key is read from a file into a variable and never appears in a command
 * line, as CLAUDE.md requires of the OpenRouter key -- which is why this is a
 * script and not a curl.
 *
 *   node tools/pull-chats.js [--out ~/Documents/chat-export.json]
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };

const KEY_FILE = process.env.SUPABASE_KEY_FILE ||
  path.join(os.homedir(), "Documents", "supabase_key.txt");
const OUT = arg("out", path.join(os.homedir(), "Documents", "chat-export.json"));
const PAGE = 1000;                                  // PostgREST's default ceiling

/* index.html is the single source of truth for this. */
const URL = (function () {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/const SUPABASE_URL\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("SUPABASE_URL not found in index.html");
  return m[1];
})();

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("no key in " + KEY_FILE); process.exit(1); }

/* Optional columns are probed rather than assumed, the same way the app does it:
 * an un-migrated database should degrade to fewer fields, not fail the pull. */
async function page(table, select, from) {
  const r = await fetch(URL + "/rest/v1/" + table + "?select=" + select +
                        "&order=created_at.asc",
    { headers: { apikey: KEY, Authorization: "Bearer " + KEY,
                 Range: from + "-" + (from + PAGE - 1) } });
  if (!r.ok) throw new Error(table + ": HTTP " + r.status + " " + (await r.text()).slice(0, 160));
  return r.json();
}

async function all(table, select) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const p = await page(table, select, from);
    out.push.apply(out, p);
    if (p.length < PAGE) return out;
  }
}

(async () => {
  let cols = "id,conversation_id,role,text,kind,grade,explain_chat,translation," +
             "attempts,failed,created_at,user_id";
  let msgs;
  try { msgs = await all("messages", cols); }
  catch (e) {
    console.warn("full column set refused (" + e.message.slice(0, 60) + "), falling back");
    cols = "id,role,text,created_at,user_id";
    msgs = await all("messages", cols);
  }
  let convs = [];
  try { convs = await all("conversations", "id,title,activity,level,side,created_at"); }
  catch (e) { console.warn("conversations unavailable: " + e.message.slice(0, 60)); }

  const act = new Map(convs.map(c => [c.id, c]));
  const users = new Set();
  const items = msgs.map((m, i) => {
    users.add(m.user_id);
    const c = act.get(m.conversation_id) || {};
    return {
      id: "M" + String(i + 1).padStart(4, "0"),
      role: m.role,
      /* The activity is the whole point of the re-pull: it decides which model
       * wrote the row, and therefore what the row is evidence about. */
      activity: c.activity || null,
      level: c.level || null,
      kind: m.kind || null,
      text: String(m.text || ""),
      grade: m.grade || null,
      explain: m.explain_chat || null,
      translation: m.translation || null,
      attempts: m.attempts == null ? null : m.attempts,
      failed: !!m.failed,
      day: String(m.created_at || "").slice(0, 10)
    };
  });

  fs.writeFileSync(OUT, JSON.stringify({
    source: "the app's own messages and conversations tables",
    note: "Real chat history. Both roles, plus the grader's stored verdicts and " +
          "the explanation threads. Activity comes from conversations.activity, " +
          "which decides which model wrote a partner turn.",
    pulled: new Date().toISOString(), accounts: users.size,
    conversations: convs.length, items: items
  }, null, 1));

  const by = {};
  for (const it of items) {
    const k = (it.activity || "(none)") + "/" + it.role;
    by[k] = (by[k] || 0) + 1;
  }
  console.log("accounts " + users.size + "   conversations " + convs.length +
              "   messages " + items.length);
  console.log("with a stored grade: " + items.filter(i => i.grade).length +
              "   with an explanation: " + items.filter(i => i.explain).length);
  for (const k of Object.keys(by).sort()) console.log("  " + k.padEnd(22) + by[k]);
  console.log("-> " + OUT);
})().catch(e => { console.error(String(e.message || e)); process.exit(1); });
