# Developing

Notes for working on this app: how to run it, and the things that have already
cost someone an afternoon. README.md covers what the app *is* and how to set up
your own Supabase project — this file is about working on the code.

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
