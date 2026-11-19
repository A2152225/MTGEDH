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

**Post-fix smoke (shards 0–23, same seed):** stall **~8%** (`4-2`, `5-1`).

**Post–combat-opt smoke (shards 0–23, seed 7000, `out/stall-fix-b3-*.jsonl`):** stall **~4%** (1 stall + 1 shard-9 hard-kill).

**Post–shard9 / cheap-block-eval smoke (`out/stall-fix-b4-*.jsonl`, same 24 shards):**

| endReason | count | share |
| --- | --- | --- |
| win | 12 | 50% |
| turn-limit | 9 | 37.5% |
| stall | 3 | **12.5%** |
| error | 0 | 0% |

Stall rate **12.5%** on the same 24-game window (worse than b3’s ~4%). No hard-kills; shard **9 → win**. Stalls: `selfplay-7000-4-2`, `4-3`, `5-2`. Dig those next before full P2-8. Harness `maxWallClockMs` = `MAX_TURNS*30s`.

### Stall investigation (fixes landed — re-gate pending)

Primary soft-lock was **DECLARE_ATTACKERS seq-freeze**, not only MAIN1 cast churn:

1. **Main-phase control-flow casts** now `noteMainPhaseAction` + reschedule (same as response window), so target/modal casts hit `MAX_MAIN_ACTIONS`.
2. **Attack declare fallbacks**: rejected plans shrink to forced-only/empty; never silent-return on `GOAD_MUST_ATTACK`. Last resort force-marks `attackersDeclaredBy` and passes.
3. **Stale `permanent.attacking` shortcut removed** — AI no longer passes DECLARE_ATTACKERS without recording the seat.
4. **v2 `planAttacks` skipped** on large boards (`board>40` or `attackers>12`) / when `ms>2500`, falling back to v0 (planner hung exclusive AI actions → multi-GB RSS).
5. **Large-board combat fast-path + sticky** (`attackPlannerFast.ts`, `combatDecisionSticky.ts`): greedy attacks when `board>24` or attack pool `>8`; v2 blocks fall back to `planAIBlocks` on large combat; sticky attack/block reuse for the current seat/step window.
6. **Empty-stack non-declare combat** skips response enum + fast-pass (BEGIN_COMBAT/damage/END_COMBAT).
7. **Large-block cheap eval**: do not run `evaluateCombatValue`/`cardAnalyzer` per blocker before the large-combat gate (sync CPU hog → event-loop stuck past tick/wall budgets).

Repro probes after combat fast-path/sticky: shard **8** → **turn-limit** (91); shard **7** still progresses but hits probe `maxWallClockMs` (~45m) at turn 78 `BEGIN_COMBAT` (not DECLARE_ATTACKERS freeze; `warningCount=0`). Puzzles still **35/36**.

### Next

1. Dig b4 stalls: `selfplay-7000-4-2`, `4-3`, `5-2` (shards 18/19/22).
2. Full P2-8 gate re-measure once stall share is back near ~1–2%: `out/gate-p2-v2-*.jsonl` (seed 7000, 320 games, v2 vs v1).
3. Probe harness: keep `it` timeout above `maxWallClockMs` (`MAX_TURNS*30s`) so vitest does not tear down fake timers mid-tick.

## Planners shipped behind v2

| Task | Module |
| --- | --- |
| P2-5 | `rules-engine/src/ai/attackPlanner.ts` / `attackPlannerFast.ts` + `combatDecisionSticky.ts` |
| P2-6 | `rules-engine/src/ai/blockPlanner.ts` |
| P2-7 | `rules-engine/src/ai/turnPlanner.ts` + `server/.../aiTurnPlanHook.ts` |
