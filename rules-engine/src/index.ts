/**
 * MTG Rules Engine
 * Pure, deterministic rules engine implementing Magic: The Gathering Comprehensive Rules
 * Based on MagicCompRules 20251114.txt
 * 
 * All functions are side-effect free and operate on immutable inputs
 * 
 * Note: This module uses explicit named exports to avoid duplicate export conflicts.
 * Type definitions are the canonical source and are exported first.
 * Implementation modules with conflicting names export with aliases.
 */
import type { GameState, PlayerID } from '../../shared/src';

export interface EngineResult<T> {
  readonly next: T;
  readonly log?: readonly string[];
}

// =============================================================================
// CANONICAL TYPE EXPORTS (from ./types)
// These are the authoritative type definitions for the rules engine
// =============================================================================
export * from './types';

// =============================================================================
// IMPLEMENTATION MODULE EXPORTS
// These modules provide implementations. Where names conflict with types,
// we either skip the duplicate or use an alias.
// =============================================================================

// Rule 703: Turn-Based Actions
// Note: performDraw, performPhasing, performUntap have different signatures than types/turnStructure
// We export the implementation versions with aliases
export {
  TurnBasedAction,
  TurnBasedActionType,
  TURN_BASED_ACTIONS_NO_CONTROLLER,
  TURN_BASED_ACTIONS_HAPPEN_FIRST,
  TURN_BASED_ACTIONS_DONT_USE_STACK,
  performPhasing as executePhasingAction,
  performDayNightCheck,
  performUntap as executeUntapAction,
  performDraw as executeDrawAction,
  performSchemeAction,
  performLoreCounters,
  performRollAttractions,
  performChooseDefender,
  performDeclareAttackers as executeAttackerDeclaration,
  performDeclareBlockers as executeBlockerDeclaration,
  performAssignCombatDamage,
  performDealCombatDamage,
  performDiscardToHandSize,
  performCleanupDamageAndEffects,
  performEmptyManaPools,
} from './turnBasedActions';

// Rule 704: State-Based Actions
export * from './stateBasedActions';

// Rule 705-706: Coin Flip and Die Roll
export * from './coinFlip';
export * from './dieRoll';

// Rule 707: Copying Objects
export * from './copyingObjects';

// Rule 708: Face-Down Objects
export * from './faceDownObjects';

// Rule 709-711: Split, Flip, and Leveler Cards
export * from './splitCards';
export * from './flipCards';
export * from './levelerCards';

// Rule 712: Double-Faced Cards
// Note: ./types re-exports keywordActions which includes transform.ts
// Only export types/functions not already in keywordActions
export {
  CardFace,
  DoubleFacedCardType,
  FaceCharacteristics,
  DoubleFacedCard,
  determineFrontFace,
  isTransformingDoubleFacedCard,
  isModalDoubleFacedCard,
  getModalDFCCharacteristicsOutsideGame,
  chooseFaceToCast,
  putModalDFCOntoBattlefield,
  getModalDFCCopyCharacteristics,
  getCurrentFaceCharacteristics,
  SpecialBackFace,
  isSecondCard,
  getTransformingDFCCharacteristicsOutsideGame,
  canCastFace,
  putTransformingDFCOntoBattlefield,
  putTransformingDFCOntoBattlefieldTransformed,
  putTransformingDFCAsCopyOntoBattlefield,
  createTransformingTokenCopy,
} from './doubleFacedCards';

// Rules 713-719: Remaining Card Types
// Note: Some symbols conflict with ./types (castNormally, isCaseSolved)
export {
  AdventurerCard,
  hasAdventure,
  castAsAdventure,
  PrototypeCard,
  hasPrototype,
  getPrototypeCharacteristics,
  CaseCard,
  getActiveCaseAbilities,
  ClassCard,
  getActiveClassAbilities,
  getClassLevel,
  AttractionCard,
  AttractionDeck,
  createAttractionDeck,
} from './remainingCardTypes';

