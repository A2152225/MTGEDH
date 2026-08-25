# MTG logic module map — client

Peeled from `docs/mtg-logic-module-map.md` (`## Client`).
Coordinator owns this file. Extract chats must not edit it — paste owed rows.

## Client (MTG logic only)

Wave 13–14 complete. All scanned logic `.ts`/`.tsx` files are under 40960 bytes (`node tools/ts-logic-file-sizes.mjs`).

### `App-handlers/` (extracted from `client/src/App.tsx`)

Public leftover **36.0 KB** (near ceiling — do not append). Keeps `App` (**35.5 KB** leftover: wires `useGameSocket` → early/late state → leftover handlers → runtime → `renderAppPlayShell`). Never create `App/` beside `App.tsx`. Leaves must not import the parent or the index. Do not append to `appPlaySocketEffects.ts` (**33.9 KB**), `appPlayLayoutMain.tsx` (**31.3 KB**), `appResolutionStepPromptLate.ts` (**30.3 KB**), `appResolutionStepPromptEarly.ts` (**29.9 KB**), `appLoopShortcutHandlers.ts` (**29.8 KB**), or `appPlayShell.tsx` (**29.0 KB**).

| Module | Owns |
| --- | --- |
| `App-handlers/index.ts` | Internal TOC. Named re-exports only. **3.3 KB**. |
| `appAutoPassHandlers.ts` | `useAppAutoPassHandlers`, `AppAutoPassHandlerDeps`. |
| `appResolutionPromptHelpers.ts` | `useAppResolutionPromptHelpers`. |
| `appLoopShortcutHandlers.ts` | `useAppLoopShortcutHandlers`, `AppLoopShortcutHandlerDeps`. **29.8 KB**. |
| `appPlaySocketEffects.ts` | `useAppPlaySocketEffects`, `AppPlaySocketEffectDeps`. **33.9 KB**. |
| `appPlayOverlaysEarly.tsx` | `renderAppPlayOverlaysEarly`. **28.3 KB**. |
| `appDismissResolutionStepUi.ts` | `useAppDismissResolutionStepUi`. **4.9 KB**. |
| `appResolutionStepPromptEarly.ts` | `handleAppResolutionStepPromptEarly`. **29.9 KB**. |
| `appResolutionStepPromptLate.ts` | `handleAppResolutionStepPromptLate`. **30.3 KB**. |
| `appResolutionStepPromptEffects.ts` | `useAppResolutionStepPromptEffects`. **14.6 KB**. |
| `appPlayModalHandlers.ts` | `useAppPlayModalHandlers`. **19.6 KB**. |
| `appPlayCombatHandlers.ts` | `useAppPlayCombatHandlers`. **19.4 KB**. |
| `appPlayLayoutMain.tsx` | `renderAppPlayLayoutMain`. **31.3 KB**. |
| `appPlayLayoutRail.tsx` | `renderAppPlayLayoutRail`. **23.2 KB**. |
| `appPlayOverlaysLate.tsx` | `renderAppPlayOverlaysLate`. **28.1 KB**. |
| `appPlayOverlaysMid.tsx` | `renderAppPlayOverlaysMid`. **17.8 KB**. |
| `appPlayOverlaysChoice.tsx` | `renderAppPlayOverlaysChoice`. **20.7 KB**. |
| `appPlayOverlaysCombat.tsx` | `renderAppPlayOverlaysCombat`. **19.0 KB**. |
| `appPlayDerivedEffects.ts` | `useAppPlayDerivedEffects`. **23.9 KB**. |
| `appPlayStateEarly.ts` | `useAppPlayStateEarly`. **22.9 KB**. |
| `appPlayStateLate.ts` | `useAppPlayStateLate`. **23.9 KB**. |
| `appPlayShell.tsx` | `renderAppPlayShell`. **29.0 KB**. |
| `appPlayLeftoverHandlers.ts` | `useAppPlayLeftoverHandlers`. **9.6 KB**. |
| `appPlayRuntime.ts` | `useAppPlayRuntime`. **20.9 KB**. |

### `types-handlers/` (extracted from `shared/src/types.ts`)

