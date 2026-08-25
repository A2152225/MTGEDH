# Split wave 9 — unused overs

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns `docs/mtg-logic-module-map.md`.

These eight are disjoint. One writer per parent.

| Chat | Parent now | First cluster |
| --- | --- | --- |
| AW | `oracleIR.ts` **1.0 KB** (done) | split `OracleEffectStep` union (~171-1853, 59.4 KB) by contiguous kind families — do not move the type whole |
| AX | `effectProgram.ts` **23.0 KB** (done) | `appendOracleStepToEffectProgram` then `runEffectProgram` / choice-event builders |
| AY | `effectProgramOracleRunner.ts` **38.8 KB** (done) | `createOracleIRChoiceEvent` (10.2 KB) then apply-* choice commands |
| AZ | `oracleIRExecutorCreatureStepUtils.ts` **14.0 KB** (done) | `resolveCreatureTargetIds` (15.5 KB) then `resolveSingleCreatureTargetId` (12.7 KB) |
| BA | `triggerEtbEntryEffects.ts` **2.9 KB** (done) | `triggerETBEffectsForToken` then `queueSelfETBTriggersForPermanent`; dual-copy `persistTriggeredAbilityPush` vs socket combat |
| BB | `CardAnalyzer.ts` **33.9 KB** (done) | `PATTERNS` / `BENEFICIAL_DEATH_CARDS` then indented class methods with `--allow-nested`; do not move the class whole |
| BC | `keyword-handlers.ts` **38.6 KB** (done) | attack-trigger `handle*` family; folder is `keyword-trigger-handlers/` (never `keyword-handlers/` beside the `.ts`) |
| BD | `oracleIRParserUtils.ts` **28.2 KB** (done) | split `parseQuantity` (41.4 KB) by if-chain phase — do not move it whole |

Skipped this wave: client UI, `shared/src/types.ts`. Next unused overs: `docs/split-handoff-wave-10.md`.

**Executor ledger (AZ and any MainLoop peel):** do not change how `appliedSteps` records `conditional` wrappers. After inner or else steps fire, record those only; record the wrapper only when that branch applied nothing.
