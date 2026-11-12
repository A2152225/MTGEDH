# AI Phase 1 gate (v1 vs v0)

Decision: **FAIL — do not promote v1.** Keep `AI_BRAIN` default at v0. Stalls/errors and latency look fine, and puzzles improved (9/12 vs 8/12), but among finished games challenger wins are only 7/45 (LB 6.4%), below the 25% equal-strength floor. Absolute wins 7/320 are not the gate metric (turn-limits are not losses).

### Follow-ups from this gate (fixed or in progress)

- **Hard-kills (~5%)**: Root cause — `AI_SELFPLAY_BATCH_KILL_MS=300s` was below harness `maxWallClockMs` (675s at maxTurns=45), so slow-but-live games were synthetic errors. Default batch kill now scales to `maxTurns*15s+180s`. Repro in flight.
- **`handSize` public-info mismatch (2 games)**: Stale `zones.handCount` preferred over `hand.length`. Fixed in `buildObservation.publicHandSize`; VERIFY only when positions logging is on.
- **Gate metric**: Win-rate check is among `endReason=win` (equal-strength 25%), with absolute rate reported separately.
- Soft stalls (6 v1 / 14 v0): many were `tick-timeout@60s` with stack>0 (storm). Raised selfplay `maxTickWallClockMs` to 180s. Empty-stack `turn-stalled` remains residual AI churn.
- Next: denser fit at maxTurns=90 (`out/fit-max90-*`, in flight), then re-gate; Phase 5 statics/triggers stay paused.

## Verdict

| Check | Result | Detail |
| --- | --- | --- |
| Challenger win-rate LB > 25% (among finished) | **FAIL** | lower=6.4% (Wilson 7.7%, bootstrap 6.4%); finished=45/320 |
| Stall+error share ≤ control (+2/n margin) | **PASS** | v1 7.2% vs v0 9.7% |
| Median ms ≤ 1.25× control | **PASS** | v1 56.3s vs v0 54.1s (ratio 1.04) |
| Puzzles ≥ v0 | **PASS** | v1 9/12 vs v0 8/12 |

**Overall: FAIL**

## Challenger win rate

- Among finished (endReason=win): **7/45** (15.6%)
- Absolute (all games, incl. turn-limit): **7/320** (2.2%)
- Wilson 95% (finished): [7.7%, 28.8%]
- Pod bootstrap 95% (finished): [6.4%, 26.2%]
- Gate lower bound: **6.4%**

## End reasons

| Reason | v1 | v0 |
| --- | --- | --- |
| win | 45 (14.1%) | 41 (12.8%) |
| turn-limit | 252 (78.8%) | 248 (77.5%) |
| error | 17 (5.3%) | 17 (5.3%) |
| stall | 6 (1.9%) | 14 (4.4%) |

## Timing

| Metric | v1 | v0 |
| --- | --- | --- |
| Median seconds | 56.3 | 54.1 |
| p90 seconds | 98.0 | 95.8 |

## Files

- Challenger: `out/gate-v1-*.jsonl` — 320 games, seed 3000, maxTurns 45, `CHALLENGER=v1`
- Control: `out/gate-v0-*.jsonl` — 320 games, seed 3000, maxTurns 45, `CHALLENGER=v0` (resumed from shard 193 after reboot)
- Puzzles: `out/puzzles-v0.json` (8/12), `out/puzzles-v1.json` (9/12; `P-no-self-wipe` newly passes)
