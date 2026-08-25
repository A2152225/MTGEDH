# Split wave 7 — unused overs

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns `docs/mtg-logic-module-map.md`.

These eight are disjoint. One writer per parent.

| Chat | Parent now | First cluster |
| --- | --- | --- |
| AF | `socket/deck.ts` **36.0 KB** (done) | `applyConfirmedImport` then nested import/save sockets; do not move `registerDeckHandlers` whole |
| AG | `counters_tokens.ts` **24.6 KB** (done) | death-stack helpers, then `createToken` / `movePermanentToGraveyard` / `runSBA` (do not pack over 40KB) |
| AH | `mana-check.ts` **3.6 KB** (done) | `getAvailableMana` then `canPayManaCostWithAvailableSources` + exclusive helpers |
| AJ | `mana-abilities.ts` **38.4 KB** (done) | `getManaAbilitiesForPermanent` (32.2 KB) then `getCreatureCountManaAmount` (24.9 KB) |
| AK | `oracleIRExecutorTokenStepHandlers.ts` **25.0 KB** (done) | copy-token source / add-to-battlefield helpers; do not move `applyCreateTokenStep` whole if leftover stays a dispatcher |
| AL | `state/utils.ts` **35.3 KB** (done) | `calculateVariablePT` then life-gain / P/T-bonus families |
| AM | `replacementEffectSpec.ts` **39.5 KB** (done) | oracle template tables by replacement kind, then `evaluateReplacementEffectSpec` if still needed |
| AN | `oracleIRExecutorPlayerUtils.ts` **38.2 KB** (done) | `resolvePlayers` / look-select / discard-mana families |

Skipped this wave: `client/src/App.tsx` and other UI. Next unused overs: `docs/split-handoff-wave-8.md`.

**Executor ledger (AK / AN and any later MainLoop peel):** do not change how `appliedSteps` records `conditional` wrappers. After inner or else steps fire, record those only; record the wrapper only when that branch applied nothing. See `oracleIRExecutorMainLoopLateSteps.ts` and `.cursor/rules/typescript-max-40kb-split.mdc`.
