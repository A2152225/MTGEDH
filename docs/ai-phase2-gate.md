# AI Phase 2 gate (P2-8)

Challenger: **v2** (v1 scoring + attack/block/turn planners). Baseline seats: **v1**. Default live brain remains **v0** until promote.

## Decision

**FAIL — do not promote v2.** Keep the live default at **v0**. Puzzles and stall hygiene pass; self-play win rate does not.

| Bar | Result |
| --- | --- |
| Puzzles ≥90% (≥33/36) | **PASS** — v2 **35/36** (97%) |
| Stall share ≤~2% | **PASS** — **0/320** after post-fix reruns |
| Challenger edge vs v1 | **FAIL** — decisive **37–100** (~27% win rate) |

Same shape as Phase 1 (`docs/ai-phase1-gate.md`): stalls/errors and puzzles are fine; the brain is not stronger than the baseline it would displace.

## Puzzle suite (36 total, held-out included)

| Brain | Passed | File |
| --- | --- | --- |
| v0 | **26/36** | `server/out/puzzles-v0-heldout.json` |
| v1 | **27/36** | `server/out/puzzles-v1-heldout.json` |
| v2 | **35/36** | `server/out/puzzles-v2-heldout.json` |

Only miss: `P-hold-counter-for-winner`.

## Self-play — full P2-8 gate

**Run:** seed **7000**, **320** games, maxTurns **90**, v2 seat 0 vs three v1 seats. Rows: `server/out/gate-p2-v2-*.jsonl` (post-fix / promoted reruns included).

| endReason | count | share |
| --- | --- | --- |
| v2 win | 37 | 11.6% |
| v1 win | 100 | 31.3% |
| turn-limit | 183 | 57.2% |
| stall | 0 | **0%** |
| error | 0 | 0% |

Decisive games only: **37 / 137 ≈ 27.0%** for v2.

**Stalls cleared:**

| shards | fix |
| --- | --- |
| 262, 281, 316 → wins | Eliminated-AP MAIN1: `shouldProtectActiveMainPhaseFromAutoAdvance` must not treat a seat that `playerCannotReceivePriority` as still having main-phase actions |
| 298 → turn-limit | Borg swarm tick-timeout: SBA identical-token P/T memo + shared battlefield permanent replay patch clones |

10. **Eliminated active player MAIN1:** `shouldProtectActiveMainPhaseFromAutoAdvance` must not treat a seat that `playerCannotReceivePriority` as still having main-phase actions (lands/`canAct`). That restored priority to a dead AP forever.
11. **Identical-token SBA / patch cost:** `applyStateBasedActions` memos `getEffectiveStatsForSBA` via `canBatchIdenticalTokenPt` / `identicalTokenPtFingerprint` (skips per-permanent temp P/T); `snapshotBattlefieldPermanentReplayPatches` / diff share clones across identical swarm fields.

### Earlier smoke trail (kept for history)

Paused pre-fix gate at 119/320 with stall ~23%. Smoke b3–b6 on shards 0–23 drove stall from ~12.5% → **0%** (b6) via attack-declare fallbacks, large-board combat fast-path/sticky, empty-stack combat quiet pass, canAct short-circuit, and planner time budgets. Harness: `maxWallClockMs = MAX_TURNS*40s`, turn-stall pauses while stack/resolution busy, `stallReason` on rows.

### Stall investigation landed during the full gate

1. Main-phase control-flow casts note actions + reschedule (hit `MAX_MAIN_ACTIONS`).
2. Attack declare fallbacks: never silent-return on goad / must-attack; force-mark `attackersDeclaredBy` as last resort.
3. Stale `permanent.attacking` shortcut removed.
4. v2 `planAttacks` skipped on large boards / slow clocks → v0 / fast planner.
5. Large-board combat fast-path + sticky (`attackPlannerFast.ts`, `combatDecisionSticky.ts`).
6. Empty-stack non-declare combat skips response enum + fast-pass.
7. Large-block cheap eval (no per-blocker `evaluateCombatValue` before the large-combat gate).
8. MAIN1 large-board `canAct` untapped-mana short-circuit.
9. AI spell-payment simulation clones re-prime `_derivedContinuousEffects` (JSON clone drop); oracle normalisers memoized — cleared shard-28-class tick-timeouts.

## Next (post-FAIL)

1. Strength work before any re-gate: attack/block/turn planner quality, large-board v2→v0 fallbacks, evaluator fit.
2. Do **not** change the live `AI_BRAIN` default until a re-gate shows a clear edge over v1 (and preferably over v0).

## Planners shipped behind v2

| Task | Module |
| --- | --- |
| P2-5 | `rules-engine/src/ai/attackPlanner.ts` / `attackPlannerFast.ts` + `combatDecisionSticky.ts` |
| P2-6 | `rules-engine/src/ai/blockPlanner.ts` |
| P2-7 | `rules-engine/src/ai/turnPlanner.ts` + `server/.../aiTurnPlanHook.ts` |
