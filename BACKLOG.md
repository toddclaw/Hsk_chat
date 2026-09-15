# Backlog

Things found and deliberately not fixed yet, with enough context to pick up cold.
Each entry says what it is, how it was found, and what would settle it.

## Order of work

Ranked 2026-09-12 against the pedagogical literature (sources at the foot of this
file), by learner value per unit of build, with the app's ~$4/month of unspent
budget as the money constraint. Not a commitment — a default to argue with.

**Built since this was ranked.** Item 1 was *the retrieval engine, with gap-fill as
its first face* — free, offline, no model call, generated out of a corpus the app had
been storing all along and using only for arithmetic. It shipped 2026-09-13 as v101
(#37), which is what makes items 3–5 below cheap rather than three separate projects.
Its constants live in RESEARCH.md. The list is renumbered; the ranking above it is
left as it was made.

**The trust pass, 2026-09-14.** A second axis over this file: not learner value, but
whether the ground under it has been checked. Five items — the retrievals migration, a
regression test for the out-of-level guarantee in traditional script, `judge()`, the
discarded empty-completion diagnostic, and the 90-character question. Spec and plan in
`docs/superpowers/`.

Two of the five turned out to be **documentation** defects rather than code defects,
which is the part worth remembering: the 90 was never load-bearing, and the
story-segment entry had the wrong model in it. A third — the empty-completion cause —
was never blocked on anything but a `throw` sitting three lines above the field that
would have explained it.

**Next.** Two builds, no new measurement gate.

1. **Let me rewrite a sentence the grader failed.** Independent of the above and just
   as small. The feedback literature's strongest moderators are focused and
   metalinguistic feedback; this app has both and then stops one step short of the
   repair that makes them work.
2. **The flat re-check for retired ghost words.** Expanding intervals beat equal ones
   only slightly; both crush never-reviewing-again, which is what the app does now. A
   pure function over timestamps already stored — no scheduler.

**Then, at a discount.** Each is another face of the engine that now exists, not a new
activity.

3. **Tone ID.** Best transfer evidence of anything here — perception-only training
   moved *production* 18% in a real study. Cycle every installed Chinese voice;
   talker variability is the active ingredient, not a nicety.
4. **Dictation.** The app is text-only and listening is the skill it trains least —
   a structural gap, not a refinement. Design it as reconstruction from memory rather
   than verbatim transcription: better evidenced, and the smaller build.
5. **Scramble**, which targets 语序 and costs almost nothing now the engine exists;
   then **retranslation**, which is the only productive retrieval available and the
   only production task in the app with a reference answer to mark against.

**The expensive one, and it is still worth it.**

6. **The grader's `used` array (transfer).** The learner's own earmark for the spare
   budget, and the only item that would make every other item on this list
   measurable. It is last of the feature work because it is the one that cannot ship
   without a measurement first: it runs on every message, and a model asked what went
   *right* has an obvious way to lie.

**Cheap, and they restore trust in the tools.** None is a feature; each was costing
something silently.

- ~~`judge()` undefined in `tools/story-ab.js`~~ — **fixed 2026-09-14.** Which
  published continuity figures were zero by accident is still open.
- The `loadGoalList()` race in `browser.test.js` — closes out `run.sh`'s retry.
  **Still open**: it touches `boot()` and wants its own change.
- Place names past the validator — burns retries on a starter the app itself ships.
  **Still open**, and the first thing to fix before any A/B is re-run.
- 为什么 at HSK 1 — burns repairs at the level where pacing is most fragile.
  **Still open**; needs a counted run, so it was out of the trust pass.

**After that.** Quality and polish, in rough order: word rescue (a game built on
parts that exist — fun, but the research says it teaches little that Ghost Words and
gap-fill do not); the cast declaring content and not only people (measured 15×
violation density on a free-text topic); the story-cost look; the two genuinely
confusing items from the v69 list; one rate sentence in the progress report.

**Parked, with reasons.** Ghost Words' missing A/B and the prompt-mode gaps (HSK 2,
5, 7–9) are expensive measurements with no decision waiting on them. The 90-character
segment target, the eight-seed weakness and the empty-completion cause are all
covered by workarounds that hold. The app's own chrome in Chinese is the largest
project in this file and the least certain to help.

**Considered and not wanted.** An in-app spaced-repetition flashcard system — the
Anki export already exists and rebuilding Anki is not a feature. Handwriting or
stroke input — large, and the comparison research says IME typing trains the
sound-to-character mapping that actually matters for reading here. Speech recognition
scoring — not dependable enough in a browser for Chinese, and the tone drill is the
honest version of that ambition. Role-play scenarios — that is Chat with a topic
string, one `ACTIVITIES` row if it is ever wanted, not a project.

---

## One retrieval engine, and the activities that fall out of it

