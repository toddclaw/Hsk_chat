# Research

Why the numbers in this app are the numbers they are.

Every pedagogical constant here — 95%, six sightings, one new word per 45 characters — is a
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
- [Measurements we ran](#measurements-we-ran)
- [Things that did not work](#things-that-did-not-work)
- [Where the evidence is thin](#where-the-evidence-is-thin)
- [Bibliography](#bibliography)

## How to read this

| | |
|---|---|
| **Follows from the literature** | the research supports this fairly directly |
| **Informed by it** | the research constrains the choice but does not make it |
| **Ours** | a judgement call; the research is silent or mixed |
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
in the "you can now recognise the shape of it" band rather than the "you know what it means"
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
words ticked off the next level's list — is available and misleading. At HSK 1 you know 520 of
HSK 2's 1261 words: 41% of the list. But because the lists are frequency-ordered and language
is Zipfian, those same 520 words already account for about **85% of HSK 2 running text**.

A bar reading 41% tells a learner who can follow most of a level that they know almost none
of it. So `HSKPace.coverage()` weights each word by `1/rank` and reports the share of *text*,
not the share of the list.

Chinese supports this: word-frequency distributions in large Mandarin corpora conform to
Zipf's law with an exponent very close to 1, which is why `ZIPF_EXP` defaults to 1.

### The 95% mark

**Follows from the literature, with a caveat we take seriously.** `READY_AT = 0.95`.

Two thresholds are conventional. Laufer & Ravenhorst-Kalovski (2010) put **95%** coverage as
the minimum for adequate comprehension (≈4000–5000 word families in English) and **98%** as
optimal for independent reading (≈6000–8000). Hu & Nation (2000) is the origin of the 98%
figure.

The caveat, which most citations of these numbers omit: **Hu & Nation never tested 98%.** They
tested 80%, 90%, 95% and 100% coverage on a 633-word narrative seeded with pseudowords, with
66 learners at one New Zealand university; 98% is a regression estimate between two tested
points. And Kremmel et al.'s 2023 replication in *Language Learning* found that once L2
vocabulary size and reading ability were accounted for, coverage remained only a weak
predictor of comprehension, with **no clear threshold** visible at all.

So 95% is a well-established convention resting on thinner evidence than its ubiquity
suggests. We use it because a recommendation has to fire somewhere and this is the most
defensible line available — not because a learner crossing it has crossed anything real. The
UI says *"95% is comfortable reading"*, never *"you are ready"*, and the button it reveals is
a suggestion.

At HSK 1 the mark falls at roughly **147 of the 741 new HSK 2 words** — which is the number
worth showing a learner, rather than 741.

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

### Earlier measurements

Recorded in DEVELOPING.md with their working, and summarised here because they set the
methodology:

- **A cheaper model is not a cheaper conversation.** Across 16 replies at HSK 2, a model at
  half the listed output price cost 44% *more* per reply, because it wrote more and triggered
  more retries. Judge candidates with the validator and real usage figures, never the price
  column.
- **Naming decoration cut explain output 39%.** "Keep it concise" did nothing measurable;
  "no headings, no bullets, no bold, no emoji" did.

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
- **We do not know which corpus the ranks come from.** They arrive in the HSK 3.0 level dumps
  `tools/convert.py` reads. Without the corpus the exponent cannot be fitted, only assumed —
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
- **Nothing here is tested against learners.** Every measurement is of model behaviour. The
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

**HSK 3.0**

- [New HSK 3.0: all 9 levels and
  requirements](https://chinesefor.us/new-hsk-2021-requirements-levels-3-0-standards/).
- [HSK levels explained](https://studycli.org/hsk/hsk-levels/).

**What other tools do**

- [LingQ and Anki compared](https://flashrecall.app/blog/lingq-anki) — known-word counts
  versus spaced repetition; neither gates level advancement.