// Rules 720-732: Special Game Mechanics
// Note: StationAbility, CardCharacteristics conflict with ./types
export {
  MonarchState,
  becomeMonarch,
  shouldMonarchDraw,
  InitiativeState,
  takeInitiative,
  shouldVentureFromInitiative,
  DayNightState,
  initializeDayNight,
  checkDayNightChange,
} from './specialGameMechanics';

// Rule 702: Keyword Abilities
export * from './keywordAbilities';

// Rule 701: Keyword Actions (already exported via types)

// Rules Engine Adapter
export { RulesEngineAdapter, rulesEngine } from './RulesEngineAdapter';
// Re-export RulesEngineEvent and RulesEvent from core
export { RulesEngineEvent, type RulesEvent } from './core/events';

// AI Engine
export * from './AIEngine';

// Card Analyzer (AI card analysis and threat assessment)
export {
  CardAnalyzer,
  cardAnalyzer,
  CardCategory,
  ThreatLevel,
  SynergyArchetype,
  type CardAnalysis,
  type CardEffectDetails,
  type BattlefieldAnalysis,
} from './CardAnalyzer';

// Game Simulator
export * from './GameSimulator';

// Spell Casting (Rule 601) - exclude StackObject (conflicts with types)
export {
  type SpellCastingContext,
  type CastingResult,
  payManaCost,
  createStackObject,
  validateSpellTiming,
  castSpell,
} from './spellCasting';

// Mana Abilities (Rule 605) - ManaAbility conflicts with types
export {
  type TapForManaContext,
  activateManaAbility,
  canActivateManaAbility,
  tapPermanentForMana,
  createBasicLandManaAbility,
} from './manaAbilities';

// Stack Operations (Rule 405) - Stack, StackObject conflict with types
export {
  createEmptyStack,
  peekStack,
  isStackEmpty,
  getStackSize,
  resolveStackObject,
  counterStackObject,
} from './stackOperations';

// Activated Abilities (Rule 602) - ActivatedAbility, ActivationRestriction conflict
export {
  type ActivationContext,
  type ActivationResult,
  type ParsedCostComponent,
  type ParsedActivatedAbility,
  activateAbility,
  parseActivatedAbilitiesFromText,
  hasTapAbility,
  hasManaAbility,
  getManaAbilities,
} from './activatedAbilities';

// Triggered Abilities (Rule 603) - Many conflicts
export {
  TriggerKeyword,
  TriggerEvent,
  type TriggerQueue,
  type ParsedTrigger,
  createEmptyTriggerQueue,
  processEvent,
  parseTriggeredAbilitiesFromText,
  createEndStepTrigger,
  createLandfallTrigger,
  createCombatDamageToPlayerTrigger,
  createSpellCastTrigger,
  createLifeGainTrigger,
  createSacrificeTrigger,
  createCompoundTrigger,
  checkMultipleTriggers,
} from './triggeredAbilities';

// Static Abilities (Rule 604) - StaticAbility, StaticEffectType conflict
export {
  parseStaticAbilities,
  matchesFilter,
  calculateEffectivePT,
  collectStaticAbilities,
  applyStaticAbilitiesToBattlefield,
} from './staticAbilities';

// Triggered Effects Automation
export {
  TriggerType,
  EffectAction,
  type EffectTargetFilter,
  type TriggeredEffect,
  parseETBEffects,
  parseDiesTriggers,
  shouldEnterTapped,
  createETBTriggers,
  autoResolveTrigger,
} from './triggeredEffectsAutomation';

// Replacement Effects (Rule 614)
export {
  ReplacementEffectType,
  type ParsedReplacementEffect,
  type ReplacementResult,
  type ETBConditionCheck,
  parseReplacementEffectsFromText,
  evaluateETBCondition,
  applyReplacementEffect,
  collectReplacementEffects,
  sortReplacementEffects,
} from './replacementEffects';

