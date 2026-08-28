# Backlog

Things found and deliberately not fixed yet, with enough context to pick up cold.
Each entry says what it is, how it was found, and what would settle it.

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