Public leftover **34.4 KB**. Keeps `GameState` (8.0 KB), `SHORTCUT_ELIGIBLE_TRIGGERS` (4.1 KB), Player/zones, stack/combat/house-rules/durable-permission, payment types, trigger-shortcut helpers. Public path stays `shared/src/types.ts`. Never create `types/index.ts`. Do **not** put leaves in `shared/src/types/` (legacy unused GameState/Player/Card). Leaves must not import the parent or the index.

| Module | Owns |
| --- | --- |
| `types-handlers/index.ts` | Internal TOC. Named re-exports only. |
| `identityTypes.ts` | `GameID`, `PlayerID`, `SeatIndex`, `GameFormat`. |
| `cardRefTypes.ts` | `ImageUris`, `CardFace`, `KnownCardRef`, `HiddenCardRef`, `CardRef`. |
| `manaPoolTypes.ts` | `ManaRestrictionType`, `RestrictedManaEntry`, `ManaPool`. |
| `playerRef.ts` | `PlayerRef` (not the unused `types/Player.ts` copy). |
| `battlefieldPermanent.ts` | `BattlefieldPermanent`, `PermanentModifier`, `PTBonusSource`, `MutatedCardInStack`, `MutatedCardStack`, `TemporaryEffect`. |

### `DeckManagerModal-handlers/` (extracted from `client/src/components/DeckManagerModal.tsx`)

Public leftover **38.4 KB** (~1.6 KB headroom). Keeps `DeckManagerModal` (36.3 KB leftover: state/socket/tether, styles, JSX `content`). Never create `DeckManagerModal/` beside the `.tsx`. Leaves must not import the parent or the index. Do not append to the parent.

| Module | Owns |
| --- | --- |
| `DeckManagerModal-handlers/index.ts` | Internal TOC. Named re-exports only. |
| `deckManagerModalRandomImportHandlers.ts` | Nested precon/random import + initial-action effect. `useDeckManagerModalRandomImportHandlers`, `DeckManagerModalRandomImportHandlerDeps`. **4.4 KB**. |
| `deckManagerModalSaveCacheHandlers.ts` | Nested local/server save, import, rename, delete, cache. `createDeckManagerModalSaveCacheHandlers`, `SavedLocalDeck`, `DeckManagerModalTab`, `DeckManagerModalSaveCacheHandlerDeps`. **9.9 KB**. |

### `TargetSelectionModal-handlers/` (extracted from `TargetSelectionModal.tsx`)

Public leftover **38.7 KB** (~1.3 KB headroom). Keeps `TargetSelectionModal` (37.5 KB leftover: hooks/state, grouping memos, target grid JSX). Re-exports `TargetType`, `TargetOption`, `TargetSelectionGroup`, `TargetSelectionModalProps`, `isGroupedTargetSelectionComplete`. Never create `TargetSelectionModal/` beside the `.tsx`. Leaves must not import the parent or the index. Do not append to the parent.

| Module | Owns |
| --- | --- |
| `TargetSelectionModal-handlers/index.ts` | Internal TOC. Named re-exports only. |
| `targetSelectionModalSupport.tsx` | `TargetType`, `TargetOption`, `TargetSelectionGroup`, `isGroupedTargetSelectionComplete`, `formatControllerGroupLabel`, `ownershipStyle`, `PermanentOwnershipBadge`, `PermanentTargetCaption`, `TargetSelectionModalProps`. |

### `TableLayout-handlers/` (extracted from `client/src/components/TableLayout.tsx`)

Public leftover **39.0 KB** (~1 KB headroom). Keeps `TableLayout` (37.4 KB leftover: props, layout memos, battlefield-activate / deck-import helpers, chrome JSX). Never create `TableLayout/` beside the `.tsx`. Leaves must not import the parent or the index. Do not append to the parent or to `tableLayoutPlayerSeat.tsx` (**37.0 KB**).

