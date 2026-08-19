# HSK Chat

A Chinese conversation partner that is *mechanically* incapable of replying with words
outside a defined allowlist. Not a system prompt asking a model to stay at level — a
validator that checks every response and forces a rewrite when it fails.

Single static page, no build step, no backend. Add it to a phone home screen from
Safari → Share → Add to Home Screen.

```
index.html        markup, CSS and app logic
validator.js      the matcher (shared by the page and the tests)
prompt.js         per-level register profiles and prompt assembly
data/hsk1..7.json the allowlists: {"w":"你好","p":"nǐ hǎo","d":"hello"}
test/             fixtures + a dependency-free test runner
tools/            one-shot scripts: wordlist conversion, icon generation
sw.js manifest.json icon-*.png    PWA shell
```

## Running it

```
python3 -m http.server 8000        # any static server; file:// cannot fetch the lists
open http://localhost:8000
```

Then open Settings (⚙) and paste an [OpenRouter](https://openrouter.ai/keys) key. The key
is kept in `localStorage` on that device and is sent to openrouter.ai and nowhere else.

To deploy: push to GitHub and turn on Pages for the branch root. There is nothing to build.

Tests: `sh test/run.sh` runs all three suites (no dependencies):

| suite | covers |
|---|---|
| `test/validator.test.js` | the matcher, its fixtures, and every level file's shape |
| `test/prompt.test.js` | the per-level register profiles and prompt assembly |
| `test/release.test.js` | release consistency — see below |

**Enable the pre-commit hook once per clone:**

```
git config core.hooksPath .githooks
```

It refuses a commit whose tests fail. That exists because of a real repeated slip: a patch
script asserted on a line that had been reworded, exited before applying the version bump,
and the commit ran anyway — shipping code with a stale `VERSION`. `test/release.test.js`
checks the things a diff cannot show and only fail later on a phone:

- `VERSION` in `index.html` and `CACHE` in `sw.js` name the same release. Out of step, the
  version panel reports a mismatch that is not real, or an update ships behind a cache name
  that never changes and so never reaches an installed app.
- Every path in the worker's `SHELL` exists. `cache.addAll` is all-or-nothing: one 404 and
  the worker never installs, taking offline support with it silently.
- Every script and manifest the page loads exists *and* is pre-cached, so the first offline
  launch is not a blank screen.
- Every level file and the reference dictionary named in `index.html` are present.

Both guards are verified by deliberately breaking them: a half-applied version bump and a
missing pre-cached icon are each refused at commit time.

## How the constraint works

**Segmentation against the allowlist itself** — deliberately not jieba or any other
segmenter. A general segmenter splits against its own dictionary and then you check
membership, which disagrees at every boundary the two dictionaries define differently.
Matching directly against the allowlist makes *unsegmentable* and *disallowed* the same
signal, and the word boundaries it produces are reused for tap-to-gloss and for the live
underlining under the composer.

The match is a shortest path, not a greedy walk. Greedy maximum matching strands a
character whenever a longer word starting earlier wins the position: with 不便 in the list,
不便宜 segments as 不便 + 宜 and reports 宜 as out of level, though 不 + 便宜 covers it
exactly. The failure rate grows with the list, so `segment()` picks the segmentation that
leaves the fewest characters unmatched, breaking ties toward fewer (longer) words. It is
O(n · maxLen) over a chat-length string — small enough to run on every keystroke in the
composer.

`maxLen` is derived from the loaded file, never hardcoded.

Each turn runs up to three attempts:

1. generate;
2. on violations, name them — `你用了「苹果」。这些词太难…`;
3. on violations again, name them *and* supply permitted substitutes, found by scanning
   the allowlist for entries sharing a character with the violation.

The number of tries is a setting (1–6, default 3); each one is another API call, and 1
means no repairs at all. After the last failure the app returns a sanctioned in-level
refusal (`我不知道。`) with a **gave up** badge, so a failure never reads as an answer. Repair exchanges live in a
scratch array and never enter stored history. Retries are invisible apart from an
attempt-count badge.

Non-obvious choices:

- **Roman letters are a violation coming back, never going out.** Treating all ASCII as
  always-allowed (as the original spec did) lets a model answer in English or pinyin and
  pass, so `a-zA-Z` gets its own violation kind and its own repair line. The learner's own
  English is the opposite case — `怎么说 fried egg` is how you ask for a word you don't
  have — so it is sent verbatim and never underlined. The asymmetry lives at the call
  sites; `validate()` itself reports the kind and lets the caller decide.
- **Numerals combine.** A run of number characters is accepted as one token only when
  every character in it is already in the allowlist, so 二十三 glosses as one word without
  widening the vocabulary.
- **`EXTRA_ALLOWED`** in `validator.js` covers particles and suffixes the published lists
  omit (啊, 呀, 儿, 嗯, 哦). Grow it empirically — every violation is logged to the console.

Known limitation: the matcher constrains *words*, so an above-level compound built
entirely from in-list characters (想要 = 想 + 要) passes. The grammar banlist in the system
prompt handles that class instead.

## Growing the allowlist

Four ways a word joins the session allowlist, all landing in the same place (词 panel,
persisted, removable):

1. **Words you type**, automatically — on by default, toggled in the 词 panel. Anything in
   your own message that the level does not cover is learned before the reply is generated,
   so the model may use it in the same turn.
2. **Tap a red word → Add.** Works on your messages and the model's.
3. **By hand**, in the 词 panel — space- or comma-separated.
4. **`[[NEED:词|pīn yīn|english]]`** from the model, offered under the message with
   accept / reject buttons. This is also how the model answers "how do you say X" — the
   system prompt requires it, so asking in English yields the word with pinyin and gloss
   and an Add button rather than a refusal.

   The reply carrying a request is validated against a lexicon that *includes* that
   request's words. Without this the channel defeats itself: the wrapper is stripped
   before validation, the bare word is by definition not in the allowlist, and the request
   the model was told to make is rejected as a violation — three retries and a give-up on
   exactly the turns the mechanism exists to serve.

Two problems the naive version gets wrong, both handled:

- A violation span is a *run* of unmatchable characters, so it can fuse two words
  (因为苹果). Runs are split against the reference list before being stored.
- A violation can equally be *part* of a word: 西 and 问 are in HSK 1, so typing 西瓜 or
  问题 only flags 瓜 and 题. The span is grown against the reference list first
  (题 → 问题), and when the whole word is outside HSK 1–3 entirely (西瓜 is), the gloss
  lookup gets the sentence too and names the word the fragment belongs to — accepted only
  if that word actually occurs in the sentence and contains the flagged fragment.

Pinyin and meaning come from `data/hsk7.json` (10,969 words), used as a reference
dictionary regardless of the level in play. Only when a word is missing from it does the
app spend one small API call to gloss it, batched per message; if that call fails the word
is still added, just bare.

Strict HSK 1 conversation is close to unworkable, so the level picker in the header also
switches the whole allowlist — HSK 1 through the combined 7–9 band — mid-conversation. The
validator is provider- and level-agnostic; switching re-renders existing messages against
the new list.

## Fitting the screen, and text size

The page must not scroll sideways, and one trap made it: flex items default to
`min-width: auto`, so a `<select>` cannot shrink below the width of its longest option — a
model id like `qwen/qwen3-30b-a3b-instruct-2507` pushed the header buttons past the right
edge and took the document with them. The level select now keeps its natural width (it is a
primary control and its options are short) and the model select absorbs all the shrinking,
truncating instead.

Message text size is a slider in Settings (16–34px) driving a `--msg` custom property, with
a live preview line at the real size. The pinyin ruby is sized in `em`, so it scales with
the text instead of crowding it at small sizes and disappearing at large ones.

Checked by measurement rather than by eye: every element's bounding box against
`documentElement.clientWidth`, at 375 / 390 / 430 px, at text sizes 16 / 26 / 34, with the
chat, Settings and 词 panels open.

## Copying text out

Every message has a **copy** button that copies its Chinese exactly, and the word popover
has a copy for the single word. Selecting by hand works too, and gives the same thing.

Getting that right took two fixes that are easy to get wrong:

- **The ruby is CSS generated content** (`.w::before { content: attr(data-py) }`), not a
  DOM node. As a real element the pinyin came out interleaved with the characters —
  `wǒ我hěn很hǎo好` — and `user-select: none` does not help, because Chromium still puts
  such text into `Selection.toString()`.
- **Word tokens are `inline-block`, not `inline-flex`.** A flex box serializes as a block,
  so a selected line copied out one word per line.

Pasting into the composer needs nothing special, and pasted text is validated and learned
like anything typed.

## The prompt grows with the level

`prompt.js` holds a register profile per HSK band — a vocabulary rule, a grammar rule, and a
worked sample — and `build()` assembles them with the length setting and the fixed
machinery (the `[[NEED:]]` channel, the English rule).

The grammar rule is the part that matters. It starts as a banlist and turns into
permission:

| | grammar |
|---|---|
| HSK 1 | 谁 + 做什么 only; 把, 被, 就, 才, complements and non-trivial 了 all banned |
| HSK 2 | 了, 过, 在…呢, 一点儿, 比 unlocked; 把 and 被 still out |
| HSK 3 | **把** unlocked, resultative complements, 因为…所以, 虽然…但是 |
| HSK 4 | **被** unlocked, directional complements, 不但…而且, 除了…以外 |
| HSK 5 | 使, 让, 由于, 尽管…还是, 无论…都, common 成语; no bans left |
| HSK 6 | formal register, 书面语, 成语; "don't sacrifice expression for simplicity" |
| HSK 7–9 | native register — 成语, 俗语, complex structures |

Forbidding 把 at HSK 5 forbids grammar the learner met at HSK 2, which is what made every
level sound the same.

`test/prompt.test.js` checks the parts a person cannot eyeball: every sample validates
against **its own level's** allowlist (a prompt that demonstrates a word the validator
rejects teaches the model to fail), every sample from HSK 4 up is genuinely illegal at
HSK 1 (so the ladder climbs rather than just changing wording), the bans really do
disappear by HSK 5, and assembly keeps each level's own rules while the `[[NEED:]]` channel
and the English rule survive intact.

