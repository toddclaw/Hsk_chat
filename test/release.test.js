/* Release consistency. Run: node test/release.test.js
 *
 * These check the things that are invisible in a diff and only fail on a
 * phone, hours later:
 *
 *  - VERSION in index.html and CACHE in sw.js must move together, or the
 *    version panel reports a mismatch that is not real, or worse, an update
 *    ships with a cache name that never changes and never reaches an
 *    installed app.
 *  - Every path the service worker pre-caches must exist. cache.addAll is
 *    all-or-nothing: one 404 and the worker never installs, silently taking
 *    offline support with it.
 *  - Every file the page loads must exist and be pre-cached, or the first
 *    offline launch is a blank screen.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const index = read("index.html");
const sw = read("sw.js");

let pass = 0, fail = 0;
const bad = [];
const check = (ok, label, detail) => ok ? pass++ :
  (fail++, bad.push(label + (detail ? "\n    " + detail : "")));

// 1. the two version stamps
const appVer = (index.match(/const VERSION\s*=\s*"v(\d+)/) || [])[1];
const swVer = (sw.match(/const CACHE\s*=\s*"hsk-chat-v(\d+)"/) || [])[1];
check(!!appVer, "index.html declares a VERSION");
check(!!swVer, "sw.js declares a CACHE version");
check(appVer === swVer,
  "VERSION and CACHE are the same release",
  `index.html says v${appVer}, sw.js says hsk-chat-v${swVer} — bump both`);

// 2. everything the worker pre-caches exists
const shell = (sw.match(/const SHELL = \[([\s\S]*?)\]/) || ["", ""])[1]
  .match(/"([^"]+)"/g) || [];
const shellPaths = shell.map(s => s.replace(/"/g, "").replace(/^\.\//, ""));
check(shellPaths.length > 0, "sw.js declares a SHELL list");
for (const p of shellPaths) {
  if (p === "" || p === "/") continue;               // the directory itself
  check(fs.existsSync(path.join(root, p)),
    `SHELL: ${p} exists`,
    "cache.addAll is all-or-nothing — one missing file and the worker never installs");
}

// 3. everything the page loads exists, and is pre-cached
const assets = [...index.matchAll(/<script src="([^"]+)"/g)].map(m => m[1])
  .concat([...index.matchAll(/<link rel="manifest" href="([^"]+)"/g)].map(m => m[1]));
check(assets.length >= 2, "index.html loads its scripts by src", JSON.stringify(assets));
for (const a of assets) {
  check(fs.existsSync(path.join(root, a)), `asset: ${a} exists`);
  check(shellPaths.includes(a), `asset: ${a} is pre-cached by the worker`,
    "otherwise the first offline launch is missing it");
}

// 4. every level file the app offers is really there
const levels = [...index.matchAll(/file:\s*"(data\/hsk\d+\.json)"/g)].map(m => m[1]);
check(levels.length > 0, "index.html declares level files");
for (const f of levels) check(fs.existsSync(path.join(root, f)), `level file: ${f} exists`);

const ref = (index.match(/const REF_LIST = "([^"]+)"/) || [])[1];
check(ref && fs.existsSync(path.join(root, ref)), `reference dictionary ${ref} exists`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
