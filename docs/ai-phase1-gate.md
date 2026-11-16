# AI Phase 1 gate (v1 vs v0)

Decision: **FAIL — do not promote v1.** Keep `AI_BRAIN` default at v0. Post–SBA-fix maxTurns=90 re-gate (seed 5000): challenger **14/55** finished (25.5% point, LB **14.9%**). Stalls/errors and latency pass; puzzles pass (9/12 vs 8/12). Point estimate is only equal-strength — need a clearer edge (more finished games and/or a stronger brain) before promote. Phase 5 statics/triggers stay paused.

### What improved

- Stall share **0.6%** (v1) / **0.3%** (v0) vs ~40–50% before the `runSBA` ESM `require()` fix.
- Control finishes games again (**64 wins** vs 0 on the broken pre-fix control).
- Prior max45 / broken-max90 gates superseded.

## Verdict

| Check | Result | Detail |
| --- | --- | --- |
| Challenger win-rate LB > 25% (among finished) | **FAIL** | lower=14.9% (Wilson 15.8%, bootstrap 14.9%); finished=55/320 |
| Stall+error share ≤ control (+2/n margin) | **PASS** | v1 0.6% vs v0 0.3% |
| Median ms ≤ 1.25× control | **PASS** | v1 90.4s vs v0 88.2s (ratio 1.02) |
| Puzzles ≥ v0 | **PASS** | v1 9/12 vs v0 8/12 |

**Overall: FAIL**

## Challenger win rate

- Among finished (endReason=win): **14/55** (25.5%)
- Absolute (all games, incl. turn-limit): **14/320** (4.4%)
- Wilson 95% (finished): [15.8%, 38.3%]
- Pod bootstrap 95% (finished): [14.9%, 36.1%]
- Gate lower bound: **14.9%**

## End reasons

| Reason | v1 | v0 |
| --- | --- | --- |
| turn-limit | 263 (82.2%) | 255 (79.7%) |
| win | 55 (17.2%) | 64 (20.0%) |
| stall | 2 (0.6%) | 1 (0.3%) |
| error | 0 (0.0%) | 0 (0.0%) |

## Timing

| Metric | v1 | v0 |
| --- | --- | --- |
| Median seconds | 90.4 | 88.2 |
| p90 seconds | 145.5 | 137.8 |

## Files

- Challenger: `out/gate90b-v1-*.jsonl` — 320 games, seed 5000, maxTurns 90, `CHALLENGER=v1`
- Control: `out/gate90b-v0-*.jsonl` — 320 games, seed 5000, maxTurns 90, `CHALLENGER=v0`
- Puzzles: `out/puzzles-v0.json` (8/12), `out/puzzles-v1-refit.json` (9/12)
- Weights: max90 refit PASS (`docs/ai-evaluator-fit.md`)
