/* Pull the partner's real Chinese out of the app's own database.
 *
 * Everything in partner-corpus.json is synthetic: the partner is real, but it is
 * replying to a SIMULATED learner, so the conversations are a model's idea of a
 * beginner rather than a beginner. The one number the whole correctness gate
 * rests on -- the partner is outright wrong 8.8% of the time -- is therefore an
 * artefact of that simulation until it is checked against real traffic.
 *
 * WHAT THIS TAKES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Only `role = assistant`, and only the `text` column. The learner's own
 * sentences are not needed to measure a partner grader, so they are not read.
 * No ids, no user_id, no timestamps beyond the day, nothing that reconstructs a
 * conversation.
 *
 * The output lands OUTSIDE the repository by default. This repo has no
 * .gitignore, so a file of real chat history written into tools/ is one `git
 * add .` away from being published.
 *
 * The key is read from a file into a variable and never appears in a command
 * line, exactly as CLAUDE.md requires of the OpenRouter key -- which is also why
 * this is a script rather than a curl.
 *
 *   node tools/pull-partner.js [--out ~/Documents/real-partner.json] [--limit 5000]
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };

const KEY_FILE = process.env.SUPABASE_KEY_FILE ||
  path.join(os.homedir(), "Documents", "supabase_key.txt");
const OUT = arg("out", path.join(os.homedir(), "Documents", "real-partner.json"));
const LIMIT = Number(arg("limit", 5000));
const PAGE = 1000;                                  // PostgREST's default ceiling

/* index.html is the single source of truth for this; hard-coding it here would
 * be a second copy to forget to update. */
const URL = (function () {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/const SUPABASE_URL\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("SUPABASE_URL not found in index.html");
  return m[1];
})();

const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("no key in " + KEY_FILE); process.exit(1); }

(async () => {
  const rows = [];
  const users = new Set();
  for (let from = 0; from < LIMIT; from += PAGE) {
    const r = await fetch(URL + "/rest/v1/messages?role=eq.assistant" +
                          "&select=text,user_id,created_at&order=created_at.asc",
      { headers: { apikey: KEY, Authorization: "Bearer " + KEY,
                   Range: from + "-" + (from + PAGE - 1) } });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
    const page = await r.json();
    if (!page.length) break;
    /* user_id is read only to report how many accounts are in the table -- the
     * service key bypasses RLS, so a shared deployment would hand back other
     * people's conversations, and that is worth knowing before anything is
     * written. It is counted and dropped, never stored. */
    for (const m of page) {
      users.add(m.user_id);
      rows.push({ text: String(m.text || ""), day: String(m.created_at || "").slice(0, 10) });
    }
    if (page.length < PAGE) break;
  }

  const kept = rows.filter(r => r.text.trim().length > 1);
  fs.writeFileSync(OUT, JSON.stringify({
    source: "the app's own messages table, role=assistant only",
    note: "Partner turns from real use. The learner's own messages were not read.",
    pulled: new Date().toISOString(), accounts: users.size,
    items: kept.map((r, i) => ({ id: "R" + String(i + 1).padStart(4, "0"),
                                 text: r.text, day: r.day }))
  }, null, 1));
  console.log("accounts in the table: " + users.size);
  console.log(kept.length + " partner turns -> " + OUT);
})().catch(e => { console.error(String(e.message || e)); process.exit(1); });
