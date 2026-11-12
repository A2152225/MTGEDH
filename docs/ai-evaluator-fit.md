# AI evaluator fit (P1-3)

Generated 2026-11-12T16:30:42.685Z.

## Data

| Metric | Value |
| --- | --- |
| Result rows | 100 |
| Position rows | 6252 |
| Wins used | 64 |
| Labeled positions | 3704 |
| Train positions | 3041 |
| Hold-out positions | 663 |
| Pods (train/hold-out) | 20 / 5 |
| L2 | 0.01 |
| Seed | 2 |

### End reasons

- win: 64
- stall: 21
- turn-limit: 14
- error: 1

## Hold-out log-loss

| Model | Log-loss |
| --- | --- |
| Fitted | 1.1671 |
| Life-only | 1.2311 |
| Uniform | 1.2339 |

Beats both baselines: **yes**

## Reliability (10-point buckets)

| Bucket | n | mean predicted | observed | gap | flag |
| --- | --- | --- | --- | --- | --- |
| 0.0–0.1 | 59 | 0.064 | 0.051 | 0.013 |  |
| 0.1–0.2 | 384 | 0.159 | 0.154 | 0.006 |  |
| 0.2–0.3 | 1228 | 0.249 | 0.261 | 0.013 |  |
| 0.3–0.4 | 408 | 0.344 | 0.311 | 0.033 |  |
| 0.4–0.5 | 100 | 0.441 | 0.500 | 0.059 |  |
| 0.5–0.6 | 73 | 0.548 | 0.425 | 0.124 |  |
| 0.6–0.7 | 48 | 0.646 | 0.750 | 0.104 |  |
| 0.7–0.8 | 22 | 0.756 | 0.818 | 0.062 |  |
| 0.8–0.9 | 11 | 0.843 | 0.727 | 0.116 |  |
| 0.9–1.0 | 12 | 0.959 | 0.833 | 0.126 |  |

Calibrated: **yes**

## Weights

| Feature | Weight | Expected sign | OK |
| --- | --- | --- | --- |
| life | 0.8732 | positive | yes |
| commanderDamageTaken | -0.4519 | negative | yes |
| boardValue | 0.4505 | positive | yes |
| otherPermanents | 0.0203 | any | — |
| manaSources | 0.2817 | positive | yes |
| handSize | -0.0610 | any | — |
| commanderInPlay | 0.4847 | any | — |
| loyalty | -0.4397 | any | — |
| attackPower | -0.2311 | any | — |

Sign check (life/board/mana +, cmd dmg −): **yes**

## Verdict

**PASS** — wrote FITTED_WEIGHTS.

Source: v0 self-play maxTurns=90, seed 4000 (`out/fit-max90-*.jsonl`, `out/fit-pos-max90-merged.jsonl`). Win sample 64/100; hold-out split seed 2.
