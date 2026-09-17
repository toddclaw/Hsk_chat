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

The grader has two benchmarks now, and they disagree about it completely.

- `tools/grader-bench.js` — learner error, human ground truth from MuCGEC.
  **90% recall, 66% specificity.** It leans harsh: roughly one correct sentence
  in three is called faulty.
- `tools/partner-corpus.js` — the partner's own Chinese, 204 turns generated
  through the real prompt and labelled by Claude. **24% recall**, 38% for the
  four-lens design and 38% for the one-call `nativeFrame` arm. This is the
  correctness gate's actual job and the grader cannot currently do it.

`nativeFrame` is the best prompt measured: it tells the grader the *partner*
wrote the text and names no level. Free — identical on learner error — and it
beats the four-lens design on specificity, precision and cost.

**But the model is the variable, not the prompt.** Eleven rounds of prompt work
moved partner recall 24% → 38%. Changing the model moved it to 70%. This is the
third time in this repo that a run of failing prompt strategies turned out to be
a signal about the model. **Try the model by round three.**

**The real corpus mixes two models — split it before using it.** `STORY_MODEL`
is `claude-sonnet-4.5` (`index.html:1064`); everything else is qwen. Pooled, the
285 real turns pulled by `tools/pull-partner.js` look like a partner wrong 15.1%
of the time with a dominant 得 defect. Split, per 100 sentences:

| | wrong | unnatural |
|---|---|---|
| story (Sonnet) | 2.5 | 0.6 |
| chat (qwen) | 3.2 | 7.2 |
| synthetic (qwen) | 3.3 | — |

So **the synthetic corpus is a good model of the chat partner**, the 得 defect is
Sonnet's (12 of 13 instances), and Sonnet writes *better* than qwen, not worse —
story turns are simply four times longer, and a per-turn rate compares a
paragraph against a sentence.

What holds: the **reflexive 被 is in production and it is qwen's** (我的手机被我
不小心放错了地方), real traffic has **zero** Latin script and **zero**
`[[NEED:]]`, and **7% of assistant rows are the stub 我不会说 / 我不知道** — a
generation failure no grader addresses.

**The recall numbers in `grader-bench-results.md` rounds 12-16 are not
measurable.** The partner corpus has 21 strict positives; one catch is five
points, and no paired test between the lens cascade, `glm-5.3-flash` and Sonnet
reaches significance. Enlarge the positive class before trusting any of them, or
before running another arm — `tools/partner-corpus.js` generates 204 turns for
$0.014, and a stratified label pass is the cheap route to ~100 positives.

**Specificity is well powered (183 negatives) and says the opposite of what the
recall race suggested:** shipped qwen 96%, `glm-5.3-flash` 89%, the cascade 81%,
Sonnet 66%. At the partner's 8.8% error rate over-firing is the expensive
direction, and the strong model is much the worst offender.

Two things about weak models that hold independently of the corpus, both
measured on their own probes and worth reaching for elsewhere:

- **Ask it to rewrite, not to judge.** Every lens and the shipped grader call
  你比昨天忙吗？ fine. Asked to *rewrite* it natively the same model returns
  你今天比昨天忙吗？ Diff the rewrite for a grounded fault proposal that needed
  no judgement.
- **Give it two sentences, not one.** Confirming a finding in the abstract
  caught 2 of 7; showing original and repair side by side caught 5 of 7. The
  abstract phrasing has now scored zero or near-zero on three separate probes.

**Silent failure has produced a wrong number three times here** — `没有错误`
parsed as a sentence, `content` empty while `reasoning` filled the budget, and a
swallowed exception that made a dead grader look clean. Every one looked
plausible. Print the raw thing and count what did not come back.

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
