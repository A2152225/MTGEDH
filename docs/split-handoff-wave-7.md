# Split wave 7 — unused overs

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns `docs/mtg-logic-module-map.md`.

These eight are disjoint. One writer per parent.

| Chat | Parent now | First cluster |
| --- | --- | --- |
| AF | `socket/deck.ts` 126.4 KB | `applyConfirmedImport` then nested import/save sockets; do not move `registerDeckHandlers` whole |
| AG | `counters_tokens.ts` 121.3 KB | death-stack helpers, then `createToken` / `movePermanentToGraveyard` / `runSBA` (do not pack over 40KB) |
| AH | `mana-check.ts` 114 KB | `getAvailableMana` then `canPayManaCostWithAvailableSources` + exclusive helpers |
| AJ | `mana-abilities.ts` 100.8 KB | `getManaAbilitiesForPermanent` (32.2 KB) then `getCreatureCountManaAmount` (24.9 KB) |
| AK | `oracleIRExecutorTokenStepHandlers.ts` 97.2 KB | copy-token source / add-to-battlefield helpers; do not move `applyCreateTokenStep` whole if leftover stays a dispatcher |
| AL | `state/utils.ts` 88.9 KB | `calculateVariablePT` then life-gain / P/T-bonus families |
| AM | `replacementEffectSpec.ts` 87.7 KB | oracle template tables by replacement kind, then `evaluateReplacementEffectSpec` if still needed |
| AN | `oracleIRExecutorPlayerUtils.ts` 83.7 KB | `resolvePlayers` / look-select / discard-mana families |

Skipped this wave: `client/src/App.tsx` and other UI, `RulesEngineAdapter.ts`, planeswalker `registry.ts`, `actions/combat.ts`, `zones.ts`, `graveyard-permissions.ts`, parser clause files.

**Executor ledger (AK / AN and any later MainLoop peel):** do not change how `appliedSteps` records `conditional` wrappers. After inner or else steps fire, record those only; record the wrapper only when that branch applied nothing. See `oracleIRExecutorMainLoopLateSteps.ts` and `.cursor/rules/typescript-max-40kb-split.mdc`.
