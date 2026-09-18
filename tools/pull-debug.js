/* Read the diagnostic log off the phone.
 *
 * The app has no console on the device it is mostly used on, so `debug_log`
 * carries what console.log said -- every attempt, every gate verdict and
 * timing, every repair -- batched a row at a time by whichever device was
 * running. This flattens it back into one chronological transcript.
 *
 * It exists because the alternative is asking a person to reproduce a bug that
 * happened once. The three faults this feature was built after -- a reasoning
 * model with no timeout, a truncation flag reading a clobbered global, and a
 * render deleting the spinner out from under a live turn -- were each diagnosed
 * from a sentence of description and a guess.
 *
 *   node tools/pull-debug.js                  # the last 2 hours, as text
 *   node tools/pull-debug.js --hours 24
 *   node tools/pull-debug.js --grep "\\[gate\\]"
 *   node tools/pull-debug.js --prune 30       # delete rows older than 30 days
 *
 * SECRET KEY, same file pull-chats.js uses, and it stays outside the repo.
 */
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i === -1 ? d : args[i + 1]; };
const KEY_FILE = process.env.SUPABASE_KEY_FILE ||
  path.join(os.homedir(), "Documents", "supabase_key.txt");

const URL = (function () {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/const SUPABASE_URL\s*=\s*"([^"]+)"/);
  if (!m) throw new Error("SUPABASE_URL not found in index.html");
  return m[1];
})();
const KEY = fs.readFileSync(KEY_FILE, "utf8").trim();
if (!KEY) { console.error("no key in " + KEY_FILE); process.exit(1); }
const H = { apikey: KEY, Authorization: "Bearer " + KEY };

(async () => {
  const days = arg("prune", null);
  if (days !== null) {
    const cut = new Date(Date.now() - Number(days) * 864e5).toISOString();
    const r = await fetch(URL + "/rest/v1/debug_log?created_at=lt." + cut,
      { method: "DELETE", headers: Object.assign({ Prefer: "return=representation" }, H) });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
    return console.log((await r.json()).length + " batches older than " + days + " days deleted");
  }

  const since = new Date(Date.now() - Number(arg("hours", 2)) * 36e5).toISOString();
  const r = await fetch(URL + "/rest/v1/debug_log?select=*&created_at=gte." + since +
                        "&order=created_at.asc", { headers: H });
  if (!r.ok) {
    const body = (await r.text()).slice(0, 200);
    if (/does not exist|42P01|PGRST205|Could not find the table/i.test(body)) {
      return console.error("debug_log is not in this database yet -- run the block at " +
                           "the end of db/schema.sql");
    }
    throw new Error("HTTP " + r.status + " " + body);
  }
  const rows = await r.json();

  /* Batches arrive per device and per flush, so the ONLY honest order is by the
   * line's own timestamp. Sorting by the row's would interleave two devices
   * wrongly and, worse, put a batch flushed late entirely after one flushed
   * early -- which is exactly backwards for the crash the late flush describes. */
  const lines = [];
  for (const row of rows)
    for (const l of (row.lines || []))
      lines.push({ t: l.t, l: l.l, m: l.m, dev: (row.device_id || "?").slice(0, 6),
                   v: row.version || "" });
  lines.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  const re = arg("grep", null) ? new RegExp(arg("grep")) : null;
  const shown = re ? lines.filter(l => re.test(l.m)) : lines;
  const devices = [...new Set(lines.map(l => l.dev))];
  const versions = [...new Set(lines.map(l => l.v).filter(Boolean))];
  console.error(rows.length + " batches, " + lines.length + " lines, " +
                devices.length + " device(s) " + JSON.stringify(devices) +
                ", version(s) " + JSON.stringify(versions) +
                (re ? ", " + shown.length + " matching" : ""));
  for (const l of shown)
    console.log(l.t.slice(11, 23) + "  " + (l.l === "log" ? " " : l.l[0].toUpperCase()) +
                "  " + l.m);
})().catch(e => { console.error(String((e && e.message) || e)); process.exit(1); });
