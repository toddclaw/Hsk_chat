# HSK Chat

A Chinese conversation partner that is *mechanically* incapable of replying with words
above your level. Not a system prompt asking a model to keep it simple — a validator that
checks every reply and forces a rewrite when it fails.

Live at **<https://toddclaw.github.io/Hsk_chat/>**

One static page. No build step, no backend, no accounts. Your API key, conversation and
vocabulary live in your browser's storage on your own device and go nowhere else.

---

# Using it

## Anything with a browser

Open <https://toddclaw.github.io/Hsk_chat/>, tap **⚙**, paste an
[OpenRouter key](https://openrouter.ai/keys), tap **Done**. That is the whole setup —
desktop, laptop, tablet or phone, any modern browser.

On a wide screen **Enter** sends and **Shift+Enter** starts a new line; on a phone, use the
送 button.

Everything is stored per browser, per device. Opening the page on a second machine gives
you a fresh, empty app — the key, history and added words do not follow you, and nothing is
ever uploaded. Private/incognito windows lose all of it when closed.

## iPhone and iPad

Open the link **in Safari** (other iOS browsers cannot install home-screen apps), then
Share → **Add to Home Screen**. Launching from the icon gives a standalone app with no
browser chrome, and the wordlists are cached so it opens offline.

## Android

Open the link in **Chrome**, then ⋮ → **Install app** (older versions say *Add to Home
screen*). Firefox and Samsung Internet have the same option in their menus. Everything
works exactly as on iOS, with one exception noted under
[flashcards](#flashcards-pleco-and-anki): AnkiDroid does not accept the one-tap card links.

## Running it for free

Make an account at [openrouter.ai/keys](https://openrouter.ai/keys), create a key, **add no
credit**, and tick **free models only** in Settings. Models priced at zero cost nothing to
call, and the picker shows what everything costs per million input tokens so the paid ones
are one tap away when you want them.

**A free model that works: Google: Gemma 4 26B A4B (free).** Pick it by name in the
picker — free endpoints come and go, so the live catalogue is the authority on ids, not this
file.

That recommendation matters because **most free models tried for this app returned nothing at
all**. A free endpoint that is overloaded, withdrawn or gated answers with an empty
completion — an HTTP 200 with no content in it.

The app treats that as a normal thing to route around rather than as a crash. A failed call
becomes a card in the conversation naming what happened and what to do, with a button
straight to the model picker:

| | |
|---|---|
| empty completion | *That model sent back an empty reply* — pick another |
| 429 | rate limited; free models share a small quota |
| 401 / 403 | the key was rejected |
| 402 | that model needs credit |
| anything else | network or OpenRouter itself; sending again often works |

Notices are **not** conversation: they never go to the model in the next turn's history, and
they are never rendered as Chinese. An earlier version pushed `我不知道。` on failure, which
read as the partner refusing to answer when in fact no answer had been requested.

Free models are also rate-limited and can be busy, so replies are slower and retries more
frequent — which for this app means more turns ending in 我不知道。Raising *Tries before
giving up* helps; adding credit and choosing a paid model helps more.

**A key is still required, and that is not a limitation I can engineer away.** Something has
to hold a secret to call an API, and this app has no backend — a key shipped inside a static
page is readable by anyone who opens it and would be abused and revoked within a day. The
alternatives are worse: a shared proxy means running a server and paying for everyone's
conversations, and running a model in the browser means a multi-gigabyte download that
current phones cannot hold. A free account with your own key is the honest version of free.

## What it costs

If you do add credit: a turn sends roughly 1k tokens and gets back ~100, so at cheap-model
rates it is a fraction of a cent; a retry costs another round. **Optimise for retry rate, not sticker price** — a cheap
model that averages two retries costs more, and feels slower, than a better one that gets
it right first time. The A/B counters in Settings measure exactly that.

The first thing to do in Settings is **Load model list from OpenRouter**: the three ids
compiled into the page are unverified starting points, and model ids change often.

## A model that works well

**Qwen: Qwen3 30B A3B Instruct 2507** (`qwen/qwen3-30b-a3b-instruct-2507`) — very cheap, and
it generally gets there after a few retries. Pick it from the loaded catalogue rather than
typing the id, since ids change.

The "after a few retries" part is the point, and it is worth setting up for:

- **Raise *Tries before giving up* to 4 or 5.** The retries are what make this model work,
  and at its price several of them still cost less than one call to a frontier model. The
  default 3 will give up on turns it would have solved.
- Watch the retry counters rather than the price when comparing it with anything else. A
  model that converges on the second try beats a cheaper one that needs five.

It is a reasonable default for this app generally: the task is short, simple Chinese under a
hard constraint, which rewards instruction-following and Chinese-native training far more
than reasoning ability.

---

# What the app does

**Levels.** The picker in the header switches the whole allowlist between HSK 1 and the
combined 7–9 band, mid-conversation. Existing messages re-render against the new list.

**Conversation starters.** A scrollable row above the composer, in that level's own
vocabulary. At HSK 1 the hard part is not saying a sentence, it is knowing which sentence
is even sayable. Tapping fills the composer rather than sending, so you can read and edit
it first.

**Tap any word** for pinyin and meaning. The boundaries come free from the validator's
matcher. 拼 cycles pinyin: off → above-level only → every word.

**Your own typing is checked too**, live and non-blocking: anything above the level is
underlined as you type. English is deliberately *not* flagged — `怎么说 fried egg` is how
you ask for a word you do not have.

**Words you meet are learned.** Four routes, all landing in the 词 panel: typed by you
(automatic, toggleable), tapped in a message, added by hand, or requested by the model.
Added words join the allowlist, so the partner may use them too.

**Copy** buttons on every message and word; selection by hand gives the same clean text.

**Export flashcards** for Pleco or Anki, with the sentence you met each word in.

## Settings

| | |
|---|---|
| **API key** | OpenRouter key, stored on this device only |
| **Model** | any OpenRouter id; load the live catalogue here |
| **Conversation starters** | show or hide the chip row |
| **Text size** | 16–34px, with a live preview |
| **Reply length** | short (1–2 sentences) / medium (3–4) / longer (5–6) |
| **System prompt** | edit the assembled prompt, or leave it tracking the pickers |
| **Anki cards** | deck, note type and field names for the one-tap links |
| **Tries before giving up** | 1–6; each is another API call |
| **Prompt mode (A/B)** | with or without the wordlist in the prompt, and the counters |
| **Version** | what is actually running on this device |

---

# How the constraint works

**Segmentation against the allowlist itself** — deliberately not jieba or any other
segmenter. A general segmenter splits against its own dictionary and then you check
membership, which disagrees at every boundary the two dictionaries define differently.
Matching directly against the allowlist makes *unsegmentable* and *disallowed* the same
signal, and the word boundaries it produces are reused for tap-to-gloss and for the live
underlining under the composer.

The match is a shortest path, not a greedy walk. Greedy maximum matching strands a
character whenever a longer word starting earlier wins the position: with 不便 in the list,
不便宜 segments as 不便 + 宜 and reports 宜 as out of level, though 不 + 便宜 covers it
exactly. The failure rate grows with the list, so `segment()` picks the segmentation
leaving the fewest characters unmatched, breaking ties toward fewer (longer) words. It is
O(n · maxLen) over a chat-length string — cheap enough to run on every keystroke.

`maxLen` is derived from the loaded file, never hardcoded.

## The retry loop

1. generate;
2. on violations, name them — `你用了「苹果」。这些词太难…`;
3. on violations again, name them *and* supply permitted substitutes, found by scanning the
   allowlist for entries sharing a character with the violation.

The number of tries is a setting (1–6, default 3); each is another API call, and 1 means no
repairs at all. After the last failure the app returns a sanctioned in-level refusal
(`我不知道。`) with a **gave up** badge, so a failure never reads as an answer. Repair
exchanges live in a scratch array and never enter stored history. Retries are invisible
apart from an attempt-count badge, and `finish_reason: "length"` shows as **cut off** —
truncation and a model choosing to stop look identical in the output and want opposite
fixes.

## Non-obvious choices

- **Roman letters are a violation coming back, never going out.** Treating all ASCII as
  always-allowed lets a model answer in English or pinyin and pass, so `a-zA-Z` gets its own
  violation kind and its own repair line. Your English is the opposite case and is sent
  verbatim. The asymmetry lives at the call sites; `validate()` reports the kind and lets
  the caller decide.
- **Model scaffolding is stripped, not repaired.** A model can wrap its answer in subtitle
  timestamps (`[0.0:] 我喜欢听中文歌。`), markdown emphasis or headings. That is formatting,
  not a vocabulary mistake, so `stripScaffold()` removes it before validation rather than
  spending repair attempts on it: bracket groups containing no Chinese, and `* _ \` #`.
  Bracket groups *with* Chinese inside are left alone, as are Chinese quotation marks.
  The always-allowed ASCII set is now deliberately narrow — brackets and markdown characters
  counting as punctuation is exactly how those timestamps reached the screen unchallenged, so
  anything left after stripping is a violation and does reach the repair loop.
- **The learner's own ASCII is never a mistake.** Symbols in your own message (`50%`, `—`)
  are neither underlined nor learned as vocabulary; the same characters in a reply are.
- **Numerals combine.** A run of number characters is one token only when every character
  in it is already allowed, so 二十三 glosses as one word without widening the vocabulary.
- **`EXTRA_ALLOWED`** in `validator.js` covers particles the published lists omit (啊, 呀,
  儿, 嗯, 哦). Grow it empirically — every violation is logged to the console.

Known limitation: the matcher constrains *words*, so an above-level compound built entirely
from in-list characters (想要 = 想 + 要) passes. The grammar rules in the system prompt
handle that class instead.

---

# Simplified or traditional

Settings → **Characters** switches the whole app between 简体 and 繁體: the allowlist, the
starters, the prompt and the validator.

No second dataset was needed. The HSK dumps carry a `traditional` form on every entry and
the converter had been discarding it; `data/*.json` now ships `t` alongside `w`, present
only where the two differ (6,352 of 10,969 entries at HSK 7–9). Traditional mode swaps which
form is the lexicon key and keeps the other on the entry, so the word popover shows both.
Nothing in `validator.js` knows about scripts — it matches whatever keys it is given.

The app's own Chinese — rules, samples, starters — is converted **word by word against the
wordlist**, not character by character. That is where the ambiguity lives: 干 is 幹 or 乾
depending on the word around it, and the wordlist already knows which. Anything unmatched is
left alone. Traditional mode also adds a rule telling the model to write 繁體字.

About 3% of entries list several traditional variants (岸/㟁, 幫/幇/幚); the form belonging to
the word's main reading is the one used.

`test/prompt.test.js` validates every sample and starter **after conversion** against the
traditional lexicon, plus a check that the conversion is doing real work — otherwise those
assertions would pass vacuously on unconverted text.

Words you added keep the form you added them in; switching scripts does not rewrite them.

# The prompt grows with the level

`prompt.js` holds a register profile per band — a vocabulary rule, a grammar rule, a worked
sample and the conversation starters — and `build()` assembles them with the length setting
and the fixed machinery (the `[[NEED:]]` channel, the English rule).

The grammar rule starts as a banlist and turns into permission:

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

**Reply length is deliberately level-neutral**, so the two axes compose instead of fighting.
A model that answers in one line is usually obeying the prompt, not failing.

`test/prompt.test.js` checks what a person cannot eyeball: every sample and every starter
validates against **its own level's** allowlist, samples from HSK 4 up are genuinely illegal
at HSK 1 (so the ladder climbs rather than just rewording), the bans really disappear by
HSK 5, and assembly keeps each level's rules while the `[[NEED:]]` channel and the English
rule survive. Language the app ships must survive the app's own validator — several drafts
did not: 怎么样 and 英文 are not HSK 1, 季节 is not HSK 3, 平衡 and 节奏 are not HSK 5.

## The A/B flag

HSKStory reports that including the vocabulary list in the prompt makes output *worse*.
Both paths are built: Settings → Prompt mode toggles `without-list` (rules only) and
`with-list` (allowlist appended). The counters accumulate turns, mean retries per turn and
give-ups per mode — run ~20 turns each way and compare. Assume neither result.

Settings also exposes the assembled prompt itself. Untouched it keeps tracking the level and
length pickers; edited, it is sent as written with `{level}` and `{words}` substituted.
Saving compares against what the box was filled with, not a freshly generated default —
otherwise changing the level while the panel is open would silently freeze the old wording.

---

# Meeting new words at a graded-reader pace

Optional, off by default, in Settings. Graded readers introduce roughly one unknown word per
40–50 characters of text you already know; this does the same with the level above the one
you are on.

- **Pool** — everything in HSK N+1 that HSK N does not have, ordered by corpus frequency, so
  the useful words come first. At HSK 1 that is 750 words beginning 啊, 让, 但, 自己, 可以,
  已经, 因为.
- **Budget** — Han characters in the partner's replies accumulate; every *R* of them earns a
  credit, capped at 3 so a long gap cannot dump six new words into one reply. Kept per level.
- **Offer** — holding a credit, the turn offers the three commonest words you have not met.
  The prompt frames it as permission, not instruction: *use one if it fits naturally, none if
  they do not.* A word forced into a conversation reads as a vocabulary drill, so a declined
  offer simply carries to the next turn.
- **Validation** — offered words are legal for that turn through the same path `[[NEED:]]`
  uses, and the same slate is re-offered across repair attempts, so a reply rejected for
  unrelated reasons never costs the introduction.
- **Consolidation** — an introduced word is highlighted, permanently allowed, and actively
  reused by the partner until you have seen it three times, then it becomes ordinary
  vocabulary and stops standing out. A word met once is not learned.

The 词 panel lists what has been introduced with sightings and source level, and the
flashcard exports include them — they are exactly the words worth drilling.

The arithmetic lives in `pace.js` and is tested directly (`test/pace.test.js`): pool ordering
and exclusion, character counting that ignores punctuation and Latin, credits that carry
their remainder and stop at the cap, slates that never re-offer, and spotting that uses the
segmenter's boundaries so a word is not credited for appearing inside a longer one.

At HSK 7–9 there is no level above to draw from and the feature reports that rather than
doing nothing quietly.

# Growing the allowlist

Four ways a word joins the session allowlist, all landing in the 词 panel (persisted,
removable):

1. **Words you type**, automatically — on by default. Learned *before* the reply is
   generated, so the model may use them in the same turn.
2. **Tap a red word → Add.** Works on your messages and the model's.
3. **By hand**, in the 词 panel.
4. **`[[NEED:词|pīn yīn|english]]`** from the model, offered with accept / reject buttons.
   This is also how it answers "how do you say X".

Two problems the naive version gets wrong, both handled:

- A violation span is a *run* of unmatchable characters, so it can fuse two words
  (因为苹果). Runs are split against the reference list before being stored.
- A violation can equally be *part* of a word: 西 and 问 are in HSK 1, so typing 西瓜 or
  问题 only flags 瓜 and 题. The span is grown against the reference list (题 → 问题), and
  when the whole word is outside HSK 1–9 entirely (西瓜 is), the gloss lookup receives the
  sentence and names the word the fragment belongs to — accepted only if that word occurs
  in the sentence and contains the fragment.

The reply carrying a request is validated against a lexicon that *includes* that request's
words. Without this the channel defeats itself: the wrapper is stripped before validation,
the bare word is by definition not in the allowlist, and the request the model was told to
make is rejected as a violation.

Pinyin and meaning come from `data/hsk7.json` (10,969 words) used as a reference dictionary.
Only a word missing from it costs one small API call, batched per message and failing soft.
Each added word also stores **the sentence it was met in**, captured at add time because it
cannot be recovered later.

---

# Flashcards: Pleco and Anki

The 词 panel exports a file, and hands single cards over by URL.

- **Export for Anki** — CSV with `#separator` / `#html` headers: the word, and pinyin /
  meaning / sentence joined with `<br>`. Anki desktop: File → Import. Current AnkiDroid
  versions import CSV directly; older ones need the desktop import and a sync.
- **Export for Pleco** — tab-separated headword / pinyin / definition, Pleco's documented
  import format. Pleco (iOS and Android): Flashcards → Import Cards.
- **Per-word Anki link** — [AnkiMobile's `anki://x-callback-url/addnote`](https://docs.ankimobile.net/url-schemes.html),
  configured in Settings with deck, note type and field names (they must match your
  collection exactly; nested decks use `::`). **iOS only** — AnkiDroid does not implement
  the scheme ([feature request #10292](https://github.com/ankidroid/Anki-Android/issues/10292)),
  so on Android use the CSV export.
- **Look up in Pleco** from the word popover — [`plecoapi://x-callback-url/s`](https://www.plecoforums.com/threads/urls-scheme-in-pleco.5875/),
  with `x-success` so Pleco offers a button back. Works on both platforms.

Delivery goes through the Web Share API, because iOS will not let a page save a file on its
own and the share sheet can hand it straight to Pleco or Files. Download is the desktop
path, clipboard the last resort.

**Not wired up, but possible.** Pleco does have a flashcard *import* URL —
`plecoapi://x-callback-url/fl?u=<url-encoded URL of a .txt list>` — which would make import
one tap. It needs the file at an `http(s)` URL, and this app generates it in the browser
with no server to put it on, so a blob or data URL will not do. If you ever commit an
exported list to the repo, that raw URL works by hand.

---

# Development

```
index.html        markup, CSS and app logic
validator.js      the matcher, shared by the page and the tests
prompt.js         per-level register profiles, starters, prompt assembly
data/hsk1..7.json the allowlists: {"w":"你好","p":"nǐ hǎo","d":"hello"}
test/             three suites and a runner
tools/            one-shot scripts: wordlist conversion, icon generation
sw.js  manifest.json  icon-*.png    the PWA shell
```

Run it locally with any static server — `file://` cannot fetch the lists:

```
python3 -m http.server 8000
```

Deploy by pushing: Pages serves the branch root, and there is nothing to build.

## Deploying, and testing a branch without touching the live page

`.github/workflows/pages.yml` publishes **every** branch to one Pages site:

| branch | URL |
|---|---|
| `main` | `https://toddclaw.github.io/Hsk_chat/` |
| anything else | `https://toddclaw.github.io/Hsk_chat/preview/<branch>/` |

So the public page is always `main`, and testing a branch on a phone never involves changing
a repository setting. Slashes in branch names become dashes
(`claude/new-session-jw19j3` → `preview/claude-new-session-jw19j3/`). Deleting a branch
deletes its preview.

**One-time setup:** Settings → Pages → *Deploy from a branch* → **`gh-pages`** / root. The
workflow creates that branch on its first run. Until you switch, everything keeps serving
from `main` as before.

Two details that make this safe:

- Publishing `main` clears the site root but explicitly spares `preview/`, so a release
  never wipes the previews.
- The workflow copies an **explicit list** (`.github/publish-files`), not everything minus
  exclusions — adding a file to the repo should not publish it by accident.
  `test/release.test.js` fails if that list stops covering something `index.html` loads or
  the service worker pre-caches, which is the one kind of breakage that would appear only
  after deploying.

The workflow runs `sh test/run.sh` before publishing, so a red branch never reaches a URL —
`main` included.

Each preview is a separate service-worker scope, so a preview cannot poison the live app's
cache. It is the *same origin*, though, which means it shares `localStorage`: your key
carries over (convenient), and so does your history and vocabulary (be careful with
destructive testing).

For the fastest loop, skip deploying altogether — run `python3 -m http.server 8000` on a
computer and open `http://<its-lan-ip>:8000` from the phone on the same wifi. Everything
works except the service worker, which needs a secure context, and that is the part you
least want while iterating.

## Tests

`sh test/run.sh` runs all three, no dependencies:

| suite | covers |
|---|---|
| `test/validator.test.js` | the matcher, its fixtures, every level file's shape |
| `test/prompt.test.js` | register profiles, starters, prompt assembly |
| `test/release.test.js` | release consistency |

**Enable the pre-commit hook once per clone:**

```
git config core.hooksPath .githooks
```

It refuses a commit whose tests fail. It exists because of a real repeated slip: a patch
script asserted on a line that had been reworded, exited before applying the version bump,
and the commit ran anyway — shipping code with a stale `VERSION`, which nothing could
notice. `test/release.test.js` checks what a diff cannot show and what only fails later on
a phone:

- `VERSION` in `index.html` and `CACHE` in `sw.js` name the same release. Out of step, an
  update ships behind an unchanged cache name and never reaches an installed app.
- Every path in the worker's `SHELL` exists — `cache.addAll` is all-or-nothing, so one 404
  means the worker never installs and offline support vanishes silently.
- Every script and manifest the page loads exists *and* is pre-cached.
- Every level file and the reference dictionary named in `index.html` are present.

Both guards were verified by deliberately breaking them.

## Updating an installed app

Settings shows a version block — the page's `VERSION`, the cache the worker activated,
worker state, loaded word counts. If the first two disagree, an update is half-applied and
one relaunch finishes it.

Three things make a deploy land, and missing any one strands the phone on an old build:

- **The shell is network-first.** Cache-first on `index.html` meant a redeploy could never
  reach an installed app. Wordlists stay cache-first — large, rarely changed, and a stale
  one is still correct.
- **That fetch uses `cache: "reload"`.** A plain network-first fetch is still answered by
  the browser's own HTTP cache; GitHub Pages sends `max-age=600`. The worker script itself
  registers with `updateViaCache: "none"` for the same reason.
- **The page reloads when a new worker claims it**, guarded twice: `controllerchange` also
  fires on first install, and a reload must not cascade.

Measured end to end against Pages-like headers: the new build renders in well under a
second on one relaunch. **Bump `VERSION` and `CACHE` together** — the release test enforces
it.

## Layout and text size

The page must not scroll sideways, and one trap made it: flex items default to
`min-width: auto`, so a `<select>` cannot shrink below its longest option — a model id like
`qwen/qwen3-30b-a3b-instruct-2507` pushed the header buttons past the right edge and took
the document with them. The level select keeps its natural width; the model select absorbs
the shrinking.

Message size is a `--msg` custom property (16–34px). The pinyin ruby is sized in `em` so it
scales with the text, and is **CSS generated content** rather than a DOM node so that
copying a line yields the Chinese alone — `user-select: none` is not enough, because
Chromium still puts such text into `Selection.toString()`. Word tokens are `inline-block`,
not `inline-flex`, because a flex box serializes as a block and a copied line came out one
word per line.

Checked by measurement, not by eye: every element's box against
`documentElement.clientWidth`, at 375 / 390 / 430 px, at sizes 16 / 26 / 34, with the chat,
Settings and 词 panels open.

## Wordlist provenance

`data/*.json` is generated by `tools/convert.py` from the HSK 3.0 level dumps supplied by
the user — 506 / 1,256 / 2,209 / 3,181 / 4,240 / 5,363 / 10,969 words, cumulative, level 7
being the combined 7–9 band. The converter merges duplicate entries, repairs CC-CEDICT's
`u:` notation (`nu:3` → `nǚ`), and picks a display reading: an explicit override for
function words whose literary reading carries more senses than the everyday one (了 le,
吧 ba, 着 zhe), then non-surname readings, then the reading with the most senses.

```
python3 tools/convert.py <level1.json> data/hsk1.json <level2.json> data/hsk2.json ...
```

The service worker caches only the shell and HSK 1 on install; the other lists and the
reference dictionary total a few megabytes and are cached on first use.

---

# Not included, on purpose

Streaming (a partial response cannot be validated), audio, spaced repetition, accounts,
sync, traditional characters.