// Game Events (Rule 603) - exclude TriggerCondition (conflicts with types)
export {
  GameEventType,
  type GameEvent,
  type GameEventData,
  type TriggerFilter,
  type EventTriggeredAbility,
  type PendingTrigger,
  createGameEvent,
  createCardDrawnEvent,
  createStepStartedEvent,
  matchesTriggerCondition,
  findTriggeredAbilitiesForEvent,
  createPendingTriggersFromEvent,
  sortTriggersByAPNAP,
  KNOWN_DRAW_TRIGGERS,
  detectDrawTriggers,
} from './gameEvents';

// Priority System (Rule 117)
export {
  type PlayerPrioritySettings,
  DEFAULT_PRIORITY_SETTINGS,
  createPrioritySettings,
  type PriorityState,
  type PriorityCheckResult,
  checkAutoPass,
  passPriority as priorityPassPriority,
  resetPriorityAfterAction,
  grantPriorityToActivePlayer,
  allPlayersPassed,
} from './prioritySystem';

// Cleanup Step (Rule 514)
export {
  type CleanupResult,
  type DamageTrackedPermanent,
  type CleanupStepState,
  createCleanupStepState,
  checkHandSize,
  clearDamageFromPermanents,
  endTemporaryEffects,
} from './cleanupStep';

// Library Search Effects
export * from './librarySearchEffects';

// Opening Hand Actions
export {
  OpeningHandActionType,
  type OpeningHandAction,
  type OpeningHandTriggerData,
  type OpeningHandResult,
  type OpeningHandPermanent,
  type DelayedTrigger,
  detectOpeningHandAction,
  parseChancellorTrigger,
  createOpeningHandAction,
  findOpeningHandActions,
} from './openingHandActions';

// Token Creation
export {
  type TokenCharacteristics,
  type TokenCreationRequest,
  type CreatedToken,
  type TokenCreationResult,
  type ETBTriggerInfo,
  type TokenTriggerInfo,
  COMMON_TOKENS,
  createTokenPermanent,
  parseTokenCreationFromText,
  detectTokenETBTriggers,
} from './tokenCreation';

// Combat Automation
export {
  type CombatKeywords,
  type CombatCreature,
  type AttackDeclaration,
  type BlockDeclaration,
  type DamageAssignment,
  type CombatResult,
  type CombatTrigger,
  type BlockValidation,
  extractCombatKeywords,
  getCreaturePower,
  getCreatureToughness,
  createCombatCreature,
  canCreatureAttack,
  canCreatureBlock,
  calculateLethalDamage,
} from './combatAutomation';

