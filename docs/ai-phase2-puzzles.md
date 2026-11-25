# AI Phase 2 puzzles (P2-4)

Catalogue: **36** puzzles (12 from P0-5 + 24 Phase 2 drafts).  
Held out (skipped unless `AI_PUZZLE_INCLUDE_HELD_OUT=1`): **L3, C2, C4, T1, M1, M4, B2, S3**.

Answers follow the plan appendix; held-out set is the plan’s suggested set.

## Baseline pass counts (held-out excluded → 28 runnable)

| Brain | Passed (28 / held-out off) | Passed (36 / held-out on) | Notes |
| --- | --- | --- | --- |
| v0 | **19/28** | **26/36** | MAIN1 step fix unblocks sequencing |
| v1 | — | **27/36** | `out/puzzles-v1-heldout.json` |
| v2 | **25/28** | **36/36** | attack + block + turn planners + hold-counter stack policy |

Combat fixtures honor `AI_BRAIN` / `decideAttackers` / `decideBlockers`. Priority fixtures use shared `puzzleGameActionMocks` and `step: MAIN1` so `canAct` allows sorcery-speed casts.

v2 clears lethal/crack-back/target/block/sequencing/hold-counter puzzles via `planAttacks` / `planBlocks` / `planTurn` / `hold_counter_for_bigger`. Remaining knownFailing gaps for weaker brains: C1 full hold, P-no-self-wipe (v0).

## P2-7 turn planner

- Pure search: `rules-engine/src/ai/turnPlanner.ts` (`planTurn`, 13 unit tests)
- Server hook: `server/src/socket/ai-handlers/aiTurnPlanHook.ts` (reorders main-phase candidates behind `v2`)
- Lands still play before the planner; one planned cast per priority window
