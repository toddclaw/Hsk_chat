# Mistakes Drills activity

**Date:** 2026-09-07
**Status:** approved design, not yet planned or built.
**Scope:** one new activity, `drill`; `mistakeCounts()` extracted to `mistakes.js`
and its arithmetic changed; one new setting. Chat, Ghost Words, story time and
20 Questions are untouched except where D8 generalizes the chooser slot.

---

## The request

From BACKLOG.md, "Mistakes Drills Activity": a new activity for drilling the
mistakes the grader has already accumulated. Show a prioritized list of mistake
categories with counts from the learner's own data, let one be selected, and have
the teacher guide practice on it. Only a grader pass may move the stats. How a
pass should move them was left open, to be settled against language pedagogy
rather than invented.

## What already exists

The capture layer is done and was built for this. `prompt.js` line 697 says the
seventeen-tag fixed taxonomy exists so that "your top mistakes" counts and "any
future drill" can select on it; free-text error descriptions were rejected there
because they do not aggregate. `mistakeCounts()` (`index.html:4916`) already
returns tags sorted by frequency with a count, the most recent example and its
correction, and Settings renders the top three.

Two properties of the existing code constrain everything below:

- The count is **derived by scanning** graded messages, never stored. Its comment
  states why: a running tally beside the messages "would be a second source of
  truth to drift".
- The grader reports **failures only**. `errors: []` means nothing was wrong, not
  that anything was used correctly. See the BACKLOG item "The grader reports only
  failures, so transfer is invisible".

## Pedagogy behind the counting rules

Two findings drive D3–D5.

**One correct production does not mean the error is gone.** Backsliding — the
reappearance of interlanguage features that appeared eradicated — is well
attested, and L2 development is U-shaped rather than linear. A design where a
single pass clears a category would be measuring the wrong thing.

**Spaced practice beats massed practice specifically for error correction.** Kim
& Webb's delayed post-test had the spaced group outperform the massed group on
error analysis and correction; Suzuki & DeKeyser find the same for
proceduralization. Conti's summary of the corrective-feedback literature is that
a rule needs "masses of spaced practice across a wide range of contexts".

This is awkward for the feature and the awkwardness is the point: **a drill
session is massed practice by construction.** Six sentences in one sitting is the
condition that loses. So credit is spaced rather than counted — ten passes in one
session are worth what one is.

No source gives a mastery criterion in encounters. That is the same honest gap
RESEARCH.md already records for `PROMOTE_AT`, and it is why the per-day cap is
one rather than a tuned number.

## Decisions taken

| # | Decision | Rationale |
|---|---|---|
| D1 | The drill is a **dialogue** activity, not the roadmap's item-session path | The roadmap classified focused drills as items needing the unbuilt "A2" results table and session screen. Dialogue reuses the grader, `conversations.activity`, `windowed()` and the whole sync path, and matches the request's "guide me through some practices". Items remain a future path, not a rejected one. |
| D2 | The chosen tag is stored as a pseudo-message `{role: "drill", text: tag}`, exactly as story time stores `{role: "topic"}` (`index.html:3502`) | **No `db/schema.sql` change at all.** `messages.role` already syncs, and `contextFor()`/`windowed()` already skip non-user/assistant roles, so the marker stays out of the model's context for free. Preferred over a `conversations.drill_tag` column, which would need a migration and a sync probe. |
| D3 | A failure counts only if its `created_at` falls inside a rolling **90-day** window | Without it the number rises from ordinary chat and falls only from drills, so a learner who stops making the mistake naturally sees it freeze — punishing the outcome the feature wants. Aging is also what lets improvement show without any drill-specific logic. |
| D4 | A **credit** is a `grade.ok` user message inside a drill conversation for that tag, deduped to **one per calendar day per tag** | Directly encodes the spacing finding: grinding one session cannot clear a category, returning across a week can. The cap is what stops session length changing the stats, which is why D7 can be a free choice. |
| D5 | Displayed count is `max(0, failures − credits)` | Floors at zero so a well-drilled category leaves the list rather than going negative. Both terms are still computed in one scan of `S.chatMsgs`; nothing is stored, so the drift `mistakeCounts()`'s own comment warns about stays impossible. |
| D6 | The counting moves out of `index.html` into **`mistakes.js`**, with `test/mistakes.test.js` | Date windows, per-day dedupe and a floor are exactly the arithmetic that breaks silently, and CLAUDE.md's rule is that logic worth testing in isolation gets pulled out so node can load it. `mistakeCounts()` is currently untested. |
| D7 | Drill length is a **setting**, 3–10, default 6, as `DRILL_CHOICES` beside `ATTEMPT_CHOICES` (`index.html:1014`) | Todd asked for it. Same `<select>`-from-a-const pattern as "Tries before giving up", so no new UI idiom. Joins `PREFS_KEYS` in `sync.js` so it follows the learner across devices; it is a preference, not a counter, so replace-with-newer is the right merge. |
| D8 | The chooser generalizes: a `chooser` field on the activity row, replacing the per-id branches at the two call sites | The 20 Questions spec's D7 explicitly deferred this — "a third activity needing this can motivate generalizing then". This is the third, so it happens here rather than adding a third branch. The change is confined to those two call sites and the three activity rows; `story` and `twenty` keep their existing chooser functions unchanged, only the dispatch moves. Their browser tests are the regression check. |
| D9 | The drill prompt describes the **target structure** and shows only correct forms. The learner's own wrong sentence appears in the chooser UI and never in the prompt | RESEARCH.md, "Sharpening a prompt rule by naming the failure": putting the learner's error in the prompt took a failure from 0/8 to 3/8 because naming the bad output primed the model to reproduce it. This is the single easiest way to get this feature wrong. |
| D10 | The partner **elicits**, it does not lecture | Ghost Words already has the mechanism for steering a conversation so target forms must appear in the learner's own output; that is production practice, which is what a drill is for. |

