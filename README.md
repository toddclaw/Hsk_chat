# HSK Chat

A Chinese conversation partner that is *mechanically* incapable of replying with words
outside a defined allowlist. Not a system prompt asking a model to stay at level — a
validator that checks every response and forces a rewrite when it fails.

Single static page, no build step, no backend. Add it to a phone home screen from
Safari → Share → Add to Home Screen.

```
index.html        markup, CSS and app logic
validator.js      the matcher (shared by the page and the tests)
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

Tests: `node test/validator.test.js` (no dependencies).

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

After three failures the app returns a sanctioned in-level refusal (`我不知道。`) with a
**gave up** badge, so a failure never reads as an answer. Repair exchanges live in a
scratch array and never enter stored history. Retries are invisible apart from an
attempt-count badge.

Non-obvious choices:

- **Roman letters are a violation, not neutral.** Treating all ASCII as always-allowed
  (as the original spec did) lets a model answer in English or pinyin and pass. Digits,
  whitespace and punctuation stay neutral; `a-zA-Z` gets its own violation kind and its
  own repair line.
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
   accept / reject buttons.

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
the reference dictionary total a few megabytes and are cached on first use instead.

## Not included, on purpose

Streaming (a partial response cannot be validated), audio, SRS, accounts, traditional
characters.
