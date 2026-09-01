# Raw `story-ab.js` output, v69 story-time chooser

The unedited terminal output of every arm run for the v69 measurement, kept
because it cost real money and because `RESEARCH.md` records only the counts and
the verdicts. If a later run disagrees with what `RESEARCH.md` says, these files
are what to diff against.

| file | arm | model |
|---|---|---|
| `task13-questions.out`, `task13-questions-run3.out` | question conformance, 20/level at HSK 1-4 | teaching (`qwen3-235b`) |
| `task13-cast.out`, `task13-cast2.out` | cast prompt: parses, respects the cap, `maxTokens: 200` headroom | story (`claude-sonnet-4.5`) |
| `task13-discussing.out`, `task13-discussing2.out` | does the discussing phase stop, or ask again | teaching |
| `task13-topic.out` | topic arm, free text: "the Monkey King" vs no topic, HSK 2 | story |
| `task13-topic-curated.out` | topic arm, curated: "A running race at school" vs no topic, HSK 2 | story |

Two things a reader needs in order not to misread them:

- **The two topic arms carry their own paired controls, and the controls differ
  a lot** — 33% out-of-level in the Monkey King run against 13% in the curated
  run. Compare each topic arm to *its own* control, never across runs. That
  spread is itself more evidence for the standing six-to-eight-seed warning in
  `BACKLOG.md`.
- **`CONT` / `RESTART` / `UNREL` read zero in every arm** and mean nothing —
  `judge()` is undefined, see `BACKLOG.md`. Both topic arms were run with
  `--nojudge` for that reason, so the out-of-level and attempt counts beside
  those zeroes are sound.

An earlier topic-arm run died to an interruption partway through and printed no
summary; its cost is real and unrecorded, and no number from it appears anywhere.

Total spend across the arms kept here: about $2.25.
