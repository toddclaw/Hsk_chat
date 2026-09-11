# Backlog

Things found and deliberately not fixed yet, with enough context to pick up cold.
Each entry says what it is, how it was found, and what would settle it.

---

## ghost words: partial credit  grader

The grader during ghost words should also evaluate whether
ive used the words in question correctly or not.  I'm
getting many cases where i use a word correctly, but i screw
up something else and therefore the grader does not pass.
Also, I really wamt to restate the sentence correctly based
on the grader feedback.  I'd like some way to keep trying.
---

## Mistakes Drills Activity

Use skills: caveman, ponytail, superpowers.  Use superpowers to implement new feature:
I would like a new activity for drilling my mistakes as accumulated by the
grader.  I'd like to see a prioritized list of mistakes categories with the
numbers from my own data and be able to select one of the categories to drill.
Then I'd like the teacher to guide me through some practices with that
particular category and words/grammar/etc I had trouble with.  Only when the
grader passes my text will it have an impact on my stats.  I'm open to
suggestions on how to impact the mistakes stats with drills.  Please research
language pedagogy to explore the best way to update the mistakes counters with
drills on those mistakes and the grader passing my submissions.

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

- **It is on the hot path.** The grader runs on every message the learner sends. Any
  added output costs tokens on all of them, and the story-cost item below is already
  the binding constraint on this budget.
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

## The "$0.10 a story" figure is wrong, and the right one is not known yet

**Found:** costing the story-time chooser design against a $5/month whole-app budget,
2026-08-28, by reading the learner's own `cost` and `attempts` rows off the server.

`index.html`'s `STORY_MODEL` comment and the Settings note both say a story costs about
$0.10. Measured from real use: 9 story segments at a mean of **3.00 attempts each** came to
$0.4663, which is ~$0.017 a model call, ~$0.05 a segment and **~$0.25 for a five-segment
story** — two and a half times the published figure. At the expected 20 stories a month that
is the entire budget before anything else runs.

Two thirds of it is repair traffic, and the repair rate is suspect: every one of those
segments predates v67, where `turn()` was dropping `S.known` from the validation lexicon on
any turn carrying a need, an offer or a cast. A story turn always carries a cast, so every
segment was validated as if the learner's 222 ticked words were out of level.

**Measured on v67, 2026-08-28:** still **3.00**, across 19 segments in three stories. The
v67 hypothesis was wrong — the learner is at HSK 2 now, so the words they had ticked as known
ahead are inside `S.base` already and the fixed bug had little left to break. The note should
say **$0.25**, and story time needs a cost look of its own.

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

**What would settle it:** decide whether `nameSpans()` should recognise place
names at all, or whether the surrounding pattern (`在…州`, `去…市`) is the more
tractable signal. Note that a place name is *not* like a person name in one
respect — 北京 and 中国 are genuinely in the lists, so the filter must not
swallow words the learner is supposed to know. Then check whether the fix moves
the retry counters on a real conversation, not just a fixture.

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

## Story segments run short of the 90 characters the prompt asks for

**Found:** every story measurement, all models. 55–83 characters typical on
`qwen`, 112–168 on capable models where the *clean* segments are measured.

The pacing case for segmenting at all is arithmetic on 90: it is two credits at
`DEFAULT_RATE = 45` and stays under `CREDIT_CAP = 3`, so no segment discards
earnings (RESEARCH.md). At 55 it is one credit. The design still beats one long
turn, but by less than the arithmetic claims, and `test/pace.test.js` pins the
arithmetic against a number the model does not actually hit.

**What would settle it:** decide whether the target should move to what models
actually produce, or whether the instruction should be enforced the way the
required-word rule is (reject and re-ask). Changing 90 means updating
RESEARCH.md's justification with it — see CLAUDE.md.

---

## One completion in eight comes back empty, cause unknown

**Found:** across every arm of every story run, at concurrency 1 as well as 6, on
`qwen3-30b-a3b`.

`turn()` now retries once, which stops a story dying mid-narrative on an error
card — but that is a workaround, not a diagnosis. Ruled out: the message shape
(20/20 fine in a direct probe), concurrency, and the system-role problem that
affects `deepseek-v4-pro` (`qwen` is unaffected by it, 24/24).

**What would settle it:** log `finish_reason`, `native_finish_reason` and the
provider on an empty reply. OpenRouter routes one id to several providers and
names them in the response, so the first question is whether the empties
concentrate in one.

---

## Focused chat has never been measured

**Found:** it shipped with the activity framework and no A/B at all.

CLAUDE.md requires a counted run against a real model before a prompt edit
ships, and focused chat is a prompt edit. Its claim is specifically **that words
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

## `judge()` is undefined in `tools/story-ab.js`

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

**What would settle it:** restore or rewrite `judge()` — `clarity()` next to it is the template
for the request shape — and re-run any measurement that reported continuity since the break to
find out which of those zeros were real.

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

## `browser.test.js` trips a `waitFor` ceiling roughly one run in three

**Found:** 2026-09-07, across a day of commits that touched only Markdown and one
new module — five first-attempt failures, every one of them a single `waitFor`
call tripping its ceiling, on a different call site each time.

The suite retries itself once and the pre-commit hook usually goes green on the
second pass, so this mostly reads as noise. It is not free. On 2026-09-07 both
attempts failed in CI on the merge of #29 (`chat reply`, then `story runs out at
five segments`), the Publish job went red, and because the publish job is gated
on `github.event_name == 'push'` the delete-triggered run beside it published
nothing. `main` sat unpublished until the run was manually re-run.

**Why the standing explanation no longer holds.** The comment above `waitFor`
(`test/browser.test.js`) says the measured failures were "never reproducible
locally" and attributes them to scheduler jitter on CI runners, which is why the
shared floor was raised to 30000ms. On 2026-09-07 it reproduced locally three
times on an otherwise idle machine. Whatever this is, "CI runners are loaded" is
not it.

**What would settle it:** make the failure say more than which label it was
waiting on. Record, per tripped wait, how long it actually waited and what the
page state was at the ceiling — if the elapsed time is pinned at 30000 the page
never reached the state at all, and if it is well under, something is aborting
the loop early. Then find out whether the tripped waits cluster on the ones that
wait for a model reply, which would point at the test harness's stubbing rather
than at the browser.

Resist raising the ceiling again as the first move. 30000ms is already where the
shared floor was moved to, after individual call sites had each been overridden
to it for this same reason — a wait that has been lengthened once per call site
and then once globally is usually hiding a stall rather than a slow machine.

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

**What would settle it:** decide whether Ghost Words is an *acquisition*
activity that should hand finished words off, or a *review* activity that should
keep them. If the latter, the interval ladder is the small part and the empty-day
fallback is the design work.

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
