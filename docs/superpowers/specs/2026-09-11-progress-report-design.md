# Progress report — design

**Date:** 2026-09-11
**Branch:** `feature/progress-report`
**Status:** approved in brainstorming, not yet planned

A button in Settings → Learning that reads the learner's whole history, and
writes back a short piece of prose: what has gone well, what is worth focusing
on next, and what has changed since the last time it was asked.

## Why this exists, and what it is not

The app is already well supplied with **gauges**: coverage bars, the progress
panel, the mistake ledger, time chatting, the not-yet-yours row. RESEARCH.md's
Production section makes the argument this feature has to respect — the useful
thing is a *list you can act on*, not a *number to aim at*, and "5 words unused"
is a statistic where "说话、可以、以后" is something you can put in your next
message.

So the report's value is **synthesis and voice**, which is the one thing the
existing panels cannot do. If it turns into another dashboard it has added
nothing but an API call. Every decision below follows from that.

It is explicitly **not** a record of your progress over time. Reports are not
kept. See "Rejected alternatives".

## Decisions

Settled during brainstorming on 2026-09-11. Recorded with their reasons because
the reasons are load-bearing, and a later reader will otherwise re-open them.

| Decision | Choice |
|---|---|
| What the model sees | Computed numbers **plus a capped sample** of the learner's own sentences |
| Delta baseline | The last run, with a floor — see "The floor is data, not clock" |
| Report storage | **Latest report only**, in prefs. No history |
| Language | English, plus one short Chinese line |
| Chinese line | **Templated, not generated** — no second model call |
| Shape | Short and synthesised. A few paragraphs, ending on something concrete |
| Model | The teaching model, like the grader and the drill check |

## Architecture

### `report.js` — a new extracted module

Pure aggregation. No DOM, node-testable, and it ends with the same wrapper every
other extracted module uses:

```js
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.HSKReport = api;
```

It takes `S.chatMsgs`, `S.chats`, `S.learning` and the outputs of the existing
module APIs, and returns one compact **brief** object covering:

- level, goal level, and coverage toward the next level
- words met, and words credited (the ghost-word count, via `HSKMistakes.ghostProgress`)
- clean-sentence rate — graded messages with `grade.ok` over all graded messages
- mistakes by category with counts and credits, from `HSKMistakes.counts()`
- ghost-word credits earned and words retired
- time on task, from `HSKTime.totals()`
- which activities were actually used, from `S.chats[].activity`

**Every field carries an explicit zero rather than being omitted.** A model
handed a gap fills it, and inventing progress is this feature's characteristic
failure. This is an assumption, not a fact, and the A/B below is built to test
it.

### The delta is the same function run twice

Once over all history, once cut at the stored baseline timestamp. The delta is
subtraction over two briefs, not a second code path — so the two halves cannot
drift apart, and there is no snapshot to keep in sync with anything.

### The floor is data, not clock

If fewer than `REPORT_FLOOR` newly **graded messages** have landed since the last
report, writing a new one is **refused before the call is made**, naming how many
there have been.

> **Revised after v97 shipped.** The original design widened to a
> `REPORT_WINDOW = 14` day window here instead of refusing, on the reasoning that
> an empty delta is worse than a wide one. That was wrong in the hand: pressing
> the button twice in a row spent a real call rewriting the same report with
> small changes, because a fourteen-day window over a history that has not
> changed is the same history. A report nobody needed is worse than no report,
> and it costs money to produce. `REPORT_WINDOW` no longer exists — with the
> refusal in place nothing could reach it.

`REPORT_FLOOR = 10`. Ten graded messages is roughly one sitting, which is the
smallest unit about which anything true can be said.

**A tapped starter is not a graded message.** Starter chips drop app-authored
Chinese into the composer and the learner sends it like any other message, so
nothing stored on it says they did not write it — and because the text is the
app's own, it grades clean every time. Counted, starters are a free pass into
the clean total, into the floor, and into the sentences quoted back to the
learner as their own best work. They are excluded in `gradedTurns()`, the single
gate all three route through, and matched by text so the rule reaches history
that is already stored.