// Action Handlers - Many conflicts, export with care
export {
  // Sacrifice
  validateSacrifice,
  executeSacrifice,
  // Search Library
  validateSearchLibrary,
  executeSearchLibrary,
  type SearchLibraryAction,
  // Combat actions
  validateDeclareAttackers,
  executeDeclareAttackers,
  validateDeclareBlockers,
  executeDeclareBlockers,
  executeCombatDamage,
  isCurrentlyCreature,
  canPermanentAttack,
  canPermanentBlock,
  checkEvasionAbilities,
  getCombatDamageValue,
  getLegalAttackers,
  getLegalBlockers,
  type DeclareAttackersAction,
  type DeclareBlockersAction,
  type DealCombatDamageAction,
  type AttackerDeclaration,
  type BlockerDeclaration,
  type CombatDamageAssignment,
  type CombatValidationResult,
  // Fetchland
  validateFetchland,
  executeFetchland,
  createEvolvingWildsAction,
  createEnemyFetchlandAction,
  createAlliedFetchlandAction,
  type FetchlandAction,
  // Game phases - use aliases to avoid conflict with shared types
  GamePhase as RulesGamePhase,
  GameStep as RulesGameStep,
  getNextGameStep,
  isInCombat,
  PRIORITY_STEPS,
  // State-based actions handler
  performStateBasedActions,
  checkWinConditions,
  type SBAResult,
  // Turn actions
  executeUntapStep,
  executeDrawStep,
  executeTurnBasedAction,
  // Triggers handler
  processTriggers,
  findTriggeredAbilities,
  checkETBTriggers,
  checkDiesTriggers,
  checkStepTriggers,
  type TriggerResult,
  // Game setup
  initializeGame,
  drawInitialHand,
  processMulligan,
  completeMulliganPhase,
  // Game advancement
  advanceGame,
  skipToPhase,
  // Undo
  type UndoRequest,
  type UndoState,
  type RequestUndoAction,
  type RespondUndoAction,
  type UndoValidationResult,
  DEFAULT_UNDO_TIMEOUT_MS,
  generateUndoRequestId,
  createUndoState,
  recordEvent,
  validateUndoRequest,
  createUndoRequest,
  validateUndoResponse,
  processUndoResponse,
  checkUndoExpiration,
  getEventsForUndo,
  completeUndo,
  cancelUndo,
  getActionsToUndoCount,
  getUndoDescription,
  canRequestUndo,
  getUndoApprovalStatus,
  // Pillowfort effects (Propaganda, Ghostly Prison, Norn's Annex, etc.)
  detectPillowfortEffect,
  collectPillowfortEffects,
  calculateTotalAttackCost,
  checkAttackCosts,
  getAttackCostDescription,
  isPillowfortCard,
  COMMON_PILLOWFORT_CARDS,
  AttackCostType,
  type AttackCostRequirement,
  type AttackCostCheckResult,
} from './actions';

// Core types
export { 
  type ActionValidation,
  type BaseAction,
  type GameActionType,
  type ActionHandler,
  type ActionContext,
  type ActionRegistry,
} from './core';

// Player Counters (poison, energy, experience)
export {
  PlayerCounterType,
  type PlayerCounterState,
  type CounterChangeEvent,
  type CounterOperationResult,
  createPlayerCounterState,
  getPlayerCounter,
  addPlayerCounters,
  removePlayerCounters,
  payEnergy,
  canPayEnergy,
  hasLostDueToPoison,
  processInfectDamageToPlayer,
  processToxicCombatDamage,
  processPoisonousAbility,
  gainExperience,
  gainEnergy,
  getPlayerCounterTypes,
  playerHasCounters,
  proliferatePlayer,
} from './playerCounters';

// Emblem Support
export {
  type Emblem,
  type EmblemSpec,
  type EmblemCreationResult,
  type EmblemAbilityInfo,
  createEmblem,
  createEmblemFromPlaneswalker,
  createCustomEmblem,
  emblemHasAbility,
  isTriggeredEmblem,
  isStaticEmblem,
  getPlayerEmblems,
  parseEmblemAbility,
  getAvailableEmblemNames,
  getEmblemSpec,
  COMMON_EMBLEMS,
} from './emblemSupport';

// Alternate Costs (Morophon, Jodah, Force of Will, etc.)
export {
  AlternateCostType,
  type AlternateCost,
  type CostReduction,
  type CostReductionCondition,
  WUBRG_COST,
  MOROPHON_REDUCTION,
  createJodahCost,
  createMorophonReduction,
  createPitchCost,
  createEvokeCost,
  createDashCost,
  createFlashbackCost,
  createMadnessCost,
  createMiracleCost,
  applyCostReduction,
  getTotalManaValue,
  isCostZero,
  creatureTypeMatchesCondition,
  getApplicableCostReductions,
  calculateFinalCost,
  canPayPitchCost,
} from './alternateCosts';

