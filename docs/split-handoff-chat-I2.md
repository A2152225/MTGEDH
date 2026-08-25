# Split handoff - chat I2 (resolution.ts, continue)

## Session prompt (paste this)

```text
Read .cursor/skills/split-ts-module/SKILL.md and docs/split-handoff-chat-I2.md.
CONTINUE the same parent: server/src/socket/resolution.ts (now 177527 B / 173.4 KB).
Keep peeling until the parent is under 40960 bytes. Do not stop at a leaf count. Report leftover TOC
only if you must abort (ts-cluster-toc --min-bytes 2500). Do not edit the module map - report owed rows.
Do not Read all of resolution.ts. Cores stay: registerResolutionHandlers, handleStepResponse (dispatch),
handleTargetSelectionResponse (dispatch), handleOptionChoiceResponse (dispatch), handleAIResolutionStep,
sanitizeStepForClient.

Inventory:
  node tools/ts-cluster-toc.mjs server/src/socket/resolution.ts --min-bytes 2500
  node tools/ts-cluster-deps.mjs server/src/socket/resolution.ts START END
  node tools/ts-cluster-range-bytes.mjs server/src/socket/resolution.ts cluster=START-END

Already extracted - do not re-move: PLAYER_CHOICE, X_VALUE, TRIGGER_ORDER, explore/fight/tap/counters/etc.
Next clusters in order (each its own file, byte-copy --dry first):
1. handleExtortPaymentResponse (~3055-3149, 3.7 KB)
2. handleMutateTargetSelectionResponse (~4014-4188, 6.5 KB)
3. handleOptionalTriggeredAbilityChoiceResponse (~4326-4403) + handleRulesChoiceGroupResponse if small
4. applyCancelledResolutionStepSideEffects (~698-835) if it does not close over too many parent locals

Wire through resolutionHandlerDeps. Leaf must not import resolution.ts. Case break becomes return.
Do not grow near-40KB pre-complete validation siblings. No ts-morph / _refactor_scratch.
Typecheck server. Targeted vitest per cluster.
```
