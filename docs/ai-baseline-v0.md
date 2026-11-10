# AI baseline v0 (Phase 0 gate)

Measured numbers every later brain change is compared with. Regenerated when shared AI or engine behaviour that bots use changes.

## Verdict

**Gate: FAIL (finish rate) on the recorded 100-game retuned run below.** Harness had 0 `error`, but only **64 / 100** games ended in `win` or `turn-limit` (need ≥90). **0 wins** at `maxTurns=20`.

**Harness bug found after that run:** `maxNoTurnAdvanceMs` used *simulated* time under vitest fake timers, so many “stalls” at turn 1 in &lt;1s wall clock were false. Fixed to wall-clock (and stagnantTicks now requires min wall time). A clean re-baseline should be run with `AI_SELFPLAY_SHARDS=100` (one game per process; multi-game workers OOM around ~7GB). Until that re-run lands, treat stall counts below as an upper bound.

## Run

| Field | Value |
| --- | --- |
| Commit | `672a9cfa` |
| Seed | `1000` |
| Games | 100 (25 pods × 4 seat rotations) |
| Max turns | 20 |
| Wall-clock guards | `maxTickWallClockMs=60s`, `maxWallClockMs≈max(180s, turns×15s)` |
| Batching | 20 sequential vitest batches of 5 (single-process 25-game shards OOMed / leaked to ~7GB) |
| Challenger / baseline | `v0` / `v0` |
| Pool | Baked precon catalogue (`mtgjson` / `mtgjson-local`, `cardCount` 100) |
| Pool size | 168 decks (catalogue 172; 4 skipped as not mtgjson-100; 0 unresolved lines) |
| Wall time | ~84 min (`All batches done in 5018.9s` was the prior 4-shard attempt; retuned 20-batch run completed similarly) |
| Artifacts | `server/out/baseline-0.jsonl` … `baseline-19.jsonl`, merged `server/out/baseline-v0-max20-retuned.jsonl` |
| Commands | `npm run ai:baseline --workspace=server` then `npm run ai:report --workspace=server -- out/baseline-*.jsonl` |

### Earlier aborted / superseded attempts

| Artifact | Notes |
| --- | --- |
| `out/baseline-v0-max20-tick20s.jsonl` | First 100-game run with 20s tick timeout → **69% stall**, many at turns 0–1 (timeout too tight during mulligan/setup) |

## Puzzle suite (v0)

From `npm run ai:puzzles --workspace=server`:

| Result | Count |
| --- | --- |
| Pass | **8 / 12** |
| knownFailing | 4 |

Fails (expected for v0): `L-commander-21`, `A-hold-vs-lethal-crackback`, `P-hold-counter-for-winner`, `P-no-self-wipe`.

## Self-play results (retuned run)

### End reasons

| Reason | Count | Share |
| --- | --- | --- |
| turn-limit | 64 | 64.0% |
| stall | 36 | 36.0% |
| win | 0 | 0.0% |
| error | 0 | 0.0% |

### Timing

| Metric | Turns | Seconds |
| --- | --- | --- |
| Median | 21 | 96.0 |
| p90 | 21 | 134.0 |

### Win share by seat

| Seat | Wins / games | Rate | Wilson 95% |
| --- | --- | --- | --- |
| 0 | 0 / 100 | 0.0% | [0.0%, 3.7%] |
| 1 | 0 / 100 | 0.0% | [0.0%, 3.7%] |
| 2 | 0 / 100 | 0.0% | [0.0%, 3.7%] |
| 3 | 0 / 100 | 0.0% | [0.0%, 3.7%] |

### Stall turn histogram

Stalls are spread across the game, not only late: notable counts at turns 1 (5), 13 (4), 19 (5). Late hangs previously observed around end-step (~turn 27) with a 20s tick budget; with `maxTurns=20` many games now hit the turn cap instead.

### Decks with most stall appearances

| Deck | Stall appearances |
| --- | --- |
| C14::Peer through Time | 8 |
| CLB::Party Time | 7 |
| NCC::Maestros Massacre | 6 |
| C19::Primal Genesis | 5 |
| WHO::Blast from the Past | 4 |
| C21::Witherbloom Witchcraft | 4 |
| ECC::Blight Curse | 4 |
| C14::Forged in Stone | 4 |
| CMD::Mirror Mastery | 4 |
| M3C::Tricky Terrain | 4 |

## Gate checklist

- [ ] ≥90 of 100 games end in `win` or `turn-limit` — **64/100**
- [x] 0 harness `error` outcomes
- [ ] Turn-limit share ≤20%, or explained / limit raised — **64% turn-limit** (expected at maxTurns=20 with 0 wins; raise turns only after stalls are fixed)
- [x] Leak test green (incl. deliberate peek proof)
- [x] Trace dual-run matches without `AI_TRACE_FILE`
- [x] Determinism dual-run matches (seat ids remapped)
- [x] Puzzle suite committed (8/12 v0)
- [x] This report filled with commit hash and counts

## Follow-ups before Phase 1

1. Fix / triage AI hangs that produce `stall` (end-step and mid-game tick timeouts); track deck hotspots above.
2. Re-run baseline at `maxTurns` 30–45 once stall share is under ~10%.
3. Only then treat win-rate / seat skew as meaningful Phase 1 comparison numbers.
4. Investigate vitest-process RSS growth across many games in one worker (batching of 5 is a workaround).