// Tribal Support
export {
  TribalTriggerType,
  type TribalEffect,
  type TribalTriggerEvent,
  hasChangeling,
  getAllCreatureTypes,
  permanentQualifiesForTribal,
  countCreaturesOfType,
  findCreaturesOfType,
  detectCastTribalTriggers,
  detectETBTribalTriggers,
  detectTribalEffectInText,
  COMMON_TRIBAL_EFFECTS,
} from './tribalSupport';

// Damage Processing (infect, wither, toxic, etc.)
export {
  type DamageSourceCharacteristics,
  DamageRecipientType,
  type DamageEvent,
  type DamageResult,
  parseDamageAbilities,
  createDamageSourceFromPermanent,
  processDamageToPlayer,
  processDamageToCreature,
  processDamageToPlaneswalker,
  processDamageToBattle,
  processDamage,
  wouldCreatureDieFromMinusCounters,
  calculateEffectiveToughness,
  createDamageEvent,
} from './damageProcessing';

// Player Protection (hexproof, shroud for players)
export {
  PlayerProtectionType,
  detectPlayerProtection,
  collectPlayerProtection,
  canTargetPlayer,
  canAttackPlayer,
  canPlayerLifeChange,
  playerHasHexproof,
  playerHasShroud,
  COMMON_PLAYER_PROTECTION_CARDS,
  type PlayerProtectionEffect,
  type PlayerTargetingResult,
  type PlayerProtectionCardName,
} from './playerProtection';

// Curses (Aura enchantments attached to players)
export {
  CurseEffectType,
  isCurse,
  detectCurseEffect,
  collectPlayerCurses,
  checkCurses,
  applyDamageMultipliers,
  canCastSpellWithCurses,
  getCurseUpkeepTriggers,
  getCurseAttackTriggers,
  countCursesOnPlayer,
  COMMON_CURSE_CARDS,
  type CurseEffect,
  type CurseCheckResult,
  type CurseCardName,
} from './curses';

// Casting Restrictions (Silence, Rule of Law, Grand Abolisher, etc.)
export {
  CastingRestrictionType,
  RestrictionDuration,
  detectCastingRestrictions,
  collectCastingRestrictions,
  canCastSpell,
  applySilenceEffect,
  clearEndOfTurnRestrictions,
  canActivateAbilities,
  COMMON_RESTRICTION_CARDS,
  type CastingRestriction,
  type CastingCheckResult,
  type RestrictionCardName,
} from './castingRestrictions';

// Flicker and Blink Effects
export {
  FlickerTiming,
  FlickerReturnController,
  parseFlickerEffect,
  executeFlicker,
  returnFlickeredPermanent,
  checkDelayedFlickerReturns,
  isFlickerCard,
  getFlickerEffectForCard,
  handleCommanderFlicker,
  COMMON_FLICKER_CARDS,
  type FlickerEffect,
  type FlickeredObject,
  type DelayedFlickerReturn,
  type FlickerResult,
  type FlickerReturnResult,
} from './flickerAndBlink';

// Zone Change Tracking
export {
  Zone,
  ZoneChangeCause,
  createZoneChangeTracker,
  createZoneChangeEvent,
  getTriggerEventForZoneChange,
  getSecondaryTriggerEvents,
  trackZoneChange,
  processPendingZoneChanges,
  clearProcessedChanges,
  checkETBTriggers as zoneCheckETBTriggers,
  checkLTBTriggers,
  checkDiesTriggers as zoneCheckDiesTriggers,
  checkSacrificeTriggers,
  getAllZoneChangeTriggers,
  type ZoneChangeEvent,
  type ZoneChangeContext,
  type PendingZoneChange,
  type ZoneChangeTracker,
} from './zoneChangeTracking';

// Delayed Triggered Abilities
export {
  DelayedTriggerTiming,
  createDelayedTriggerRegistry,
  createDelayedTrigger,
  registerDelayedTrigger,
  checkDelayedTriggers,
  processDelayedTriggers,
  expireDelayedTriggers,
  parseDelayedTriggerFromText,
  createFlickerReturnTrigger,
  createSacrificeAtEndTrigger,
  createWhenLeavesTrigger,
  createNextUpkeepTrigger,
  type DelayedTriggeredAbility,
  type DelayedTriggerRegistry,
} from './delayedTriggeredAbilities';

