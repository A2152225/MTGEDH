# AI evaluator fit (P1-3)

## Active weights (kept)

**PASS** from prior maxTurns=90 fit (seed 2) — still in `evaluatorWeights.v1.ts`.

| Metric | Value |
| --- | --- |
| Source | `out/fit-max90-*.jsonl` + `out/fit-pos-max90-merged.jsonl` |
| Wins used | 64 / 100 games |
| Labeled positions | 3704 |
| Hold-out log-loss | 1.1671 (life-only 1.2311, uniform 1.2339) |
| Calibrated | yes |
| Sign check | yes |

| Feature | Weight |
| --- | --- |
| life | 0.8732 |
| commanderDamageTaken | -0.4519 |
| boardValue | 0.4505 |
| otherPermanents | 0.0203 |
| manaSources | 0.2817 |
| handSize | -0.0610 |
| commanderInPlay | 0.4847 |
| loyalty | -0.4397 |
| attackPower | -0.2311 |

## Denser refit attempt (2026-11-15) — FAIL, not promoted

Post–SBA-fix v0 self-play: 400 games, seed 6000, maxTurns=90 (`out/fit-dense-*.jsonl`, `out/fit-pos-dense-merged.jsonl`).

| Metric | Value |
| --- | --- |
| End mix | 74 win / 323 turn-limit / 3 stall |
| Position rows | 35376 |
| Labeled positions | 5683 |
| Hold-out log-loss | 0.9219 (beats life-only 1.1906 / uniform 1.2118) |

**Rejected because:**

- Life weight stably **negative** (~−0.61 at L2=0.01) — winners in long aggressive pods often sit lower on life, so the sign check fails.
- Calibration FAIL in mid buckets (0.5–0.7 gaps >0.25).
- L2≥0.5 restores a tiny positive life weight but calibration still fails.
- Merging with prior max90 wins (138 wins total) still yields life &lt; 0 and bad mid-bucket calibration.

Prior PASS weights left unchanged. Next strength work should not rely on another plain refit of the same features — need feature/policy changes or Phase 2 planners.