**Found:** 2026-09-12, considering fill-in-the-blank as an activity and noticing that
three separate entries in this file describe the same machine.
**Built** 2026-09-13 as v101 (#37) — the engine and the gap-fill face only. The other
four masks below are unbuilt, and are now small.

**The app has a personal corpus and uses it for arithmetic.** Every partner message,
every story segment and every sentence the learner has written is stored, synced, and
already known to be inside the level — the partner's Chinese because `validate()`
passed it, the learner's because it is theirs. `HSK.segment()` splits any of it into
words. Until v101 that corpus fed the coverage bars and supplied a drill its example
sentence, and nothing else; gap-fill is the first thing to read it as a source of
questions.

Point a retrieval task at it and the task costs **no model call, no network and no
new data**: pick a span from text the learner has personally met, hide it, ask for it
back, compare. The right answer is known before the question is asked, which is the
property none of the generative activities have.

Four activities are that one mechanism wearing different masks:

| face | what is hidden | what it trains |
| --- | --- | --- |
| **gap-fill** *(built, v101)* | one word, sentence visible | form recalled from context |
| **dictation** | the whole sentence; audio plays | sound → character |
| **tone ID** | everything but the audio | tone categories |
| **scramble** | the word order | 语序 |

A fifth, **retranslation** — show the English gloss of a sentence the learner wrote
last week, write it back in Chinese — is the same shape but not free: it needs
`grade()`. It is worth listing here anyway, because it is the only *productive*
retrieval available and the only production task in the app that has a reference
answer to mark against.

**Why gap-fill went first.** Folse (2006) beat one original-sentence exercise with
three fill-in-the-blanks on the same words and concluded that the number of retrievals
drives retention, not the depth of any single one. Gap-fill is the cheapest retrieval
that exists, this app can generate them for nothing, and building it is what makes
tone ID, dictation and scramble small — which is the part that has now paid off, and
the reason those three are listed at a discount rather than as projects.

Four decisions, in the order they matter. All four were taken in v101; the first
three landed as argued here, the fourth did not:

- **Ask what the word *was*, not what *fits*.** "Which word fits here" has several
  right answers (很好, 真好) and an exact compare marks a good one wrong. "Which word
  was here, in the sentence you read on Tuesday" has exactly one. That single
  reframing removes the whole multiple-answers problem, and it is only available
  because the corpus is the learner's own.
- **Tap beats type, and the research says it costs nothing.** Recall-versus-
  recognition is genuinely mixed — one study found multiple choice produced *more*
  productive retrieval than cued recall, and format comparisons find no significant
  difference in outcome. Four candidate words and one tap is therefore as
  well-evidenced as typing through an IME, and is one gesture instead of ten. Build
  the tap version; typing can be a setting if it is ever missed.
- **Where the distractors come from.** Three wrong candidates that are obviously
  wrong make the task free of information. The lists already carry what is needed to
  do better — same level, similar frequency rank `f`, and for the interesting version,
  a word the learner has confused before (the mistake ledger knows). Start with
  same-level-similar-rank; it needs no new data.
- **What it credits — and this one was settled the other way.** The worry was right,
  the remedy was not: sharing `GHOST_USES` behind a one-per-day cap would still have
  made a tap game a road to retiring a ghost word, just a slower one. What shipped
  counts a retrieval in its own table and lets it touch `GHOST_USES` not at all,
  because that counter means *days the learner produced the word in a graded
  sentence* and a tap is recognition — feeding it in would not fill the counter
  faster, it would change what the counter means. See RESEARCH.md, "Why a retrieval
  is counted separately from `GHOST_USES`".

**What would settle it — now the open question, not the build.** Gap-fill exists and
still needs no model measurement, because there is no model in this path. What is not
yet known is whether it gets *used*: that is the evidence that decides whether the
other four faces are worth their own screens, and nothing here should be built on the
strength of the argument above alone. `ROUND`, `CANDIDATES` and the day gate went into
RESEARCH.md with the reasoning when they shipped, so a change to any of them updates
that file too.

One gap shipped with it, deliberately: `gapPool()` lives in `index.html` where no node
suite can reach it, and the browser suite's gap-fill case does not exercise traditional
script — so the fix that keeps simplified words off the candidate buttons in
traditional mode has **no regression test**. Closing it needs one browser case that
seeds `hsk1chat.script = "trad"` and asserts every candidate button's text is in the
active lexicon.

---

## Dictation: hide the text, play it, mark what I wrote

**Asked for:** 2026-09-12. **Build it as a face of the retrieval engine above**,
which shipped in v101 — the corpus question below is the one that entry already
answers, and answers in working code now rather than in argument.

Hide the Chinese, play it, let me type what I heard, and tell me whether I got it
right.

Most of the machinery is already here. `speak()` has a voice, a speaking-speed
setting and a "no 中文 voice" path for a device without one; every message in a
conversation is text the app chose and already put through `validate()`. And the
marking needs **no model at all** — the target string is known before the audio
plays, so a comparison against what was typed is exact, free and offline, which no
other graded activity in this app can say.

Four questions before it is designed:

- **What gets dictated.** Generating a sentence for the purpose costs a call and
  has to be validated like every other Chinese in the app. A partner message or a
  story segment the learner has already read costs nothing and makes this a review
  of text they have met, which is the cheaper and probably the better activity.
- **Wrong character, right sound is the exercise.** An exact string compare marks
  在/再 wrong — correct, and the whole point — but it marks a dropped 了 with the
  same severity as a nonsense character. Saying *which kind* of wrong is what
  `grade()`'s tags exist for (`wrong-character` among them), at the price of the
  call the paragraph above was pleased to avoid. Decide whether the free exact
  mark is enough before spending it.
- **The IME does half the work — and half is the half that matters here.** On a
  phone the learner types pinyin and picks a character from a candidate list, so this
  is not the handwriting exercise dictation means on paper. The comparison literature
  splits exactly along that line: typing beats handwriting for phonology recognition
  and **sound-to-orthography mapping**, handwriting beats typing for orthographic
  recall and form-to-meaning. Sound-to-character is the mapping a text-only app has
  never trained at all, so IME dictation trains the thing that is missing rather than
  failing to train the thing that is not. Just do not read the score as evidence the
  learner could write it by hand.
- **No Chinese voice means no activity.** Every other activity degrades on a device
  without one; this one has to refuse. `zhVoice()` already answers the question, so
  the chooser can hide it rather than letting someone start a silent drill.

**One finding should shape the design before it is built.** Yu, Boers & Tremblay
(2025) compared dictation against dictogloss — writing down what you heard verbatim
against *reconstructing* it from memory. Both beat answering comprehension questions
on an immediate post-test, but the advantage faded on the delayed test, and it faded
**most for verbatim dictation**; retrieval from memory was what predicted learning.
That argues against the obvious design — play a clause, pause, transcribe, replay on
demand — and for playing the whole thing once or twice and asking for it back from
memory. Which is also the cheaper build: fewer controls, no per-clause segmentation.
The exact string compare survives either way; it just gets a more forgiving mark on
the reconstruction version, which is where a model call might finally earn itself.

**What would settle it:** run one by hand on the preview with a partner message as
the target and see what the exact compare actually flags — the balance between
homophone slips and typos decides whether a model is needed at all.

---

## Word rescue: two words, one sentence, the grader decides

**Asked for:** 2026-09-12.

Hand me two words, I write a sentence using both, a grader pass wins the round.

The verdict this needs already exists. `ghostVerdict()` in `mistakes.js` answers
"was *this word* used correctly in this sentence", separately from whether the
sentence around it was clean — built for Ghost Words, in answer to exactly the
complaint the entry below it records. `ACTIVITIES` in `prompt.js` is a table, and
an activity with its own chooser and rule is the shape `drill` and `twenty`
already have.

What is not decided:

- **Which two words.** Ghost words (taught, never used) makes this Ghost Words with
  a scoreboard. *Retired* ghost words would make it the retention check that "Ghost
  words retire and never come back" asks for, which is the more valuable version and
  costs nothing extra. One of each — a new word and an old one — is the pairing that
  is actually a game.
- **What a pass counts for.** If it credits the ghost counter it is a second road to
  the same number, and the one-credit-per-word-per-day cap has to cover both roads or
  the game becomes the fast way to farm words. RESEARCH.md, "Retiring a ghost word",
  says why that cap exists; a new activity does not get to route around it.
- **The bridge between the two words must not lose the round.** Two unrelated words
  is the fun; it is also an invitation to write something clumsy and fail on the
  grammar joining them rather than on the words themselves. Per-word verdicts are
  what save that — the sentence's other errors still file under their own tags, but
  they do not decide the game. That is a rule to write down, not an implementation
  detail.

**The pedagogy is split on how much this buys.** The involvement-load side supports
it: Hulstijn & Laufer (2001) found retention highest for composition with target
words, lower for gap-fill, lowest for reading, and later work orders
composition > sentence-writing > gap-fill. The counterweight is Folse (2006), which
beat one original-sentence-writing exercise with **three fill-in-the-blanks** on the
same words and concluded that what matters is the *number of retrievals*, not the
depth of any one. Read together: writing a sentence with two target words is a good
retrieval, and three of them beat one good one. So the design should favour short
rounds repeated over an elaborate single sentence — and it should notice that Ghost
Words already counts repeated uses across days, and gap-fill — the entry above —
generates those retrievals for nothing.

**This is a motivation feature more than a pedagogy feature**: it makes an existing
exercise into a game, which RESEARCH.md's own Self-Determination note says is worth
something, but it should not be expected to teach anything Ghost Words and gap-fill
do not.

**What would settle it:** it is mostly assembly, so the decisions above are the
work. Pick the word pool and the credit rule first; the activity row is an
afternoon after that.

---

## Tone drills

**Asked for:** 2026-09-12. **Researched** 2026-09-12, and the research moved it:
the cheap version is the one with the evidence behind it. **Another face of the
retrieval engine above**, which shipped in v101 — same hide-and-compare loop, with
the audio as the cue.

**The app cannot hear you, and it turns out not to matter much.** The first draft
of this entry assumed that recognising a tone and producing one are different
skills, so a receptive drill would be a consolation prize. The training
literature says otherwise. Wang, Spence, Jongman & Sereno (1999) trained American
learners to identify Mandarin tones in **eight 40-minute sessions**: identification
improved 21%, generalised to new words (+18%) and to voices never heard in training
(+25%), and was still there at a six-month follow-up. Wang, Jongman & Sereno (2003)
recorded the same trainees before and after and had native listeners identify what
they said: **production improved 18% after perception-only training**. Nobody
corrected their pronunciation. Perceptual training is the intervention with the
transfer evidence, and it is precisely the one this app can run for free.

So: play a word, ask which tone. `p` in every `data/hsk<N>.json` entry is the pinyin
with tone marks (`wǒ`), so the answer is already in the data, `speak()` produces the
audio, and nothing touches the network or a model.

Four things decide whether it works:

- **Talker variability is the active ingredient, and the app has one voice.** The
  effective protocol is *high*-variability training — four talkers, not one — and
  low-variability training is the arm that underperforms. `zhVoice()` picks the first
  Chinese voice it finds and ignores the rest; `speechSynthesis.getVoices()` often
  returns several. Cycling every installed Chinese voice, and varying the rate, is a
  few lines and is the difference between the two arms. It is still synthetic speech
  with canonical tones, which is a ceiling no amount of cycling clears.
- **The dose in those studies is eight sessions of forty minutes.** Two minutes a day
  is not that, and nothing here says a smaller dose scales down linearly. Whatever
  number gets picked for "a round", it is a guess and should be a setting, not a
  constant, the way `GHOST_USES` is.
- **Sandhi means the data and the audio disagree.** `p` is the citation tone. 你好 is
  `nǐ hǎo` in the file and comes out of the speaker as *ní hǎo*; 不 and 一 shift too.
  Marking a heard tone against `p` is therefore wrong for exactly the words a tone
  drill most wants to teach. Exclude the sandhi cases or make them the lesson.
- **Neutral is a fifth answer.** `de`, `le`, `ma` carry no mark, so a four-button drill
  cannot express them and a word ending in one cannot be scored.

**What would settle it:** nothing needs measuring against a model — there is no model
call in this activity. Build the smallest version (one word, four buttons, marked
against `p`, sandhi words excluded) and find out whether it is used. If it is, the
constants it needs go in RESEARCH.md with the citations above.

---

## Let me rewrite a sentence the grader failed

**Found:** the learner's own report, 2026-09-07, while using Ghost Words.

Half of this shipped. The complaint was that a word used correctly in a sentence
that went wrong elsewhere earned nothing; `ghostVerdict()` and the per-word grade
arm (v96) fixed that, and the other mistake still lands under its own tag.

The other half did not. When the grader fails a sentence there is no way to try
that sentence again. The feedback names what was wrong, and the only thing to do
with it is write a *different* sentence in the next message — so the correction is
never actually performed, which is the part of corrective feedback the literature
cares about (RESEARCH.md, "Drilling a mistake category", on why one pass is not
enough). `retryLast()` re-sends the learner's message unchanged to get a new
*partner* reply; there is nothing that re-grades an edited one.

The shape is small — a "fix it" affordance on a ✗ grade that puts the text back in
the composer and re-grades it against the same context. What is not small:

- **A re-grade is another model call**, on a path that already runs on every
  message. Cheap per use, unbounded per sentence unless attempts are capped.
- **What a corrected sentence counts for.** If the second attempt clears the tag,
  the mistake ledger is measuring the ability to act on feedback rather than the
  ability to write it right first time — which may be the better thing to measure,
  but it is a different thing and the counters do not currently distinguish them.
  The drill's one-credit-per-day cap is the precedent.

**The feedback literature is unusually direct about this gap.** Written corrective
feedback works — meta-analyses put it at g ≈ 0.54–0.68 with effects that hold up over
time — and the strongest moderators are the two this app already has: **focused**
feedback on few errors beats unfocused, and **explicit/metalinguistic** feedback
produces far higher uptake-and-repair than implicit recasts, which is what the
seventeen tags and their notes are. What the app is missing is the last step of that
chain: the learner never actually performs the repair. Uptake and repair are
*behaviours*, and there is currently nowhere to perform one.

Honest caveat, because it bears directly on the credit question: whether *asking* for
a revision adds anything beyond the feedback itself is contested. Revision reliably
reduces errors on the piece being revised; whether that is learning or copying is the
long-running argument in that literature. So build the affordance, and do not assume
a repaired sentence is worth what a clean one is.

**What would settle it:** decide whether a repaired sentence is worth the same as
a clean one, less, or nothing but the practice. The evidence above says: less, but
not nothing. The UI follows from that answer.

---

## Ghost Words and 20 Questions have no marker in their own transcript

**Found:** the v100 sync repair, 2026-09-12 (`fde8095`).

`activityOf()` now believes the `activity` column only when it names something
specific and asks the transcript otherwise, because a v99 client kept pushing a
poisoned `"chat"` back over the server rows. A story recovers from its
`role: "topic"` message and a drill from its own marker, on any device, with no
migration.

The other two cannot. Ghost Words leaves nothing in the transcript at all, and
20 Questions' state lives in `side`/`secret`, which are columns — exactly the
thing that went missing. Both still depend on the row being right and on
`mergeConversations()` refusing to let a lost value overwrite a real one. That
held this time; it is the same class of dependency that just failed.

**What would settle it:** a marker message for Ghost Words and one for
20 Questions, of the kind story and drill already carry, so the transcript is
sufficient for every activity rather than four of five.

---

## The grader reports only failures, so transfer is invisible

**Found:** designing the Mistakes Drills Activity, 2026-09-07, working out whether a
correct sentence written in ordinary chat should earn credit against a mistake
category. It cannot, and the reason is structural.

`HSKPrompt.grade()` returns `errors: [{tag, note}]` — one entry per mistake, `[]`
when the sentence is fine. A clean message therefore asserts only that *nothing was
wrong*. It does not say the sentence contained a measure word, or a correct 把
construction, so a pass cannot be attributed to any of the seventeen tags. Most
clean messages contain none of the structures in question at all.

Two things follow. First, drill credit can only come from inside a drill, where the
tag is known because the learner chose it — spontaneous correct use in free
conversation, which is *transfer* and the entire point of drilling, earns nothing.
Second, there is no positive signal to track progress against: the app can only ever
count what went wrong, so a learner who genuinely improves shows up as an absence.

**What would settle it:** add a `used` array to the grade schema, naming the tags the
sentence employed correctly, and credit those the way drill passes are credited.

Three things make this more than a schema edit:

- **It is on the hot path.** The grader runs on every message the learner sends, so any
  added output costs tokens on all of them. This used to be blocked on story time eating
  the whole $5; at the corrected rate of one story a week it is not (see the story-cost
  item below), so the objection is now the plain one — price the added tokens per message
  against ~$4 a month and check that a heavy month still fits.
- **The model may manufacture successes.** `grade()` already carries a measured
  counter-instruction because a model told a sentence may be wrong grades everything
  correct. Asking it to list what went *right* invites the mirror failure — claiming
  a 把 construction in a sentence that has none. Measure the false-positive rate
  against hand-marked sentences before trusting the number, and do not assume the
  symmetric prompt behaves symmetrically.
- **Absence is not evidence.** A tag missing from `used` must not count as a failure,
  or every sentence becomes a failure at sixteen categories at once.

Until then the mistake count falls two ways only: old failures leaving the rolling
window, and spaced drill passes capped at one a day.

---

## A story costs $0.25, not $0.10 — and what the other two thirds buy is unknown

**Found:** costing the story-time chooser design against a $5/month whole-app budget,
2026-08-28, by reading the learner's own `cost` and `attempts` rows off the server.

`index.html`'s `STORY_MODEL` comment and the Settings note both said a story costs about
$0.10. Measured from real use: 9 story segments at a mean of **3.00 attempts each** came to
$0.4663, which is ~$0.017 a model call, ~$0.05 a segment and **~$0.25 for a five-segment
story** — two and a half times the published figure. Both now say $0.25 (v99).

**The 20-stories-a-month assumption was wrong, and that is where the budget went.** The
learner's own answer, 2026-09-12: story time gets used about **once a week**. So the line to
cost against is **~4 stories a month, ~$1**, not $5, and story time stops being the binding
constraint on everything else. Roughly **$4 a month of headroom**, earmarked in the learner's
own order of preference: more grader traffic per message first, then evaluating **transfer** —
whether a word introduced by pacing shows up correctly in ordinary chat, outside the drill or
ghost-word activity that taught it, which is the thing the entry above says the app currently
cannot see. Neither is designed yet; what changed is only that the money argument against them
is gone. Re-cost both against $4, not $5: a month of ordinary chatting still has to fit.

Two thirds of it is repair traffic, and the repair rate is suspect: every one of those
segments predates v67, where `turn()` was dropping `S.known` from the validation lexicon on
any turn carrying a need, an offer or a cast. A story turn always carries a cast, so every
segment was validated as if the learner's 222 ticked words were out of level.

**Measured on v67, 2026-08-28:** still **3.00**, across 19 segments in three stories. The
v67 hypothesis was wrong — the learner is at HSK 2 now, so the words they had ticked as known
ahead are inside `S.base` already and the fixed bug had little left to break. The notes now
say **$0.25** (v99), and story time still needs a cost look of its own.

**What would settle the cost:** the repair loop re-sends the whole scratch on every attempt,
and the scratch grows with each repair exchange, so a 3-attempt segment costs far more than
three times a 1-attempt one. The levers, none of them measured: what the repairs are actually
being spent on (log the violation kinds across a run), whether `WINDOW = 20` needs to send
every prior segment in full or could send fewer, and whether `STORY_ATTEMPTS = 5` earns its
last two attempts. Take the replacement figure from real messages, never from an estimate.

---

## Place names slip past the validator's name filter

**Found:** measuring the prompt-mode A/B at HSK 6 (RESEARCH.md, "Whether the
allowlist belongs in the prompt").

`validate()` marks person names with `.name` so the repair loop lets them through
rather than spending attempts on a word it can never fix — every HSK list carries
almost no name characters, so 张 or 王 would otherwise fail forever. Place names
get no such treatment. `我家在杭州` produces a hard violation on 杭 and the loop
burns a retry on it.

This is not only a measurement artefact. It costs real retries in normal use, and
`你的家在哪儿？` is a shipped HSK 1 starter, so the app asks the question that
provokes it.

In the A/B run it was `without-list`'s single largest violation at HSK 6 (杭×9,
all of them `我家在杭州`) and removing that one character reversed the sign of the
whole comparison. Any future vocabulary measurement is exposed to the same thing.

**Fixed** 2026-09-15 (v103), and the entry above was wrong about the risk. 北京 is
**not** in the lists — neither is 上海, nor any city, in any list including the
10,896-word HSK 7-9 reference. Only 中国 survives, at HSK 1. So place names are
unfixable in exactly the way person names are: there is no in-level answer for the
repair loop to reach, and it rewrites until the attempts run out.

The stated hazard — swallowing words the learner should know — cannot happen at all.
`validate()` filters to `bad`/`latin` *before* marking anything, so an in-level word is
never a candidate: 中国 segments as `word` and is unreachable however generous the rule.

`validate()` now marks a bad run `.name` when a location preposition (在去到住) sits
within two characters before it and a geographic classifier (州京港省市海岛) ends it or
immediately follows it. Both halves of each pair are load-bearing:

- **Preposition and classifier, not either alone.** A classifier alone excuses 节省,
  反省, 股市, 上市; a preposition alone excuses every progressive 在 + verb, and 在 marks
  aspect at least as often as location.
- **Ends *or* follows the run, because that flips with the level.** 州, 海, 市, 省 and
  岛 are themselves HSK 6 words, so 杭州 is one bad run at HSK 1 and 杭[bad] + 州[word]
  at HSK 6. Testing only the run's last character fixed HSK 1 and left the measured case
  — HSK 6, which is where the A/B ran — still burning a retry.
- **Two characters of lookback, not one**, because the bad run is often only the tail:
  上海 splits into 上[word] + 海[bad].

The classifier set was chosen by running real city names through `segment()`, which
removed two obvious-looking members: 国 never ends a bad run (美国 splits as 美 + 国) and
山 bought nothing while adding 爬山.

Measured on the mechanism the loop actually reads (`validate(...).filter(v => !v.name)`,
`index.html`): burned repair attempts over a fixed sentence set go **8 → 3 at HSK 1** and
**4 → 0 at HSK 6**, with 咖啡, 节省 and 跑步 still correctly repaired.

**Known misses, pinned as tests rather than left to be discovered:** a bare mention with
no preposition (杭州很大, 我是杭州人); the second city in a conjunction (我去过杭州和北京
excuses 杭州 and not 北京); and city-specific characters with no classifier (深圳, 台北),
which would need a gazetteer. One known false positive: 他在反省, where 在 is progressive
and 省 is read as a province. Each costs one word glossed instead of repaired — the same
cost a wrong person-name span already carries.

---

## The prompt-mode measurement has gaps

**Found:** the same two runs.

HSK 1, 3, 4 and 6 are measured. **HSK 2, 5 and 7–9 are not.** HSK 4 is the
boundary `AUTO_LIST_MAX_LEVEL` sits on and it is the *ambiguous* level — a
non-result at p = 0.72, not a demonstrated absence of effect. If the boundary is
ever worth moving, HSK 4 is the level to measure properly first.

HSK 7–9 is 10,896 words (~16k tokens of list). On the observed trend there is no
reason to expect it to pay, but it is untested and would be the most expensive
arm by a wide margin.

**What would settle it:** `node tools/prompt-ab.js --level 2` / `--level 5`, and
`--level 7` if anyone wants the top of the range nailed down.

---

## Eight seeds is the weak point of every prompt measurement so far

**Found:** across all four prompt-mode runs.

Every measurement in RESEARCH.md's A/B series uses the same eight seeds from
`STARTERS[1]` at temperature 0.7. Distinct-text counts look healthy, but the
violation contexts show near-duplicates — `我家在杭州，那` recurring with slightly
different neighbourhoods — so distinctness overstates independence and the
p-values are more fragile than n = 64 suggests.

**What would settle it:** a wider seed set is worth more than more runs on these
eight. Seeds must stay namefree (RESEARCH.md says why), and per the entry above,
should probably avoid inviting *place* names too until the validator handles them.

---

## `[[NEED:]]` never fires *on a cheap model* — answered

**Found:** 0 uses in 512 replies across four levels, `qwen3-30b-a3b`,
`length=short`. **Answered** 2026-08-27 while measuring story time.

It is not that the rule does not work. It is that this model never reaches for
it. On `claude-sonnet-4.5` the same prompt used `[[NEED:]]` in **12 of 20 story
segments**, and `qwen` itself used it 4 times at HSK 6 — where the level is wide
enough that the model notices a gap rather than simply writing something else.

So the extraction, validation-with-needs and glossing path is exercised in normal
use, on a capable model, and the rule is earning its tokens. Nothing to fix. The
methodological point stands and is worth remembering: **"the model never does X"
is a statement about the model, not about the prompt**, and the A/B series had
been reading one as the other.

---

## Story time is unverified end to end on the shipped configuration

**Found:** finishing the story-time model work, 2026-08-27.
**Partly answered** 2026-08-27 by reading one on the preview.

Everything measured about story time ran through `tools/story-ab.js`, which
*mirrors* `turn()` and `storyStep()` rather than being them — it has its own copy
of `repairPrompt()` and its own pacing settle. `test/browser.test.js` covers the
real code but stubs the model, so it proves the story model reaches the request
and that an empty completion is retried; it cannot prove the app produces a
readable story.

One story read by hand on the preview found nothing wrong with the *prose* and
six things wrong with the *shape* of the activity — no way to stop it, no sign
it was working, a five-segment loop that lost the story when the tab went away.
v63 answers those (see the git log for this branch). Whether the stories are
worth reading over a run of them is still open, and still only readable, not
measurable.

---

## Story segments run short of the 90 characters the prompt asks for — answered, and backwards

**Found:** every story measurement, all models. 55–83 characters typical on
`qwen`, 112–168 on capable models where the *clean* segments are measured.

The pacing case for segmenting at all is arithmetic on 90: it is two credits at
`DEFAULT_RATE = 45` and stays under `CREDIT_CAP = 3`, so no segment discards
earnings (RESEARCH.md). At 55 it is one credit. The design still beats one long
turn, but by less than the arithmetic claims, and `test/pace.test.js` pins the
arithmetic against a number the model does not actually hit.

**Answered** 2026-09-14, by arithmetic rather than measurement — and the heading above
has it backwards. `STORY_MODEL` is `anthropic/claude-sonnet-4.5`, which produces
112-168. The 55-83 figures are `qwen`, which is not the shipped story model. The
shipped path runs **wide** of 90, not short of it.

The invariant holds either way. Credits per five-segment story: 55→6, 83→9, 90→10,
112→12, 168→15, and nothing is discarded anywhere in that range — `earn()` carries the
remainder between segments, which is what recovers the short end, and its stop-hoarding
rule does not bite until ~180 in one turn. The shipped model beats the ten-credit design
figure.

So neither of the two options this entry offered is needed. `test/pace.test.js` no longer
pins 90 and asserts the invariant across 55-168 instead; RESEARCH.md carries the table.
`prompt.js` is deliberately unchanged: the number is not load-bearing, and editing it
would be a prompt change requiring a counted A/B (CLAUDE.md).

---

## One completion in eight comes back empty, cause unknown — instrumented

**Found:** across every arm of every story run, at concurrency 1 as well as 6, on
`qwen3-30b-a3b`.

`turn()` now retries once, which stops a story dying mid-narrative on an error
card — but that is a workaround, not a diagnosis. Ruled out: the message shape
(20/20 fine in a direct probe), concurrency, and the system-role problem that
affects `deepseek-v4-pro` (`qwen` is unaffected by it, 24/24).

**Instrumented** 2026-09-14, not yet diagnosed. The data needed to answer this was
always being thrown away: `callModel` threw on the empty reply three lines *above*
where it records `finish_reason`, so the one case where the reason mattered was the
only case that discarded it. It now records `finish_reason`, `native_finish_reason`,
the provider and the model on `callModel.lastEmpty` and warns them to the console
before throwing. Kept on the function, not in `S`: it is a breadcrumb, and must never
sync or persist.

**What would settle it:** use the app normally until the warning has appeared a
handful of times, then read the provider field. OpenRouter routes one id to several
providers, so the question is whether the empties concentrate in one — if they do,
this is a routing problem rather than a prompt or a model problem, and none of the
prompt-side hypotheses above need testing at all.

---

## Ghost Words has never been measured

**Found:** it shipped with the activity framework (as `focused`) and no A/B at all.
Still true after the v96 credit work, which changed what a use is *worth* without
ever measuring whether the activity produces uses.

CLAUDE.md requires a counted run against a real model before a prompt edit
ships, and Ghost Words is a prompt edit. Its claim is specifically **that words
move from taught to used** — how many of the offered `readiness().unused` words
the learner actually produces per session, against plain chat as the control.
Out-of-level rate is *not* that measurement and would say nothing about it.

**What would settle it:** an arm in a harness that counts learner production of
offered words. `tools/story-ab.js` is the wrong shape (it has no learner); this
needs a simulated learner or a real session, which is why it has not been done.

---

## The teaching model reaches for 为什么 at HSK 1

**Found:** measuring question conformance for Task 13, `tools/story-ab.js --questions
--model qwen/qwen3-235b-a22b-2507`, twenty `storyPhase: "asking"` questions per level against
a fixed story, two runs.

HSK 2–4 came back clean both times — every non-empty reply was in-level and on-ladder. HSK 1
did not: pooled across both runs, 21/40 in-level and 28/40 on-ladder, and nearly every failure
is the same word: 为什么 ("why"), an HSK 2+ form the HSK 1 ladder rule explicitly excludes.
The model asks it anyway, in both runs, despite the rule. Full counts and the controller
ruling (D9 stands, for now) are in RESEARCH.md, "Question conformance, and whether D9 survives
it".

This does not reach the learner broken — an asking turn goes through `turn()`'s ordinary
repair loop, so an out-of-level or off-ladder question gets validated and re-asked rather than
shipped raw. But it burns repair attempts every time it happens, at the one level where the
whole pacing story is most fragile.

**What would settle it:** two candidate fixes, neither measured yet, and CLAUDE.md requires a
counted run before either ships:

- A sharper HSK 1 asking rule that names 为什么 as forbidden explicitly, rather than relying on
  the model to infer it from "the types listed below" — the same fix class as the grammar
  check's "quote the words you want, do not describe them" finding above.
- Routing HSK 1 questions only to the story model, which was never measured asking questions at
  all and might simply not have this failure mode — or might have a different one.

Either needs its own `tools/story-ab.js --questions` run against the new prompt or model before
it ships.

---

## The cast declares people, not content

**Found:** measuring the story-topic arms for Task 13 (RESEARCH.md, "The topic arm, and
whether D4 survives it").

`castPrompt` in `prompt.js` asks the model only for the story's characters, and `castNames()`
in `index.html` still tells the model that only 小明/小红/小白 (or whatever `declareCast()`
returned) are permitted — so a topic's *content* vocabulary is never legalised, only its cast
list is. The Monkey King needs 猴子, 山, 石 and 桃子; none of that rides in `needs`, so none of
it is legal or glossed, and it shows up as a hard violation every time the story reaches for it.

Measured at HSK 2, `anthropic/claude-sonnet-4.5`, against each topic's own paired control:
a free-text topic ("the Monkey King") raised violation density ~15× (14.9×) and left 1 of 6
stories with three or more usable segments; a curated pool topic ("A running race at school")
raised it ~4× (4.0×) and left 4 of 6 usable. Full counts in RESEARCH.md.

**What would settle it:** have the cast call declare the words the story needs alongside the
people, so a content word rides in `needs` next to a name and becomes legal and glossed the
same way. This is a new prompt — CLAUDE.md requires its own counted `tools/story-ab.js --topic`
run before it ships, not an assumption that it fixes what the cast-only version measurably did
not.

---

## `judge()` is undefined in `tools/story-ab.js` — fixed

**Found:** reading the harness while writing up Task 13's topic arms.

`runArm()` calls `judge(before, after)` per segment to label it CONTINUES / RESTARTS /
UNRELATED, but no `judge` function exists in the file — only `clarity()` and `castCall()` are
defined. The call throws a `ReferenceError`, is caught by the surrounding `.catch(e => {
s.segs[i].label = "ERROR:" + e.message; return 0; })`, and the label never matches
`"CONTINUES"`, `"RESTARTS"` or `"UNRELATED"` again. `CONT`, `RESTART` and `UNREL` print as zero
for every arm, silently, since some commit after `1028a8a` — there is no error on the console
naming the missing function, only rows that read as if nothing ever restarted.

Any continuity number that harness has printed recently was zero by accident rather than by
measurement. Task 13's topic arms were run with `--nojudge` to route around it, which is why
those numbers are trustworthy despite this.

**Fixed** 2026-09-14: `judge()` restored next to `clarity()`, which was already the template
for the request shape, returning the same three labels the counters read.

**Still open, and the reason this entry stays:** which published continuity numbers were zero
by accident. Task 13's topic arms were run with `--nojudge` and never touched this path, so
they are unaffected. Any *other* run that reported CONT / RESTART / UNREL since the break needs
re-running before its numbers can be quoted — RESEARCH.md's story-time sections are where to
look. Fixing the instrument does not retroactively fix the measurements it spoiled.

---

## Small things the v69 review found and deliberately left

**Found:** the per-task and whole-branch reviews of the story-time chooser. Nineteen Minor
findings were logged during execution and triaged at the end; two were promoted to blocking and
fixed in `485adc8`, the rest are recorded here so they are not simply lost with the scratch
directory they were written in.

Two were **wrong to defer** and are already fixed — noted because the misjudgement is the
useful part. A legacy story whose old end-of-story question was asked but never answered lost
its composer entirely, which was logged as cosmetic and was in fact a regression against
shipped conversations. And the model-written story title reached the chat list without going
through `validate()` — the first Chinese in the UI ever to do so.

Still open, in rough descending order of how much they would annoy someone:

- **`storyTopic()` answers for two different states.** It returns `""` both when there is no
  topic message at all (Choosing) and when "make something up" stored an empty topic (Telling).
  `renderStoryControl()` disambiguates with an extra `!S.history.length` clause;
  `renderAll()` does not. Stop the first segment of a make-something-up story and the log hint
  reads "Pick what the story is about below" under a strip reading "Start the story". A
  `hasStoryTopic()` that tests for the message rather than its text removes the whole class.
- **`send()`'s `answering` never turns off.** Once any question exists it is true for the rest
  of the conversation, so a free-form learner turn mid-story is met with the discussing framing
  学生在回答你刚才的问题 — wrong for turns that are not answers. It matches the spec's Talking
  state and it is on the cheap model, so it is a wording problem, not a cost one.
- **`renderChats()`'s message count includes the topic message**, so a story reports one more
  message than it shows; a make-something-up story with nothing generated reads "1 message"
  over an empty log.
- **A question that exhausted its repair attempts is still stored `kind: "question"`**, so
  `anyStoryQuestion()` opens the composer for a question the partner never really managed to
  ask.
- **The composer stays enabled while a segment generates.** `send()` no-ops on `S.busy`, so a
  sentence typed during generation is silently dropped rather than queued or refused.
- **`titleStory()` re-checks `renamed` before its await, not after**, so a title typed by hand
  during the round trip can still be clobbered. Narrow, and accepted in the function's own
  comment.
- **In the Told state the "Ask me another" button renders as a plain chip**, because `.story`
  is what carries the accent colour and only the "Read on" button has it.
- **`persist()` always touches `currentChat()`**, so a background write from a conversation the
  learner has left bumps `updated_at` on whichever chat is on screen instead, reordering the
  chat list. Pre-existing, shared with `storyStep()`'s own background push.
- **`opts.storyPhase` wins in `build()` even when `activity !== "story"`.** No caller can do
  that today — all three are gated on `currentActivity() === "story"` — but nothing enforces it.
- **`questionTypesFor(-1)` returns no types at all.** Unreachable; levels come from a fixed list.

Test-side, all minor: no fixture proves the legacy turn-order rule stops counting at the first
learner turn; nothing asserts "Ask me another" is still offered in the Told state; there is no
direct unit test of `castMaxFor()`'s per-level table; one hint assertion cannot distinguish
"hint missing" from "hint has the wrong text"; and `test/sync.test.js` and `test/prompt.test.js`
gained a few `var` locals in files that are otherwise ES6.

One unexplained observation, kept because it may recur: a single `test/browser.test.js` timeout
on a byte-identical tree that did not reproduce across a further twelve runs. Neither the
implementer nor the reviewer found a code-level cause; both judged it environmental.

**What would settle them:** nothing here needs a measurement — they are ordinary edits. The
first two are the ones with a real chance of confusing a user.

---

## `browser.test.js`: one race diagnosed and fixed, one still open

**Found:** 2026-09-07, five first-attempt failures in a day of commits that touched
only Markdown. **Mostly answered** 2026-09-12 (`d9957a7`).

It was never slowness, and raising the ceiling was never going to fix it. Every
name the suite waited on (`storyStep`, `newChat`, `storyTopic`, …) is a top-level
function declaration, so it is a property of `window` the moment the script parses
— waiting on one proved only that the parser had run. Measured on 42 of 42 loads,
those names answer true while `boot()` is still awaiting `loadLevel()`, so the
suite drove a turn inside boot's async gap, against an empty lexicon, and then
waited out the full 30s for output that could never render. `go()` now waits for
`readiness()` instead, in one place rather than forty call sites. Reproduced under
CPU saturation: five failures in ~25 loaded runs before, none in 22 after.

**What is left.** `boot()` also calls `loadGoalList()` unawaited, and `readiness()`
does not cover it — it reads `S.nextList`, not `S.goalList` — so `#goalProgress`
and `#secLearningNote` race the goal list. "The collapsed Learning row carries the
number" failed twice in those same 25 loaded runs on exactly that. `test/run.sh`
keeps its one retry until this one is closed.

The standing advice survives its own diagnosis: **do not raise the ceiling as the
first move.** 30000ms was reached by overriding call sites one at a time and then
moving the shared floor, and what it was hiding was a stall, not a slow machine.

---

## Ghost words retire and never come back

**Found:** designing the ghost-word credit rule, 2026-09-10.

`GHOST_USES` credits on separate days retire a word from the ghost list
permanently. That is a flat one-day Leitner interval and it covers initial
encoding only. Nothing ever re-checks the word, so a word owned in September and
forgotten by November shows as owned forever.

Expanding intervals were considered and declined during design as a scheduler
rather than a threshold: the ghost list would need a due/not-due state per word,
the banner would need to show it, and a day with nothing due would need a
fallback so the activity never opens empty. The scheduling itself is cheap and
needs no stored state — every credit already carries a message timestamp, so a
due date is a pure function of the credit history, the same way the count is.

**The research says the ladder is the part you can skip.** Nakata (2015) compared
expanding against equal spacing on L2 vocabulary and found a **limited** — real, but
small — advantage for expanding; both beat massed practice by a wide margin. The
value is in re-checking a retired word *at all*, not in the shape of the schedule.
That removes the objection this entry was filed under: a single flat re-check (a
retired word comes back once, ~30 days later, and retires again if it survives) is a
pure function of the credit timestamps already stored, needs no scheduler, no stored
due state, and captures most of the available benefit. The empty-day fallback is
still the real design work.

**What would settle it:** decide whether Ghost Words is an *acquisition*
activity that should hand finished words off, or a *review* activity that should
keep them. If the latter, build the flat re-check, not the ladder.

---

## The app's own instruction could migrate to Chinese as the level rises

**Found:** designing the progress report, 2026-09-11.

Every explanatory surface in the app is permanently in English — settings notes,
the progress panel, grammar explanations, the report this was found while
designing. That is right for a beginner and increasingly wrong for the learner
the app is trying to produce. At HSK 6 a learner reads a newspaper; there is no
good reason the sentence telling them what a setting does is still in English,
and an app whose own chrome is Chinese is several hours a week of incidental
reading that currently goes to waste.

The machinery already exists and is the whole point: the validator can prove a
string is inside a level, `LEVELS` already knows where the learner is, and
coverage arithmetic already answers "can they read this". A UI string is a much
easier target than conversation — it is fixed, short, authored once, and can be
checked at build time instead of at runtime, so none of the retry/repair cost of
live generation applies.

The hard part is not translation, it is the **ladder**: which strings move at
which level, whether a string moves all at once or gains a Chinese gloss first,
and what happens to a learner who moves up and finds the settings screen
suddenly unreadable. A per-string minimum level is the obvious shape. Going back
down a level, or a learner who wants English regardless, both need an answer.

**What would settle it:** pick one screen — Settings → Learning is a good
candidate, since its audience has by definition been using the app a while — and
author its strings at two or three levels. Measure whether the HSK 4 version is
actually readable by an HSK 4 learner, because the failure mode is a string that
validates and still does not communicate. That answer generalises; the rest is
bookkeeping.

---

## My own progress data, over time, shown to me

**Found:** designing the progress report, 2026-09-11, deciding against keeping a
history of reports.

The progress report is synthesis and voice — it reads the numbers and tells you
what they mean. It is deliberately not a record: reports are not kept, because
the gauges already answer "am I progressing". What the gauges do *not* answer is
"how fast, and is that faster or slower than last month". Every panel in the app
is a snapshot of now. There is no surface anywhere that shows a rate.

The data is already there and already timestamped. Words learned carry the day
they were earned, every message carries `created_at` and its grade, `HSKTime`
already buckets by day, and mistake credits are counted per day by the same
`dayKey()` the drill and ghost-word rules use. Words learned per week, clean-
sentence rate per month, time on task per week, mistakes retired per category
over time — all of it is arithmetic over data the app already stores, with no
new writes anywhere.

What is missing is the view, and that is the whole question: a sparkline row, a
small table by week, or a single "you are learning about 9 words a week, up from
6" sentence. The last is cheapest and possibly the most useful — a rate stated
in words beats a chart nobody reads, and it is the same gauge-versus-prompt
argument RESEARCH.md makes about the production list.

**What would settle it:** pick one number — words learned per week is the
strongest candidate, since it is the thing the pacing constants actually control
— and show it for the last several weeks. If seeing the rate changes what you do,
the rest is worth building. If it does not, one sentence in the progress report
was the right size for this after all.

---

## Reading behind the new entries

Cited inline above; kept here rather than in RESEARCH.md because none of them has
become a constant yet. Whichever one does, its citation moves there — see CLAUDE.md.

**Dictation and listening**

- Yu, X., Boers, F. & Tremblay, P. (2025). [Learning multiword items through dictation
  and dictogloss](https://journals.sagepub.com/doi/10.1177/13621688221117242).
  *Language Teaching Research* — both beat comprehension questions immediately; the
  advantage fades on the delayed test, most for verbatim dictation.
- [Comparison studies of typing and handwriting in Chinese language
  learning](https://www.researchgate.net/publication/349054232_Comparison_Studies_of_Typing_and_Handwriting_in_Chinese_Language_Learning_A_Synthetic_Review)
  — typing favours phonology and sound-to-orthography mapping; handwriting favours
  orthographic recall.

**Tones**

- Wang, Y., Spence, M., Jongman, A. & Sereno, J. (1999). [Training American listeners
  to perceive Mandarin
  tones](https://kuppl.ku.edu/sites/kuppl/files/documents/publications/Wang_Spence_Jongman_Sereno_training_JASA_1999.pdf).
  *JASA* 106(6) — +21% over eight sessions, generalising to new words and new talkers,
  retained at six months.
- Wang, Y., Jongman, A. & Sereno, J. (2003). [Acoustic and perceptual evaluation of
  Mandarin tone productions before and after perceptual
  training](https://pubmed.ncbi.nlm.nih.gov/12597196/). *JASA* 113(2) — perception-only
  training improved production by 18% as judged by native listeners.
- [The effects of high versus low talker variability on phonetic training of Mandarin
  lexical tones](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6690337/) — why one voice
  is the weaker arm.

**Producing sentences with target words**

- Hulstijn, J. & Laufer, B. (2001). [Some empirical evidence for the involvement load
  hypothesis](https://onlinelibrary.wiley.com/doi/abs/10.1111/0023-8333.00164).
  *Language Learning* 51(3) — composition > gap-fill > reading for retention.
- Folse, K. (2006). [The effect of type of written exercise on L2 vocabulary
  retention](https://onlinelibrary.wiley.com/doi/abs/10.2307/40264523). *TESOL
  Quarterly* 40(2) — three fill-in-the-blanks beat one original sentence; retrievals,
  not depth.

**Correcting, and being asked to correct**

- Brown, D., Liu, Q. & Norouzian, R. (2023). [Effectiveness of written corrective
  feedback in developing L2 accuracy: a Bayesian
  meta-analysis](https://journals.sagepub.com/doi/abs/10.1177/13621688221147374).
  *Language Teaching Research*.
- Chen, S. & Renandya, W. (2020). [Efficacy of written corrective feedback in writing
  instruction](https://tesl-ej.org/wordpress/issues/volume24/ej95/ej95a3/). *TESL-EJ*
  24(3) — g ≈ 0.59 across 35 studies; focused beats unfocused.
- Lyster & Ranta and successors on [corrective feedback and learner
  uptake](https://escholarship.mcgill.ca/downloads/0p096b851) — repair is rare after
  recasts, common after metalinguistic feedback.
- [Does asking learners to revise add to the effect of written corrective
  feedback?](https://www.sciencedirect.com/science/article/abs/pii/S0346251X20307016)
  *System* (2020) — the contested part, and why a repaired sentence should not credit
  like a clean one.

**Retrieval format**

- [Effects of cued-recall versus recognition retrieval practice on exam
  performance](https://www.tandfonline.com/doi/full/10.1080/87567555.2021.1910124).
  *College Teaching* 70(2) — multiple-choice and fill-in-the-blank quizzes improved
  scores equally.
- [The effects of receptive and productive word retrieval practice on second language
  vocabulary
  learning](https://www.researchgate.net/publication/303939278) — the mixed picture,
  including the finding that multiple choice can induce productive retrieval.

**Word order**

- [HSK 3 reading and writing: what to
  expect](https://www.eblcu.com/blogs/HSK-3-Reading-and-Writing-What-to-Expect-and-How-to-Prepare.html)
  — 连词成句 is HSK 3 writing part 1; note that the standalone word-ordering task was
  **removed** at HSK 4 in the 3.0 syllabus, so a scramble activity is justified by the
  语序 tag, not by exam alignment.

**Spacing**

- Nakata, T. (2015). [Effects of expanding and equal spacing on second language
  vocabulary
  learning](https://www.academia.edu/8174622/). *Studies in Second Language
  Acquisition* 37(4) — expanding wins, but by a little; both beat massed.