// Enhanced Combat Damage Automation
export {
  CombatDamagePhase,
  hasFirstStrikeDamage,
  hasRegularDamage,
  calculateLethalDamageForBlocker,
  assignDamageToBlockers,
  calculateTrampleToPlayer,
  processUnblockedAttacker,
  processBlockerDamageToAttacker,
  calculateLifelinkGains,
  determineCreatureDeaths,
  createCombatDamageTriggers,
  hasFirstStrikersInCombat,
  calculateCombatDamage,
  type DetailedDamageAssignment,
  type CombatDamageCalculation,
  type BlockerOrder,
} from './combatDamageEnhanced';

// Combat Control (Master Warcraft, Odric, Master Tactician)
export {
  detectCombatControlEffect,
  canCreatureBeControlledToAttack,
  canCreatureBeControlledToBlock,
  getControllableAttackers,
  getControllableBlockers,
  validateCombatControlAttackers,
  validateCombatControlBlockers,
  applyCombatControlEffect,
  clearCombatControlEffect,
  type CombatControlValidation,
  type CombatControlDeclaration,
  type CombatCreatureInfo,
} from './combatControl';

// =============================================================================
// LEGACY COMPATIBILITY
// =============================================================================

// Legacy function - kept for compatibility
export function passPriority(state: Readonly<GameState>, by: PlayerID): EngineResult<GameState> {
  if (state.priority !== by) return { next: state };
  const order = state.players.map(p => p.id);
  if (order.length === 0) return { next: state };
  const idx = order.indexOf(by);
  const nextPriority = order[(idx + 1) % order.length];
  return {
    next: {
      ...state,
      priority: nextPriority
    }
  };
}

// =============================================================================
// MTG ONLINE-STYLE AUTOMATION
// Full game automation with player decision tracking
// =============================================================================

// Automation Service - handles automatic gameplay
export {
  DecisionType,
  runAutomation,
  calculateCombatDamage as autoCalculateCombatDamage,
  applyCombatDamage as autoApplyCombatDamage,
  autoTapForMana,
  hasAvailableActions,
  requiresDecisionToResolve,
  processTriggeredAbilities,
  type PendingDecision,
  type DecisionOption,
  type SelectionFilter,
  type DecisionResult,
  type AutomationContext,
  type AutomationResult,
  type CombatDamageAssignment as AutoCombatDamageAssignment,
} from './AutomationService';

// Decision Manager - tracks and validates player decisions
export {
  DecisionManager,
  decisionManager,
  type DecisionResponse,
  type ValidationResult,
  type DecisionState,
} from './DecisionManager';

// Game Automation Controller - orchestrates automated gameplay
export {
  GameAutomationController,
  gameAutomationController,
  GameAutomationStatus,
  defaultAutomationConfig,
  type AutomationConfig,
  type AutomationStepResult,
  type GameEvent as AutomationGameEvent,
} from './GameAutomationController';

// Game Automation Verifier - comprehensive verification of automation setup
export {
  AutomationStatus,
  runFullAutomationVerification,
  getAutomationSummaryByCategory,
  validateGameStateForAutomation,
  verifyPhaseStepAutomation,
  verifyPriorityAutomation,
  verifyStateBasedActionsAutomation,
  verifyTriggeredAbilitiesAutomation,
  verifySpellCastingAutomation,
  verifyGameSetupAndWinConditions,
  verifySpecialRulesAutomation,
  type AutomationCheckResult,
  type VerificationReport,
} from './GameAutomationVerifier';

