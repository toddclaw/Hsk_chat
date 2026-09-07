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
credit**. Before the catalogue is loaded Settings offers a **Try a known-good model**
dropdown; after it is, tick **display free models only** to filter the real list. Models
priced at zero cost nothing to call, and the picker shows what everything costs per million
input tokens so the paid ones are one tap away when you want them.

**The free option is `openrouter/free`**, a router OpenRouter maintains rather than a single
model. It cannot go stale the way a specific id can — which is the whole reason it is the one
named here. It picks a different free model per call, so quality varies a great deal.

This file used to name a specific free Gemma endpoint. OpenRouter withdrew it, which left the
one option aimed at someone with no credit as the one that failed outright; its closest live
relative and the other Gemma free endpoint both answered `429 rate-limited upstream` on every
attempt the same afternoon. **Free endpoints come and go, and the live catalogue is the
authority on ids, not this file.**

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

## API key setup

Settings has **Paste** (reads the clipboard, with the iOS permission-denial path handled
rather than silently failing) and a show/hide toggle next to the key field, and **Test
connection**, which calls `GET https://openrouter.ai/api/v1/key` with the key as a bearer
token — not a chat completion, so testing a key costs nothing. A working key reports
`✓ Key works. You're ready to chat.` with its free-tier status and credit limit; a rejected
one reports OpenRouter's own error text.

The **balance sits beside the key field** and fills in whenever Settings opens, from the same
endpoint — `$19.56 left` for a key with a spending ceiling, or `$0.41 used` for one without,
since "left" means nothing when there is no ceiling. It stays blank rather than showing
`$0.00` when the lookup cannot be made: the app works offline, and a zero you cannot
distinguish from an unanswered question is worse than no number at all. An account that
really is empty still reads `$0.00 left`.

## What it costs

If you do add credit: a turn sends roughly 1k tokens and gets back ~100, so at cheap-model
rates it is a fraction of a cent; a retry costs another round. **Optimise for retry rate, not sticker price** — a cheap
model that averages two retries costs more, and feels slower, than a better one that gets
it right first time. The A/B counters in Settings measure exactly that.

The first thing to do in Settings is **Load model list from OpenRouter** — it is the first
thing the Models section offers until you have. The handful of ids compiled into the page are
unverified starting points with no prices attached, and model ids change often. Once the
catalogue is cached that button steps aside for the pickers and becomes a quiet **Reload
list** at the bottom of the section.

## A model that works well

**Qwen: Qwen3 30B A3B Instruct 2507** (`qwen/qwen3-30b-a3b-instruct-2507`) — very cheap, and
it generally gets there after a few retries. It is **the default a new install starts on**,
for the reasons below; the frontier ids beside it in the built-in list are recognisable names
to reach for, not recommendations, and at HSK levels they cost a great deal more to do the
same job.

The "after a few retries" part is the point, and it is worth setting up for:

- **Raise *Tries before giving up* to 4 or 5.** The retries are what make this model work,
  and at its price several of them still cost less than one call to a frontier model. The
  default 3 will give up on turns it would have solved.
- Watch the retry counters rather than the price when comparing it with anything else. A
  model that converges on the second try beats a cheaper one that needs five.

It is a reasonable default for this app generally: the task is short, simple Chinese under a
hard constraint, which rewards instruction-following and Chinese-native training far more
than reasoning ability.

Two alternatives were measured against it and both lost, which is worth recording because
neither is an obviously bad model:

| | out-of-level replies | output tokens | real cost per reply |
| --- | --- | --- | --- |
| `qwen3-30b-a3b` | 4/16 | 17 | **$0.000032** |
| `deepseek-v4-flash` | 8/16 | 125 | $0.000046 |

DeepSeek V4 Flash lists at *half* the output price and came out 44% dearer per reply, because
brevity and retry rate dominate the per-token rate at this scale.

For the teaching model, `qwen-2.5-72b-instruct` caught **10 of 20** planted grammar errors
against `qwen3-235b-a22b`'s **20 of 20**, on the same cases and five trials each. It is
cost-neutral and terser, and it misses half of what the grammar check exists to find — which
is close to worse than nothing, since the failure mode is telling you a wrong sentence is
fine.

---

# What the app does

