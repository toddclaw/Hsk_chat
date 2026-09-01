# Research

Why the numbers in this app are the numbers they are.

Every pedagogical constant here — 98%, six sightings, one new word per 45 characters — is a
decision someone could have made differently. This file records what the second-language
acquisition literature actually says, what it does *not* say, which choices follow from it,
and which are ours with the evidence only pointing in a direction. Where we measured
something ourselves against a real model, the numbers and the method are here too.

It is deliberately honest about weak evidence. A constant defended by a study that does not
support it is worse than one labelled a guess, because nobody re-examines it.

- [How to read this](#how-to-read-this)
- [Constrained input](#constrained-input)
- [How new words are chosen](#how-new-words-are-chosen)
- [How many encounters a word needs](#how-many-encounters-a-word-needs)
- [Knowing when to change level](#knowing-when-to-change-level)
- [Production](#production)
- [Choosing a story, and being asked about it](#choosing-a-story-and-being-asked-about-it)
- [Measurements we ran](#measurements-we-ran)
- [Things that did not work](#things-that-did-not-work)
- [Where the evidence is thin](#where-the-evidence-is-thin)
- [Bibliography](#bibliography)

## How to read this

| | |
|---|---|
| **Follows from the literature** | the research supports this fairly directly |
| **Informed by it** | the research constrains the choice but does not make it |
| **Ours** | a judgment call; the research is silent or mixed |
| **Measured** | we ran it against a real model and counted |

Constants live in `pace.js` and `prompt.js`. Every claim below names the one it justifies, so
a reader who disagrees can find the line to change.

## Constrained input

**Follows from the literature.** The whole design — a partner that may only use words you
know, enforced by a validator rather than by asking politely — is the comprehensible-input
position: acquisition happens when input is understood and slightly ahead of current
competence. The practical form of "slightly ahead" is a coverage figure, which is the next
section.

Graded readers are the closest established analogue and are where the pacing rate comes from:
they introduce roughly one unknown word per 40–50 running words of known text. `DEFAULT_RATE`
is 45 characters, the middle of that band, and the Settings picker offers 25–80 so it can be
moved. **Ours:** graded-reader guidance is stated per *word*, and this app counts *Han
characters*, which at HSK 1–2 average well under two characters per word. The rate is
therefore stricter than the reader convention, not looser, which is the safe direction to err
in but is not a translation anyone published.

## How new words are chosen

**Follows from the literature.** Commonest first. Frequency ranking is the least controversial
idea in vocabulary pedagogy: the return on learning a word is its share of the text you will
meet, and that share is steeply unequal. `HSKPace.buildPool()` orders candidates by corpus
rank and the offer takes the top three unmet words.

This is also what makes the coverage arithmetic below work. The two are the same fact seen
twice: frequency ordering is worth doing *because* coverage rises steeply, and coverage rises
steeply *because* the ordering is frequency-based.

## How many encounters a word needs

**Informed by the literature, then measured.** `PROMOTE_AT = 6`.

The literature does not agree on a number, and the honest summary is a range:

| study | encounters for reliable learning |
| --- | --- |
| Rott (1999) | 6 |
| Horst, Cobb & Meara (1998) | 8 |
| Nation & Wang (1999) | ~10, and still no guarantee |
| Pigada & Schmitt (2006); Webb (2007); Pellicer-Sánchez & Schmitt (2010) | 10+ for substantial gains |

Two findings sharpen it. First, no number guarantees acquisition — exposure interacts with
salience, context richness and the learner. Second, and more useful here, the requirement
differs by *what* is being learned: orthographic knowledge benefits greatly from around three
exposures, while most semantic gain lands between three and seven.

The app previously used 3. That sits at the very bottom of every estimate above, and squarely
in the "you can now recognize the shape of it" band rather than the "you know what it means"
band. Six is the low end of the reliable range and the top of the semantic-gain window.

**Why not 10.** Words are held in the reuse list until promoted, and that list is capped at
six entries and fed to the model as *please work these back in*. Pushing the threshold to 10
keeps every word in rotation far longer, which starves new introductions and makes the
conversation visibly repetitive. Ten is defensible on the reading alone and was rejected on
the product: a chat that keeps saying the same six words is not input any more. This is a
constant we would revisit if anyone measured retention directly, which we have not.

`PROMOTE_AT` is not only a label — `HSKPace.isNew()` also selects the reuse list, so it is
the mechanism, not a display setting. That made it a prompt change, which meant measuring it.
See [Measurements we ran](#measurements-we-ran).

## Knowing when to change level

This is the part with the most research behind it and the most room to get wrong.

### Coverage, not word count

**Follows from the literature.** The HSK lists are cumulative, so the obvious progress bar —
words ticked off the next level's list — is available and misleading. At HSK 1 you know 300 of
HSK 2's 497 words: 60% of the list. But because the lists are frequency-ordered and language
is Zipfian, those same 300 words already account for about **88% of HSK 2 running text**.

The gap is a property of the syllabus rather than a quirk of the first band. Across all six
transitions the list share runs 49–67% while text coverage runs 88–95%, and
`test/pace.test.js` asserts that separation at every one of them — if it ever closed, weighting
by `1/rank` would be pointless and the panel could go back to counting words.

A bar reading 60% tells a learner who can already follow most of a level that they know barely
half of it.

The converse is also true and is why the panel draws **two** bars. Coverage is the right
measure of reading ability and a poor display of effort: because the commonest words carry
most of the text and the learner already has them, the whole useful journey from arriving at a
level to being ready for the next sits in the top ten or twelve points of a hundred-point
scale. It looks nearly full on day one and creeps. So the level's *new* words get their own
bar on their own 0–100 scale. Two questions, two scales, neither expressed in the other's
units — the same discipline that keeps reading and production apart above. So `HSKPace.coverage()` weights each word by `1/rank` and reports the share of *text*,
not the share of the list.

Chinese supports this: word-frequency distributions in large Mandarin corpora conform to
Zipf's law with an exponent very close to 1, which is why `ZIPF_EXP` defaults to 1.

### The 95% mark

**Follows from the literature, with two caveats we take seriously.** `READY_AT = 0.98`.

Two thresholds are conventional. Laufer & Ravenhorst-Kalovski (2010) put **95%** coverage as
the minimum for adequate comprehension (≈4000–5000 word families in English) and **98%** as
optimal for independent reading (≈6000–8000). Hu & Nation (2000) is the origin of the 98%
figure. The app marks 98% on the bar and fires its recommendation there; 95% is named in the
UI text as the lower reference.

The caveat, which most citations of these numbers omit: **Hu & Nation never tested 98%.** They
tested 80%, 90%, 95% and 100% coverage on a 633-word narrative seeded with pseudowords, with
66 learners at one New Zealand university; 98% is a regression estimate between two tested
points. And Kremmel et al.'s 2023 replication in *Language Learning* found that once L2
vocabulary size and reading ability were accounted for, coverage remained only a weak
predictor of comprehension, with **no clear threshold** visible at all.

So these are well-established conventions resting on thinner evidence than their ubiquity
suggests. We use one because a recommendation has to fire somewhere and they are the most
defensible lines available — not because a learner crossing one has crossed anything real. The
UI never says *"you are ready"*, and the button it reveals is a suggestion.

**The second caveat is ours, and it decided which threshold to use.** 95% is *degenerate*
against the real syllabus. The bands are cumulative and each adds mostly rarer words, so
coverage of the next band starts high: HSK 5 already covers **95.3%** of HSK 6 text before a
single new word is learned. At 95% the recommendation would fire on arrival, having
recommended nothing. At 98% every transition asks for between a quarter and a third of the new
words — 29 / 36 / 43 / 44 / 27 / 34 percent — which is consistent in a way 95% is not.

98% is also the better fit on its own terms: moving up makes the next level the one you
*read*, so the bar that matters is the one for reading it unaided rather than the one for
minimally following it.

At HSK 1 the mark falls at **58 of the 197 new HSK 2 words** — which is the number worth
showing a learner, rather than 197.

### A recommendation, never automatic

**Ours.** The level sets what the validator enforces and what the partner may say. Moving it
automatically would change the rules of the conversation while someone was having it. Neither
of the obvious comparisons gates on a metric either: LingQ shows a climbing known-words count
and lets you read whatever you like, and Anki schedules reviews without any notion of
advancement. Nothing in the literature suggests a learner is harmed by moving up early, and
the failure mode is self-correcting — the retry counters and the validator make too-hard
immediately visible.

## Production

**Follows from the literature: there is no threshold, and inventing one would be false
precision.**

The panel shows two figures on one scale: what you can read, and what you can *use* — the
same coverage calculation over words segmented out of your own messages. It does not put a
target on the second, for three reasons the research is clear about:

1. **The gap is supposed to be there.** Receptive knowledge exceeds productive knowledge for
   every learner in every language, including natives.
2. **It widens with proficiency.** Laufer found active-to-passive ratios falling from 89% to
   73% across a single year of high-school study. A fixed target would therefore be wrong at
   every level, and wrong in the flattering direction.
3. **Not every word becomes productive, ever.** A 100% goal is not merely hard, it is
   incorrect.

Published productive targets are absolute vocabulary *sizes* rather than ratios — Nation puts
functional productive vocabulary for speaking and writing at 2000–3000 word families — which
is a different kind of measure and not one a per-level bar can express.

What is actionable is a **list, not a gauge**, in the spirit of Laufer & Nation's Lexical
Frequency Profile: the useful question is not "what percentage" but "are you reaching for the
newer words or coasting on the commonest ones". So the panel's last row names introduced words
you have never once written, commonest first, three at a time. Three characters to put in your
next message is a prompt; "5 unused" is a statistic.

Moving up is **not** gated on production, for reason 1 above.

## Choosing a story, and being asked about it

Story time began as one thing the partner did to you: five segments, then a single question,
then the activity quietly became ordinary chat. Three separate literatures say that shape is
leaving most of the value on the table. This section records what they say and which parts of
the redesign follow from them; the design itself is in
`docs/superpowers/specs/2026-08-28-story-time-chooser-design.md`.

### Letting the learner choose the story

**Informed by it, and the direction is not the obvious one.** Self-Determination Theory is the
usual grounding for self-selected texts in extensive reading — autonomy raises intrinsic
motivation, which in Krashen's terms lowers the affective filter and makes input more likely
to be used. That argues for letting you ask for a story about whatever you like.

The 2025 meta-analysis complicates it. Across extensive-reading interventions the effects were
**larger** where learners' text choice was *limited* and where some form of accountability was
present. Unlimited choice is the motivating condition; constrained choice is the one that
measures well.

So the chooser is a short curated menu **and** a free-text box, not one or the other. The menu
is the constrained condition and carries the level guarantee for free, because its options are
written per level and tested. The box is the autonomy valve for the story you actually want,
and the comprehension questions are the accountability half — which makes them a benefit of
the design rather than a tax on it.

### Asking questions between the segments, not only at the end

**Follows from the literature, with one caveat that bites at HSK 1.** In the adjunct-question
study, narrative passages with elaborative questions embedded *mid-text* scored 45.85 against
36.81 for the no-question control on written recall (p < 0.01). Expository passages showed
nothing, which matters here: story time is the narrative case, and it is the case where the
effect was found.

The caveat is that the significant effect was specifically for **why** questions, which are
the highest-output kind there is — and at HSK 1 they are unanswerable, since 因为 is an HSK 2
word. The placement finding transfers; the question type does not, and has to be gated by
level (below).

The questions are offered at every pause rather than imposed, which is the same bargain
`storyStep()` already strikes for segments: driven by the learner, not looped.

### Which questions, at which level

**Informed by it.** TPRS — Teaching Proficiency through Reading and Storytelling — runs a
story as continuous easy questioning, "circling", and its question ladder is explicit:
Yes/No first, then Either/Or, then Who / What / Where / When / How many, and only then Why
and How. The ordering is by how much *production* the answer demands, not by how hard the
question is to understand: a yes/no question asks almost nothing of the learner, which is
exactly why it comes first.

That ladder is the justification for gating question type per level in `prompt.js` the way
`LEVEL_STYLE` already gates grammar — but which rungs are *available* comes from this
language's data, not from TPRS's English-ordered list, and it inverts part of that order. At
HSK 1 the partner may ask yes/no **and** every wh- form — 谁/什么/哪儿/几/多少/怎么样 are all
HSK 1 entries — while either/or waits for HSK 2, because 还是 is an HSK 2 word. Chinese wh-
questions are in-situ (谁去了? asks exactly like 他去了, with 谁 dropped into the answer's own
slot) and the question words themselves are among the commonest in the language, so they carry
no vocabulary cost the ladder needs to wait on. `prompt.js`'s `QUESTION_LADDER` implements this
corrected order, not TPRS's original one.

TPRS's own evidence base is mostly practitioner literature rather than controlled trials, so
this is *informed by*, not *follows from*. What it contributes is a defensible ordering, which
is more than we had.

### Staying on one topic and one cast

**Follows from the literature.** Krashen's case for narrow reading is that reading several
texts on one topic, or by one author, recycles the same vocabulary across varied contexts, and
that acquirers should specialise **early rather than late** — the opposite of the intuition
that beginners need variety.

Two things follow. The fixed cast — 小明, 小红, 小白 — was chosen in `prompt.js` for a purely
mechanical reason, that the syllabus carries no usable name characters at any level. Narrow
reading says it was also the right pedagogical choice, and that it should not be traded away
for variety. And the chooser should offer *more about a topic you have already read* beside
its fresh ideas, because that is the condition the evidence favours.

### Where this is thin

- The adjunct-question study is not on beginners, and its texts are far above HSK 1. The
  placement effect is assumed to transfer; nobody has shown that it does at this level.
- None of this has been measured **in this app**. Story time is the expensive activity, about
  $0.10 a story, so a counted A/B on the question phase is real money and has not been run.
  Until it is, the whole section is imported evidence rather than local evidence.
- Whether stories are *enjoyable* over a run of them is still only readable, not measurable —
  see the backlog entry on story time being unverified end to end.

## Measurements we ran

Prompt and pacing changes read as obviously-correct and sometimes measure backwards, so the
load-bearing ones are counted rather than argued.

### Raising PROMOTE_AT from 3 to 6

`qwen3-30b-a3b`, 60 replies per arm, HSK 1, ten introduced words with sightings spread 1–5 so
the two arms genuinely differ in reuse-list contents.

| | out-of-level replies | chars/reply | reuse words used per reply |
| --- | --- | --- | --- |
| `PROMOTE_AT = 3` | 14/60 | 16 | 0.05 |
| `PROMOTE_AT = 6` | 16/60 | 17 | **0.29** |

About six times the reuse for no measurable cost. The out-of-level difference is two replies
in sixty (z ≈ 0.42) — not significant, and sixty samples could not resolve it if it were real.

**The first run measured the wrong thing.** Seed sentences included `我叫王明`, and `王明` was
the commonest violation in *both* arms — the HSK lists contain almost no name characters and
`王` is HSK 4. It added noise to both arms and buried the effect. Seed material for any
prompt experiment here must be namefree.

### Shortening the grammar check

**Measured.** Verdict-first instead of four fixed paragraphs. `qwen3-235b`, fourteen HSK 1–2
sentences — eight with a known error, six correct — with a stronger model judging each reply
for whether it caught the error or invented one.

| | errors caught | false alarms | output tokens/reply |
| --- | --- | --- | --- |
| four numbered paragraphs | 8/8 | 0/6 | 172 |
| verdict first, stop if natural | 8/8 | 0/6 | **34** |

Detection and restraint both unchanged at 80% fewer tokens. The obvious risk — that an answer
allowed to stop early stops catching things — did not materialise at this sample size.

Two findings worth carrying:

- **Quote the words you want, do not describe them.** Described as *"say which of three it is:
  natural at their level…"*, the model echoed the description back verbatim, third person
  included, and told the learner their sentence was *"natural Chinese at their level"*.
  Quoting the three verdict lines fixed it and made them scannable.
- **A verdict the prompt only implies never fires.** "A sentence can be grammatical yet blunt
  or unidiomatic" was already in the prompt and the middle verdict still never appeared until
  an explicit *judge idiom, not only grammar* was added. Three-way verdicts collapse to two
  unless the middle one is argued for.

### The grader's taxonomy needs worked examples

**Measured.** The grader returns a tag from a fixed list so mistakes aggregate; a code and a
two-word gloss turned out not to be enough to choose between seventeen of them.
`qwen3-235b`, eleven HSK 2 sentences — seven with a known error and a teacher-assigned tag,
four correct.

| tag list | JSON parsed | errors caught | correct tag | correct sentences left alone |
| --- | --- | --- | --- | --- |
| code + gloss | 10/10 | 6/6 | **3/6** | 4/4 |
| code + gloss + worked example | 11/11 | 7/7 | **7/7** | 4/4 |

Detection was never the problem. The model produced the right *correction* every time and
filed it under the wrong heading — 三个书 tagged `wrong-word` rather than `measure-word`,
他比我很高 tagged `word-order-attributive` rather than `comparison-bi`. A ledger built on that
would have counted real mistakes under headings that could not be drilled.

Two smaller findings:

- **Category names leak into the tag field.** The four display categories (word, grammar,
  order, natural) sit a few lines above the tag list in the same prompt, and the model reached
  for them as tags. Saying "the four category names are not tags" cut it to one leak in
  eleven; the parser drops unknown tags regardless, because no prompt wording makes that
  guarantee.
- **Name the rule, not the edit.** Told to tag what was *fixed*, a missing measure word reads
  as a word being added. The instruction says to tag the rule that was broken.

### A response shape in the system role governs the whole conversation

**Measured, after it shipped broken.** Making the grammar check verdict-first put *"start with
exactly one of these three lines… after `Natural.` stop immediately"* into the **system**
message. That is where the level and the formatting rules live, and it was the obvious place —
but a system instruction applies to every later turn, not just the first.

Reported from real use, on `我吃饭了。你现在要吃饭了吗？`:

| | reply |
| --- | --- |
| first pass | `Natural.` |
| follow-up: *"What about the 现在 and the 了?"* | `Natural.` |
| same follow-up, conversational system prompt | *"The 现在 is fine because it clarifies the time… the 了 turns the sentence into a question about a change of state…"* |

The model was not ignoring the question. It was obeying an instruction to emit one of three
lines and stop, which nothing had withdrawn. The four-paragraph shape it replaced had no hard
stop, so follow-ups had always worked and the regression was invisible to a suite that only
ever asked the first question.

The rule this leaves: **an output-shape instruction belongs to the turn it shapes.** When a
prompt is reused across a conversation, the shape has to be swapped out with the question, or
the first answer's format silently becomes the format of every answer.

### Whether the allowlist belongs in the prompt

**Measured across four levels. The answer depends on the level, which is not how the setting
is built.**

Settings → Prompt mode chooses between `without-list` (the rules alone) and `with-list` (the
level's whole allowlist appended). Both paths exist because HSKStory reported that including
the list makes output *worse*, and this project had never checked. `tools/prompt-ab.js`,
`qwen3-30b-a3b`, 64 replies per arm per level, eight namefree seeds from `STARTERS[1]`,
`length=short`, arms interleaved so a mid-run provider change cannot land on one of them.

| level | list words | `without` bad/64 | `with` bad/64 | Fisher p | `without` tokens | `with` tokens | token ratio | cost multiple |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HSK 1 | 300 | 35 (55%) | 33 (52%) | 0.86 | 82 | 37 | **2.22×** | 2.7× |
| HSK 3 | 988 | 49 (77%) | 30 (47%) | **0.00097** | 74 | 38 | **1.95×** | 6.7× |
| HSK 4 | 1,978 | 34 (53%) | 31 (48%) | 0.72 | 53 | 42 | 1.26× | 12× |
| HSK 6 | 5,334 | 24 (38%) | 24 (38%) | 1.00 | 35 | 30 | 1.17× | **33×** |

**HSKStory's finding does not replicate — but the opposite claim does not hold everywhere
either.** The list helps at low levels and stops helping well before the top of the syllabus.
The violation-token ratio decays monotonically, 2.22 → 1.95 → 1.26 → 1.17, while cost runs the
other way, 2.7× → 33×. Length-normalising per 100 Han characters does not rescue the top end:
2.25 → 1.82 → 1.31 → 1.48.

Only HSK 3 is individually significant (p = 0.00097, surviving deflation for duplicate
replies). HSK 1 is a non-result on the binary rate at p = 0.86 — but its violation *tokens*
more than halve, 82 → 37, which is the effect a per-reply threshold cannot see because one
leaked 每 scores the same as one leaked 公园. **Counting violation tokens rather than replies
is the better measure**, and it is what makes the whole trend legible.

At HSK 4 the entire effect is 11 violation tokens across 64 replies (p = 0.72). At HSK 6 it is
5 tokens (p = 1.00), and see the contamination note below for why even those 5 are not real.

**The two arms fail differently at low levels, and stop doing so.** At HSK 1 `without-list`
reaches for a concept the level does not carry and writes the ordinary word for it — 公园,
窗户, 心情, 散步 — so 61% of its violation tokens are multi-character whole words, while
`with-list` stays near the list and trips on collocations that *extend* a listed word: 每 out
of 每天, 汗 out of 出汗, 通 out of 通常. By HSK 4 that distinction is gone (21% vs 24%
multi-character) and at HSK 6 it inverts (9% vs 27%). Both arms end up failing on rare
characters inside compounds — 韭菜, 馅, 蔬菜, 中暑 — which appear at the same rate either way.

**The mechanism this implies, and it explains the shape of the whole table:** the list helps
when it *constrains*. At HSK 1 and 3 the model wants words the level does not carry, and
showing it the list redirects it. By HSK 6 the model's natural register at short length
already sits mostly inside 5,334 words, so 7,600 tokens of list buys the forbidding of things
it was not going to say.

**A methodology finding that sharpens the existing namefree rule.** At HSK 6 the single
largest violation in `without-list` was 杭×9 — every one of them `我家在杭州`, from the
`你的家在哪儿？` seed. `with-list` produced no place names at all. Deleting that one character
takes `without-list` from 24/64 to 19/64 and **reverses the sign** of the whole comparison
(p = 0.454). The seeds were namefree, as this document requires — but the *model* volunteers
place names, and disproportionately in the arm with no list to anchor it, and `validate()`'s
`.name` filter does not catch 杭州. Namefree seeds are necessary and not sufficient; a
measurement about out-of-level words has to check whether a place name is carrying the result.

**Ours: the recommendation is level-dependent, which the current setting cannot express.** The
list earns its tokens at HSK 1–3 and does not at HSK 4 and above. HSK 4 is the ambiguous
boundary and this run does not resolve it; HSK 2, 5 and 7–9 are unmeasured, and on this trend
there is no reason to expect 7–9 to pay. The app ships `without-list` as its default at every
level, which is the wrong arm exactly where the difference is largest.

Three caveats, stated because they cut against the numbers rather than for them. Eight seeds at
temperature 0.7 is the weak point of the whole series: distinct-text counts look healthy but
the violation contexts show near-duplicates, so distinctness overstates independence, and a
wider seed set is worth more than more runs on these eight. One model, one length setting, one
temperature — a 30B model may lean on an in-context list more than a larger one would. And
**`[[NEED:]]` was used in 0 of 512 replies across all four levels**, so this series says nothing
about the escape hatch the prompt offers; at this model and `length=short`, that path never
fires at all.

### Prior art: what HSKStory does, and why most of it does not transfer

HSKStory is cited above as the source of the allowlist claim that did not replicate. Since
story time now generates long-form graded text, its published method is worth recording
properly — including the parts that argue against our design.

**They abandoned strict compliance on purpose.** *"The list is a grading target, but 300
entries cannot express every detail in a coherent story."* HSK 1 stories are claimed at
**over 96% compliance, not 100%**; above-level words stay in the text and are supported by
toggleable pinyin and tap-to-translate rather than removed. A human edits every story —
*"no raw writer output... was ready to publish as-is"* — and the pipeline is deterministic
checks plus *"editorial judgment."*

**Their vocabulary numbers are as bad as ours.** On a deliberately constrained HSK 1 task,
unique-type error rates were Qwen 3.5 Plus 30.9%, GLM-5 33.0%, DeepSeek V3.2 36.3%, Doubao
Seed 2.0 Pro 67.6%. Their own summary: *"Every route therefore had a high unique-type error
rate."* This is the most useful thing in it. Our story segments come back **100%
out-of-level on the first attempt at HSK 1** (DEVELOPING.md), and it would be easy to read
that as something wrong with our prompt. It is not: long-form HSK 1 generation is hard for
every model measured by anyone, including one with an offline pipeline and an editor behind
it.

**They route a different model per level** — DeepSeek V4 Pro for HSK 1–3 where vocabulary
control matters most, GPT-5.6 Sol for HSK 4–5, Kimi K2.6 for HSK 6–9 — while disclaiming it
as *"a dated routing snapshot, not a claim that one route is the best."* This app ships one
model for every level and every activity, and has never tested whether that costs story time
anything. `tools/story-ab.js --model` makes it a one-run question.

**They document structural failures and no remedy for them.** Kimi leaking English planning
text, GLM ignoring the requested concept, StepFun leaking English, models falling into
repetition. Nothing about empty completions or retries — so the one-call-in-eight empty rate
measured here has no prior art to borrow from.

**They say nothing about names anywhere we could find.** The problem that cost the most
effort here — no name character is legal at any level, since 明, 王 and 李 are absent from
all 10,896 words of the 7–9 band — appears to be unaddressed publicly.

**The structural difference, which is why the headline lesson does not transfer.** HSKStory
is a publishing pipeline; this is a live conversation. They can spend unlimited offline
retries and an editor per story. We generate in front of the learner on a three-attempt
budget, and there is nobody to review the output before it is read. So *"have a human check
it"* is unavailable, and *"relax the gate and annotate what leaks"* is not — this app already
owns every piece of that machinery: the popover, toggleable pinyin, the `[[NEED:]]` channel
and a `validate()` that already marks names without repairing them.

**Treat their numbers as directional.** Their one claim this project tested — that including
the allowlist makes output worse — is contradicted above at HSK 1 and HSK 3, and their
benchmark page disclaims itself in the same terms.

Sources: [How We Built AI-Generated Graded Chinese
Stories](https://hskstory.com/guides/ai-graded-chinese-stories), [Chinese LLM
Benchmark](https://hskstory.com/guides/chinese-llm-benchmark), [HSK 1 Reading
Practice](https://hskstory.com/guides/hsk-1-reading-practice). Retrieved 2026-08-27.

### Earlier measurements

Recorded in DEVELOPING.md with their working, and summarized here because they set the
methodology:

- **A cheaper model is not a cheaper conversation.** Across 16 replies at HSK 2, a model at
  half the listed output price cost 44% *more* per reply, because it wrote more and triggered
  more retries. Judge candidates with the validator and real usage figures, never the price
  column.
- **Naming decoration cut explain output 39%.** "Keep it concise" did nothing measurable;
  "no headings, no bullets, no bold, no emoji" did.

### Question conformance, and whether D9 survives it

**Measured, twice, because the first run alone would have misled.** `tools/story-ab.js
--questions --model qwen/qwen3-235b-a22b-2507` — the teaching model, because D9 routes
`storyPhase: "asking"` there — asked twenty questions per level at HSK 1–4 against one fixed,
namefree pre-written story, with no repair loop: this measures the first thing the model says,
not what three attempts buys it. Two counts per reply: `inLevel` (`HSK.validate` clean) and
`onLadder` (uses a marker from `questionTypesFor(level).types` and no marker from a type the
level does not permit).

| level | run 1 inLevel | run 1 onLadder | run 2 inLevel | run 2 onLadder |
| --- | --- | --- | --- | --- |
| HSK 1 | 17/20 | 19/20 | **4/20** | **9/20** |
| HSK 2 | 18/18 (2 empty replies) | 18/18 | 18/18 (2 empty replies) | 18/18 |
| HSK 3 | 20/20 | 20/20 | 20/20 | 20/20 |
| HSK 4 | 20/20 | 20/20 | 19/19 (1 empty reply) | 19/19 |

HSK 2–4 are clean and stable across both runs — every non-empty reply passed both counts, both
times. HSK 1 is not: it swung from 17/20 to 4/20 between two runs of the identical harness
against the identical story, which is exactly the run-to-run variance DEVELOPING.md warns
about elsewhere in this project — **one run here would have shipped a confident, wrong
number.** Pooled across both runs, HSK 1 is 21/40 (53%) `inLevel` and 28/40 (70%) `onLadder`.
Both runs fail the same way: the model reaches for 为什么 ("why") despite the HSK 1 ladder
rule explicitly restricting it to yes/no and the wh- forms, and 为 is not an HSK 1 word —

```
HSK 1 [why] 小明为什么很高兴？
HSK 1 bad:为 小明为什么高兴？
```

**Controller ruling: D9 stands.** Questions and discussing stay on the teaching model. The
brief makes D9 conditional on the teaching model's ability to ask in-level, ladder-conformant
questions, and at HSK 1 it plainly struggles — that is not being softened here. But reversing
D9 means paying the story model's price on every question at every level (`storyStep()`'s own
comment puts questions at "~37x cheaper" on the teaching model) to fix a weakness confined to
one level of seven, and two more things argue against reversing on this evidence alone: an
asking turn is not shipped raw — it goes through the ordinary `turn()` repair loop, so an
out-of-level or off-ladder question is validated and re-asked rather than reaching the learner
as-is, which costs attempts rather than correctness; and the story model was never measured
asking HSK 1 questions, so "move it back" is not itself evidenced to fix anything. HSK 1's
weakness is recorded in BACKLOG.md rather than acted on here.

### The cast prompt, and whether `maxTokens: 200` is enough

**Measured, twice.** `HSKPrompt.castPrompt` has no prior measurement on this branch. Run on
the **story** model (`anthropic/claude-sonnet-4.5`), because `declareCast()` calls
`storyModel()`, not the teaching model — `node tools/story-ab.js --cast`. Ten calls per run:
one topic per level 1–7 from `storyIdeasFor()`, plus three HSK 7 topics chosen specifically to
want a full cast — "six coworkers", "a family of six siblings", "a six-person heist crew" —
against `castMaxFor(7) = 6` and the same 200-token cap `declareCast()` imposes.

Across both runs (20 calls): **20/20 parsed into `[[NEED:]]` lines**, **20/20 respected the
cap** (never over `castMaxFor`), and every one of the six HSK 7 six-name topics (6 calls)
returned exactly 6/6 names, `finish_reason: "stop"` every time — none cut off — at reply
lengths ranging 208–320 characters:

```
needs=6/6  finish=stop  chars=320  ["张伟","李娜","王强","刘敏","陈浩","赵雪"]
needs=6/6  finish=stop  chars=208  ["李明","李芳","李伟","李娜","李强","李静"]
needs=6/6  finish=stop  chars=223  ["老大","阿强","小林","阿美","老张","瘦猴"]
```

**Verdict: 200 tokens is sufficient for a full six-name cast, but the margin is not large.**
Every six-name reply stopped naturally rather than being truncated, but 320 characters against
a 200-token budget is not deep headroom — a topic that pushed a little further (longer English
glosses, longer Chinese names) could still truncate. No change recommended on what was
measured; worth re-checking if `castMaxFor` ever grows past 6.

### The discussing phase: does it actually stop

**Measured, twice.** Task 9 added `storyPhase: "discussing"` with no measurement of its own.
Its rule: say whether the answer was right, restate it correctly, then **stop** — asking again
is the "Ask me another" button's job, not the model's. Measured on the **teaching** model,
where Task 10 routes it: `node tools/story-ab.js --discussing --model
qwen/qwen3-235b-a22b-2507`. One fixed question against the same fixed story, a correct and an
incorrect learner answer, five of each per level, HSK 1–4, two runs.

80 replies total (10/level × 4 levels × 2 runs). **79/80 obeyed the stop.** One failure, HSK 2,
correct-answer branch:

```
对，他去了商店。他买了什么？
```

— which restates the answer correctly and then asks a genuine follow-up, exactly the failure
mode the rule exists to prevent.

**Verdict: the rule is obeyed 98.75% of the time.** One lapse recorded rather than smoothed
over; not enough on its own to argue for a change.

### The topic arm, and whether D4 survives it

**Measured once — the result did not need a second run.** D4's assumption is that the declared
cast plus `validate()` is enough to keep a free-text topic in level. Two arms, six stories
each, HSK 2, `anthropic/claude-sonnet-4.5` (the story model): `no-topic` (the control — no
topic message, `declareCast()` never called, exactly what shipped before the chooser existed)
against `topic` (`--topic "the Monkey King"`, a real `declareCast()` call per story). Real
output, `node tools/story-ab.js --topic "the Monkey King" --stories 6 --level 2 --nojudge
--model anthropic/claude-sonnet-4.5`:

```
              out-of-level    mean chars  truncated  err+retry  cost
no-topic      10/30 (33%)     100 (asked 90)0          0+0r    $0.568305
topic         24/30 (80%)     29 (asked 90)0          0+0r    $0.545235

no-topic      violations/100 han: 3.2   total 95 over 3014 chars
  top: 园×7, 心×6, 可×4, 然×4, 聊×4, 云×4, 公园×3, 以×2, 像×2, 继续×2
topic         violations/100 han: 47.7   total 411 over 862 chars
  top: 猴子×64, 山×49, 石×15, 桃子×14, 故×12, 久以×11, 厉害×10, 座×8, 讲×8, 老×8

               USABLE   3+ usable  clean 1/2/3+  never clean  introduced  clean chars [[NEED:]]
no-topic       20/30    4/6        0/5/15        10/30        6           149         13
topic          6/30     1/6        0/2/4         24/30        1           128         20
```

Out-of-level rate goes from 33% to **80%** of segments, and the density goes from 3.2 to
**47.7 violation tokens per 100 Han characters — roughly fifteen times the control.** The
leaked words are exactly the vocabulary the story needs and the cast never declares: 猴子
("monkey," 64 hits), 山 ("mountain," 49), 石 ("stone"), 桃子 ("peach") — the furniture of the
Monkey King's birth from a stone and theft of the peaches of immortality, none of it a name and
none of it covered by `castMaxFor`'s handful of `[[NEED:]]` lines. The declared cast solves
*who is in the story*; it does nothing for *what the story is about*, and D4 only ever
addressed the first.

The repair loop cannot recover from this: 24/30 topic-arm segments were **never clean** inside
the attempt budget (10/30 for the control), so most of them render as the canned fallback,
"我不知道。" — visible in `mean chars` collapsing from 100 to 29 and `USABLE` from 20/30 to
6/30. Only 1 of 6 topic-arm stories reached three or more usable segments, against 4 of 6 for
the control. The high `mean dup` (0.758 vs 0.316) is partly this same collapse rather than a
separate finding — several failed segments in the same story are all the identical fallback
sentence, which reads as a near-duplicate to the trigram check regardless of the topic.

**Verdict: the free-text topic raises the out-of-level rate materially, and D4's assumption
does not hold as designed.** `castNames()` is unchanged by a topic (see `systemPrompt()`'s
comment above) — the model is told "the student wants a story about the Monkey King" and, in
the same prompt, "the story's people may only be called 小明/小红/小白, no other names" — and
separately, the *content* vocabulary a mythological topic drags in was never in scope for the
declared cast to cover. **This is reported, not acted on: D4 is in question and the fix is a
design decision, not this task's to make.**

## Things that did not work

Kept because a rejected idea that looks reasonable will be proposed again.

### Weighting production into a single score

The first version of the readiness figure gave words the learner had written **double weight**
inside one blended number. It cannot work, and the failure is instructive: weight goes as
`1/rank`, so the commonest words carry enormous shares — `的` is rank 1 and weighs a full
point — and having typed the **ten** commonest words was enough to push the sum past the total
and pin the bar at 100%. It also put the headline on a different scale from the
words-to-threshold row beneath it, so the panel could report "100%" and "57 more words to 95%"
simultaneously. It did, on a real account.

Reading and production are now the same function over two different word sets. One scale, two
honest readings.

### Sharpening a prompt rule by naming the failure

A learner wrote `鸡鸟`, not a word, and the partner repeated it back instead of correcting it.
The obvious fix was to sharpen the standing rule by naming the failure mode, with `鸡鸟` as the
example. Measured over eight replies per arm, the rate of repeating `鸡鸟` went from **0/8 as
shipped to 3/8 "sharpened"** — naming the non-word primed the model to discuss it. Never put
an example of the bad output in the prompt.

## Where the evidence is thin

Stated plainly so nobody cites this file for more than it holds.

- **The coverage percentage is an estimate, and is labelled one in the UI.** `f` is a rank,
  not a token count, so `1/rank` is an assumption about a corpus rather than a measurement of
  one.
- **We do not know which corpus the ranks come from.** The syllabus carries no frequency at
  all; the ranks are joined in from `tools/hsk-frequency.json`, carried over from the level
  dumps this app previously shipped, whose own provenance was never recorded. 88% of the
  syllabus's words get one — at HSK 1 and 2, all but eight. Without the corpus the exponent cannot be fitted, only assumed —
  hence `ZIPF_EXP` being a named constant rather than an inlined `1`.
- **The Zipf tail is not really Zipfian.** Rank-frequency relations for Chinese characters in
  long texts show two layers: a power law for frequent items and an exponential-like decay for
  rare ones. Rare words are therefore *rarer* than `1/rank` implies, so the tail is
  over-weighted, so the estimate is conservative — it understates what a learner who knows the
  head can read. Erring low is the right direction, but it is an error.
- **95% rests on a regression, not an observation**, and the 2023 replication did not find a
  threshold at all. See [The 95% mark](#the-95-mark).
- **Six sightings is measured for its effect on the conversation, not on retention.** We
  showed it produces about six times the reuse without degrading replies. We did not show that
  learners remember more, which would need testing learners.
- **The English thresholds are applied to Chinese unchanged.** The 95%/98% coverage figures
  and the encounter counts come from L2 English research. Zipfian structure transfers well;
  whether the specific numbers do is unestablished.
- **Nothing here is tested against learners.** Every measurement is of model behavior. The
  pedagogy is drawn from published research; the app has not run a study of its own.

## Bibliography

**Lexical coverage and comprehension**

- Hu, M. & Nation, P. (2000). [Unknown vocabulary density and reading
  comprehension](https://www.researchgate.net/publication/234651421_Unknown_vocabulary_density_and_reading_comprehension). *Reading in a Foreign Language* 13(1).
- Laufer, B. & Ravenhorst-Kalovski, G. (2010). [Lexical threshold revisited: lexical text
  coverage, learners' vocabulary size and reading
  comprehension](https://files.eric.ed.gov/fulltext/EJ887873.pdf). *Reading in a Foreign
  Language* 22(1).
- Kremmel, B. et al. (2023). [Unknown vocabulary density and reading comprehension:
  replicating Hu and Nation (2000)](https://onlinelibrary.wiley.com/doi/10.1111/lang.12622).
  *Language Learning*.
- Nation, P. (2006). [How large a vocabulary is needed for reading and
  listening?](https://www.lextutor.ca/cover/papers/nation_2006.pdf) *Canadian Modern Language
  Review* 63(1).

**Incidental acquisition and repetition**

- Nation, P. & Waring, R. (1997). [Vocabulary size, text coverage and word
  lists](https://www.lextutor.ca/research/nation_waring_97.html).
- Webb, S. (2007) and others, surveyed in [Incidental L2 vocabulary acquisition from and while
  reading](https://www.cambridge.org/core/journals/studies-in-second-language-acquisition/article/incidental-l2-vocabulary-acquisition-from-and-while-reading/791C52E20B00D64C4C2EC7CA7D735EC8).
  *Studies in Second Language Acquisition*.
- Hulme, R. et al. (2019). [Incidental learning and long-term retention of new word meanings
  from stories: the effect of number of
  exposures](https://onlinelibrary.wiley.com/doi/10.1111/lang.12313). *Language Learning*.

**Receptive vs productive knowledge**

- Laufer, B. Summarised with the 89%/73% active-to-passive ratios in [Recent research on
  measuring receptive and productive
  vocabulary](https://files.eric.ed.gov/fulltext/ED507439.pdf).
- Laufer, B. & Nation, P. (1995). [Vocabulary size and use: lexical richness in L2 written
  production](https://www.lextutor.ca/vp/laufer_nation_95.pdf). *Applied Linguistics* 16(3) —
  the Lexical Frequency Profile.
- [Bridging the gap between receptive and productive
  competence](https://www.cambridge.org/elt/blog/2015/08/27/bridging-gap-receptive-productive-competence/). Cambridge English.

**Zipf's law, and Chinese**

- Piantadosi, S. (2014). [Zipf's word frequency law in natural language: a critical review and
  future directions](https://colala.berkeley.edu/papers/piantadosi2014zipfs.pdf).
- [On the applicability of Zipf's law in Chinese word frequency
  distribution](https://www.researchgate.net/publication/253040075_On_the_Applicability_of_Zipf's_Law_in_Chinese_Word_Frequency_Distribution).
- [Rank-frequency relation for Chinese
  characters](https://www.researchgate.net/publication/256459976_Rank-frequency_relation_for_Chinese_characters) — the two-layer structure.

**Choice, questions and narrow reading**

- Krashen, S. (1981/2004). [The case for narrow
  reading](https://www.sdkrashen.com/content/articles/narrow.pdf) — same topic or same author
  recycles vocabulary; specialise early rather than late.
- [Learning a language through reading: a meta-analysis of studies on the effects of extensive
  reading](https://link.springer.com/article/10.1007/s10648-025-10068-6). *Educational
  Psychology Review* (2025) — effects larger where text choice was limited and some
  accountability was present.
- [Text difficulty in extensive reading: reading comprehension and reading
  motivation](https://scholarspace.manoa.hawaii.edu/server/api/core/bitstreams/0a2204be-8d78-4316-9d46-441aaf86275e/content)
  — Self-Determination Theory, autonomy and the affective filter.
- [Effects of adjunct questions on L2 reading comprehension with texts of different
  types](https://pmc.ncbi.nlm.nih.gov/articles/PMC10886187/) — mid-text elaborative questions,
  narrative vs expository.
- Ray, B. [TPRS workshop handout](https://mena.northwestern.edu/documents/TPRS-workshop-handout.pdf)
  and [TPR Storytelling](https://en.wikipedia.org/wiki/TPR_Storytelling) — circling, and the
  question ladder.
- [Questioning levels](https://magisterp.com/2020/07/19/questioning-levels-goodbye-yes-and-no/),
  Magister P. — the ladder argued by output demand rather than difficulty.

**HSK 3.0**

- [New HSK 3.0: all 9 levels and
  requirements](https://chinesefor.us/new-hsk-2021-requirements-levels-3-0-standards/).
- [HSK levels explained](https://studycli.org/hsk/hsk-levels/).

**What other tools do**

- [LingQ and Anki compared](https://flashrecall.app/blog/lingq-anki) — known-word counts
  versus spaced repetition; neither gates level advancement.
