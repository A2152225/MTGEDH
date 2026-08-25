/**
 * game-state-effects.ts
 * 
 * Handles global game state effects:
 * 
 * WIN CONDITIONS:
 * - Felidar Sovereign: Win at upkeep if 40+ life
 * - Thassa's Oracle: Win when ETB if devotion >= cards in library
 * - Laboratory Maniac: Win instead of losing when drawing from empty library
 * - Jace, Wielder of Mysteries: Same as Lab Man
 * - Heliod, Sun-Crowned + Walking Ballista: Infinite combo
 * - Approach of the Second Sun: Win when cast second time from hand
 * - Mortal Combat: Win at upkeep if 20+ creatures in graveyard
 * - Epic Struggle: Win at upkeep if 20+ creatures on battlefield
 * - Biovisionary: Win at end step if you control 4+ Biovisionaries
 * - Revel in Riches: Win at upkeep if 10+ Treasures
 * - Mechanized Production: Win at upkeep if 8+ artifacts with same name
 * - Maze's End: Win when you control 10 different Gates
 * - Simic Ascendancy: Win at upkeep if 20+ growth counters
 * - Happily Ever After: Win at upkeep if 5 colors + 6 card types + 6+ life
 * - Barren Glory: Win at upkeep if no cards in hand and no other permanents
 * 
 * LOSE CONDITIONS:
 * - 0 or less life
 * - Drawing from empty library
 * - 10+ poison counters
 * - 21+ commander damage from single commander
 * - Card effects (Pacts, Door to Nothingness, etc.)
 * 
 * LIFE MODIFICATION:
 * - Platinum Emperion: Life total can't change
 * - Teferi's Protection: Life total can't change until end of turn
 * - Tainted Remedy: Life gain becomes life loss for opponents
 * - Erebos: Opponents can't gain life
 * - Sulfuric Vortex: Players can't gain life
 * - Leyline of Punishment: Damage can't be prevented, can't gain life
 * 
 * PHASED OUT RULES:
 * - Treated as though they don't exist
 * - Can't be targeted, attacked, affected by spells/abilities
 * - Don't count for devotion, creature counts, etc.
 * - Auras/Equipment stay attached but also phased out
 */

export {
  isPhasedOut,
  getActivePermanents,
  getActiveControlledPermanents,
  countCreatures,
  calculateDevotion,
} from "./game-state-effects-handlers/gameStateEffectsBattlefieldQueries.js";
export {
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
} from "./game-state-effects-handlers/gameStateEffectsReplacementApply.js";
export type {
  ReplacementEffectType,
  ReplacementEffect,
  ReplacementEffectOrderPreference,
} from "./game-state-effects-handlers/gameStateEffectsReplacementApply.js";
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
} from "./game-state-effects-handlers/gameStateEffectsAbilityConditions.js";
export type { AbilityStateCondition } from "./game-state-effects-handlers/gameStateEffectsAbilityConditions.js";
export { isTreasureToken, isArtifactTokenSubtype } from "./game-state-effects-handlers/gameStateEffectsTokenSubtype.js";
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
} from "./game-state-effects-handlers/gameStateEffectsWinLose.js";
export type {
  WinCondition,
  LifeModifier,
  CantLoseEffect,
} from "./game-state-effects-handlers/gameStateEffectsWinLose.js";
export {
  calculateMaxLandsPerTurn,
  applyTemporaryLandBonus,
  clearTemporaryLandBonuses,
  detectSpellLandBonus,
  calculateAdditionalDraws,
} from "./game-state-effects-handlers/gameStateEffectsLandPlayDraw.js";
export {
  canLookAtTopOfLibrary,
  canPlayLandsFromTop,
  canCastFromTop,
  getLibraryTopCardFromState,
  libraryTopCardHasType,
  getTopCardForPlayer,
  recalculatePlayerEffects,
} from "./game-state-effects-handlers/gameStateEffectsTopLibrary.js";
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
} from "./game-state-effects-handlers/gameStateEffectsMillDamage.js";
export type {
  CombatDamageReplacementEffect,
  OpponentDamageReplacementResult,
  DetectedPreventDamageMillReplacement,
  ResolvedOpponentDirectedDamage,
} from "./game-state-effects-handlers/gameStateEffectsMillDamage.js";

