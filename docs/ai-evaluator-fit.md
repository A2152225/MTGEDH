# AI evaluator fit (P1-3)

Generated 2026-11-11T13:30:38.663Z.

## Data

| Metric | Value |
| --- | --- |
| Result rows | 100 |
| Position rows | 4357 |
| Wins used | 10 |
| Labeled positions | 396 |
| Train positions | 307 |
| Hold-out positions | 89 |
| Pods (train/hold-out) | 7 / 2 |
| L2 | 0.01 |
| Seed | 1 |

### End reasons

- turn-limit: 80
- win: 10
- stall: 3
- error: 7

## Hold-out log-loss

| Model | Log-loss |
| --- | --- |
| Fitted | 1.1461 |
| Life-only | 1.2001 |
| Uniform | 1.2717 |

Beats both baselines: **yes**

## Reliability (10-point buckets)

| Bucket | n | mean predicted | observed | gap | flag |
| --- | --- | --- | --- | --- | --- |
| 0.0–0.1 | 33 | 0.060 | 0.000 | 0.060 |  |
| 0.1–0.2 | 67 | 0.163 | 0.224 | 0.060 |  |
| 0.2–0.3 | 139 | 0.249 | 0.288 | 0.039 |  |
| 0.3–0.4 | 30 | 0.335 | 0.333 | 0.001 |  |
| 0.4–0.5 | 23 | 0.445 | 0.304 | 0.140 |  |
| 0.5–0.6 | 14 | 0.544 | 0.286 | 0.258 |  |
| 0.6–0.7 | 7 | 0.625 | 0.429 | 0.196 |  |
| 0.7–0.8 | 0 | 0.000 | 0.000 | 0.000 |  |
| 0.8–0.9 | 3 | 0.861 | 1.000 | 0.139 |  |
| 0.9–1.0 | 7 | 0.950 | 1.000 | 0.050 |  |

Calibrated: **yes**

## Weights

| Feature | Weight | Expected sign | OK |
| --- | --- | --- | --- |
| life | 1.4290 | positive | yes |
| commanderDamageTaken | -0.7204 | negative | yes |
| boardValue | 1.5627 | positive | yes |
| otherPermanents | 1.0577 | any | — |
| manaSources | 0.7935 | positive | yes |
| handSize | -0.4584 | any | — |
| commanderInPlay | 0.2572 | any | — |
| loyalty | 0.2126 | any | — |
| attackPower | 0.2585 | any | — |

Sign check (life/board/mana +, cmd dmg −): **yes**

## Verdict

**PASS** — wrote FITTED_WEIGHTS.

Known limit: labels come from v0 self-play at maxTurns=45, so most games are turn-limit and the win sample is small.