## The counting, precisely

For each tag, over every graded user message in every conversation:

```
failures = count of grade.errors entries with that tag,
           where message.created_at is within MISTAKE_WINDOW_DAYS (90) of now

credits  = count of DISTINCT calendar dates on which a user message
           satisfied all of: grade.ok is true,
                            its conversation's drill marker names this tag

shown    = max(0, failures - credits)
```

Unknown tags are ignored, as today. Sort order is unchanged: count descending,
then tag name.

## Session shape

`S.drillTurns` (default 6) user messages. The control bar counts down the way
story time's does — "3 of 6" — and on completion reports how many the grader
passed, then stops offering turns. The count is of *attempts*, not passes: a
failed sentence still consumes one, or a bad run never ends.

## Edge cases

- **No mistakes logged yet.** The chooser shows the same note Settings shows —
  nothing logged, or checking is off — and offers no categories.
- **Every category fully credited.** All counts floor to zero; the chooser says so
  rather than rendering an empty list.
- **Grader off.** The drill still runs as a conversation, but nothing can be
  credited. The chooser says so before the learner starts.
- **A drill conversation with no drill marker** (hand-edited, or synced from a
  future version) contributes no credits and is otherwise an ordinary chat.

## Testing

`test/mistakes.test.js`, in the house style — a `check(ok, label, detail)`
counter, a fixture, `process.exit(1)`:

- a failure outside the window does not count; one inside does
- two passes on the same calendar day credit once; on different days, twice
- credits never take a count below zero
- a pass in a non-drill conversation credits nothing
- a pass in a drill for tag A credits A and not B
- unknown tags are ignored
- ordering is by count then tag

`test/release.test.js` already enforces the two release invariants below.
`browser.test.js` gains a drill run: choose a category, take a turn, see the
counter move.

## Release checklist

- `VERSION` in `index.html` and `CACHE` in `sw.js` move together
- `mistakes.js` is added to `SHELL` in `sw.js` — `cache.addAll` is all-or-nothing
- `drillTurns` added to `PREFS_KEYS` in `sync.js`; `test/sync.test.js` still
  asserts `key` and `history` are absent
- `RESEARCH.md` gains a section for `MISTAKE_WINDOW_DAYS`, the one-per-day cap and
  the default drill length, with the backsliding and spaced-practice citations
- The drill prompt gets an A/B against the real model with counted outcomes before
  shipping, per CLAUDE.md. Measure: of N partner turns, how many require the
  target structure in the reply. Run name-free.

## Where the evidence is thin

**90 days is a guess.** Nothing in the reading gives a forgetting horizon for a
grammatical error category, and it is the only constant here with no citation
behind it. It is a defensible order of magnitude — long enough that a
twice-a-week learner keeps a meaningful history, short enough that last spring's
errors stop dominating the list — and it should be revisited against real data
once anyone has a year of it.

**The per-day cap is a floor, not a measurement.** One credit a day is defensible
from the spacing literature but no study sets it. If drilling turns out to feel
unrewarding, the cap is the knob, and changing it means updating RESEARCH.md.

**Transfer is uncredited.** Correct spontaneous use in free conversation is
better evidence than any drill pass and earns nothing, because the grader cannot
report it. Tracked as its own BACKLOG item.

## Approaches considered

**1. Item sessions (the roadmap's original call).** Build the A2 results table and
session screen, then the drill on top. Exact scoring, clean separation of drill
results from chat history, and it would unlock dictation and word rescue. Rejected
for now as two features where one was asked for, the first of them invisible to
the learner.

**2. Recency window only, no drill credit.** Simplest possible rule: count recent
mistakes, let drills matter only by not adding to them. Rejected because the
request is explicit that a grader pass should have an impact, and this gives it
none.

**3. Lifetime count plus a separate "cleared" marker.** Never rewrites history, but
puts two numbers on every row and invites the single blended score that RESEARCH.md
records as a measured failure under "Weighting production into a single score".

**4. Net count with spaced credit, over an aging window (chosen).** D3–D5.

## Sources

- [U-shaped course of development](https://worldenglishes.lmc.gatech.edu/u-shaped-course-of-development/) — backsliding and non-linear L2 development
- [Stemberger, *U-shaped learning and restrictions on error correction*](https://roa.rutgers.edu/files/472-1101/472-1101-STEMBERGER-0-0.PDF)
- [Kim & Webb, *Spaced vs. massed distribution instruction for L2 grammar learning*](https://www.sciencedirect.com/science/article/abs/pii/S0346251X14000219) — delayed post-test favours spaced on error correction
- [Suzuki & DeKeyser, *Effects of distributed practice on the proceduralization of morphology*](https://yuichisuzuki.net/wp-content/uploads/2023/04/Suzuki-DeKeyser-2017-LTR.pdf)
- [Conti, *Focused error correction*](https://gianfrancoconti.com/2018/05/17/focused-error-correction-how-you-can-make-a-time-consuming-necessity-more-effective-and-manageable/) — spaced practice across varied contexts
