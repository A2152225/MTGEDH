// server/src/state/modules/game-state-effects-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/game-state-effects.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/game-state-effects.ts.
// Leaves must not import game-state-effects.ts or this index.

// Phased-out-aware battlefield queries (creature count, devotion).
export {
  isPhasedOut,
  getActivePermanents,
  getActiveControlledPermanents,
  countCreatures,
  calculateDevotion,
} from "./gameStateEffectsBattlefieldQueries.js";

// 616.1 replacement-effect order, detect, and apply (damage/life/counters/tokens/mill).
export {
  getReplacementEffectMode,
  getReplacementEffectPreference,
  sortEffectsByCustomOrder,
  applyBeneficialReplacements,
  applyDamageReplacementsMinimized,
  applyDamageReplacementsMaximized,
  applyReplacementsCustomOrder,
  detectDamageReplacementEffects,
  detectCounterReplacementEffects,
  detectLifeGainReplacementEffects,
  detectTokenCreationReplacementEffects,
  applyCounterReplacements,
  applyLifeGainReplacements,
  detectMillReplacementEffects,
  applyMillReplacements,
  applyTokenCreationReplacements,
} from "./gameStateEffectsReplacementApply.js";
export type {
  ReplacementEffectType,
  ReplacementEffect,
  ReplacementEffectOrderPreference,
} from "./gameStateEffectsReplacementApply.js";

// Metalcraft / threshold / delirium / coven and getActiveAbilityConditions.
export {
  hasMetalcraft,
  countArtifacts,
  hasThreshold,
  getGraveyardCount,
  hasDelirium,
  countCardTypesInGraveyard,
  hasSpellMastery,
  hasFerocious,
  hasFormidable,
  getTotalCreaturePower,
  hasCoven,
  getActiveAbilityConditions,
} from "./gameStateEffectsAbilityConditions.js";
export type { AbilityStateCondition } from "./gameStateEffectsAbilityConditions.js";

// Treasure / artifact token subtype checks.
export { isTreasureToken, isArtifactTokenSubtype } from "./gameStateEffectsTokenSubtype.js";

// Win / lose / can't-lose, life change, empty-library draw, ascend.
export {
  getPlayerLife,
  getLibraryCount,
  getHandCount,
  getGraveyardCards,
  detectWinConditions,
  checkUpkeepWinConditions,
  checkEndStepWinConditions,
  tryResolveThassasOracleWin,
  hasDrawWinReplacement,
  detectLifeModifiers,
  canLifeChange,
  canGainLife,
  lifeGainBecomesLoss,
  processLifeChange,
  checkLoseConditions,
  hasCantLoseEffect,
  checkEmptyLibraryDraw,
  applyAscendCitysBlessing,
  applyEmptyLibraryDrawConsequences,
  processPendingEmptyLibraryDrawAttempts,
} from "./gameStateEffectsWinLose.js";
export type { WinCondition, LifeModifier, CantLoseEffect } from "./gameStateEffectsWinLose.js";

// Additional land drops, temporary land bonuses, and additional draws.
export {
  calculateMaxLandsPerTurn,
  applyTemporaryLandBonus,
  clearTemporaryLandBonuses,
  detectSpellLandBonus,
  calculateAdditionalDraws,
} from "./gameStateEffectsLandPlayDraw.js";

// Top-of-library look/play/cast, hand reveal, recalculatePlayerEffects.
export {
  canLookAtTopOfLibrary,
  canPlayLandsFromTop,
  canCastFromTop,
  getLibraryTopCardFromState,
  libraryTopCardHasType,
  getTopCardForPlayer,
  recalculatePlayerEffects,
} from "./gameStateEffectsTopLibrary.js";

// Combat mill replacements, modified damage, applyCombatDamageReplacement.
export {
  calculateModifiedDamage,
  detectTypeRestrictedCombatMillReplacement,
  detectPreventDamageMillReplacementForController,
  detectAnotherCreaturePreventDamagePlusOneReplacement,
  detectCombatDamageReplacement,
  millSpecifiedPlayers,
  millAllOpponentsForController,
  resolveOpponentDirectedDamage,
  applyOpponentDamageReplacement,
  resolveCombatDamageToOpponent,
  canDamageBePrevented,
  applyCombatDamageReplacement,
} from "./gameStateEffectsMillDamage.js";
export type {
  CombatDamageReplacementEffect,
  OpponentDamageReplacementResult,
  DetectedPreventDamageMillReplacement,
  ResolvedOpponentDirectedDamage,
} from "./gameStateEffectsMillDamage.js";




