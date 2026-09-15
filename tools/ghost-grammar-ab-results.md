# Ghost Words demanded 被 and the grammar rule forbade it

`node tools/ghost-grammar-ab.js --runs 30 --concurrency 6` — about a cent a
round. Model `qwen/qwen3-235b-a22b-2507`, the chat model in the session that
produced the defect, not the repo default.

Found by reading an English explanation, not a diff. At HSK 2 working up into 3,
pacing had taught 被 把 为了 放 生活; none had ever been produced, so Ghost Words
targeted them and `turn()` made 被 a hard condition of the reply. What reached
the screen was

> 我的书被我放在桌子上了。为了生活好，我把手表也放好。你被妈妈帮忙过吗？

— 被 present three times, 被字句 absent all three: a reflexive agent, then 被
bolted onto 帮忙, which is intransitive and cannot passivise at all. Every word
validated. Vocabulary was never the problem, and the app has no other gate.

Two defects, and the obvious repair for the second one is wrong.

## What shipped because of this

One change, in `prompt.js`: the demand for the required word is now emitted
whenever `require` is set, instead of only when `offer` is also non-empty.

```js
-    if (opts.offer && opts.offer.length) {
-      if (opts.require) {
+    if (opts.require) {
```

Ghost Words carries `newWords: false`, so `offer` is empty on every one of its
turns while `required` is set from the unused list on every one of them. The
demand was enforced in `turn()`'s retry loop and printed nowhere. The partner
was failing a rule it had never been shown.

**Nothing else shipped.** In particular the grammar ban was left alone, and the
rest of this file is why.

## The trap

One prompt, four rules apart:

```
3.  可以用「了」「过」…。还不要用：把、被、难的动词补语。
13. 学生最近学了这些词，请多用：被、把、为了、放、生活、手表。
```

The reading that suggests itself: pacing teaches words above the level, so a
taught 被 should stop being banned. A grammar word *is* its grammar, which makes
a ghost 被 the most valuable item the unused list can hold — the structure was
taught and has never once been produced. Dropping it from the list would remove
the best thing on it. So lift the ban instead.

Measured, that is backwards.

## Round one, 20 runs per arm

| arm | | uses 被 | of those, correct | end to end |
|---|---|---|---|---|
| `v103` | demand unstated, ban intact | 2/20 | 1/2 | **1/20 5%** |
| `stated` | demand stated, ban intact | 14/20 | 11/14 | **11/20 55%** |
| `fixed` | demand stated, ban lifted | 9/20 | 4/9 | **4/20 20%** |

`v103 → stated` p = 0.0012. `stated → fixed` p = 0.0484. `v103 → fixed`
p = 0.3416 — lifting the ban gives back most of what printing the demand won.

`stated` was in this round **to be falsified**: printing a demand for 被 under a
rule forbidding 被 should have raised compliance with the letter of the
requirement while leaving the Chinese as bad or worse. It did the opposite.

Not a judge artifact — both arms average about one 被 per reply (1.00 against
1.11), so the "every 被 must be well-formed" rule is not penalising `fixed` for
volume. The 被 are simply worse.

## Why lifting the ban makes it worse

The ban is not only a prohibition. It is the only thing in the prompt telling
the partner the structure is hard. Told 被 is forbidden *and* required, it uses
it once, in the safest passive it knows — 被猫吃了一点儿, 被朋友拿走了. Distinct
agent, resultative verb, canonical.

Lift the ban and 被 becomes an ordinary word, and 把 comes unlocked alongside it
(1.44 per reply against 0.64). The partner chains them into two-clause sentences
and crams four ghost words a reply instead of three, and the second clause is
where it breaks:

```
BAD   我把菜放错了，被妈妈笑了。
BAD   我把手表放到了桌子上，后来被我看见了。
BAD   我把菜放错了，被妈妈看见了。为了生活好，我买了一个新手表。
```

`为了生活好` verbatim, and the reflexive 被 verbatim. The `fixed` arm does not
repair the reported defect. It reproduces it.

## Round two: can the caution be said out loud?

If the ban works by signalling difficulty rather than by restricting, then
stating the caution explicitly should let the ban come off — which is what the
learner wanted, since a partner that avoids 被字句 never models the grammar he
is working toward. A 2×2 over ban on/off × caution stated/unstated, 30 runs per
arm, caution worded to name no verb and no pattern (DEVELOPING.md's 心里 case:
seed the rule text with 拿走了 and the partner echoes the judge's answer key).

| arm | ban | caution | uses 被 | of those, correct | end to end |
|---|---|---|---|---|---|
| `stated` | on | implicit | 15/30 | 10/15 67% | **10/30 33%** |
| `fixed` | off | implicit | 10/30 | 4/10 40% | **4/30 13%** |
| `statedCare` | on | explicit | 20/30 | 7/20 35% | **7/30 23%** |
| `liftedCare` | off | explicit | 8/30 | 5/8 63% | **5/30 17%** |

No arm beat `stated`, and every round-two pairwise comparison is inconclusive at
this n (`fixed` p = 0.13, `statedCare` p = 0.57, `liftedCare` p = 0.23).

The caution fails in **two opposite ways**, which is the interesting part:

- **with** the ban it invites overreach — the highest 被 rate of any arm (67%)
  and the lowest accuracy (35%). "Be careful with the word you must not use"
  reads as permission.
- **without** the ban it invites avoidance — the lowest 被 rate of any arm
  (27%). "Be careful with this" and nothing else reads as a warning to stay
  away. Which is exactly the outcome lifting the ban was meant to prevent.

Explicit caution does not substitute for the implicit signal in either
direction.

## Control replication, and a correction

`stated` ran unchanged in both rounds: 11/20 (55%), then 10/30 (33%). That is
within noise (p = 0.1535) and the arms pool — but **round one's 55% was
optimistic** and should not be quoted. Pooled over all 50 runs:

| | end to end | |
|---|---|---|
| `stated` keep the ban | **21/50 42%** | |
| `fixed` lift the ban | **8/50 16%** | p = 0.0076 |
| `v103` as shipped | 1/20 5% | p = 0.0034 against `stated` |

Round two's individual comparisons prove nothing at 30 runs each. The two
claims that survive both rounds are the pooled ones: **printing the demand takes
a learner from almost never seeing 被 modelled correctly to about two turns in
five, and lifting the ban roughly halves that again.**

## What is still broken

Even in the best arm, a third of the replies containing 被 are wrong — one of
them literally 我的手表被我放在桌子上了, the reported sentence. No instruction to
the partner fixed that in eight arms across two rounds. The partner's Chinese is
validated word by word and graded not at all, and word-by-word validation says
nothing about whether the words form a sentence. That is the case for a
correctness gate on the reply before it renders, not for more prompt wording.

## Re-running it

The arms patch the shipped prompt, so `BANNED` is asserted against
`HSKPrompt.build()` output on every run: if `LEVEL_STYLE`'s HSK 2 rule is
edited, the harness raises rather than silently measuring a prompt that no
longer exists. `LIFTED` is the same rule with the two words removed and is
patched *in* by the arms that need it — the ban was never lifted in the app.

Raw per-reply results, both rounds, in `ghost-grammar-ab-results.json`.