| Module | Owns |
| --- | --- |
| `TableLayout-handlers/index.ts` | Internal TOC. Named re-exports only. |
| `tableLayoutManaSource.ts` | `isManaSource` (+ `stripCreateTokenTypeReminders`). |
| `tableLayoutGeometry.ts` | `clamp`, `isLandTypeLine`, `rotatePoint`, `getTotalFloatingMana`, `MIN_INITIAL_ZOOM`, `sidePlan`, `buildPositions`, `computeExtents`, `Side`, `PlayerBoard`, `HandCard`. |
| `useTableLayoutViewport.ts` | `useTableLayoutViewport` — pan/zoom, pointer gestures, fit/focus, expand/badge/zone-menu state. |
| `tableLayoutPlayerSeatHeader.tsx` | Nested seat header row. `TableLayoutPlayerSeatHeader`. |
| `tableLayoutPlayerSeat.tsx` | Remaining seat locals + board/hand/zones JSX. `renderTableLayoutPlayerSeat`. **37.0 KB**. |

### `loopShortcuts-handlers/` (extracted from `client/src/utils/loopShortcuts.ts`)

Public leftover **26.6 KB**. Re-exports `buildResolutionResponsePayload`, types, and iteration constants. Keeps record/storage helpers, `createRecordedResolutionResponseItem`, payment templates, `buildIdTemplate`, and advance/pass helpers. Never create `loopShortcuts/` beside the `.ts`. Leaves must not import the parent or the index.

| Module | Owns |
| --- | --- |
| `loopShortcuts-handlers/index.ts` | Internal TOC. Named re-exports only. |
| `loopShortcutsTypes.ts` | Types, storage keys, `clampLoopShortcutIterations`. |
| `loopShortcutsTextUtils.ts` | `normalizeText`, `clonePayload`. |
| `loopShortcutsTargetMatchUtils.ts` | Battlefield target-match primitives and candidate scoring. |
| `loopShortcutsPromptValidTargets.ts` | `getPromptValidTargetIds`. |
| `loopShortcutsIdSelectionsPayload.ts` | `buildIdSelectionsPayload`. |
| `loopShortcutsPaymentRebind.ts` | `rebindPaymentPermanentId`, `rebindProfileIds`. |
| `loopShortcutsResolutionResponsePayload.ts` | `buildResolutionResponsePayload`. |

### `CombatSelectionModal-handlers/` (extracted from `CombatSelectionModal.tsx`)

Public leftover **28.7 KB**. Keeps `CombatSelectionModal` (27.0 KB leftover: hooks/state, minimized chip, header banners, confirm/skip). Re-exports public types. Never create `CombatSelectionModal/` beside the `.tsx`. Leaves must not import the parent or the index.

| Module | Owns |
| --- | --- |
| `CombatSelectionModal-handlers/index.ts` | Internal TOC. Named re-exports only. |
| `combatSelectionModalTypes.ts` | `DefenderAttackInfo`, `CombatSelectionModalProps`, `AttackerSelection`, `BlockerSelection`. |
| `combatSelectionModalCreatureInfo.ts` | `getCreatureInfo`, `DangerIndicators`. |
| `combatSelectionModalGroupCreatures.ts` | `groupCreatures`, `CreatureGroup`. |
| `combatSelectionModalDangerBadges.tsx` | `DangerBadge`, `DangerIndicatorBadges`. |
| `combatSelectionModalAttackTarget.tsx` | `resolveAttackTargetLabel`, `AttackTargetBadge`, `getCombatCardPreviewHandlers`. |
| `combatSelectionModalSelectionSupport.ts` | `checkMenaceBlocking`, `cloneSelectedBlockers`, `getBlockerAssignments`, `countBlockingCreatures`, `countTotalBlockAssignments`, `splitCreatureGroups`, `buildAttackerSelections`. |
| `combatSelectionModalAttackerPanel.tsx` | Nested attacker-mode JSX (`CombatAttackerSelectionPanel`). |
| `combatSelectionModalBlockerPanel.tsx` | Nested blocker-mode JSX (`CombatBlockerSelectionPanel`). |

### `activatedAbilityParser-handlers/` (extracted from `client/src/utils/activatedAbilityParser.ts`)

