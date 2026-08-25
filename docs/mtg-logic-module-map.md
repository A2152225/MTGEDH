# MTG logic module map

Finder for agents and humans: **which module owns which mechanic**, so nobody opens a 1 MB parent to answer "where does discard resume live?".

- Size ceiling and split rules: `.cursor/rules/typescript-max-40kb-split.mdc`
- Extraction playbook and paste prompts: `.cursor/skills/split-ts-module/SKILL.md`
- Current byte sizes: `node tools/ts-logic-file-sizes.mjs` (add `--all`, `--top N`, `--scope <dir>`, `--json`)

**Siblings** (all under ~40KB; coordinator owns every `docs/mtg-logic-module-map*.md`):

| File | Contents |
| --- | --- |
| [`mtg-logic-module-map.md`](mtg-logic-module-map.md) | Index: how-to-update, naming, triggers leftover, game-actions leftover, other leftover notes |
| [`mtg-logic-module-map-resolution.md`](mtg-logic-module-map-resolution.md) | Socket resolution |
| [`mtg-logic-module-map-executor.md`](mtg-logic-module-map-executor.md) | Oracle IR executor |
| [`mtg-logic-module-map-server-spell.md`](mtg-logic-module-map-server-spell.md) | Server spell routing |
| [`mtg-logic-module-map-extract-families.md`](mtg-logic-module-map-extract-families.md) | Extract-family parent inventory |
| [`mtg-logic-module-map-extract-families-handlers.md`](mtg-logic-module-map-extract-families-handlers.md) | Handler folders through targeting / static effects / mana |
| [`mtg-logic-module-map-extract-families-handlers-late.md`](mtg-logic-module-map-extract-families-handlers-late.md) | Handler folders from AutomationService onward |
| [`mtg-logic-module-map-client.md`](mtg-logic-module-map-client.md) | Client UI extract families + `shared/src/types-handlers/` |

## How to update

**Solo extract:** at the end of the session, add or edit one row: new module, the parent it left, and its main exported entry points.

**Parallel wave:** extract chats must **not** edit this file or its siblings (`docs/mtg-logic-module-map-*.md`). They paste **owed rows** in the wrap-up. The coordinator chat merges those rows after the parent is done (or after a safe abort). Do not copy them by hand into a second extract prompt.

The index plus siblings track extract families from the Campaign 0 inventory plus Campaigns A–H and later waves. Rows marked *(exports TBD)* get filled in by the session that next touches that module.

## Naming and barrels (summary)

| Layer | File | Job |
| --- | --- | --- |
| Public / compatibility barrel | `X.ts` (e.g. `resolution.ts`, `triggered-abilities.ts`) | Stable import path for sockets, GameManager, tests. Keeps `from "./resolution.js"` working. |
| Internal / agent TOC barrel | `X-handlers/index.ts` (e.g. `resolution-handlers/index.ts`) or the existing `triggers/index.ts` | Tiny named-re-export table of contents for extracted modules. |

**Never `X.ts` and `X/index.ts` in the same directory** — module resolution is ambiguous. The implementation folder gets a different name: `resolution-handlers/`, `game-actions-handlers/`, `triggers/`.

## Socket resolution

See [`mtg-logic-module-map-resolution.md`](mtg-logic-module-map-resolution.md).

## Triggered abilities

