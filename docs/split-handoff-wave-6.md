# Split wave 6 — unused overs

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns `docs/mtg-logic-module-map.md`.

**R3 complete:** `interaction.ts` **34.1 KB**. Remaining chats are unused overs. One writer per parent.

| Chat | Parent now | First cluster |
| --- | --- | --- |
| Y | `combat.ts` 104.4 KB | `executeDeclareAttackers` then nested `declareAttackers` / combat-control sockets |
| Z | `oracleIRExecutorSpecialTargetHandlers.ts` 143.6 KB | split leftover `trySpecialExileStep` (39.4 KB — do not move whole); no new `BatchNNN`/`Bulk` names |
| AA | `oracleIRExecutorConditionalStepSupport.ts` 133.8 KB | split `evaluateConditionalWrapperCondition` (94.7 KB) by clause family |
| AB | `oracleIRExecutorConditionalStepSupportExtended.ts` 174.3 KB | split `evaluateExtendedConditionalClause` (123 KB); keep `evaluateThisWayClause` as its own leaf |
| AC | `oracleIRExecutorMoveZoneStepHandlers.ts` 71.7 KB | leftover `applyMoveZoneStep` after existing `tryApplyMoveZoneGuardsFrom*` |
| AD | `server/src/rules-engine/targeting.ts` 156.1 KB | `parseTargetRequirements` then split `categorizeSpellWithoutPrimaryRetirement` (89.8 KB) |
| AE | `game-state-effects.ts` 136.3 KB | create `game-state-effects-handlers/`; win / land-play / top-library / mill-replacement families |

Skipped this wave: `client/src/App.tsx` and other UI, `RulesEngineAdapter.ts`, planeswalker `registry.ts`, `socket/deck.ts`, `counters_tokens.ts`, `mana-check.ts`, `oracleIRExecutorTokenStepHandlers.ts`.
