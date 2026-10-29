# MTG logic module map — Oracle IR executor

Peeled from `docs/mtg-logic-module-map.md` (`## Oracle IR executor`).
Coordinator owns this file. Extract chats must not edit it — paste owed rows.

## Oracle IR executor (`rules-engine/src/`)

All listed executor parents are under the ceiling. `oracleIRExecutorModifyPtStepHandlers.ts` is **25.4 KB** (done). `oracleIRExecutorDamageStepHandlers.ts` is **28.3 KB** (done). `oracleIRExecutorCreatureStepUtils.ts` is **14.0 KB** (done). `oracleIRExecutorTokenStepHandlers.ts` is **25.0 KB** (done). `oracleIRExecutorPlayerUtils.ts` is **38.2 KB** (done). `oracleIRExecutorSpecialTargetHandlers.ts` is **2.8 KB** (done; thin barrel). `oracleIRExecutorConditionalStepSupport.ts` is **5.7 KB** (done). `oracleIRExecutorConditionalStepSupportExtended.ts` is **15.9 KB** (done). `oracleIRExecutorMoveZoneStepHandlers.ts` is **32.1 KB** (done). `oracleIRExecutorPlayerStepHandlers.ts` is **33.6 KB** (done). `oracleIRExecutorMainLoop.ts` is **29.4 KB** (done; `applyOracleIRStepsToGameStateImpl` is the switch dispatcher). `oracleIRExecutorBattlefieldStepHandlers.ts` is **34.7 KB** (done). `oracleIRExecutorZoneOps.ts` is **20.2 KB** (done). Split by step or op family; no `BatchNNN` / `Bulk` names. No `*-handlers/` folder until a parent is already a thin barrel.

### `oracleIRExecutorMoveZone*` (extracted from `applyMoveZoneStep`)

