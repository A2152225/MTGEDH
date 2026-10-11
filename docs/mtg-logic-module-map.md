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

- Public leftover: `server/src/state/modules/triggered-abilities.ts` (**35.8 KB**, under ceiling). Remaining unique detectors (`analyzeCardTriggers`, `detectDiscardTriggers`, `detectTargetedTriggers`) can move later. `detectTargetedTriggers` optional 3rd `gameState` merges granted quotes (Kira / Opaline); emission in `triggers/targeted.ts` uses merged oracle and does not early-return on blank printed text.
- Internal TOC: `server/src/state/modules/triggers/index.ts`. This folder is the schema; never add `triggeredAbilitiesXxx.ts` prefixes.
- **Death / ETB dual copies reconciled:** leftover `detectDeathTriggers` / `detectETBTriggers` / `getETBTriggersForPermanent` re-export from `triggers/zone-changes.ts`, which re-exports the live bodies in `death-detection.ts` / `etb-detection.ts`. **One** `export function` each. Do not create a third copy.
- **Death emission dual copies reconciled:** leftover `getDeathTriggers` / `getDeathTriggersForCreature` / `processUndyingPersist` / `getPlayersWhoMustSacrifice` re-export from `zone-changes.js`; live bodies in `death-emission.ts` (+ helpers). **One** `export function` each.
- **ETB untap / auto-sacrifice dual copies reconciled:** leftover `detectETBUntapEffects` / `getETBUntapEffects` / `applyETBUntapEffect` / `checkETBAutoSacrifice` re-export from `zone-changes.js`; live bodies in `etb-untap.ts`. **One** `export function` each.
- **Attack dual copies reconciled:** leftover `detectAttackTriggers` re-exports from `triggers/zone-changes.js`; live body in `attack-detection.ts` (+ generic/watchers/state). `combat.ts` re-exports the leaf. **One** `export function`.
- **`getAttackTriggersForCreatures` dual copies reconciled:** live body in `attack-triggers-for-creatures.ts` (production combat implementation; leftover simpler copy replaced). `combat.ts` and leftover re-export. **One** `export function`.
- Folder members under ceiling: `turn-phases.ts` is **31.8 KB** (untap-step effects extracted). `zone-change.ts` is **32.3 KB** (done). `card-data-tables.ts` is **39.1 KB** (done). `combat.ts` is **30.1 KB** (done). `intervening-if.ts` is **12.6 KB** (done). `zone-changes.ts` is now ~1.9 KB (re-export barrel).