- Public leftover: `server/src/state/modules/triggered-abilities.ts` (**35.8 KB**, under ceiling). Remaining unique detectors (`analyzeCardTriggers`, `detectDiscardTriggers`, `detectTargetedTriggers`) can move later.
- Internal TOC: `server/src/state/modules/triggers/index.ts`. This folder is the schema; never add `triggeredAbilitiesXxx.ts` prefixes.
- **Death / ETB dual copies reconciled:** leftover `detectDeathTriggers` / `detectETBTriggers` / `getETBTriggersForPermanent` re-export from `triggers/zone-changes.ts`, which re-exports the live bodies in `death-detection.ts` / `etb-detection.ts`. **One** `export function` each. Do not create a third copy.
- **Death emission dual copies reconciled:** leftover `getDeathTriggers` / `getDeathTriggersForCreature` / `processUndyingPersist` / `getPlayersWhoMustSacrifice` re-export from `zone-changes.js`; live bodies in `death-emission.ts` (+ helpers). **One** `export function` each.
- **ETB untap / auto-sacrifice dual copies reconciled:** leftover `detectETBUntapEffects` / `getETBUntapEffects` / `applyETBUntapEffect` / `checkETBAutoSacrifice` re-export from `zone-changes.js`; live bodies in `etb-untap.ts`. **One** `export function` each.
- **Attack dual copies reconciled:** leftover `detectAttackTriggers` re-exports from `triggers/zone-changes.js`; live body in `attack-detection.ts` (+ generic/watchers/state). `combat.ts` re-exports the leaf. **One** `export function`.
- **`getAttackTriggersForCreatures` dual copies reconciled:** live body in `attack-triggers-for-creatures.ts` (production combat implementation; leftover simpler copy replaced). `combat.ts` and leftover re-export. **One** `export function`.
- Folder members under ceiling: `turn-phases.ts` is **37.4 KB** (done). `zone-change.ts` is **32.3 KB** (done). `card-data-tables.ts` is **39.1 KB** (done). `combat.ts` is **30.1 KB** (done). `intervening-if.ts` is **12.6 KB** (done). `zone-changes.ts` is now ~1.9 KB (re-export barrel).