Public API unchanged: parent still exports `applyMoveZoneStep` / `MoveZoneStepHandlerResult`. Guard chains take `MoveZoneGuardArgs` and return a result or `undefined` (fall through). Do not import the parent from a leaf. Unrecognized `withCountersCondition` riders drop extra counters instead of skipping the move.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorMoveZoneWhatParsersZoneQueries.ts` | Zone / target / count selector parse prologue. |
| `oracleIRExecutorMoveZoneWhatParsersReferenceQueries.ts` | Contextual / revealed / milled / per-player-zone selectors. |
| `oracleIRExecutorMoveZoneGuardArgs.ts` | `MoveZoneGuardArgs`, `MoveZoneFinalizeAppliedResult`, `buildMoveZoneBattlefieldEntryOverrides`. |
| `oracleIRExecutorMoveZoneStepTypes.ts` / `…ReferenceResolvers.ts` / `…ContextualCardResolvers.ts` / `…StepResultBuilders.ts` / `…LinkedExileProjection.ts` / `…PermanentSelectors.ts` / `…EarlyGuardSteps.ts` / `…LibraryPlacementChoice.ts` | Shared plumbing for the move-zone apply. `findBoundCardZoneLocation` takes an optional owner id; when a card id is in hand and library it prefers library. Revealed-this-way put/remainder look up by that owner stamp (`resolveRevealedThisWayCardPile` / `lastRevealedCards`, not shuffle leftovers). Library reads go through `readPlayerZoneCards` (including `__serverLibraries`). `isUndecidedLibraryPlacementChoice` skips as `player_choice_required` (Hinder / Not Forgotten), not `unsupported_destination`. |
| `oracleIRExecutorMoveZoneGuards<FirstSelector>.ts` | Contiguous guard runs named after the first selector they test (`CommandZonePermanent`, `FromGraveyard`, `ThatPile`, …). Entry: `tryApplyMoveZoneGuardsFromX(args)`. Unbound `target … from your graveyard` is `player_choice_required` (Winter Soldier), not `unsupported_selector`. |
| `oracleIRExecutorMoveZoneGuardsThatPile.ts` | Second chain leftovers including mass battlefield creature bounce to hand. `each chosen creature` / `the chosen creatures` bounce bound `chosenObjectIds`. Entry: `tryApplyMoveZoneGuardsFromThatPile`. |
| `oracleIRExecutorZoneOpsAllFromZoneWhatParsers.ts` | `parseMoveZoneAllFromYourHand` accepts `all (the) cards from your hand`. `parseMoveZoneMassBattlefieldCreatureBounce` includes `chosenCreaturesOnly`. |
| `oracleIRExecutorMoveZoneGuardsDiceBracketIt.ts` | Head-of-chain guards from `parsedDiceBracketIt` through self-battlefield `whatText` / `sourceCardZone`. Entry: `tryApplyMoveZoneGuardsFromDiceBracketIt`. Warp World owned-permanents shuffle writes through `writePlayerZoneCards` so `player.library`, `state.zones`, and `__serverLibraries` stay the same shuffled pile before reveal. Shuffle `lastMovedCards` ids are the zone card ids (`resolveZoneCardIdFromPermanent`), not battlefield instance ids. |
| `oracleIRExecutorMoveZoneGuardsTopCardLibraryOwnerId.ts` | Top/bottom library-owner moves and `contextualBoundCardIds` multi-card move. Entry: `tryApplyMoveZoneGuardsFromTopCardLibraryOwnerId`. |
| `oracleIRExecutorMoveZoneGuardsOneOfThemSplit.ts` | Second chain: `parsedOneOfThemSplit` / `parsedOnePileSplit` / `contextualBoundCardZone` / `sourceCardZone` plus following graveyard / hand-gy selectors. `target card from a graveyard` / opponent GY: leftover battlefield ids are not GY targets; opponent-only skips the controller pile; unique legal card applies; several legal cards skip `player_choice_required`. Entry: `tryApplyMoveZoneGuardsFromOneOfThemSplit`. |
| `oracleIRExecutorMoveZoneGuardsCommandZonePermanentToHand.ts` | Remaining inline guard-arg builds + leftover selector runs (first leftover: `parsedCommandZonePermanent && step.to === 'hand'`). Entry: `tryApplyMoveZoneGuardsFromCommandZonePermanentToHand`. **34.1 KB** — do not append. |
| `oracleIRExecutorMoveZoneGuardsUnsupportedSelectorEarlyOut.ts` | All-selector unsupported early-out. Returns the skip result or `undefined`. Not named `GuardsFromGraveyard`. |
| `oracleIRExecutorMoveZoneSeventhFromTop.ts` | `move_zone` to owner’s library seventh from the top when the source is this spell / this card / it and that object is still on the stack. Inserts at index `min(6, library.length)` and removes it from the stack. Entry: `tryApplyMoveZoneSeventhFromTop`. Called from `applyMoveZoneStep` after early guards. |
| `oracleIRExecutorMoveZoneStackSpellToExile.ts` | `move_zone` to exile when the referent is it / that spell / this spell and that object is still a **spell** on the stack (Possibility Storm “that player exiles it”). Binds via `targetSpellId`, not the trigger source name. Entry: `tryApplyMoveZoneStackSpellToExile`. Called from `applyMoveZoneStep` after seventh-from-top. Stamps `copiedFromStackItemId` so later “may cast that card” cannot treat the original spell as the until-hit. Share-type impulse keeps the until-hit in exile for the live may-cast prompt; misses still go to the bottom. |

Parent is **32.1 KB**. Leftover: `finalizeAppliedResult` prologue (closes over mutable `nextState` / `effectiveBattlefieldAdd*`). `MoveZoneGuardArgs` already carries the extra locals from these chains.

### `oracleIRExecutorZoneOps*` (extracted from `oracleIRExecutorZoneOps.ts`)

| Module | Owns |
| --- | --- |
| `oracleIRExecutorZoneOpsCardTypeMatchers.ts` | Simple card-type parsing and matching. Entries: `SimpleCardType`, `parseSimpleCardTypeFromText`, `cardMatchesType`, `cardMatchesTotalPowerToughnessLte`. Parent re-exports the public API. |
| `oracleIRExecutorZoneOpsShuffleIntoLibrary.ts` | Shuffle-all / typed cards from a player's graveyard into their library. Entries: `parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary`, `shufflePlayerGraveyardIntoLibrary`, `shuffleTypedCardsFromPlayerGraveyardIntoLibrary`. Parent re-exports the public API. |
| `oracleIRExecutorZoneOpsHandLibraryMovers.ts` | `moveCountFromHandToLibrary`, `shufflePlayerHandAndGraveyardIntoLibrary`. Writes through `writePlayerZoneCards` so Puzzle Box / Echo-style hand→library does not leave the original cards in `state.zones.hand` for the follow-up draw. |
| `oracleIRExecutorZoneOpsBattlefieldEntry.ts` | `createBattlefieldPermanentsFromCards`. Flattens nested `{ card: { name, image_uris } }` wrappers so Warp World puts are not shown as `perm-…` ids. Ghalta-style `move_zone` entries set `summoningSickness` and `enteredThisTurn`. Auras/Curses can enter attached to a battlefield host or `enchantedPlayerId`. Entries: `canCardEnterAttachedToTarget`, `canCardEnterAttachedToPlayer`, `resolveMoverAttachment`. |
| `oracleIRExecutorZoneCardIdentity.ts` | Warp World put identity: `flattenZoneCardForBattlefield`, `findBestZoneCardIndex` (named copy when basics share an oracle id), `mergeRevealedCardIdentity`. |
| `oracleIRExecutorZoneOpsSingleTargetMatchers.ts` | GY this-turn qualifiers: `put there from anywhere / the battlefield / their library this turn`. `putIntoGraveyardFromLibraryThisTurn` uses mill stamps (`putIntoGraveyardFrom: 'library'`, `milledTurn`). |
| `oracleIRExecutorZoneOpsChosenCompoundWhatParsers.ts` | `parseMoveZoneSingleCardFromEachPlayersGraveyard` (incl. each opponent + from-library-this-turn), `putOneMatchingCardFromEachOpponentsGraveyardOntoBattlefield`. |

### `oracleIRExecutorPlayerUtils*` (extracted from `oracleIRExecutorPlayerUtils.ts`)

Public API unchanged: parent re-exports. Do not import the parent from a leaf. Parent is **38.2 KB** (under ceiling). Leftover: graveyard/exile permission markers, vote/quantity helpers, mill-until / reveal-until, draw / exile-top, shuffle-rest / library-bottom, `adjustLife`, `adjustPlayerCounter`, mill. `collectTopLibraryObservationForPlayers` reads via `readPlayerZoneCards` so empty `player.library` still sees `ctx.libraries` / `__serverLibraries` after restore. Pre-existing dual copy: `isThatOwnerOrControllerSelector` / `isThoseOpponentsSelector` also live in `oracleIRParserUtils.ts`.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorPlayerResolvePlayers.ts` | `resolvePlayers`, `resolvePlayersFromDamageTarget`, `countControlledLands`, `listEligibleChooseOpponentIds`, `isThatOwnerOrControllerSelector`, `isThoseOpponentsSelector`. `resolvePlayers` skips `hasLost` / `eliminated` / `leftGame` players for each-opponent / each-player selectors so Hive Mind “each other player copies” does not target a defeated player. Selector `you` still returns `controllerId` even with stale `leftGame` after reconnect/restore so Scry/Surveil (Lifecrafter's Bestiary) can queue. `target_opponent` binds `targetOpponentId` / opponent `targetPlayerId` / a single opponent in `chosenObjectIds`; never the activator. Damage targets include `the player` and strip a trailing `for each …` rider. |
| `oracleIRExecutorPlayerImpulsePermissionMarkers.ts` | `applyImpulsePermissionMarkers`. |
| `oracleIRExecutorPlayerZoneAccess.ts` | `readPlayerZoneCards`, `writePlayerZoneCards`, `getCurrentTurnNumber`, `stampCardPutIntoGraveyardThisTurn`, `stampCardsPutIntoGraveyardThisTurn`. Mill also stamps `putIntoGraveyardFrom: 'library'` and `milledTurn`. Empty `player.hand` falls back to `state.zones.hand`, so wheel shuffle must write both. |
| `oracleIRExecutorPlayerShuffleChangeTargetSteps.ts` | `applyShuffleZonesIntoLibraryStep` (Echo of Eons / each-player hand+GY into library), `applyShuffleLibraryStep`, named-card exile, choose pile, change target. Wheel shuffle commits hand/GY into library through `commitCardZoneChanges`, then shuffles via `writePlayerZoneCards` so `player` / `state.zones` / `__serverLibraries` stay one pile before the follow-up draw. |
| `oracleIRExecutorPlayerLookSelectTop.ts` | `lookSelectTopCardsForPlayer`. |
| `oracleIRExecutorPlayerLookChooseFromTopStep.ts` | `applyLookChooseFromTopStep` / `buildLookChooseFromTopSelectionOptions`. Optional look-choose queues when `deferOptionalLookChoices`. Mandatory look-choose queues when more matching cards than `maxSelections` (player targets in `chosenObjectIds` are not card picks). Rest to GY when `nonMatchRest: 'graveyard'`. `reference_amount` tries “until you reveal …” first, then `resolveOracleQuantity` so “that many” / “among them” use the bound reference. |
| `oracleIRExecutorPlayerLookChooseLimits.ts` | `parseLookChooseSelectionLimits` — `any number of` is min 0 (if optional) / max unbounded, capped by selectable count. |
| `oracleIRExecutorPlayerLookChooseSelector.ts` | Mana-value `X or less` uses `ctx.xValue`. `any number of` / `cards with mana value` stripped before type match. |
| `oracleIRExecutorPlayerSurveilLookRevealSteps.ts` | `applySurveilStep` / `applyLookSelectTopStep` / `applyLookTopStep` / `applyRevealTopStep`. |
| `oracleIRExecutorRevealThatManyAmount.ts` | Warp World / Glimpse `reveal_top` “that many”: leftover JSON amount, explicit `lastMovedCountByPlayer`, case-insensitive player ids, `lastMovedCards` owner fallback. A missing player is 0 when any shuffle count is known (do not skip the whole reveal). |
| `oracleIRParserPostprocessLookChooseFromTopCensus.ts` | Sibling of `oracleIRParserPostprocessLookChooseFromTop.ts`. Entries: `parseRevealTopAnyNumberPermanentsToBattlefieldTriple` (Genesis Wave), `parseLookTopExileOneFaceDownRestBottom` (Siphon Insight), `parseLookTopReorderAllOnLibrary` (Ponder/Index put-them-back + optional shuffle → `look_select_top` dest=`library_top`). Called from `mergeLookChooseFromTopAbilities`. |
| `oracleIRExecutorPlayerCardInspect.ts` | `normalizeOracleText`, `getCardTypeLineLower`. |
| `oracleIRExecutorPlayerExileUntilAmount.ts` | `resolveUnknownExileUntilAmountForPlayer`, `getCardTypesFromTypeLine`, `getCardManaValue`, `resolveReferencedSpellManaValue`. Discover until-text `mana value that spell's mana value or less` uses `referenceSpellManaValue`, then the stack spell at `targetSpellId`, then `xValue`. |
| `oracleIRExecutorPlayerDiscardCards.ts` | `discardCardsForPlayer` / `discardSpecificCardsForPlayer` stamp `discardedByPlayerId` + `discardedOnTurn` (`turnNumber ?? turn`) onto GY cards in `players[].graveyard` and `state.zones` so Mayhem / Nibelheim GY riders see discard provenance. |
| `oracleIRExecutorCardZoneTransitionCommit.ts` | Zone-change apply merges proposed `event.object` extraFields over the source-zone copy (hand copy otherwise drops discard stamps). `commitLibraryTopObservation` does not halt on same-zone library observations (Warp World / Chaos Warp reveal → put) and clears `transitionHaltState` if `proposeTransitions` still stamped a deferred replacement (a commander already in the library must not re-offer 903.9a). `moveBattlefieldPermanentsByIdToOwnersLibraries(..., { shuffle })` shuffles the owner's library after "shuffles it into their library". |
| `oracleIRExecutorPlayerGraveyardPermissionSteps.ts` | Grant/modify/keyword GY permission apply. `grant_graveyard_permission` + `modify_graveyard_permissions` (`castCost: 'mana_cost'`) stamp `temporaryGraveyardKeywordGrants` with keyword from raw and printed mana cost (Past in Flames / Will of the Jeskai family). |
| `oracleIRExecutorPlayerGraveyardPermissionHelpers.ts` | GY/exile permission target resolvers plus keyword-grant stamp helpers (`extractGrantedGraveyardKeywordFromRaw`, `resolvePrintedManaCostForGraveyardGrant`, `mergeTemporaryGraveyardKeywordGrantStamps`). |
| `oracleIRExecutorPlayerAddManaToPool.ts` | `addManaToPoolForPlayer`. |

### `oracleIRExecutorCreatureStepUtils-handlers/` (extracted from `oracleIRExecutorCreatureStepUtils.ts`)

Public API unchanged: parent re-exports. Do not import the parent from a leaf. Parent is **14.0 KB** (done). Leftover: temporary P/T (`applyTemporaryPowerToughnessModifier`, `applyTemporarySetBasePowerToughness`, `applyTemporarySwitchPowerToughness`), goad (`resolveGoadTargetCreatureIds`, `applyGoadToCreatures`), `countControlledByClass`, `normalizeControlledClassKey`. Never create `oracleIRExecutorCreatureStepUtils/` beside the `.ts`.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorCreatureBattlefieldLookup.ts` | `getProcessedBattlefield`, `readPermanentPower`, `readPermanentToughness`, `permanentIsCreature`, `isMassTapOrUntapSelectorText`, `permanentHasSubtype`, `getSourceBattlefieldPermanent`, `getControlledPermanents`. |
| `oracleIRExecutorCreatureBattlefieldHelpers.ts` | `readPowerForComparison`, `readToughnessForComparison`, `readCreatureStatForComparison`, `isAttackingPermanent`, `isBlockingPermanent`, `resolveBlockersOfPermanent`, `resolveBlockingCreatureIds`, `isUnblockedAttackingPermanent`, `permanentHasKeyword`. Live `attacking` is a defender/permanent id; live `blocking` is an attacker-id array. |
| `oracleIRExecutorCreatureSingleTarget.ts` | `resolveSingleCreatureTargetId`, `resolveMentorTargetCreatureIdFromBattlefield`, `resolveCreatureExtremaQualifiedTargetIdFromBattlefield`, `resolveBolsterTargetCreatureIdFromBattlefield`, `resolveTrepanationBoostTargetCreatureId`. Least/greatest power or toughness among a controller’s creatures auto-picks a bound legal id, else the first tied id (Bolster). |
| `oracleIRExecutorCreatureTargetIds.ts` | `resolveCreatureTargetIds` (plus private `permanentMatchesControlledQualifier` / `readBaseStatForQualifier`). |

### `oracleIRExecutorModifyPtStepHandlers-handlers/` (extracted from `oracleIRExecutorModifyPtStepHandlers.ts`)

Public API unchanged: parent still exports `applyModifyPtStep`, `applyModifyPtPerRevealedStep`, `applySetBasePtStep`, `applySwitchPowerToughnessStep`, `ModifyPtRuntime`, `ModifyPtStepHandlerResult`. Do not import the parent from a leaf. Parent is **25.4 KB** (done). Leftover: `applyModifyPtStep`, `applyModifyPtPerRevealedStep`, `applySetBasePtStep`, `applySwitchPowerToughnessStep`, local step-result types. Never create `oracleIRExecutorModifyPtStepHandlers/` beside the `.ts`.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorModifyPtStepTypes.ts` | `ModifyPtRuntime`. Parent re-exports. |
| `oracleIRExecutorModifyPtScalerCountHelpers.ts` | `countAttackingCreaturesMatching`, `countCreaturesBlockedByTarget`, `countCreaturesBlockingTarget`, `countBasicLandTypesAmongLandsYouControl`, `countArtifactsYouControl`, `countOtherAttackingAurochs`, `countControlledCreaturesWithSubtype`, `countPartyCreatures`, `countBloodTokensForPlayer`. |
| `oracleIRExecutorModifyPtReferenceScaler.ts` | `resolveReferenceScalerScale`. |

### `oracleIRExecutorDamageStepHandlers-handlers/` (extracted from `oracleIRExecutorDamageStepHandlers.ts`)

Public API unchanged: parent re-exports. Do not import the parent from a leaf. Parent leftover: deal-damage apply (`applyDealDamageStep`) and amount/source/battlefield helpers, `applyDamageCantBePreventedStep`. `resolveDamageSourceKeywords` reads `sourceGrantedAbilities` after the stack item is popped and stamps `deathtouchDamageMarked` on damaged creatures. Never create `oracleIRExecutorDamageStepHandlers/` beside the `.ts`.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorDamagePreventionStepTypes.ts` | `PreventDamageStepHandlerResult` plus private prevention apply/skip types. Parent re-exports. |
| `oracleIRExecutorDamagePermanentTarget.ts` | `resolveSinglePermanentDamageTargetId`. |
| `oracleIRExecutorDamagePreventionLookups.ts` | `resolvePreventionRecipientPermanentId`, `resolvePreventionTargetSourceId`, `findSourceObject`. |
| `oracleIRExecutorPreventDamageStep.ts` | `applyPreventDamageStep`. Parent re-exports. |
| `oracleIRExecutorDamageControlledCountAmount.ts` | Per-player controlled-permanent damage amounts. Entry: `resolveControlledPermanentCountDamageAmount`. Counts lands / nonbasic / snow / untapped / Islands `you control`, `that player`/`they` control, or `that creature's controller` controls, including twice/triple (Treacherous Terrain, Acidic Soil, Price of Progress, Typhoon, Weight of Spires). Power Surge X (untapped lands at the beginning of this turn) is where-X in `oracleIRExecutorModifyPtWhereBoardStateCounts.ts`; live games stamp `turnStartBattlefieldSnapshot` from `turnNextTurnStartOfTurn.ts`. |
| `oracleIRParserCoinFlipThisWay.ts` | Choose a number between N and M, flip that many coins, per-flip draw/damage, and “if you won N flips this way, you may cast from hand this turn”. Entry: `tryParseCoinFlipThisWayClause`. |
| `oracleIRExecutorFreeHandCastsThisTurn.ts` | This-turn `grant_static_ability` free-hand-cast stamps `lastingEffects.freeHandCastsThisTurn`. Entry: `tryApplyFreeHandCastsThisTurnGrant`. |
| `freeHandCastGrant.ts` | Continuous Omniscience vs this-turn / “won N flips this way” riders. Entries: `grantsStaticFreeHandCasts`, `findFreeHandCastsThisTurnSource`. |

### `oracleIRExecutorToken*` (extracted from `applyCreateTokenStep`)

Parent `oracleIRExecutorTokenStepHandlers.ts` is **25.0 KB** (done). Leftover: `applyCreateTokenStep` dispatcher, `scheduleTokenCleanup`, and for-each copy/create `tryApply*` helpers. Public API unchanged: parent still exports `applyCreateTokenStep` / `TokenStepHandlerResult`. Do not import the parent from a leaf.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorTokenCopySource.ts` | Copy-token source resolution and exclusive copy helpers. Entries: `resolveCopyTokenSource`, `createCopiedTokenPermanent`, `splitCopyTokenReference`, `typeLineHasWord`, `findSourceObjectByIdAcrossState`, `normalizeReferenceText`. **35.4 KB** — do not append. |
| `oracleIRParserTokenExceptCopyModifiers.ts` | Generic `except it has haste and "…"` parse. Entries: `parseCreateTokenExceptCopyModifiers`, `applyExceptCopyModifiersToCreateTokenStep` (`grantsHaste`, `atNextEndStep` sacrifice/exile). |
| `oracleIRExecutorTokenExceptCopyStamp.ts` | `stampCopiedTokenExceptGrantedAbilities` copies except-copy `addAbilities` onto token `grantedAbilities` (Haste + quoted end-step line) and clears summoning sickness for haste. |
| `oracleIRExecutorTokenBlockingEntry.ts` | Stamp created tokens as blocking a creature. Entries: `applyBlockingEntryToCreatedTokens`, `resolveBlockTargetPermanentId`. |
| `oracleIRExecutorTokenBattlefieldAdd.ts` | Amount resolution, those-referenced copies, and battlefield add. Entries: `addTokensToBattlefield`, `resolveTokenAmount`, `resolveTokenCreationSpecsForReplacementEffects`. **36.4 KB** — do not append. |

### `oracleIRExecutorSpecialTarget*` (extracted from `trySpecial*`)

Parent is a **2.8 KB** barrel: `trySpecialExileStep` dispatches Batch386–389 then `tryApplyExileLookedContextualStep` / `tryApplyExilePileCounterAndTargetedStep`; other `trySpecial*` are re-exports. No `*-handlers/` folder. Existing Batch386–391 siblings stay. Do not create new `BatchNNN` / `Bulk` names.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorSpecialTargetOps.ts` | `SpecialTargetStepResult`, normalize helpers, `collectBoundIds`, exile ops. |
| `oracleIRExecutorSpecialTargetResolve.ts` | `resolveSourcePermanent`, `resolveEnchantedHost`, `resolveContextualCreature`. |
| `oracleIRExecutorExileLookedContextualHandlers.ts` | `tryApplyExileLookedContextualStep` (looked/contextual, top mill, mass nontoken, “the rest”). |
| `oracleIRExecutorExilePileCounterAndTargetedHandlers.ts` | `tryApplyExilePileCounterAndTargetedStep` (face-down piles, source counters, until-leaves, targeted). |
| `oracleIRExecutorSpecialTargetDestroyHandlers.ts` | `trySpecialDestroyStep`. Mass `all non-<subtype> creatures` is not intercepted (generic destroy / GY). |
| `oracleIRExecutorSpecialTargetAddRemoveCounterHandlers.ts` | `trySpecialAddCounterStep`, `trySpecialRemoveCounterStep`. |
| `oracleIRExecutorSpecialTargetRegenerateDamageHandlers.ts` | `trySpecialRegenerateStep`, `trySpecialDealDamageStep`, `trySpecialPreventDamageStep`. |
| `oracleIRExecutorChosenCreaturePowerSweepDamage.ts` | `tryChosenCreaturePowerSweepDealDamageStep` — chosen/targeted creature deals damage equal to its power to each other creature (skips the bound source). Generic `deal_damage` excludeSourceId only drops the spell. |
| `oracleIRExecutorFightStep.ts` | `tryApplyFightDealDamageStep` — CR 701.14 fight from `deal_damage` steps (`X fights Y`, those creatures fight each other). Marks power damage both ways. Called from `applyDealDamageStep` before the Batch391 log-only stubs. |
| `oracleIRExecutorSpecialTargetDoubleCountersHandlers.ts` | `trySpecialDoubleCountersStep`. |
| `oracleIRExecutorSpecialTargetSacrificeHandlers.ts` | `trySpecialSacrificeStep`. |
| `oracleIRExecutorSpecialTargetCopyPermanentHandlers.ts` | `trySpecialCopyPermanentStep`. |
| `oracleIRExecutorSpecialTargetCombatStatusHandlers.ts` | exert / turn-face-down / tap-or-untap / force-block / suspect. `trySpecialTapOrUntapStep` does **not** short-circuit “untap all creatures you control **and** … opponent controls” (Reins of Power); that compound selector is resolved in `applyTapOrUntapStep`. |
| `oracleIRExecutorSpecialTargetMoveCountersHandlers.ts` | `trySpecialMoveCountersStep`, `trySpecialScheduleDelayedBattlefieldActionStep`. |

### `oracleIRExecutorConditionalStep*` (extracted from `evaluateConditionalWrapperCondition`)

Parent is a **5.7 KB** dispatcher: unless-kind + if/as_long_as normalize, then `tryEvaluate…` fall-throughs. Leaves return `boolean | null | undefined` (`undefined` = family did not match; `null` = matched but unevaluable). Recursion is `params.evaluateRecursive`. No leaf imports the public parent. `oracleIRExecutorConditionalStepSupportHelpers.ts` is **38.6 KB** — do not append.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorConditionalStepSupportHelpers.ts` | Shared types + helpers (`ConditionalCondition`, `resolveUnlessPayInnerCondition`, …). `getConditionalObjectZoneProvenance` only treats known zone names as `source` (player ids are not zones) and maps flashback-family / `castFromGraveyard` to graveyard. Re-exports share-type library-top helpers from `oracleIRExecutorConditionalStepShareTypeHelpers.ts`. |
| `oracleIRExecutorConditionalStepShareTypeHelpers.ts` | `topCardSharesCreatureTypeWithSource` (kinship) and `topCardSharesCreatureTypeWithControlledCreature` (Descendants' Path). Do not import SupportHelpers. |
| `oracleIRExecutorConditionalStepUnlessPay.ts` | `tryEvaluateConditionalUnlessPayYouDoOtherwise` (unless-pay, you-do/otherwise, enters-this-way, lands, first-combat). Share-type-with-you-control / kinship clauses return `undefined` so YouHaveGraveyard can own them. |
| `oracleIRExecutorConditionalStepCreaturesDied.ts` | `tryEvaluateConditionalCreaturesDiedThisTurn` (died, suspected, attacking, hand-size, legendary). |
| `oracleIRExecutorConditionalStepKicked.ts` | `tryEvaluateConditionalKicked` (kicked, “cast using teamwork/bargain/…”, composite and/or, graveyard-there-are). |
| `oracleIRExecutorConditionalStepYouHaveGraveyard.ts` | `tryEvaluateConditionalYouHaveGraveyard` (you-have-graveyard, entered-from, vote, mana-spent). `this spell was cast from a graveyard` prefers `ctx.castFromZone`, then `castFromGraveyard` / flashback-family flags, then object provenance. `you cast it from your hand` uses `castFromZone` / `castFromHand` provenance (null if unknown). `no mana was spent to cast it` prefers the bound stack spell at `targetSpellId` (Lavinia / Vexing Bauble), then source spend. Share-type-with-a-creature-you-control is evaluated before the generic “it's a … card” prefix matcher. |
| `oracleIRExecutorWinIfControlDifferentNames.ts` | `tryEvaluateWinIfControlDifferentNames` — unique-name control count. Runs before the broader “you control N or more X” matcher so “Gates with different names” is not treated as a type. |
| `oracleIRExecutorWinIfCastSameNameThisGame.ts` | `tryEvaluateWinIfCastSameNameThisGame` — cast-from-hand + another same-name-this-game. Reads `namedSpellsCastThisGame` persisted by `persistNamedSpellCastThisGame` (live via `recordSpellCastThisTurn`; also GY replay, replay `castSpell`, `copyStackItem`, live/IR/delayed stack copies, replay copy-resolve). |

### `oracleIRExecutorConditionalStepExtended*` (extracted from `evaluateExtendedConditionalClause`)

Parent is a **15.9 KB** dispatcher: `thisWay` → `would` → existing `evaluateBatch368–380` → `tryEvaluate…` fall-throughs. Leaves return `boolean | null`. `oracleIRExecutorConditionalStepExtendedClauseHelpers.ts` is **35.5 KB** — do not append. Do not create new `BatchNNN` / `Bulk` names.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorConditionalStepExtendedTypes.ts` | `ExtendedConditionalParams`, `LastActionOutcome`, `EXILE_THIS_WAY_STEP_KINDS`. |
| `oracleIRExecutorConditionalStepExtendedClauseHelpers.ts` | Shared helpers including `getControlledTypeEnteredThisTurnCount`. |
| `oracleIRExecutorConditionalStepExtendedThisWay.ts` | `evaluateThisWayClause`. |
| `oracleIRExecutorConditionalStepTypedCreatureClause.ts` | `tryEvaluateTypedCreatureClause`. Generic N-type conditionals (dealt damage / sacrificed / exiled this way, attacking, equipped, mana spent, entered/died this turn, GY+counter, opponent doesn't control, enchanted TYPE or TYPE). Not Dinosaur/Goblin/Pirate-only. |
| `oracleIRExecutorConditionalStepExtendedWarriorDamage.ts` | `tryEvaluateExtendedWarriorDamageClause` (warrior damage through surge-cost-paid). |
| `oracleIRExecutorConditionalStepExtendedProwl.ts` | `tryEvaluateExtendedProwlClause` (prowl through graveyard-has-flying). `you control four or more lands` is generic land-count (Fabled Passage). `you have the city's blessing` reads `state.cityBlessing` (fallback `citysBlessing`). |
| `oracleIRExecutorConditionalStepExtendedLessonCard.ts` | `tryEvaluateExtendedLessonCardClause` (lesson in graveyard …). |
| `oracleIRExecutorConditionalStepExtendedCycledCard.ts` | `tryEvaluateExtendedCycledCardClause`. |
| `oracleIRExecutorConditionalStepExtendedVotedChoice.ts` | `tryEvaluateExtendedVotedChoiceClause`. `you cast it from your hand` is not a true-stub; provenance lives in YouHaveGraveyard. |
| `oracleIRExecutorConditionalStepExtendedCommanderControl.ts` | `tryEvaluateExtendedCommanderControlClause`. |

### `oracleIRExecutorBattlefield*` (extracted from `oracleIRExecutorBattlefieldStepHandlers.ts`)

Parent is a **34.7 KB** barrel. Keep the `oracleIRExecutorBattlefield*` prefix. No `*-handlers/` folder. `applyGrantTemporaryAbilityStep` was **not** moved whole: early cases vs remaining body. `applyAddCounterStep` stays in the parent.

| Module | Owns |
| --- | --- |
| `oracleIRExecutorBattlefieldCantAttackStep.ts` | `applyCantAttackStep`. One-shot / this-turn / until-next-turn / static stamps `temporaryEffects` `"can't attack"`. In `ORACLE_IR_FALLBACK_STEP_KINDS` (with `cant_block`). Combat reads those descriptions via `getCombinedPermanentText` / `hasBlanketCantAttack`. |
| `oracleIRExecutorBattlefieldTapUntapSteps.ts` | tap / skip / optional untap. Compound “all creatures you control and all creatures target opponent controls” untaps both sides. Mass “all/each/every” selectors (Intruder Alarm “untap all creatures”) ignore ETB `targetPermanentId` pronoun binding in `resolveTapOrUntapTargetIds`. Empty mass apply uses the target text first so “Target player untaps all basic lands they control” is not poisoned by the word “target” in the instruction subject. Singular “that land” / “that creature” / “it” prefers last-moved, then `lastAntecedentBattlefieldPermanentIds` (steal), then `targetCreatureId` / `targetPermanentId`, then `chosenObjectIds` — never `battlefield.find` over the bound set (ETB watchers also stamp the entering source). Chosen library card ids bind via `perm.card.id`. “those permanents” after random control assignment uses `lastAntecedentBattlefieldPermanentIds` and does not queue a target prompt. |
| `oracleIRExecutorBattlefieldGainControlSteps.ts` | Generic `gain_control` uses `targetPermanentId` or `targetCreatureId` (trigger IR stamps both). **Self-references** (`this permanent` / `this creature` / source name) use `sourceId` so Humble Defector is donated, not treated as a creature target. `target_opponent` refuses the activator. Records `controlChangeEffects` and `lastAntecedentBattlefieldPermanentIds` so “Untap that creature. It gains flying and haste” follows the stolen permanent. Missing target returns `applied: false` — do not invent audit ids. Seat-order rotation lives in `oracleIRExecutorLoyaltyDirectionGainControl.ts`. |
| `oracleIRExecutorBattlefieldContextualTargets.ts` | `buildContextualBattlefieldTargetIds`. Singular “that land” / “that creature” after a search or put includes `lastMovedBattlefieldPermanentIds`. Plural “those permanents” also uses `lastAntecedentBattlefieldPermanentIds`. Chosen library card ids resolve to the new permanent’s `perm.id`. |
| `oracleIRExecutorBattlefieldContextualResolvers.ts` | `parseContextualBattlefieldReference`, `resolveContextualBattlefieldPermanents`, `resolveBoundSelectorMatches`. Mode `self` (`it` / `this creature`) skips ids that are not on the battlefield (attack-trigger defending-player bindings in `chosenObjectIds`) and, for `this creature`, skips non-creatures then falls back to the source or attached creature. Named self-references use `buildNameReferenceAliases` (comma-head length ≥ 3, so “put a loyalty counter on Ral” resolves to the source). |
| `oracleIRExecutorBattlefieldRecentlyMoved.ts` | `resolveRecentlyMovedBattlefieldPermanents` includes `that land`. |
| `oracleIRExecutorBattlefieldDoubleMoveCountersSteps.ts` | double / move counters |
| `oracleIRExecutorBattlefieldExchangeAndCopySteps.ts` | 1:1 exchange control, copy permanent. `share a card type` / `share a permanent type` on the step is a resolution restriction: apply no-op rather than swap (or fall through to legacy). |
| `oracleIRExecutorBattlefieldExchangeMassSteps.ts` | Mass `exchange_control` set-swap (`tryApplyMassExchangeControlStep`). Reins of Power “all creatures you control” / “all creatures that opponent controls”. Stamps `controlChangeEffects` `until_end_of_turn` and `lastAntecedentBattlefieldPermanentIds` so haste follows. Selectors: `that opponent controls` / leading `nontoken` on `parseSimpleBattlefieldSelector`. |
| `oracleIRExecutorBattlefieldCantActivateAbilitiesStep.ts` | `applyCantActivateAbilitiesStep` |
| `oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts` | `applyGrantStaticAbilityStep`. Stack-spell keyword grants (`that spell` / `this spell`) go through `tryApplyGrantKeywordsToStackSpell` before the battlefield fallback. |
| `oracleIRExecutorBattlefieldGrantStackSpell.ts` | `tryApplyGrantKeywordsToStackSpell` — stamps `grantedAbilities` on the stack spell at `targetSpellId` (“that spell gains deathtouch and lifelink”). Damage after pop uses `sourceGrantedAbilities` on the IR context. |
| `oracleIRExecutorPreventLifeGainThisTurn.ts` | `tryApplyPreventLifeGainThisTurnGrant` — stamps `lastingEffects.preventLifeGain` (with `this_turn` / `end_of_turn` duration) for you / target player / players / opponents. Cleanup expires those stamps. Continuous `static` unchanged. Alchemy A- skipped. |
| `oracleIRExecutorAttackTaxThisTurn.ts` | `tryApplyAttackTaxThisTurnGrant` — stamps `lastingEffects.attackTaxGeneric` (global War Tax / optional attack-you) plus `attackTaxLife` (Sivitri). |
| `oracleIRExecutorUnlessPaysManaAmount.ts` | `resolveUnlessPaysManaCostString` — `{N}` / `{X}` where-X / `{N} for each` / plus-additional / energy-revealed-discarded this way. Whirlwind does **not** multiply `{N}` by stack count (per-object iteration). |
| `oracleIRExecutorUnlessPaysForEachPermanents.ts` | `resolveUnlessPaysForEachPermanentIds`, `resolveUnlessPaysForEachStackObjectIds`, `bindUnlessPaysForEachContext`, `bindUnlessPaysForEachStackContext`, `stripUnlessPaysChoiceFromContext` — Heroism attacking-color / Giant Albatross dealt-damage this turn / those creatures / Whirlwind opponent stack objects. |
| `oracleIRExecutorUnlessPaysManaStep.ts` | `evaluateUnlessPaysManaStep` — variable unless-pay, `manaOptions`, bound stack/permanent ids (includes `sourceId`) in choice metadata. Unstamped taxes prompt even with an empty pool so the player can tap lands (Rupture Spire). `{E}`-only costs prompt `player_choice_required` instead of failing as unsupported mana. Re-exported from `oracleIRExecutorPlayerStepHandlers.ts`. |
| `oracleIRExecutorPayEnergyStep.ts` | `applyPayEnergyStep` — “you may pay any amount of `{E}`”; stamps `energyPaidThisWay` / `referenceAmount` (Aether Spike / Galvanic Discharge). |
| `oracleIRExecutorBlockTaxThisTurn.ts` | `tryApplyBlockTaxThisTurnGrant` — stamps `lastingEffects.blockTaxGeneric` (global War Cadence). |
| `oracleIRExecutorAttackYouProhibitedExceptKeywords.ts` | `tryApplyAttackYouProhibitedExceptKeywordsGrant` — stamps `lastingEffects.attackYouProhibitedExceptKeywords` until your next turn. |
| `oracleIRExecutorUntilEotProtectionOverride.ts` | `tryApplyUntilEotProtectionOverrideGrant` — stamps `lastingEffects` `protectionKeywordOverride` (`asThoughController` / `remove`) until cleanup. Idle land is not a continuous static. |
| `oracleIRExecutorBattlefieldGrantTemporaryTargetText.ts` | infer/normalize grant target text |
| `oracleIRExecutorBattlefieldGrantTemporaryAbilityEarlyCases.ts` / `…GrantTemporaryAbilityStep.ts` | grant-temporary split. Empty-target `it gains … until end of turn` stamps the source/attached creature (`temporaryEffects` / `grantedAbilities`); that rider is not a player-level `staticAbilityGrantEffects` bag (combat and badges do not read that bag for deathtouch/indestructible). `those creatures also gain <keyword>` falls back to creatures you control. |
| `oracleIRExecutorBattlefieldDestroyTargets.ts` / `…DestroyStep.ts` | destroy targeting + step. `all non-<subtype> creatures` is generic (Wakening Sun's Avatar / Hythonia). Mass non-subtype destroy is not a special exile intercept. CR 702.12: generic destroy skips indestructible (until-EOT grants, keywords, counters, attachments). Special "destroy a permanent with indestructible" still goes through `trySpecialDestroyStep`. Empty `target` destroy (qualified attackers, flying, etc.) skips `player_choice_required`. |
| `oracleIRExecutorBattlefieldIndestructible.ts` | `executorPermanentHasIndestructible`. Used by `applyDestroyStep`. Does not treat Equipment/Aura oracle that *grants* indestructible as a self-grant. |
| `oracleIRExecutorBattlefieldBendAndAnimateSteps.ts` | airbend, earthbend, animate |
| `oracleIRExecutorBattlefieldExileStep.ts` | exile step + zone/stack/metadata helper siblings. `exileChosenSpellsFromStack` exiles bound stack ids (Mindbreak Trap “any number of target spells”), including object-shaped stacks. `normalizeExileTargetReferenceText` strips leading Devoid/Convoke/Delve. Empty `target` exile skips `player_choice_required`. |
| `oracleIRExecutorBattlefieldSacrificeSteps.ts` | sacrifice apply + helper siblings (`…SacrificeWhat.ts` already existed). `N creatures of their choice` (N>1) is `player_choice_required` instead of auto-picking one. |
| `oracleIRExecutorBattlefieldDelayedBattlefieldActionStep.ts` | delayed battlefield action + helper siblings. Destroy fallbacks: attached Equipment, that Wall, source + creatures it blocked. Empty “all Equipment” / “the tokens” schedules as applied no-op. |
| `oracleIRExecutorBattlefieldRemoveCounterStep.ts` | remove-counter targets + step. `up to one target` with 0 matches is an applied no-op; several matches skip `player_choice_required`. |
| `oracleIRExecutorBattlefieldAddCounterAmount.ts` / `…AddCounterDistribute.ts` | add-counter helpers (`applyAddCounterStep` still in the parent) |

### `oracleIRExecutorMainLoop*` (extracted from `applyOracleIRStepsToGameStateImpl`)

Parent is a **29.4 KB** dispatcher. Each family returns `result | undefined` (undefined = fall through). Leaves must not import `oracleIRExecutorMainLoop.ts`. Shuffle `lastMovedCountByPlayer` is copied from the raw applied result onto the loop let and `currentCtx` before `sanitizeBridgedStepCarryOver` (same idea as restoring `lastMilledCards`) and restamped at each step start so "that many" reveal after Warp World shuffle still sees per-player counts. Bridged `reveal_top` also restores `lastMovedCards` / `lastRevealedCards` after sanitize so the ACL put can look up by owner; those keys are not in `BRIDGED_STEP_CARRY_OVER_KEYS`. A 903.9a commander-zone replacement halt still skips that zone-change step (creature stays on the battlefield for `movePermanentToExile`) but does not set `haltedForPlayerChoice`, so LKI riders such as Swords life gain still apply in the same pass.

| Module | Entry |
| --- | --- |
| `oracleIRExecutorMainLoopStepTypes.ts` | `RecurseExecutor`, `MainLoopStepFamilyCtx`. `pickMainLoopFamilyCore` / `pullMainLoopFamilyCoreFromCtx` include `lastMovedCountByPlayer` so mill shuffle counts survive the family switch into `reveal_top`. |
| `oracleIRExecutorMainLoopCounterSpellStep.ts` | `applyCounterSpellStep`, `isPlayerStillInGame`. Bulk “all other spells” / “counter all abilities” (Summary Dismissal / Swift Silence) wipe matching stack objects without a target prompt and ignore a leftover `targetSpellId`. “exile all other spells” puts those spells into exile. Reads array or `{ objects }` stacks. `counter that spell` / `it` with an empty stack is an applied no-op (instead-branch after the spell is already gone). |
| `oracleIRExecutorMainLoopExileRestrictionSteps.ts` | `tryApplyMainLoopExileRestrictionSteps` |
| `oracleIRExecutorMainLoopCoinDieDrawSteps.ts` | `tryApplyMainLoopCoinDieDrawSteps` |
| `oracleIRExecutorMainLoopLibraryTurnControlSteps.ts` | `tryApplyMainLoopLibraryTurnControlSteps`. Includes `join_forces` and `tempting_offer` halt cases (`applyJoinForcesStep` / `applyTemptingOfferStep`). `choose_opponent` with zero eligible opponents (more lands than you) is an applied no-op. |
| `oracleIRExecutorMainLoopChoiceKeywordLookSteps.ts` | `tryApplyMainLoopChoiceKeywordLookSteps`. `reveal_top` merges `lastMovedCountByPlayer`, `lastMovedCards`, and `lastRevealedCards` onto `currentCtx` and passes the loop counts into `applyRevealTopStep` so Warp World / Glimpse "that many" sees per-player shuffle counts after 903.9a leftover resume. |
| `oracleIRExecutorMainLoopMillPtTokenSteps.ts` | `tryApplyMainLoopMillPtTokenSteps`. Includes `pay_energy` (stamps `energyPaidThisWay` / `referenceAmount`). |
| `oracleIRExecutorMainLoopCopyDestroySteps.ts` | `tryApplyMainLoopCopyDestroySteps`. Optional `copy_spell` (`you may cast the copy`) always creates a playable exile copy; it does not auto-replay the copied card's steps (Narset / Divination in combat). |
| `oracleIRExecutorMainLoopLateSteps.ts` | `tryApplyMainLoopLateSteps`. **Ledger:** a successful `conditional` records inner/else `appliedSteps` only; push the wrapper iff that branch applied nothing. Do not always append `'conditional'` after inner steps (31-test regression after the MainLoop split). Court of Ambition discarded/no-life-loss asserts `['unless_discards']`, not the wrapper. `unless_pays_mana` / `unless_pays_life` iterate `forEachPermanentText` (Heroism / Giant Albatross / those creatures) and `forEachOpponentStackObjects` (Whirlwind Denial, `{N}` each). Paid follow-ups use `paidSteps` (Winter's Chill pays-only). Skipping `unless_pays_mana` for `player_choice_required` also records nested steps (Phantasmal Forces sacrifice) as skipped. `pay_energy` lives in mill/P/T/token steps. |
| `oracleIRExecutorRepeatedZoneDraft.ts` | Thieves' Auction-style `repeated_zone_draft`: auto-picks in turn order, skips Auras with no legal host, attaches to a preferred or first host/player, leaves leftover illegal Auras in exile. Live picks with more than one legal host require `attachId` (`repeatedZoneDraftNeedsExplicitAttachId`). Entries: `applyRepeatedZoneDraftStep`, `isRepeatedZoneDraftPickLegal`, `filterLegalRepeatedZoneDraftCardIds`, `findNextRepeatedZoneDraftChooserIndex`, `resolveRepeatedZoneDraftAuraAttachId`, `buildRepeatedZoneDraftCardChoiceInfo`, `repeatedZoneDraftNeedsExplicitAttachId`. |
| `oracleIRExecutorAuraEnterAttachment.ts` | Aura/Curse enter-attached resolution for revealed-this-way waves and zone drafts. Wave-1 host snapshots so same-wave enchantments are not legal hosts (Warp World 2009). Entries: `resolveAuraEnterAttachment`, `findLegalAuraBattlefieldHostIds`, `findLegalAuraPlayerIds`. |
| `oracleIRExecutorWarpWorldInteractive.ts` | Interactive Warp World / Glimpse-family skips: 903.9a commander library-or-command, APNAP Aura-host announce, remainder `order: 'any'` BOTTOM_ORDER. Entries: `trySkipCommanderLibraryChoice`, `trySkipEnchantmentWaveAuraAttach`, `trySkipRevealedThisWayRestAnyOrder`, `collectRemainderCardSnapshots`. Sequential 903.9a prompts fold remaining steps into `oracleIrChoiceStepJson` for both command-zone and shuffle-into-library answers (only `commanderLibraryChoices` differs). Empty remainder continuation must not inherit those reveal/put steps. Remainder skip also stamps `allRemainderCardIds` / `allRemainderCardsJson` (every player's leftovers) so the next BOTTOM_ORDER resume does not treat put-wave permanents as lastMovedCards. Remainder grouping consumes per-card owner stamps so two libraries sharing a Scryfall id are not dropped, and ignores a same-id copy still in hand (the revealed leftover is the library card). Commanders write `commandZone.inCommandZone`. Remainder skip+order is applied from `oracleIRExecutorMoveZoneGuardsAnotherFromGraveyard.ts` (`parsedAllOtherCardsRevealedThisWay`; Warp World remainder) with a fallback in `oracleIRExecutorMoveZoneGuardsThatCardReference.ts`. Remainder skip stamps `remainderCardsJson` (name/`image_uris`) so BOTTOM_ORDER does not fall back to `{ name: id }`. `order: 'random'` (Glimpse) stays unprompted. Dry-run leaves these unset. |
| `coinFlipIgnoreOneReplacement.ts` | Krark's Thumb family: `if you would flip a coin, instead flip two coins and ignore one`. Entries: `countCoinFlipIgnoreOneReplacements`, `generateCoinFlipResultWithIgnoreOne`, `resolveCoinFlipWithIgnoreOne`. Nested copies replace each individual flip. Dry-run auto-keeps a called side when either coin matches; interactive play prompts whenever a pair differs and replays locked `rawFlips`. |
| `oracleIRExecutorTemporaryEtbWindowStep.ts` | `applyGrantTemporaryEtbTriggerStep` — this-turn ETB window (`grant_temporary_etb_trigger`). |
| `oracleIRExecutorEachPlayerChooseDestroyRest.ts` | `each_player_choose_then_destroy_rest` (Divine Reckoning family). |
| `oracleIRExecutorEachPlayerChooseSacrificeRest.ts` | `each_player_choose_then_sacrifice_rest`. Halt when a chooser controls more than N of the printed types; otherwise later steps continue and nothing is sacrificed. |
| `oracleIRExecutorSecretOpponentChoiceDamage.ts` | `secret_opponent_choice_damage` (Prisoner's Dilemma family). |
| `oracleIRExecutorMayCastFromAmong.ts` | `may_cast_from_among` (mill-from-among may-cast). Needs `ctx.lastMilledCards` after mill; `applyMillStep` restores those cards after server-bridge ledger omit. |
| `oracleIRExecutorMayRevealHandWinIfOwnNamed.ts` | `may_reveal_hand_then_win_if_own_named_in_zones` (may-reveal four-zone named-copy win). Entries: `applyMayRevealHandWinIfOwnNamedStep`, `playerOwnsNamedCardInFourWinZones`, `applyWinIfOwnNamedInFourZones`. Apply returns `player_choice_required`; win is stamped after Reveal. |
| `oracleIRExecutorLoyaltyDirectionGainControl.ts` | Seat-order rotation for Choose left or right `gain_control` (lands + source PW stay). Random “for each (nonland) permanent, choose a player at random / for which they were chosen” lives in `oracleIRExecutorBattlefieldGainControlSteps.ts` (Scrambleverse). |
