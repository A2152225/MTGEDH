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
  AdventureState,
  castAsAdventure,
  PrototypeCard,
  isPrototypeCard,
  getPrototypeCharacteristics,
  CaseCard,
  getActiveCaseAbilities,
  ClassCard,
  isClassCard,
  getClassLevel,
  AttractionCard,
  isAttractionCard,
} from './remainingCardTypes';

// Rules 720-732: Special Game Mechanics
// Note: StationAbility conflicts with ./types
export {
  MonarchState,
  becomeMonarch,
  handleMonarchCombatDamage,
  InitiativeState,
  takeInitiative,
  DayNightState,
  checkDayNight,
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
  activateAbility,
} from './activatedAbilities';

// Triggered Abilities (Rule 603) - Many conflicts
export {
  TriggerKeyword,
  type TriggerQueue,
  createEmptyTriggerQueue,
  processEvent,
} from './triggeredAbilities';

// Static Abilities (Rule 604) - StaticAbility, StaticEffectType conflict
export {
  parseStaticAbilities,
  matchesFilter,
  calculateEffectivePT,
  collectStaticAbilities,
  applyStaticAbilitiesToBattlefield,
} from './staticAbilities';

// Triggered Effects Automation - PendingTrigger, TriggerType conflict
export {
  TriggeredEffectsEngine,
  type TriggerCheckResult,
} from './triggeredEffectsAutomation';

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

// Priority System (Rule 117) - PriorityState conflicts
export {
  type PriorityAction,
  type PriorityResult,
  createPriorityState,
  grantPriority,
  holdPriority,
  hasPriority,
  getNextPriorityPlayer,
} from './prioritySystem';

// Cleanup Step (Rule 514) - Some function name conflicts
export {
  type CleanupStepState,
  type CleanupStepResult,
  getDiscardCount,
  processEndOfTurnEffects,
  removeDamageFromPermanents,
} from './cleanupStep';

// Library Search Effects
export * from './librarySearchEffects';

// Opening Hand Actions - OpeningHandAction conflicts
export {
  type OpeningHandContext,
  processOpeningHandActions,
  getOpeningHandActionCards,
  executeLeylineAction,
  executeChancellorAction,
} from './openingHandActions';

// Token Creation - createTokens conflicts
export {
  type TokenTemplate,
  type TokenCreationContext,
  createToken,
  createPredefinedToken,
  modifyTokenOnCreation,
} from './tokenCreation';

// Combat Automation
export {
  type CombatState,
  type AttackerInfo,
  type BlockerInfo,
  type CombatDamageResult,
  initializeCombat,
  declareAttacker,
  declareBlocker,
  orderBlockers,
  calculateCombatDamage,
  processCombatDamage,
  endCombat,
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
} from './actions';

// Core types - ActionContext, BaseAction
export { type ActionContext, type BaseAction, type ActionResult } from './core';

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