| Module (`triggers/`) | Owns |
| --- | --- |
| `detectorTriggeredAbility.ts` | Leftover detector `TriggeredAbility` wire type (distinct from skinny `triggers/types.ts`). |
| `cardNameRegexAlternatives.ts` | Card-name regex variants for detectors. Entry: `buildCardNameRegexAlternatives`. |
| `enters-or-other-event-prefix.ts` | Compound "enters or \<event\>" prefix. Entry: `ENTERS_OR_OTHER_EVENT_PREFIX`. |
| `death-detection.ts` (+ `death-detection-early/mid/late/state.ts`) | `detectDeathTriggers`. Pattern runs mutate shared `DeathDetectionState`. |
| `death-emission.ts` | Leftover-merged death emission: `getDeathTriggers`, `getDeathTriggersForCreature`, `processUndyingPersist`, `getPlayersWhoMustSacrifice`. Re-exported through `zone-changes.ts` and leftover. |
| `death-emission-helpers.ts` | Leftover-rich `DeathTriggerResult` plus detector-to-emitter adapters used by `getDeathTriggers`. |
| `etb-detection.ts` (+ `etb-detection-early/mid/late/helpers/state.ts`) | `detectETBTriggers`, `getETBTriggersForPermanent` (detector wire type, not skinny). |
| `hideaway-ability.ts` | `detectHideawayAbility`. |
| `detect-target-type.ts` | `detectTargetType`. |
| `etb-untap.ts` | Leftover-merged ETB untap + auto-sacrifice: `detectETBUntapEffects`, `getETBUntapEffects`, `applyETBUntapEffect`, `checkETBAutoSacrifice`, `ETBUntapEffect`. Re-exported through `zone-changes.ts` and leftover. |
| `attack-detection.ts` (+ generic/watchers/reflexive/state) | Live `detectAttackTriggers`. Leftover and `combat.ts` re-export. Reflexive `when you do` / `when they do` / exert riders are detection-only (`isReflexiveDelayedDoTriggerType`); combat does not auto-queue them on declare attackers. |
| `ltb-detection.ts` | Leftover LTB detector. |
| `ability-activated-detection.ts` | Leftover ability-activated **detection** (not emission `ability-activated.ts`). |
| `combat-damage-detection.ts` (+ early/mid/late/state) | Leftover combat-damage detect. `combat.ts` re-exports. |
| `tap-detection.ts` | Leftover tap detect. `tap-untap.ts` re-exports. |
| `spell-cast-detection.ts` (+ mid/late/state/helpers/effect-text/trigger-type) | Leftover `detectSpellCastTriggers`. Also `spell-cast-get-triggers.ts`, `spell-cast-untap-detection.ts`. |
| `planeswalker-loyalty.ts` / `special-card-effect-tables.ts` / `static-special-effect-detectors.ts` / `mimic-vat-modal-and-storm.ts` | Leftover unique bottom tables/detectors. |
| `dealt-damage-detection.ts` / `status-keyword-detection.ts` / `status-event-detection.ts` / `returned-to-hand-detection.ts` | Leftover unique detectors. |
| `block-detection.ts` + `block-trigger-type.ts` | Leftover `detectBlockTriggers`. |
| `untap-detection.ts` | Leftover untap detect. Folder `tap-untap.ts` may still have a copy — dual-copy grep before deleting. |
| `attachment-attack-detection.ts` | Live attachment-attack detect/get. `combat.ts` re-exports (combat copy deleted). |
| `attack-triggers-for-creatures.ts` | Live `getAttackTriggersForCreatures` (production body from `combat.ts`; leftover dual-copy replaced). `combat.ts` and leftover re-export. |
| `enchanted-by-aura.ts` | From `combat.ts`. `isEnchantedByAuraYouControl`. |
| `combat-triggered-ability.ts` | From `combat.ts`. `CombatTriggeredAbility`. |
| `trigger-doublers.ts` | From `combat.ts`. `detectTriggerDoublers`, `applyTriggerDoublers`, `pushTriggerDoublerCopies`, `playerHasDungeonRoomAbilityDoubler`, `TriggerDoublerEventContext`. |
| `attack-watcher-queue.ts` | From `combat.ts`. `planAttackWatcherQueue`, `isAttackWatcherTriggerType`. |
| `combat-attack-trigger-helpers.ts` | From `combat.ts`. `mergeCombatTriggerValue`, `extractCommanderOwnedGrantedAbilityTexts`. |
| `card-data-tables.ts` | Public `KNOWN_*` trigger lookup tables. `KNOWN_TAP_UNTAP_ABILITIES` re-exported from `card-data-tables-handlers/`. **39.1 KB** (done). Never create `card-data-tables/` beside the `.ts`. Extract existing tables only — do not add card-name rows. |
| `card-data-tables-handlers/index.ts` | Internal TOC barrel. Named re-exports only. Leaves must not import the parent or this index. |
| `card-data-tables-handlers/cardDataTablesTapUntapAbilities.ts` | From `card-data-tables.ts`. `KNOWN_TAP_UNTAP_ABILITIES`. Parent re-exports. |
| `zone-change.ts` | Public exile-from-battlefield get/queue, put-into-graveyard-from-anywhere, left-graveyard. **32.3 KB** (done). Distinct from `zone-changes.ts` (death/ETB/attack barrel). Never create `triggers/zone-change/` beside the `.ts`. |
| `zone-change-handlers/index.ts` | Internal TOC for extracts from `triggers/zone-change.ts`. Named re-exports only. Leaves must not import the parent or this index. |
| `zone-change-handlers/exileFromBattlefieldDetection.ts` | From `triggers/zone-change.ts`. `ExiledFromBattlefieldTrigger`, `detectExiledFromBattlefieldTriggers`. Parent re-exports. Distinct from death/ETB/attack. |
| `turn-phases.ts` | Public turn-phase detectors/emitters. **37.4 KB** (done). `EndStepTrigger` and `detectEndStepTriggers` re-exported from `turn-phases-handlers/`. Never create `turn-phases/` beside the `.ts`. |
| `turn-phases-handlers/index.ts` | Internal TOC barrel. Named re-exports only. Leaves must not import the parent or this index. |
| `turn-phases-handlers/turnPhaseTriggerTypes.ts` | From `turn-phases.ts`. `EndStepTrigger`. Parent re-exports. |
| `turn-phases-handlers/turnPhaseActivePermanentFace.ts` | From `turn-phases.ts`. `getActivePermanentCardFace`. |
| `turn-phases-handlers/turnPhaseEffectChoiceHelpers.ts` | From `turn-phases.ts`. `detectRequiresChoice`, `detectAffectsAllPlayers`. |
| `turn-phases-handlers/turnPhaseEndStepTriggers.ts` | From `turn-phases.ts`. `detectEndStepTriggers`. Parent re-exports. |