**Reply length** is deliberately level-neutral, so the two axes compose instead of fighting:
short (1–2 sentences), medium (3–4), longer (5–6), each with its own `max_tokens` ceiling
(300 / 500 / 800). A model that answers in one line is usually obeying the prompt, not
failing.

`finish_reason: "length"` now shows as a **cut off** badge. Silent truncation and a model
choosing to stop look identical in the output and have opposite fixes.

Settings also exposes the **assembled system prompt** itself. Untouched it keeps tracking
the level and length pickers; edit it and it is sent as written, with `{level}` and `{words}`
substituted. Saving compares the text against what the box was filled with, not against a
freshly generated default — otherwise changing the level or reply length while the panel is
open would silently freeze the old wording as a custom prompt. `with-list` still appends the
allowlist unless the custom text places it with `{words}`.

Longer replies mean more opportunities to reach above level, so the retry counters are the
thing to watch after raising it.

## Flashcards: Pleco and Anki

Neither app can be written to directly from a web page, and it is worth being precise about
why:

- **Pleco has no add-a-card URL.** Its `plecoapi://` scheme covers lookup, not card
  creation. Cards get in through its own flashcard import.
- **AnkiConnect is desktop-only** — an HTTP server on `localhost:8765`. A phone cannot reach
  the desktop, and an https page cannot call plain http anyway.

