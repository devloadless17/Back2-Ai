# The readiness model

What the number means, how it is computed, and what it is not allowed to claim.

Written so this does not stay tribal knowledge inside a service function.
Implementation: `src/lib/scoring/readiness.ts`. Tests: `tests/readiness-v2.test.ts`.

---

## The three questions

| | Answers |
|---|---|
| **Mastery** | How well am I doing on material I have actually attempted? |
| **Coverage** | How much of the programme have I worked through? |
| **Readiness** | Given both, plus supported history, what does my evidence say about my standing? |

**These must never be collapsed back into one concept in the UI.** That
collapse is what v1 did, and it is why v2 exists.

---

## Definitions

**Mastery** — mean `masteryScore` over the chapters of a subject with **at
least one attempt**. Zero when none have been attempted. A student who has
answered five chapters perfectly reads `1.0`, not `0.25`.

**Coverage** — chapters with at least one attempt, over every chapter in the
subject. This is the denominator inside the mastery term and the honest answer
to "how much have I touched".

**`coverageComponent`** — a *stricter* figure, and a different thing: chapters
with at least `MIN_ATTEMPTS_FOR_WEAKNESS` (5) attempts, over all chapters. This
is what the score uses. `coverage` is what the UI should show.

**Trend** — `clamp01(0.5 + (Δ ÷ TREND_SATURATION) × 0.5)` where `Δ` is the
change in the mastery *term* against the mean stored four weeks ago, and
`TREND_SATURATION` is 0.2. Neutral is 0.5. Reported as `up` / `flat` / `down`
at a ±0.02 deadband.

---

## The formula

```
readiness = 0.5 × (mastery × coverage)
          + 0.3 × coverageComponent
          + 0.2 × trend
```

scaled to a mark by `markOutOf20(readiness)`.

**The weights are a product heuristic, not a calibration.** Nobody has fitted
them to an outcome and this repository holds no data that could. They are
unchanged from v1 deliberately — see below.

---

## Reportability

`reportable` is true only at **10 or more attempts** across the subject
(`MIN_ATTEMPTS_FOR_READINESS`) with at least one chapter.

Below that the UI must show the insufficient-evidence state and **must not
print a mark**. The threshold is an independent product rule and v2 did not
change it.

---

## With no evidence

An account with **zero attempts scores zero**.

v1 gave it `0.1` — the trend term's neutral `0.5` at weight `0.2` — for a
student who had done nothing. `reportable` hid that from every screen, but
hiding a wrong number is not the same as it being right: any caller reading
`score` without checking `reportable` would have printed a mark for an empty
account.

The fix is a floor on that one case, not a reweighting, so every other score
sits exactly where v1 put it.

---

## With partial coverage

High mastery on a small share of the programme **must not read as exam ready**,
and does not: the mastery term is multiplied by coverage, so two perfect
chapters out of twenty score about `0.18` — roughly 3.6/20 — not 12.6.

The UI should show mastery and coverage **near** the overall figure so the
student reads the real situation:

> Performing strongly on what I have practised, but I have covered a quarter of
> the programme.

---

## Model versions and historical compatibility

`READINESS_MODEL_VERSION = 2`.

**v1** — reported one term called "mastery" that was the mean over *every*
chapter, untouched ones entering as zero. That value was
`mastery_on_attempted × fraction_attempted`: breadth folded invisibly into a
word meaning depth, with coverage then added again beside it.

**v2** — states the same arithmetic honestly, and floors the empty account.

### Why v1 and v2 scores are comparable

**The decomposition preserves the readiness scale for accounts with evidence;
v2 corrects the zero-evidence edge case.**

That is the precise claim, and it is narrower than "v1 and v2 are identical".
For any account with at least one attempt, `mean_over_all_chapters` is
identically `mastery_on_attempted × fraction_attempted` under the current
chapter weighting, so the factoring changes nothing. Proven in
`tests/readiness-v2.test.ts`.

The zero-evidence case is **deliberately different**: v1 returned 0.1 there and
v2 returns 0. That is the one state where the two models disagree, and it was
changed on purpose.

**Consequences for history.** No reset, no era separator, no snapshot
migration, no score conversion, no chart discontinuity. Stored
`readiness_scores` remain on one scale and existing trend lines stay truthful,
because no row with evidence behind it moved — and a row with no evidence was
never displayable, since `reportable` requires ten attempts.

This is why the weights were left alone. Changing them would have broken that
comparability and would have needed distributions nobody has.

### If the weights are ever recalibrated

That *would* be a v3 and would break comparability. It would need:

1. real distributions from production `readiness_scores` and `attempts`;
2. a decision on whether historical rows are re-scored, era-separated, or
   dropped from comparison;
3. persisting the version alongside each snapshot — **not yet done**, see below.

Until then, do not draw one continuous trend line across rows of different
model versions.

---

## Known gaps

- **The version is computed but not persisted.** `readiness_scores` has no
  `model_version` column, so a stored snapshot cannot say which formula made
  it. Acceptable while v1 and v2 share a scale; it must be added before any
  recalibration.
- **Nothing here has been run against real data.** The identity is proven
  algebraically and in tests; the distributions are unknown.

---

## What readiness may not claim

Never, in any surface:

- "You will pass" / "exam ready" / "likely grade"
- "Predicted Bac score" — it is an estimate from evidence, not a prediction
- "You can gain N marks" — no counterfactual is supported
- "Top 10%" or any comparison with other students — no such data exists
- "AI confidence" — no such value exists
- a mark of any kind when `reportable` is false