## Oracle IR parser / postprocess (`rules-engine/src/`)

- `oracleIRParserPostprocess.ts` is a **12.5 KB barrel** (named re-exports + a few leftover imports). All `oracleIRParserPostprocess*.ts` siblings are under the ceiling (largest: `oracleIRParserPostprocessGapClosureStepRepairs.ts` at 37.0 KB). Add a new family file; do not append to a sibling near 36–40 KB.
- `oracleIRParser.ts` is a **0.1 KB barrel**: `export { parseOracleTextToIR } from './oracleIRParserParseOracleTextToIR'`.
- `oracleIR.ts` is a **1.0 KB barrel**: re-exports shared types + `OracleEffectStep` (`A | B | C`) plus leftover `OracleIRAbility` / `OracleIRResult`. Never create `oracleIR/` beside `oracleIR.ts`.
- Keep the `oracleIRParser*` / `oracleIRExecutor*` prefixes. No folder move until a parent is already a thin barrel.
- `oracleIRParserEffectImpulsePermission.ts` is a **26.7 KB** dispatcher (`parseEffectLevelImpulsePermissionClause` leftover early / from-among if-chain + late `tryParse` call). `oracleIRParserLifeAndCombatClauses.ts` is a **0.1 KB barrel** (`tryParseLifeAndCombatClause`; existing BOM kept — do not add another). `oracleIRParserUtils.ts` is a **28.2 KB** dispatcher (`parseQuantity` leftover numeric / late-reference if-chain + `parsePlayerSelector` / `splitIntoClauses` / `normalizeClauseForParse`). `oracleIRParserStaticAbilityClauses.ts` is a **33.1 KB** dispatcher (`tryParseStaticAbilityGrantClause` leftover if-chain + re-export of `tryParseRulesTextClause`). `oracleIRParserSimpleActionClauses.ts` is a **4.0 KB** dispatcher (`tryParseSimpleActionClause` + family `tryX`).

