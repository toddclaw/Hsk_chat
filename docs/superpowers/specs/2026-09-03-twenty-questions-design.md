# 20 Questions activity, either side

**Date:** 2026-09-03
**Status:** approved design, not yet planned or built.
**Scope:** one new activity, `twenty`. Chat, focused chat and story time are untouched.

---

## The request

Todd wants a 20-questions activity, with the option of playing either side:

- **answerer** — the student thinks of something; the model asks yes/no questions
  to guess it.
- **guesser** — the model thinks of something; the student asks yes/no questions
  to guess it.

## Decisions taken

| # | Decision | Rationale |
|---|---|---|
| D1 | No question counter, no automatic win/lose detection | The model narrates ("还有 5 个问题", "对了！") and the student ends a round by starting a new chat, same bargain as Ghost Words and story time — no new tracked state, no new sync surface. |
| D2 | `guesser`'s secret is drawn from a **curated pool**, intersected with the student's own cumulative wordlist (`S.base`) | A random word from the raw allowlist can be ungoessable (因为, 应该, 如果). The (unmerged) story-topic-chooser work measured that uncurated content vocabulary degrades quality even though validation itself never breaks — same risk here, same fix. |
| D3 | The secret is **never rendered anywhere in the UI** — not the title, not the meta line, not a debug panel. Only `systemPrompt()` reads it | It has to stay a secret from the student, unlike `storyTopic`, which the student typed themselves and is fine to show back. |
| D4 | The secret needs **no new legalization mechanism** (unlike `STORY_NAMES`) | Drawn from `S.base`, so the model is already allowed to say it. The prompt only has to tell the model *when* it may. |
| D5 | Role is fixed at conversation creation, stored as `c.side`, exactly like `activity`/`level` | Same reason those two are fixed: it decided what the partner was allowed to say, so a transcript written as one role does not silently become the other. |
| D6 | `build()` branches on `opts.side` the same way it already branches on `opts.storyPhase`, rather than a static `act.rules` array | The rule text is role-dependent, not activity-dependent — the existing phase-branch shape already handles exactly this. |
| D7 | The role chooser reuses the story chooser's slot and gating (`openingTurn()` withheld until a choice is made), with an explicit `currentActivity() === "twenty"` branch beside the existing `"story"` one | Two data points don't earn a new generic "activity needs a chooser" config flag — the codebase's existing style is per-id branches at these two call sites, and a third activity needing this can motivate generalizing then. |

## Approaches considered

**1. Track questions and detect wins in app code.** A counter in UI chrome, and for
`guesser`, a string match of the student's guess against the secret. More game-like,
but it is new synced state, new UI, and a fuzzy-match problem (谁能保证学生打的是"苹果"而不是
"红苹果" or a description) for a payoff Todd didn't ask for.

**2. Model narrates, student manages the round (chosen).** No new state beyond the role and
the secret. The model is simply told the rules in Chinese and asked to say where it's at.
Costs a little trust in the model's counting and confirmation — acceptable, since a stray
"还有 8 个问题" or an early confirmation is not a level-guarantee break, just a worse round.

**3. Full game with scoring and difficulty tiers.** Explicitly out of scope — nothing in the
request asks for it, and it's a different, larger feature.

## 1. The activity's states

| State | Reached when | Strip shows |
|---|---|---|
| **Choosing** | `twenty` conversation with no `side` set yet | two buttons: "I'll think of something" / "You think of something" |
| **Playing** | `side` set | nothing special — ordinary chat composer, same as `chat`/`focused` |

`startActivity()`'s `if (act.gen !== "segments" && id !== "chat") openingTurn();` gate gets one
more exclusion for `id === "twenty"`, matching how story time is excluded today. `renderStarters()`
gets one more explicit branch, `if (currentActivity() === "twenty") return renderTwentyControl(box);`,
beside the existing `"story"` branch.

## 2. Data model

- `c.side = "answerer" | "guesser"`, set once, at chooser time. `db/schema.sql`
  gets `add column if not exists side text`, matching the existing single-word column
  convention (`activity`, `level`, `kind`), probed once per session like other optional
  columns — an un-migrated database
  degrades to `side` always empty, which just means the chooser reappears on that device
  rather than the round resuming. Acceptable: a role chosen on an un-migrated device already
  can't sync anywhere useful.