| Module (`triggers/`) | Owns |
| --- | --- |
| `detectorTriggeredAbility.ts` | Leftover detector `TriggeredAbility` wire type (distinct from skinny `triggers/types.ts`). |
| `detectorGrantedOracle.ts` | Merge printed oracle with continuous granted trigger/activated lines (`mergeDetectorOracleWithContinuousGrants`). Attack / ETB / death / LTB / combat-damage / dealt-damage / targeted / tap / counter-placed / spell-cast / block / upkeep detectors use this when `gameState` is passed so quoted "have …" abilities fire on recipients. `annotateFirstTimeEachTurnOracle` strips "for the first time each turn" / "during your turn" so existing when-clauses match, and stamps `oncePerTurn` from "this ability triggers only once each turn" (Kira / Danny / Katara / Dionus / Cursed Wombat / Folk Hero). |
| `cardNameRegexAlternatives.ts` | Card-name regex variants for detectors. Entry: `buildCardNameRegexAlternatives`. |
| `enters-or-other-event-prefix.ts` | Compound "enters or \<event\>" prefix. Entry: `ENTERS_OR_OTHER_EVENT_PREFIX`. |
| `death-detection.ts` (+ `death-detection-early/mid/late/state.ts`) | `detectDeathTriggers`. Pattern runs mutate shared `DeathDetectionState`. Late: `any_typed_creature_dies` / `typed_opponent_creature_dies` (Hungry Lynx / Hansk), `named_counter_dies`, `opponent_commander_dies`, list-typed `another_multi_typed_creature_dies`. |
| `death-emission.ts` | Leftover-merged death emission: `getDeathTriggers`, `getDeathTriggersForCreature`, `processUndyingPersist`, `getPlayersWhoMustSacrifice`. Re-exported through `zone-changes.ts` and leftover. Also fires delayed `WHEN_DIES` watchers via `delayed-dies-watchers.ts`. |
| `death-emission-helpers.ts` | Leftover-rich `DeathTriggerResult` plus detector-to-emitter adapters used by `getDeathTriggers`. `getPermanentRulesTextFragments` includes continuous granted quotes when `gameState` is passed (self-dies live scan). Watcher subject extraction also uses those fragments so blank commanders with Agent of the Iron Throne still match. `put_into_graveyard_from_battlefield` may fire when the source itself dies (you-control, not “another”). Fully parsed dies subjects go through `rules-engine/src/triggerCondition/`. Subtypes, `with`/`without` keywords, and `this or another` parse there. `appendParsedDiesTriggerLines` and the ETB watcher loop queue a `Whenever <subject> dies|enters` sentence when the family regex did not already queue that effect. `triggerConditionFamilyMatch.ts` is the live adapter for ETB type phrases, attack subjects, block watchers, tap/untap, spell-cast type/zone, search, shuffle, pay life, tokens, counter removed, exile, and graveyard entry or exit. Phase whose-turn for controller / each / opponent uses the same matcher. Plan: `docs/trigger-condition-ir-plan.md`. |
| `delayed-dies-watchers.ts` | Spell-created `WHEN_DIES` delayed triggers on `state.delayedTriggerRegistry` (Reckless Blaze / Skeletonize “dealt damage this way dies this turn”). Entry: `collectDelayedDiesWatcherTriggers`. |
| `delayed-end-step-watchers.ts` | Spell/ability-created `NEXT_END_STEP` delayed triggers on `state.delayedTriggerRegistry` (Swooping Pteranodon “target land deals 3 damage to that creature”). Entry: `collectDelayedEndStepRegistryTriggers`. Called from `getEndStepTriggers`. “At the beginning of the next end step” is a delayed rider (CR 603.7), not `detectEndStepTriggers`. Stamps `delayedAction` / bound ids from the registry so delayed destroy/exile/sacrifice use `applyDelayedCleanupTriggersFromMetadata`. |
| `delayed-end-combat-watchers.ts` | Spell/ability-created `END_OF_COMBAT` delayed triggers on `state.delayedTriggerRegistry` (Corrosive Ooze / Defiant Vanguard “destroy that creature at end of combat”). Entry: `collectDelayedEndOfCombatRegistryTriggers`. Called from `getEndOfCombatTriggers`. Printed “at end of combat” abilities stay in `end-combat.ts`; delayed riders are CR 603.7. |
| `delayed-registry-watcher-metadata.ts` | Bound-object ids + delayed destroy/exile/sacrifice stack fields for delayed-registry collectors. Entries: `readDelayedAntecedentIds`, `delayedCleanupStackFieldsFromRegistry`. |
| `etb-detection.ts` (+ `etb-detection-early/mid/late/helpers/state.ts`) | `detectETBTriggers`, `getETBTriggersForPermanent` (detector wire type, not skinny). Optional 3rd `gameState` merges continuous granted quotes (Lavabelly / Constricting). Late: `land_you_control_etb` / `enchanted_player_land_etb` / `any_land_etb` / `multi_typed_you_control_etb` (live-seam watcher scan; landfall.ts still emits land enters). Emission (`queueSelfETBTriggersForPermanent`, other-permanent ETB, face-up) passes `ctx.state`. |
| `hideaway-ability.ts` | `detectHideawayAbility`. |
| `detect-target-type.ts` | `detectTargetType`. |
| `etb-untap.ts` | Leftover-merged ETB untap + auto-sacrifice: `detectETBUntapEffects`, `getETBUntapEffects`, `applyETBUntapEffect`, `checkETBAutoSacrifice`, `ETBUntapEffect`. Re-exported through `zone-changes.ts` and leftover. Live Intruder Alarm uses generic `creature_etb` plus IR `tap_or_untap` / `tryApplyUntapAllYouControlTrigger`, not `applyETBUntapEffect`. |
| `attack-detection.ts` (+ generic/watchers/reflexive/state) | Live `detectAttackTriggers`. Leftover and `combat.ts` re-export. Reflexive `when you do` / `when they do` / exert riders are detection-only (`isReflexiveDelayedDoTriggerType`); combat does not auto-queue them on declare attackers. Firebending matches N and `Firebending X, where X is …` (this creature's / CARDNAME's power, creatures you control, experience counters); `getAttackTriggersForCreatures` passes battlefield/experience so X can resolve. Generic watchers include keyword/status (`goaded`/`flying`/`haste`/`menace`/…) and typed N-phrase (`requiredTypePhrase`, not Dinosaur-only; hyphenated `non-Human`). `typed_subtype_attacks_any` is “Whenever a Warrior attacks” without you-control (Najeela). `mana_ability_creature_attacks` is “Whenever a creature you control with a mana ability attacks” (Raggadragga). Self `enters or attacks` / `attacks or dies` / `attacks or blocks` use the same subject set as ETB (`this permanent`, `this enchantment`, …) so Duskmourn Overlords hit both detectors. Watchers: `commander_you_control_etb_or_attack` (Norn's Choirmaster; ETB queued from `triggerEtbPermanentEffects.ts` / token path), `typed_token_power_or_greater_attacks` (Dreadhorde), `equipped_creature_other_than_self_attacks_or_dies` (Rhuk), `equipped_creature_attacks_or_blocks` (Wand of Orcus). Continuous granted quoted attack lines are merged into detector oracle when `gameState` is passed. `KNOWN_ATTACK_TRIGGERS` must be real attack triggers — activated put-from-hand (Elvish Piper) is IR `move_zone`, not this table. |
| `ltb-detection.ts` | Leftover LTB detector. Optional 3rd `gameState` merges granted quotes (Candlekeep Sage). `processLTBTriggers` passes `ctx.state`. |
| `ability-activated-detection.ts` | Leftover ability-activated **detection** (not emission `ability-activated.ts`). |
| `combat-damage-detection.ts` (+ early/mid/late/state) | Leftover combat-damage detect. Optional `gameState` merges granted quotes (Tempered / Capricious). `combat.ts` and combat-damage queue pass `ctx.state`. |
| `tap-detection.ts` | Leftover tap detect. Optional `gameState` merges granted quotes (Tale of Katara and Toph). `tap-untap.ts` re-exports. `getTapTriggers` passes `ctx.state` and skips first-time / not-your-turn. |
| `spell-cast-detection.ts` (+ mid/late/state/helpers/effect-text/trigger-type) | Leftover `detectSpellCastTriggers`. Optional `state` merges granted quotes (Folk Hero / Passionate Archaeologist). `spellCastSharedCreatureType.ts` is Folk Hero share-type. Untyped "cast a spell from exile" is `sourceZoneRequirement: 'exile'`. `getSpellCastTriggers` / `getSpellCastTriggersForCard` filter share-type. |
| `stack-put.ts` | Grip of Chaos family: `whenever a spell or ability is put onto the stack, if it has a single target, reselect its target at random`. Entries: `detectStackPutTriggers`, `queueStackPutTriggers`. Queued from spell-cast processing, ability activation (`notifySpellOrAbilityPutOnStack` for fetch / tutor / level-up / outlast / monstrosity / adapt / reconfigure-unattach), copies, and generic trigger push. |
| `spell-cast.ts` | Opponent / any-player spell-cast detect+emit (`detectOpponentSpellCastTriggers`, `getOpponentSpellCastTriggers`). `from their/your hand|exile|graveyard|library` is a **cast-zone qualifier**, not effect text — consumed before the effect clause so Possibility Storm’s effect starts at “that player exiles it”, and `sourceZoneRequirement` skips exile/graveyard/library casts. |
| `planeswalker-loyalty.ts` / `special-card-effect-tables.ts` / `static-special-effect-detectors.ts` / `mimic-vat-modal-and-storm.ts` | Leftover unique bottom tables/detectors. |
| `dealt-damage-detection.ts` / `status-keyword-detection.ts` / `status-event-detection.ts` / `returned-to-hand-detection.ts` | Leftover unique detectors. `detectDealtDamageTriggers` optional `gameState` merges granted quotes (Spiteful). `damage-received.ts` / `dealt-damage-watchers.ts` pass `ctx.state`. |
| `block-detection.ts` + `block-trigger-type.ts` | Leftover `detectBlockTriggers`. Optional `gameState` merges granted quotes (Retaliation). Self becomes-blocked is `self_becomes_blocked`; `getBlockedTriggersForCreatures` emits it, `getBlockTriggersForCreatures` does not. |
| `untap-detection.ts` | Leftover untap detect. Folder `tap-untap.ts` may still have a copy — dual-copy grep before deleting. |
| `attachment-attack-detection.ts` | Live attachment-attack detect/get. `combat.ts` re-exports (combat copy deleted). |
| `attack-triggers-for-creatures.ts` | Live `getAttackTriggersForCreatures` (production body from `combat.ts`; leftover dual-copy replaced). `combat.ts` and leftover re-export. |
| `enchanted-by-aura.ts` | From `combat.ts`. `isEnchantedByAuraYouControl`. |
| `combat-triggered-ability.ts` | From `combat.ts`. `CombatTriggeredAbility`. |
| `trigger-doublers.ts` | From `combat.ts`. `detectTriggerDoublers`, `applyTriggerDoublers`, `pushTriggerDoublerCopies`, `playerHasDungeonRoomAbilityDoubler`, `TriggerDoublerEventContext`. |
| `attack-watcher-queue.ts` | From `combat.ts`. `planAttackWatcherQueue`, `isAttackWatcherTriggerType`. Keyword/status watchers (`goaded`/`flying`/`haste`/`deathtouch`/`menace`/`trample`/`reach`/`toxic`) fire per matching attacker. Typed subtype phrases (`requiredTypePhrase`) are generic N-type, not Dinosaur-only. `typed_subtype_attacks_any` is any-controller subtype (Najeela). |
| `damage-redirect-target-type.ts` | `parseAnyTargetThatIsntCreatureType`, `excludedCreatureTypeFromDamageTargetType`. "Any target that isn't a [type]" is generic N-type (`any_non_dragon` still matches Dragon). |
| `combat-attack-trigger-helpers.ts` | From `combat.ts`. `mergeCombatTriggerValue`, `extractCommanderOwnedGrantedAbilityTexts`. |
| `card-data-tables.ts` | Public `KNOWN_*` trigger lookup tables. `KNOWN_TAP_UNTAP_ABILITIES` re-exported from `card-data-tables-handlers/`. **39.1 KB** (done). Never create `card-data-tables/` beside the `.ts`. Extract existing tables only — do not add card-name rows. |
| `card-data-tables-handlers/index.ts` | Internal TOC barrel. Named re-exports only. Leaves must not import the parent or this index. |
| `card-data-tables-handlers/cardDataTablesTapUntapAbilities.ts` | From `card-data-tables.ts`. `KNOWN_TAP_UNTAP_ABILITIES`. Parent re-exports. |
| `zone-change.ts` | Public exile-from-battlefield get/queue, put-into-graveyard-from-anywhere, left-graveyard. **32.3 KB** (done). Distinct from `zone-changes.ts` (death/ETB/attack barrel). Never create `triggers/zone-change/` beside the `.ts`. |
| `zone-change-handlers/index.ts` | Internal TOC for extracts from `triggers/zone-change.ts`. Named re-exports only. Leaves must not import the parent or this index. |
| `zone-change-handlers/exileFromBattlefieldDetection.ts` | From `triggers/zone-change.ts`. `ExiledFromBattlefieldTrigger`, `detectExiledFromBattlefieldTriggers`. Parent re-exports. Distinct from death/ETB/attack. |
| `turn-phases.ts` | Public turn-phase detectors/emitters. Re-exports `UntapStepEffect` / `detectUntapStepEffects` / `getUntapStepEffects` / `applyUntapStepEffect`. `EndStepTrigger` and `detectEndStepTriggers` re-exported from `turn-phases-handlers/`. Never create `turn-phases/` beside the `.ts`. |
| `turn-phases-handlers/index.ts` | Internal TOC barrel. Named re-exports only. Leaves must not import the parent or this index. |
| `turn-phases-handlers/turnPhaseTriggerTypes.ts` | From `turn-phases.ts`. `EndStepTrigger`. Parent re-exports. |
| `turn-phases-handlers/turnPhaseActivePermanentFace.ts` | From `turn-phases.ts`. `getActivePermanentCardFace`. |
| `turn-phases-handlers/turnPhaseEffectChoiceHelpers.ts` | From `turn-phases.ts`. `detectRequiresChoice`, `detectAffectsAllPlayers`. |
| `turn-phases-handlers/turnPhaseEndStepTriggers.ts` | From `turn-phases.ts`. `detectEndStepTriggers`. Collects every “each opponent's end step” ability with its intervening-if (Keeper of the Accord is two triggers, not a `KNOWN_END_STEP_TRIGGERS` mash). Does **not** match “the next” / “your next” end step — those are delayed triggers from `delayed-end-step-watchers.ts`. Parent re-exports. |
| `turn-phases-handlers/turnPhaseUntapStepEffects.ts` | From `turn-phases.ts`. Other-players' untap-step turn actions: Unwinding Clock / Seedborn Muse “untap all …”, filtered groups (Prophet of Kruphix creatures+lands, Murkfiend Liege colors, Ohabi Caleria Archers, Ivorytusk +1/+1, Quest for Renewal counter gate), plus self-untap (Bender's Waterskin, Victory Chimes, Endbringer) and Urban Burgeoning-style grants. Parent re-exports. |

