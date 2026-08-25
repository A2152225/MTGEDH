# Split wave 11 — unused overs

Playbook: `.cursor/skills/split-ts-module/SKILL.md`. Ceiling: **40960 bytes**.
Keep peeling one parent until it is under 40 KB. Coordinator owns `docs/mtg-logic-module-map.md`.

These eight are disjoint. One writer per parent.

| Chat | Parent now | First cluster |
| --- | --- | --- |
| BM | `triggers/turn-phases.ts` **37.4 KB** (done) | `detectEndStepTriggers` (5.6 KB) then precombat/postcombat/draw/untap families |
| BN | `triggers/card-data-tables.ts` **39.1 KB** (done) | existing `KNOWN_*` tables only — **do not add** new card-name rows |
| BO | `dungeon-effects.ts` **33.6 KB** (done) | `applyAutomaticDungeonRoomTokenEffects` then prompt-step builders |
| BP | `upkeep-triggers.ts` **19.0 KB** (done) | `detectUpkeepTriggers` (18.9 KB) |
| BQ | `stackResolvePermanentEntryUtils.ts` **34.0 KB** (done) | `queueMutateTriggeredAbilities` then `resolvePermanentSpellBattlefieldEntry` (28.8 KB) |
| BR | `triggeredAbilitiesEventDetection.ts` **39.7 KB** (done) | split `detectTriggeredAbilityEvent` (whole file) by if-chain — **do not move it whole** |
| BS | `triggers/zone-change.ts` **32.3 KB** (done) | `detectExiledFromBattlefieldTriggers` then `detectPutIntoGraveyardTriggers`; folder is `zone-change-handlers/` |
| BT | `executeSpellEffect.ts` **3.0 KB** (done) | `executeSpellEffect` (34.1 KB) if leaf stays under 40KB after header; parent has a **BOM** |

Wave 11 complete. Next unused overs: `docs/split-handoff-wave-12.md`.

**Bespoke tables (BN):** extract existing `KNOWN_*` consts only. Do not add card-name rows.

**Zone-change (BS):** `zone-changes.ts` is a different barrel (death/ETB/attack re-exports). Never create `triggers/zone-change/` beside `zone-change.ts`.