- `c.secret`, set only for `guesser`, at the same moment as `side`. Same optional-column
  treatment. Never read by anything except `systemPrompt()`'s call into `HSKPrompt.build()`.

## 3. The secret pool

`HSKPrompt.GUESS_POOL` in `prompt.js`, next to `STORY_NAMES`: a flat list of ~35-40 concrete,
guessable nouns (animals, food, everyday objects, places) — no per-level tagging, because
membership is checked against the student's own already-loaded `S.base` at pick time rather
than asserted up front.

Picking: filter `GUESS_POOL` to words present in `S.base`, pick one at random. Measured against
the real `data/hsk<N>.json` files, HSK 1 alone already yields 16 of a 37-word draft pool (苹果,
猫, 狗, 书, 老师, 医院, 电脑, 手机, 椅子, 桌子, 车, 飞机, 火车, 水果, 衣服, 雨 among them), so an
empty intersection is not a realistic case at any level — but the pick function still falls
back to any word in `S.base` if the intersection is ever empty, rather than throwing.

`test/prompt.test.js` asserts `GUESS_POOL` is non-empty, has no duplicates, and that the
HSK 1 intersection alone clears some minimum count (catches the pool drifting toward words no
level below HSK 3 will ever carry).

## 4. Prompt construction

`build()` gains a role branch parallel to the existing `storyPhase` branch:

- `answerer`: "学生心里想了一个东西，你负责猜。一次只问一个是非问题（能用"是不是"、"对不对"、
  "有没有"回答的那种），大概二十个问题以内猜出来，一边猜一边说这是第几个问题。"
- `guesser`: "你心里想的是「{secret}」。学生问你是非问题，你只回答"是"或"不是"（可以简单地多说
  一点，但是不要自己说出这个东西是什么）。如果学生猜对了，或者说不猜了，你才可以说出「{secret}」。"

Both suppress the ordinary chat turn-taking rules (`act.converse` rules 5-7 — answer, then
share, then ask something new) the same way story time's `telling` phase does, since a
yes/no-question exchange isn't that shape of turn.

`opts.side` and `opts.secret` are threaded through `defaultPrompt()` in `index.html`,
read off `currentActivity() === "twenty" ? c.side : null` / `c.secret`, exactly parallel to
how `storyTopic` is threaded today.

## 5. Testing

- `test/prompt.test.js`: role-branch rule text appears for its own role and not the other,
  `secret` appears in the `guesser` prompt and nowhere when role is unset, `GUESS_POOL`
  sanity checks (section 3).
- `test/sync.test.js`: `side`/`secret` round-trip through `messageToRow`/`rowToMessage` (or
  the conversations-table equivalent — wherever `activity`/`storyTopic` round-trip today) and
  degrade cleanly when the column probe reports them absent.
- No new file the page loads, so `sw.js`'s `SHELL` is unchanged; `VERSION`/`CACHE` still move
  together for the behavior change itself.
- Per CLAUDE.md: this is a prompt change, so it needs a real-model A/B before shipping, counting
  at minimum — the model never states the secret before a correct guess or a give-up, it stops
  asking/guessing around 20, and it correctly confirms a right guess. Run name-free, HSK 1-4.

## Files touched

`index.html`, `prompt.js`, `db/schema.sql`, `sync.js`, `test/prompt.test.js`,
`test/sync.test.js`, `VERSION` with `CACHE` together.

## Deliberately out of scope

- Question counting, win/lose detection, scoring, streaks, difficulty tiers.
- Synonym- or description-aware guess matching (e.g. recognizing "红苹果" as a hit on 苹果) —
  moot anyway, since D1 means the app never matches a guess against the secret at all.
- A "reveal the secret" button — the student can always just ask the model to give up, in
  Chinese, as an ordinary turn.
- Retrofitting anything about existing activities.

## Open questions

- None blocking. The real-model A/B (section 5) may surface prompt wording issues, same as
  every prompt change in this app's history — that's expected to be the next session's finding,
  not a gap in this design.