| Module | Left | Entry |
| --- | --- | --- |
| `oracleIRParserEffectClauseToStep.ts` | `oracleIRParser.ts` | `parseEffectClauseToStep` |
| `oracleIRParserAbilityMerges.ts` | `oracleIRParser.ts` | `mergeSplitChooseModeParsedAbilities` |
| `oracleIRParserImpulseExileTop.ts` | `oracleIRParser.ts` | impulse-exile-top parse (was a closure of `parseAbilityToIRAbility`) |
| `oracleIRParserExileTopOnlyLegacy.ts` | `oracleIRParser.ts` | exile-top-only legacy parse |
| `oracleIRParserAbilityToIR.ts` | `oracleIRParser.ts` | `parseAbilityToIRAbility` (takes `parseOracleTextToIR` as a parameter — do not import the public parent) |
| `oracleIRParserParseOracleTextToIR.ts` | `oracleIRParser.ts` | `parseOracleTextToIR` |
| `oracleIRParserParseOracleTextToIRLatePasses.ts` | `oracleIRParser.ts` | late passes of `parseOracleTextToIR` |
| `oracleIRParserSimpleActionHelpers.ts` / `…EarlyClauses.ts` / `…AddManaChoice.ts` / `…DrawTurn.ts` / `…CounterSearch.ts` / `…DiscardVote.ts` | `oracleIRParserSimpleActionClauses.ts` | Family `tryX` runs of `tryParseSimpleActionClause`. Leaves take parse args; null = fall through. Recursion is a `parseRest` callback — do not import the parent. |
| `oracleIRParserEffectImpulsePermission-handlers/index.ts` | `oracleIRParserEffectImpulsePermission.ts` | Internal TOC barrel. Named re-exports only. Never create `oracleIRParserEffectImpulsePermission/` beside the `.ts`. |
| `oracleIRParserEffectImpulsePermission-handlers/oracleIRParserEffectImpulsePermissionLateDurations.ts` | `oracleIRParserEffectImpulsePermission.ts` | Late next-turn / until-end / remains-exiled if-chain of `parseEffectLevelImpulsePermissionClause`. `undefined` = fall through. Do not import the parent. |
| `oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityGrantParseUtils.ts` | `oracleIRParserStaticAbilityClauses.ts` | `WithMeta` plus keyword-list, signed P/T, and graveyard grant parse helpers. |
| `oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityGrantEarlyClauses.ts` | `oracleIRParserStaticAbilityClauses.ts` | First if-chain of `tryParseStaticAbilityGrantClause` (permission / P/T / quoted grant). `undefined` = fall through; `null` = abort the whole grant parse. Do not import the parent. |
| `oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityRulesTextClause.ts` | `oracleIRParserStaticAbilityClauses.ts` | `tryParseRulesTextClause` (parent re-exports). |
| `oracleIRParserLifeAndCombatClauses-handlers/oracleIRParserLifeAndCombatParseUtils.ts` | `oracleIRParserLifeAndCombatClauses.ts` | `parseDamageAmount`, `parseLifeChangeAmount`, damage-clause subject/amount patterns, `isDamageAmountDescriptor`, `shouldSkipGenericDamageSource`, `normalizeDamageClauseForParse`. Do not import the parent. |
| `oracleIRParserLifeAndCombatClauses-handlers/oracleIRParserLifeAndCombatClause.ts` | `oracleIRParserLifeAndCombatClauses.ts` | `tryParseLifeAndCombatClause` (parent re-exports). **33.0 KB** — do not append. Never create `oracleIRParserLifeAndCombatClauses/` beside the `.ts`. |
| `oracleIRParserUtils-handlers/oracleIRParserUtilsQuantityEarlyReferences.ts` | `oracleIRParserUtils.ts` | First if-chain of `parseQuantity` (reference-amount / object-stat / phrase). Recursion is a `parseRest` callback — do not import the parent. `null` = fall through. |
| `oracleIR-handlers/oracleIRSharedTypes.ts` | `oracleIR.ts` | `OracleQuantity`, `OraclePlayerSelector`, `OracleObjectSelector`, `OracleScaler`, `OracleClauseCondition`, `OracleGraveyardAdditionalCost`, `OracleBattlefieldObjectCondition`, `OracleZone`. |
| `oracleIR-handlers/oracleIREffectStepA.ts` | `oracleIR.ts` | `OracleEffectStepA` (`grant_next_spell_cost_reduction` … `fateseal`). Nested `steps` use the full `OracleEffectStep` alias. Do not import the parent or index. |
| `oracleIR-handlers/oracleIREffectStepB.ts` | `oracleIR.ts` | `OracleEffectStepB` (`learn` … `prevent_damage`). |
| `oracleIR-handlers/oracleIREffectStepC.ts` | `oracleIR.ts` | `OracleEffectStepC` (`damage_cant_be_prevented` … `unknown`). |
| `oracleIR-handlers/oracleIREffectStep.ts` | `oracleIR.ts` | Public `OracleEffectStep` alias (`A \| B \| C`). Parent re-exports. |