## Oracle IR parser / postprocess (`rules-engine/src/`)

- `oracleOwnKeywordText.ts` — `oracleTextHasOwnKeyword`, `oracleTextGrantsKeywordOnlyToOthers`, `grantedAbilityIsOwnKeyword`: printed/self keywords vs lord grants (`Other Dinosaurs you control have haste`) and token-create tails. Used by haste / summoning sickness and goad must-attack (Rule 701.15b if able).
- `oracleIRParserPostprocess.ts` is a **12.5 KB barrel** (named re-exports + a few leftover imports). All `oracleIRParserPostprocess*.ts` siblings are under the ceiling (largest: `oracleIRParserPostprocessGapClosureStepRepairs.ts` at 37.0 KB). Add a new family file; do not append to a sibling near 36–40 KB.
- `oracleIRParser.ts` is a **0.1 KB barrel**: `export { parseOracleTextToIR } from './oracleIRParserParseOracleTextToIR'`.
- `oracleIR.ts` is a **1.0 KB barrel**: re-exports shared types + `OracleEffectStep` (`A | B | C`) plus leftover `OracleIRAbility` / `OracleIRResult`. Never create `oracleIR/` beside `oracleIR.ts`.
- Keep the `oracleIRParser*` / `oracleIRExecutor*` prefixes. No folder move until a parent is already a thin barrel.
- `oracleIRParserEffectImpulsePermission.ts` is a **26.7 KB** dispatcher (`parseEffectLevelImpulsePermissionClause` leftover early / from-among if-chain + late `tryParse` call). `oracleIRParserLifeAndCombatClauses.ts` is a **0.1 KB barrel** (`tryParseLifeAndCombatClause`; existing BOM kept — do not add another). `oracleIRParserUtils.ts` is a **28.2 KB** dispatcher (`parseQuantity` leftover numeric / late-reference if-chain + `parsePlayerSelector` / `splitIntoClauses` / `normalizeClauseForParse`). `oracleIRParserStaticAbilityClauses.ts` is a **33.1 KB** dispatcher (`tryParseStaticAbilityGrantClause` leftover if-chain + re-export of `tryParseRulesTextClause`). `oracleIRParserSimpleActionClauses.ts` is a **4.0 KB** dispatcher (`tryParseSimpleActionClause` + family `tryX`).