**Levels.** The picker in Settings switches the whole allowlist between **HSK 1** and the
combined 7–9 band, mid-conversation; a read-only chip in the header says which one you are
under. The bands are the official **HSK 3.0** syllabus
(《国际中文教育中文水平等级标准》, 2021), parsed from
[hsk-syllabus-vocabulary-parser](https://github.com/Punpuf/hsk-syllabus-vocabulary-parser):
**300 / 497 / 988 / 1,978 / 3,557 / 5,334 / 10,896** words, cumulative.

Cumulative is the app's own doing, and it matters. The syllabus lists each band's *additions*
(300 / 204 / 507 / 1,019 / 1,638 / 1,815 / 5,622), and lists a handful of words at two bands
for two different senses — 半 appears at both 1 and 4. A level here is the whole allowlist
rather than the band's own additions, so `tools/convert.py` assigns every word its **earliest**
band and builds each file from all bands at or below it. That is why the cumulative totals come
out slightly under the syllabus's running sums, and why a word met at HSK 1 stays legal at
HSK 4 — advancing must never take vocabulary away. `test/validator.test.js` fails if the levels
ever stop nesting. Existing messages re-render against the new list.

An earlier version of this app carried an invented **HSK 0.5** band — the old HSK 1.0 syllabus
wedged in below band 1 — and level files from a source that disagreed with the standard by a few
dozen words per band. Both are gone. The counts above are asserted by `test/prompt.test.js`, so
the prose and the shipped data cannot drift apart.

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
Added words join the allowlist permanently, so the partner may use them too — but are
highlighted green only the **first** time they appear anywhere in the visible history.
After that they render as ordinary text; the point was to notice the word once, not to
keep flagging it forever. That is computed fresh on every render (`renderAll()` always
redraws the full history in order), so there is no counter to fall out of sync.

**Copy and speak** on every message, and in the word popover. Speech uses the device's own
Chinese voice through the Web Speech API — with none installed the browser either stays
silent or reads Chinese with an English voice, so Settings says which voice is in use, or
where to install one. Speaking speed defaults to 0.8×, since the default rate is quick for a
learner. (Audio was a non-goal in the original design; it is here because it was asked for.)

**English translation and English explanation**, on every message — the partner's and your
own. Translation is one cheap call, cached on the message and rendered below the Chinese —
the button toggles it without refetching once it exists. Explanation opens a sheet and, the
first time, asks the model to break the sentence down: the grammar, why each word or particle
is there, and anything above your level. That prompt is told your current level and the words
you have recently been introduced to, so it can point at what is actually new to you rather
than re-explaining everything. Below the breakdown is an open follow-up chat — it is **not**
run through the validator or held to Chinese, in either direction, so you can ask anything
and get a real answer rather than a level-appropriate one. Answers arrive in Markdown whether
or not the model is asked for it, so the sheet renders a small subset of it — bold, headings,
bullets, code — instead of showing you the asterisks.

**These two calls have their own model setting**, separate from the one you chat with, because
holding a simple conversation and diagnosing a grammar mistake are different jobs and small
models are much better at the first. A cheap model that chats perfectly well called both
二个人去了 and 他跑的很快 correct — 二 for 两 before a measure word, and 的 for 得 — and
praised them, which is the worst way for a grammar check to be wrong. A larger one caught both
on the identical prompt, and still declined to invent faults in sentences that were fine. The
conversation can stay cheap while what you are told about your own sentences is worth
trusting; these calls only happen when you press a button, not every turn. Set it to **Same as
the chat model** if you would rather it not.

**Check my grammar** is also given the last few turns of the conversation, because a learner
sentence is often only judgeable against what it answers: 我也是 is fine after a statement and
odd after a question, and unreadable with neither. Four turns rather than the whole
conversation — measured against the real model, more context never made it invent faults and
never cost it the grammar rule, but the transcript is background, and an unbounded one grows
with every turn for no measured gain. Explaining the *partner's* reply gets no transcript: that
sentence is known-good and self-contained.

The four prompts behind those buttons are editable in **Advanced → Teaching prompts** —
translation and grammar-check for your own messages, translation and explanation for the
partner's. `{text}` is the sentence, `{level}` your level, `{recent}` the words you have just
been introduced to, `{context}` the turns leading up to it. Left alone, each keeps tracking the app's own version rather than freezing
today's wording, the same bargain the system prompt makes.

## What it has cost

**Connection → Spend** shows today, each of the last ten days, and an all-time total, and the
collapsed Connection row shows your **remaining balance** rather than just confirming a key is
stored.

The figures are what OpenRouter actually charged, not tokens multiplied by a price list: every
call asks for `usage.include` and the reply carries its own cost, already net of any prompt
caching. That cannot drift when a price changes, and needs no model catalogue loaded. Retries
count, because a retry is real money; so do the translate and grammar-check buttons.

Spend is kept **per device and summed**, for the same reason time is — see below. Ten days of
detail, then the running total.

Prices in the model pickers show **both sides**, `$0.09→$0.55/M`, because output is the
expensive one and the two do not track each other. That matters more than it sounds: a model
with a *lower* per-token price can cost more per reply if it is wordier, and cost more again
if its replies fail the level check and trigger retries. Measured on this app, one model at
half the output price came out **44% more expensive per reply** than the default, because it
wrote seven times as much and needed twice as many retries. **Optimise for retry rate and
brevity, not sticker price.**

The teaching prompts also ask, in so many words, for no headings, no bullets, no bold, no
emoji and no closing encouragement. "Be concise" on its own did nothing — models decorate this
answer whether or not it is wanted, and the decoration is pure output cost. Naming the
specific things not to emit cut output 39%, from 289 tokens to 177, with the error-catching
rate unchanged and no faults invented in correct sentences.

## Time chatting

**Conversation → Time chatting** keeps a today and an all-time total, and today's shows on the
collapsed section row. The clock advances only while the app is visible *and* you have typed or
tapped in the last couple of minutes, so a tab left open overnight adds nothing; reading a long
reply still counts, which is right, since reading the Chinese is the activity.

It is counted **per device and summed**, not as one number. Preferences sync last-write-wins,
which is correct for a setting and wrong for a counter — ten minutes on a phone and five on a
laptop would resolve to whichever synced last and throw the other away, silently. Each device
only ever writes its own entry and only ever increases it, so merging is a `max()` per field:
no coordination, no ordering, and two devices offline for a week still converge. See
`time.js`.

On your own messages the second button reads **Check my grammar**, because what it is
pointed at is different: your sentence may be wrong, and a prompt that assumes otherwise
explains a mistake rather than catching it. So that one is told the line may well be wrong
and asked for what it actually says, whether it is correct, a corrected version if not, and
the rule behind the fix — while being told not to manufacture a fault when the sentence is
simply fine. Translating your own line is deliberately literal for the same reason: it
renders what you wrote rather than a quietly repaired version, since the gap between the two
is the thing worth seeing.

**Try again** on any turn that ended in the fallback, and on every error card. A turn can
fail for reasons that have nothing to do with what you said — a busy free endpoint, a model
that would not come down to level this time — and retyping the message to retry is silly.
The failed reply or card is dropped first, so the history stays honest.

**Export flashcards** for Pleco or Anki, with the sentence you met each word in.

### Reporting Issues

Found a bug or have a feature request? Use **Settings → Report Issue** to submit directly to GitHub. The app automatically captures:

- System information (browser, version, platform)
- App state (HSK level, current activity, settings)
- Data summary (conversation count, vocabulary counts)
- Recent session data (messages, translations, explanations, grader results, new words)

You can preview and deselect any context items before submitting. Issues are posted to the [GitHub repository](https://github.com/toddclaw/Hsk_chat) with appropriate labels.

## Settings

Grouped into nine collapsible sections, ordered required-setup first and anything
destructive last: **Connection, Models, Conversation, Learning, Reading & audio, Flashcards,
Advanced, Sync & backup, About & data**. Collapsed, the whole menu fits one phone screen, and
several rows show their value without being opened — whether a key is stored, which model,
whether sync is on. A first run opens **Connection** on its own, since a missing key is why
Settings opened at all.

Closing commits. There is no Cancel: the fields are read out of the page when the sheet
closes, so the ✕ in the sticky header, the **Done** button and a tap outside the sheet all do
the same thing. (The backdrop tap used to close *without* saving, which quietly discarded a
key you had just pasted.)

| | |
|---|---|
| **Time chatting** | today and all-time, summed across every device you sync |
| **Spend** | today, the last ten days, and all-time — what OpenRouter actually charged |
| **API key** | OpenRouter key, stored on this device only |
| **Chat model** | picker, in Settings; defaults to Qwen3 30B A3B at ~$0.05/M |
| **Or paste any model id** | for anything the catalogue is not showing — applies as you leave the field |
| **Sort models** | by price (free first) or by name (A–Z) |
| **Browse and star models** | the catalogue as a searchable sheet: tap a row to choose it, tap ★ to keep it at hand |
| **Favorites only** | narrows both pickers to starred models |
| | (*free models only* deliberately does not reach the teaching picker — it would hide the paid models that setting exists to reach) |
| **Speaking speed** | 0.5× to normal, and which Chinese voice is being used |
| **Conversation starters** | show or hide the chip row |
| **Text size** | 16–34px, with a live preview |
| **Reply length** | short (1–2 sentences) / medium (3–4) / longer (5–6) |
| **System prompt** | edit the assembled prompt, or leave it tracking the pickers |
| **Teaching prompts** | the four behind translate / explain / grammar-check, individually editable |
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

## What the validator does not promise

The guarantee is **vocabulary**, and only vocabulary. Every word in a reply is on your list.
Whether those words add up to a sentence is a different question, and nothing here checks it.

A real exchange at HSK 2:

```
Partner:  你吃肉。很好。我吃鸡蛋。你喜欢鸡蛋吗？
Student:  我喜欢吃鸡蛋。我的朋友有鸡鸟。
Partner:  你朋友有鸡鸟。鸡鸟先生鸡蛋。我吃鸡蛋。你吃鸡蛋吗？
```

`鸡鸟` is not a word. The student appears to have meant 鸡, chickens. The partner then repeated
it back and went on to write `鸡鸟先生鸡蛋` — apparently reaching for 生, "produce", and landing
on 先生, "Mr.".

**The validator found nothing wrong with any of it.** At HSK 2, 鸡 and 鸟 are each legal words,
so `鸡鸟` segments as 鸡 | 鸟 — two allowed words in a row, indistinguishable from any other two
allowed words in a row. 先生 is an ordinary HSK 1 word. Zero violations, no retry, no badge.

So on this class of failure the model is unassisted, and model quality is doing all the work.
Measured on that exact exchange, the cheap default repeated `鸡鸟` back in roughly one reply in
six; a larger model did not do it at all in six tries, and when it *did* overreach — it tried
鸭, duck — the validator caught that immediately, because a single out-of-level word is exactly
what it is built to see.

Two things follow. **A wrong sentence made of right words will reach you**, and the retry
counter cannot warn you about it. And the teaching buttons are the backstop rather than the
validator: **Check my grammar** flagged `鸡鸟` correctly, and so did **English explanation** on
the partner's reply. If conversations start reading strangely, the cheapest first move is a
better chat model, not a stricter level.

## Sense validation: an allowed word is not an allowed meaning

The vocabulary matcher only ever sees surface form: once 得 sits in a level's allowlist, any
use of 得 passes. That is not enough. 得 alone covers three unrelated pieces of grammar that
happen to share a character:

- **dei_modal** — "must, have to" (děi): 我得走了, 你得小心
- **de_complement** — a structural particle linking a verb or adjective to a following
  complement of result, degree or possibility (de): 跑得快, 高兴得很, 听得懂
- **de_lexical** — fossilised inside an existing compound: 觉得, 得到, 值得, 记得…

Meeting 得 inside 觉得 does not mean the dei_modal "must" construction has been met, and the
vocabulary matcher has no way to tell the two apart from the character alone. `senses.js` is a
small registry that represents ambiguous words this way — by *usage*, not surface form — and a
per-level policy says which senses are allowed where.

Two more words get the same treatment, tiered to match the grammar this app already unlocks by
level in its own system prompt (`prompt.js`'s `LEVEL_STYLE` — resultative complements 结果补语
open at HSK 3, directional complements 方向补语 at HSK 4 — rather than inventing new cutoffs):

- **着** — **zhe_durative**, an ongoing state or action (zhe): 他坐着, 门开着, vs.
  **zhao_resultative**, an achieved-result complement (zháo): 睡着了, 找着了, 够不着. Durative 着
  is the one this app already introduces at HSK 2; resultative 着 is a 结果补语 like any other,
  so it waits for HSK 3 alongside them.
- **过** — **guo_experiential**, "have done before" (neutral tone guo): 去过, 吃过, vs.
  **guo_verb**, the main verb "to pass/exceed" or a resultative/directional complement: 说不过,
  走过去 (full tone guò). Experiential 过 is the sense this app's prompt already names as newly
  allowed at HSK 2; guo_verb waits for HSK 4, once both complement categories are open.

| Level | 得 | 着 | 过 |
|---|---|---|---|
| HSK 1 | none | none | none |
| HSK 2 | none | zhe_durative | guo_experiential |
| HSK 3 | de_complement | + zhao_resultative | guo_experiential |
| HSK 4 | de_complement | both | + guo_verb |
| HSK 5–6 | + dei_modal | both | both |
| HSK 7–9 | both | both | both |

de_lexical (and any word's compound-only sense generally) is never gated: it only ever occurs
inside a compound word, which the segmenter already folds into one token the moment that
compound is itself in the active lexicon — if the compound is above level, ordinary vocabulary
validation rejects it before this module is ever consulted. There is nothing left for a sense
check to do with it, so it is documented but never offered as a classification choice.

**Words considered and left out.** 了 (完成体 le_perfective: 我吃了饭 vs. 语气助词 le_change,
change-of-state/emphasis: 我不去了, 太好了) is the same shape and this app's prompt already
tries to gate it below HSK 2 — but 了 is standalone in a large fraction of ordinary replies
from HSK 2 up, and a classify call on most turns is real added latency and OpenRouter cost that
the prompt-only rule avoids; left ungated by choice, not by oversight. 把 does not exist in this
app's own HSK 1–2 word lists at all — the syllabus first lists it at HSK 3, the same
level the 把-construction is already unlocked — so there is no gap between what vocabulary
already blocks and what a sense policy would add. 的, 一, 在, 要 are ruled out on frequency
alone (的 alone appears in nearly every sentence); 就 and 才 have too many overlapping discourse
senses to classify reliably into a short, discrete list. Directional/resultative complement
words as a family (上/下/来/去/出/起/到/掉/住/完/懂/见…) are a real extension of this idea, but
a larger one — a distinct project rather than a registry entry.

**The check runs only when it has something to check.** Classifying a sense costs a model
call, so `wordsPresent()` looks for a registered word occurring *standalone* — not folded into
a longer allowlist word by the segmenter — and the app skips the call entirely when nothing
standalone turns up (a reply full of 觉得 and 不过 never spends one). When one does turn up, one
call classifies every occurrence of that word in the reply at once (a second registered word
in the same reply is a second call), and the pipeline extends the existing retry loop rather
than replacing it:

1. generate;
2. JS hard validation (vocabulary, as always) — a reply that already fails here skips the
   sense check entirely, since it is getting repaired regardless;
3. only once vocabulary passes, classify any standalone registered words and check the result
   against the level's policy;
4. on a disallowed sense, name it and suggest an alternative — `你用的「得」是必须、应该的意思
   …这个用法在这个级别还不可以用，可以换成：要 / 必须` — and loop for another attempt, exactly
   like a vocabulary repair;
5. exhausted attempts still fall back to the sanctioned refusal, same as any other failure.

A classify call that cannot be reached **fails open**: the reply is allowed through rather
than rejecting an unrelated turn over a validator that itself couldn't be reached.

Adding another ambiguous word is a registry entry in `senses.js` alone — the trigger, the
policy lookup, the classify prompt (built entirely from the entry's own sense names, no
per-word code), and the repair prompt all read from it, so no other code changes.

## Non-obvious choices

- **Roman letters are a violation coming back, never going out.** Treating all ASCII as
  always-allowed lets a model answer in English or pinyin and pass, so `a-zA-Z` gets its own
  violation kind and its own repair line. Your English is the opposite case and is sent
  verbatim. The asymmetry lives at the call sites; `validate()` reports the kind and lets
  the caller decide.
- **Echoing is a repair, not an answer.** A partner under tight vocabulary and length limits
  can satisfy every rule by handing the learner's own question back — 你喜欢喝茶吗？ answered
  with 你喜欢喝吗？ — which reads as not having understood a word of it. `echoesQuestion()`
  compares content words: if the reply's closing question introduces nothing the learner did
  not just say, it is an echo, and the loop asks once for a real answer. The rules were all
  constraints and none of them asked for a *reply*, so the prompt now also says to answer
  first, add something, then ask something new — with a worked example of doing so.
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

## The grammar check answers in one line when it can

**Check my grammar** used to ask for four numbered paragraphs whatever the answer: what the
sentence says in English, whether it is correct, a correction, then the rule. Two problems.
The first paragraph re-translated the sentence, which is exactly what the **English
translation** button beside it does, so every check opened by answering a different question.
And a fixed four-part shape means a *correct* sentence still gets four paragraphs, which
reads as though something must be wrong with it.

It now leads with one of three verdicts, quoted in the prompt as literal lines so they come
back scannable and identical every time:

```
Natural.
Understandable, but not how a native speaker would say it.
Not correct.
```

After **Natural.** it stops. Otherwise the corrected sentence goes on its own line, then at
most two sentences naming the rule rather than describing the edit. The middle verdict is
carried by an explicit instruction to judge idiom and not only grammar — described only as
"blunt or unidiomatic" it never fired, and the three-way verdict collapsed to two.

Measured against `qwen3-235b` over fourteen HSK 1–2 sentences, eight with a known error and
six correct:

| | errors caught | false alarms | output tokens/reply |
| --- | --- | --- | --- |
| four paragraphs | 8/8 | 0/6 | 172 |
| verdict first | 8/8 | 0/6 | **34** |

Same detection, same restraint, 80% shorter and 60% cheaper. The verdicts are **quoted**
rather than described for a reason worth keeping: described as "say which of three it is:
natural at their level…", the model echoed the description back including its third person,
so the learner was told *"natural Chinese at their level"* — a note about them, addressed to
someone else.

The explain-a-reply prompt keeps its four paragraphs. It is answering an open question about
someone else's sentence, which is a different shape from a verdict.

## Choosing a model without scrolling

The live catalogue runs to several hundred entries, which is not a `<select>` on a phone.
**Browse and star models** opens the same list as a sheet with search, a sticky ✕, and a ★ on
each row. Tapping a row chooses that model and closes; tapping ★ keeps it and does not,
because starring is a batch job and choosing is not.

It reads `S.freeOnly`, `S.favOnly` and `S.modelSort` rather than carrying its own copies —
one answer to "what am I looking at", not two that drift apart. Both filters yield when they
would empty the picker, and the model currently in use is always listed even when a filter or
the catalogue would drop it: a picker that cannot show what you are talking to is worse than
one showing an extra row, and a hand-typed id need never be in the catalogue at all.

Favorites sync with the rest of preferences.

## Correcting the learner's own Chinese

A rule at every level: when the student's grammar or word choice is off, restate what they
meant correctly — in words they already have, simplified further if needed — and then
actually continue the conversation rather than only correcting. That last clause matters:
without it, a correction reads as a substitute for a reply, which is the same failure shape
as the echo problem it sits next to in the prompt (rule 6) but for a different reason —
an echo hands the sentence back unchanged, a correction restates it fixed.

`prompt.js` numbers its rules by array position now rather than by hand-typed digits, after
inserting this rule shifted every rule below it and required editing five call sites and two
tests to keep up. A test asserts the numbering is gap-free and collision-free across every
level with every conditional rule (script, offer, required word, reuse) active at once — the
exact combination that broke before.

Finding a natural mocked correction (你说「我很喜欢喝茶」。) also caught a real gap: 「」
corner quotation marks — the quoting style the prompt's own instructions use — were not in
the always-allowed punctuation set, so a model quoting a correction back in that style would
have had it rejected as vocabulary. Fixed in `validator.js`, with a fixture proving the
brackets survive `stripScaffold()` rather than being taken for model formatting.

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

Settings → Prompt mode toggles `without-list` (rules only) and `with-list` (allowlist
appended). Both paths were built because HSKStory reported that including the vocabulary list
makes output *worse*, and for a long time this project had no key to check with.

**It has now been checked at four levels, and the answer depends on the level.** The list
helps where it constrains and stops helping once it does not: violation tokens more than
halve at HSK 1 and HSK 3, and the advantage decays to nothing by HSK 4 (p = 0.72) and HSK 6
(p = 1.00) while the cost climbs from 2.7× to 33×. Full numbers, the way the two arms fail
differently, and the place name that reverses the HSK 6 result are in
[RESEARCH.md](RESEARCH.md#whether-the-allowlist-belongs-in-the-prompt).

The default is `without-list` at every level, which the measurement says is the wrong arm at
HSK 1–3 and the right one from HSK 4 up. A single global toggle cannot express that.
Reproduce or extend with `tools/prompt-ab.js`; the in-app counters (turns, mean retries,
give-ups per mode) remain for a longer, messier read from real use.

Settings also exposes the assembled prompt itself. Untouched it keeps tracking the level and
length pickers; edited, it is sent as written with `{level}` and `{words}` substituted.
Saving compares against what the box was filled with, not a freshly generated default —
otherwise changing the level while the panel is open would silently freeze the old wording.

---

# The grader

Every message you send is graded against the turn it answers, and marked **✓** or **✗** in
its meta row. Tapping a ✗ opens what to fix:

```
我昨天很高兴了。
What you probably meant     I was happy yesterday.
A better way to say it      我昨天很高兴。
  词 ✓ word choice    语法 ✗ grammar    语序 ✓ word order    地道 ✓ naturalness
  了   了 does not attach to a stative adjective
                                      [ Done ]  [ Ask a follow-up ]
```

Four categories, because each is a different repair: a wrong word is looked up, a broken rule
is learned, a wrong order is a pattern, and unnatural-but-legal is a collocation. Keeping the
last separate is what stops "foreign-sounding but correct" being filed as a grammar error and
skewing the counts — and the grammar check already drew that distinction as its middle verdict.

It runs on the teaching model, off the critical path: the reply is not made to wait on a
verdict about what you already said, and the badge fills in when it lands. About a hundredth of
a cent per message. Switch it off in Settings → Learning.

**Ask a follow-up** hands over to the grammar-check chat rather than growing a second one. The
grader answers a fixed set of questions; anything else about the sentence is what that sheet
already exists for.

## Tags, and why they are a fixed list

The grader returns a **tag from a closed taxonomy** rather than free prose. Free-text error
descriptions do not aggregate — every phrasing differs, so "your top mistakes" becomes a list
of one-offs and a drill has nothing to select on. Seventeen codes, from corpus studies of
learner Chinese rather than intuition: measure words, aspect split by marker, and adverbial
word order singled out because it alone accounts for over half of all word-order errors in
learner writing. `wrong-character` is there because this app can see it — you type pinyin and
pick from a candidate list, so your wrong characters are usually homophones, which a
handwriting app never observes.

Measured before any of it was wired up: with a code and a two-word gloss the model produced the
right *correction* every time and filed it under the wrong heading, 3/6. A worked
wrong-to-right example per tag took that to 7/7. The table is in
**[RESEARCH.md](RESEARCH.md)**.

Three things are checked rather than trusted, because a machine-read answer fails differently
from a human-read one:

- **`ok` is recomputed.** A model that lists errors and still says `ok: true` would show a
  green tick over a red detail sheet.
- **Unknown tags are dropped.** The four display categories sit near the tag list in the prompt
  and leak into it about once in eleven calls. An invented tag in the ledger is worse than a
  missing one — it becomes a top mistake nobody can drill.
- **An unreadable answer is recorded as unreadable**, shown as `?`, and retried on tap. Stored
  as a pass it would be a lie; left absent it would be re-requested on every render.

## Your top mistakes

Settings → Learning counts the tags across **every** conversation — a recurring mistake recurs
precisely because it spans them — and shows the top three with the most recent example:

```
了             4    我昨天很高兴了。 → 我昨天很高兴。
measure word   3    我有三个书。 → 我有三本书。
不 vs 没        2    他不有钱。 → 他没有钱。
```

Scanned from the stored grades rather than kept as a running tally, which would be a second
source of truth to drift out of step.

# Activities

The header's first control is what kind of session this is. Three of them:

| | What it is | Who speaks first |
|---|---|---|
| **Chat** | open conversation, the app as it always was | you |
| **Focused chat** | the partner steers toward words you were taught and have never once written | the partner |
| **Story time** | a five-part story at your level, then questions about it | the partner |

**Choosing an activity starts a new conversation.** It is not a mode switch on the one you
are in — an activity is fixed when a conversation is created, so a transcript never mixes a
story with a chat, and the chat you left is one tap away under 💬. The chat list labels every
row with its activity, because a list of mixed session types is unreadable without it.

Conversation starters only appear in **Chat**. They are openers for the *learner*, and the
other two open with the partner speaking first — offering one there would invite you to talk
over a story that has not started.

**Focused chat** draws its words from the same list the progress panel calls *never used*:
words the app introduced through pacing that you have not yet written yourself. That list
already existed, already sorted commonest-first, so the activity is one extra rule and a
different reuse list. There is no topic picker — a hand-authored topic taxonomy would need
maintaining per level and would fight the word goal whenever the two disagreed. The words pull
the conversation somewhere on their own.

**Story time** generates **five segments of about ninety characters**, each as its own turn,
and then asks you about what it just told you. The segment size is not a stylistic choice and
not arbitrary: `RESEARCH.md` explains why new words are metered per *turn* at one per 45
characters read, capped at three, with the remainder **discarded**. A 450-character story told
as a single turn therefore earns three new words and throws the other ten away — so the one
activity most entitled to graded-reader density is exactly where the cap silently removes it.
Ninety characters is two credits and stays under the cap, so no segment loses anything, and
five of them carry roughly ten new words. `test/pace.test.js` pins that arithmetic against the
constants rather than against the number, so changing either one fails the suite.

A segment the model cannot get down to level keeps its best attempt and the story carries on.
The canned fallback is survivable in a chat turn and nonsense in the middle of a narrative.

**Story time needs its own model, and Settings gives it one.** This is the one activity a
cheap model cannot do. Measured at HSK 1: two usable segments in fifty-five on the default
chat model, against thirty-three in forty on the default story model — and zero stories out
of eleven that worked, against eight out of eight. Six different prompt strategies were tried
first and none of them helped; two of them made a capable model worse. The write-up is in
DEVELOPING.md. It costs roughly **$0.10 a story**, about 170× a chat turn, which is why it is
a separate setting you can see and change rather than something the app quietly spends on
your behalf.

Its characters are called **小明, 小红 and 小白**, and that is not laziness — it is the only
way story time gets named characters at all. No name character is legal at any level the app
offers: `明`, `王` and `李` are absent from all 10,896 words of the combined 7–9 band, and
`红` and `白` do not arrive until HSK 5. So the three are named in the prompt and allowed for
those turns, the same way a `[[NEED:]]` word or a newly offered word is allowed — and they
stay illegal everywhere else, including in an ordinary chat. Measured against the alternative
of banning names outright: fewer out-of-level words per character, and stories you can
actually follow. See DEVELOPING.md.

# Conversations

The 💬 button in the header lists every chat: **New chat** at the top, then each conversation
with its message count and date. Tap a title to open it. Each row carries **Copy** (labelled
plain text to the clipboard), **Download** (the same as a `.txt`), **Rename**, and **Delete**.
Copy used to be one button in Settings, which made sense when there was only ever one
conversation to copy.

`S.history` still means what it always meant — the turns of the chat you are looking at — and
*is* the array inside `S.chatMsgs[S.chatId]`, not a copy of it. Ordinary pushes therefore
need no bookkeeping; the three places that reassign it are covered by `persist()` re-pointing
the map on the way through, and every one of them already calls `persist()`.

## Deleting has to leave a tombstone

`conversations` is a table rather than a column on `messages` for one reason: **a delete has
to be expressible to a device that was offline when it happened.** Hard-deleting the message
rows says nothing to that device, so its next push puts the whole conversation back, on every
device, and pressing delete again never makes it stick.

So a deleted conversation keeps its row with `deleted_at` set, and the merge treats deletion
as **monotonic** — a tombstone wins from either side regardless of timestamps. That exception
is load-bearing rather than defensive: the offline device is precisely the one likely to have
a *later* `updated_at`, because it kept chatting in a conversation that had already been
deleted elsewhere.

## Migration

`conversation_id` is nullable, and every device maps `NULL` to one **fixed** legacy id
(`00000000-0000-4000-8000-000000000001`). Deterministic on purpose: two devices each
generating their own id for the same old history would split one conversation into two, on
the very list whose job is telling conversations apart.

Migration is content-based rather than a "have I run yet" flag — it adopts a legacy history
when no conversation holds any messages yet. Keying it off the storage map merely existing was
wrong: a first run creates an empty placeholder chat, which writes that map, so a legacy
history arriving afterwards would vanish behind an empty conversation.

## An unmigrated database

`db/schema.sql` is safe to re-run and adds the table and the column, but somebody has to run
it — and the person reading the screen may not be the person who owns the Supabase project.
So the app **probes once and degrades** rather than failing: a missing table or column
(`PGRST205` / `42P01` / `PGRST204` / `42703`, matched on code, since messages are localized)
switches sync into a mode that strips `conversation_id` and pushes messages anyway.

Backing up the conversation matters more than remembering which chat it was in, and the
grouping comes back for free once the column exists. The 💬 sheet says so plainly, naming the
Hsk_chat administrator rather than assuming the reader is them.

Storage is the other new limit: conversation history is the first thing here that grows
without bound, so a `localStorage` quota failure is caught and reported instead of silently
losing the write.

# Words you already know

Settings → **Browse the words at any level** opens a searchable, checkbox list of any band's
vocabulary, commonest first — which is the order the words are worth learning in, and the
order pacing already offers them in. Paged 150 at a time, so a jump of a few thousand words
(HSK 6 → 7–9) does not render as one giant DOM dump. Ticking a word joins it to the
allowlist immediately: it stops being flagged, and pacing stops spending a credit offering
something you already had.

Grouped into four collapsible blocks, each carrying its count, so a level is a set of
answerable questions rather than one long scroll:

| | |
|---|---|
| **Not yet** | not usable yet. Pacing offers these commonest-first, and they are flagged if the partner uses one. Tick any you already know |
| **Already at your level** | in the level's own list. Always usable, nothing to do |
| **Met — added or introduced** | introduced by pacing, typed by you, or added by hand. Usable, and the ones worth drilling |
| **Ticked as already known** | you told the app you knew these. Usable, never offered, never flagged |

Only the first and last have tick boxes, because those are the two you can change — ticking
a word that is already usable would do nothing, so it is shown as done rather than as a box
that quietly ignores you. The first non-empty group opens, so the sheet never lands on four
closed headings. Searching answers flat instead of grouped: a search is a question about
particular words, and burying a three-word result under four headings hides the answer.

**Any** level, including your own: it used to be hardcoded to the next one, so there was no
way to review the list you are actually on without first dropping a level to look at it from
below.

It is kept as its own list (`S.known`), separate from words the app taught you (`S.extra`):
it has no sentence context, was not learned through a conversation, and so stays out of the
词 panel and the flashcard exports on purpose — this is a suppression list, not vocabulary
earned.

The two pools that use this data stay genuinely separate. The browser needs every next-level
word listed, ticked ones included, so you can change your mind and untick them; pacing needs
ticked ones removed from what it may offer, or a credit gets spent confirming something you
already know. One list serves both: `S.pool` never excludes known-ahead words, and pacing
filters them out only at the moment it draws a slate. Excluding them from `S.pool` itself was
the first attempt, and it meant a ticked checkbox made its own row vanish with no way back.

# Knowing when to move up

The lists are cumulative and frequency-ordered, and those two facts together make the
obvious progress bar a liar. HSK 1 is 300 words and HSK 2 is 497, so at HSK 1 you have
ticked off 60% of the HSK 2 *list* — but because language is Zipfian and the commonest words
carry most of the text, those same 300 words already cover about **88% of HSK 2 running
text**. The gap holds at every band, not just the first. A bar that starts at zero is telling you that you understand none of a level you can
mostly already read.

So Settings → **Learning** leads with the number that answers the question actually being
asked:

```
Progress to the next level
  ████████████████░░░░  88% of HSK 2 you can read — estimated     41% you can use
  ██░░░░░░░░░░░░░░░░░░  12 of 197 new words                      learned at HSK 2
  to 98%       58 more words, commonest first
  used by you  12 written in your own messages
```

A word's share of running text goes as 1/rank, so coverage weights each word by `1/f` rather
than counting it as one. The published thresholds this is measured against: **95%** lexical
coverage for adequate comprehension, **98%** for comfortable independent reading. At HSK 1
that is roughly 58 of the 197 new HSK 2 words to reach 98% — not 197 — and pacing already
offers them commonest-first, so it is working through them in the cheapest possible order.

**Two bars, because they answer different questions on different scales.** The first is
reading ability and it starts high — 88% for HSK 1 → 2 — because that is genuinely what share
of HSK 2 running text the HSK 1 words carry. Correct, and useless as a progress display on its
own: every word still worth learning lives in the top twelve points of it, so it looks nearly
full on arrival and barely moves while you work. The second is the level's **new** words, 0 to
100 across the same effort. Neither is the other's units, so they are not folded together.

Separate figures rather than one blended score, because they mean different things and the
gaps between them are the informative part. **Blue** is what you can **read** — every word the
level allows you. **Green** is what you can **use**, the same measure over the words you have
actually written. Each figure is printed in its bar's color, so the legend is the text
itself rather than a key you have to hold in your head. Green always trails blue, and that
gap is normal.
**Met** is what pacing has taught you. **Used by you** is that same production as a count,
segmented out of your own messages — it needs no new storage, since every message is already
saved, and it will always lag: recognition runs ahead of production and the gap widens with
proficiency.

> Every constant in this section — 95%, `1/rank`, six sightings — is argued with citations in
> **[RESEARCH.md](RESEARCH.md)**, along with the measurements behind them and an explicit
> account of where the evidence is thin. The 95% mark in particular rests on a regression
> between two tested points with 66 participants, and a 2023 replication found no threshold
> at all; it is a convention worth using and worth knowing the shape of.

**There is no threshold on the green bar, deliberately.** The 95%/98% reading marks exist
because unknown-word density and comprehension have a clean, testable relationship. Nothing
equivalent holds for production: the receptive/productive gap *widens* with proficiency, and
not every word a learner knows ever becomes productive — so any fixed "you should be able to
use X%" would be wrong at every level, and wrong in the same flattering direction. Published
productive targets are absolute vocabulary sizes instead (Nation puts functional speaking and
writing at 2000–3000 word families), not ratios against what you can read.

What *is* actionable is a list rather than a number, in the spirit of Laufer and Nation's
Lexical Frequency Profile — the question is not "what percentage" but "are you reaching for
the newer words or coasting on the commonest ones". So the panel's last row names words the
app has taught you that you have never once written:

```
never used   5 of the 9 you have met — try 说话、可以、以后
```

Commonest first, three at a time, from `S.learning` minus the words segmented out of your own
messages. Three characters you can put in your next message is a prompt; "5 unused" is a
statistic. Moving up is **not** gated on it, for the same reason there is no threshold — that
would block advancement on a gap that is supposed to be there.

An earlier version instead gave words you had written double weight inside a single score.
It cannot work, and the way it fails is worth knowing. Weight goes as `1/rank`, so the
commonest words carry enormous shares — `的` is rank 1 and weighs a full point — and having
typed the **ten** commonest words was enough to push the sum past the total and pin the bar
at 100%. Worse, it put the headline on a different scale from the words-to-threshold row
below it, so the panel could report "100%" and "57 more words to 95%" in the same breath.
One scale, two honest readings of it.

The percentage is an **estimate** and is labelled as one. `f` is a rank, not a token count,
so weighting by `1/f` is an assumption about the corpus rather than a measurement of it —
`ZIPF_EXP` in `pace.js` is the knob if it ever reads wrong. The word counts underneath it
are exact, which is half the reason both are on screen.

## What moving up does

At 95% a **Move up to HSK 2** button appears. It is a recommendation, never automatic: the
level decides what the validator enforces and what the partner may say, so changing it under
you mid-conversation would be the app rewriting the rules while you were using them. The
confirmation spells out what carries over, because "what happens to my words" is the
question that stops people:

- Everything you added, were introduced to, or ticked as known **stays usable**. Nothing is
  lost — `loadLevel()` replaces the level list only, and the allowlist is the union of all
  four sources.
- The partner may now use any word at the new level.
- New words start coming from the level above that, and the pacing budget starts fresh
  (it is kept per level).
- You can move back down at any time.

Words introduced from the level you just moved *into* stop appearing under "introduced from
the next level" — they are simply part of your level now, and leaving them there turned a
working set into an archive that grew every time you advanced. Filtered, never deleted: the
sighting counts survive and dropping back down brings the rows back.

# Meeting new words at a graded-reader pace

Optional, off by default, in Settings. Graded readers introduce roughly one unknown word per
40–50 characters of text you already know; this does the same with the level above the one
you are on.

- **Pool** — everything in HSK N+1 that is not already usable — the level below, the
  always-allowed particles, and anything you have added or been introduced to — ordered by
  corpus frequency, so the useful words come first. (Without the particles excluded, the very
  first offer at HSK 1 was 啊, which is permitted at every level: a credit spent on nothing.) At HSK 1 that is 750 words beginning 啊, 让, 但, 自己, 可以,
  已经, 因为.
- **Budget** — Han characters in the partner's replies accumulate; every *R* of them earns a
  credit, capped at 3 so a long gap cannot dump six new words into one reply. Kept per level.
- **Offer** — holding a credit, the turn offers the three commonest words you have not met,
  and asks for one to be used in a natural sentence, declining only if none can be. A word
  forced in reads as a vocabulary drill, so a declined offer carries to the next turn.

- **Escalation** — asking politely does not work with every model; some read the offer as
  optional and never take it, however the rule is worded. After **two** turns where an offer
  went unused, the commonest word stops being a suggestion and becomes a condition of the
  reply, enforced by the same repair loop that enforces vocabulary rather than by stronger
  wording: a reply without it is sent back asking for it. A reply that is otherwise legal but
  still lacks the word is kept and shown rather than discarded for the fallback — the
  conversation is never degraded to make a point — and the decline is counted so the next
  turn tries again.

  **Rule 1 has to grant the exception explicitly.** Left absolute — *never use a word the
  student does not know* — it forbids exactly what the offer permits, and a model resolving
  that contradiction obeys the rule stated first and stated without exception. The offer was
  ignored every turn until rule 1 gained *（第 10 条的新词除外。）*. Settings shows the words
  currently on offer, so a model that keeps declining is visible rather than looking like a
  feature that does nothing.
- **Validation** — offered words are legal for that turn through the same path `[[NEED:]]`
  uses, and the same slate is re-offered across repair attempts, so a reply rejected for
  unrelated reasons never costs the introduction.
- **Consolidation** — an introduced word is highlighted, permanently allowed, and actively
  reused by the partner until you have seen it **six** times, then it becomes ordinary
  vocabulary and stops standing out. A word met once is not learned.

  Six, not three. Incidental acquisition needs roughly 8–10 encounters to be reliable and
  most semantic gain lands between 3 and 7, so three was calling a word learned at the very
  bottom of the range. This is not just a label: the same test picks the list of words the
  prompt asks the partner to work back in, so raising it is what actually buys the extra
  encounters. Measured against the real model before shipping — 60 replies per arm, no
  change in out-of-level rate or reply length, about six times as many reuse words actually
  used. The numbers are in DEVELOPING.md.

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
- A violation is cut where the *level's* lexicon happens to end, which is rarely where the
  word ends. At HSK 1, 我喜欢跟狗一起走 flags 起走 — 一 is known, 起 and 走 are not — and
  storing that fragment teaches the app a word that does not exist, then legalises it, so the
  partner starts using 起走 back. `wordsAt()` reads the span off a *dictionary* segmentation
  of the same sentence (我 喜欢 跟 狗 一起 走) and stores the words overlapping it: 一起 and 走.
  It trusts that only when it finds a real multi-character word, because the dictionary also
  holds most single characters and 托德 would otherwise be filed as 托 and 德.
- When the whole word is outside HSK 1–9 entirely (西瓜 is), the gloss lookup receives the
  sentence and names the word the fragment belongs to — accepted only if that word occurs in
  the sentence and contains the fragment.

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

# Cloud sync

Off by default. Sign in in Settings to back up the conversation, added words, and settings
to the cloud, and pick up where you left off on another device. The OpenRouter key never
syncs — it stays on the device it was pasted into, same as always.

**Sign-in is GitHub only**, via Supabase Auth's OAuth provider — no new account to create,
and it sidesteps Supabase's default 2-emails/hour cap on magic-link email, which would make
a plain email flow flaky in practice. Everything else is a static call straight from the
browser to a Supabase project (Postgres + Auth + Row Level Security); there is still no
backend for this app to run.

**What syncs and what doesn't:**

| Syncs | Stays local only |
|---|---|
| Conversation history, including translations and explain-chats | The OpenRouter API key |
| Added words, introduced words, words marked known ahead of time | The cached OpenRouter model list (public data, cheap to refetch) |
| Level, model, script, pinyin mode, reply length, pace settings, custom system prompt, Anki field names, and the rest of Settings | — |

**How conflicts are handled**, since two devices can each have their own local copy: chat
history and vocabulary sync as real rows (see `db/schema.sql` and `sync.js`), not one blob —
a message is keyed by a client-generated id, so an edit (a translation added later) upserts
the same row instead of duplicating it, and a delete removes it remotely too so it cannot
quietly reappear from another device's next sync. Vocabulary merges by word, so two devices
adding different words never collide, and a word's "seen" count on both sides takes the
higher value, since seen only ever increases. Preferences are the one place last-write-wins
applies — a single row per user, low-stakes if a rare simultaneous edit overwrites one, since
re-opening Settings shows the current value either way.

**Delete all cloud data** sits below *Sync now* and *Sign out*. It removes every row this
user has — conversation, all three vocabulary tables, preferences — clears the conversation
on this device, and turns sync off. Words already added stay on this device: with sync off,
local and cloud are free to differ, and wiping local vocabulary too would make it a factory
reset rather than what the label says. Sync is switched off *before* the delete rather than
after, so a push already sitting on the debounce timer cannot land in between and put the
rows straight back.

Sync pulls on sign-in and whenever "Sync now" is pressed, and pushes are debounced a couple
of seconds after a local edit settles. A push or pull failure never blocks the chat itself —
sync is additive on top of an app that already works fully offline, and it fails open: the
status line says "Sync failed — will retry" and the app carries on exactly as if it were off.

## Setting up your own Supabase project

This is a one-time setup an app owner does, not something each user repeats:

1. Create a free project at [supabase.com](https://supabase.com).
2. Paste all of `db/schema.sql` into the project's SQL editor and run it once. It creates
   the tables above with Row Level Security scoped to `auth.uid()` — a signed-in user can
   only ever see or write their own rows — plus a `_keepalive` table (see below) with RLS
   enabled and no policies at all, so only a service-role/secret key can touch it.
3. Create a GitHub OAuth App (GitHub → Settings → Developer settings → OAuth Apps). Its
   callback URL is `https://<project-ref>.supabase.co/auth/v1/callback`. Paste the Client ID
   and a generated secret into Supabase's Authentication → Providers → GitHub.
4. In Supabase's Authentication → URL Configuration, set the Site URL to the production
   page, and add `.../preview/**` and `http://localhost:<port>/**` as additional redirect
   URLs — Supabase's redirect allowlist supports `**` path globbing, so one entry covers
   every preview-branch URL this repo's deploy workflow creates, not one per branch.
5. Put the project's URL and **publishable key** (Project Settings → API — safe to commit;
   it ships in client-side code by design, same as the OpenRouter endpoints already hardcoded
   in `index.html`, and RLS is the real access boundary) into the `SUPABASE_URL` /
   `SUPABASE_ANON_KEY` constants near the top of `index.html`'s script.

**Keeping the free project awake.** Supabase pauses a free-tier project after 7 days with no
database *activity* (dashboard visits and cached reads don't count), which would otherwise
leave sync silently stopped until someone clicks "resume" in the dashboard. `db/schema.sql`'s
`_keepalive` table and `.github/workflows/keepalive.yml` handle this: a scheduled job, every
3 days, writes a timestamp using a **secret key** (Project Settings → API — this is the
powerful one, formerly called the "service_role key"; it bypasses RLS entirely and must
never appear in the app itself). Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as
repository secrets (Settings → Secrets and variables → Actions) for the workflow to use.

Supabase's newer secret keys (`sb_secret_...`) must be sent only in the `apikey` header —
unlike the legacy `service_role` JWT they replace, adding the same value to an
`Authorization: Bearer` header gets it rejected as an invalid JWT rather than accepted.

---

# Development

**[DEVELOPING.md](DEVELOPING.md)** has the working notes: getting node without
root, enabling the pre-commit hook, what the browser suite needs, and the
accumulated gotchas around previews, OpenRouter model ids, RLS and the
segmenter. This section covers the layout and the everyday commands.

```
index.html        markup, CSS and app logic
validator.js      the matcher, shared by the page and the tests
prompt.js         per-level register profiles, starters, prompt assembly
data/hsk1..7.json the allowlists: {"w":"你好","p":"nǐ hǎo","d":"hello"}
test/             seven suites and a runner (one drives a real browser)
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
the document with them. That select has since moved into Settings; the activity select is
the header's one flexible control now and absorbs the shrinking, and the level chip beside it
is a short button rather than a picker.

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
the syllabus — 300 / 497 / 988 / 1,978 / 3,557 / 5,334 / 10,896 words, cumulative, level 7
being the combined 7–9 band. (These are the shipped files' own entry counts, asserted by
`test/pace.test.js` so they cannot drift from the prose again — the figures here were stale
by a dozen or so words, and RESEARCH.md reasons about HSK 1 → 2 in terms of them.) The converter merges duplicate entries, repairs CC-CEDICT's
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

Streaming (a partial response cannot be validated), spaced repetition, accounts.

Sync and traditional characters were both on this list and were both since built --
cloud sync through Supabase (GitHub sign-in, no accounts of this app's own) and a
simplified/traditional switch in Settings. Audio arrived too, through the Web Speech
API. They are noted here rather than quietly deleted because the reasoning that put
them on the list is in the sections above, and it is worth knowing which way it went.