// Win Effect Cards (Rule 104.2b)
export {
  WinEffectType,
  WIN_EFFECT_CARDS,
  CANT_LOSE_CARDS,
  detectWinEffect,
  collectWinEffects,
  playerHasCantLoseEffect,
  opponentsHaveCantWinEffect,
  checkEmptyLibraryDrawWin,
  calculateDevotion,
  checkThassasOracleWin,
  checkUpkeepWinConditions,
  createWinEffectChoiceEvent,
  type WinEffect,
  type WinEffectCheckResult,
  type WinEffectChoiceEvent,
} from './winEffectCards';

// Choice Events (Comprehensive choice/popup event system)
export {
  ChoiceEventType,
  createTargetSelectionEvent,
  createModeSelectionEvent,
  createXValueSelectionEvent,
  createAttackerDeclarationEvent,
  createBlockerDeclarationEvent,
  createMayAbilityEvent,
  createCombatDamageAssignmentEvent,
  createBlockerOrderEvent,
  createDiscardSelectionEvent,
  createTokenCeasesToExistEvent,
  createCopyCeasesToExistEvent,
  createCommanderZoneChoiceEvent,
  createTriggerOrderEvent,
  createReplacementEffectChoiceEvent,
  createWinEffectTriggeredEvent,
  createColorChoiceEvent,
  createCreatureTypeChoiceEvent,
  createNumberChoiceEvent,
  createPlayerChoiceEvent,
  createOptionChoiceEvent,
  type BaseChoiceEvent,
  type ChoiceOption,
  type TargetSelectionEvent,
  type ModeSelectionEvent,
  type XValueSelectionEvent,
  type AttackerDeclarationEvent,
  type BlockerDeclarationEvent,
  type MayAbilityEvent,
  type CombatDamageAssignmentEvent,
  type BlockerOrderEvent,
  type DiscardSelectionEvent,
  type TokenCeasesToExistEvent,
  type CopyCeasesToExistEvent,
  type CommanderZoneChoiceEvent,
  type TriggerOrderEvent,
  type ReplacementEffectChoiceEvent,
  type WinEffectTriggeredEvent,
  type ColorChoiceEvent,
  type CreatureTypeChoiceEvent,
  type NumberChoiceEvent,
  type PlayerChoiceEvent,
  type OptionChoiceEvent,
  type ChoiceEvent,
  type ChoiceResponse,
  type ChoiceEventEmitter,
} from './choiceEvents';

// Oracle Text Parser (comprehensive parsing for MTG abilities)
export {
  AbilityType,
  parseOracleText,
  parseActivatedAbility,
  parseTriggeredAbility,
  parseReplacementEffect,
  parseKeywordActions,
  parseKeywords,
  parseDelayedTrigger,
  hasTriggeredAbility,
  hasActivatedAbility,
  hasReplacementEffect,
  type ParsedAbility,
  type ParsedKeywordAction,
  type OracleTextParseResult,
} from './oracleTextParser';

// Oracle Effect IR (best-effort structured effect parsing)
export {
  type OracleQuantity,
  type OraclePlayerSelector,
  type OracleObjectSelector,
  type OracleZone,
  type OracleEffectStep,
  type OracleIRAbility,
  type OracleIRResult,
} from './oracleIR';

export { parseOracleTextToIR } from './oracleIRParser';

export {
  applyOracleIRStepsToGameState,
  type OracleIRExecutionContext,
  type OracleIRExecutionOptions,
  type OracleIRExecutionResult,
} from './oracleIRExecutor';

// Permanent Ability Discovery (integrates oracleTextParser for battlefield permanents)
export {
  discoverPermanentAbilities,
  discoverPlayerAbilities,
  getManaAbilitiesFromPermanent,
  getNonManaAbilitiesFromPermanent,
  toActivatedAbility,
  permanentHasActivatedAbilities,
  permanentHasManaAbilities,
  type DiscoveredAbility,
  type AbilityDiscoveryResult,
} from './permanentAbilityDiscovery';