So the 词 panel exports a file, and hands single cards over by URL:

- **Export for Anki** — CSV with `#separator` / `#html` headers, two columns: the word, and
  pinyin / meaning / the sentence it was met in, joined with `<br>`. Anki desktop: File →
  Import.
- **Export for Pleco** — tab-separated headword / pinyin / definition, Pleco's documented
  import format. Pleco: Flashcards → Import Cards.
- **Per-word Anki link** — [AnkiMobile's `anki://x-callback-url/addnote`](https://docs.ankimobile.net/url-schemes.html),
  configured in Settings with deck, note type and field names (they must match the
  collection exactly, and nested decks use `::`).
- **Look up in Pleco** in the word popover — [`plecoapi://x-callback-url/s`](https://www.plecoforums.com/threads/urls-scheme-in-pleco.5875/),
  with `x-success` set so Pleco offers a button back to the app.

Delivery is via the Web Share API, because iOS will not let a page save a file on its own;
the share sheet can hand the file straight to Pleco or to Files. Download is the desktop
path and clipboard the last resort.

Each added word now stores the **sentence it was met in**, captured at add time because it
cannot be recovered later. It is the most useful half of a flashcard.

## The A/B flag

HSKStory reports that including the vocabulary list in the prompt makes output *worse*.
Both paths are built: Settings → Prompt mode toggles `without-list` (rules only) and
`with-list` (full allowlist appended). The counters under the toggle accumulate turns,
mean retries per turn, and give-ups per mode — run ~20 fixed turns each way and compare.
Assume neither result.

## Models

Model ids change often, so the picker loads the live catalogue from
`https://openrouter.ai/api/v1/models` (Settings → *Load model list*) and caches it; any id
can also be typed in by hand. The three ids compiled into `MODELS` at the top of
`index.html` are **unverified starting points** — this repo was built in a sandbox with no
egress to openrouter.ai, so they could not be checked against the live catalogue. Verify
them at <https://openrouter.ai/models> before trusting the defaults.

Model choice is provider-agnostic by design: OpenRouter means one endpoint, one key, one
response shape, and swapping providers mid-conversation is safe.

## Wordlist provenance

`data/*.json` is generated by `tools/convert.py` from the HSK 3.0 level dumps supplied by
the user — 506 / 1,256 / 2,209 / 3,181 / 4,240 / 5,363 / 10,969 words, cumulative, with
level 7 being the combined 7–9 band. The converter merges duplicate entries,
repairs CC-CEDICT's `u:` notation (`nu:3` → `nǚ`), and picks a display reading: an explicit
override for function words whose literary reading carries more dictionary senses than the
everyday one (了 le, 吧 ba, 着 zhe), then non-surname readings, then the reading with the
most senses. Regenerate with:

```
python3 tools/convert.py <level1.json> data/hsk1.json <level2.json> data/hsk2.json ...
```

`node test/validator.test.js` fails loudly if any `data/hsk*.json` is still in the raw
upstream shape — a raw dump builds a lexicon of zero words, and the app would then flag
every character the model writes.

The service worker caches only the shell and HSK 1 on install; the other level files and
the reference dictionary total a few megabytes and are cached on first use instead. Note
that `cache.addAll` is all-or-nothing: if any path in `SHELL` 404s, the worker never
installs at all and the app silently loses offline support.

## Updating an installed app

Settings shows a version block — the page's own `VERSION` stamp, the cache the service
worker activated, worker state, and the loaded word counts. If the first two disagree, an
update is half-applied and one relaunch finishes it.

Getting a deploy onto an installed home screen needs three things, and missing any one of
them strands the phone on an old build:

- **The shell is network-first.** Cache-first on `index.html` meant a redeploy could never
  reach an installed app. Wordlists stay cache-first — large, rarely changed, and a stale
  one is still correct.
- **That fetch uses `cache: "reload"`.** A plain network-first fetch is still answered by
  the browser's own HTTP cache; GitHub Pages sends `max-age=600`, so without this the
  worker serves the same stale page it was meant to replace. The worker script itself is
  registered with `updateViaCache: "none"` for the same reason.
- **The page reloads when a new worker claims it**, guarded twice: `controllerchange` also
  fires on first install, where a reload just blinks the page, and a reload must not
  cascade.

Measured end to end (deploy while an installed client is running, then relaunch): the new
build renders in well under a second, the old cache is deleted, and exactly one extra
navigation occurs. **Bump `VERSION` in `index.html` and `CACHE` in `sw.js` together on
every deploy** — they are what the version block compares.

## Not included, on purpose

Streaming (a partial response cannot be validated), audio, SRS, accounts, traditional
characters.
