# AI Phase 2 gate (P2-8)

Challenger: **v2** (v1 scoring + attack/block/turn planners). Baseline seats: **v1**. Default live brain remains **v0** until promote.

## Puzzle suite (36 total, held-out included)

| Brain | Passed | File |
| --- | --- | --- |
| v0 | **26/36** | `server/out/puzzles-v0-heldout.json` |
| v1 | **27/36** | `server/out/puzzles-v1-heldout.json` |
| v2 | **35/36** | `server/out/puzzles-v2-heldout.json` |

Gate target ≥90% ⇒ **≥33/36**. **v2 is at 35/36 (97%)** — puzzle bar met. Only miss: `P-hold-counter-for-winner`.

## Self-play

**Paused gate (pre-fix):** stopped at **119/320** (seed 7000) with **stall 22.7%** / stall+error ~23.5%.

**Post-fix smoke (shards 0–23, same seed):**

| endReason | count | share |
| --- | --- | --- |
| turn-limit | 17 | 70.8% |
| win | 4 | 16.7% |
| stall | 2 | **8.3%** |
| error | 1 | 4.2% (transient esbuild transform; file parses clean) |

Stall rate **~8%** (down from ~23%). Remaining stalls: `selfplay-7000-4-2`, `selfplay-7000-5-1` (turn-stalled ~180s). Full P2-8 gate restartable.

### Stall investigation (fixes landed — re-gate pending)

Primary soft-lock was **DECLARE_ATTACKERS seq-freeze**, not only MAIN1 cast churn:

1. **Main-phase control-flow casts** now `noteMainPhaseAction` + reschedule (same as response window), so target/modal casts hit `MAX_MAIN_ACTIONS`.
2. **Attack declare fallbacks**: rejected plans shrink to forced-only/empty; never silent-return on `GOAD_MUST_ATTACK`. Last resort force-marks `attackersDeclaredBy` and passes.
3. **Stale `permanent.attacking` shortcut removed** — AI no longer passes DECLARE_ATTACKERS without recording the seat.
4. **v2 `planAttacks` skipped** on large boards (`board>40` or `attackers>12`) / when `ms>2500`, falling back to v0 (planner hung exclusive AI actions → multi-GB RSS).

Repro probes after fixes: shards **8** and **7** (former DECLARE_ATTACKERS stalls) → **turn-limit**. Puzzles still **35/36**.

### Next

1. Full P2-8 gate running: `out/gate-p2-v2-*.jsonl` / `out/_tmp-gate-p2-v2.log` (seed 7000, 320 games, v2 vs v1).
2. Dig remaining turn-stalls (`4-2`, `5-1`) if gate stall share stays above ~1–2%.

## Planners shipped behind v2

| Task | Module |
| --- | --- |
| P2-5 | `rules-engine/src/ai/attackPlanner.ts` |
| P2-6 | `rules-engine/src/ai/blockPlanner.ts` |
| P2-7 | `rules-engine/src/ai/turnPlanner.ts` + `server/.../aiTurnPlanHook.ts` |