A message count is more honest than a time floor: three days away from the app
and three days of hard practice should not produce the same "too soon". The
threshold is a new constant. It is a UX floor rather than one of the pedagogical
constants CLAUDE.md names (`DEFAULT_RATE`, `CREDIT_CAP`, `SLATE`, `PROMOTE_AT`,
`READY_AT`), so it does not by itself require a RESEARCH.md entry — but if the
chosen value ends up encoding a claim about spacing, it does, and that call
belongs to whoever picks the number.

### The samples

Capped at `REPORT_SAMPLES = 3`, and chosen **by the computed numbers** rather than
by the model — one recent clean sentence using a newly-earned word, one recent
sentence carrying the most frequent error tag, one spare. Selection is
deterministic in JS. The cap is what stops prompt size growing with history:
three is enough for the report to quote evidence without the prompt becoming a
transcript.

These are the learner's own sentences, quoted back. A sentence the learner wrote
may contain words above their level, and the report will show it. This is **not**
a hole in the out-of-level guarantee: that guarantee is about what the partner
*generates*. No validator involvement, no repair loop. Confirmed with Todd.

### The Chinese line needs no second call

Composed from a small set of templates whose every word is HSK 1, with numbers
filled in — `你学了 12 个新词。很好！`.

Valid by construction at every level, costs zero tokens, cannot hallucinate, and
the validator checks it in a **test** rather than at runtime. This deletes an
entire generation-validate-repair-fallback path and halves the per-press cost.

The trade is accepted knowingly: it is a canned sentence rather than a written
one, and it will not comment on anything specific.

Note that `turn()` (`index.html:1789`) — the app's validated-generation path — is
**not** reusable here. It is welded to conversation context (`systemPrompt()`,
`windowed()`, `S.history`), so generating through it would inject the report into
the learner's conversation history.

### Storage

Two pref keys: the report text and its timestamp. Both go in `PREFS_KEYS`
(`sync.js:251`) so the delta baseline stays correct across devices.

No new table, no tombstones, no schema change, no merge trio. `test/sync.test.js`
already asserts `PREFS_KEYS` names neither `key` nor `history`; adding two keys
does not disturb that.

## The prompt

`HSKPrompt.report()` in `prompt.js`, plus a sixth entry in `TEACH_PROMPTS`
(`index.html:1665`) with `kind: "report"`. That gives it the same deal every
other teaching prompt has: editable in Settings → Advanced, and an untouched one
keeps tracking `prompt.js` rather than freezing today's wording.

Runs on the **teaching model** — this is analysis, not conversation.

It is given the brief as structured text, the capped samples, and the delta. One
instruction matters more than the rest: *every number you state must come from
the brief above.*

## Measurement — `tools/report-ab.js`

CLAUDE.md requires a real-model run with counted outcomes before shipping prompt
work. Follows the shape of `tools/drill-word-ab.js`, with results committed
alongside as `tools/report-ab-results.md`.

**Two counters, per DEVELOPING.md — one would be trusted too easily:**

- **fidelity** — does the report state a figure or name a category the brief does
  not support? Extract every number and every named category from the output and
  check each against the brief. This is the failure that makes the feature worse
  than useless: a report that invents progress is actively misleading about the
  learner's own learning.
- **specificity** — does it name at least one real category, word, or example
  from the brief, rather than encouragement that would fit any learner on any
  day? This catches the opposite failure, since a prompt tuned hard against
  hallucination retreats into generic warmth.

**Arms, chosen to test this design's own assumptions** rather than to survey
wordings:

- `zeroes` vs `omit` — do explicit zeroes for quiet activities actually stop the
  model inventing activity there?
- `guarded` vs `plain` — does "every number must come from the brief" measurably
  move fidelity, or is it a sentence that only makes us feel safer?

**Fixtures are synthetic briefs**, not real history, and must include a
deliberately *bad* week and an *empty* one. "You barely showed up this week" is
the hardest thing for an encouragement prompt to say honestly and the likeliest
place to find invented praise.

Per CLAUDE.md, run **name-free**: 王, 李 and 明 are all above HSK 1 and
contaminate any vocabulary measurement.

## UI

