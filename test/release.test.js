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

/* 5. The deploy list cannot drift from what the page needs. The workflow copies
 *    exactly these paths, so anything index.html loads or the worker pre-caches
 *    must appear here or the published site is broken in a way no local test
 *    would show. */
const listPath = path.join(root, ".github/publish-files");
if (fs.existsSync(listPath)) {
  const published = fs.readFileSync(listPath, "utf8").split("\n").map(l => l.trim()).filter(Boolean);
  for (const p of published) {
    check(fs.existsSync(path.join(root, p)), `publish list: ${p} exists`);
  }
  const needed = assets.concat(shellPaths).filter(p => p && p !== "" && p !== "/");
  for (const n of needed) {
    const top = n.split("/")[0];
    check(published.includes(n) || published.includes(top),
      `publish list covers ${n}`,
      "add it to .github/publish-files or the deployed site will 404 on it");
  }
} else {
  check(false, ".github/publish-files exists", "the deploy workflow reads it");
}

/* 6. A branch delete must not be able to cancel a publish.
 *
 *    GitHub keeps only ONE run pending per concurrency group, so whatever
 *    queues last displaces what was already waiting. Merging a PR fires `push`
 *    and `delete` seconds apart; while both jobs shared one workflow-level
 *    group, the delete cancelled main's pending publish and the deploy was
 *    skipped with the run marked "cancelled", not failed. Nine versions sat on
 *    main unpublished before anyone noticed. Nothing else in this suite can see
 *    that, so it is checked here: separate groups, and none at file scope. */
const wf = read(".github/workflows/pages.yml");
check(!/^concurrency:/m.test(wf), "pages.yml sets no workflow-level concurrency group",
  "a shared group lets a branch delete cancel the pending publish of main");
const groups = [...wf.matchAll(/^ {4,}group:\s*(\S+)/gm)].map(m => m[1]);
check(groups.length === 2, `pages.yml gives each job a concurrency group (found ${groups.length})`,
  "publish and cleanup both write gh-pages and each needs its own");
check(new Set(groups).size === groups.length, "publish and cleanup use different groups",
  `both are in ${groups[0]}, so a delete can displace a queued publish`);

/* 7. The two set activities must not grow a third branch keyed on their id.
 *
 *    Ghost Words and Flashcard Chat are one activity with two pools, and every
 *    divergence between them that v130 fixed had the same shape: a `=== "focused"`
 *    somewhere a long way from all the others, so one got updated and the rest
 *    did not. A chat title read only the flashcard marker, the progress report
 *    knew only the ghost id, the prompt preview listed one of the two.
 *
 *    SET_KINDS holds everything they differ in. The only place left that is
 *    allowed to name an id is activityOf(), which is the function whose whole
 *    job is telling them apart. Anything else is a divergence waiting to
 *    happen and belongs on the table instead.
 *
 *    Comment text is skipped, so the reasoning above can name them freely. */
const app = read("index.html");
const codeLines = [];
let inBlock = false;
for (const line of app.split("\n")) {
  const t = line.trim();
  let keep = line;
  if (inBlock) {
    const end = keep.indexOf("*/");
    if (end === -1) continue;
    inBlock = false;
    keep = keep.slice(end + 2);
  } else if (t.startsWith("//")) {
    continue;
  }
  const open = keep.indexOf("/*");
  if (open !== -1 && keep.indexOf("*/", open) === -1) { inBlock = true; keep = keep.slice(0, open); }
  codeLines.push(keep);
}
const idHits = codeLines.filter(l => /"(focused|flashcard)"/.test(l)).map(l => l.trim());
check(idHits.every(l => /^(if \(.*\) )?return "(focused|flashcard)";$/.test(l)),
  "only activityOf() names a set activity by id; everything else goes through SET_KINDS",
  JSON.stringify(idHits, null, 1));
check(idHits.length === 2,
  "and it names each of the two exactly once",
  JSON.stringify(idHits));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nFailures:\n - " + bad.join("\n - ")); process.exit(1); }