Guard-run hoists out of `parseCurrentResidualUnknownStep` live in `oracleIRParserPostprocessResidual*Guards.ts` (static grant, entry/permission, text/catalog, combat/counter/payment, perpetual/secret, reflexive, mana/phasing/attach, number-change/group P/T, named-mode search, attacker/token, self-ref/library-order, ward/evidence). `parseStructuredTriggerResidualGrant` lives in `oracleIRParserPostprocessTriggerResidual*Pt*.ts`. Reminder/platform text is `oracleIRParserPostprocessCurrentBatchReminder*.ts`.

## Oracle IR executor (`rules-engine/src/`)

See [`mtg-logic-module-map-executor.md`](mtg-logic-module-map-executor.md).

## Server spell routing (`server/src/state/modules/`)

See [`mtg-logic-module-map-server-spell.md`](mtg-logic-module-map-server-spell.md).

## Other server logic (extract families started)

Parent inventory table and `*-handlers/` sections live in
[`docs/mtg-logic-module-map-extract-families.md`](mtg-logic-module-map-extract-families.md).
Coordinator merges owed extract-family rows there.

## Oracle IR parser postprocess extracts (`rules-engine/src/`)

`oracleIRParserPostprocess.ts` is the public barrel. Family siblings (all under 40 KB):

| Module | Owns |
| --- | --- |
| `oracleIRParserPostprocessGraveyardCastPermission.ts` | GY-cast permission expansions. |
| `oracleIRParserPostprocessDrawDiscardStepSplitters.ts` | Draw/discard compound splitters. |
| `oracleIRParserPostprocessLifeDestroyLibrarySearchSteps.ts` | Life / destroy / library-search step repairs. |
| `oracleIRParserPostprocessKeywordStaticGrantSteps.ts` | Keyword static grants (annihilator/ward metadata). |
| `oracleIRParserPostprocessGraveyardAdditionalCostPermission.ts` | GY additional-cost permission. |
| `oracleIRParserPostprocessExileAndGraveyardPermissionModifiers.ts` | Exile/GY permission modifiers. |
| `oracleIRParserPostprocessCopySpellTailHelpers.ts` / `…CopySpellUnknownSteps.ts` | Copy-spell tail + unknown-step lowering. |
| `oracleIRParserPostprocessKeywordReminderPrunes.ts` | Keyword reminder prunes. |
| `oracleIRParserPostprocessGraveyardKeywordExpansions.ts` | GY keyword expansions. |
| `oracleIRParserPostprocessTokenCreationMetadata.ts` | Token-create metadata. |
| `oracleIRParserPostprocessUnlessSacrificeConditionals.ts` | Unless-sacrifice conditionals. |
| `oracleIRParserPostprocessDrawLifeDestroyMetadata.ts` | Draw/life/destroy metadata. |
| `oracleIRParserPostprocessSacrificeCounterDamageMetadata.ts` | Sacrifice/counter/damage metadata. |
| `oracleIRParserPostprocessDieRollAndReplacementExpansions.ts` | Die-roll + replacement expansions. |
| `oracleIRParserPostprocessBattlefieldEntryAndTopLibraryFollowups.ts` | Battlefield-entry + top-library follow-ups. |
| `oracleIRParserPostprocessCompoundMoveZoneAndChoiceExpansions.ts` | Compound move-zone + choice expansions. |
| `oracleIRParserPostprocessVoteRestrictionAndEmblemExpansions.ts` | Vote restriction + emblem expansions. |
| `oracleIRParserPostprocessGapClosureStepRepairs.ts` | Gap-closure step repairs (37 KB — do not append). |
| `oracleIRParserPostprocessDiscardMillLifeStepSplitters.ts` | Discard/mill/life splitters. |
| `oracleIRParserPostprocessDynamicCounterRiders.ts` | Dynamic counter riders. |
| `oracleIRParserPostprocessMoveZoneCopyAndLandAnimationExpansions.ts` | Move-zone copy + land-animation expansions. |
| `oracleIRParserPostprocessKeywordActionUnknownSteps.ts` | Keyword-action unknown-step lowering. |
| `oracleIRParserPostprocessAmassDiscoverConniveRecruitKeywords.ts` | Amass / discover / connive / recruit. |
| `oracleIRParserPostprocessClashScryExploreReminderPrunes.ts` | Clash/scry/explore reminder prunes. |
| `oracleIRParserPostprocessVanishingModularStaticPrunes.ts` | Vanishing/modular static prunes. |
| `oracleIRParserPostprocessReminderPlatformTextPredicates.ts` | Reminder/platform-only text predicates. |
| `oracleIRParserPostprocessCrewChampionLateKeywordPrunes.ts` | Crew/champion late keyword prunes. |
| `oracleIRParserPostprocessTriggerEffectFragmentPrunes.ts` | Trigger-effect fragment prunes. |
| `oracleIRParserPostprocessFutureSpellAndTokenReminderPrunes.ts` | Future-spell / token reminder prunes. |
| `oracleIRParserPostprocessDeterministicBodyAndConditionalExpansions.ts` | Deterministic body + conditional expansions. |
| `oracleIRParserPostprocessResidualUnknownLowering.ts` | Residual unknown-step lowering (head/tail of the elephant). |
| `oracleIRParserPostprocessInsteadReplacementSteps.ts` | `repairIntraAbilityInsteadConditionalSteps` — fold "create N of those tokens instead" into the base create. |
| `oracleIRParserPostprocessQuotedAbilityRiders.ts` | `extractQuotedAbilityRiderSteps` — lift quoted riders and rewrite leftover unknown residuals. |
| `oracleIRParserPostprocessCurrentBatchSurfaces.ts` | `repairCurrentBatchSurfaceSteps` — restore executable step kinds swallowed by residual rewrites. |
| `oracleIRExecutorExileOneOfThemHandlers.ts` | From `oracleIRExecutorSpecialTargetHandlers.ts`. `tryApplyExileOneOfThemLookedCards`. |
| `oracleIRExecutorExileLookedContextualHandlers.ts` | From `oracleIRExecutorSpecialTargetHandlers.ts`. `tryApplyExileLookedContextualStep`. |
| `oracleIRExecutorExilePileCounterAndTargetedHandlers.ts` | From `oracleIRExecutorSpecialTargetHandlers.ts`. `tryApplyExilePileCounterAndTargetedStep`. |