**Settings → Learning**, below *Progress to the next level* (`index.html:600`) —
where the learner already goes to ask how they are doing.

The button opens `#reportSheet`, following the existing sheet pattern
(`openSheet`/`closeSheet` at `index.html:5708`, backdrop click to dismiss). Prose
renders through `HSKMd.render`, which escapes before it formats.

The sheet shows **the stored report and its date** if one exists, so opening it
costs nothing. A *Write a new report* button is what spends the call. Re-reading
is free, and the delta baseline moves only when a report is actually generated.

### Failure handling

- **A failed call never destroys the old report.** The stored report is replaced
  only after a successful parse. A timeout leaves last week's report on screen
  with an error line — the old report is the more valuable of the two.
- **No graded messages at all → no call.** A new user gets a note telling them to
  chat a bit first, not a model call about nothing and not a fabricated report.
- **Offline** opens the stored report; generating says it needs a connection.

### Out of scope, deliberately

**Follow-up questions in the sheet.** The explain sheet has a follow-up input and
this does not copy it. CLAUDE.md records the reason as hard-won: an output-shape
instruction in the system role governs every later turn, so a follow-up gets
answered with the original verdict again. A one-shot report sidesteps it.

## Testing

`test/report.test.js`, same `check()`-counter shape as every other suite, no
framework:

- brief aggregation over a fixture history
- the delta as subtraction of two briefs
- the message-count floor firing and not firing
- explicit zeroes for untouched activities
- **the templated Chinese lines validated against each level's allowlist** — this
  is how the build-time validation claim above is actually enforced

`test/browser.test.js` gains the round trip: seed a history through localStorage,
press the button with a stubbed `callModel`, assert the sheet renders and the
report persists. Then assert **a failed call leaves the previous report intact**,
which is the behaviour most likely to regress quietly.

Note for the implementer: the browser suite cannot see page-level `const`s — `S`
is unreachable from the WebDriver sandbox. Seed through `localStorage` and
`go(base)`, which is the idiom the suite already uses everywhere.

## Release

- `report.js` must be added to `sw.js` in **two places**: the `SHELL` array
  (`sw.js:15`) and the `isShell` regex (`sw.js:20`). `cache.addAll` is
  all-or-nothing, so a missing path means the worker never installs and offline
  support disappears silently.
- `VERSION` in `index.html` and `CACHE` in `sw.js` move together.
- `release.test.js` catches both.

## Rejected alternatives

**A browsable history of every report.** Chosen first, then reversed on
reflection: the gauges already answer "am I progressing", so a report archive
duplicates a job the app already does. It would have meant a new synced entity —
client UUIDs, a `create table if not exists` block, an entry in `USER_TABLES`, a
fourth `toRow`/`fromRow`/`merge` trio in `sync.js`, and the optional-column probe
so an un-migrated database degrades instead of failing.

**Reports as conversations with `activity: "report"`.** Large reuse — the
`conversations` table already has an `activity` column, messages already sync
with tombstones, and the 💬 list already groups by activity and date, so history
would have been free. Rejected because `activityFor()` (`prompt.js:397`) falls
back to `ACTIVITIES.chat` for any unknown id and `currentActivity()` reads
straight off the conversation, so a report in the chat list is *openable* — and
opening it hands the learner a chat session with their progress report as
conversation history. Fixable with two special cases carved into shared paths,
which is worse than the forty lines it saves. It also cuts against the
dialogue-vs-item split already settled for this app: a report is an artifact, not
a dialogue.

**A generated Chinese summary line.** See "The Chinese line needs no second
call".

**Numbers rendered up top, prose below.** Would double as a dashboard, at the
cost of repeating surfaces the app already has — the gauge-versus-prompt problem
this feature exists to avoid.

## Related backlog items

Both were opened while designing this, and both are deliberately *not* part of
it:

- **The app's own instruction could migrate to Chinese as the level rises**
  (BACKLOG.md, commit `c2e06db`) — at HSK 6 the whole app could be in Chinese.
- **My own progress data, over time, shown to me** (BACKLOG.md, commit
  `a0084f1`) — the rate of progress, which no surface in the app currently shows.
  This is the feature that would have justified a report archive.
