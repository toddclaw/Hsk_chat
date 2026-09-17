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

The grader has three benchmarks, and the one that counts is real traffic.

- `tools/grade-audit.js` — the grader's own 208 stored verdicts on Todd's real
  sentences, blind-labelled. **85% overall** (83% recall, 86% specificity). Free
  to re-run and it grows by itself. **The best benchmark here.**
- `tools/real-qwen.js` + `tools/partner-corpus.js --grade` — 222 real partner
  turns from the database, qwen activities only. `nativeFrame` scores **86%
  strict recall at 87% specificity for $0.0001 a turn**, and is the arm to use.
- `tools/grader-bench.js` — MuCGEC learner error, human ground truth. 90%
  recall, 66% specificity. Leans harsh, and that harshness does not reproduce on
  real sentences.
- `tools/replay-partner.js` — fresh partner turns of the RIGHT kind, made by
  replaying Todd's own learner turns in context through the app's prompt. 282
  turns for $0.016, and it confirms the real-corpus numbers within a few points.
- `tools/partner-corpus.js` — 204 synthetic partner turns. **Superseded.** Its
  learner was a model, so it matched real traffic on error rate and not on error
  kind, and eleven arms were raced on the difference. **If you need more partner
  data, replay the real learner; do not simulate one.**

**The gate is wired (v105).** `gateFault()` in `index.html` runs the union
inside `turn()`'s retry loop; `HSKPrompt.grade({partner:true})` and
`{partner:true, bar:"soft"}` build the two prompts, and `test/prompt.test.js`
asserts they are **character-for-character** the strings `tools/grader-bench.js`
benchmarked — a measurement is worth nothing if what ships is a paraphrase.
Story is not gated, correctness never degrades to "show it anyway", and a failed
grader call passes the turn.

`nativeFrame` is the best prompt measured on both halves: it tells the grader the
*partner* wrote the text and names no level. But on the partner, **pairing two
arms beats improving either one** — `nativeFrame` OR `softBar`/glm-5.3-flash
catches every outright error and 73% of the merely-stilted at 80% specificity
for $0.0004 a turn, confirmed on a second corpus at 100% / 71% / 86%, and `tools/partner-pairs.js` scores all 36 pairs from stored
verdicts for free. A union needs two graders that disagree productively: two
prompts on the same model do not.

**Four prompt fixes in this study have moved the number the wrong way**, the
latest being the native frame applied to the four-lens design — worth +14 points
to one broad call and -10 to four narrow ones. Measure, do not reason.

**Read the benchmark before you read the number.** Three times now a confident
result came from a population nobody had asked about. Story turns are Sonnet's
and the rest are qwen's — pool them and the headline inverts. Two label passes
carrying the same rubric drew the wrong/unnatural line in different places, and
strict recall moved three-fold across corpora because of it. The loose bar
(wrong ∪ unnatural) survives both and is what to quote across corpora.

**The model is a variable, not a setting. Try it by round three.** Eleven rounds
of prompt work moved synthetic partner recall 24% → 38%; changing the model moved
it to 70%. But on real traffic the strong model is the *worst* over-firer, and
cheap qwen wins outright — so try the model early and then check it on real data.

What holds about the partner: the **reflexive 被 is in production and it is
qwen's** (我的手机被我不小心放错了地方), real traffic has **zero** Latin script and
**zero** `[[NEED:]]`, and **7% of assistant rows are the stub 我不会说 / 我不知道**
— a generation failure no grader addresses. Per 100 sentences the chat partner
(qwen) is wrong 3.2 times and unnatural 7.2; story (Sonnet) 2.5 and 0.6.

**Silent failure has produced a wrong number three times here** — `没有错误`
parsed as a sentence, `content` empty while `reasoning` filled the budget, and a
swallowed exception that made a dead grader look clean. Every one looked
plausible. Print the raw thing and count what did not come back.

## The diagnostic log

`debug_log` is where `console.log` goes, because the app is used on a phone and
a phone has no console. `captureConsole()` wraps console once at boot, so every
existing log line is captured without being touched and so is the next one
somebody writes. Batched, flushed on a timer and on backgrounding, read with
`tools/pull-debug.js`.

Three rules it lives by:

- **Secrets are scrubbed on the way IN** (`HSKSync.scrubSecrets`). A line
  scrubbed on the way out is already in `localStorage`.
- **It is in `USER_TABLES`.** It holds whole replies and whole sentences, so a
  "delete cloud data" that skipped it would leave the most verbatim copy of the
  conversation on the server. `test/sync.test.js` enforces the list.
- **A missing table turns it off, it does not throw.** PostgREST reports that
  two ways — `PGRST205` before the schema cache reloads and `42P01` after — and
  matching only one is how the degradation becomes an exception on every flush.

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
