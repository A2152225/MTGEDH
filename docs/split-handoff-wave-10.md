# Split wave 10 — unused overs

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns `docs/mtg-logic-module-map.md`.

These eight are disjoint. One writer per parent.

| Chat | Parent now | First cluster |
| --- | --- | --- |
| BE | `oracleIRExecutorModifyPtStepHandlers.ts` **25.4 KB** (done) | `resolveReferenceScalerScale` (19.9 KB) then `applyModifyPtStep` (18.6 KB) |
| BF | `actions/triggersHandler.ts` **39.0 KB** (done) | `findTriggeredAbilities` / `checkStepTriggers` then dies/ETB/cast families; grep dual-copy vs `triggers/` |
| BG | `oracleTextParser.ts` **33.0 KB** (done) | `parseOracleText` / `parseActivatedAbility` then replacement-effect parse |
| BH | `server/src/rules-engine/staticEffects.ts` **28.9 KB** (done) | `KNOWN_STATIC_EFFECT_CARDS` then split `computeContinuousEffects` (38.5 KB) by phase — do not pack if the leaf would exceed 40KB |
| BI | `oracleIRExecutorDamageStepHandlers.ts` **28.3 KB** (done) | `applyPreventDamageStep` (18.4 KB) then `applyDealDamageStep` (9.4 KB) |
| BJ | `oracleIRParserEffectImpulsePermission.ts` **26.7 KB** (done) | split `parseEffectLevelImpulsePermissionClause` (47.1 KB) by if-chain — do not move it whole |
| BK | `keyword-detection.ts` **31.9 KB** (done) | `TRIGGERED_KEYWORD_PATTERNS` then static / replacement / action tables |
| BL | `oracleIRParserLifeAndCombatClauses.ts` **0.1 KB** (done) | `tryParseLifeAndCombatClause` (32.9 KB) plus amount parsers |

Wave 10 complete. Next unused overs: `docs/split-handoff-wave-11.md`.

**Executor ledger (BE / BI):** do not change how `appliedSteps` records `conditional` wrappers. After inner or else steps fire, record those only; record the wrapper only when that branch applied nothing.