Public leftover **10.5 KB**. Status / icon / format helpers (`getThresholdActivationStatus`, `canActivateTapAbility`, `getConditionalManaAbilityStatus`, `getActivatedAbilityActivationStatus`, `grantsHasteForTapAbilities`, `getAbilityIcon`, `formatAbilityCost`). Re-exports `parseActivatedAbilities`. Never create `activatedAbilityParser/` beside the `.ts`. Do not merge with rules-engine `parseActivatedAbilitiesFromText`. Do not append to `parseActivatedAbilities.ts` (**39.0 KB**). Leaves must not import the parent or the index.

| Module | Owns |
| --- | --- |
| `activatedAbilityParser-handlers/index.ts` | Internal TOC. Named re-exports only. |
| `activatedAbilityParserTypes.ts` | `ParsedActivatedAbility`, `TapOtherPermanentsCost`, `ActivationContext`. |
| `parseStationAndThresholdHelpers.ts` | `parseStationThreshold`, `parseThresholdGatedAbilityLine`, `normalizeAbilitySentence`. |
| `parseTimingRestrictionFromText.ts` | `parseTimingRestrictionFromText`. |
| `parseManaProduction.ts` | `parseManaProduction`. |
| `parseActivatedAbilityCostAndMill.ts` | `parseMillEffect`, `isSelfTapCost`, `parseCostComponents`. |
| `appendGrantedActivatedAbilities.ts` | `appendGrantedActivatedAbilities`, `pushUniqueParsedAbility`, `normalizeGrantedActivatedAbilityText`, `buildParsedAbilityFromGrantedLine`. |
| `parseActivatedAbilities.ts` | `parseActivatedAbilities` (**39.0 KB** — do not append). |

### `FreeField-handlers/` (extracted from `FreeField.tsx`)

Public leftover **34.9 KB**. Keeps `FreeField` (33.6 KB leftover). Never create `FreeField/` beside the `.tsx`. Leaves must not import the parent or the index. Do not append to `FreeFieldPermanentOverlays.tsx` (**35.5 KB**).

| Module | Owns |
| --- | --- |
| `FreeField-handlers/index.ts` | Internal TOC. Named re-exports only. |
| `freeFieldDisplayUtils.ts` | `permanentIdsForPositionUpdate`, `parsePT`, `computeDisplayPT`, `getPTColor`, `getLoyaltyColor`, `buildPTTooltip`, `getAbilityDisplay`. |
| `FreeFieldPermanentOverlays.tsx` | `FreeFieldPermanentOverlays` — battlefield-tile overlay badges. **35.5 KB**. |
| `useFreeFieldBattlefieldLayout.ts` | `useFreeFieldBattlefieldLayout` — grid placement + display-item `useMemo`. |

### `CreateGameModal-handlers/` (extracted from `CreateGameModal.tsx`)

Public leftover **34.3 KB**. Form state, submit/house-rule helpers, identity/format fields, house-rules JSX. Exports `CreateGameModal`, `GameFormat`, `HouseRulesConfig`, `AIOpponentConfig`, `GameCreationConfig`. Nested `CreateGameModal` leftover **30.8 KB** — do not pack into a near-40KB leaf. Never create `CreateGameModal/` beside the `.tsx`. Leaves must not import the parent or the index.

| Module | Owns |
| --- | --- |
| `CreateGameModal-handlers/index.ts` | Internal TOC. Named re-exports only. |
| `createGameModalAiOpponentsSection.tsx` | Nested AI opponents section (presets, deck select/import, save-as-preset). `CreateGameModalAiOpponentsSection`. |

### `CastSpellModal-handlers/` (extracted from `CastSpellModal.tsx`)

Public leftover **32.1 KB**. Re-exports `parseAlternateCosts` / `AlternateCost`. Keeps `filterAlternateCostsForCastZone`, `resolveEffectiveManaCostForCastStep`, `CastSpellModal` (26.0 KB leftover — do not pack into a near-40KB leaf). Never create `CastSpellModal/` beside the `.tsx`. Leaves must not import the parent or the index.

| Module | Owns |
| --- | --- |
| `CastSpellModal-handlers/index.ts` | Internal TOC. Named re-exports only. |
| `castSpellModalParseAlternateCosts.ts` | `AlternateCost`, `parseAlternateCosts`. Parent re-exports. |
