# Developing

Notes for working on this app: how to run it, and the things that have already
cost someone an afternoon. README.md covers what the app *is* and how to set up
your own Supabase project — this file is about working on the code.

**RESEARCH.md** covers *why the pedagogical constants are what they are* — the
coverage thresholds, the sighting count, the frequency weighting — with
citations, the measurements behind them, and an explicit list of where the
evidence is thin. Change a number in `pace.js` and that is the file to update,
and the one to check first for whether the number was arbitrary or argued.

Not published to the site (`.github/publish-files` is an allowlist, and this
file is deliberately not on it).

## Contents

- [Getting set up](#getting-set-up)
- [Tests](#tests)
- [Releasing and previews](#releasing-and-previews)
- [OpenRouter](#openrouter)
- [Supabase](#supabase)
- [The validator](#the-validator)
- [Git and GitHub](#git-and-github)

## Getting set up

There is no build step and no `package.json`, and both are deliberate. Adding a
dependency is a real decision, not a routine one — see
[Tests](#tests) for how the browser suite avoids one.

You need **node** (any recent version; developed against 24) and, for the
browser suite only, **Firefox** and **geckodriver**.

### Installing node without root

If `sudo` needs a password you cannot supply — an agent, a locked-down machine,
a CI-less box — install into `~/.local` rather than fighting apt:

```sh
V=v24.19.0        # or whatever `curl -s https://nodejs.org/dist/index.json` says is LTS
curl -sSLO "https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz"
curl -sSL "https://nodejs.org/dist/$V/SHASUMS256.txt" -o SHASUMS256.txt
grep "node-$V-linux-x64.tar.xz" SHASUMS256.txt | sha256sum -c -   # verify before extracting
mkdir -p ~/.local/lib && tar -xJf "node-$V-linux-x64.tar.xz" -C ~/.local/lib
mv ~/.local/lib/node-$V-linux-x64 ~/.local/lib/node
ln -sf ~/.local/lib/node/bin/{node,npm,npx} ~/.local/bin/
```

`~/.local/bin` is already on `PATH` on most distributions. Remove it again with
`rm -rf ~/.local/lib/node ~/.local/bin/{node,npm,npx}`.

Worth preferring to `apt install nodejs` regardless: Ubuntu 24.04 ships node 18,
which is old enough to matter (the browser suite uses built-in `fetch`).

### Enable the pre-commit hook

**Do this once per clone.** It is not automatic, and a clone without it will let
you commit a red tree:

```sh
git config core.hooksPath .githooks
```

## Tests

```sh
sh test/run.sh          # everything
node test/sync.test.js  # one suite
```

Every suite is dependency-free and prints `N passed, M failed`. CI runs the same
`test/run.sh` (see the `Test` step in `.github/workflows/pages.yml`), so **main
cannot publish red**.

### The browser suite

`test/browser.test.js` covers the half of `sync.js` that needs a DOM, a click and
a supabase-js client — the Supabase glue. Everything above the "Supabase glue"
line in `sync.js` is pure and covered directly by `test/sync.test.js` instead.

It also asserts that a **user** message renders its translate and grammar-check
buttons. That rides along on the conversation the wipe test already seeds, so it
costs no extra browser boot, and it guards a regression a node suite cannot see:
both buttons lived behind a `role === "assistant"` guard, and re-adding one would
remove the feature from your own messages while leaving every prompt test green.

It drives real Firefox over WebDriver, which is a plain HTTP/JSON protocol, so it
needs **no npm packages** — node's built-in `fetch` and `http` are enough. It
costs a browser on the machine instead of a dependency in the repo.

Things that will bite you when editing it:

- **It skips with exit 0 when there is no browser.** That keeps `run.sh` working
  everywhere, but it also means a green run can mean "covered nothing". If you
  change the detection, re-check that CI still *runs* it rather than skipping —
  read the `Test` step log and look for `=== test/browser.test.js ===` followed
  by a non-zero pass count.
- **GitHub's runners do not put geckodriver on `PATH`.** They expose it at
  `$GECKOWEBDRIVER` instead. The detection checks that explicitly. `ubuntu-latest`
  ships Firefox and geckodriver already, so no install step is needed.
- **Marionette runs scripts in a sandbox that cannot see the page's top-level
  `const` bindings.** `VERSION`, `S` and `K` are all invisible from an injected
  script; they are lexical globals, not properties of `window`. Assert through
  `window.*` or the DOM. This is a feature as much as a constraint — it is also
  what the user can see.
- **geckodriver serves one session at a time.** A session left open by a crashed
  run blocks the next one with `invalid session id`. `pkill -f geckodriver` clears
  it.
- **geckodriver must outlive the shell that spawned it.** Backgrounding it inside
  a shell that then exits kills it.
- **Do not blanket-kill Firefox to clean up.** A developer's own browser is
  probably running. Match on the headless process specifically, or check
  `ps -o etimes` — yours will be seconds old and theirs will not.
- **`waitFor` the content, not the element.** `boot()` fills `#log` only after
  `loadLevel()` resolves, so waiting for `#log` to *exist* races the render.
- **Do not seed an API key into `localStorage` before boot.** `boot()` opens
  Settings when no key is stored, and several assertions reach elements that
  live inside that sheet — `.sheet` is `display:none` until `.open`, so they
  become invisible and fail for a reason unrelated to what is being tested. Set
  the key immediately before the call that needs one instead; `callModel` reads
  it every time. This cost an afternoon once already.
- **A backtick inside a comment inside an `exec()` template literal ends the
  template.** The syntax error points at the `exec` call, not the comment.

Supabase is mocked in-page. `index.html` loads supabase-js lazily and
`loadSupabaseJs()` returns early when `window.supabase` already exists, so
setting it before switching sync on keeps the run hermetic — no CDN, no network,
no project. What that proves is that the app calls the right tables in the right
order. What it cannot prove is that RLS permits the operation; that needs a real
sign-in against the real project.

### Mutation-test anything load-bearing

A test that has never failed has not been shown to work. Every guarantee in the
browser suite was checked by deliberately breaking the code and confirming the
suite caught it — reordering the sync-off past the delete, dropping a table from
`USER_TABLES`, putting the `role === "assistant"` guard back around the
translate and explain buttons, and reverting the explain sheet to escaping
instead of rendering. The `own` branches of `HSKPrompt.explain` and
`HSKPrompt.translate` were checked the same way, by collapsing each into its
non-`own` shape, and `md.js` by moving its `escape()` from before the formatting
passes to after. Worth doing for any new assertion that matters.

### Test a prompt change against a real model before shipping it

Prompt edits read as obviously-correct and are not. The suite can only check that
the words you wrote are in the string; whether they *work* is a question about a
model, and the answer is sometimes the opposite of what you expect.

Worked example, kept because it was so plausible. A learner wrote `鸡鸟`, which is
not a word, and the partner repeated it back instead of correcting it — despite a
standing rule to restate mistakes correctly. The obvious fix was to sharpen that
rule by naming the failure mode, with `鸡鸟` as the example.

Measured on the real model, eight replies each:

| rule | repeated `鸡鸟` |
| --- | --- |
| as shipped | 0/8 |
| "sharpened" | **3/8** |

Naming the non-word in the prompt primed the model to *discuss* it —
`鸡鸟不是词，是鸡` — which repeats the thing you were trying to suppress, in
meta-commentary the partner is not supposed to produce at all. One run spent a
`[[NEED:]]` on it. The change would have shipped as an improvement.

Rules of thumb this leaves:

- **Never put an example of the bad output in the prompt.** It is an instruction
  to produce something adjacent to it.
- **Count, do not read.** Both versions produce plausible-looking Chinese; the
  difference only appears over repeated runs. Six to eight per arm is enough to
  see a rate of this size.
- Temperature is not zero in normal use, so a single sample proves nothing in
  either direction.

### Worked example: raising PROMOTE_AT from 3 to 6

The change that turns "seen three times" into "seen six times" looks like a display constant
and is not. `HSKPace.isNew()` also picks the `reuse` list that goes into the system prompt
(`请多用：…`), so the threshold is how long the partner keeps working a word back into the
conversation. Pressing harder on reuse is exactly the kind of prompt edit the section above
says reads as obviously-correct and sometimes measures backwards.

Measured on `qwen3-30b-a3b`, 60 replies per arm, HSK 1, ten introduced words with sightings
spread 1–5 (the spread is the experiment: at 3 the 3s/4s/5s have dropped out of the reuse
list, at 6 they have not):

| | out-of-level | chars/reply | reuse words used per reply |
| --- | --- | --- | --- |
| `PROMOTE_AT = 3` | 14/60 | 16 | 0.05 |
| `PROMOTE_AT = 6` | 16/60 | 17 | **0.29** |

About six times the reuse for no measurable cost. The out-of-level difference is two replies
in sixty — not significant, and not something sixty samples could resolve either way if it
were real.

**The first run of this measured something else entirely.** The seed sentences included
`我叫王明`, and `王明` was the most common violation in *both* arms — the HSK lists contain
almost no name characters, and `王` is HSK 4 (see [The validator](#the-validator)). It added
noise to both arms and buried the effect. Seed sentences for any pacing or prompt experiment
must be namefree, or the thing being measured is the name.

### A cheaper model is not a cheaper conversation

Per-token price is the least important of the three things that set what a reply
costs. The other two are how much the model writes, and how often it writes
something out of level and triggers a retry — and both vary by an order of
magnitude more than price does.

Measured across sixteen replies, four conversations, at HSK 2:

| | out-of-level (retries) | output tokens | real cost per reply |
| --- | --- | --- | --- |
| `qwen3-30b-a3b` ($0.19/M out) | 4/16 | 17 | **$0.000032** |
| `deepseek-v4-flash` ($0.098/M out) | 8/16 | 125 | $0.000046 |

Half the listed output price, 44% more expensive in practice. Judge a candidate
with `usage: {include: true}` and the validator, not with the price column.

The same applies to prompts. `explain()` carries explicit "no headings, no
bullets, no bold, no emoji" rules because *"keep it concise"* did nothing
measurable, and naming the decoration cut output 39%. Position mattered too:
appended at the very end of the prompt it saved 47%, but that puts formatting
rules after the sentence being explained, so the shipped version takes the
smaller saving for the sane ordering.

### md.js

Models answer the explain prompt in Markdown whether or not they are asked to,
so the sheet renders a small subset of it rather than fighting the habit with an
instruction that has to win on every call. Two things to keep straight when
editing it:

- **`escape()` runs first, over the whole string, and every pass after it emits
  only tags `md.js` itself wrote.** Reversing that order still passes any test
  that only checks formatting, which is why `test/md.test.js` asserts on tags
  being inert as well. The input is untrusted twice over: it is model output,
  and model output quotes the student's own words back.
- **Bold has to be consumed before italic, and `***triple***` before both**, or
  the tags come out interleaved rather than nested (`<strong><em>x</strong></em>`)
  and the DOM quietly rewrites them into something else.

## Level readiness

- **List share and text share are very different numbers, and only one of them is the
  answer.** The wordlists are cumulative and frequency-ordered, so at HSK 1 you have 60% of
  the HSK 2 *list* and about 88% of HSK 2 *text*, and the gap holds at every band. Anything that reports progress as a word
  count will read as "you know almost nothing" to someone who can already follow most of the
  level. `HSKPace.coverage()` weights by `1/f` for this reason; `test/pace.test.js` asserts
  the two numbers stay far apart, so a regression to counting words fails rather than just
  looking pessimistic.
- **Never put a thumb on a weighted score, and never let two rows of the same panel run on
  different scales.** The headline once weighted words the learner had written by 2 and
  clamped the result, while `toTarget()` below it did not. Because weight goes as `1/rank`,
  typing the *ten* commonest words was enough to saturate the bar — it read "100%" next to
  "57 more words to 95%". Reading and production are now the same `coverage()` over two
  different word sets. `test/pace.test.js` sweeps learner states asserting the headline and
  the countdown never disagree, and the browser suite checks the same thing through the
  panel, since what actually broke was the panel wiring two rows to two functions.
- **The browser suite's seeded history has to survive to reach the progress checks.** The
  sync-wipe test clears the conversation, and production is measured by segmenting it — so
  progress assertions placed after the wipe run against an empty history, cannot reach the
  states where the figures could disagree, and pass against the very bug they were written
  for. They sit before the wipe for that reason, and the seed carries a full sentence of
  common words rather than two short turns.
- **The reasoning behind these numbers is in RESEARCH.md, not here.** This section is the
  operational half — what breaks and how. Why 95% rather than 90%, why six sightings rather
  than three or ten, and how much of that rests on a single regression with 66 participants,
  all live there.
- **Do not invent a threshold for production.** Reading has 95%/98% because unknown-word
  density and comprehension have a testable relationship. Production has no equivalent: the
  gap from reading widens with proficiency and not every word becomes productive, so a fixed
  target is wrong at every level. The actionable form is the list of introduced words never
  written (`S.learning` minus `producedWords()`), not a gauge — and moving up is not gated
  on it.
- **`S.learning` rows carry no `f`.** `settlePace()` stores `w/p/d/seen/from` only, so
  sorting them by `e.f` compiles, runs, and silently does nothing because every value is
  `undefined`. Look frequency up through `S.nextList` instead.
- **Seed the state an assertion needs, or it passes without testing anything.** The
  never-used row only renders when there are introduced words *and* a typed history; with
  the old two-turn seed both sides of the subtraction were empty, the row never appeared,
  and a both-or-neither check passed vacuously. Same failure as the progress checks sitting
  after the sync wipe — twice now, in the same file.
- **`f` is a rank, not a token count.** Weighting by `1/f` is a Zipf assumption about the
  corpus, not a measurement of it. `ZIPF_EXP` in `pace.js` is the calibration knob and the
  percentage is labelled "estimated" in the UI. The word counts shown underneath it are
  exact — that is half of why both are on screen.
- **`toTarget()` has to stop when the weight stops rising.** Words the corpus never saw carry
  `f = 999999` and weigh zero, so a target that cannot be reached would otherwise walk to the
  end of the list and hand back a count of words that buy no coverage at all.
- **`S.pool` is not the level.** `buildPool()` strips out everything already usable, which is
  exactly what readiness needs in its *denominator*. `S.nextList` keeps the unfiltered list
  for that; using `S.pool` for coverage silently computes a fraction of the wrong total.
- **Do not put `S.base.some()` inside a filter over a wordlist.** At HSK 6 → 7–9 that is
  5364 × 10970 comparisons and the sheet visibly stalls opening. Build a `Set` first.
- **The level browser reaches every level, and that is the point.** It was hardcoded to
  `S.level + 1`, which left no way to review the list you are on without dropping a level to
  see it from below. `levelCache` holds each fetched list, since the picker would otherwise
  re-fetch several thousand entries on every change.
- **`renderLearning()` filters by `e.from > S.level` rather than deleting.** Once you move
  up, words introduced from the level you moved into are simply part of your level; leaving
  them listed as "from HSK 2" turns a working set into an archive that grows on every
  advance. Filtering keeps the sighting counts and makes dropping back down restore the rows.

## Releasing and previews

`VERSION` in `index.html` and `CACHE` in `sw.js` **must move together**.
`test/release.test.js` fails the commit otherwise, which is the point: a bump
applied to one and not the other ships a page the worker will not re-cache.

Every branch publishes a preview. The URL is derived from the branch name with
`/` replaced by `-`:

| Branch | Preview |
| --- | --- |
| `main` | `https://<owner>.github.io/<repo>/` |
| `claude/settings-balance` | `https://<owner>.github.io/<repo>/preview/claude-settings-balance/` |

**A preview is per-branch.** Looking at the previous branch's preview URL — or at
production — while expecting a new branch's changes is the single easiest way to
waste ten minutes here. Settings shows `VERSION`; check it before debugging
anything else.

New files are **not** deployed unless listed in `.github/publish-files`.
`test/release.test.js` checks that everything `sw.js` pre-caches is on that list,
so a new shell asset fails the suite until you add it.

The service worker is **network-first for the shell** and cache-first for the
word lists, so a redeploy normally reaches an installed app without any manual
step. When it does not, Settings → **Check for update** messages the worker
directly.

## OpenRouter

Keep a key in a file **outside the repo** and read it into a variable rather than
pasting it anywhere. The app itself keeps the user's key in `localStorage` on one
device and never syncs it.

- **Model ids change often and must not be typed from memory.** Verify against
  `https://openrouter.ai/api/v1/models` (no key needed). A dropdown entry here
  once pointed at a model OpenRouter had withdrawn entirely.
- **Free models are the most volatile thing on offer.** Observed in one sitting:
  an id withdrawn outright, two Gemma free endpoints returning `429
  rate-limited upstream` on every attempt, and a third returning `200` with an
  empty body. The app's `callModel` treats an empty `200` as its own error kind
  for exactly this reason.
- **`openrouter/free` is a router, not a model.** It cannot go stale the way a
  specific id can, which is why the "known-good" free option points at it — but
  it picks a different free model per call and the quality varies a great deal.
- **`/api/v1/key`** returns `limit`, `limit_remaining` and `usage`. A key with no
  ceiling reports `limit: null`, where "remaining" is meaningless — show spend
  instead. This is what Settings' balance display and "Test connection" both read.

## Supabase

Project setup lives in README.md. What is easy to get wrong:

- **RLS policies here are `for all`**, so they already cover `delete`. Adding a
  table means adding the same policy, or the app silently cannot write to it.
- **An anonymous read of an RLS-protected table returns `200 []`, not `403`.**
  Empty-because-filtered and empty-because-empty look identical, so a read is a
  weak test of RLS. Attempt a write: a blocked one fails loudly with
  `42501 new row violates row-level security policy`.
- **`sync.js`'s `USER_TABLES` must list every table holding user rows.**
  `test/sync.test.js` reads `db/schema.sql` and fails if the two disagree —
  a table added to the schema and forgotten there would leave behind data the
  app told the user it had deleted.
- **Table names are `vocab_extra` / `vocab_learning` / `vocab_known`.** There is
  no `vocab` table; guessing it returns `PGRST205`.
- **New-format secret keys (`sb_secret_…`) go in the `apikey` header only.** The
  gateway rejects a request that also carries one as `Authorization: Bearer`,
  because it tries to parse it as a JWT. This is why `keepalive.yml` looks the
  way it does.
- **`renderSyncStatus()` is the only writer of the sync line, and it remembers.**
  `renderSyncSection()` runs far more often than anything with news to report,
  and it runs *right after* the first pull on the load that lands back from the
  GitHub redirect. Repainting that line from a fresh string blanks whatever the
  pull just said, so a sync that worked reports nothing and the only way to see
  a confirmation is to press **Sync now** — which is exactly what it looked
  like from the outside. Route new status text through `renderSyncStatus()`.
- **`flushSync()` must reschedule when it finds `syncBusy`, not just return.**
  The queue survives an early return (the flags are cleared further down), but
  the timer that fired does not, and `queueSync()` is the only other thing that
  ever sets one. A bare return therefore strands everything queued until an
  unrelated edit happens to restart the clock.
- **Anything Settings reads out of the DOM is gone if the page navigates away.**
  `commitSettings()` runs on close, so signing in for sync — which leaves for
  GitHub and comes back as a fresh load — used to discard the API key, the reply
  length, the tries, the Anki fields and the system prompt. `signInForSync()`
  commits first for that reason. The key is additionally stored on every
  keystroke, because it is the one field that cannot be retyped from memory.
- **Deleting anything synced needs a tombstone, not a delete.** The offline device still
  holds its copy and re-pushes it. `conversations.deleted_at` is that tombstone, and
  `mergeConversations()` treats deletion as monotonic — a tombstone wins from either side
  regardless of `updated_at`, because the offline device is exactly the one likely to carry a
  *later* one. (`clearHistory` has always had a mild version of this bug and still does; with
  one conversation it is rare enough to have gone unnoticed.)
- **`S.history` is the array inside `S.chatMsgs[S.chatId]`, not a copy.** Mutations need no
  bookkeeping; reassignments do, and `persist()` re-points the map for all three of them. If
  you add a fourth, call `persist()`.
- **Migrate on content, never on a "have I run yet" flag.** Boot creates an empty placeholder
  chat for a first run, which writes `chatMsgs` — so a flag or an existence check declares
  the migration done before the legacy history has been looked at, and it disappears behind
  an empty conversation. `migrateChats()` asks whether any conversation holds a message.
- **The Supabase project may not have had the migration run.** Whoever deployed it is not
  necessarily whoever is using it, so a missing table or column degrades rather than throws:
  `conversation_id` is stripped and messages still push. Detection matches error *codes*
  (`PGRST205`, `42P01`, `PGRST204`, `42703`) — the messages are localized and change.
- **`prefsPushedAt` must persist, or every reload adopts the cloud's settings.** It gates
  `applyPrefsSnapshot` with "is the remote newer than my last push". Held in memory only it
  was `undefined` on every load, so every load took the never-pushed branch and overwrote
  local settings — invisible while the cloud is current, and destructive exactly when it is
  behind, which is when you changed a setting and reloaded before the 2s debounce pushed it.
  Reloading to pick up a new version is that case. This shipped broken and was reported as
  "the upgrade lost my model, reply length and tries".
- **`store.set` reports failure now; it used to swallow it.** A full quota meant every write
  after the overflowing one vanished with no error, the app looking fine until the next
  reload. Anything relying on a `try` around `store.set` was dead code — the `catch` was
  inside.
- **Do not store the conversation twice.** `persist()` wrote `K.history` *and*
  `K.chatMsgs[S.chatId]`, the same turns in both, doubling the quota needed by the one
  feature here that grows without bound. `K.history` is now read once, by `migrateChats()`,
  and never written.
- **A private window is a different device, and it reads as data loss.** Sync state and the
  Supabase session both live in `localStorage`, which is partitioned per browsing context —
  so the same browser in a normal window has sync off and no session, shows an empty app,
  and looks like it lost everything. Safari additionally keeps private-mode `localStorage`
  in memory and discards it when the session ends, so a private window is not a safe only
  copy. Nothing to fix in code; the Sync section says so.
- **Free-tier projects pause after 7 days without database *activity*.** Dashboard
  visits and cached reads do not count. `.github/workflows/keepalive.yml` writes a
  real row every 3 days; it needs the `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` repository secrets.

## The validator

- **`validate()` output does double duty.** It drives the repair loop *and* the
  learner's "new words" list. Dropping a violation therefore also removes the word
  from the UI — which is why out-of-level names are **marked** (`name: true`) and
  filtered at the repair site, rather than dropped in the validator.
- **`segment()` is a shortest-path search, not a greedy walk.** Adding a
  zero-cost option is not free: a name span offered as one token would beat the
  correct parse of `你叫什么名字` (`什么` + `名字`, two tokens) because it uses
  fewer. Prefer post-filtering what the segmenter already gave up on.
- **Two legal words in a row are indistinguishable from a compound.** At HSK 2 both
  鸡 and 鸟 are on the list, so the invented `鸡鸟` segments as 鸡 | 鸟 and validates
  clean — and 先生 written where 生 was meant is an ordinary allowed word. The
  guarantee is vocabulary, not sense, and no amount of tightening the level changes
  that: a sentence made of right words that means nothing will pass. `data/hsk7.json`
  does know better (10,970 words, and `鸡鸟` is not among them), so a check along the
  lines of "the partner repeated a multi-character span the student just invented"
  is *possible* — but it would fire on real compounds the reference list has never
  heard of, so it is not obviously worth the false positives.
- **The published HSK lists contain almost no name characters.** `张` first
  appears at HSK 3 and `王` at HSK 4; below that there is no legal name at all.
  Any feature that asks the model to name something needs to account for that —
  the app's own `你叫什么名字？` starter used to fail every attempt and land on
  the fallback.

## Git and GitHub

- **Stacked PRs do not retarget on their own.** GitHub only re-points a PR at
  `main` when its base branch is *deleted*. Merging without deleting leaves the
  stacked PR pointing at a merged branch.
- **`gh pr edit --base` can fail** on a Projects-classic deprecation error. The
  REST API works:
  `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -f base=main`