## Card data and SQLite connections (`server/src/services/`)

| Module | Owns |
| --- | --- |
| `localCardLookup.ts` | The `card_lookup` corpus connection, freshness check, and rebuild. `CARD_LOOKUP_SQLITE_FILE` picks the file; `CARD_LOOKUP_SQLITE_READONLY_FILE` names one path to open read-only with rebuild disabled. Entry points: `ensureLocalCardLookupIndexSync`, `lookupLocalCards`, `getLocalCardLookupDatabase`, `resetLocalCardLookupForTests`. |
| `oracleIrCompiledOverlayDatabase.ts` | The connection backing `oracle_ir_compiled_overlay`, the only table written at runtime. `ORACLE_IR_OVERLAY_SQLITE_FILE` moves overlays into their own database (tests use one per worker); unset, they stay in the card-lookup database. Entry points: `getCompiledOracleIROverlayDatabase`, `resetCompiledOracleIROverlayDatabaseForTests`. |
| `oracleIrCompiledOverlayStore.ts` | Overlay CRUD and envelope validation on top of that connection. |

Tests share the prebuilt 137 MB `server/data/card-lookup.sqlite` read-only rather than copying it per worker; see `server/tests/vitest.setup.ts`.

## Client (MTG logic only)

See [`mtg-logic-module-map-client.md`](mtg-logic-module-map-client.md).