| Module | Left | Entry |
| --- | --- | --- |
| `oracleIRParserEffectClauseToStep.ts` | `oracleIRParser.ts` | `parseEffectClauseToStep` |
| `oracleIRParserTemporaryEtbWindowClauses.ts` | `oracleIRParserEffectClauseToStep.ts` | `tryParseTemporaryEtbWindowClause`, `isTemporaryEtbWindowSpellLine` — Rite of Harmony family “whenever a [types] you control enters this turn” |
| `oracleIRParserTemporaryTriggeredClauses.ts` | `oracleIRParserEffectClauseToStep.ts` | `tryParseTemporaryGrantedDiesTriggerClause`, `isDealtDamageThisWayDiesThisTurnSpellLine` — quoted until-EOT dies grants plus Reckless Blaze / Skeletonize “dealt damage this way dies this turn” delayed windows |
| `oracleIRParserPhase4ChoiceFamilyClauses.ts` | `oracleIRParserEffectClauseToStep.ts` | `tryParsePhase4ChoiceFamilyClause` dispatcher: each-player choose-then-destroy-rest, secret opponent damage, mill-from-among may-cast, may-reveal four-zone named-copy win. |
| `oracleIRParserEachPlayerChooseDestroyRest.ts` | Phase 4 choice family | `tryParseEachPlayerChooseThenDestroyRest` — Divine Reckoning family. |
| `oracleIRParserSecretOpponentChoiceDamage.ts` | Phase 4 choice family | `tryParseSecretOpponentChoiceDamage` — Prisoner's Dilemma family. |
| `oracleIRParserMayCastFromAmong.ts` | Phase 4 choice family | `tryParseMayCastFromAmong` — Summons of Saruman mill-from-among may-cast. Optional step stays on direct IR GRAVEYARD_SELECTION (`isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt` / Effect Program `OPTIONAL_NO_CHOICE_KINDS`), not Yes/No. |
| `oracleIRParserMayRevealHandWinIfOwnNamed.ts` | Phase 4 choice family | `tryParseMayRevealHandWinIfOwnNamed` — optional may-reveal-hand / if-you-do four-zone named-copy win (Hedron Alignment family). Printed “named X” is this card’s current name at execute time. Not `detectWinConditions`. |
| `oracleIRParserPhase4ChoiceFamilyLatePass.ts` | leftover PW/spell late pass | Late recovery for those choice-family clauses. |
| `oracleIRParserDiscardHandAndDrawLatePass.ts` | leftover late pass | `rewriteDiscardHandAndDrawAbilities` — “discard your hand and draw N” after clause parse kept only the draw half (Nibelheim graveyard rider). |
| `oracleIRParserWinIfControlDifferentNames.ts` | leftover win-if | `tryParseWinIfControlDifferentNamesStep`, `expandWinIfControlDifferentNamesAbilities` — “if you control N or more [type] with different names, you win the game” (Maze's End activated family). Not an immediate battlefield scan. |
| `oracleIRParserWinIfCastSameNameThisGame.ts` | leftover win-if | `tryParseWinIfCastSameNameThisGameStep`, `expandWinIfCastSameNameThisGameAbilities` — “cast from hand + another spell with this card’s current name this game, you win” (Approach of the Second Sun family). Not `detectWinConditions`. |
| `oracleIRParserPreventLifeGainThisTurn.ts` | leftover life | `tryParsePreventLifeGainThisTurnClause` — this-turn / trailing or leading until-EOT “can't gain life” → `grant_static_ability` duration `this_turn` / `end_of_turn`. Continuous “Players can't gain life” stays ReplacementEffectSpec. |
| `oracleIRParserAttackTaxThisTurn.ts` | leftover combat | `tryParseAttackTaxThisTurnClause` — War Tax “this turn, creatures can't attack unless … pays {X}” plus Sivitri life tax → `grant_static_ability` duration `this_turn`. |
| `oracleIRParserCounterUnlessPays.ts` | `oracleIRParserZoneAndRemovalActions.ts` | `tryParseCounterUnlessPaysClause`, `parseUnlessPaysManaExpression` — counter/destroy/prevent unless-pay taxes (`{N}`, `{X}` where-X, `{N} for each`, plus-additional, concatenated `{2}{R}`, Whirlwind per-stack-object `{N}`, Heroism for-each attacking color, Winter's Chill may-pay `{A}` or `{B}`). |
| `oracleIRParserZoneAndRemovalActions.ts` | leftover zone | `for each opponent, put … onto …` rewrites `from that player's graveyard` → `from each opponent's graveyard` (Weaver King mill-then-steal family). |
| `oracleIRParserPostprocessUnlessPaysMayPayOrFollowups.ts` | `oracleIRParserParseOracleTextToIR.ts` | `foldUnlessPaysMayPayOrFollowups` — stitch “If that player doesn't / pays only {N}” onto a preceding `unless_pays_mana` with `manaOptions`. |
| `oracleIRParserBlockTaxThisTurn.ts` | leftover combat | `tryParseBlockTaxThisTurnClause` — War Cadence “this turn, creatures can't block unless … pays {X}” → `grant_static_ability` duration `this_turn`. |
| `oracleIRParserAttackYouProhibitedExceptKeywords.ts` | leftover combat | `tryParseAttackYouProhibitedExceptKeywordsClause` — Island Sanctuary “until your next turn, you can't be attacked except by creatures with flying and/or islandwalk”. |
| `oracleIRParserUntilEotProtectionOverride.ts` | leftover static | `tryParseUntilEotProtectionOverrideClause` — leading until-EOT activated lose / as-though hexproof-shroud (Detection Tower / Arcane Lighthouse) → `grant_static_ability` duration `end_of_turn`. Continuous statics stay StaticEffectSpec. |
| `oracleIRParserLoyaltyDirectionChoice.ts` | leftover PW loyalty | `tryParseChooseLeftOrRightLoyaltySteps`, `expandChooseLeftOrRightLoyaltyAbilities` — generic Choose left or right (Aminatou −6 / Teyo −2). Do not add card-name cases. |
| `oracleIRParserChaosZoneTemplates.ts` | leftover chaos spells | Warp World / Thieves' Auction / library chaos / Scrambleverse-style “for each (nonland) permanent, choose a player at random”. Entries: `expandChaosZoneTemplateAbilities`, `tryParseOwnedPermanentsShuffleRevealTemplate`, `tryParseRepeatedZoneDraftAuctionTemplate`, `tryParseRandomControlAssignmentTemplate`. Warp World enchantment-wave Auras attach only to prior-wave hosts; commanders shuffled to the command zone still count toward “that many”. Shuffle writes `__serverLibraries` via `writePlayerZoneCards`; revealed-this-way put looks up library cards by owner from `lastRevealedCards` (so a matching hand id or another player's shared Scryfall id does not drop the revealed copy). Do not omit bridged `lastMovedCards` after reveal or the put reuses shuffle leftovers. Reveal observations are same-zone library→library and must not re-offer 903.9a (that left `transitionHaltState` dirty and skipped the put for everyone). Shuffle snapshots use `resolveZoneCardIdFromPermanent` (library `card.id`, not battlefield `perm.id`). Interactive: 903.9a command-vs-library, APNAP Aura-host announce, remainder any-order. Sequential 903.9a prompts fold remaining shuffle/reveal steps into `oracleIrChoiceStepJson` (completeStep drops prior prompts from `queue.steps`). Empty `pendingContinuationSteps` after remainder is authoritative (do not inherit reveal/put from a prior 903.9a prompt). Leftover put/remainder after a mid-spell halt (shock as-enters) persist on `oracleIrPendingResumeStepsJson` even if the queue already grew; `maybeResumeOracleIRStepsAfterResolution` runs `processPendingOracleIrCompoundResumeOnContext` before the chaos ETB/LTB flush. Commanders write `commandZone.inCommandZone`. Remainder `BOTTOM_ORDER` hydrates names/`image_uris`; `ScrySurveilModal` bottom_order is a horizontal left→right reorder (Confirm sends that full list). Glimpse remainder `in a random order` stays unprompted. |
| `oracleIRParserRevealTopShareTypeMayCast.ts` | leftover reveal-top | `mergeRevealTopShareTypeMayCastAbilities` — reveal top, then “if it's a creature card that shares a creature type with a creature you control, you may cast it” (Descendants' Path). Else bottoms the miss; the match stays on library top for a during-resolution free-cast prompt. |
| `oracleIRParserAbilityMerges.ts` | `oracleIRParser.ts` | `mergeSplitChooseModeParsedAbilities` |
| `oracleIRParserImpulseExileTop.ts` | `oracleIRParser.ts` | impulse-exile-top parse (was a closure of `parseAbilityToIRAbility`) |
| `oracleIRParserExileTopOnlyLegacy.ts` | `oracleIRParser.ts` | exile-top-only legacy parse |
| `oracleIRParserAbilityToIR.ts` | `oracleIRParser.ts` | `parseAbilityToIRAbility` (takes `parseOracleTextToIR` as a parameter — do not import the public parent). As-enters replacement choose_color / choose_creature_type steps keep the full “As this … enters, …” sentence as `raw`. |
| `oracleIRParserParseOracleTextToIR.ts` | `oracleIRParser.ts` | `parseOracleTextToIR` |
| `oracleIRParserParseOracleTextToIRLatePasses.ts` | `oracleIRParser.ts` | late passes of `parseOracleTextToIR` |
| `oracleIRParserSimpleActionHelpers.ts` / `…EarlyClauses.ts` / `…AddManaChoice.ts` / `…DrawTurn.ts` / `…CounterSearch.ts` / `…DiscardVote.ts` | `oracleIRParserSimpleActionClauses.ts` | Family `tryX` runs of `tryParseSimpleActionClause`. Leaves take parse args; null = fall through. Recursion is a `parseRest` callback — do not import the parent. `…CounterSearch.ts` parses `pay_energy` (“you may pay any amount of `{E}`”). `…EarlyClauses.ts` `unless_pays_mana` includes controller `you` (Rupture Spire / Transguild Promenade “sacrifice it unless you pay {N}”), not only that-player / they. Reciprocal `exchange_control` is in `…DrawTurn.ts` (Reins of Power). Compound you+opponent `tap_or_untap` is executed in `oracleIRExecutorBattlefieldTapUntapSteps.ts` after `trySpecialTapOrUntapStep` declines the you-only shortcut. `…AddManaChoice.ts` omits `optional` unless the clause is “you may choose”. `…DiscardVote.ts` lowers silver-border “you become this permanent” (Abian) to `grant_static_ability`. |
| `oracleIRParserSpellKeywordGrants.ts` | `oracleIRParserSimpleActionClauses.ts` / residual grant chain | `that spell` / `this spell` gains keywords. Entries: `parseSpellGainsKeywordGrantSteps`, `tryParseSpellGainsKeywordGrantClause`. |
| `oracleIRParserEntersUnderOpponentControl.ts` | `oracleIRParserSimpleActionClauses.ts` | As-enters `gain_control` for "enters under the control of an opponent of your choice" (Xantcha), including the replacement-effect fragment after `SELF_ENTERS_SHORT_PATTERN` splits off "enters". Entry: `tryParseEntersUnderOpponentControlClause`. |
| `oracleIRAsEntersAutomaticReplacementSteps.ts` | leftover as-enters | `collectAsEntersAutomaticReplacementSteps` — replacement `turn_face_down` as the permanent enters (Ixidron “all other nontoken creatures”). `ENTERS_AS_PATTERN` matches “As … enters,” not only “enters the battlefield”. |
| `shared/src/anyPlayerActivatedAbility.ts` | `server/src/socket/interaction.ts`, client stamp | CR 602.3: `textAllowsAnyPlayerActivation` plus `abilityAllowsAnyPlayerActivation` so truncated `{cost}: first sentence` extracts still match the oracle paragraph that says "Any player may activate this ability." |
| `shared/src/chosenTypeManaSpendRestriction.ts` | `chosen-creature-type.ts`, client/AI mana payment | `parseChosenTypeManaSpendRestriction`, `getChosenTypeManaSpendRestriction`, `isAnyColorManaAbility`, `chosenTypeManaAbilityGrantsUncounterableCast`. Stamp chosen-type restriction on any-color only; `{C}` stays unrestricted. |
| `oracleIRParserEffectImpulsePermission-handlers/index.ts` | `oracleIRParserEffectImpulsePermission.ts` | Internal TOC barrel. Named re-exports only. Never create `oracleIRParserEffectImpulsePermission/` beside the `.ts`. |
| `oracleIRParserEffectImpulsePermission-handlers/oracleIRParserEffectImpulsePermissionLateDurations.ts` | `oracleIRParserEffectImpulsePermission.ts` | Late next-turn / until-end / remains-exiled if-chain of `parseEffectLevelImpulsePermissionClause`. `undefined` = fall through. Do not import the parent. |
| `oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityGrantParseUtils.ts` | `oracleIRParserStaticAbilityClauses.ts` | `WithMeta` plus keyword-list, signed P/T, and graveyard grant parse helpers. |
| `oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityGrantEarlyClauses.ts` | `oracleIRParserStaticAbilityClauses.ts` | First if-chain of `tryParseStaticAbilityGrantClause` (permission / P/T / quoted grant). `undefined` = fall through; `null` = abort the whole grant parse. Do not import the parent. |
| `oracleIRParserStaticAbilityClauses-handlers/oracleIRParserStaticAbilityRulesTextClause.ts` | `oracleIRParserStaticAbilityClauses.ts` | `tryParseRulesTextClause` (parent re-exports). |
| `oracleIRParserLifeAndCombatClauses-handlers/oracleIRParserLifeAndCombatParseUtils.ts` | `oracleIRParserLifeAndCombatClauses.ts` | `parseDamageAmount`, `parseLifeChangeAmount`, damage-clause subject/amount patterns, `isDamageAmountDescriptor`, `shouldSkipGenericDamageSource`, `normalizeDamageClauseForParse`. Do not import the parent. |
| `oracleIRParserLifeAndCombatClauses-handlers/oracleIRParserLifeAndCombatClause.ts` | `oracleIRParserLifeAndCombatClauses.ts` | `tryParseLifeAndCombatClause` (parent re-exports). **33.0 KB** — do not append. Never create `oracleIRParserLifeAndCombatClauses/` beside the `.ts`. |
| `oracleIRParserUtils-handlers/oracleIRParserUtilsQuantityEarlyReferences.ts` | `oracleIRParserUtils.ts` | First if-chain of `parseQuantity` (reference-amount / object-stat / phrase). Recursion is a `parseRest` callback — do not import the parent. `null` = fall through. |
| `oracleIRParserLeadingCastKeywordPrefix.ts` | `oracleIRParserUtils.ts` (`normalizeClauseForParse`) | `stripLeadingCastKeywordPrefix` / `stripTrailingCastKeywordSuffix` — Delve/Convoke/Suspend/Spree/Fuse/Infusion/Freerunning/Undaunted/Ascend/Aftermath/Flashback/Kicker/Spell mastery/Reinforce glued onto the next instruction, including a trailing reminder parenthetical or dash-only cost, are stripped. Residual unknown lowering peels those leftovers only when the remainder looks like an instruction (`you`/`target`/`if`/`this permanent`/`Card Name deals …`). Whole-clause “You may choose new targets for the copies you control” leftovers are pruned. Trailing Flashback/Fuse/Reinforce is stripped without eating “as though they had flash”. Isolated “This mana lasts until end of combat.” (firebending effect clauses) stays as `retain_mana`; only leftover `) Flashback` shards after a broken parenthetical are stripped. |
| `oracleIRParserChooseMode.ts` | `oracleIRParserAbilityToIR.ts` | `tryParseChooseModeBlock`. Header `Choose up to that many` is a real modal (min 0), not sequential leftover mode bullets. |
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
| `oracleIRParserPostprocessCopySpellTailHelpers.ts` / `…CopySpellUnknownSteps.ts` | Copy-spell tail + unknown-step lowering. `each other player copies that spell` (Hive Mind) is `copy_spell` with `who: each_opponent` plus the “each of those players may choose new targets” tail. |
| `oracleIRParserPostprocessKeywordReminderPrunes.ts` | Keyword reminder prunes. `pruneReinforceReminderAddCounterSteps` drops reminder `Put N +1/+1 counters on target creature` leftover after Reinforce. |
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
| `oracleIRParserPostprocessDiscardMillLifeStepSplitters.ts` | Discard/mill/life splitters. `splitSacrificeFollowOnInstructionsStep` splits `sacrifice it, draw a card` (and similar pronoun + comma + instruction) into sacrifice + follow-on steps. |
| `oracleIRParserPostprocessDynamicCounterRiders.ts` | Dynamic counter riders. |
| `oracleIRParserPostprocessMoveZoneCopyAndLandAnimationExpansions.ts` | Move-zone copy + land-animation expansions. |
| `oracleIRParserPostprocessKeywordActionUnknownSteps.ts` | Keyword-action unknown-step lowering. |
| `oracleIRParserPostprocessAmassDiscoverConniveRecruitKeywords.ts` | Amass / discover / connive / recruit. |
| `oracleIRParserPostprocessClashScryExploreReminderPrunes.ts` | Clash/scry/explore reminder prunes. |
| `oracleIRParserPostprocessVanishingModularStaticPrunes.ts` | Vanishing/modular static prunes. `pruneExternallyHandledTemporaryLandBonusUnknownSteps` lowers “you may play N additional lands this turn” to a this-turn `grant_static_ability` instead of deleting the step. |
| `oracleIRParserPostprocessReminderPlatformTextPredicates.ts` | Reminder/platform-only text predicates. |
| `oracleIRParserPostprocessCrewChampionLateKeywordPrunes.ts` | Crew/champion late keyword prunes. |
| `oracleIRParserPostprocessBareTriggerFragmentSteps.ts` | Isolated trigger-effect fragments. `parseBareTriggerEffectFragmentSteps` also wraps leading `if <cond>, <effect>` (Wakening Sun's Avatar “if you cast it from your hand, destroy all non-Dinosaur creatures”). |
| `oracleIRParserPostprocessFutureSpellAndTokenReminderPrunes.ts` | Future-spell / token reminder prunes. |
| `oracleIRParserPostprocessDeterministicBodyAndConditionalExpansions.ts` | Deterministic body + conditional expansions. |
| `oracleIRParserPostprocessResidualUnknownLowering.ts` | Residual unknown-step lowering (head/tail of the elephant). |
| `oracleIRParserPostprocessInsteadReplacementSteps.ts` | `repairIntraAbilityInsteadConditionalSteps` — fold "create N of those tokens instead" and same-target add_counter instead (Andúril city's blessing) into the base step. |
| `oracleIRParserPostprocessQuotedAbilityRiders.ts` | `extractQuotedAbilityRiderSteps` — lift quoted riders and rewrite leftover unknown residuals. |
| `oracleIRParserPostprocessCurrentBatchSurfaces.ts` | `repairCurrentBatchSurfaceSteps` — restore executable step kinds swallowed by residual rewrites. |
| `oracleIRExecutorExileOneOfThemHandlers.ts` | From `oracleIRExecutorSpecialTargetHandlers.ts`. `tryApplyExileOneOfThemLookedCards`. |
| `oracleIRExecutorExileLookedContextualHandlers.ts` | From `oracleIRExecutorSpecialTargetHandlers.ts`. `tryApplyExileLookedContextualStep`. |
| `oracleIRExecutorExilePileCounterAndTargetedHandlers.ts` | From `oracleIRExecutorSpecialTargetHandlers.ts`. `tryApplyExilePileCounterAndTargetedStep`. |
| `aiAutoPassContextualIdle.ts` / `aiActivatedAbilityContextualIdle.ts` / `canRespondPriorityCache.ts` | AI off-turn auto-pass skips legal-but-pointless instants/flash; Elixir-like gain-life/shuffle stays a real action when life, GY value, or a removal/GY-exile threat matters. Spell/`canRespond`/`canAct` cache per priority fingerprint. Any-player Xantcha `{3}` still counts as a real action. See extract-families-handlers. |
| `freeHandCastGrant.ts` | Continuous Omniscience vs this-turn / “won N flips this way” riders. Entries: `grantsStaticFreeHandCasts`, `findFreeHandCastsThisTurnSource`. |
| `oracleIRParserCoinFlipThisWay.ts` | Choose a number between N and M, flip that many coins, per-flip draw/damage, five-win free-cast rider. Entry: `tryParseCoinFlipThisWayClause`. |
| `oracleIRExecutorFreeHandCastsThisTurn.ts` | This-turn `grant_static_ability` stamps `lastingEffects.freeHandCastsThisTurn`. Entry: `tryApplyFreeHandCastsThisTurnGrant`. |
| `oracleTextParserPreprocess.ts` | Same-paragraph `Flip a coin` / `Flip that many coins` continues the prior ability so Yusri’s attack trigger is not split after “choose a number between 1 and 5.” |
| `manualActionApply.ts` / `manualAction-handlers/` / `socket/manual-action.ts` | Kitchen-table Manual Mode. Physical table mutations (no triggers) persisted as `manualAction` for replay. Catalog: `shared/src/manualAction.ts`. Replay: `applyEventManualActionEvents.ts`. |

## Card data and SQLite connections (`server/src/services/`)

| Module | Owns |
| --- | --- |
| `localCardLookup.ts` | The `card_lookup` corpus connection, freshness check, and rebuild. `CARD_LOOKUP_SQLITE_FILE` picks the file; `CARD_LOOKUP_SQLITE_READONLY_FILE` names one path to open read-only with rebuild disabled. Entry points: `ensureLocalCardLookupIndexSync`, `lookupLocalCards`, `getLocalCardLookupDatabase`, `resetLocalCardLookupForTests`. |
| `oracleIrCompiledOverlayDatabase.ts` | The connection backing `oracle_ir_compiled_overlay`, the only table written at runtime. `ORACLE_IR_OVERLAY_SQLITE_FILE` moves overlays into their own database (tests use one per worker); unset, they stay in the card-lookup database. Entry points: `getCompiledOracleIROverlayDatabase`, `resetCompiledOracleIROverlayDatabaseForTests`. |
| `oracleIrCompiledOverlayStore.ts` | Overlay CRUD and envelope validation on top of that connection. |
| `tokens.ts` / `tokenImageMatch.ts` | Local token art from `precon_json/Tokens.json` (refresh: `node tools/refresh-scryfall-tokens.mjs`). Match is name + P/T + color + artifact/enchantment + keyword alignment; among ties, fewer unrequested keywords, then newest printing. Double-faced token faces are indexed separately. |

Tests share the prebuilt 137 MB `server/data/card-lookup.sqlite` read-only rather than copying it per worker; see `server/tests/vitest.setup.ts`.

## Client (MTG logic only)

See [`mtg-logic-module-map-client.md`](mtg-logic-module-map-client.md).
