# AI Phase 2 puzzles (P2-4)

Catalogue: **36** puzzles (12 from P0-5 + 24 Phase 2 drafts).  
Held out (skipped unless `AI_PUZZLE_INCLUDE_HELD_OUT=1`): **L3, C2, C4, T1, M1, M4, B2, S3**.

Answers follow the plan appendix; held-out set is the plan’s suggested set.

## Baseline pass counts (held-out excluded → 28 runnable)

| Brain | Passed (28 / held-out off) | Passed (36 / held-out on) | Notes |
| --- | --- | --- | --- |
| v0 | **19/28** | **26/36** | MAIN1 step fix unblocks sequencing |
| v1 | — | **27/36** | `out/puzzles-v1-heldout.json` |
| v2 | **25/28** | **35/36** | attack + block + turn planners (P2-5…P2-7); only P-hold-counter left |

Combat fixtures honor `AI_BRAIN` / `decideAttackers` / `decideBlockers`. Priority fixtures use shared `puzzleGameActionMocks` and `step: MAIN1` so `canAct` allows sorcery-speed casts.

v2 clears lethal/crack-back/target/block/sequencing puzzles via `planAttacks` / `planBlocks` / `planTurn`. Remaining gaps: C1 full hold, P-hold-counter-for-winner, P-no-self-wipe.

## P2-7 turn planner

- Pure search: `rules-engine/src/ai/turnPlanner.ts` (`planTurn`, 13 unit tests)
- Server hook: `server/src/socket/ai-handlers/aiTurnPlanHook.ts` (reorders main-phase candidates behind `v2`)
- Lands still play before the planner; one planned cast per priority window
