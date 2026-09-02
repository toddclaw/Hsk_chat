# Hsk_chat

A single-page PWA for learning Chinese by chatting with an LLM that is held to
your HSK level's vocabulary. Static files served as-is.

`DEVELOPING.md` is the long form — read it when a section below points there.
`RESEARCH.md` records why the pedagogical constants have the values they do.
Read it before designing anything that consumes one — `DEFAULT_RATE`,
`CREDIT_CAP`, `SLATE`, `PROMOTE_AT`, `READY_AT` — not only before changing one:
a feature can collide with a constant without ever editing it. Change one of
those numbers and that document needs updating with it.

## Shape

No build step, no bundler, no `package.json`, no dependencies — anywhere,
including the tests. Do not add any.

- `index.html` — the whole app: markup, CSS, and all UI logic in one file.
- `validator.js` `prompt.js` `pace.js` `senses.js` `sync.js` `md.js` `time.js`
  — the logic worth testing in isolation, pulled out so node can load it.
- `data/hsk<N>.json` — the level allowlists. **Generated**; see below.
- `test/` — one suite per module, plus `release.test.js` and `browser.test.js`.

Each extracted module ends with the same wrapper, and a new one must match it:

```js
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.HSKPace = api;
```

## Tests

```sh
sh test/run.sh          # everything
node test/pace.test.js  # one suite
```

Plain node, no framework: a `check(ok, label, detail)` counter, a fixture file,
`process.exit(1)` at the end. Write new tests the same way.

`.githooks/pre-commit` runs the whole suite and refuses a failing commit
(`git config core.hooksPath .githooks` once per clone).

`browser.test.js` needs firefox and geckodriver and exits 0 without them, so a
green run on a bare machine does not mean the browser suite passed.

Two things the suite catches that a diff never shows: a version bump applied to
one file and not the other, and a file the page loads that the service worker
does not pre-cache.

## Releasing

`VERSION` in `index.html` and `CACHE` in `sw.js` **must move together** on every
user-visible change. Any file the page loads must also appear in `sw.js`'s
`SHELL` — `cache.addAll` is all-or-nothing, so one missing path means the worker
never installs and offline support disappears silently.

## The wordlists are generated

`data/hsk<N>.json` comes from the official HSK 3.0 syllabus via
`tools/convert.py`. Never hand-edit them.

The files are **cumulative** — `hsk2.json` contains every HSK 1 word too — and
must nest, or advancing a level would take vocabulary away. A word listed at two
bands is assigned its earliest. `validator.test.js` enforces both properties,
plus that every entry validates against its own list.

`f` is a corpus frequency rank, lower being commoner, joined in from
`tools/hsk-frequency.json`. Words with no rank weigh nothing in the coverage
arithmetic. Entries are `{w, p, d, f?, t?}`.

## Prompt changes need a real model

The suite can only check that the words you wrote are in the string. Whether
they *work* is a question about a model, and the answer is regularly the
opposite of the obvious one. Run an A/B against the real model with counted
outcomes before shipping a prompt edit — the worked examples in DEVELOPING.md
show the shape, including a "fix" that made the failure eight times more likely.

Two rules learned the hard way:

- **An output-shape instruction belongs to the turn it shapes.** Put it in the
  system role and it governs every later turn — a follow-up question gets
  answered with the original verdict again.
- **Names contaminate a vocabulary measurement.** 王, 李 and 明 are all above
  HSK 1. Run name-free when measuring anything about out-of-level words.

## Secrets

The OpenRouter key lives in a file **outside the repo** and is read into a
variable — never pasted into a command line, a file in the tree, or a message.
The app keeps the user's key in `localStorage` on one device and never syncs it:
`PREFS_KEYS` in `sync.js` must never name `key` or `history`, and
`test/sync.test.js` asserts this.

The Supabase publishable key is not a secret — RLS is the security boundary. The
secret key goes in the `apikey` header only and is never shipped to the browser.

## Sync

Rows carry client-generated UUIDs. A delete on anything synced needs a
**tombstone**, and deletion must be monotonic in the merge, or another device
resurrects it. Optional columns are probed once per session so an un-migrated
database degrades instead of failing. Schema changes go in `db/schema.sql` as
`add column if not exists`.

## Git

Work on a branch; do not commit to `main` directly. Merging a branch without
deleting it leaves any stacked PR pointing at a merged branch — GitHub only
retargets on delete.
